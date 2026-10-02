// test/key-result.test.js — the last answer each keyed source gave the user's own API key
// (key-result.js), which the settings page reads as userData.keyResults for the key status
// under the Weather and Radar provider rows (settings/key-status.js). One map by source id,
// the key's fingerprint and never the key, written only when an entry changes; only answers
// that say something about the key count. Then the radar transport writing it for a keyed
// source (radar-fetch.js opts.keyResult, which the keyed Rainbow path and Tomorrow.io's radar
// pass), whose radar behaviour stays as it was.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

// Mock the shared XHR BEFORE requiring the radar module (it captures it at load).
const WeatherProvider = require('../src/pkjs/weather/provider.js');
let responder;
WeatherProvider.request = function (url, type, onSuccess, onError, headers, body) {
  responder(url, type, onSuccess, onError, headers, body);
};
const rainbowRadar = require('../src/pkjs/weather/rainbow-radar.js');
const radarFetch = require('../src/pkjs/weather/radar-fetch.js');
const radarWire = require('../src/pkjs/weather/radar-wire.js');
const keyResult = require('../src/pkjs/key-result.js');
const KEYS = require('../src/pkjs/storage-keys.js');
const { fingerprint } = require('../src/pkjs/key-fingerprint.js');

const SLOT0 = 1700000100;
const KEY = 'rbw-secret-0123wxyz';

/**
 * Install a recording localStorage mock.
 * @returns {{store: Object, writes: Array}} The store and the setItem log.
 */
function mockStorage() {
  const store = {};
  const writes = [];
  global.localStorage = {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
    setItem: (k, v) => { writes.push(k); store[k] = String(v); },
    removeItem: (k) => { delete store[k]; }
  };
  return { store, writes };
}

/**
 * The stored map, parsed.
 * @param {Object} store The mock's store.
 * @returns {?Object} The map.
 */
function mapIn(store) {
  const raw = store[KEYS.KEY_RESULTS_KEY];
  return raw ? JSON.parse(raw) : null;
}

test.afterEach(() => { delete global.localStorage; });

test('the storage key is its own, and the dev builds\' radar-only record is not reused', () => {
  assert.equal(KEYS.KEY_RESULTS_KEY, 'keyResults');
  Object.keys(KEYS).forEach((name) => assert.notEqual(KEYS[name], 'radarKeyResult', name));
});

// --- the module -------------------------------------------------------------------------------

test('classify: 2xx and 429 say the key works, 401/403 that it is refused, anything else nothing', () => {
  [200, 201, 204, 299, 429].forEach((s) => assert.equal(keyResult.classify(s), 'ok', String(s)));
  [401, 403].forEach((s) => assert.equal(keyResult.classify(s), 'rejected', String(s)));
  [0, -1, 199, 300, 400, 404, 422, 500, 503, undefined, null].forEach((s) =>
    assert.equal(keyResult.classify(s), null, String(s)));
});

test('statusOfCode reads a transport code and a provider code alike', () => {
  assert.equal(keyResult.statusOfCode('status_401'), 401);
  assert.equal(keyResult.statusOfCode('owm_status_403'), 403);
  assert.equal(keyResult.statusOfCode('tomorrowio_status_429'), 429);
  ['timeout', 'network_error', 'status_', 'xstatus_401', 'status_401x', '', null, undefined, 401].forEach((c) =>
    assert.equal(keyResult.statusOfCode(c), 0, String(c)));
});

test('record: the key\'s fingerprint and the status under the source — never the key', () => {
  const { store } = mockStorage();
  keyResult.record('rainbowkey', '  ' + KEY + ' ', 401);
  assert.deepEqual(mapIn(store), { rainbowkey: { keyHash: fingerprint(KEY), status: 401 } });
  assert.equal(store[KEYS.KEY_RESULTS_KEY].indexOf(KEY), -1, 'the key itself is not stored');
});

