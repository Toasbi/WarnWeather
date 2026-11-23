// src/pkjs/status-bars/domain/estimate-reads.js
//
// When the estimate of the days the watch has left is read from Muninn's plugin again. The
// reading is battery-estimate.js'; the record of the last read this works from, and the waits
// after a failure, are every plugin read's (plugin-reads.js).
//
// A read costs the user something. The Pebble app runs Muninn's plugin script for it and
// counts Muninn as a running app while it does, and every permission a running app has asked
// for that the user has not answered comes back then, as a notification on the phone and on
// the watch. Muninn asks for Timeline, to pin the day the watch needs charging. So each
// estimate is read once, soon after Muninn makes it, and not again. Muninn makes one at each
// of its watch app's wakeups, every 6 hours at the same hours of the day, and stamps it with
// the time it made it: the next is due PERIOD_MS later, which makes about four reads a day.
//
// From the record of the last read ({at, failures, made}: when it started, the failed reads
// in a row it ends with, and when Muninn made the estimate it heard):
//   - No record: the days were just switched on, or have not been read yet. Read now.
//   - The last read heard when Muninn made its estimate: read SETTLE_MS after Muninn's next
//     estimate is due. That is PERIOD_MS after the one heard, or whole periods more when the
//     read came after that one's time to be read (Muninn missed a wakeup). A wakeup comes up
//     to ten minutes late when another app's wakeup is due at the same time, and the estimate
//     lands a few seconds after it, so a read between a wakeup and its time to be read that
//     heard the estimate before leaves that wakeup its own read.
//   - It heard no such time (no Muninn, or a Muninn that has made no estimate yet), or one
//     more than a day before it (Muninn has stopped making them), or one far ahead of it (the
//     clock went back): there is no rhythm to follow, so read IDLE_INTERVAL_MS later.
//   - The last read failed (Muninn did not answer): read again an hour later, doubling with
//     each failure in a row up to IDLE_INTERVAL_MS (plugin-reads.js retryWait).
//   - A record later than now (the clock went back): the wait starts again from now, so a
//     clock change never brings a read forward.
//
// The time follows the wakeup, not the PKJS restart that comes after it (Muninn's watch app
// takes the screen for a few seconds, and the watchface starts again when it leaves). A
// restart comes after any other app as well, the one whose wakeup made Muninn's late among
// them, so it is no sign that the estimate is in, and reading at it would make the number of
// reads depend on how often the watchface is left. A start reads only a read that is due
// (battery-estimate.js): that is how a read that came due in another app happens on the
// return to the watchface.
//
// ES5 only (aplite's JavaScriptCore): var + function.

var batteryDays = require('./battery-days.js');
var pluginReads = require('./plugin-reads.js');

var MINUTE_MS = 60 * 1000;
var HOUR_MS = 60 * MINUTE_MS;

/** How far apart Muninn makes its estimates: its watch app wakes every 6 hours. */
var PERIOD_MS = 6 * HOUR_MS;

/**
 * How long after Muninn's estimate is due a read waits for it: its wakeup can come up to ten
 * minutes late, and its phone side writes the estimate a few seconds after that.
 */
var SETTLE_MS = 20 * MINUTE_MS;

/**
 * How long after the last read the next waits when there is no rhythm to follow, and the
 * longest wait after a failure.
 */
var IDLE_INTERVAL_MS = 12 * HOUR_MS;

/**
 * How old the estimate a read heard may be for Muninn to count as still making them: as old
 * as an estimate the slot still shows (battery-days.js MAX_AGE_MS).
 */
var STALE_MS = batteryDays.MAX_AGE_MS;

/**
 * When the next read is due.
 * @param {{at: number, failures: number, made: ?number}} record The last read
 *   (plugin-reads.js recordOf, its time `made`: when Muninn made the estimate it heard).
 * @returns {number} The time of the next read, in epoch milliseconds.
 */
function nextReadAt(record) {
    var made = record.made;
    var periods;
    if (record.failures > 0) {
        return record.at + pluginReads.retryWait(record.failures, IDLE_INTERVAL_MS);
    }
    if (made === null || made > record.at + SETTLE_MS || record.at - made > STALE_MS) {
        return record.at + IDLE_INTERVAL_MS;
    }
    // The first estimate due after the one heard whose read is still to come: at least one
    // period on, since the one heard has been read.
    periods = Math.floor((record.at - made - SETTLE_MS) / PERIOD_MS) + 1;
    return made + Math.max(1, periods) * PERIOD_MS + SETTLE_MS;
}

module.exports = {
    PERIOD_MS: PERIOD_MS,
    SETTLE_MS: SETTLE_MS,
    IDLE_INTERVAL_MS: IDLE_INTERVAL_MS,
    STALE_MS: STALE_MS,
    nextReadAt: nextReadAt
};
