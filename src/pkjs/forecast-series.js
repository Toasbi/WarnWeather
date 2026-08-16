var rainTier = require('./weather/rain-tier');
var COLORS = require('./pebble-colors');
var configUi = require('./config-ui');   // isColorPlatform — same helper rain-tier/palette-wire use
var resolveInkLib = require('./resolve-ink.js');
var statusLines = require('./status-lines.js');
var statusCatalog = require('./status-line-catalog.js');
var pressurePlausibility = require('./weather/pressure-plausibility.js');
var resolveInk = resolveInkLib.resolveInk;
var isBwTheme = resolveInkLib.isBwTheme;
var isLightPolarity = resolveInkLib.isLightPolarity;
var effectiveTheme = resolveInkLib.effectiveTheme;

/**
 * Quantize a permille value (0..1000) to a 0..250 byte for the wire.
 * @param {number} pm Permille value.
 * @returns {number} Byte 0..250.
 */
function permilleToByte(pm) {
    var b = Math.round(pm / 4);
    if (b < 0) { b = 0; }
    if (b > 250) { b = 250; }
    return b;
}

/**
 * Scale a temperature series to 0..250 bytes across its own min..max — or, when a
 * band is supplied, across the union of that band and the series — and report the
 * band actually used (for the watch's hi/lo labels). Callers without a band get
 * today's behaviour unchanged; the band arm exists for the joint temp∪feels axis
 * (see applyForecastSeries).
 * @param {number[]} temps Whole-degree temperatures.
 * @param {{min: number, max: number}} [band] Optional wider scaling band.
 * @returns {{bytes: number[], min: number, max: number}} Scaled bytes + used range.
 */
function tempTrendToBytes(temps, band) {
    var min = Infinity, max = -Infinity, i;
    for (i = 0; i < temps.length; i += 1) {
        if (temps[i] < min) { min = temps[i]; }
        if (temps[i] > max) { max = temps[i]; }
    }
    if (!isFinite(min)) { return { bytes: [], min: 0, max: 0 }; }
    if (band) {
        if (band.min < min) { min = band.min; }
        if (band.max > max) { max = band.max; }
    }
    var span = max - min;
    var bytes = [];
    for (i = 0; i < temps.length; i += 1) {
        if (span === 0) { bytes.push(125); continue; }
        var b = Math.round((temps[i] - min) * 250 / span);
        if (b < 0) { b = 0; }
        if (b > 250) { b = 250; }
        bytes.push(b);
    }
    return { bytes: bytes, min: min, max: max };
}

/**
 * Invert tempTrendToBytes: recover the whole-degree series from its wire bytes and
 * band. Exact while the band span stays under 250 (the 0.5-byte quantization error
 * stays under half a degree) — always true for a 24 h °F window.
 * @param {number[]} bytes TEMP_TREND_UINT8 wire bytes (0..250).
 * @param {number} min Band floor (TEMP_MIN).
 * @param {number} max Band ceiling (TEMP_MAX).
 * @returns {number[]} Whole-degree temperatures.
 */
function tempsFromBytes(bytes, min, max) {
    var span = max - min;
    return bytes.map(function(b) {
        return Math.round(min + b * span / 250);
    });
}

