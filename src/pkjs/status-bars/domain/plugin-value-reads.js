// src/pkjs/status-bars/domain/plugin-value-reads.js
//
// When the Plugin value slot's value is read from its plugin again. The reading, and the
// record of the last read this works from, are plugin-value-source.js'; the record's shape and
// the waits after a failure are every plugin read's (plugin-reads.js).
//
// A read costs the user something (plugin-reader.js), and only the user knows how fast their
// value changes, so the slot's Updates setting says how often (plugin-values.js everyMs). From
// the record of the last read ({at, failures, validUntil}: when it started, the failed reads in
// a row it ends with, and until when the plugin said its answer holds):
//   - No record: the source was just picked, or has not been read yet. Read now.
//   - The last read was answered: read again after the Updates interval, or once the plugin's
//     answer no longer holds, whichever is later (the plugin's own word on when it has
//     something new), but no more than 12 hours after the last read.
//   - The last read failed: read again an hour later, doubling with each failure in a row, up
//     to the Updates interval.
//   - A record later than now (the clock went back): the wait starts again from now
//     (plugin-reads.js clockWentBack).
//
// ES5 only (aplite's JavaScriptCore): var + function.

var pluginReads = require('./plugin-reads.js');
var pluginValues = require('./plugin-values.js');

/**
 * When the next read is due.
 * @param {{at: number, failures: number, validUntil: ?number}} record The last read
 *   (plugin-reads.js recordOf, its time `validUntil`).
 * @param {number} everyMs How often the value is read (plugin-values.js everyMs).
 * @returns {number} The time of the next read, in epoch milliseconds.
 */
function nextReadAt(record, everyMs) {
    var next = record.at + everyMs;
    if (record.failures > 0) { return record.at + pluginReads.retryWait(record.failures, everyMs); }
    if (record.validUntil !== null && record.validUntil > next) {
        next = Math.min(record.validUntil, record.at + pluginValues.LONGEST_WAIT_MS);
    }
    return next;
}

module.exports = {
    nextReadAt: nextReadAt
};
