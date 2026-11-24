// src/pkjs/status-bars/domain/plugin-value-reads.js
//
// The Plugin value slot's reads: when the value is read from its plugin again, and the value a
// read keeps. The reading, the record of the last read this works from and the keeping are
// plugin-value-source.js'; the record's shape and the waits after a failure are every plugin
// read's (plugin-reads.js). A reading's fields, and the shapes of a property they are read
// from, are one table here (FIELDS): the reader reads by it (plugin-reader.js readingOf), a
// value keeps by it (valueOf, sameReading) and the dialog lists a property by its shapes
// (SHAPES, plugin-value-list.js).
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

var utf8 = require('../../lib/utf8.js');
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
    if (record.failures > 0) { return record.at + pluginReads.retryWait(record.failures, everyMs); }
    return pluginValues.heldUntil(record.at, everyMs, record.validUntil);
}

/**
 * The most bytes of a text a value keeps (a reading's short text, long text and unit): more
 * than the widest slot prints, and the value kept rides the settings page's URL
 * (userData.pluginValue).
 */
var MAX_TEXT = 64;

/**
 * A reading's fields (plugin-reader.js PluginReading), in the order the slot prints them
 * (plugin-values.js textFor): each with the shape of the property it is read from, the part of
 * that shape (its text, its value, or the number's unit), and what a value keeps of it
 * (valueOf: a text, a moment, a number or a state). The unit is the number's (`of`): it brings
 * nothing by itself.
 */
var FIELDS = [
    { name: 'short', shape: 'shortText', part: 'text', kept: 'text' },
    { name: 'time', shape: 'timestamp', part: 'value', kept: 'moment' },
    { name: 'number', shape: 'numericValue', part: 'value', kept: 'number' },
    { name: 'unit', shape: 'numericValue', part: 'unit', kept: 'text', of: 'number' },
    { name: 'state', shape: 'boolean', part: 'value', kept: 'state' },
    { name: 'long', shape: 'longText', part: 'text', kept: 'text' }
];

/** The shapes the slot prints, each once (FIELDS): a property needs one of them to be listed. */
var SHAPES = FIELDS.map(function (f) { return f.shape; }).filter(function (shape, i, all) {
    return all.indexOf(shape) === i;
});

/**
 * The numbers a moment can be, in epoch seconds and in epoch milliseconds: 10 digits of
 * seconds or 13 of milliseconds, from September 2001 to the year 2286. A number of 11 or 12
 * digits would be centuries ahead in seconds or in the 1970s in milliseconds, so it is none.
 */
var SECONDS_FROM = 1e9;
var SECONDS_TO = 1e10;
var MS_FROM = 1e12;
var MS_TO = 1e13;

/**
 * @param {*} v A number that may be a moment: a timestamp's epoch seconds as a plugin sends
 *   it, a number in epoch seconds or milliseconds, or the epoch milliseconds a value keeps.
 * @returns {?number} The moment in epoch milliseconds, or null when the number is none
 *   (SECONDS_FROM..MS_TO): seconds and milliseconds are told apart by their size.
 */
function epochMs(v) {
    if (typeof v !== 'number' || !isFinite(v)) { return null; }
    if (v >= SECONDS_FROM && v < SECONDS_TO) { return Math.round(v * 1000); }
    return v >= MS_FROM && v < MS_TO ? v : null;
}

/**
 * @param {string} name A property's name.
 * @returns {boolean} Whether the name says the property holds a moment: it ends in At or Time
 *   after a small letter or a digit (updatedAt, startTime), or in _at or _time after a letter
 *   or a digit, in any case (updated_at, START_TIME). Not a name that only ends in those
 *   letters (format, uptime, runtime), nor one of them alone.
 */
function namesMoment(name) {
    return /[a-z0-9](?:At|Time)$/.test(name) || /[a-z0-9]_(?:at|time)$/i.test(name);
}

/**
 * The property a value was read from: the last part of its source, which names it last
 * (plugin-values.js valueId: 'category/item/property', after the plugin's uuid).
 * @param {string} source A value's source (plugin-values.js sourceOf's key).
 * @returns {string} The property's name.
 */
