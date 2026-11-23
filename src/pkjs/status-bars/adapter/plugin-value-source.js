// src/pkjs/status-bars/adapter/plugin-value-source.js
//
// The value the Plugin value slot shows: one property of one plugin the user picks in the
// slot's dialog (plugin-values.js sourceOf), read from that plugin of the Pebble app.
//
// Read once at a time, when the slot's Updates setting and the plugin's own word say
// (domain/plugin-value-reads.js); picking a source reads at once. How a read goes, and what is
// kept of it, is every plugin read's (plugin-read-schedule.js). The source is the schedule's
// key: a source picked in place of another forgets the old one's read and value.
//
// Only while it is wanted: a source is picked and a bar the watch is sent shows the slot
// (status-lines.js wantsPluginValue). A bake shows the value only for the source it was read
// from, and drops it once it is too old (plugin-values.js shownReading).
//
// ES5 only (aplite's JavaScriptCore): var + function, and never *construct* a Promise.

var KEYS = require('../../settings/domain/storage-keys.js');
var statusLines = require('../domain/status-lines.js');
var pluginValues = require('../domain/plugin-values.js');
var pluginValueReads = require('../domain/plugin-value-reads.js');
var pluginReadSchedule = require('./plugin-read-schedule.js');
var pluginReader = require('./plugin-reader.js');

var schedule = pluginReadSchedule.create({
    name: 'plugin-value',
    recordKey: KEYS.PLUGIN_VALUE_READ,
    valueKey: KEYS.PLUGIN_VALUE,
    // Until when the plugin said its last answer holds: its own word on when it has something new.
    timeField: 'validUntil',
    wanted: function (settings, watchInfo) {
        // The source first: it alone rules out most settings, without working out the bars.
        var source = pluginValues.sourceOf(settings);
        return source && statusLines.wantsPluginValue(settings, watchInfo) ? {
            key: source.key,
            request: { category: source.category, item: source.item, properties: [source.property],
                plugin: source.plugin, limit: 1 }
        } : null;
    },
    nextReadAt: function (record, settings) {
        return pluginValueReads.nextReadAt(record, pluginValues.everyMs(settings));
    },
    heard: function (envelope, want, nowMs) {
        var until = pluginReader.validUntilOf(envelope);
        // Checked as a stored value is, once: valueOf.
        return { time: until, value: pluginValueReads.valueOf({ source: want.key,
            reading: pluginReader.readingOf(envelope, want.request.properties[0]), at: nowMs,
            validUntil: until }) };
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

module.exports = {
    // Call once, from the 'ready' handler, after statusRebake.init() (plugin-read-schedule.js).
    init: schedule.init,
    // Per-minute hook, driven by the channel scheduler's 60 s tick: reads the value again once
    // the next read is due.
    onTick: schedule.onTick,
    // The settings were saved: a source just picked is read at once.
    refresh: schedule.refresh,
    bakeFacts: bakeFacts,
    // The value last heard ({source, reading, at, validUntil}; plugin-value-reads.js valueOf),
    // or null: what a bake reads, and the settings page's userData.pluginValue, which the page
    // judges against the source its rows pick right then.
    value: schedule.value
};