test('record: one entry per source — each keeps its own answer, a newer one replaces it', () => {
  const { store } = mockStorage();
  keyResult.record('openweathermap', 'owm-1', 200);
  keyResult.record('rainbowkey', KEY, 403);
  keyResult.record('tomorrowio', 'tio-1', 401);
  keyResult.record('tomorrowio', 'tio-1', 200);
  assert.deepEqual(mapIn(store), {
    openweathermap: { keyHash: fingerprint('owm-1'), status: 200 },
    rainbowkey: { keyHash: fingerprint(KEY), status: 403 },
    tomorrowio: { keyHash: fingerprint('tio-1'), status: 200 }
  });
  keyResult.record('openweathermap', 'owm-2', 401);
  assert.deepEqual(mapIn(store).openweathermap, { keyHash: fingerprint('owm-2'), status: 401 }, 'another key: its answer');
});

test('record: 2xx reads as 200; 429, 401 and 403 count; anything else leaves the last answer', () => {
  const { store } = mockStorage();
  keyResult.record('rainbowkey', KEY, 204);
  assert.equal(mapIn(store).rainbowkey.status, 200);
  [0, 404, 500, 502, -1, undefined].forEach((status) => {
    keyResult.record('rainbowkey', KEY, status);
    assert.equal(mapIn(store).rainbowkey.status, 200, String(status) + ' says nothing about the key');
  });
  [429, 401, 403].forEach((status) => {
    keyResult.record('rainbowkey', KEY, status);
    assert.equal(mapIn(store).rainbowkey.status, status);
  });
});

test('record: written only when an entry changes; no key, no source or no storage writes nothing', () => {
  const { writes, store } = mockStorage();
  keyResult.record('rainbowkey', KEY, 200);
  keyResult.record('rainbowkey', KEY, 200);
  keyResult.record('rainbowkey', KEY, 201);
  assert.equal(writes.length, 1, 'one write for three equal answers');
  keyResult.record('rainbowkey', '   ', 401);
  keyResult.record('openmeteo', undefined, 200);
  keyResult.record('', KEY, 401);
  keyResult.record(undefined, KEY, 401);
  assert.equal(writes.length, 1, 'a keyless source or a blank id writes nothing');
  store[KEYS.KEY_RESULTS_KEY] = '{oops';
  keyResult.record('rainbowkey', KEY, 401);
  assert.deepEqual(mapIn(store), { rainbowkey: { keyHash: fingerprint(KEY), status: 401 } }, 'an unreadable map starts over');
  delete global.localStorage;
  assert.doesNotThrow(() => keyResult.record('rainbowkey', KEY, 401), 'no storage: nothing to do');
  global.localStorage = { getItem: () => null, setItem: () => { throw new Error('full'); } };
  assert.doesNotThrow(() => keyResult.record('rainbowkey', KEY, 401), 'a full storage is not an error');
});

test('verdictOf: the source\'s entry, for this exact key, when it says something about it', () => {
  const hash = fingerprint(KEY);
  const raw = JSON.stringify({ rainbowkey: { keyHash: hash, status: 403 }, tomorrowio: { keyHash: hash, status: 429 },
    yandex: { keyHash: hash, status: 500 } });
  assert.deepEqual(keyResult.verdictOf(raw, 'rainbowkey', hash), { state: 'rejected', status: 403 });
  assert.deepEqual(keyResult.verdictOf(raw, 'tomorrowio', hash), { state: 'ok', status: 429 });
  assert.equal(keyResult.verdictOf(raw, 'rainbowkey', fingerprint('another-key')), null, 'another key');
  assert.equal(keyResult.verdictOf(raw, 'openweathermap', hash), null, 'another source\'s entry never speaks');
  assert.equal(keyResult.verdictOf(raw, 'yandex', hash), null, 'a status that says nothing');
  assert.equal(keyResult.verdictOf(raw, 'constructor', hash), null, 'only the map\'s own entries');
  assert.equal(keyResult.verdictOf(raw, 'rainbowkey', ''), null, 'no key');
  ['{oops', '', null, undefined, 'null', '[]', '7'].forEach((r) =>
    assert.equal(keyResult.verdictOf(r, 'rainbowkey', hash), null, String(r)));
});

test('what record writes, verdictOf reads back', () => {
  const { store } = mockStorage();
  keyResult.record('yandex', 'ydx-5555', 403);
  assert.deepEqual(keyResult.verdictOf(store[KEYS.KEY_RESULTS_KEY], 'yandex', fingerprint(' ydx-5555 ')),
    { state: 'rejected', status: 403 });
});

// --- the radar transport writes it for a keyed source ----------------------------------------

