var rainTier = require('./weather/rain-tier');
var COLORS = require('./pebble-colors');

// Metric → line color (0xRRGGBB). Hardcoded per metric (not user-selectable).
var LINE_COLORS = { precip_prob: COLORS.GColorPictonBlue };
// Metric → area-fill color (0xRRGGBB), parallel to LINE_COLORS. Precip is the
// pre-refactor CobaltBlue; the watch handles the B&W (dithered gray) fallback.
var FILL_COLORS = { precip_prob: COLORS.GColorCobaltBlue };

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
 * @param {{precips: number[], rains: number[]}} raw Raw precip % + rain tenths.
 * @param {{secondaryLine: string, secondaryLineFill: boolean, barSource: string}} s Settings.
 * @returns {Object} Wire fields: SECONDARY_LINE_TREND_INT16, SECONDARY_LINE_COLOR,
 *   SECONDARY_LINE_FILL_COLOR, SECONDARY_LINE_FILL, BAR_TREND_INT16.
 */
function buildForecastSeries(raw, s) {
    var out = {};
    if (s.secondaryLine === 'precip_prob') {
        out.SECONDARY_LINE_TREND_INT16 = toInt16Bytes(raw.precips.map(function(p) { return p * 10; })); // %→permille
        out.SECONDARY_LINE_COLOR = LINE_COLORS.precip_prob;
        out.SECONDARY_LINE_FILL_COLOR = FILL_COLORS.precip_prob;
        out.SECONDARY_LINE_FILL = Boolean(s.secondaryLineFill);
    } else {
        out.SECONDARY_LINE_TREND_INT16 = [];
        out.SECONDARY_LINE_COLOR = COLORS.GColorBlack;
        out.SECONDARY_LINE_FILL_COLOR = COLORS.GColorBlack;
        out.SECONDARY_LINE_FILL = false;
    }
    if (s.barSource === 'rain') {
        out.BAR_TREND_INT16 = toInt16Bytes(raw.rains.map(rainTier.rainPermille));
    } else {
        out.BAR_TREND_INT16 = [];
    }
    return out;
}

module.exports = { buildForecastSeries: buildForecastSeries };
