// src/pkjs/status-bars/adapter/battery-estimate.js
//
// The estimate of the days the watch has left on its charge, which the watch battery's
// Text look can show in place of the percentage or beside it (domain/battery-days.js).
//
// The estimate is Muninn's: a battery tracker for the watch that serves its numbers to
// other apps as a plugin of the Pebble app (muninn/stats: daysRemaining, and updatedAt,
// when it made them). Reading it needs no permission. Muninn makes a new estimate when its
// watch app runs, a few times a day, so nothing here stays subscribed: the Pebble app
// would run Muninn's plugin script again every minute for as long as anything were
// (plugin-reader.js). The estimate is read once at start, once after the settings are
// saved, and then at most every READ_INTERVAL_MS from the scheduler's minute tick.
//
// Only while it is wanted: the slot is set to show the days, on a bar the watch is sent
// (status-lines.js wantsBatteryDays). Otherwise this module reads nothing and sends
// nothing.
//
// What it heard last is kept in storage, so a bake after a PKJS restart shows the days at
// once. A bake counts the estimate down to its own instant and drops one that has grown
// too old (battery-days.js daysLeft), so nothing here has to expire it. When a new
// estimate changes what the slot shows, the watch is owed a status send, which the
// re-bake's next tick makes: within a minute, after the Night battery saver's window, and
// not beside a fetch in flight (status-rebake.js oweStatus).
//
// ES5 only (aplite's JavaScriptCore): var + function, and never *construct* a Promise.

var KEYS = require('../../settings/domain/storage-keys.js');
var statusRebake = require('../application/status-rebake.js');
var statusLines = require('../domain/status-lines.js');
var batteryDays = require('../domain/battery-days.js');
var pluginReader = require('./plugin-reader.js');

/** Muninn's source of its estimate, and the properties read from it. */
var MUNINN_STATS = { category: 'muninn', item: 'stats', properties: ['daysRemaining', 'updatedAt'] };

/** The least time between two reads of the estimate from the minute tick. */
var READ_INTERVAL_MS = 30 * 60 * 1000;

// The injected environment (init). Before it, the module is inert: no settings, so
// nothing is wanted.
var deps = {
    getSettings: function () { return null; },
    getWatchInfo: function () { return null; },
    now: function () { return Date.now(); }
};
var lastReadAt = null;    // when this PKJS life last asked, in epoch ms (null: not yet)
var reading = false;      // a read is under way

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
    return Boolean(settings) && pluginReader.available(pluginReader.pebbleOf(deps))
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
    // Muninn makes a new estimate a few times a day, and most reads hear the one kept:
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
 * from when it was is dropped, and the slot shows the percentage. Any other failure keeps
 * what was heard last, which a bake drops by itself once it is too old.
 *
 * @returns {void}
 */
function read() {
    if (reading) { return; }
    reading = true;
    lastReadAt = nowMs();
    pluginReader.readOnce(pluginReader.pebbleOf(deps), MUNINN_STATS, function (envelope, fail) {
        reading = false;
        if (fail) {
            console.log('battery-estimate: Muninn did not answer (' + fail.code + ').');
            if (fail.code === 'PLUGIN_UNAVAILABLE') { keep(null); }
            return;
        }
        keep(batteryDays.estimateOf(pluginReader.numberOf(envelope, 'daysRemaining'),
            pluginReader.numberOf(envelope, 'updatedAt')));
    }, deps.timers);
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
 * The settings were saved: ask at once when the days are wanted, so a slot just set to
 * show them does so without waiting for the next read from the tick.
 *
 * @returns {void}
 */
function refresh() {
    if (wanted()) { read(); }
}

/**
 * Per-minute hook, driven by the channel scheduler's 60 s tick: asks Muninn again once
 * READ_INTERVAL_MS has passed since the last time.
 *
 * @returns {void}
 */
function onTick() {
    var at = nowMs();
    if (lastReadAt !== null && at - lastReadAt >= 0 && at - lastReadAt < READ_INTERVAL_MS) { return; }
    if (wanted()) { read(); }
}

/**
 * Wire the module up. Call once, from the 'ready' handler, after statusRebake.init().
 * Re-calling resets all module state, which is what the tests rely on.
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
    lastReadAt = null;
    reading = false;
    if (wanted()) { read(); }
}

module.exports = {
    READ_INTERVAL_MS: READ_INTERVAL_MS,
    init: init,
    onTick: onTick,
    refresh: refresh,
    bakeFacts: bakeFacts
};
