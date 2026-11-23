// src/pkjs/status-bars/adapter/plugin-value-source.js
//
// The value the Plugin value slot shows: one property of one plugin the user picks in the
// slot's dialog (plugin-values.js sourceOf), read from that plugin of the Pebble app. Or one of
// the user's complications in the Pebble app, by its place (complications.js): the reading the
// complication at that place names, read from whichever plugin the Pebble app picks for its
// source. The value's key names that reading after the complication's own, so a change of the
// complication in the Pebble app is another key: the old reading's value is dropped and the new
// one is read at once (complication-list.js calls complicationsChanged when the list changes).
//
// Read once at a time, when the slot's Updates setting and the plugin's own word say
// (domain/plugin-value-reads.js); picking a source reads at once. How a read goes, and what is
// kept of it, is every plugin read's (plugin-read-schedule.js). The source is the schedule's
// key: a source picked in place of another forgets the old one's read and value.
//
// Only while it is wanted: a source is picked and a bar the watch is sent shows the slot
// (status-lines.js wantsPluginValue). A bake shows the value only for the source it was read
// from, and drops it once it is too old (plugin-values.js shownReading). The settings page gets
// it only while it is of what the settings pick, and of the reading a complication's place
// names now (forPage).
//
// ES5 only (aplite's JavaScriptCore): var + function, and never *construct* a Promise.

var KEYS = require('../../settings/domain/storage-keys.js');
var statusLines = require('../domain/status-lines.js');
var pluginValues = require('../domain/plugin-values.js');
var pluginValueReads = require('../domain/plugin-value-reads.js');
var complications = require('../domain/complications.js');
var pluginReadSchedule = require('./plugin-read-schedule.js');
var pluginReader = require('./plugin-reader.js');

// What this app declares, as the Pebble app keys it (plugin-reads.js declaredKeys): a read never
// starts where it would ask the user for another permission (plugin-reader.js permitted).
var permissions = [];
// The user's complications as last heard (complication-list.js current), or null while none
// are known.
var getComplications = function () { return null; };

/**
 * What the slot reads for a complication: the reading the complication at its place names, under
 * a key that names that reading after the complication's own (plugin-values.js readFrom).
 * @param {Object} source The source the settings pick (plugin-values.js sourceOf), a
 *   complication's.
 * @param {?Array<Object>} list The user's complications as last heard, or null while none are
 *   known.
 * @returns {?{key: string, request: ?Object}} What is wanted: no request for a place left
 *   empty, which shows nothing; null while the complications are not known.
 */
function complicationWant(source, list) {
    var c = complications.atPlace(list, source.complication);
    if (!list) { return null; }
    return c ? { key: source.key + '/' + complications.keyOf(c), request: complications.requestOf(c, permissions) }
        : { key: source.key, request: null };
}

/**
 * What the slot reads for the source the settings pick, whether a bar shows it or not. Nothing
 * of the Preferences plugin's but a complication: its own readings are the user's position and
 * plumbing, which this app never reads (plugin-reads.js neverRead), and a pick of one from
 * before the complications (3.4.0 listed them) shows nothing.
 * @param {Object} source The source (plugin-values.js sourceOf).
 * @param {?Array<Object>} list The user's complications as last heard, or null while none are
 *   known.
 * @returns {?{key: string, request: ?Object}} What is wanted (complicationWant's for a
 *   complication); no request for one of the Preferences plugin's own readings.
 */
function readOf(source, list) {
    if (source.complication !== null) { return complicationWant(source, list); }
    if (source.plugin.toLowerCase() === pluginValues.PREFERENCES) { return { key: source.key, request: null }; }
    return { key: source.key, request: { category: source.category, item: source.item,
        properties: [source.property], plugin: source.plugin, limit: 1, permissions: permissions } };
}

var schedule = pluginReadSchedule.create({
    name: 'plugin-value',
    recordKey: KEYS.PLUGIN_VALUE_READ,
    valueKey: KEYS.PLUGIN_VALUE,
    // Until when the plugin said its last answer holds: its own word on when it has something new.
    timeField: 'validUntil',
    wanted: function (settings, watchInfo) {
        // The source first: it alone rules out most settings, without working out the bars.
        var source = pluginValues.sourceOf(settings);
        if (!source || !statusLines.wantsPluginValue(settings, watchInfo)) { return null; }
        return readOf(source, getComplications());
    },
    nextReadAt: function (record, settings) {
        return pluginValueReads.nextReadAt(record, pluginValues.everyMs(settings));
    },
    heard: function (envelope, want, nowMs) {
        var until = pluginReader.validUntilOf(envelope);
        // Checked as a stored value is, once: valueOf.
        return { time: until, value: pluginValueReads.valueOf({ source: want.key,
            reading: pluginReader.readingOf(envelope, want.request.properties[0], want.request.instance),
            at: nowMs, validUntil: until }) };
    },
    valueOf: pluginValueReads.valueOf,
    shown: pluginValues.shownReading,
    sameShown: pluginValueReads.sameReading
});

/**
 * The Plugin value slot's facts a status-line bake reads (status-lines.js PluginValueFacts):
 * whether this Pebble app reads plugins, and the function that reads the value last heard.
 * The bake asks for the value only when a bar it bakes shows the slot.
 *
 * @returns {{available: boolean, value: function(): ?Object}}
 */
function bakeFacts() {
    return { available: schedule.available(), value: schedule.value };
}

/**
 * The value last heard, for the settings page (userData.pluginValue): only while it was read
 * from what the settings pick, and for a complication from the reading its place names now, so
 * the page never prints another's as the slot's value, nor one the slot no longer reads. The
 * page judges it against the source its rows pick right then (plugin-values.js shownReading).
 * @param {?Object} settings The settings the page opens on.
 * @param {?Array<Object>} list The user's complications as last heard (complication-list.js
 *   current), or null while none are known.
 * @returns {?Object} The value ({source, reading, at, validUntil}; plugin-value-reads.js
 *   valueOf), or null.
 */
function forPage(settings, list) {
    var source = pluginValues.sourceOf(settings);
    var want = source ? readOf(source, list) : null;
    var value = schedule.value();
    return value && want && want.request && value.source === want.key ? value : null;
}

/**
 * Wire the source up (plugin-read-schedule.js init, which takes the same options). Call once,
 * from the 'ready' handler, after statusRebake.init() and complication-list.js' init.
 * @param {Object} options Injected environment: the schedule's, and these.
 * @param {string[]} [options.permissions] What this app declares (plugin-reads.js
 *   declaredKeys; default none: a source that names a permission is then never read).
 * @param {function(): ?Array<Object>} [options.getComplications] The user's complications as
 *   last heard (complication-list.js current; default: none known).
 * @returns {void}
 */
function init(options) {
    permissions = options && Array.isArray(options.permissions) ? options.permissions : [];
    getComplications = options && typeof options.getComplications === 'function' ? options.getComplications
        : function () { return null; };
    schedule.init(options);
}

module.exports = {
    init: init,
    // Per-minute hook, driven by the channel scheduler's 60 s tick: reads the value again once
    // the next read is due.
    onTick: schedule.onTick,
    // The settings were saved: a source just picked is read at once.
    refresh: schedule.refresh,
    // The user's complications changed (complication-list.js): the reading the slot's place
    // names now is read at once, as a tick reads (outside the Night battery saver's window).
    complicationsChanged: schedule.onTick,
    bakeFacts: bakeFacts,
    forPage: forPage
};
