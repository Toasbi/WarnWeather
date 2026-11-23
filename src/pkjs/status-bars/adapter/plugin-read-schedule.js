// src/pkjs/status-bars/adapter/plugin-read-schedule.js
//
// When a value is read from another app's plugin, for each slot that shows one: the watch
// battery's days left, Muninn's estimate (battery-estimate.js), and the Plugin value slot's
// value (plugin-value-source.js). Each makes a schedule from its own rules (a PluginReadSpec);
// what they share is here, once.
//
// Nothing stays subscribed: the Pebble app would run the plugin's script again at every
// refresh interval for as long as anything were, and each run brings back the permissions that
// app asked for and the user has not answered, as a notification on the phone and on the
// watch (plugin-reader.js). So a value is read once at a time, when its reader's rhythm says
// (the spec's nextReadAt), and only while it is wanted: the spec wants it, and this Pebble app
// reads plugins at all.
//   - The record of the last read (plugin-reads.js recordOf) is stamped as the read starts, so
//     a read that PKJS ends before the answer still counts, and kept in storage, so neither a
//     PKJS restart nor a settings save reads again before the next is due. A save after the
//     first read that failed does: no value has come for what the user picked, and they are at
//     the phone, waiting to see it. Only after the first: each read runs the other app's script,
//     so a plugin that fails again waits for its reader's wait, however often the settings are
//     saved. A record that storage refuses still counts for the rest of this PKJS life.
//   - Not wanted: nothing is read, and the record is forgotten, so the value wanted again is
//     read at once. Another key wanted (another source picked): the record and the value heard
//     of the old key are forgotten, and the new key is read at once.
//   - One read at a time. An answer that comes after what is wanted changed is dropped, and
//     the save that changed it, which that read held up, reads then.
//   - A clock that went back starts the wait again from now (plugin-reads.js clockWentBack).
//   - Inside the Night battery saver's window only a read that a settings save asks for, with
//     none before it or after the first that failed, goes ahead: the user is at the phone, waiting to
//     see the value. Any other waits for the first tick after the window. The window keeps the
//     watch's link quiet, and a read is not quiet: a permission the plugin's app asked for comes
//     back to the watch with it.
//   - A plugin that is not there is an answer of nothing, and the value kept is dropped. Any
//     other failure keeps it, and the reader's nextReadAt tries again sooner (plugin-reads.js
//     retryWait). A read a save asked for that failed for a reason that can pass by the next
//     minute (the plugin did not answer in time, or failed without saying why: plugin-reads.js
//     passing) is read again at the next tick, once: the user waits at the phone.
//
// The value last heard is kept in storage, so a bake after a PKJS restart shows it at once,
// and here, which is what a bake reads. When what the slot shows of it changes, with a new
// value or with the time (a value grown too old, which only a bake drops), the watch is owed a
// status send, which the re-bake's next tick makes: within a minute, after the Night battery
// saver's window, and not beside a fetch in flight (status-rebake.js oweStatus). The answer to
// a read a save asked for is paid two seconds after it comes, inside the window too: the user
// waits for it at the phone (status-rebake.js paySoon). A start owes one as well while the
// slot shows a value kept, since a debt dies with its PKJS: whether the watch got the value is
// not known then, and the outbox sends nothing when it has. The value is never logged: it is
// another app's data.
//
// ES5 only (aplite's JavaScriptCore): var + function, and never *construct* a Promise.

var statusRebake = require('../application/status-rebake.js');
var pluginReads = require('../domain/plugin-reads.js');
var batterySaver = require('../../wire/domain/battery-saver.js');
var pluginReader = require('./plugin-reader.js');

/**
 * @typedef {Object} PluginReadSpec
 * @property {string} name The reader's name in the log, e.g. 'battery-estimate'.
 * @property {string} recordKey The storage key of the record of the last read.
 * @property {string} valueKey The storage key of the value last heard.
 * @property {string} timeField The time the record keeps beside `at` and `failures`
 *   (plugin-reads.js recordOf), which the reader's nextReadAt works from.
 * @property {function(?Object, ?Object): ?{key: ?string, request: Object}} wanted What to read
 *   under the settings and the watch info: the request (plugin-reader.js PluginRequest) and
 *   its key, which the record keeps (null for a reader that reads one thing only). Null while
 *   nothing is wanted.
 * @property {function(Object, ?Object): number} nextReadAt When the read after a record is
 *   due under the settings, in epoch milliseconds.
 * @property {function(Object, {key: ?string, request: Object}, number): {time: ?number,
 *   value: ?Object}} heard What an answer to the wanted read says, heard at an instant: the time
 *   the record keeps, and the value to keep (as valueOf hands it back), or null for none.
 * @property {function(*): ?Object} valueOf A value as stored (parsed JSON), checked; null for
 *   none.
 * @property {function(?Object, ?Object, number): *} shown What the slot shows of a value under
 *   the settings at an instant; null for nothing.
 * @property {function(*, *): boolean} sameShown Whether two of what shown hands back are the same.
 */