// Metric → line stroke colour per platform class. Gust is settings-dependent on colour
// displays, so it is resolved in lineColorFor(), not from this table. `light` is an
// optional light-theme override, consulted by lineColorFor() when the theme is
// light-polarity and the display is effectively colour; a metric without one keeps its
// `color` value in every color-capable theme (see fillColorFor's identical `light`
// convention below). precip has one from the readability feedback round (PictonBlue
// read too bright against the light-theme's white background — VividCerulean is one
// Pebble-palette step darker, same R-channel notch as the fill below); feels has one
// because LightGray is illegible on white.
var LINE_COLORS = {
    precip_prob: { color: COLORS.GColorPictonBlue, light: COLORS.GColorVividCerulean, bw: COLORS.GColorWhite },
    wind:        { color: COLORS.GColorYellow,     bw: COLORS.GColorWhite },
    uv:          { color: COLORS.GColorMagenta,    bw: COLORS.GColorWhite },
    // Orange is the last unclaimed warm hue: precip owns blue, uv magenta, gust the
    // grays. It reads close to wind's yellow at 1px — eyeball on hardware before
    // treating it as final.
    pressure:    { color: COLORS.GColorOrange,     bw: COLORS.GColorWhite },
    // Feels-like shadows the 3px temp curve, so it stays achromatic and dimmer than
    // any hue: LightGray next to temp's white line, darkened for the light theme. On
    // B&W the width/pattern (1px solid or dots vs the 3px temp curve) tells it apart.
    feels:       { color: COLORS.GColorLightGray,  light: COLORS.GColorDarkGray,      bw: COLORS.GColorWhite }
};
// Metric → area-fill colour per platform class. Every metric can fill; colour-platform
// fills are a darker shade of the line so the line always reads brighter (precip
// PictonBlue→CobaltBlue, wind→ArmyGreen, uv→Purple, gust→DarkGray). B&W has no range,
// so all fills are LightGray. `light` is the light-theme fill: the dark-theme shades read
// too heavy against a white background, so light theme gets a brighter tint of the same
// hue instead (precip→ElectricBlue, wind→Inchworm, uv→ShockingPink, gust→LightGray).
// precip's light tint was Celeste (0xAAFFFF) until the readability feedback round: it
// read too washed-out, so it moved one Pebble-palette step darker to ElectricBlue
// (0x55FFFF — the R channel steps 0xAA -> 0x55, matching the line's PictonBlue ->
// VividCerulean step above). NOTE: 0x55FFFF has no "Cyan"-named constant in
// pebble-colors.js — the real GColorCyan is 0x00FFFF — GColorElectricBlue is the
// correct name for this hex. First pass — the user will tune these further.
var FILL_COLORS = {
    precip_prob: { color: COLORS.GColorCobaltBlue, light: COLORS.GColorElectricBlue, bw: COLORS.GColorLightGray },
    wind:        { color: COLORS.GColorArmyGreen,  light: COLORS.GColorInchworm,     bw: COLORS.GColorLightGray },
    uv:          { color: COLORS.GColorPurple,     light: COLORS.GColorShockingPink, bw: COLORS.GColorLightGray },
    gust:        { color: COLORS.GColorDarkGray,   light: COLORS.GColorLightGray,    bw: COLORS.GColorLightGray },
    pressure:    { color: COLORS.GColorWindsorTan, light: COLORS.GColorChromeYellow, bw: COLORS.GColorLightGray },
    // The dark fill MUST stay LightGray: forecast_layer.c's night_area_palette_for_fill
    // keys the feels night palette on GColorLightGray (a mismatched fill renders the
    // night area precip-blue — the documented pressure bug). Unambiguous vs gust's
    // LightGray light tint because light-polarity fills never reach that C table.
    feels:       { color: COLORS.GColorLightGray,  light: COLORS.GColorLightGray,    bw: COLORS.GColorLightGray }
};

/**
 * Whether the watch has a colour display.
 * @param {Object} watchInfo getActiveWatchInfo() result, or null.
 * @returns {boolean} True on colour platforms; defaults to colour when watchInfo is absent.
 */
function isColorWatch(watchInfo) {
    return configUi.isColorPlatform(watchInfo ? watchInfo.platform : 'basalt');
}

/**
 * Line/dot colour for a metric, resolved for the platform + theme. isColor should
 * already be the EFFECTIVE color flag (isColorWatch(watchInfo) && !isBwTheme(theme)) —
 * see buildForecastSeries. On B&W (or bw/bw-light theme) every line is the theme
 * foreground; gust on colour is settings-dependent so it never matches the rain bars.
 * On a colour display, a light-polarity theme (light or bw-light) swaps in the metric's
 * `light` variant (see LINE_COLORS) when one is defined — mirrors fillColorFor's `light`
 * convention below; a metric without one keeps its dark-theme `color`. isColor is
 * already the EFFECTIVE color flag, so bw/bw-light never reach the light-variant branch
 * — they resolve via the `!isColor` guard above instead. resolveInk flips an exact white
 * to black in light-polarity themes; hues and grays pass through.
 * @param {string} metric precip_prob|wind|gust|uv.
 * @param {Object} settings Clay settings (reads rainBarColor for gust).
 * @param {boolean} isColor Effective colour display?
 * @param {string} [theme] 'dark'|'light'|'bw'|'bw-light'; defaults to 'dark' (no flip) when omitted.
 * @returns {number} 0xRRGGBB colour.
 */
