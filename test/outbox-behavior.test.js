const test = require('node:test');
const assert = require('node:assert/strict');

// Capture each send; tests fire ack/nack manually. Set before requiring outbox.
var sent = [];
global.Pebble = {
  sendAppMessage: function(payload, ack, nack) { sent.push({ payload: payload, ack: ack, nack: nack }); }
};
var store = {};
global.localStorage = {
  getItem: function(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
  setItem: function(k, v) { store[k] = String(v); },
  removeItem: function(k) { delete store[k]; }
};

const KEYS = require('../src/pkjs/storage-keys');
const outbox = require('../src/pkjs/outbox');

function reset() { for (var k in store) { delete store[k]; } sent = []; }

const FORECAST_AND_STATUS = {
  TEMP_TREND_UINT8: [1], TEMP_MIN: 0, TEMP_MAX: 1, NUM_ENTRIES: 1, FORECAST_START: 100,
  STATUS_LINE_1_UINT8: [1], STATUS_LINE_2_UINT8: [2],
  STATUS_LINE_3_UINT8: [3], STATUS_LINE_4_UINT8: [4]
};

test('bundles changed categories into a single send', () => {
  reset();
  outbox.sendWeather(FORECAST_AND_STATUS);
  assert.equal(sent.length, 1, 'exactly one sendAppMessage for two changed categories');
  assert.ok('TEMP_TREND_UINT8' in sent[0].payload, 'carries forecast keys');
  assert.ok('STATUS_LINE_4_UINT8' in sent[0].payload, 'carries all status keys in the SAME send');
});

test('commits the last-sent cache only after the ACK fires', () => {
  reset();
  outbox.sendWeather(FORECAST_AND_STATUS);
  assert.equal(global.localStorage.getItem(KEYS.LAST_SENT_FORECAST_KEY), null, 'no commit before ACK');
  assert.equal(global.localStorage.getItem(KEYS.LAST_SENT_STATUS_KEY), null, 'no commit before ACK');
  sent[0].ack();
  assert.ok(global.localStorage.getItem(KEYS.LAST_SENT_FORECAST_KEY) !== null, 'forecast committed on ACK');
  assert.ok(global.localStorage.getItem(KEYS.LAST_SENT_STATUS_KEY) !== null, 'status committed on ACK');
});

test('a NACK leaves caches untouched so the next send retries', () => {
  reset();
  outbox.sendWeather(FORECAST_AND_STATUS);
  sent[0].nack({ error: true });
  assert.equal(global.localStorage.getItem(KEYS.LAST_SENT_FORECAST_KEY), null, 'no commit on NACK');
  outbox.sendWeather(FORECAST_AND_STATUS);
  assert.equal(sent.length, 2, 'identical payload re-sends after a NACK (not skipped)');
});

test('skips the send when nothing changed and still calls onSuccess', () => {
  reset();
  outbox.sendWeather(FORECAST_AND_STATUS);
  sent[0].ack();           // prime the caches
  sent = [];
  var ok = false;
  outbox.sendWeather(FORECAST_AND_STATUS, function() { ok = true; });
  assert.equal(sent.length, 0, 'no send when nothing changed');
  assert.equal(ok, true, 'onSuccess still called on a no-op');
});

test('sendClay sends only the Clay payload keys and commits to the Clay cache', () => {
  reset();
  outbox.sendClay({ CLAY_CELSIUS: true, CLAY_TIME_FONT: 1 });
  assert.equal(sent.length, 1);
  assert.deepEqual(Object.keys(sent[0].payload).sort(), ['CLAY_CELSIUS', 'CLAY_TIME_FONT']);
  sent[0].ack();
  assert.ok(global.localStorage.getItem(KEYS.LAST_SENT_CLAY_KEY) !== null, 'commits to the Clay cache');
  assert.equal(global.localStorage.getItem(KEYS.LAST_SENT_FORECAST_KEY), null, 'does not touch weather caches');
});
