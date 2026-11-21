// src/pkjs/status-bars/adapter/battery-estimate.js
//
// The estimate of the days the watch has left on its charge, which the watch battery's
// text can show in place of the percentage or beside it (domain/battery-days.js).
//
// The estimate is Muninn's: a battery tracker for the watch that serves its numbers to
// other apps as a plugin of the Pebble app (muninn/stats: daysRemaining, and updatedAt,
// when it made them). Reading it needs no permission. Muninn makes a new estimate at each of
// its watch app's wakeups, every 6 hours, so nothing here stays subscribed: the Pebble app
// would run Muninn's plugin script again every minute for as long as anything were
// (plugin-reader.js). It is read once at a time, about twice a day: each read brings back
// the permissions Muninn asked for that the user has not answered, as a notification on the
// phone and on the watch. domain/estimate-reads.js says when. The time of the last read is
// kept in storage, so neither a PKJS restart nor a settings save reads again before it is
// due, and switching the days on reads at once. Inside the Night battery saver's window only
// that read goes ahead; any other waits for the first tick after it.
//
// Only while it is wanted: the slot is set to show the days, on a bar the watch is sent
// (status-lines.js wantsBatteryDays). Otherwise this module reads nothing and sends
// nothing, and forgets when it last read, so switching the days on again reads at once.
//
// What it heard last is kept in storage, so a bake after a PKJS restart shows the days at
// once. A bake drops an estimate more than a day old (battery-days.js daysLeft), so nothing
// here has to expire it. When a new estimate changes what the slot shows, the watch is owed a
// status send, which the re-bake's next tick makes: within a minute, after the Night battery
// saver's window, and not beside a fetch in flight (status-rebake.js oweStatus).
//
// ES5 only (aplite's JavaScriptCore): var + function, and never *construct* a Promise.

var KEYS = require('../../settings/domain/storage-keys.js');
var statusRebake = require('../application/status-rebake.js');
var statusLines = require('../domain/status-lines.js');
var batteryDays = require('../domain/battery-days.js');
var estimateReads = require('../domain/estimate-reads.js');
var batterySaver = require('../../wire/domain/battery-saver.js');
var pluginReader = require('./plugin-reader.js');

/** Muninn's source of its estimate, and the properties read from it. */
var MUNINN_STATS = { category: 'muninn', item: 'stats', properties: ['daysRemaining', 'updatedAt'] };

// The injected environment (init). Before it, the module is inert: no settings, so
// nothing is wanted.
var deps = {
    getSettings: function () { return null; },
    getWatchInfo: function () { return null; },
    now: function () { return Date.now(); }
};
var reading = false;      // a read is under way
// The last read ({at, failures}; estimate-reads.js recordOf), or null for none: read from
// storage at init and kept here as it is written, so a write that storage refuses still
// counts for the rest of this PKJS life.
var record = null;

/**
 * @returns {number} Now, in epoch milliseconds (the injected clock).
 */
function nowMs() {
    return +deps.now();
}

/**
 * @returns {boolean} Whether the days are wanted: the slot is set to show them on a bar
 *   this watch is sent, and this Pebble app can read plugins at all.
 */
function wanted() {
    var settings = deps.getSettings();
    // The display setting first: it alone rules out most watches, without working out the bars.
    return Boolean(settings) && batteryDays.wanted(settings)
        && pluginReader.available(pluginReader.pebbleOf(deps))
        && statusLines.wantsBatteryDays(settings, deps.getWatchInfo());
}

/**
 * The estimate last heard, as stored.
 * @returns {?{days: number, updatedAt: number}} The estimate, or null when there is none
 *   or what is stored is unreadable.
 */
function readEstimate() {
    var raw = localStorage.getItem(KEYS.BATTERY_ESTIMATE);
    var rec;
    if (raw === null) { return null; }
    try {
        rec = JSON.parse(raw);
    }
    catch (ex) {
        return null;
    }
    return rec ? batteryDays.estimateOf(rec.days, rec.updatedAt) : null;
}

/**
 * The record of the last read, as stored.
 * @returns {?{at: number, failures: number}} The record, or null when there is none or what
 *   is stored is unreadable (estimate-reads.js recordOf).
 */
function storedRecord() {
    var raw = localStorage.getItem(KEYS.BATTERY_ESTIMATE_READ);
    if (raw === null) { return null; }
    try {
        return estimateReads.recordOf(JSON.parse(raw));
    }
    catch (ex) {
        return null;
    }
}

/**
 * Record a read, here and in storage.
 * @param {number} at When it started, in epoch milliseconds.
 * @param {number} failures The failed reads in a row it ends with.
 * @returns {void}
 */
function stamp(at, failures) {
    record = { at: at, failures: failures };
    try {
        localStorage.setItem(KEYS.BATTERY_ESTIMATE_READ, JSON.stringify(record));
    }
    catch (ex) {
        console.log('battery-estimate: the time of the read was not stored.');
    }
}

/**
 * Forget the last read: the days are not wanted, and the next time they are, they are read
 * at once. Writes nothing when there is nothing to forget.
 * @returns {void}
 */
function forget() {
    if (record === null) { return; }
    record = null;
    localStorage.removeItem(KEYS.BATTERY_ESTIMATE_READ);
}