function lineColorFor(metric, settings, isColor, theme) {
    theme = theme || 'dark';
    var result;
    if (!isColor) {
        result = COLORS.GColorWhite;
    } else if (metric === 'gust') {
        result = settings.rainBarColor === 'white' ? COLORS.GColorLightGray : COLORS.GColorWhite;
    } else {
        var entry = LINE_COLORS[metric];
        if (!entry) {
            result = COLORS.GColorBlack;
        } else if (entry.light && isLightPolarity(theme)) {
            result = entry.light;
        } else {
            result = entry.color;
        }
    }
    return resolveInk(result, theme);
}

/**
 * Area-fill colour for a metric, resolved for the platform + theme. On a colour display,
 * a light-polarity theme (light or bw-light) swaps in the metric's brighter `light` tint
 * (see FILL_COLORS) instead of the dark-theme shade so the fill reads against a white
 * background; B&W ignores theme (always LightGray). isColor is already the EFFECTIVE
 * color flag, so bw/bw-light never reach the light-tint branch — they resolve via the
 * `!isColor` guard above instead.
 * @param {string} metric precip_prob|wind|gust|uv.
 * @param {boolean} isColor Colour display?
 * @param {string} [theme] 'dark'|'light'|'bw'|'bw-light'; defaults to 'dark' (no light variant) when omitted.
 * @returns {number|undefined} 0xRRGGBB colour, or undefined for an unknown metric.
 */
function fillColorFor(metric, isColor, theme) {
    theme = theme || 'dark';
    var entry = FILL_COLORS[metric];
    if (!entry) { return undefined; }
    if (!isColor) { return entry.bw; }
    return isLightPolarity(theme) ? entry.light : entry.color;
}

// windScale → km/h ceiling at the top of the graph. Wind and gust share it so a
// gust line always reads as >= the wind line.
var WIND_SCALE_KMH = { low: 30, mid: 50, high: 70 };
// UV full-scale. Raw uv values are tenths (UV×10); UV 11.0 = 110 tenths maps to the graph top.
var UV_FULL_SCALE_TENTHS = 110;
// Sea-level pressure curve mapped to graph height, selected by the pressureScale
// setting: FIXED and ABSOLUTE (the same reading always lands on the same row — a
// self-centring band was tried and rejected: with no printed axis the absolute level
// became unreadable), but PIECEWISE like the rain-bar tiers so nothing ever clamps.
// Each curve is [hPa, permille] breakpoints: the normal-weather core gets 70% of the
// plot height at full resolution, and the deep-low / high shoulders compress the
// remaining 940..1060 hPa into the outer 30% — a storm still dives visibly, just not
// in the core's proportion. Always MSL — station pressure falls ~12 hPa per 100 m
// and the plausibility gate below would reject it at altitude anyway.
var PRESSURE_SCALE_CURVE_HPA = {
    low:  [[940, 0], [1010, 150], [1020, 850], [1060, 1000]],   // Narrow — core 1010..1020
    mid:  [[940, 0], [1005, 150], [1025, 850], [1060, 1000]],   // Mid    — core 1005..1025 (default)
    high: [[940, 0], [995, 200], [1035, 900], [1060, 1000]]     // Wide   — core 995..1035
};

/**
 * Piecewise-linear interpolation over [x, y] breakpoints, clamped at both ends.
 * @param {number} v Input value.
 * @param {Array.<Array.<number>>} pts Breakpoints, ascending in x.
 * @returns {number} Interpolated y, rounded to an integer.
 */
function curvePermille(v, pts) {
    if (v <= pts[0][0]) { return pts[0][1]; }
    for (var i = 1; i < pts.length; i += 1) {
        if (v <= pts[i][0]) {
            var x0 = pts[i - 1][0], y0 = pts[i - 1][1];
            return Math.round(y0 + (v - x0) * (pts[i][1] - y0) / (pts[i][0] - x0));
        }
    }
    return pts[pts.length - 1][1];
}
// Plausibility window for one sea-level reading -- shared with status-lines.js via
// weather/pressure-plausibility.js (see that file's header for why it lives there
// instead of being exported from here). 0 hPa is physically impossible but is
// exactly what an absent value coerces to, and it would otherwise draw a spike to
// the graph floor -- or, in the status slot, print as a bogus "0hPa" reading.
var isPlausiblePressure = pressurePlausibility.isPlausiblePressure;