/** The environment before init: no settings, so nothing is wanted. */
var INERT = {
    getSettings: function () { return null; },
    getWatchInfo: function () { return null; },
    now: function () { return Date.now(); }
};

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
 * A reader's schedule.
 * @param {PluginReadSpec} spec The reader's rules.
 * @returns {{init: function(Object): void, onTick: function(): void, refresh: function(): void,
 *   value: function(): ?Object, available: function(): boolean}} init wires it up, onTick and
 *   refresh read when a read is due, value is the value last heard, and available whether this
 *   Pebble app reads plugins.
 */
function create(spec) {
    var deps = INERT;
    var inFlight = false;
    // A read a save asked for failed for a reason that can pass by the next minute
    // (plugin-reads.js passing): the next tick reads again, once, as the save would have.
    var againAtTick = false;
    // The last read ({source, at, failures, <timeField>}), or null for none.
    var record = null;
    // The value last heard (spec.valueOf's), or null for none.
    var value = null;
    // What the slot showed of it at the last look (spec.shown): at init, a keep and each consider.
    var shown = null;

    /**
     * @returns {number} Now, in epoch milliseconds (the injected clock).
     */
    function nowMs() {
        return +deps.now();
    }

    /**
     * @returns {boolean} Whether this Pebble app can read plugins at all.
     */
    function available() {
        return pluginReader.available(pluginReader.pebbleOf(deps));
    }

    /**
     * @returns {?Object} The value last heard (spec.valueOf's), or null for none.
     */
    function lastValue() {
        return value;
    }

    /**
     * Record a read, here and in storage. Writes nothing when the record is the one held.
     * @param {?string} key What it reads (the wanted key).
     * @param {number} at When it started, in epoch milliseconds.
     * @param {number} failures The failed reads in a row it ends with.
     * @param {?number} time The reader's time (spec.timeField), or null for none.
     * @returns {void}
     */
    function stamp(key, at, failures, time) {
        if (record && record.source === key && record.at === at && record.failures === failures
                && record[spec.timeField] === time) {
            return;
        }
        record = { source: key, at: at, failures: failures };
        record[spec.timeField] = time;
        try {
            localStorage.setItem(spec.recordKey, JSON.stringify(record));
        }
        catch (ex) {
            console.log(spec.name + ': the time of the read was not stored.');
        }
    }

    /**
     * Forget the last read, so the next read comes at once, and the read again it was owed.
     * Writes nothing when there is nothing to forget.
     * @returns {void}
     */
    function forget() {
        againAtTick = false;
        if (record === null) { return; }
        record = null;
        localStorage.removeItem(spec.recordKey);
    }

    /**
     * Keep a value (or none), and tell the watch when that changes what its slot shows.
     * @param {?Object} next The value heard (as spec.valueOf hands it back), or null for none.
     * @param {boolean} waitedFor Whether a settings save asked for the read it came from
     *   (status-rebake.js oweStatus).
     * @returns {void}
     */
    function keep(next, waitedFor) {
        var settings = deps.getSettings();
        var at = nowMs();
        var before = spec.shown(value, settings, at);
        var after = spec.shown(next, settings, at);
        shown = after;
        // The value kept, heard again (Muninn's estimate until its next wakeup): nothing to write.
        if (JSON.stringify(next) !== JSON.stringify(value)) {
            value = next;
            try {
                if (next) { localStorage.setItem(spec.valueKey, JSON.stringify(next)); }
                else { localStorage.removeItem(spec.valueKey); }
            }
            catch (ex) {
                console.log(spec.name + ': the value was not stored.');
            }
        }
        if (spec.sameShown(before, after)) { return; }
        console.log(spec.name + ': ' + (after === null ? 'nothing to show' : 'a new value to show') + '.');
        // Never sent from here. The plugin answers at any moment, right after a settings save or a
        // boot among them, while their own messages are on the channel. Those bake the value just
        // kept where it came in time; the re-bake sends what is left, a moment later when the user
        // waits for it at the phone, else at its next tick.
        statusRebake.oweStatus(waitedFor);
    }

    /**
     * Ask the plugin, once.
     * @param {{key: ?string, request: Object}} want What is wanted (spec.wanted).
     * @param {number} at Now, in epoch milliseconds.
     * @param {boolean} fromSave Whether a settings save asked for it, or for the read before
     *   it that this one reads again (againAtTick).
     * @returns {void}
     */
    function read(want, at, fromSave) {
        var failures = record ? record.failures : 0;
        var time = record ? record[spec.timeField] : null;
        // The read again a save's failed read earned (againAtTick) earns none of its own: when it
        // fails as well, the reader's wait after a failure stands.
        var again = againAtTick;
        inFlight = true;
        againAtTick = false;
        // Stamped before the plugin answers: a read that PKJS ends before the answer still counts,
        // or leaving the watchface and coming back every few seconds would read at every start.
        stamp(want.key, at, failures, time);
        pluginReader.readOnce(pluginReader.pebbleOf(deps), want.request, function (envelope, fail) {
            var heard;
            inFlight = false;
            // The record is gone, or another key's, when what is wanted changed while the plugin
            // answered: the answer is no longer the slot's. Only a save changes it, and this read
            // held that save's read up: it goes now, as from the save.
            if (!record || record.source !== want.key) {
                consider(true);
                return;
            }
            if (fail && fail.code !== 'PLUGIN_UNAVAILABLE') {
                console.log(spec.name + ': the plugin did not answer (' + fail.code + ').');
                stamp(want.key, at, failures + 1, time);
                againAtTick = fromSave && !again && pluginReads.passing(fail.code);
                return;
            }
            if (fail) {
                console.log(spec.name + ': the plugin is not there.');
                stamp(want.key, at, 0, null);
                keep(null, fromSave);
                return;
            }
            heard = spec.heard(envelope, want, nowMs());
            stamp(want.key, at, 0, heard.time);
            keep(heard.value, fromSave);
        }, deps.timers);
    }

    /**
     * Read when a read is due, and only while the value is wanted. The one step behind a start,
     * a tick and a settings save.
     * @param {boolean} fromSave Whether the settings were just saved. Only then does a read with
     *   none before it, or after the first one that failed, go ahead before it is due and inside
     *   the Night battery saver's window.
     * @returns {void}
     */
    function consider(fromSave) {
        var settings = deps.getSettings();
        var want = available() ? spec.wanted(settings, deps.getWatchInfo()) : null;
        var at;
        var now;
        var asked;
        if (!want) {
            forget();
            return;
        }
        // Another key: what was heard of the old one is no longer the slot's (a bake shows it no
        // more anyway), and the new one is read at once.
        if (record && record.source !== want.key) {
            forget();
            keep(null, false);
        }
        at = nowMs();
        // A bake drops a value grown too old by itself, but only a bake: when what the slot
        // shows changed with the time, the watch is owed the status that shows it. A save sends
        // its own.
        now = spec.shown(value, settings, at);
        if (!fromSave && !spec.sameShown(shown, now)) { statusRebake.oweStatus(false); }
        shown = now;
        if (inFlight) { return; }
        if (record && pluginReads.clockWentBack(record, at)) {
            stamp(record.source, at, record.failures, record[spec.timeField]);
            return;
        }
        // A save asks for a read when there is none before it, or after the first one that
        // failed (the header says why only then), and so does the read again a save's failed
        // read earned (againAtTick; another key forgot it above). Neither the wait after a
        // failure nor the Night battery saver's window holds it.
        asked = againAtTick || (fromSave && (!record || record.failures === 1));
        if (record && !asked && at < spec.nextReadAt(record, settings)) { return; }
        if (!asked && batterySaver.isWithinSleepWindow(new Date(at), settings)) { return; }
        read(want, at, fromSave || againAtTick);
    }

    /**
     * Wire the schedule up. Call once, from the 'ready' handler, after statusRebake.init().
     * Re-calling resets all its state, which is what the tests rely on. Reads at once only
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
            throw new Error(spec.name + ': init needs getSettings, getWatchInfo and now');
        }
        deps = options;
        inFlight = false;
        againAtTick = false;
        record = pluginReads.recordOf(stored(spec.recordKey), spec.timeField);
        value = spec.valueOf(stored(spec.valueKey));
        // Not known: what the last PKJS owed the watch died with it. The first look owes a send
        // while the slot shows the value kept.
        shown = null;
        consider(false);
    }

    return {
        init: init,
        onTick: function () { consider(false); },
        refresh: function () { consider(true); },
        value: lastValue,
        available: available
    };
}

module.exports = { create: create };