function propertyOf(source) {
    return source.slice(source.lastIndexOf('/') + 1);
}

/**
 * When a reading's moment is: its timestamp, or its number where the property's name says it
 * holds a moment (namesMoment) and the number is one in epoch seconds or milliseconds
 * (epochMs). Muninn's updatedAt is such a number, in epoch milliseconds. A plugin that sends a
 * timestamp sends it for the watch to show in the user's clock format.
 * @param {Object} r A reading as a plugin sent it or as it was stored.
 * @param {string} property The property it is of.
 * @returns {?number} The moment in epoch milliseconds, or null for none.
 */
function momentOf(r, property) {
    var time = epochMs(r.time);
    return time !== null ? time : namesMoment(property) ? epochMs(r.number) : null;
}

/**
 * @param {*} v A text field, as a plugin sent it or as it was stored.
 * @returns {?string} It, when it is a text, trimmed and cut to MAX_TEXT bytes at a character's
 *   edge; null for none.
 */
function keptText(v) {
    var text = typeof v === 'string' ? v.replace(/^\s+|\s+$/g, '') : '';
    return text ? utf8.truncateToByteCap(text, MAX_TEXT).str : null;
}

/**
 * What a value keeps of one of its reading's fields (FIELDS).
 * @param {Object} f The field.
 * @param {Object} r The reading as a plugin sent it or as it was stored.
 * @param {string} property The property it is of.
 * @returns {*} The text trimmed and cut to MAX_TEXT bytes (keptText), the moment in epoch
 *   milliseconds (momentOf), the number a finite one, the state a boolean; null for none.
 */
function keptField(f, r, property) {
    var v = r[f.name];
    if (f.kept === 'moment') { return momentOf(r, property); }
    if (f.kept === 'number') { return typeof v === 'number' && isFinite(v) ? v : null; }
    if (f.kept === 'state') { return typeof v === 'boolean' ? v : null; }
    return keptText(v);
}

/**
 * A value as kept, checked: where a plugin's answer and storage come in, once. The source it
 * was read from (plugin-values.js sourceOf's key); its reading (plugin-reader.js readingOf),
 * each field as a value keeps it (keptField), null for each it lacks; when it was read; and
 * until when the plugin said it holds (plugin-reads.js timeOf). A value kept before a number
 * named as a moment was read as one gets its moment here too.
 * @param {*} value What was stored (parsed JSON), or a value just read.
 * @returns {?{source: string, reading: Object, at: number, validUntil: ?number}} The value,
 *   or null when it is none: no reading that brings a text, a moment, a number or a state.
 */
function valueOf(value) {
    var r = value && value.reading;
    var at = pluginReads.timeOf(value && value.at);
    var reading = {};
    if (!value || typeof value.source !== 'string' || !r || typeof r !== 'object' || at === null) {
        return null;
    }
    FIELDS.forEach(function (f) { reading[f.name] = keptField(f, r, propertyOf(value.source)); });
    if (!FIELDS.some(function (f) { return !f.of && reading[f.name] !== null; })) {
        return null;
    }
    return { source: value.source, reading: reading, at: at, validUntil: pluginReads.timeOf(value.validUntil) };
}

/**
 * @param {?Object} a A reading (valueOf's), or null.
 * @param {?Object} b Another, or null.
 * @returns {boolean} Whether the two say the same, field by field (FIELDS): a reading's fields
 *   come in another order once it has been through storage.
 */
function sameReading(a, b) {
    if (!a || !b) { return !a && !b; }
    return FIELDS.every(function (f) { return a[f.name] === b[f.name]; });
}

module.exports = {
    MAX_TEXT: MAX_TEXT,
    FIELDS: FIELDS,
    SHAPES: SHAPES,
    epochMs: epochMs,
    namesMoment: namesMoment,
    nextReadAt: nextReadAt,
    valueOf: valueOf,
    sameReading: sameReading
};
