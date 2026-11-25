// src/pkjs/status-bars/adapter/plugin-read-schedule.js
//
// When a value is read from another app's plugin, for each slot that shows one: the watch
// battery's days left, Muninn's estimate (battery-estimate.js), and each value the Plugin value
// slots show (plugin-value-source.js, a schedule for each source). Each makes a schedule from its
// own rules (a PluginReadSpec); what they share is here, once.
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
//     read at once. Another key wanted (another reading named at the place of the complication
//     the slots show; another source picked is another schedule's: plugin-value-source.js): the
//     old key's record is forgotten, and the new key is read at once. A value heard of another key than the one wanted is dropped, its record
//     forgotten or not: a bake would show it as the new key's.
//   - One read at a time. An answer that comes after what is wanted changed is dropped, and
//     what changed it, which that read held up, reads then: as from a save where a save did.
//   - A clock that went back starts the wait again from now (plugin-reads.js clockWentBack).
//   - Inside the Night battery saver's window only a read that a settings save asks for, with
//     none before it or after the first that failed, goes ahead, and the read again a read the
//     user waits for earned: the user is at the phone, waiting to see the value. Any other waits
//     for the first tick after the window. The window keeps the watch's link quiet, and a read
//     is not quiet: a permission the plugin's app asked for comes back to the watch with it.
//   - A plugin that is not there is an answer of nothing, and the value kept is dropped; a key
//     with nothing to read under it (the spec's wanted: a request of null) drops it at once,
//     before its next read is due. Any other failure keeps it, and the reader's nextReadAt
//     tries again sooner (plugin-reads.js retryWait). A read a save asked for that failed for a
//     reason that can pass by the next minute (the plugin did not answer in time, or failed
//     without saying why: plugin-reads.js passing) is read again at the next tick, once: the
//     user waits at the phone. So does the first read of another key (renewed): a complication
//     changed in the Pebble app, whose plugin's permission the phone may be asking the user for
//     right then. A start's first read is no change of the user's, and waits the reader's wait.
//
// The value last heard is kept in storage, so a bake after a PKJS restart shows it at once,
// and here, which is what a bake reads. When what the slot shows of it changes, with a new
// value or with the time (a value grown too old, which only a bake drops), the watch is owed a
// status send, which the re-bake's next tick makes: within a minute, after the Night battery
// saver's window, and not beside a fetch in flight (status-rebake.js oweStatus). The answer to
// a read the user waits for (a save's, another key's first, or the read again of either) is
// paid two seconds after it comes, inside the window too (status-rebake.js paySoon). A start
// owes one as well while the slot shows a value kept, since a debt dies with its PKJS: whether
// the watch got the value is not known then, and the outbox sends nothing when it has. The
// value is never logged: it is another app's data.
//
// ES5 only (aplite's JavaScriptCore): var + function, and never *construct* a Promise.

var statusRebake = require('../application/status-rebake.js');
var pluginReads = require('../domain/plugin-reads.js');
var batterySaver = require('../../wire/domain/battery-saver.js');
var pluginReader = require('./plugin-reader.js');

/**
 * @typedef {Object} PluginReadSpec
 * @property {string} name The reader's name in the log, e.g. 'battery-estimate'.
 * @property {StoredPlace} recordAt Where the record of the last read is kept (stored-json.js:
 *   a storage key of its own, at).
 * @property {StoredPlace} valueAt Where the value last heard is kept.
 * @property {string} timeField The time the record keeps beside `at` and `failures`
 *   (plugin-reads.js recordOf), which the reader's nextReadAt works from.
 * @property {function(?Object, ?Object, Object): ?{key: ?string, request: ?Object}} wanted What
 *   to read under the settings and the watch info, with the environment the schedule was handed
 *   (init's options, which a reader may carry its own in): the request (plugin-reader.js
 *   PluginRequest) and its key, which the record keeps (null for a reader that reads one thing
 *   only). Null while nothing is wanted. A request of null wants a key with nothing to read
 *   under it (a complication's place left empty): each read of it is an answer of nothing, at
 *   once.
 * @property {function(Object): number} nextReadAt When the read after a record is due, in
 *   epoch milliseconds.
 * @property {function(Object, {key: ?string, request: Object}, number): {time: ?number,
 *   value: ?Object}} heard What an answer to the wanted read says, heard at an instant: the time
 *   the record keeps, and the value to keep (as valueOf hands it back), or null for none.
 * @property {function(*): ?Object} valueOf A value as stored (parsed JSON), checked; null for
 *   none. A keyed reader's value names the key it was read under as its `source`.
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
 * Check a schedule's environment (init's options, load's): what every reader is handed.
 * @param {*} options The options.
 * @param {string} name The reader's name, for the error.
 * @returns {void}
 * @throws {Error} When one it needs is missing.
 */
function checkOptions(options, name) {
    if (!options || typeof options.getSettings !== 'function'
            || typeof options.getWatchInfo !== 'function' || typeof options.now !== 'function') {
        throw new Error(name + ': init needs getSettings, getWatchInfo and now');
    }
}