// Smallest permille value that survives permilleToByte's /4-and-round quantization
// to a non-zero byte (round(2/4) === 1; round(1/4) === 0). Used to float a
// floor-clamped pressure reading off exactly byte 0, which chart.c's dot renderer
// (chart.c:224, "values[i] <= lo") treats as "no data, skip" -- see pressurePermille.
var PRESSURE_FLOOR_PERMILLE = 2;

/**
 * Scale a km/h-style series to permille (0..1000) against a ceiling, clamped to the top.
 * @param {number[]} arr Per-hour values.
 * @param {number} max Value mapped to permille 1000.
 * @returns {number[]} Permille values, each clamped to 0..1000.
 */
function scaleToPermille(arr, max) {
    return (arr || []).map(function(v) {
        var permille = Math.round((Number(v) || 0) / max * 1000);
        if (permille < 0) { permille = 0; }
        if (permille > 1000) { permille = 1000; }
        return permille;
    });
}

/**
 * Scale a series to permille (0..1000) against a [min, max] band, clamped at both
 * ends. Unlike scaleToPermille this has a non-zero floor, so a value at or below min
 * lands on the graph baseline rather than off-scale below it.
 * @param {number[]} arr Per-hour values.
 * @param {number} min Value mapped to permille 0.
 * @param {number} max Value mapped to permille 1000.
 * @returns {number[]} Permille values, each clamped to 0..1000.
 */
function scaleToPermilleRange(arr, min, max) {
    var span = max - min;
    return (arr || []).map(function(v) {
        var permille = Math.round((Number(v) - min) / span * 1000);
        if (permille < 0) { permille = 0; }
        if (permille > 1000) { permille = 1000; }
        return permille;
    });
}

/**
 * Permille series for the pressure metric, or [] when the data is unusable. Validates
 * the WHOLE series before scaling: a single implausible entry rejects everything rather
 * than being interpolated away, which keeps the rule simple and never invents data. An
 * empty result renders as line-off — the same graceful degrade an absent series gets.
 * A value at or below the band floor is real data (not "no data"), so its permille is
 * floor-clamped to PRESSURE_FLOOR_PERMILLE rather than 0 -- see that constant's comment.
 * @param {Array.<number>} arr Per-hour sea-level pressure in hPa.
 * @param {string} scale pressureScale setting: low|mid|high.
 * @returns {number[]} Permille series, or [] when any entry is implausible.
 */
function pressurePermille(arr, scale) {
    if (!arr || !arr.length) { return []; }
    var v;
    for (var i = 0; i < arr.length; i += 1) {
        v = Number(arr[i]);
        if (!isPlausiblePressure(v)) {
            // Diagnostic only -- the whole-series rejection rule above is intentional
            // and must not change; this just makes an otherwise-silent blank line
            // debuggable (provider zero-fill for an unreported station hour is the
            // common cause).
            console.log('[pressure] series rejected: implausible value ' + v + ' at hour ' + i);
            return [];
        }
    }
    var curve = PRESSURE_SCALE_CURVE_HPA[scale] || PRESSURE_SCALE_CURVE_HPA.mid;
    return arr.map(function(reading) {
        var pm = curvePermille(Number(reading), curve);
        return pm === 0 ? PRESSURE_FLOOR_PERMILLE : pm;
    });
}

/**
 * Whether the feels-like metric occupies either forecast line channel.
 * @param {Object} settings Clay settings.
 * @returns {boolean} True when secondary or third line is 'feels'.
 */
function feelsLineSelected(settings) {
    return settings.secondaryLine === 'feels' || settings.thirdLine === 'feels';
}

/**
 * Widen a temperature band to also cover a feels-like series. Idempotent: feeding
 * back an already-joint band returns it unchanged.
 * @param {number} tempMin Band floor (°F).
 * @param {number} tempMax Band ceiling (°F).
 * @param {number[]} feels Feels-like series (°F).
 * @returns {{min: number, max: number}} Joint band.
 */
function jointTempFeelsBand(tempMin, tempMax, feels) {
    var min = tempMin, max = tempMax, i, v;
    for (i = 0; i < feels.length; i += 1) {
        v = Number(feels[i]);
        if (v < min) { min = v; }
        if (v > max) { max = v; }
    }
    // Whole degrees, widening outward: the band lands in the int32 TEMP_MIN/
    // TEMP_MAX wire keys, and a fractional edge (fixture data, future float
    // source) must still cover both series after truncation.
    return { min: Math.floor(min), max: Math.ceil(max) };
}