/**
 * @param {?{days: number, updatedAt: number}} a An estimate, or none.
 * @param {?{days: number, updatedAt: number}} b Another.
 * @returns {boolean} Whether they are the same estimate (none and none are).
 */
function sameEstimate(a, b) {
    if (!a || !b) { return a === b; }
    return a.days === b.days && a.updatedAt === b.updatedAt;
}

/**
 * Keep an estimate (or none), and tell the watch when that changes what its slot shows.
 * @param {?{days: number, updatedAt: number}} estimate The estimate heard, or null.
 * @returns {void}
 */
function keep(estimate) {
    var at = nowMs();
    var kept = readEstimate();
    var before;
    var after;
    // Muninn makes a new estimate every 6 hours, and a read can still hear the one kept:
    // nothing to write then, and nothing to tell.
    if (sameEstimate(kept, estimate)) { return; }
    before = batteryDays.daysLeft(kept, at);
    after = batteryDays.daysLeft(estimate, at);
    if (estimate) {
        localStorage.setItem(KEYS.BATTERY_ESTIMATE, JSON.stringify(estimate));
    } else {
        localStorage.removeItem(KEYS.BATTERY_ESTIMATE);
    }
    if (before === after) { return; }
    console.log('battery-estimate: ' + (after === null ? 'no estimate' : after + ' days left') + '.');
    // Never sent from here. Muninn answers at any moment, right after a settings save or
    // a boot among them, while their own messages are on the channel. Those bake the
    // estimate just kept where it came in time; the re-bake's next tick sends what is left.
    statusRebake.oweStatus();
}

/**
 * Ask Muninn for its estimate, once.
 *
 * A Muninn that is not installed answers as a plugin that is not there: the estimate kept
 * from when it was is dropped, and the slot shows the percentage. That is an answer, so the
 * next read waits as long as after any other. Any other failure keeps what was heard last,
 * which a bake drops by itself once it is too old, and is tried again sooner
 * (estimate-reads.js retryWait).
 *
 * @param {number} at Now, in epoch milliseconds.
 * @returns {void}
 */
function read(at) {
    var failures = record ? record.failures : 0;
    reading = true;
    // Stamped before Muninn answers: a read that PKJS ends before the answer still counts,
    // or leaving the watchface and coming back every few seconds would read at every start.
    stamp(at, failures);
    pluginReader.readOnce(pluginReader.pebbleOf(deps), MUNINN_STATS, function (envelope, fail) {
        reading = false;
        // record is null when the days were switched off while Muninn answered: there is no
        // read to keep the time of then.
        if (fail && fail.code !== 'PLUGIN_UNAVAILABLE') {
            console.log('battery-estimate: Muninn did not answer (' + fail.code + ').');
            if (record) { stamp(at, failures + 1); }
            return;
        }
        if (record && failures > 0) { stamp(at, 0); }
        if (fail) {
            console.log('battery-estimate: Muninn is not installed.');
            keep(null);
            return;
        }
        keep(batteryDays.estimateOf(pluginReader.numberOf(envelope, 'daysRemaining'),
            pluginReader.numberOf(envelope, 'updatedAt')));
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
 * Read the estimate when a read is due (estimate-reads.js), and only while the days are
 * wanted. The one step behind a start, a tick and a settings save.
 *
 * @param {boolean} fromSave Whether the settings were just saved. Only then does a read with
 *   none before it, the days just switched on, go ahead inside the Night battery saver's
 *   window: the user is at the phone, waiting to see the days.
 * @returns {void}
 */
function consider(fromSave) {
    var at;
    if (!wanted()) {
        forget();
        return;
    }
    if (reading) { return; }
    at = nowMs();
    if (record && estimateReads.clockWentBack(record, at)) {
        stamp(at, record.failures);
        return;
    }
    if (record && at < estimateReads.nextReadAt(record, readEstimate())) { return; }
    // The window keeps the watch's link quiet, and a read is not quiet: a permission Muninn
    // asked for comes back to the watch with it.
    if ((record || !fromSave) && saverWindowOpen(at)) { return; }
    read(at);
}

/**
 * The watch battery's facts a status-line bake reads (status-lines.js buildStatusLines'
 * `watch`): the function that reads the estimate last heard. The bake asks only when a
 * bar it bakes shows the days.
 *
 * @returns {{estimate: function(): ?{days: number, updatedAt: number}}}
 */
function bakeFacts() {
    return { estimate: readEstimate };
}

/**
 * The settings were saved: a slot just set to show the days gets them at once. A save that
 * leaves them as they were reads nothing before the next read is due.
 *
 * @returns {void}
 */
function refresh() {
    consider(true);
}

/**
 * Per-minute hook, driven by the channel scheduler's 60 s tick: asks Muninn again once the
 * next read is due.
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
        throw new Error('battery-estimate: init needs getSettings, getWatchInfo and now');
    }
    deps = options;
    reading = false;
    record = storedRecord();
    consider(false);
}

module.exports = {
    READ_INTERVAL_MS: estimateReads.READ_INTERVAL_MS,
    init: init,
    onTick: onTick,
    refresh: refresh,
    bakeFacts: bakeFacts
};
