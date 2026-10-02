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
  var auth = notices.noticeForFailure({ stage: 'provider_data', code: 'owm_status_401' }, 'OpenWeatherMap', 500);
  assert.strictEqual(auth.key, 'auth');
  assert.strictEqual(auth.type, 'error');
  assert.strictEqual(auth.watch, 'API key error');
  assert.strictEqual(auth.since, 500);
  assert.ok(auth.html.indexOf('OpenWeatherMap') !== -1);
  assert.ok(auth.html.indexOf('401') !== -1);

  var rl = notices.noticeForFailure({ stage: 'provider_data', code: 'yandex_status_429' }, 'Yandex', 600);
  assert.strictEqual(rl.key, 'ratelimit');
  assert.strictEqual(rl.type, 'info');
  assert.strictEqual(typeof rl.watch, 'undefined');

  assert.strictEqual(notices.noticeForFailure({ stage: 'provider_data', code: 'network_error' }, 'X', 1), null);
  assert.strictEqual(notices.noticeForFailure(null, 'X', 1), null);
});

test('noticeForFailure raises nothing for a geocoder 401/403/429', function () {
  // The ArcGIS city lookup and the shared LocationIQ key report bare
  // status_<n> codes under their own stages. Neither is the weather provider,
  // and neither is a key the user can fix — a notice naming the provider and
  // pointing at its key field (plus the 'API key error' watch overlay) was
  // wrong on both counts.
  ['reverse_geocode', 'forward_geocode'].forEach(function (stage) {
    ['status_401', 'status_403', 'status_429'].forEach(function (code) {
      assert.strictEqual(notices.noticeForFailure({ stage: stage, code: code }, 'Open-Meteo', 1), null,
        stage + ' ' + code);
    });
  });
  // No stage at all is not a provider failure either.
  assert.strictEqual(notices.noticeForFailure({ code: 'owm_status_401' }, 'OpenWeatherMap', 1), null);
});

test('gc drops notices older than 7 days, keeps fresh ones', function () {
  global.localStorage.clear();
  var DAY = 24 * 60 * 60 * 1000;
  var now = 100 * DAY;
  notices.add({ key: 'old', type: 'info', html: 'o', since: now - 8 * DAY });
  notices.add({ key: 'fresh', type: 'error', watch: 'w', html: 'f', since: now - 6 * DAY });
  notices.gc(now);
  var l = notices.list();
  assert.strictEqual(l.length, 1);
  assert.strictEqual(l[0].key, 'fresh');
  notices.gc(now);
  assert.strictEqual(notices.list().length, 1, 'no-op when nothing expired');
});

test('gc drops entries with a missing or invalid since', function () {
  global.localStorage.clear();
  notices.add({ key: 'nosince', type: 'info', html: 'x' });
  notices.gc(Date.now());
  assert.deepStrictEqual(notices.list(), []);
});

test('isServerFailure: the provider\'s own 5xx, timeout or no connection', function () {
  ['openmeteo_status_503', 'wu_current_status_500', 'dwd_forecast_timeout', 'owm_network_error'].forEach(function (code) {
    assert.strictEqual(notices.isServerFailure({ stage: 'provider_data', code: code }), true, code);
  });
  ['owm_status_401', 'yandex_status_429', 'openmeteo_status_404', 'dwd_forecast_parse_error'].forEach(function (code) {
    assert.strictEqual(notices.isServerFailure({ stage: 'provider_data', code: code }), false, code);
  });
  assert.strictEqual(notices.isServerFailure({ stage: 'forward_geocode', code: 'status_503' }), false,
    'a geocoder is not the provider');
  assert.strictEqual(notices.isServerFailure({ stage: 'coordinates', code: 'timeout' }), false);
  assert.strictEqual(notices.isServerFailure(null), false);
});

test('noticeForFailure: a server failure raises nothing on the first update, the neutral notice from the second', function () {
  var f503 = { stage: 'provider_data', code: 'openmeteo_status_503' };
  assert.strictEqual(notices.noticeForFailure(f503, 'Open-Meteo', 1), null, 'no count: nothing');
  assert.strictEqual(notices.noticeForFailure(f503, 'Open-Meteo', 1, 1), null, 'the first failed update: nothing');
  var second = notices.noticeForFailure(f503, 'Open-Meteo', 700, 2);
  assert.deepStrictEqual(second, {
    key: 'server', type: 'error', watch: 'Open-Meteo not answering', since: 700,
    html: '<b>Open-Meteo</b> is not answering: the last 2 updates failed (HTTP 503). '
      + 'The watch tries again at the next update.'
  });
  assert.ok(notices.noticeForFailure({ stage: 'provider_data', code: 'dwd_forecast_timeout' }, 'DWD', 1, 3)
    .html.indexOf('the last 3 updates failed (no answer in time)') !== -1);
  assert.ok(notices.noticeForFailure({ stage: 'provider_data', code: 'owm_network_error' }, 'OpenWeatherMap', 1, 2)
    .html.indexOf('(no connection)') !== -1);
  assert.ok(notices.noticeForFailure(f503, 'Weather Underground', 1, 2).watch.length <= 47,
    'the longest provider name still fits the watch\'s 48 B notice buffer');
});

test('noticeForFailure: a provider\'s own retry delay raises the neutral notice at once, saying when it retries', function () {
  var wu = notices.noticeForFailure({ stage: 'provider_data', code: 'wu_current_refused_401', retryAfterMs: 3600000 },
    'Weather Underground', 900);
  assert.deepStrictEqual(wu, {
    key: 'unavailable', type: 'error', watch: 'Weather Underground not answering', since: 900,
    html: '<b>Weather Underground</b> is not answering. The watch tries again in about an hour.'
  });
  assert.ok(notices.noticeForFailure({ stage: 'provider_data', code: 'x', retryAfterMs: 30 * 60000 }, 'X', 1)
    .html.indexOf('in about 30 minutes') !== -1);
});
