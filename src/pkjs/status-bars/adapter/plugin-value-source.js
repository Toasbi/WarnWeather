// src/pkjs/status-bars/adapter/plugin-value-source.js
//
// The value the Plugin value slot shows: one property of one plugin the user picks in the
// slot's dialog (plugin-values.js sourceOf), read from that plugin of the Pebble app.
//
// It follows battery-estimate.js, the watch battery's days left read from Muninn's plugin.
// Nothing here stays subscribed: the Pebble app would run the plugin's script again at every
// refresh interval for as long as anything were, and each run brings back the permissions
// that app asked for and the user has not answered, as a notification on the phone and on
// the watch (plugin-reader.js). So the value is read once at a time, when the slot's Updates
// setting and the plugin's own word say (domain/plugin-value-reads.js). The last read is kept
// in storage, so neither a PKJS restart nor a settings save reads again before the next is
// due; picking a source reads at once. Inside the Night battery saver's window only that read
// goes ahead; any other waits for the first tick after it.
//
// Only while it is wanted: a source is picked and a bar the watch is sent shows the slot
// (status-lines.js wantsPluginValue). Otherwise this module reads nothing and sends nothing,
// and forgets when it last read, so the slot shown again reads at once.
//
// What it heard last is kept in storage, so a bake after a PKJS restart shows the value at
// once. A bake shows it only for the source it was read from, and drops it once it is too old
// (plugin-values.js shownReading), so nothing here has to expire it. When a new value changes
// what the slot shows, the watch is owed a status send, which the re-bake's next tick makes:
// within a minute, after the Night battery saver's window, and not beside a fetch in flight
// (status-rebake.js oweStatus). The value is never logged: it is another app's data.
//
// ES5 only (aplite's JavaScriptCore): var + function, and never *construct* a Promise.

var KEYS = require('../../settings/domain/storage-keys.js');
var statusRebake = require('../application/status-rebake.js');
var statusLines = require('../domain/status-lines.js');
var pluginValues = require('../domain/plugin-values.js');
var pluginValueReads = require('../domain/plugin-value-reads.js');
var pluginValueList = require('../domain/plugin-value-list.js');
var pluginReads = require('../domain/plugin-reads.js');
var batterySaver = require('../../wire/domain/battery-saver.js');
var pluginReader = require('./plugin-reader.js');

// The injected environment (init). Before it, the module is inert: no settings, so
// nothing is wanted.
var deps = {
    getSettings: function () { return null; },
    getWatchInfo: function () { return null; },
    now: function () { return Date.now(); }
};
var inFlight = false;     // a read is under way
// The last read ({source, at, failures, validUntil}; plugin-reads.js recordOf and the source
// it read), or null for none: read from storage at init and kept here as it is written, so a
// write that storage refuses still counts for the rest of this PKJS life.
var record = null;

/**
 * @returns {number} Now, in epoch milliseconds (the injected clock).
 */
function nowMs() {
    return +deps.now();
}

/**
 * @param {string} key A storage key.
 * @returns {*} What is stored under it, parsed, or null for none or what does not parse.
 */
function stored(key) {
    var raw = localStorage.getItem(key);
    if (raw === null) { return null; }
    try {
        return JSON.parse(raw);
    }
    catch (ex) {
        return null;
    }
}

/**
 * The source the settings pick, while the slot is wanted: a source is picked, this Pebble
 * app can read plugins at all, and a bar this watch is sent shows the slot.
 * @returns {?Object} The source (plugin-values.js sourceOf), or null while it is not wanted.
 */
function wantedSource() {
    var settings = deps.getSettings();
    var source = settings ? pluginValues.sourceOf(settings) : null;
    return source && pluginReader.available(pluginReader.pebbleOf(deps))
        && statusLines.wantsPluginValue(settings, deps.getWatchInfo()) ? source : null;
}

/**
 * @returns {?Object} The value last heard, as stored (plugin-value-reads.js valueOf), or null.
 */
function readValue() {
    return pluginValueReads.valueOf(stored(KEYS.PLUGIN_VALUE));
}

/**
 * The record of the last read, as stored.
 * @returns {?{source: string, at: number, failures: number, validUntil: ?number}} The record,
 *   or null when there is none or what is stored is unreadable.
 */
function storedRecord() {
    var raw = stored(KEYS.PLUGIN_VALUE_READ);
    var rec = pluginReads.recordOf(raw, 'validUntil');
    if (rec) { rec.source = typeof raw.source === 'string' ? raw.source : ''; }
    return rec;
}