/**
 * Permille series for the feels-like metric, mapped against the shared temperature
 * axis: the temp∪feels joint band (applyForecastSeries has already widened
 * TEMP_MIN/TEMP_MAX to it, so both curves land pixel-aligned in the same value
 * space and the gap between them is real). No band (a direct buildForecastSeries
 * caller) → the series scales against its own min/max. Empty/absent series → []
 * (line off, same graceful degrade as the other metrics).
 * @param {number[]} feels Feels-like series (°F).
 * @param {{min: number, max: number}|null} band Temperature axis band, or null.
 * @returns {number[]} Permille series.
 */
function feelsPermille(feels, band) {
    if (!feels || !feels.length) { return []; }
    var joint = band ? jointTempFeelsBand(band.min, band.max, feels)
                     : jointTempFeelsBand(Infinity, -Infinity, feels);
    if (joint.max === joint.min) {
        // Flat joint band: mid of the plot, mirroring tempTrendToBytes' byte 125.
        return feels.map(function() { return 500; });
    }
    return scaleToPermilleRange(feels, joint.min, joint.max);
}

/**
 * Permille (0..1000) series for one metric. Unknown metric → null. An absent/empty
 * raw series yields [] so the line renders as off (graceful degrade).
 * @param {string} metric One of precip_prob|wind|gust|uv|pressure|feels.
 * @param {Object} raw Raw provider series (feels also reads raw.tempBand).
 * @param {Object} settings Clay settings (windScale).
 * @returns {number[]|null} Permille series, or null for an unknown metric.
 */
function metricPermille(metric, raw, settings) {
    if (metric === 'precip_prob') {
        return (raw.precips || []).map(function(p) { return p * 10; }); // %→permille
    }
    if (metric === 'wind' || metric === 'gust') {
        var max = WIND_SCALE_KMH[settings.windScale] || WIND_SCALE_KMH.mid;
        return scaleToPermille(metric === 'wind' ? raw.winds : raw.gusts, max);
    }
    if (metric === 'uv') {
        return scaleToPermille(raw.uvs, UV_FULL_SCALE_TENTHS);
    }
    if (metric === 'pressure') {
        return pressurePermille(raw.pressures, settings.pressureScale);
    }
    if (metric === 'feels') {
        return feelsPermille(raw.feels, raw.tempBand);
    }
    return null;
}

/**
 * Map raw provider series + settings to the render-ready forecast wire fields.
 * Secondary line is always one metric; third line is off or a different metric
 * (the config UI prevents duplicates; this also defends against a duplicate).
 * Fill works for every metric on the solid main line; the third line is always dashed
 * and never filled.
 * @param {{precips:number[], rains:number[], winds:number[], gusts:number[], uvs:number[], pressures:number[], feels:number[], tempBand:Object}} raw Raw series (+ the temp axis band the feels metric shares).
 * @param {{secondaryLine:string, thirdLine:string, secondaryLineFill:boolean, windScale:string, barSource:string}} settings Settings.
 * @param {Object} watchInfo getActiveWatchInfo() result, or null/undefined (treated as colour).
 * @returns {Object} Wire fields (see module interface).
 */
