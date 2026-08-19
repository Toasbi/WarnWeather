var rainTier = require('./weather/rain-tier');
var lineStyle = require('./line-style.js');   // LINE_COLORS/FILL_COLORS + the resolved line styling
var statusLines = require('./status-lines.js');
var statusCatalog = require('./status-line-catalog.js');
var pressurePlausibility = require('./weather/pressure-plausibility.js');

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

// LINE_COLORS / FILL_COLORS, lineColorFor() and fillColorFor() now live in
// line-style.js -- the graph's line styling is derived from settings alone, so it
// belongs on the Clay settings message rather than on every weather send. They stay
// re-exported below so existing consumers (settings/preview-palette.js) keep working.

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
// to a non-zero byte (round(2/4) === 1; round(1/4) === 0).
var BAND_FLOOR_PERMILLE = 2;

// WIRE INVARIANT — byte 0 is a sentinel, not a value.
//
// chart.c's dot renderer skips any sample at or below the layer's floor
// ("if (l->values[i] <= l->lo) continue;", chart.c:224) because a mark sitting on
// the x-axis "reads as data where there is none". With lo = 0 that makes wire byte
// 0 mean ABSENT, so a metric may only emit it where zero genuinely means "nothing".
//
// That splits the metrics in two:
//
//   ZERO-BASED  (precip_prob, wind, gust, uv) — scaled 0..max against a fixed
//     ceiling. A zero is a real, meaningful zero (no rain, no wind), and skipping
//     its dot is the DESIRED rendering. These must NOT be floored.
//
//   BAND-SCALED (pressure, feels) — scaled against a band whose floor is just the
//     lowest value on the plot, not a physical zero. Their minimum sample is a real
//     reading that has to render, so it must be floated off byte 0.
//
// Both go through metricBytes() below, which is the ONLY place a permille series
// becomes wire bytes. Adding a metric here rather than hand-clamping inside its
// own permille function is what stops this from recurring — see the
// "no band-scaled metric ever emits wire byte 0" test.
var BAND_SCALED_METRICS = ['pressure', 'feels'];

/**
 * Whether a metric is scaled against a value band (floor = lowest reading) rather
 * than a physical zero. See BAND_SCALED_METRICS.
 * @param {string} metric Metric code.
 * @returns {boolean} True for band-scaled metrics.
 */
function isBandScaledMetric(metric) {
    return BAND_SCALED_METRICS.indexOf(metric) !== -1;
}

/**
 * The single permille -> wire-bytes conversion for a metric line. Applies the
 * byte-0 floor for band-scaled metrics and leaves zero-based metrics alone, so the
 * wire invariant above holds for every metric by construction.
 * @param {string} metric Metric code.
 * @param {number[]|null} permille Permille series, or null for an unknown metric.
 * @returns {number[]} Wire bytes (0..250).
 */
function metricBytes(metric, permille) {
    if (!permille) { return []; }
    var floorPm = isBandScaledMetric(metric) ? BAND_FLOOR_PERMILLE : 0;
    return permille.map(function (pm) {
        return permilleToByte(pm < floorPm ? floorPm : pm);
    });
}

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
 * A reading at or below the band floor is real data, not "no data": pressure is in
 * BAND_SCALED_METRICS, so metricBytes() floats it off wire byte 0 on the way out.
 * (This used to be clamped here by hand; the shared gate covers feels-like too.)
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
        return curvePermille(Number(reading), curve);
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
    // Whole degrees, widening outward: a fractional edge (Steadman output, fixture
    // data) must still cover both series after truncation.
    return { min: Math.floor(min), max: Math.ceil(max) };
}

// How far the feels curve keeps clear of the plot's inset edge, in permille of the
// plot band (40 ‰ ≈ wire byte 10), whenever it ranges beyond the temperature.
var FEELS_EDGE_CLEARANCE_PERMILLE = 40;

/**
 * Widen the joint band on whichever side the FEELS series overshoots the temperature,
 * so that curve lands clear of the plot edge instead of flat against it.
 *
 * The clearance has to come from the band, not from the curve inset: the watch maps
 * every line's bytes 0..250 over the same inset plot band, so two series are
 * pixel-aligned only while they share BOTH a band and an inset — and the inset rides
 * the Clay (settings) message, which cannot know how far today's feels-like ran from
 * today's temperature. Padding the band is the same visual effect (more empty plot
 * between the curve and the edge) computed where the weather data actually is.
 *
 * Only the overshooting side is padded. Where the TEMPERATURE defines the extreme,
 * its curve is supposed to reach the inset edge — that edge is what the hi/lo labels
 * name, and the temp curve is a solid line, which the watch never skips.
 *
 * @param {{min: number, max: number}} tempBand Actual temperature band.
 * @param {{min: number, max: number}} jointBand Union of tempBand and the feels series.
 * @returns {{min: number, max: number}} Joint band padded away from the overshot edges.
 */