/**
 * One keyed Rainbow fetch whose request gets `answer`: a string is a 200 body, {code} a
 * transport error.
 * @param {string|{code: string}} answer The response.
 * @returns {?Object} The tuples the adapter answered.
 */
function keyedFetch(answer) {
  rainbowRadar.resetKeyedStreak();
  responder = function (url, type, onSuccess, onError) {
    if (typeof answer === 'string') { onSuccess(answer); } else { onError({ code: answer.code, detail: 'http_status' }); }
  };
  let out = 'unset';
  const orig = console.log;
  console.log = function () {};
  try { rainbowRadar.fetchRadarTuplesWithKey(KEY, 52.5, 13.4, SLOT0, function (t) { out = t; }); }
  finally { console.log = orig; }
  return out;
}

test('the keyed Rainbow path records a served key, a refused key and a key over its allowance', () => {
  const { store } = mockStorage();
  const served = keyedFetch(JSON.stringify({ latitude: 52.51, longitude: 13.41, forecast: [] }));
  assert.equal(served.RAIN_RADAR_START, SLOT0, 'the window as before');
  assert.deepEqual(mapIn(store), { rainbowkey: { keyHash: fingerprint(KEY), status: 200 } });

  assert.deepEqual(keyedFetch({ code: 'status_401' }), radarWire.clearRadarTuples(), 'the clear as before');
  assert.equal(mapIn(store).rainbowkey.status, 401);

  assert.deepEqual(keyedFetch({ code: 'status_429' }), radarWire.limitedRadarTuples(), 'the limit notice as before');
  assert.equal(mapIn(store).rainbowkey.status, 429);

  keyedFetch({ code: 'status_403' });
  assert.equal(mapIn(store).rainbowkey.status, 403);
});

test('the keyed Rainbow path: a served key with a far echo still counts as served', () => {
  const { store } = mockStorage();
  assert.equal(keyedFetch(JSON.stringify({ latitude: 10, longitude: 10, forecast: [] })), null, 'no window, as before');
  assert.equal(mapIn(store).rainbowkey.status, 200);
});

test('the keyed Rainbow path leaves the answer alone on answers that say nothing about the key', () => {
  const { store } = mockStorage();
  keyedFetch({ code: 'status_401' });
  assert.equal(keyedFetch({ code: 'status_503' }), null, 'a transient failure as before');
  assert.deepEqual(keyedFetch({ code: 'status_404' }), radarWire.flatRadarTuples(SLOT0), 'out of coverage as before');
  assert.equal(keyedFetch(''), null, 'an empty 200 (an Origin-neutered runtime) as before');
  assert.equal(keyedFetch('null'), null, 'a 200 whose body is no object');
  assert.equal(mapIn(store).rainbowkey.status, 401, 'still the refusal');
});

test('the shared proxy path records nothing', () => {
  const { store } = mockStorage();
  responder = function (url, type, onSuccess) { onSuccess(JSON.stringify({ forecast: [] })); };
  rainbowRadar.fetchRadarTuplesAt('https://proxy.example/rainbow', 52.5, 13.4, SLOT0, function () {});
  assert.equal(mapIn(store), null);
});

test('fetchRadarJson: the answer is recorded before interpret and onTransportError see it', () => {
  const { store } = mockStorage();
  const seen = [];
  const opts = { url: 'https://radar.example', label: 'Test', keyResult: { id: 'tomorrowio', apiKey: 'K-1' },
    onTransportError: function () { seen.push(mapIn(store) && mapIn(store).tomorrowio.status); return true; } };
  responder = function (url, type, onSuccess) { onSuccess('{"a":1}'); };
  radarFetch.fetchRadarJson(opts, function () { seen.push(mapIn(store).tomorrowio.status); return null; }, function () {});
  responder = function (url, type, onSuccess, onError) { onError({ code: 'status_403', detail: 'http_status' }); };
  radarFetch.fetchRadarJson(opts, function () { return null; }, function () {});
  assert.deepEqual(seen, [200, 403]);
  // Without the option nothing is recorded.
  delete opts.keyResult;
  responder = function (url, type, onSuccess, onError) { onError({ code: 'status_401', detail: 'http_status' }); };
  radarFetch.fetchRadarJson(opts, function () { return null; }, function () {});
  assert.equal(mapIn(store).tomorrowio.status, 403);
});