/**
 * Record a read, here and in storage. Writes nothing when the record is the one held.
 * @param {string} source The source it reads (plugin-values.js sourceOf's key).
 * @param {number} at When it started, in epoch milliseconds.
 * @param {number} failures The failed reads in a row it ends with.
 * @param {?number} validUntil Until when the plugin said its last answer holds, or null.
 * @returns {void}
 */
function stamp(source, at, failures, validUntil) {
    if (record && record.source === source && record.at === at && record.failures === failures
            && record.validUntil === validUntil) {
        return;
    }
    record = { source: source, at: at, failures: failures, validUntil: validUntil };
    try {
        localStorage.setItem(KEYS.PLUGIN_VALUE_READ, JSON.stringify(record));
    }
    catch (ex) {
        console.log('plugin-value: the time of the read was not stored.');
    }
}

/**
 * Forget the last read: the slot is not wanted, or its source changed, and the next time it
 * is wanted it is read at once. Writes nothing when there is nothing to forget.
 * @returns {void}
 */
function forget() {
    if (record === null) { return; }
    record = null;
    localStorage.removeItem(KEYS.PLUGIN_VALUE_READ);
}

/**
 * Keep a value (or none), and tell the watch when that changes what its slot shows.
 * @param {?Object} value The value heard ({source, reading, at, validUntil}), or null.
 * @returns {void}
 */
function keep(value) {
    var settings = deps.getSettings();
    var at = nowMs();
    var before = pluginValues.shownReading(readValue(), settings, at);
    var after = pluginValues.shownReading(value, settings, at);
    if (value) {
        localStorage.setItem(KEYS.PLUGIN_VALUE, JSON.stringify(value));
    } else {
        localStorage.removeItem(KEYS.PLUGIN_VALUE);
    }
    if (pluginValueReads.sameReading(before, after)) { return; }
    console.log('plugin-value: ' + (after ? 'a new value' : 'no value') + '.');
    // Never sent from here. The plugin answers at any moment, right after a settings save or a
    // boot among them, while their own messages are on the channel. Those bake the value just
    // kept where it came in time; the re-bake's next tick sends what is left.
    statusRebake.oweStatus();
}

/**
 * Ask the plugin for the value, once.
 *
 * A plugin that is not installed, or that no longer serves the source, answers as one that is
 * not there: the value kept is dropped and the slot shows '--', and the next read waits the
 * Updates interval, as after any answer. Any other failure keeps what was heard last, which a
 * bake drops by itself once it is too old, and is tried again sooner (plugin-reads.js
 * retryWait). An answer while the settings pick another source is dropped.
 *
 * @param {Object} source The source (plugin-values.js sourceOf).
 * @param {number} at Now, in epoch milliseconds.
 * @returns {void}
 */
function read(source, at) {
    var failures = record ? record.failures : 0;
    var validUntil = record ? record.validUntil : null;
    var request = { category: source.category, item: source.item, properties: [source.property],
        plugin: source.plugin, limit: 1 };
    inFlight = true;
    // Stamped before the plugin answers: a read that PKJS ends before the answer still counts,
    // or leaving the watchface and coming back every few seconds would read at every start.
    stamp(source.key, at, failures, validUntil);
    pluginReader.readOnce(pluginReader.pebbleOf(deps), request, function (envelope, fail) {
        var settings = deps.getSettings();
        var current = settings ? pluginValues.sourceOf(settings) : null;
        var reading;
        var until;
        inFlight = false;
        // record is null, or another source's, when the slot was switched off or given another
        // source while the plugin answered: the answer is no longer the slot's.
        if (!current || current.key !== source.key || !record || record.source !== source.key) { return; }
        if (fail && fail.code !== 'PLUGIN_UNAVAILABLE') {
            console.log('plugin-value: the plugin did not answer (' + fail.code + ').');
            stamp(source.key, at, failures + 1, validUntil);
            return;
        }
        if (fail) {
            console.log('plugin-value: the plugin is not there.');
            stamp(source.key, at, 0, null);
            keep(null);
            return;
        }
        until = pluginReader.validUntilOf(envelope);
        stamp(source.key, at, 0, until);
        reading = pluginReader.readingOf(envelope, source.property);
        // Kept as valueOf checks it: its texts cut to what a value keeps.
        keep(reading ? pluginValueReads.valueOf({ source: source.key, reading: reading, at: nowMs(), validUntil: until })
            : null);
    }, deps.timers);
}

/**
 * @param {number} at Now, in epoch milliseconds.
 * @returns {boolean} Whether the Night battery saver's window is open (battery-saver.js).
 */
function saverWindowOpen(at) {
    return batterySaver.isWithinSleepWindow(new Date(at), deps.getSettings());
}