function padJointBandForFeels(tempBand, jointBand) {
    var below = tempBand.min - jointBand.min;   // feels reaches below the temp low
    var above = jointBand.max - tempBand.max;   // feels reaches above the temp high
    var span = jointBand.max - jointBand.min;
    if (span <= 0 || (below <= 0 && above <= 0)) { return jointBand; }
    // pad / (span + pad) = clearance  ->  pad = span * c / (1000 - c). Rounded up, and
    // at least 1 whole degree so a narrow band still visibly clears the edge. (Padding
    // both sides dilutes each to ~1000c/(1000+c) ‰ — still ~38 ‰, ~byte 10.)
    var pad = Math.max(1, Math.ceil(
        span * FEELS_EDGE_CLEARANCE_PERMILLE / (1000 - FEELS_EDGE_CLEARANCE_PERMILLE)));
    return {
        min: below > 0 ? jointBand.min - pad : jointBand.min,
        max: above > 0 ? jointBand.max + pad : jointBand.max
    };
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
 * The third line is always dashed and never filled.
 *
 * Values only: the lines' COLOURS (and the fill flag) are settings-derived, so they
 * ride the Clay settings message instead — see line-style.js and clay-payload.js's
 * CLAY_LINE_STYLE_UINT8. That leaves nothing here that depends on the watch's
 * platform, which is why this no longer takes watchInfo.
 *
 * @param {{precips:number[], rains:number[], winds:number[], gusts:number[], uvs:number[], pressures:number[], feels:number[], tempBand:Object}} raw Raw series (+ the temp axis band the feels metric shares).
 * @param {{secondaryLine:string, thirdLine:string, windScale:string, barSource:string}} settings Settings.
 * @returns {Object} Wire fields (see module interface).
 */
function buildForecastSeries(raw, settings) {
    var out = {};

    // Secondary line: always present (one of the four metrics).
    var secMetric = settings.secondaryLine;
    var secPm = metricPermille(secMetric, raw, settings);
    out.SECONDARY_LINE_TREND_UINT8 = metricBytes(secMetric, secPm);

    // Third line: optional; off, or a metric distinct from the secondary one.
    var thirdMetric = settings.thirdLine;
    var thirdPm = (thirdMetric && thirdMetric !== 'off' && thirdMetric !== secMetric)
        ? metricPermille(thirdMetric, raw, settings) : null;
    out.THIRD_LINE_TREND_UINT8 = metricBytes(thirdMetric, thirdPm);

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
 * @param {Object} watchInfo getActiveWatchInfo() result, or null/undefined; threaded
 *   through to the status-line bake for its platform env (the series themselves are
 *   platform-independent now that the line styling rides the Clay message).
 * @returns {Object} The same payload, raw keys removed and wire keys set.
 */
function applyForecastSeries(payload, settings, watchInfo) {
    // Bake the packed status lines while the transient trend arrays are
    // still on the payload (they die a few lines below).
    statusLines.buildStatusLines(payload, settings, watchInfo);
    // Joint temp∪feels axis. Two curves only read as one graph if they share a
    // scaling band AND a pixel inset — the watch maps every line's bytes 0..250 over
    // the same inset plot band, and the phone cannot compute anything finer because
    // it never learns the plot's pixel height. So with feels selected the temp bytes
    // are re-encoded against the joint band (getPayload baked them against temp's own
    // band, without settings in hand; the whole degrees round-trip exactly — see
    // tempsFromBytes) and feelsPermille maps feels against that same band via
    // raw.tempBand below.
    //
    // TEMP_MIN/TEMP_MAX are NOT the scaling band: the watch scales purely from the
    // bytes (forecast_layer.c passes lo=0, hi=250) and reads these two only to print
    // the hi/lo labels (text_labels_refresh). So they keep carrying the ACTUAL air
    // temperature range — a "lo" of 52 on a day whose air never dropped below 60
    // would be a plain lie, however honest it is about the plot's floor. The feels
    // curve's own extremes are unlabelled, which is what the grey shadow line means.
    //
    // Feels not selected, or FEELS_TREND absent/empty (provider gap): untouched and
    // byte-identical to a build without the feature.
    var feels = feelsLineSelected(settings) ? (payload.FEELS_TREND || []) : [];
    var tempBand = (typeof payload.TEMP_MIN === 'number' && typeof payload.TEMP_MAX === 'number')
        ? { min: payload.TEMP_MIN, max: payload.TEMP_MAX } : null;
    if (feels.length && tempBand && payload.TEMP_TREND_UINT8 && payload.TEMP_TREND_UINT8.length) {
        var jointBand = padJointBandForFeels(tempBand,
            jointTempFeelsBand(tempBand.min, tempBand.max, feels));
        payload.TEMP_TREND_UINT8 = tempTrendToBytes(
            tempsFromBytes(payload.TEMP_TREND_UINT8, tempBand.min, tempBand.max),
            jointBand
        ).bytes;
        // The scaling band the metric channels must share; TEMP_MIN/TEMP_MAX stay put.
        tempBand = jointBand;
    }
    var series = buildForecastSeries(
        { precips: payload.PRECIP_TREND_UINT8, rains: payload.RAIN_TREND_UINT8,
          winds: payload.WIND_TREND_UINT8, gusts: payload.GUST_TREND_UINT8,
          uvs: payload.UV_TREND_UINT8, pressures: payload.PRESSURE_TREND,
          feels: feels, tempBand: tempBand },
        settings
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
    delete payload.DEW_TREND;         // transient PKJS-only; baked into the dew slot's text, never wired
    delete payload.WIND_DIR_TREND;    // transient PKJS-only; baked into the wind/gust arrow sentinel, never wired
    // Values only — the line colours and the fill flag ride the Clay settings
    // message now (CLAY_LINE_STYLE_UINT8), so the weather send carries no styling.
    payload.SECONDARY_LINE_TREND_UINT8 = series.SECONDARY_LINE_TREND_UINT8;
    payload.THIRD_LINE_TREND_UINT8 = series.THIRD_LINE_TREND_UINT8;
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
    // Re-exported from line-style.js, which owns them now: settings/preview-palette.js
    // and the colour tests read them through this module.
    LINE_COLORS: lineStyle.LINE_COLORS,
    FILL_COLORS: lineStyle.FILL_COLORS,
    PRESSURE_SCALE_CURVE_HPA: PRESSURE_SCALE_CURVE_HPA,
    lineColorFor: lineStyle.lineColorFor,
    fillColorFor: lineStyle.fillColorFor,
    isBandScaledMetric: isBandScaledMetric,
    BAND_SCALED_METRICS: BAND_SCALED_METRICS
};
