// test/config-onbuild.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
var _L = [], _S = [];
global.PConf = { hooks: { onLoad: function (fn) { _L.push(fn); }, onSubmit: function (fn) { _S.push(fn); } } };
const OB = require('../src/pkjs/settings/onbuild.js');

function loadContext(store, platform) {
    return {
        env: { platform: platform },
        get: function (k) { return store[k]; },
        set: function (k, v) { store[k] = v; },
        getInitial: function (k) { return store[k]; }
    };
}

test('onLoad resets transient toggles to false', function () {
    var store = { fetch: true, devStatsClear: true, reset: true, fetchNoticeAck: true };
    var ctx = { get: function (k) { return store[k]; }, set: function (k, v) { store[k] = v; }, getInitial: function (k) { return store[k]; } };
    OB.onLoad(ctx);
    assert.equal(store.fetch, false);
    assert.equal(store.devStatsClear, false);
    // The destructive Reset toggle must never render pre-checked from a stale save.
    assert.equal(store.reset, false);
    // fetchNoticeAck is a one-shot dismiss signal; a stale true must never survive
    // to the next open (would auto-dismiss the notice panel on load).
    assert.equal(store.fetchNoticeAck, false);
});

test('onLoad derives locationMode from the stored location', function () {
    var manual = { location: 'Berlin' };
    OB.onLoad({ get: function (k) { return manual[k]; }, set: function (k, v) { manual[k] = v; }, getInitial: function () {} });
    assert.equal(manual.locationMode, 'manual');

    var gps = { location: '' };
    OB.onLoad({ get: function (k) { return gps[k]; }, set: function (k, v) { gps[k] = v; }, getInitial: function () {} });
    assert.equal(gps.locationMode, 'gps');
});

test('onLoad forces radar and health off on aplite', function () {
    var store = { radarProvider: 'dwd', healthMode: 'all', radarMode: 'graph' };
    OB.onLoad(loadContext(store, 'aplite'));
    assert.equal(store.radarProvider, 'disabled');
    assert.equal(store.healthMode, 'off');
    assert.equal(store.radarMode, 'off');
});

test('onLoad preserves radar and health settings on non-aplite platforms', function () {
    var store = { radarProvider: 'dwd', healthMode: 'all', radarMode: 'graph' };
    OB.onLoad(loadContext(store, 'basalt'));
    assert.equal(store.radarProvider, 'dwd');
    assert.equal(store.healthMode, 'all');
    assert.equal(store.radarMode, 'graph');
});

test('onSubmit clears location in GPS mode and that change forces a refetch', function () {
    var store = { fetch: false, provider: 'wunderground', owmApiKey: '', locationMode: 'gps', location: 'Berlin' };
    var initial = { provider: 'wunderground', owmApiKey: '', location: 'Berlin' };
    var ctx = { get: function (k) { return store[k]; }, set: function (k, v) { store[k] = v; }, getInitial: function (k) { return initial[k]; } };
    OB.onSubmit(ctx);
    assert.equal(store.location, '');
    assert.equal(store.fetch, true);
});

test('onSubmit keeps the manual location and does not refetch when unchanged', function () {
    var store = { fetch: false, provider: 'wunderground', owmApiKey: '', locationMode: 'manual', location: 'Berlin' };
    var initial = { provider: 'wunderground', owmApiKey: '', location: 'Berlin' };
    var ctx = { get: function (k) { return store[k]; }, set: function (k, v) { store[k] = v; }, getInitial: function (k) { return initial[k]; } };
    OB.onSubmit(ctx);
    assert.equal(store.location, 'Berlin');
    assert.equal(store.fetch, false);
});

test('onSubmit sets fetch=true when provider changes', function () {
    var store = { fetch: false, provider: 'openmeteo', owmApiKey: '', location: 'Berlin' };
    var initial = { provider: 'wunderground', owmApiKey: '', location: 'Berlin' };
    var ctx = { get: function (k) { return store[k]; }, set: function (k, v) { store[k] = v; }, getInitial: function (k) { return initial[k]; } };
    OB.onSubmit(ctx);
    assert.equal(store.fetch, true);
});

test('onSubmit forces a refetch when tomorrowioApiKey changed', function () {
    var store = { fetch: false, provider: 'wunderground', owmApiKey: '', tomorrowioApiKey: 'new', location: 'Berlin' };
    var initial = { provider: 'wunderground', owmApiKey: '', tomorrowioApiKey: '', location: 'Berlin' };
    var ctx = { get: function (k) { return store[k]; }, set: function (k, v) { store[k] = v; }, getInitial: function (k) { return initial[k]; } };
    OB.onSubmit(ctx);
    assert.equal(store.fetch, true);
});

test('registers into PConf.hooks', function () {
    assert.equal(_L.length, 1);
    assert.equal(_S.length, 1);
});

test('onSubmit raises a GPS cache below the update interval up to the interval', function () {
    var store = { locationMode: 'gps', location: '', provider: 'wunderground', owmApiKey: '', fetchIntervalMin: '60', gpsCacheMin: '30' };
    var initial = { provider: 'wunderground', owmApiKey: '', location: '' };
    var ctx = { get: function (k) { return store[k]; }, set: function (k, v) { store[k] = v; }, getInitial: function (k) { return initial[k]; } };
    OB.onSubmit(ctx);
    assert.equal(store.gpsCacheMin, '60');
});

test('onSubmit leaves a GPS cache at or above the interval unchanged', function () {
    var store = { locationMode: 'gps', location: '', provider: 'wunderground', owmApiKey: '', fetchIntervalMin: '15', gpsCacheMin: '30' };
    var ctx = { get: function (k) { return store[k]; }, set: function (k, v) { store[k] = v; }, getInitial: function () { return ''; } };
    OB.onSubmit(ctx);
    assert.equal(store.gpsCacheMin, '30');
});
