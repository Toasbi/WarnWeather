var rainTier = require('./weather/rain-tier');
var COLORS = require('./pebble-colors');

// Metric → line color (0xRRGGBB). Hardcoded per metric (not user-selectable).
var LINE_COLORS = { precip_prob: COLORS.GColorPictonBlue, wind: COLORS.GColorYellow };
// Metric → area-fill color (0xRRGGBB), parallel to LINE_COLORS. Precip is the
// pre-refactor CobaltBlue; the watch handles the B&W (dithered gray) fallback.
// (Wind is never filled, so it has no FILL_COLORS entry.)
var FILL_COLORS = { precip_prob: COLORS.GColorCobaltBlue };

// windScale → km/h ceiling at the top of the graph. Single source of truth; the
// watch only ever sees the resulting permille series, never the raw km/h.
var WIND_SCALE_KMH = { low: 30, mid: 50, high: 70 };

/**
 * Serialize an int16 value array to a little-endian byte array. sendAppMessage
 * packs plain arrays as uint8 (0..255), so permille trends (which exceed 255)
 * must be sent as bytes — same convention as TEMP_TREND_INT16 in getPayload.
 * @param {number[]} arr Int16 values.
 * @returns {number[]} Little-endian bytes (empty in → empty out).
 */
function toInt16Bytes(arr) {
    return Array.prototype.slice.call(new Uint8Array(new Int16Array(arr).buffer));
}

/**
 * Map raw provider series + settings to the render-ready forecast wire fields.
 * The watch draws whatever series + colors it is handed; PKJS owns which metric
 * feeds the line vs the bars. Trends are returned as int16 LE byte arrays ready
 * for sendAppMessage; an off/disabled element is an empty array.
 * @param {{precips: number[], rains: number[], winds: number[]}} raw Raw precip %, rain tenths, wind km/h.
 * @param {{secondaryLine: string, secondaryLineFill: boolean, barSource: string, windScale: string}} settings Settings.
 * @returns {Object} Wire fields: SECONDARY_LINE_TREND_INT16, SECONDARY_LINE_COLOR,
 *   SECONDARY_LINE_FILL_COLOR, SECONDARY_LINE_FILL, BAR_TREND_INT16.
 */
function buildForecastSeries(raw, settings) {
    var out = {};
    if (settings.secondaryLine === 'precip_prob') {
        out.SECONDARY_LINE_TREND_INT16 = toInt16Bytes(raw.precips.map(function(p) { return p * 10; })); // %→permille
        out.SECONDARY_LINE_COLOR = LINE_COLORS.precip_prob;
        out.SECONDARY_LINE_FILL_COLOR = FILL_COLORS.precip_prob;
        out.SECONDARY_LINE_FILL = Boolean(settings.secondaryLineFill);
    } else if (settings.secondaryLine === 'wind') {
        var max = WIND_SCALE_KMH[settings.windScale] || WIND_SCALE_KMH.mid; // km/h ceiling
        out.SECONDARY_LINE_TREND_INT16 = toInt16Bytes((raw.winds || []).map(function(kmh) {
            var permille = Math.round((Number(kmh) || 0) / max * 1000);
            if (permille < 0) { permille = 0; }
            if (permille > 1000) { permille = 1000; }   // clamp to the top of the graph
            return permille;
        }));
        out.SECONDARY_LINE_COLOR = LINE_COLORS.wind;
        out.SECONDARY_LINE_FILL_COLOR = LINE_COLORS.wind;  // unused (fill off); set to the line color
        out.SECONDARY_LINE_FILL = false;                   // wind is always line-only
    } else {
        out.SECONDARY_LINE_TREND_INT16 = [];
        out.SECONDARY_LINE_COLOR = COLORS.GColorBlack;
        out.SECONDARY_LINE_FILL_COLOR = COLORS.GColorBlack;
        out.SECONDARY_LINE_FILL = false;
    }
    if (settings.barSource === 'rain') {
        out.BAR_TREND_INT16 = toInt16Bytes(raw.rains.map(rainTier.rainPermille));
    } else {
        out.BAR_TREND_INT16 = [];
    }
    return out;
}

/**
 * Replace a weather payload's raw precip/rain trend keys with the render-ready
 * secondary-line + bar wire series the watch actually reads. Mutates and returns
 * the payload. Both the live-fetch and fixture send paths call this so the two
 * can't drift — the watch dropped PRECIP_TREND_UINT8/RAIN_TREND_UINT8, so a path
 * that skips this ships a payload that renders temperature-only.
 * @param {Object} payload Weather payload carrying PRECIP_TREND_UINT8 + RAIN_TREND_UINT8 + WIND_TREND_UINT8.
 * @param {{secondaryLine: string, secondaryLineFill: boolean, barSource: string, windScale: string}} settings Clay settings.
 * @returns {Object} The same payload, with the raw keys removed and the five series keys set.
 */
function applyForecastSeries(payload, settings) {
    var series = buildForecastSeries(
        { precips: payload.PRECIP_TREND_UINT8, rains: payload.RAIN_TREND_UINT8, winds: payload.WIND_TREND_UINT8 },
        settings
    );
    delete payload.PRECIP_TREND_UINT8;
    delete payload.RAIN_TREND_UINT8;
    delete payload.WIND_TREND_UINT8;  // transient PKJS-only key; never goes over the wire
    payload.SECONDARY_LINE_TREND_INT16 = series.SECONDARY_LINE_TREND_INT16;
    payload.SECONDARY_LINE_COLOR = series.SECONDARY_LINE_COLOR;
    payload.SECONDARY_LINE_FILL = series.SECONDARY_LINE_FILL;
    payload.SECONDARY_LINE_FILL_COLOR = series.SECONDARY_LINE_FILL_COLOR;
    payload.BAR_TREND_INT16 = series.BAR_TREND_INT16;
    return payload;
}

module.exports = {
    buildForecastSeries: buildForecastSeries,
    applyForecastSeries: applyForecastSeries
};
