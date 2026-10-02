// src/pkjs/weather/radar-wire.js
//
// Single source of truth for the rain-radar wire invariant shared by every
// radar source (DWD, Met.no, Rainbow, Tomorrow.io) and the dedupe comparator:
// the 24-slot, 5-min-per-slot frame layout, the slot-0 pinning rule, and the
// wire-tuple shapes (a window, the clear, the limit notice, the out-of-coverage
// notice). Previously the constants were re-declared per source, each guarded
// only by a "must match" comment, and the {TREND, AREA, START} triple was
// hand-assembled at five call sites.

var zeroFilledArray = require('../wire-units.js').zeroFilledArray;

var NUM_BARS = 24;           // 24 frames * 5 min = 120 min of nowcast
var SLOT_SECONDS = 5 * 60;   // wire-side slot width; equals RADAR_SLOT_SECONDS on the watch
// The radar's line while a source refuses us over a request limit. The phone writes every
// notice line (the watch carries none of its own): at most 31 UTF-8 bytes, the watch's
// RADAR_NOTICE_BUF_BYTES less its NUL (radar-coverage.js's lines too).
var LIMIT_TEXT = 'Radar limit reached';

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
 * missing Rainbow proxy). The out-of-coverage answer is a clear too, one that
 * carries its notice (isOutOfCoverageRadarTuples).
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
 * its window and, where that window shows no rain, says LIMIT_TEXT ("Radar
 * limit reached", the RAIN_RADAR_LIMITED string) instead of the no-rain line.
 * It rides ALONE, never together with the three radar arrays (which end the
 * notice on the watch), so it never makes the heaviest weather bundle heavier
 * (test/inbox-size.test.js).
 *
 * @returns {{RAIN_RADAR_LIMITED: string}} The limit notice tuple.
 */
function limitedRadarTuples() {
    return { RAIN_RADAR_LIMITED: LIMIT_TEXT };
}

/**
 * Whether a radar answer is the LIMITED one above. Reads the key rather than
 * comparing the whole object: the answer that reaches the fetch cycle may carry
 * the sky rows too (radar-sky.js joinRadarAndSky merges them in). The 1 an older
 * build sent (and may have left in the dedupe cache or the throttle record) counts.
 *
 * @param {?Object} tuples Radar tuples, or null/undefined (no answer).
 * @returns {boolean} True for the limit notice; never for a window or a clear.
 */
function isLimitedRadarTuples(tuples) {
    return Boolean(tuples) && !Array.isArray(tuples.RAIN_RADAR_TREND_UINT8)
        && (tuples.RAIN_RADAR_LIMITED === 1
            || (typeof tuples.RAIN_RADAR_LIMITED === 'string' && tuples.RAIN_RADAR_LIMITED !== ''));
}

/**
 * The OUT-OF-COVERAGE answer: the place lies outside the radar source's area
 * (radar-coverage.js), so it has no rain to report there, now or later. The clear
 * (no window to keep or roll forward) with the source's line as the notice, so the
 * watch's radar says why it is empty instead of "no rain". Lighter than a window
 * (25 B of empty arrays and a zero start, plus the line's tuple, against the
 * window's 73 B), so it never makes the heaviest weather bundle heavier.
 *
 * @param {string} text The radar's line (radar-coverage.js watchText).
 * @returns {{RAIN_RADAR_TREND_UINT8: number[], RAIN_RADAR_TREND_AREA_UINT8: number[],
 *   RAIN_RADAR_START: number, RAIN_RADAR_LIMITED: string}} The tuples.
 */
function outOfCoverageRadarTuples(text) {
    var out = clearRadarTuples();
    out.RAIN_RADAR_LIMITED = text;
    return out;
}

/**
 * Whether a radar answer is the OUT-OF-COVERAGE one above: the clear carrying a line.
 * @param {?Object} tuples Radar tuples, or null/undefined (no answer).
 * @returns {boolean} True for the out-of-coverage answer.
 */
function isOutOfCoverageRadarTuples(tuples) {
    return isClearRadarTuples(tuples) && typeof tuples.RAIN_RADAR_LIMITED === 'string'
        && tuples.RAIN_RADAR_LIMITED !== '';
}

/**
 * What a cycle whose FORECAST failed still forwards of its radar answer: the
 * answers that are no fresh data — the out-of-coverage notice, the clear, the limit
 * notice — each as its own keys only (the answer may carry the sky rows too), so
 * the watch neither rolls a window it should drop nor misses why its radar is
 * empty. A window, or no answer, forwards nothing.
 * @param {?Object} tuples This cycle's radar answer.
 * @returns {?Object} The tuples to forward, or null.
 */
function failureForward(tuples) {
    if (isOutOfCoverageRadarTuples(tuples)) { return outOfCoverageRadarTuples(tuples.RAIN_RADAR_LIMITED); }
    if (isClearRadarTuples(tuples)) { return clearRadarTuples(); }
    if (isLimitedRadarTuples(tuples)) { return limitedRadarTuples(); }
    return null;
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
    LIMIT_TEXT: LIMIT_TEXT,
    slotZeroEpochFor: slotZeroEpochFor,
    clearRadarTuples: clearRadarTuples,
    isClearRadarTuples: isClearRadarTuples,
    limitedRadarTuples: limitedRadarTuples,
    isLimitedRadarTuples: isLimitedRadarTuples,
    outOfCoverageRadarTuples: outOfCoverageRadarTuples,
    isOutOfCoverageRadarTuples: isOutOfCoverageRadarTuples,
    failureForward: failureForward,
    pointRadarTuples: pointRadarTuples,
    flatRadarTuples: flatRadarTuples
};
