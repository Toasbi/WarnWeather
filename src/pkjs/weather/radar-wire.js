// src/pkjs/weather/radar-wire.js
//
// Single source of truth for the rain-radar wire invariant shared by every
// radar source (DWD, Met.no, Rainbow, Tomorrow.io) and the dedupe comparator:
// the 24-slot, 5-min-per-slot frame layout, the slot-0 pinning rule, and the
// wire-tuple shapes (a window, the clear, the limit notice). Previously the
// constants were re-declared per source, each guarded only by a "must match"
// comment, and the {TREND, AREA, START} triple was hand-assembled at five call
// sites.

var zeroFilledArray = require('../wire-units.js').zeroFilledArray;

var NUM_BARS = 24;           // 24 frames * 5 min = 120 min of nowcast
var SLOT_SECONDS = 5 * 60;   // wire-side slot width; equals RADAR_SLOT_SECONDS on the watch

/**
 * Pin a wall-clock time (ms) to the most recent 5-min slot boundary and return
 * it as epoch seconds. This is the watch's "5-min pinned" slot-0 epoch, echoed
 * on the wire as RAIN_RADAR_START.
 *
 * @param {number} nowMs Wall-clock time in milliseconds (e.g. Date.now()).
 * @returns {number} Slot-0 epoch seconds, a multiple of SLOT_SECONDS.
 */
function slotZeroEpochFor(nowMs) {
    return Math.floor(nowMs / 1000 / SLOT_SECONDS) * SLOT_SECONDS;
}

/**
 * Radar tuples that clear any existing radar on the watch (empty trend arrays +
 * zero start). Matches the legacy base-provider "send [] to clear" behavior so
 * disabling radar removes it from the watch.
 *
 * @returns {{RAIN_RADAR_TREND_UINT8: number[], RAIN_RADAR_TREND_AREA_UINT8: number[], RAIN_RADAR_START: number}}
 */
function clearRadarTuples() {
    return { RAIN_RADAR_TREND_UINT8: [], RAIN_RADAR_TREND_AREA_UINT8: [], RAIN_RADAR_START: 0 };
}

/**
 * Whether a radar answer is the CLEAR above (empty trend array): radar switched
 * off, or a source that can never answer (no key/endpoint, rejected key, a
 * missing Rainbow proxy).
 *
 * @param {?Object} tuples Radar tuples, or null/undefined (no answer).
 * @returns {boolean} True for the clearing tuples.
 */
function isClearRadarTuples(tuples) {
    return Boolean(tuples) && Array.isArray(tuples.RAIN_RADAR_TREND_UINT8)
        && tuples.RAIN_RADAR_TREND_UINT8.length === 0;
}

/**
 * The LIMITED answer: the radar source is up but refuses us because a request
 * limit is reached (HTTP 429). Neither a window nor a clear: the watch keeps
 * its window and, where that window shows no rain, says "Radar limit reached"
 * instead of the no-rain line. It rides ALONE, never together with the three
 * radar arrays (which end the notice on the watch), so it never makes the
 * heaviest weather bundle heavier (test/inbox-size.test.js).
 *
 * @returns {{RAIN_RADAR_LIMITED: number}} The limit notice tuple.
 */
function limitedRadarTuples() {
    return { RAIN_RADAR_LIMITED: 1 };
}

/**
 * Whether a radar answer is the LIMITED one above. Reads the key rather than
 * comparing the whole object: the answer that reaches the fetch cycle may carry
 * the sky rows too (radar-sky.js joinRadarAndSky merges them in).
 *
 * @param {?Object} tuples Radar tuples, or null/undefined (no answer).
 * @returns {boolean} True for the limit notice; never for a window or a clear.
 */
function isLimitedRadarTuples(tuples) {
    return Boolean(tuples) && tuples.RAIN_RADAR_LIMITED === 1
        && !Array.isArray(tuples.RAIN_RADAR_TREND_UINT8);
}

/**
 * Wire tuples for a POINT-SOURCE product (Met.no, Rainbow, Tomorrow.io): the
 * mapped trend bytes plus an always-zero area array — single-point nowcasts
 * have no "nearby" composite. DWD is the one source with a real area array
 * and builds its triple itself.
 *
 * @param {number[]} trendBytes 24-entry uint8 trend array.
 * @param {number} startEpoch Frame-0 epoch seconds (the product's own, or the
 *   pinned slot-0 epoch when the API honors the requested start).
 * @returns {{RAIN_RADAR_TREND_UINT8: number[], RAIN_RADAR_TREND_AREA_UINT8: number[], RAIN_RADAR_START: number}}
 */
function pointRadarTuples(trendBytes, startEpoch) {
    return {
        RAIN_RADAR_TREND_UINT8: trendBytes,
        RAIN_RADAR_TREND_AREA_UINT8: zeroFilledArray(NUM_BARS),
        RAIN_RADAR_START: startEpoch
    };
}

/**
 * OUT-OF-COVERAGE tuples: a flat 24-zero signal anchored at a real slot-0
 * epoch — "there is radar service and it sees no rain here" as far as the
 * watch renders it. NOT clearRadarTuples() above, whose empty arrays + zero
 * start REMOVE the radar from the watch entirely (radar switched off).
 *
 * @param {number} slotZeroEpoch The 5-min pinned slot-0 epoch.
 * @returns {{RAIN_RADAR_TREND_UINT8: number[], RAIN_RADAR_TREND_AREA_UINT8: number[], RAIN_RADAR_START: number}}
 */
function flatRadarTuples(slotZeroEpoch) {
    return pointRadarTuples(zeroFilledArray(NUM_BARS), slotZeroEpoch);
}

module.exports = {
    NUM_BARS: NUM_BARS,
    SLOT_SECONDS: SLOT_SECONDS,
    slotZeroEpochFor: slotZeroEpochFor,
    clearRadarTuples: clearRadarTuples,
    isClearRadarTuples: isClearRadarTuples,
    limitedRadarTuples: limitedRadarTuples,
    isLimitedRadarTuples: isLimitedRadarTuples,
    pointRadarTuples: pointRadarTuples,
    flatRadarTuples: flatRadarTuples
};
