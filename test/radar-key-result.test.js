// test/radar-key-result.test.js — the last radar update's verdict on the user's own radar key
// (weather/radar-key-result.js), which the settings page reads as userData.radarKeyResult for
// the key status under "Rainbow (own key)" (settings/key-status.js). One record, the key's
// fingerprint and never the key, written only when it changes; only answers that say something
// about the key count. Then the keyed Rainbow path writing it (rainbow-radar.js), whose radar
// behaviour stays as it was.
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
const radarWire = require('../src/pkjs/weather/radar-wire.js');
const radarKeyResult = require('../src/pkjs/weather/radar-key-result.js');
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
 * The stored record, parsed.
 * @param {Object} store The mock's store.
 * @returns {?Object} The record.
 */
function recordIn(store) {
  const raw = store[KEYS.RADAR_KEY_RESULT_KEY];
  return raw ? JSON.parse(raw) : null;
}

test.afterEach(() => { delete global.localStorage; });

test('the storage key is its own', () => {
  assert.equal(KEYS.RADAR_KEY_RESULT_KEY, 'radarKeyResult');
});

test('record: the source, the key\'s fingerprint and the status — never the key', () => {
  const { store } = mockStorage();
  radarKeyResult.record('rainbowkey', '  ' + KEY + ' ', 401);
  assert.deepEqual(recordIn(store), { id: 'rainbowkey', keyHash: fingerprint(KEY), status: 401 });
  assert.equal(store[KEYS.RADAR_KEY_RESULT_KEY].indexOf(KEY), -1, 'the key itself is not stored');
});

test('record: 2xx reads as 200; 429, 401 and 403 count; anything else leaves the last verdict', () => {
  const { store } = mockStorage();
  radarKeyResult.record('rainbowkey', KEY, 204);
  assert.equal(recordIn(store).status, 200);
  [0, 404, 500, 502, -1, undefined].forEach((status) => {
    radarKeyResult.record('rainbowkey', KEY, status);
    assert.equal(recordIn(store).status, 200, String(status) + ' says nothing about the key');
  });
  [429, 401, 403].forEach((status) => {
    radarKeyResult.record('rainbowkey', KEY, status);
    assert.equal(recordIn(store).status, status);
  });
});

test('record: written only when it changes; no key or no storage writes nothing', () => {
  const { writes } = mockStorage();
  radarKeyResult.record('rainbowkey', KEY, 200);
  radarKeyResult.record('rainbowkey', KEY, 200);
  radarKeyResult.record('rainbowkey', KEY, 201);
  assert.equal(writes.length, 1, 'one write for three equal verdicts');
  radarKeyResult.record('rainbowkey', '   ', 401);
  radarKeyResult.record('', KEY, 401);
  assert.equal(writes.length, 1, 'a blank key or source writes nothing');
  delete global.localStorage;
  assert.doesNotThrow(() => radarKeyResult.record('rainbowkey', KEY, 401), 'no storage: nothing to do');
  global.localStorage = { getItem: () => null, setItem: () => { throw new Error('full'); } };
  assert.doesNotThrow(() => radarKeyResult.record('rainbowkey', KEY, 401), 'a full storage is not an error');
});

test('statusOfError reads the transport code', () => {
  assert.equal(radarKeyResult.statusOfError({ code: 'status_401' }), 401);
  assert.equal(radarKeyResult.statusOfError({ code: 'timeout' }), 0);
  assert.equal(radarKeyResult.statusOfError(null), 0);
});

// --- the keyed Rainbow path writes it -----------------------------------------------------------

/**
 * One keyed fetch whose request gets `answer`: a string is a 200 body, {code} a transport error.
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

test('the keyed path records a served key, a refused key and a key over its allowance', () => {
  const { store } = mockStorage();
  const served = keyedFetch(JSON.stringify({ latitude: 52.51, longitude: 13.41, forecast: [] }));
  assert.equal(served.RAIN_RADAR_START, SLOT0, 'the window as before');
  assert.deepEqual(recordIn(store), { id: 'rainbowkey', keyHash: fingerprint(KEY), status: 200 });

  assert.deepEqual(keyedFetch({ code: 'status_401' }), radarWire.clearRadarTuples(), 'the clear as before');
  assert.equal(recordIn(store).status, 401);

  assert.deepEqual(keyedFetch({ code: 'status_429' }), radarWire.limitedRadarTuples(), 'the limit notice as before');
  assert.equal(recordIn(store).status, 429);

  keyedFetch({ code: 'status_403' });
  assert.equal(recordIn(store).status, 403);
});

test('the keyed path leaves the verdict alone on answers that say nothing about the key', () => {
  const { store } = mockStorage();
  keyedFetch({ code: 'status_401' });
  assert.equal(keyedFetch({ code: 'status_503' }), null, 'a transient failure as before');
  assert.deepEqual(keyedFetch({ code: 'status_404' }), radarWire.flatRadarTuples(SLOT0), 'out of coverage as before');
  assert.equal(keyedFetch(''), null, 'an empty 200 (an Origin-neutered runtime) as before');
  assert.equal(recordIn(store).status, 401, 'still the refusal');
});

test('the shared proxy path records nothing', () => {
  const { store } = mockStorage();
  responder = function (url, type, onSuccess) { onSuccess(JSON.stringify({ forecast: [] })); };
  rainbowRadar.fetchRadarTuplesAt('https://proxy.example/rainbow', 52.5, 13.4, SLOT0, function () {});
  assert.equal(recordIn(store), null);
});