/**
 * A reader's schedule.
 * @param {PluginReadSpec} spec The reader's rules.
 * @returns {{init: function(Object): void, load: function(Object): void, onTick: function(): void,
 *   refresh: function(): void, stop: function(): void, value: function(): ?Object}} init wires it
 *   up and takes the first look, load wires it up without one, onTick and refresh read when a
 *   read is due, stop ends its reads and keeps what storage holds, and value is the value last
 *   heard.
 */
function create(spec) {
    var deps = INERT;
    var inFlight = false;
    // A read the user waits for failed for a reason that can pass by the next minute
    // (plugin-reads.js passing): the next tick reads again, once.
    var againAtTick = false;
    // Another key is wanted since the last read started (consider): the next read is the one
    // that change asks for, and the user waits for it as for a save's.
    var renewed = false;
    // A save came while a read was under way (consider): the read it held up is the save's.
    var heldUp = false;
    // The last read ({source, at, failures, <timeField>}), or null for none.
    var record = null;
    // The value last heard (spec.valueOf's), or null for none.
    var value = null;
    // What the slot showed of it at the last look (spec.shown): at init, a keep and each consider.
    var shown = null;
    // Stopped (stop): it reads nothing more, and an answer still under way goes nowhere.
    var stopped = false;

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
        var held = record;
        if (record && record.source === key && record.at === at && record.failures === failures
                && record[spec.timeField] === time) {
            return;
        }
        record = { source: key, at: at, failures: failures };
        record[spec.timeField] = time;
        spec.recordAt.write(record, held, spec.name + ': the time of the read');
    }

    /**
     * Forget the last read, so the next read comes at once, and the read again it was owed.
     * Writes nothing when there is nothing to forget.
     * @returns {void}
     */
    function forget() {
        var held = record;
        againAtTick = false;
        if (record === null) { return; }
        record = null;
        spec.recordAt.write(null, held, spec.name + ': the time of the read');
    }

    /**
     * Keep a value (or none), and tell the watch when that changes what its slot shows.
     * @param {?Object} next The value heard (as spec.valueOf hands it back), or null for none.
     * @param {boolean} waitedFor Whether the user waits for the read it came from (read), so
     *   the status it owes is paid soon (status-rebake.js oweStatus).
     * @returns {void}
     */
    function keep(next, waitedFor) {
        var settings = deps.getSettings();
        var at = nowMs();
        var before = spec.shown(value, settings, at);
        var after = spec.shown(next, settings, at);
        shown = after;
        // The value kept, heard again (Muninn's estimate until its next wakeup): nothing to write.
        if (spec.valueAt.write(next, value, spec.name + ': the value')) { value = next; }
        if (spec.sameShown(before, after)) { return; }
        console.log(spec.name + ': ' + (after === null ? 'nothing to show' : 'a new value to show') + '.');
        // Never sent from here. The plugin answers at any moment, right after a settings save or a
        // boot among them, while their own messages are on the channel. Those bake the value just
        // kept where it came in time; the re-bake sends what is left, a moment later when the user
        // waits for it at the phone, else at its next tick.
        statusRebake.oweStatus(waitedFor);
    }

    /**
     * Ask the plugin, once (a request of null asks nothing: an answer of nothing, at once).
     * @param {{key: ?string, request: ?Object}} want What is wanted (spec.wanted).
     * @param {number} at Now, in epoch milliseconds.
     * @param {boolean} waitedFor Whether the user waits for it at the phone: a settings save
     *   asked for it, it is another key's first (renewed), or it reads such a read again
     *   (againAtTick).
     * @returns {void}
     */
    function read(want, at, waitedFor) {
        var failures = record ? record.failures : 0;
        var time = record ? record[spec.timeField] : null;
        // The read again a failed read earned (againAtTick) earns none of its own: when it fails
        // as well, the reader's wait after a failure stands.
        var again = againAtTick;
        /** An answer of nothing: the read counts, and the value kept goes. */
        function nothingThere() {
            stamp(want.key, at, 0, null);
            keep(null, waitedFor);
        }
        againAtTick = false;
        renewed = false;
        if (!want.request) {
            nothingThere();
            return;
        }
        inFlight = true;
        // Stamped before the plugin answers: a read that PKJS ends before the answer still counts,
        // or leaving the watchface and coming back every few seconds would read at every start.
        stamp(want.key, at, failures, time);
        pluginReader.readOnce(pluginReader.pebbleOf(deps), want.request, function (envelope, fail) {
            var heard;
            var held = heldUp;
            inFlight = false;
            heldUp = false;
            // The record is gone, or another key's, when what is wanted changed while the plugin
            // answered: the answer is no longer the slot's. This read held up the read of what
            // is wanted now: it goes now, as from a save where a save changed it.
            if (!record || record.source !== want.key) {
                consider(held);
                return;
            }
            if (fail && fail.code !== 'PLUGIN_UNAVAILABLE') {
                console.log(spec.name + ': the plugin did not answer (' + fail.code + ').');
                stamp(want.key, at, failures + 1, time);
                againAtTick = waitedFor && !again && pluginReads.passing(fail.code);
                return;
            }
            if (fail) {
                console.log(spec.name + ': the plugin is not there.');
                nothingThere();
                return;
            }
            heard = spec.heard(envelope, want, nowMs());
            stamp(want.key, at, 0, heard.time);
            keep(heard.value, waitedFor);
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
        var settings;
        var want;
        var at;
        var now;
        var asked;
        if (stopped) { return; }
        settings = deps.getSettings();
        want = available() ? spec.wanted(settings, deps.getWatchInfo(), deps) : null;
        if (!want) {
            forget();
            return;
        }
        // Another key: the new one is read at once, as the user's change.
        if (record && record.source !== want.key) {
            forget();
            renewed = true;
        }
        // A value heard of another key is no longer the slot's, whether its record is the old
        // key's or gone (nothing was wanted for a while): a bake would show it as the new one's.
        // Nor is one under a key with nothing to read under it now (a source no longer read).
        if (value && (!want.request || (want.key !== null && value.source !== want.key))) { keep(null, false); }
        at = nowMs();
        // A bake drops a value grown too old by itself, but only a bake: when what the slot
        // shows changed with the time, the watch is owed the status that shows it. A save sends
        // its own.
        now = spec.shown(value, settings, at);
        if (!fromSave && !spec.sameShown(shown, now)) { statusRebake.oweStatus(false); }
        shown = now;
        if (inFlight) {
            heldUp = heldUp || fromSave;
            return;
        }
        if (record && pluginReads.clockWentBack(record, at)) {
            stamp(record.source, at, record.failures, record[spec.timeField]);
            return;
        }
        // A save asks for a read when there is none before it, or after the first one that
        // failed (the header says why only then), and so does the read again a failed read
        // earned (againAtTick; another key forgot it above). Neither the wait after a
        // failure nor the Night battery saver's window holds it.
        asked = againAtTick || (fromSave && (!record || record.failures === 1));
        if (record && !asked && at < spec.nextReadAt(record)) { return; }
        if (!asked && batterySaver.isWithinSleepWindow(new Date(at), settings)) { return; }
        read(want, at, fromSave || againAtTick || renewed);
    }

    /**
     * Wire the schedule up with the read and the value kept, and take no look yet: the caller's
     * first, a tick's or a save's, decides how the read it may start goes (init takes a tick's).
     * Re-calling resets all its state.
     *
     * @param {Object} options Injected environment. Any option besides these is the reader's
     *   own, which its spec's wanted is handed with the rest.
     * @param {function():Object} options.getSettings Current Clay settings supplier.
     * @param {function():?Object} options.getWatchInfo Pebble.getActiveWatchInfo() result supplier.
     * @param {function():(Date|number)} options.now Clock.
     * @param {Object} [options.pebble] The Pebble object to read plugins through (default: the
     *   global one, if any).
     * @param {Object} [options.timers] {setTimeout, clearTimeout, timeoutMs} for the read
     *   (plugin-reader.js readOnce; tests).
     * @returns {void}
     */
    function load(options) {
        checkOptions(options, spec.name);
        deps = options;
        inFlight = false;
        againAtTick = false;
        renewed = false;
        heldUp = false;
        stopped = false;
        record = pluginReads.recordOf(spec.recordAt.read(), spec.timeField);
        value = spec.valueOf(spec.valueAt.read());
        // Not known: what the last PKJS owed the watch died with it. The first look owes a send
        // while the slot shows the value kept.
        shown = null;
    }

    /**
     * Wire the schedule up (load) and take the first look. Call once, from the 'ready' handler,
     * after statusRebake.init(). Re-calling resets all its state, which is what the tests rely
     * on. Reads at once only when a read is due: a PKJS start by itself is no reason to.
     * @param {Object} options load's.
     * @returns {void}
     */
    function init(options) {
        load(options);
        consider(false);
    }

    /**
     * Read nothing more, for a reader that wants nothing of this schedule now (plugin-value-
     * source.js: no slot shows the value it reads), and keep what storage holds of the last read
     * and the value, which a schedule made again for it loads, so it is not read again before
     * its next read is due. Its reader takes out of storage what it no longer wants at all. A
     * read under way is forgotten: its answer goes nowhere, and the value wanted again is read at
     * once. Owes the watch nothing: what stopped wanting it sends its own.
     * @returns {void}
     */
    function stop() {
        if (inFlight) { forget(); }
        stopped = true;
    }

    return {
        init: init,
        load: load,
        onTick: function () { consider(false); },
        refresh: function () { consider(true); },
        stop: stop,
        value: lastValue
    };
}

module.exports = { create: create, checkOptions: checkOptions };
