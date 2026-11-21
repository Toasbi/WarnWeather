// src/pkjs/status-bars/adapter/battery-estimate.js
//
// The estimate of the days the watch has left on its charge, which the watch battery's
// percentage slot can show in place of the percentage (domain/battery-days.js).
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
// estimate changes what the slot shows, the status is re-baked and sent
// (status-rebake.js), except in the Night battery saver window, whose debt the first tick
// after it pays, as for the phone's battery.
//
// ES5 only (aplite's JavaScriptCore): var + function, and never *construct* a Promise.

var KEYS = require('../../settings/domain/storage-keys.js');
var batterySaver = require('../../wire/domain/battery-saver.js');
var statusRebake = require('../application/status-rebake.js');
var statusLines = require('../domain/status-lines.js');
var batteryDays = require('../domain/battery-days.js');
var pluginReader = require('./plugin-reader.js');

/** Muninn's source of its estimate, and the properties read from it. */
var MUNINN_STATS = { category: 'muninn', item: 'stats', properties: ['daysRemaining', 'updatedAt'] };

/** The least time between two reads of the estimate from the minute tick. */
var READ_INTERVAL_MS = 30 * 60 * 1000;

var deps = {};            // injected environment (see init)
var lastReadAt = null;    // when this PKJS life last asked, in epoch ms (null: not yet)
var reading = false;      // a read is under way
var pendingPush = false;  // a change the saver window swallowed, owed to the watch

/**
 * localStorage, or null where the host has none (Node, in tests that never needed it).
 * @returns {Object|null} The storage object, or null.
 */
function store() {
    return (typeof localStorage !== 'undefined' && localStorage) ? localStorage : null;
}

/**
 * @returns {Object|null} The Pebble object to read plugins through: the injected one when
 *   init() was given a `pebble` key (tests), else the ambient global, else null.
 */
function currentPebble() {
    if (Object.prototype.hasOwnProperty.call(deps, 'pebble')) { return deps.pebble; }
    return typeof Pebble !== 'undefined' ? Pebble : null;
}

/**
 * @returns {number} Now, in epoch milliseconds (the injected clock).
 */
function nowMs() {
    return typeof deps.now === 'function' ? +deps.now() : Date.now();
}

/**
 * @returns {?Object} Current Clay settings, via the injected supplier.
 */
function currentSettings() {
    return typeof deps.getSettings === 'function' ? deps.getSettings() : null;
}

/**
 * @returns {boolean} Whether the days are wanted: the slot is set to show them on a bar
 *   this watch is sent, and this Pebble app can read plugins at all.
 */
function wanted() {
    var settings = currentSettings();
    var watchInfo = typeof deps.getWatchInfo === 'function' ? deps.getWatchInfo() : null;
    return Boolean(settings) && pluginReader.available(currentPebble())
        && statusLines.wantsBatteryDays(settings, watchInfo);
}

/**
 * The estimate last heard, as stored.
 * @returns {?{days: number, updatedAt: number}} The estimate, or null when there is none
 *   or what is stored is unreadable.
 */
function readEstimate() {
    var s = store();
    var raw = s ? s.getItem(KEYS.BATTERY_ESTIMATE) : null;
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
 * Keep an estimate (or none), and tell the watch when that changes what its slot shows.
 * @param {?{days: number, updatedAt: number}} estimate The estimate heard, or null.
 * @returns {void}
 */
function keep(estimate) {
    var s = store();
    var at = nowMs();
    var before = batteryDays.daysLeft(readEstimate(), at);
    var after = batteryDays.daysLeft(estimate, at);
    if (s) {
        if (estimate) {
            s.setItem(KEYS.BATTERY_ESTIMATE, JSON.stringify(estimate));
        } else {
            s.removeItem(KEYS.BATTERY_ESTIMATE);
        }
    }
    if (before === after) { return; }
    console.log('battery-estimate: ' + (after === null ? 'no estimate' : after + ' days left') + '.');
    if (batterySaver.isWithinSleepWindow(new Date(at), currentSettings())) {
        // Night battery saver: kept, not sent. onTick() pays it after the window.
        pendingPush = true;
        return;
    }
    pendingPush = false;
    statusRebake.resendStatus('battery-days');
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
    pluginReader.readOnce(currentPebble(), MUNINN_STATS, function (envelope, fail) {
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
 * Per-minute hook, driven by the channel scheduler's 60 s tick. Pays what the Night
 * battery saver window swallowed once it has closed (not beside a fetch in flight, whose
 * message bakes the estimate anyway), and asks Muninn again once READ_INTERVAL_MS has
 * passed since the last time.
 *
 * @param {boolean} [fetchInFlight] Whether a weather fetch is running this tick.
 * @returns {void}
 */
function onTick(fetchInFlight) {
    var at = nowMs();
    if (pendingPush && !fetchInFlight
            && !batterySaver.isWithinSleepWindow(new Date(at), currentSettings())) {
        pendingPush = false;
        statusRebake.resendStatus('battery-days-post-saver-window');
    }
    if (!wanted()) { return; }
    if (lastReadAt !== null && at - lastReadAt >= 0 && at - lastReadAt < READ_INTERVAL_MS) { return; }
    read();
}

/**
 * Wire the module up. Call once, from the 'ready' handler, after statusRebake.init().
 * Re-calling resets all module state, which is what the tests rely on.
 *
 * @param {Object} [options] Injected environment; every field has a default.
 * @param {Object} [options.pebble] The Pebble object to read plugins through (default: the
 *   global one, if any).
 * @param {function():Object} [options.getSettings] Current Clay settings supplier.
 * @param {function():?Object} [options.getWatchInfo] Pebble.getActiveWatchInfo() result supplier.
 * @param {function():(Date|number)} [options.now] Clock.
 * @param {Object} [options.timers] {setTimeout, clearTimeout, timeoutMs} for the read
 *   (plugin-reader.js readOnce; tests).
 * @returns {void}
 */
function init(options) {
    deps = options || {};
    lastReadAt = null;
    reading = false;
    pendingPush = false;
    if (wanted()) { read(); }
}

module.exports = {
    READ_INTERVAL_MS: READ_INTERVAL_MS,
    init: init,
    onTick: onTick,
    refresh: refresh,
    bakeFacts: bakeFacts
};
