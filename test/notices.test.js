'use strict';
var test = require('node:test');
var assert = require('node:assert');

// localStorage mock installed BEFORE the module loads (see change-detector.test.js).
var store = {};
global.localStorage = {
  getItem: function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
  setItem: function (k, v) { store[k] = String(v); },
  removeItem: function (k) { delete store[k]; },
  clear: function () { store = {}; }
};

var notices = require('../src/pkjs/notices.js');

test('add + list + dedupe by key preserves first since', function () {
  global.localStorage.clear();
  notices.add({ key: 'auth', type: 'error', watch: 'API key error', html: 'x', since: 100 });
  notices.add({ key: 'auth', type: 'error', watch: 'API key error', html: 'x2', since: 200 });
  var l = notices.list();
  assert.strictEqual(l.length, 1);
  assert.strictEqual(l[0].since, 100);       // first occurrence kept
  assert.strictEqual(l[0].html, 'x2');       // content refreshed
});

test('clearErrors keeps infos', function () {
  global.localStorage.clear();
  notices.add({ key: 'auth', type: 'error', watch: 'API key error', html: 'e', since: 1 });
  notices.add({ key: 'ratelimit', type: 'info', html: 'i', since: 2 });
  notices.clearErrors();
  var l = notices.list();
  assert.strictEqual(l.length, 1);
  assert.strictEqual(l[0].key, 'ratelimit');
});

test('watchText returns newest error watch, else empty', function () {
  global.localStorage.clear();
  assert.strictEqual(notices.watchText(), '');
  notices.add({ key: 'ratelimit', type: 'info', html: 'i', since: 2 });
  assert.strictEqual(notices.watchText(), '');   // info has no watch
  notices.add({ key: 'auth', type: 'error', watch: 'API key error', html: 'e', since: 3 });
  assert.strictEqual(notices.watchText(), 'API key error');
});

test('dismissAll empties the list', function () {
  global.localStorage.clear();
  notices.add({ key: 'auth', type: 'error', watch: 'w', html: 'e', since: 1 });
  notices.dismissAll();
  assert.deepStrictEqual(notices.list(), []);
});

test('noticeForFailure classifies auth/ratelimit/other', function () {
  var auth = notices.noticeForFailure({ code: 'owm_status_401' }, 'OpenWeatherMap', 500);
  assert.strictEqual(auth.key, 'auth');
  assert.strictEqual(auth.type, 'error');
  assert.strictEqual(auth.watch, 'API key error');
  assert.strictEqual(auth.since, 500);
  assert.ok(auth.html.indexOf('OpenWeatherMap') !== -1);
  assert.ok(auth.html.indexOf('401') !== -1);

  var rl = notices.noticeForFailure({ code: 'status_429' }, 'Yandex', 600);
  assert.strictEqual(rl.key, 'ratelimit');
  assert.strictEqual(rl.type, 'info');
  assert.strictEqual(typeof rl.watch, 'undefined');

  assert.strictEqual(notices.noticeForFailure({ code: 'network_error' }, 'X', 1), null);
  assert.strictEqual(notices.noticeForFailure(null, 'X', 1), null);
});
