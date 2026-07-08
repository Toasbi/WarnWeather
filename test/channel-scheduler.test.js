const test = require('node:test');
const assert = require('node:assert/strict');

// House pattern: install the localStorage mock BEFORE requiring the module.
var store = {};
global.localStorage = {
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    setItem: function (k, v) { store[k] = String(v); },
    removeItem: function (k) { delete store[k]; }
};

var createChannelScheduler = require('../src/pkjs/channel-scheduler');
var KEYS = require('../src/pkjs/storage-keys');

function resetStore() { for (var k in store) { delete store[k]; } }

// A test harness: recording fake deps + a controllable clock + a manual timer
// queue. flushTimers() runs exactly the timers queued at call time (not ones
// they re-arm), so cadence tests advance one tick per flush.
function makeHarness() {
    var timers = [];
    var shouldFetch = false;
    var clock = { value: new Date(2026, 6, 7, 12, 0, 0) }; // month index 6 = July
    var calls = {
        sendClay: [], startFetch: [],
        refreshHolidays: 0, checkForUpdate: 0,
        clearClayCache: 0, clearWeatherCaches: 0
    };
    var deps = {
        sendClay: function (onSuccess, onFailure) {
            calls.sendClay.push({ onSuccess: onSuccess, onFailure: onFailure });
        },
        startFetch: function (force) { calls.startFetch.push(force); },
        shouldFetchNow: function () { return shouldFetch; },
        refreshHolidays: function () { calls.refreshHolidays++; },
        checkForUpdate: function () { calls.checkForUpdate++; },
        clearClayCache: function () { calls.clearClayCache++; },
        clearWeatherCaches: function () { calls.clearWeatherCaches++; },
        setTimeout: function (fn, ms) { timers.push({ fn: fn, ms: ms }); return timers.length; },
        now: function () { return clock.value; }
    };
    return {
        scheduler: createChannelScheduler(deps),
        calls: calls,
        timers: timers,
        setNow: function (d) { clock.value = d; },
        setShouldFetch: function (v) { shouldFetch = v; },
        flushTimers: function () {
            var pending = timers.splice(0, timers.length);
            pending.forEach(function (t) { t.fn(); });
        },
        ackClay: function () {
            var last = calls.sendClay[calls.sendClay.length - 1];
            if (last && last.onSuccess) { last.onSuccess(); }
        },
        nackClay: function () {
            var last = calls.sendClay[calls.sendClay.length - 1];
            if (last && last.onFailure) { last.onFailure(); }
        }
    };
}

test('scenario 1: watch has config and forecast -> no Clay send, no fetch', function () {
    resetStore();
    var h = makeHarness();
    h.scheduler.onWatchStatus({ hasConfig: true, hasForecast: true });
    h.scheduler.onReady({ migrationClayRequired: false });
    assert.equal(h.calls.sendClay.length, 0, 'no Clay send');
    assert.equal(h.calls.startFetch.length, 0, 'no fetch');
    assert.equal(h.calls.clearClayCache, 0, 'Clay cache untouched');
    assert.equal(h.calls.clearWeatherCaches, 0, 'weather caches untouched');
});

test('scenario 2: no config -> Clay cache cleared, Clay first on ready, fetch chained on ACK', function () {
    resetStore();
    var h = makeHarness();
    h.scheduler.onWatchStatus({ hasConfig: false, hasForecast: false });
    assert.equal(h.calls.clearClayCache, 1, 'Clay cache cleared');
    assert.equal(h.calls.clearWeatherCaches, 1, 'weather caches cleared (no forecast)');
    assert.equal(h.calls.sendClay.length, 0, 'nothing sent before onReady (deferred)');
    assert.equal(h.calls.startFetch.length, 0, 'no fetch before onReady');

    h.scheduler.onReady({ migrationClayRequired: false });
    assert.equal(h.calls.sendClay.length, 1, 'exactly one Clay send after ready');
    assert.equal(h.calls.startFetch.length, 0, 'fetch NOT sent alongside the Clay');

    h.ackClay();
    assert.equal(h.calls.startFetch.length, 1, 'fetch fires in the Clay ACK callback');
    assert.equal(h.calls.startFetch[0], true, 'startup fetch is forced');
});

test('scenario 2b: a NACK on the startup Clay still drains the startup fetch', function () {
    resetStore();
    var h = makeHarness();
    h.scheduler.onWatchStatus({ hasConfig: false, hasForecast: false });
    h.scheduler.onReady({ migrationClayRequired: false });
    assert.equal(h.calls.sendClay.length, 1);
    h.nackClay();
    assert.equal(h.calls.startFetch.length, 1, 'NACK must not strand the startup fetch');
    assert.equal(h.calls.startFetch[0], true);
});

test('scenario 3: no forecast -> weather caches cleared; onWatchStatus before onReady defers', function () {
    resetStore();
    var h = makeHarness();
    h.scheduler.onWatchStatus({ hasConfig: true, hasForecast: false });
    assert.equal(h.calls.clearWeatherCaches, 1, 'weather caches cleared');
    assert.equal(h.calls.clearClayCache, 0, 'config present -> Clay cache untouched');
    assert.equal(h.calls.startFetch.length, 0, 'onWatchStatus before onReady defers the fetch');
    assert.equal(h.calls.sendClay.length, 0, 'no Clay send (config present)');

    h.scheduler.onReady({ migrationClayRequired: false });
    assert.equal(h.calls.startFetch.length, 1, 'startup fetch fires on ready');
    assert.equal(h.calls.startFetch[0], true, 'startup fetch is forced');
    assert.equal(h.calls.sendClay.length, 0, 'still no Clay send');
});

test('scenario 4: migration Clay covers a pending handshake -> one Clay; onClayAck on ACK only; fetch chains', function () {
    resetStore();
    var h = makeHarness();
    var ackRuns = 0;
    h.scheduler.onWatchStatus({ hasConfig: false, hasForecast: false });
    h.scheduler.onReady({ migrationClayRequired: true, onClayAck: function () { ackRuns++; } });
    assert.equal(h.calls.sendClay.length, 1, 'exactly ONE Clay (migration covers the handshake send)');
    assert.equal(h.calls.startFetch.length, 0, 'fetch not sent alongside the Clay');
    assert.equal(ackRuns, 0, 'onClayAck has not run before ACK');

    h.ackClay();
    assert.equal(ackRuns, 1, 'onClayAck runs on ACK');
    assert.equal(h.calls.startFetch.length, 1, 'startup fetch chains on ACK');
    assert.equal(h.calls.startFetch[0], true);
});

test('scenario 4b: migration Clay NACK -> onClayAck skipped, startup fetch still drains', function () {
    resetStore();
    var h = makeHarness();
    var ackRuns = 0;
    h.scheduler.onWatchStatus({ hasConfig: false, hasForecast: false });
    h.scheduler.onReady({ migrationClayRequired: true, onClayAck: function () { ackRuns++; } });
    h.nackClay();
    assert.equal(ackRuns, 0, 'onClayAck must NOT run on NACK (migration markers retry next boot)');
    assert.equal(h.calls.startFetch.length, 1, 'startup fetch drains on NACK too');
    assert.equal(h.calls.startFetch[0], true);
});
