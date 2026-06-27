var rainTier = require('./weather/rain-tier');
var COLORS = require('./pebble-colors');

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

// Metric → line stroke color (0xRRGGBB). Hardcoded per metric (not user-selectable).
var LINE_COLORS = {
    precip_prob: COLORS.GColorPictonBlue,
    wind: COLORS.GColorYellow,
    gust: COLORS.GColorWhite,   // white reads most clearly over the night hatch (esp. as dotted 2nd metric)
    uv: COLORS.GColorMagenta
};
// Metric → area-fill color. Only precip fills; everything else falls back to its line color.
var FILL_COLORS = { precip_prob: COLORS.GColorCobaltBlue };

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
 * Fill is precip-only and only on the secondary (solid) line; the third line is
 * always dashed (styled C-side) and never filled.
 * @param {{precips:number[], rains:number[], winds:number[], gusts:number[], uvs:number[]}} raw Raw series.
 * @param {{secondaryLine:string, thirdLine:string, secondaryLineFill:boolean, windScale:string, barSource:string}} settings Settings.
 * @returns {Object} Wire fields (see module interface).
 */
function buildForecastSeries(raw, settings) {
    var out = {};

    // Secondary line: always present (one of the four metrics).
    var secMetric = settings.secondaryLine;
    var secPm = metricPermille(secMetric, raw, settings);
    out.SECONDARY_LINE_TREND_UINT8 = secPm ? secPm.map(permilleToByte) : [];
    out.SECONDARY_LINE_COLOR = LINE_COLORS[secMetric] || COLORS.GColorBlack;
    out.SECONDARY_LINE_FILL = secMetric === 'precip_prob' && Boolean(settings.secondaryLineFill);
    out.SECONDARY_LINE_FILL_COLOR = FILL_COLORS[secMetric] || out.SECONDARY_LINE_COLOR;

    // Third line: optional; off, or a metric distinct from the secondary one.
    var thirdMetric = settings.thirdLine;
    var thirdPm = (thirdMetric && thirdMetric !== 'off' && thirdMetric !== secMetric)
        ? metricPermille(thirdMetric, raw, settings) : null;
    var thirdBytes = thirdPm ? thirdPm.map(permilleToByte) : [];
    out.THIRD_LINE_TREND_UINT8 = thirdBytes;
    if (thirdBytes.length > 0) {
        out.THIRD_LINE_COLOR = LINE_COLORS[thirdMetric] || COLORS.GColorWhite;
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
 * @returns {Object} The same payload, raw keys removed and wire keys set.
 */
function applyForecastSeries(payload, settings) {
    var series = buildForecastSeries(
        { precips: payload.PRECIP_TREND_UINT8, rains: payload.RAIN_TREND_UINT8,
          winds: payload.WIND_TREND_UINT8, gusts: payload.GUST_TREND_UINT8,
          uvs: payload.UV_TREND_UINT8 },
        settings
    );
    delete payload.PRECIP_TREND_UINT8;
    delete payload.RAIN_TREND_UINT8;
    delete payload.WIND_TREND_UINT8;  // transient PKJS-only; never over the wire
    delete payload.GUST_TREND_UINT8;  // transient PKJS-only; never over the wire
    delete payload.UV_TREND_UINT8;    // transient PKJS-only; never over the wire
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
 * Whether UV is on either line (so providers know to fetch UV data).
 * @param {Object} settings Clay settings.
 * @returns {boolean} True iff secondaryLine or thirdLine is 'uv'.
 */
function needsUv(settings) {
    return Boolean(settings) && (settings.secondaryLine === 'uv' || settings.thirdLine === 'uv');
}

module.exports = {
    buildForecastSeries: buildForecastSeries,
    applyForecastSeries: applyForecastSeries,
    needsUv: needsUv,
    permilleToByte: permilleToByte,
    tempTrendToBytes: tempTrendToBytes
};
