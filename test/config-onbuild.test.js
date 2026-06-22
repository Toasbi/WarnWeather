// test/config-onbuild.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
var _L = [], _S = [];
global.PConf = { hooks: { onLoad: function (fn) { _L.push(fn); }, onSubmit: function (fn) { _S.push(fn); } } };
const OB = require('../src/pkjs/settings/onbuild.js');

test('onLoad resets transient toggles to false', function () {
    var store = { fetch: true, devStatsClear: true };
    var ctx = { get: function (k) { return store[k]; }, set: function (k, v) { store[k] = v; }, getInitial: function (k) { return store[k]; } };
    OB.onLoad(ctx);
    assert.equal(store.fetch, false);
    assert.equal(store.devStatsClear, false);
});

test('onSubmit sets fetch=true when provider changes', function () {
    var store = { fetch: false, provider: 'openmeteo', owmApiKey: '', location: 'Berlin' };
    var initial = { provider: 'wunderground', owmApiKey: '', location: 'Berlin' };
    var ctx = { get: function (k) { return store[k]; }, set: function (k, v) { store[k] = v; }, getInitial: function (k) { return initial[k]; } };
    OB.onSubmit(ctx);
    assert.equal(store.fetch, true);
});

test('registers into PConf.hooks', function () {
    assert.equal(_L.length, 1);
    assert.equal(_S.length, 1);
});
