// src/pkjs/weather/radar-wire.js
//
// Single source of truth for the rain-radar wire invariant shared by every
// radar source (DWD, Rainbow) and the dedupe comparator: the 24-slot,
// 5-min-per-slot frame layout, the slot-0 pinning rule, and the "clear the
// watch's radar" tuples. Previously these constants were re-declared in
// radar.js, rainbow-radar.js and radar-dedupe.js, each guarded only by a
// "must match" comment.

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

module.exports = {
    NUM_BARS: NUM_BARS,
    SLOT_SECONDS: SLOT_SECONDS,
    slotZeroEpochFor: slotZeroEpochFor,
    clearRadarTuples: clearRadarTuples
};