function buildForecastSeries(raw, settings, watchInfo) {
    // Fold the stored theme to what the target platform actually renders: aplite has
    // the light polarity compiled out (theme.h pins theme_is_light() false), so a
    // light / bw-light byte renders as the classic white-on-black there. Without this
    // the light-polarity flip below would send black line/dot colors to aplite, which
    // draws them black-on-black (the reported bug). Every other platform ships the
    // polarity, so effectiveTheme returns the theme unchanged for them.
    var platform = watchInfo && watchInfo.platform ? watchInfo.platform : 'basalt';
    var theme = effectiveTheme(settings.theme || 'dark',
                               configUi.isThemePolarityPlatform(platform));
    // Effective color: a color display renders as color only when the theme isn't
    // Black & White — a bw/bw-light theme reuses the exact color model B&W watches
    // get today (bw-light in its light-polarity form).
    var isColor = isColorWatch(watchInfo) && !isBwTheme(theme);
    var out = {};

    // Secondary line: always present (one of the four metrics).
    var secMetric = settings.secondaryLine;
    var secPm = metricPermille(secMetric, raw, settings);
    out.SECONDARY_LINE_TREND_UINT8 = secPm ? secPm.map(permilleToByte) : [];
    out.SECONDARY_LINE_COLOR = lineColorFor(secMetric, settings, isColor, theme) || COLORS.GColorBlack;
    out.SECONDARY_LINE_FILL = Boolean(settings.secondaryLineFill);
    out.SECONDARY_LINE_FILL_COLOR = fillColorFor(secMetric, isColor, theme) || out.SECONDARY_LINE_COLOR;

    // Third line: optional; off, or a metric distinct from the secondary one.
    var thirdMetric = settings.thirdLine;
    var thirdPm = (thirdMetric && thirdMetric !== 'off' && thirdMetric !== secMetric)
        ? metricPermille(thirdMetric, raw, settings) : null;
    var thirdBytes = thirdPm ? thirdPm.map(permilleToByte) : [];
    out.THIRD_LINE_TREND_UINT8 = thirdBytes;
    if (thirdBytes.length > 0) {
        out.THIRD_LINE_COLOR = lineColorFor(thirdMetric, settings, isColor, theme) || resolveInk(COLORS.GColorWhite, theme);
    }

    // Rain bars: independent of the metric lines.
    out.BAR_TREND_UINT8 = settings.barSource === 'rain'
        ? (raw.rains || []).map(rainTier.rainPermille).map(permilleToByte) : [];
    return out;
}

/**
 * Replace a payload's raw precip/rain/wind/gust/uv trend keys with the render-ready
 * secondary + third + bar wire series. Mutates and returns the payload. Both the
 * live-fetch and fixture send paths call this so the two can't drift.
 * @param {Object} payload Weather payload with PRECIP_/RAIN_/WIND_/GUST_/UV_TREND_UINT8.
 * @param {Object} settings Clay settings.
 * @param {Object} watchInfo getActiveWatchInfo() result, or null/undefined (treated as colour).
 * @returns {Object} The same payload, raw keys removed and wire keys set.
 */
function applyForecastSeries(payload, settings, watchInfo) {
    // Bake the packed status lines while the transient trend arrays are
    // still on the payload (they die a few lines below).
    statusLines.buildStatusLines(payload, settings, watchInfo);
    // Joint temp∪feels axis: with the feels line selected, the temp curve rescales
    // against min/max over BOTH series and TEMP_MIN/TEMP_MAX carry the joint band so
    // the axis labels stay honest (feelsPermille maps feels against the same widened
    // band via raw.tempBand below). getPayload() baked the bytes against temp's own
    // band without settings in hand, so the whole degrees are recovered from the
    // bytes here — exact for any realistic span (see tempsFromBytes). Feels not
    // selected, or FEELS_TREND absent/empty (provider gap): untouched, byte-identical
    // to today — the band falls back to temp-only.
    var feels = feelsLineSelected(settings) ? (payload.FEELS_TREND || []) : [];
    if (feels.length && payload.TEMP_TREND_UINT8 && payload.TEMP_TREND_UINT8.length) {
        var jointEnc = tempTrendToBytes(
            tempsFromBytes(payload.TEMP_TREND_UINT8, payload.TEMP_MIN, payload.TEMP_MAX),
            jointTempFeelsBand(payload.TEMP_MIN, payload.TEMP_MAX, feels)
        );
        payload.TEMP_TREND_UINT8 = jointEnc.bytes;
        payload.TEMP_MIN = jointEnc.min;
        payload.TEMP_MAX = jointEnc.max;
    }
    var tempBand = (typeof payload.TEMP_MIN === 'number' && typeof payload.TEMP_MAX === 'number')
        ? { min: payload.TEMP_MIN, max: payload.TEMP_MAX } : null;
    var series = buildForecastSeries(
        { precips: payload.PRECIP_TREND_UINT8, rains: payload.RAIN_TREND_UINT8,
          winds: payload.WIND_TREND_UINT8, gusts: payload.GUST_TREND_UINT8,
          uvs: payload.UV_TREND_UINT8, pressures: payload.PRESSURE_TREND,
          feels: feels, tempBand: tempBand },
        settings, watchInfo
    );
    delete payload.CURRENT_TEMP; // baked into the status lines; no longer a wire key
    delete payload.CITY;         // baked into the status lines; no longer a wire key
    delete payload.PRECIP_TREND_UINT8;
    delete payload.RAIN_TREND_UINT8;
    delete payload.WIND_TREND_UINT8;  // transient PKJS-only; never over the wire
    delete payload.GUST_TREND_UINT8;  // transient PKJS-only; never over the wire
    delete payload.UV_TREND_UINT8;    // transient PKJS-only; never over the wire
    delete payload.PRESSURE_TREND;    // transient PKJS-only; hPa never fit a byte, never wired
    delete payload.AQI_TREND;         // transient PKJS-only; baked into status text, never wired
    delete payload.POLLEN_TODAY;      // transient PKJS-only; baked into status text, never wired
    delete payload.FEELS_TREND;       // transient PKJS-only; consumed by the joint band + feels line above, never wired
    delete payload.FEELS_CURRENT;     // baked into the status lines by buildStatusLines above (same ordering contract as CURRENT_TEMP)
    payload.SECONDARY_LINE_TREND_UINT8 = series.SECONDARY_LINE_TREND_UINT8;
    payload.SECONDARY_LINE_COLOR = series.SECONDARY_LINE_COLOR;
    payload.SECONDARY_LINE_FILL = series.SECONDARY_LINE_FILL;
    payload.SECONDARY_LINE_FILL_COLOR = series.SECONDARY_LINE_FILL_COLOR;
    payload.THIRD_LINE_TREND_UINT8 = series.THIRD_LINE_TREND_UINT8;
    if ('THIRD_LINE_COLOR' in series) { payload.THIRD_LINE_COLOR = series.THIRD_LINE_COLOR; }
    else { delete payload.THIRD_LINE_COLOR; }
    payload.BAR_TREND_UINT8 = series.BAR_TREND_UINT8;
    return payload;
}

