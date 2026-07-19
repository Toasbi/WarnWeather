var rainTier = require('./weather/rain-tier');
var COLORS = require('./pebble-colors');
var configUi = require('./config-ui');   // isColorPlatform — same helper rain-tier/palette-wire use
var resolveInkLib = require('./resolve-ink.js');
var statusLines = require('./status-lines.js');
var statusCatalog = require('./status-line-catalog.js');
var resolveInk = resolveInkLib.resolveInk;
var isBwTheme = resolveInkLib.isBwTheme;
var isLightPolarity = resolveInkLib.isLightPolarity;

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
 * Scale a temperature series to 0..250 bytes across its own min..max, and
 * report the real min/max (for the watch's hi/lo labels).
 * @param {number[]} temps Whole-degree temperatures.
 * @returns {{bytes: number[], min: number, max: number}} Scaled bytes + real range.
 */
function tempTrendToBytes(temps) {
    var min = Infinity, max = -Infinity, i;
    for (i = 0; i < temps.length; i += 1) {
        if (temps[i] < min) { min = temps[i]; }
        if (temps[i] > max) { max = temps[i]; }
    }
    if (!isFinite(min)) { return { bytes: [], min: 0, max: 0 }; }
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

// Metric → line stroke colour per platform class. Gust is settings-dependent on colour
// displays, so it is resolved in lineColorFor(), not from this table. `light` is an
// optional light-theme override, consulted by lineColorFor() when the theme is
// light-polarity and the display is effectively colour; a metric without one keeps its
// `color` value in every color-capable theme (see fillColorFor's identical `light`
// convention below). precip is the only metric with one so far (readability feedback
// round: PictonBlue read too bright against the light-theme's white background —
// VividCerulean is one Pebble-palette step darker, same R-channel notch as the fill
// below).
var LINE_COLORS = {
    precip_prob: { color: COLORS.GColorPictonBlue, light: COLORS.GColorVividCerulean, bw: COLORS.GColorWhite },
    wind:        { color: COLORS.GColorYellow,     bw: COLORS.GColorWhite },
    uv:          { color: COLORS.GColorMagenta,    bw: COLORS.GColorWhite }
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
    gust:        { color: COLORS.GColorDarkGray,   light: COLORS.GColorLightGray,    bw: COLORS.GColorLightGray }
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
 * Permille (0..1000) series for one metric. Unknown metric → null. An absent/empty
 * raw series yields [] so the line renders as off (graceful degrade).
 * @param {string} metric One of precip_prob|wind|gust|uv.
 * @param {Object} raw Raw provider series.
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
    return null;
}

/**
 * Map raw provider series + settings to the render-ready forecast wire fields.
 * Secondary line is always one metric; third line is off or a different metric
 * (the config UI prevents duplicates; this also defends against a duplicate).
 * Fill works for every metric on the solid main line; the third line is always dashed
 * and never filled.
 * @param {{precips:number[], rains:number[], winds:number[], gusts:number[], uvs:number[]}} raw Raw series.
 * @param {{secondaryLine:string, thirdLine:string, secondaryLineFill:boolean, windScale:string, barSource:string}} settings Settings.
 * @param {Object} watchInfo getActiveWatchInfo() result, or null/undefined (treated as colour).
 * @returns {Object} Wire fields (see module interface).
 */
function buildForecastSeries(raw, settings, watchInfo) {
    var theme = settings.theme || 'dark';
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
    var series = buildForecastSeries(
        { precips: payload.PRECIP_TREND_UINT8, rains: payload.RAIN_TREND_UINT8,
          winds: payload.WIND_TREND_UINT8, gusts: payload.GUST_TREND_UINT8,
          uvs: payload.UV_TREND_UINT8 },
        settings, watchInfo
    );
    delete payload.CURRENT_TEMP; // baked into the status lines; no longer a wire key
    delete payload.CITY;         // baked into the status lines; no longer a wire key
    delete payload.PRECIP_TREND_UINT8;
    delete payload.RAIN_TREND_UINT8;
    delete payload.WIND_TREND_UINT8;  // transient PKJS-only; never over the wire
    delete payload.GUST_TREND_UINT8;  // transient PKJS-only; never over the wire
    delete payload.UV_TREND_UINT8;    // transient PKJS-only; never over the wire
    delete payload.AQI_TREND;         // transient PKJS-only; baked into status text, never wired
    delete payload.POLLEN_TODAY;      // transient PKJS-only; baked into status text, never wired
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
    needsPollen: needsPollen,
    permilleToByte: permilleToByte,
    tempTrendToBytes: tempTrendToBytes,
    LINE_COLORS: LINE_COLORS,
    FILL_COLORS: FILL_COLORS,
    lineColorFor: lineColorFor,
    fillColorFor: fillColorFor
};
