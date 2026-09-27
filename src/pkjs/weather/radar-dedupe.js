/**
 * Alignment-aware comparator for the rain-radar category. Unlike the default
 * exact comparator the other categories use, radar frames shift by one 5-min
 * slot each cycle, so a naive compare always reports "changed". This compares
 * the candidate against the last *sent* radar after aligning them in time.
 *
 * Let k = (newStart - oldStart) / SLOT_SECONDS be the slots advanced since the
 * last send. The overlap is old[k..23] vs new[0..overlapCount-1]; the
 * non-overlapping new tail new[overlapCount..23] is the part the watch does not
 * yet hold (it zero-pads those via its own self-advance). We treat the radar as
 * UNCHANGED (skip the send) iff the overlap matches and the tail is dry.
 */

var radarWire = require('./radar-wire.js');
var SLOT_SECONDS = radarWire.SLOT_SECONDS; // shared wire invariant (300 s/slot)
var NUM_BARS = radarWire.NUM_BARS;         // shared wire invariant (24 frames)

/**
 * Decide whether a candidate radar subset differs from the last-sent one.
 *
 * @param {Object} newSubset Candidate subset: {RAIN_RADAR_TREND_UINT8: number[],
 *   RAIN_RADAR_TREND_AREA_UINT8: number[], RAIN_RADAR_START: number}, or the
 *   limit notice {RAIN_RADAR_LIMITED: 1} (radarWire.limitedRadarTuples).
 * @param {Object|null} cachedSubset Last-sent subset in either shape, or null
 *   when nothing was sent yet.
 * @returns {boolean} true when the radar should be sent (changed), false to skip.
 */
function radarComparator(newSubset, cachedSubset) {
    if (!cachedSubset) {
        return true;  // nothing sent yet
    }
    // The limit notice carries no window, so it has nothing to align. A repeat
    // of it is unchanged: a source that stays limited sends it once, not every
    // cycle. After it, any window or clear must go out, even one equal to the
    // window the watch already holds: the arrays are what end the notice there.
    var newLimited = radarWire.isLimitedRadarTuples(newSubset);
    var oldLimited = radarWire.isLimitedRadarTuples(cachedSubset);
    if (newLimited) {
        return !oldLimited;
    }
    if (oldLimited) {
        return true;
    }
    var newExact = newSubset.RAIN_RADAR_TREND_UINT8;
    var newArea = newSubset.RAIN_RADAR_TREND_AREA_UINT8;
    var newStart = newSubset.RAIN_RADAR_START;
    var oldExact = cachedSubset.RAIN_RADAR_TREND_UINT8;
    var oldArea = cachedSubset.RAIN_RADAR_TREND_AREA_UINT8;
    var oldStart = cachedSubset.RAIN_RADAR_START;

    if (!Array.isArray(newExact) || !Array.isArray(newArea)
        || !Array.isArray(oldExact) || !Array.isArray(oldArea)
        || typeof newStart !== 'number' || typeof oldStart !== 'number') {
        return true;  // malformed cache/candidate — resend to be safe
    }
    // The last send was a CLEAR (radarWire.clearRadarTuples: empty arrays,
    // start 0), so the watch holds no window and never self-advances one: a
    // real window must always go out, even an all-dry one. Without this, a
    // dry window after a clear aligns against the epoch-0 cache as "fully
    // rolled, dry tail" and is skipped, stranding the watch with no radar.
    if (oldExact.length === 0 && newExact.length > 0) {
        return true;
    }

    var deltaSec = newStart - oldStart;
    if (deltaSec < 0 || deltaSec % SLOT_SECONDS !== 0) {
        return true;  // clock moved backwards or not on a slot boundary — resend
    }
    var k = deltaSec / SLOT_SECONDS;
    var overlapCount = Math.max(0, NUM_BARS - k);
    var i;

    // Overlap must match for both arrays (new[i] is the same wall-clock slot as old[i+k]).
    for (i = 0; i < overlapCount; i += 1) {
        if (oldExact[i + k] !== newExact[i] || oldArea[i + k] !== newArea[i]) {
            return true;
        }
    }
    // Non-overlapping new tail must be dry in BOTH arrays. DWD guarantees
    // area >= exact (so area alone would suffice there), but point providers
    // (Rainbow) send area ≡ 0 with real data in exact — checking only area
    // would miss freshly-revealed tail rain, skip the send, and let the
    // watch zero-pad the skipped slots (frozen radar, dead rain-countdown).
    for (i = overlapCount; i < NUM_BARS; i += 1) {
        if (newExact[i] !== 0 || newArea[i] !== 0) {
            return true;
        }
    }
    return false;
}

module.exports = { radarComparator: radarComparator };
