// src/pkjs/status-bars/domain/plugin-reads.js
//
// The record of the last read of another app's plugin, and the waits every such read shares.
// A read costs the user something (plugin-reader.js), so each reader stamps a read when it
// starts, keeps the record in storage and waits before the next. When the next is due is each
// reader's own rhythm: Muninn's estimate follows its wakeups (estimate-reads.js).
//
// A record is {source, at, failures} and one time its reader keeps beside them: what the last
// read read (null for a reader that reads one thing only), when it started, the failed reads in
// a row it ends with, and for Muninn when it made the estimate the read heard
// (plugin-read-schedule.js keeps it).
//
// ES5 only (aplite's JavaScriptCore): var + function.

var HOUR_MS = 60 * 60 * 1000;

/** How long the first read after a failed one waits. Each further failure doubles it. */
var RETRY_MS = HOUR_MS;

/**
 * The failures that can pass by the next minute: the plugin did not answer in time (TIMEOUT:
 * a slow start, or a permission request the user had not answered yet), or failed without
 * saying why (UNKNOWN). Any other would come back: a permission refused, a rate limit, a
 * request the plugin does not take.
 */
var PASSING = ['TIMEOUT', 'UNKNOWN'];

/**
 * @param {*} value A time as a plugin sent it, or as it was stored.
 * @returns {?number} The time, in epoch milliseconds, or null when it is not one (a finite
 *   number after 1970).
 */
function timeOf(value) {
    return typeof value === 'number' && isFinite(value) && value > 0 ? value : null;
}

/**
 * The record of the last read as stored, checked.
 * @param {*} value What was stored (parsed JSON).
 * @param {string} timeField The name of the time its reader keeps beside `at` and `failures`.
 * @returns {?Object} The record, or null when the value is none: `source` a text, null where
 *   it is missing (a reader of one thing, or a record from before it was kept), `at` a time
 *   after 1970 in epoch milliseconds, `failures` a whole number from 0, and the reader's time
 *   under its name, null where it is missing or not a time (a record from before it was kept).
 */
function recordOf(value, timeField) {
    var failures;
    var record;
    if (!value || typeof value !== 'object' || timeOf(value.at) === null) { return null; }
    failures = value.failures;
    if (typeof failures !== 'number' || !isFinite(failures) || failures < 0
            || Math.floor(failures) !== failures) {
        return null;
    }
    record = { source: typeof value.source === 'string' ? value.source : null, at: value.at,
        failures: failures };
    record[timeField] = timeOf(value[timeField]);
    return record;
}

/**
 * @param {{at: number}} record The last read (recordOf).
 * @param {number} nowMs Now, in epoch milliseconds.
 * @returns {boolean} Whether the clock is behind the last read. Its wait then starts again
 *   from now, so a clock change never brings a read forward.
 */
function clockWentBack(record, nowMs) {
    return nowMs < record.at;
}

/**
 * @param {number} failures Failed reads in a row, 1 or more.
 * @param {number} longestMs The longest wait.
 * @returns {number} How long the next read waits after the last of them: RETRY_MS, doubled
 *   for each failure after the first, at most longestMs.
 */
function retryWait(failures, longestMs) {
    var wait = RETRY_MS * Math.pow(2, failures - 1);
    return wait < longestMs ? wait : longestMs;
}

/**
 * @param {string} code A failed read's code (plugin-reader.js failure).
 * @returns {boolean} Whether the failure can pass by the next minute (PASSING), so a read the
 *   user waits for is worth trying again then.
 */
function passing(code) {
    return PASSING.indexOf(code) !== -1;
}

module.exports = {
    RETRY_MS: RETRY_MS,
    timeOf: timeOf,
    recordOf: recordOf,
    clockWentBack: clockWentBack,
    retryWait: retryWait,
    passing: passing
};
