// src/pkjs/status-bars/adapter/battery-estimate.js
//
// The estimate of the days the watch has left on its charge, which the watch battery's
// text can show in place of the percentage or beside it (domain/battery-days.js).
//
// The estimate is Muninn's: a battery tracker for the watch that serves its numbers to
// other apps as a plugin of the Pebble app (muninn/stats: daysRemaining, and updatedAt,
// when it made them). Reading it needs no permission. Muninn makes a new estimate at each of
// its watch app's wakeups, every 6 hours, so each estimate is read once, about 20 minutes
// after the wakeup that makes it, so about four times a day, and not more: each read brings
// back the permissions Muninn asked for that the user has not answered, as a notification on
// the phone and on the watch. domain/estimate-reads.js says when, from when Muninn made the
// estimate last heard; how a read goes, and what is kept of it, is every plugin read's
// (plugin-read-schedule.js).
//
// Only while it is wanted: the slot is set to show the days, on a bar the watch is sent
// (status-lines.js wantsBatteryDays). A bake drops an estimate more than a day old
// (battery-days.js daysLeft).
//
// ES5 only (aplite's JavaScriptCore): var + function, and never *construct* a Promise.

var KEYS = require('../../settings/domain/storage-keys.js');
var statusLines = require('../domain/status-lines.js');
var batteryDays = require('../domain/battery-days.js');
var estimateReads = require('../domain/estimate-reads.js');
var pluginReads = require('../domain/plugin-reads.js');
var pluginReadSchedule = require('./plugin-read-schedule.js');
var storedJson = require('./stored-json.js');
var pluginReader = require('./plugin-reader.js');

/**
 * What is read of Muninn: its source of the estimate and the properties read from it. A
 * reader of one thing, so its key is null.
 */
var MUNINN = { key: null,
    request: { category: batteryDays.MUNINN_CATEGORY, item: 'stats', properties: ['daysRemaining', 'updatedAt'] } };

var schedule = pluginReadSchedule.create({
    name: 'battery-estimate',
    recordAt: storedJson.place(KEYS.BATTERY_ESTIMATE_READ),
    valueAt: storedJson.place(KEYS.BATTERY_ESTIMATE),
    // When Muninn made the estimate the read heard. It is kept even where the days cannot be
    // shown (Muninn with no estimate yet, or less than a day left, as just before a charge), so
    // the read after the next wakeup still comes.
    timeField: 'made',
    wanted: function (settings, watchInfo) {
        // The display setting first: it alone rules out most watches, without working out the bars.
        return settings && batteryDays.wanted(settings) && statusLines.wantsBatteryDays(settings, watchInfo)
            ? MUNINN : null;
    },
    nextReadAt: estimateReads.nextReadAt,
    heard: function (envelope) {
        var updatedAt = pluginReader.numberOf(envelope, 'updatedAt');
        return { time: pluginReads.timeOf(updatedAt),
            value: batteryDays.estimateOf(pluginReader.numberOf(envelope, 'daysRemaining'), updatedAt) };
    },
    valueOf: function (stored) {
        return stored ? batteryDays.estimateOf(stored.days, stored.updatedAt) : null;
    },
    shown: function (estimate, settings, nowMs) {
        return batteryDays.daysLeft(estimate, nowMs);
    },
    sameShown: function (a, b) {
        return a === b;
    }
});

/**
 * The watch battery's facts a status-line bake reads (status-lines.js buildStatusLines'
 * `watch`): the function that reads the estimate last heard. The bake asks only when a
 * bar it bakes shows the days.
 *
 * @returns {{estimate: function(): ?{days: number, updatedAt: number}}}
 */
function bakeFacts() {
    return { estimate: schedule.value };
}

module.exports = {
    // Call once, from the 'ready' handler, after statusRebake.init() (plugin-read-schedule.js).
    init: schedule.init,
    // Per-minute hook, driven by the channel scheduler's 60 s tick: asks Muninn again once the
    // next read is due.
    onTick: schedule.onTick,
    // The settings were saved: the days just switched on are read at once.
    refresh: schedule.refresh,
    bakeFacts: bakeFacts
};
