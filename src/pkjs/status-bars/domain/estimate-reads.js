// src/pkjs/status-bars/domain/estimate-reads.js
//
// When the estimate of the days the watch has left is read from Muninn's plugin again. The
// reading, and the record of the last read this works from, are battery-estimate.js'.
//
// A read costs the user something. The Pebble app runs Muninn's plugin script for it and
// counts Muninn as a running app while it does, and every permission a running app has asked
// for that the user has not answered comes back then, as a notification on the phone and on
// the watch. Muninn asks for Timeline, to pin the day the watch needs charging. So the
// estimate is read about twice a day, which is about as often as it changes: Muninn makes a
// new one at each of its watch app's wakeups, every 6 hours.
//
// From the record of the last read ({at, failures}) and the estimate held:
//   - No record: the days were just switched on, or have not been read yet. Read now.
//   - The last read was answered (an estimate, none yet, or no Muninn): read again
//     READ_INTERVAL_MS later. When the estimate held was made in the READ_INTERVAL_MS before
//     that read, the next read moves to SETTLE_MS after Muninn's next-but-one estimate
//     (READ_INTERVAL_MS + SETTLE_MS after the one held), though never to less than MIN_GAP_MS
//     after the last read. The watch judges the days from the moment they arrive
//     (status_line.h StatusBatteryDaysMark): an estimate read hours after it was made can
//     predate a charge and still be shown as new, one read minutes after it rarely does.
//   - The last read failed (Muninn did not answer): read again RETRY_MS later, doubling with
//     each failure in a row up to READ_INTERVAL_MS, so a Muninn that keeps failing is not
//     asked every hour.
//   - A record later than now (the clock went back): the wait starts again from now, so a
//     clock change never brings a read forward.
//
// ES5 only (aplite's JavaScriptCore): var + function.

var MINUTE_MS = 60 * 1000;
var HOUR_MS = 60 * MINUTE_MS;

/** How long an answer lasts: the estimate is read about twice a day. */
var READ_INTERVAL_MS = 12 * HOUR_MS;

/**
 * How long after Muninn's estimate is due a read waits for it: its wakeup can come up to ten
 * minutes late, and its phone side writes the estimate a few seconds after that.
 */
var SETTLE_MS = 20 * MINUTE_MS;

/** The least time between two reads after an answer, whatever Muninn's rhythm. */
var MIN_GAP_MS = 10 * HOUR_MS;

/** How long the first read after a failed one waits. Each further failure doubles it. */
var RETRY_MS = HOUR_MS;

/**
 * The record of the last read as stored, checked.
 * @param {*} value What was stored (parsed JSON).
 * @returns {?{at: number, failures: number}} The record, or null when the value is none:
 *   `at` a time after 1970 in epoch milliseconds, `failures` a whole number from 0.
 */
function recordOf(value) {
    var at;
    var failures;
    if (!value || typeof value !== 'object') { return null; }
    at = value.at;
    failures = value.failures;
    if (typeof at !== 'number' || !isFinite(at) || at <= 0) { return null; }
    if (typeof failures !== 'number' || !isFinite(failures) || failures < 0
            || Math.floor(failures) !== failures) {
        return null;
    }
    return { at: at, failures: failures };
}

/**
 * @param {{at: number, failures: number}} record The last read (recordOf).
 * @param {number} nowMs Now, in epoch milliseconds.
 * @returns {boolean} Whether the clock is behind the last read. Its wait then starts again
 *   from now.
 */
function clockWentBack(record, nowMs) {
    return nowMs < record.at;
}

/**
 * @param {number} failures Failed reads in a row, 1 or more.
 * @returns {number} How long the next read waits after the last of them: RETRY_MS, doubled
 *   for each failure after the first, at most READ_INTERVAL_MS.
 */
function retryWait(failures) {
    var wait = RETRY_MS * Math.pow(2, failures - 1);
    return wait < READ_INTERVAL_MS ? wait : READ_INTERVAL_MS;
}

/**
 * When the next read is due.
 * @param {{at: number, failures: number}} record The last read (recordOf).
 * @param {?{days: number, updatedAt: number}} estimate The estimate held (battery-days.js
 *   estimateOf), or null for none.
 * @returns {number} The time of the next read, in epoch milliseconds.
 */
function nextReadAt(record, estimate) {
    var made;
    if (record.failures > 0) { return record.at + retryWait(record.failures); }
    made = estimate ? estimate.updatedAt : null;
    // Muninn made no estimate in the interval before that read: it has stopped making them
    // for now, and there is no rhythm to follow.
    if (made === null || made > record.at || record.at - made >= READ_INTERVAL_MS) {
        return record.at + READ_INTERVAL_MS;
    }
    return Math.max(record.at + MIN_GAP_MS, made + READ_INTERVAL_MS + SETTLE_MS);
}

module.exports = {
    READ_INTERVAL_MS: READ_INTERVAL_MS,
    SETTLE_MS: SETTLE_MS,
    MIN_GAP_MS: MIN_GAP_MS,
    RETRY_MS: RETRY_MS,
    recordOf: recordOf,
    clockWentBack: clockWentBack,
    retryWait: retryWait,
    nextReadAt: nextReadAt
};
