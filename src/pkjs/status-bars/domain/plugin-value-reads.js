// src/pkjs/status-bars/domain/plugin-value-reads.js
//
// The Plugin value slot's reads: when the value is read from its plugin again, and the value a
// read keeps. The reading, the record of the last read this works from and the keeping are
// plugin-value-source.js'; the record's shape and the waits after a failure are every plugin
// read's (plugin-reads.js).
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

/**
 * The most characters of a text a value keeps (a reading's short text, long text and unit):
 * more than the widest slot prints, and the value kept rides the settings page's URL
 * (userData.pluginValue).
 */
var MAX_TEXT = 64;

/**
 * @param {*} v A text field.
 * @returns {?string} It, when it is a text, cut to MAX_TEXT characters (never between the two
 *   halves of a character outside the BMP); null for none.
 */
function keptText(v) {
    var cut = typeof v === 'string' && v ? v.slice(0, MAX_TEXT) : null;
    return cut && /[\ud800-\udbff]$/.test(cut) ? cut.slice(0, -1) || null : cut;
}

/**
 * A value as kept, checked: the source it was read from (plugin-values.js sourceOf's key), its
 * reading (plugin-reader.js readingOf), when it was read and until when the plugin said it
 * holds. Its texts are cut to MAX_TEXT characters.
 * @param {*} value What was stored (parsed JSON), or a value just read.
 * @returns {?{source: string, reading: Object, at: number, validUntil: ?number}} The value,
 *   or null when it is none.
 */
function valueOf(value) {
    var r = value && value.reading;
    if (!value || typeof value.source !== 'string' || !r || typeof r !== 'object'
            || typeof value.at !== 'number' || !isFinite(value.at) || value.at <= 0) {
        return null;
    }
    var reading = { short: keptText(r.short), long: keptText(r.long), unit: keptText(r.unit),
        number: typeof r.number === 'number' && isFinite(r.number) ? r.number : null };
    if (reading.short === null && reading.number === null && reading.long === null) { return null; }
    return { source: value.source, reading: reading, at: value.at,
        validUntil: typeof value.validUntil === 'number' && isFinite(value.validUntil)
            && value.validUntil > 0 ? value.validUntil : null };
}

/**
 * @param {?Object} a A reading (plugin-reader.js readingOf, or valueOf's), or null.
 * @param {?Object} b Another, or null.
 * @returns {boolean} Whether the two say the same, field by field: a reading's fields come in
 *   another order once it has been through storage.
 */
function sameReading(a, b) {
    if (!a || !b) { return !a && !b; }
    return a.short === b.short && a.number === b.number && a.unit === b.unit && a.long === b.long;
}

module.exports = {
    MAX_TEXT: MAX_TEXT,
    nextReadAt: nextReadAt,
    valueOf: valueOf,
    sameReading: sameReading
};