/**
 * Whether UV is on a forecast line or in a status slot, so providers fetch it.
 * @param {Object} settings Clay settings.
 * @returns {boolean} True when any rendered selection needs UV.
 */
function needsUv(settings) {
    if (!settings) { return false; }
    if (settings.secondaryLine === 'uv' || settings.thirdLine === 'uv') { return true; }
    // A status-line UV slot must extend the fetch gate or it bakes empty.
    return statusCatalog.selectedCodes(settings).indexOf('uv') !== -1;
}

/**
 * Whether AQI is in a status slot, so providers fetch it. AQI is status-only
 * (never a forecast line), so unlike needsUv there is no secondary/third check.
 * @param {Object} settings Clay settings.
 * @returns {boolean} True when any status slot selects AQI.
 */
function needsAqi(settings) {
    if (!settings) { return false; }
    return statusCatalog.selectedCodes(settings).indexOf('aqi') !== -1;
}

/**
 * Whether feels-like data is needed: on a forecast line, or because the temp slot's
 * display mode shows the feels value ('feels'/'both'). Providers gate the (sometimes
 * Steadman-computed) apparent-temperature work on this so non-users pay nothing.
 * @param {Object} settings Clay settings.
 * @returns {boolean} True when any rendered selection needs feels-like data.
 */
function needsFeels(settings) {
    if (!settings) { return false; }
    if (feelsLineSelected(settings)) { return true; }
    return Boolean(settings.tempSlotDisplay) && settings.tempSlotDisplay !== 'actual';
}

/**
 * Whether a DWD status slot selects pollen. Pollen is DWD-only and status-only.
 * @param {Object} settings Clay settings.
 * @returns {boolean} True when the effective provider and slot selection need pollen.
 */
function needsPollen(settings) {
    if (!settings || settings.provider !== 'dwd') { return false; }
    return statusCatalog.selectedCodes(settings).indexOf('pollen') !== -1;
}

module.exports = {
    buildForecastSeries: buildForecastSeries,
    applyForecastSeries: applyForecastSeries,
    needsUv: needsUv,
    needsAqi: needsAqi,
    needsFeels: needsFeels,
    needsPollen: needsPollen,
    permilleToByte: permilleToByte,
    tempTrendToBytes: tempTrendToBytes,
    LINE_COLORS: LINE_COLORS,
    FILL_COLORS: FILL_COLORS,
    PRESSURE_SCALE_CURVE_HPA: PRESSURE_SCALE_CURVE_HPA,
    lineColorFor: lineColorFor,
    fillColorFor: fillColorFor
};
