const test = require('node:test');
const assert = require('node:assert/strict');

// Integration: outbox + PayloadComparator + dev-stats telemetry.

var store = {};
global.localStorage = {
  getItem: function(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
  setItem: function(k, v) { store[k] = String(v); },
  removeItem: function(k) { delete store[k]; }
};

var transmitted = [];
var nextSendOutcome = 'ack';
global.Pebble = {
  sendAppMessage: function(payload, onAck, onNack) {
    transmitted.push(payload);
    if (nextSendOutcome === 'ack') {
      onAck();
    }
    else {
      onNack({ error: 'test nack' });
    }
  }
};

const outbox = require('../src/pkjs/outbox');
// Same module instance outbox required (Node module cache).
const devStats = require('../src/pkjs/dev-stats');
const KEYS = require('../src/pkjs/storage-keys');

devStats.setEnabled(true);

const payload = {
  TEMP_TREND_UINT8: [200, 200],
  TEMP_MIN: -10,
  TEMP_MAX: 35,
  PRECIP_TREND_UINT8: [3],
  RAIN_TREND_UINT8: [4],
  FORECAST_START: 100,
  NUM_ENTRIES: 24,
  CURRENT_TEMP: 20,
  CITY: 'Berlin',
  SUN_EVENTS: [0, 1, 2]
};

// These tests run in sequence: each builds on the send/cache state left by
// the previous one (mirrors the real ack/nack/skip lifecycle of one payload).

test('first send: everything changed -> one AppMessage, caches committed, ack event', () => {
  outbox.sendWeather(payload);
  assert.equal(transmitted.length, 1);
  assert.equal(transmitted[0].CITY, 'Berlin');
  assert.equal(transmitted[0].FORECAST_START, 100);
  assert.equal(
    localStorage.getItem(KEYS.LAST_SENT_STATUS_KEY),
    JSON.stringify({ CURRENT_TEMP: 20, CITY: 'Berlin' }),
    'ACK must commit category caches'
  );
  const events = devStats.read();
  assert.equal(events.length, 1);
  assert.equal(events[0].k, 'weather');
  assert.equal(events[0].ok, 1);
  assert.deepEqual(events[0].c, { forecast: 1, status: 1, sun: 1 });
});

test('second identical send: full skip -> no AppMessage, skip event, all cached', () => {
  var skipSuccess = false;
  outbox.sendWeather(payload, function() { skipSuccess = true; });
  assert.equal(transmitted.length, 1, 'unchanged payload must not transmit');
  assert.equal(skipSuccess, true, 'skip still calls onSuccess');
  const events = devStats.read();
  assert.equal(events.length, 2);
  assert.equal(Object.prototype.hasOwnProperty.call(events[1], 'ok'), false);
  assert.deepEqual(events[1].c, { forecast: 0, status: 0, sun: 0 });
});

test('nack: changed payload, send fails -> caches untouched, nack event', () => {
  nextSendOutcome = 'nack';
  payload.CURRENT_TEMP = 21;
  var failed = false;
  outbox.sendWeather(payload, null, function() { failed = true; });
  assert.equal(failed, true);
  assert.equal(transmitted.length, 2);
  assert.equal(
    localStorage.getItem(KEYS.LAST_SENT_STATUS_KEY),
    JSON.stringify({ CURRENT_TEMP: 20, CITY: 'Berlin' }),
    'NACK must not commit caches'
  );
  const events = devStats.read();
  assert.equal(events[2].ok, 0);
  assert.deepEqual(events[2].c, { forecast: 0, status: 1, sun: 0 });
});

test('clay: first send transmits (setting/ack), identical second send skips', () => {
  nextSendOutcome = 'ack';
  outbox.sendClay({ CLAY_VIBE: true });
  outbox.sendClay({ CLAY_VIBE: true });
  assert.equal(transmitted.length, 3);
  const events = devStats.read();
  assert.equal(events.length, 5);
  assert.equal(events[3].k, 'setting');
  assert.equal(events[3].sent, 1);
  assert.equal(events[3].ok, 1);
  assert.equal(events[4].sent, 0);
  assert.equal(Object.prototype.hasOwnProperty.call(events[4], 'ok'), false);
});