/**
 * Read the value when a read is due (plugin-value-reads.js), and only while the slot is
 * wanted. The one step behind a start, a tick and a settings save.
 *
 * @param {boolean} fromSave Whether the settings were just saved. Only then does a read with
 *   none before it, a source just picked, go ahead inside the Night battery saver's window:
 *   the user is at the phone, waiting to see the value.
 * @returns {void}
 */
function consider(fromSave) {
    var source = wantedSource();
    var kept;
    var at;
    if (!source) {
        forget();
        return;
    }
    // A new source: what was heard of the old one is no longer the slot's, and the new one is
    // read at once. The bake shows no value of another source anyway (shownReading).
    if (record && record.source !== source.key) { forget(); }
    kept = readValue();
    if (kept && kept.source !== source.key) { localStorage.removeItem(KEYS.PLUGIN_VALUE); }
    if (inFlight) { return; }
    at = nowMs();
    if (record && pluginReads.clockWentBack(record, at)) {
        stamp(record.source, at, record.failures, record.validUntil);
        return;
    }
    if (record && at < pluginValueReads.nextReadAt(record, pluginValues.everyMs(deps.getSettings()))) {
        return;
    }
    // The window keeps the watch's link quiet, and a read is not quiet: a permission the plugin's
    // app asked for comes back to the watch with it.
    if ((record || !fromSave) && saverWindowOpen(at)) { return; }
    read(source, at);
}

/**
 * The Plugin value slot's facts a status-line bake reads (status-lines.js PluginValueFacts):
 * whether this Pebble app reads plugins, and the function that reads the value last heard.
 * The bake asks for the value only when a bar it bakes shows the slot.
 *
 * @returns {{available: boolean, value: function(): ?Object}}
 */
function bakeFacts() {
    return { available: pluginReader.available(pluginReader.pebbleOf(deps)), value: readValue };
}

/**
 * The value last heard, for the settings page (userData.pluginValue): the Plugin value
 * dialog's last value and the bars' pictures. The page judges it against the source its rows
 * pick right then, as a bake does (plugin-values.js shownReading), so it is handed over whole,
 * whichever source it was read from.
 *
 * @returns {?{source: string, reading: Object, at: number, validUntil: ?number}} The value
 *   (plugin-value-reads.js valueOf), or null for none.
 */
function forPage() {
    return readValue();
}

/**
 * The plugins on the phone with a value the slot can show, for the settings page's dialog
 * (userData.plugins; plugin-value-list.js listOf). Listing them runs no plugin.
 *
 * @param {string[]} permissions The permissions this app declares (package.json
 *   usesPermissions' names): a source that asks its reader for another is left out.
 * @param {string} ownUuid This app's uuid: its own plugin is left out.
 * @returns {Array<Object>} The list (plugin-value-list.js listOf).
 */
function pluginsForPage(permissions, ownUuid) {
    return pluginValueList.listOf(pluginReader.plugins(pluginReader.pebbleOf(deps)), permissions, ownUuid);
}

/**
 * The settings were saved: a source just picked is read at once. A save that leaves it as it
 * was reads nothing before the next read is due.
 *
 * @returns {void}
 */
function refresh() {
    consider(true);
}

/**
 * Per-minute hook, driven by the channel scheduler's 60 s tick: reads the value again once
 * the next read is due.
 *
 * @returns {void}
 */
function onTick() {
    consider(false);
}

/**
 * Wire the module up. Call once, from the 'ready' handler, after statusRebake.init().
 * Re-calling resets all module state, which is what the tests rely on. Reads at once only
 * when a read is due: a PKJS start by itself is no reason to.
 *
 * @param {Object} options Injected environment.
 * @param {function():Object} options.getSettings Current Clay settings supplier.
 * @param {function():?Object} options.getWatchInfo Pebble.getActiveWatchInfo() result supplier.
 * @param {function():(Date|number)} options.now Clock.
 * @param {Object} [options.pebble] The Pebble object to read plugins through (default: the
 *   global one, if any).
 * @param {Object} [options.timers] {setTimeout, clearTimeout, timeoutMs} for the read
 *   (plugin-reader.js readOnce; tests).
 * @returns {void}
 */
function init(options) {
    if (!options || typeof options.getSettings !== 'function'
            || typeof options.getWatchInfo !== 'function' || typeof options.now !== 'function') {
        throw new Error('plugin-value-source: init needs getSettings, getWatchInfo and now');
    }
    deps = options;
    inFlight = false;
    record = storedRecord();
    consider(false);
}

module.exports = {
    init: init,
    onTick: onTick,
    refresh: refresh,
    bakeFacts: bakeFacts,
    forPage: forPage,
    pluginsForPage: pluginsForPage
};
