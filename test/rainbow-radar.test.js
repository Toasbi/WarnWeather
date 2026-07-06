const test = require('node:test');
const assert = require('node:assert/strict');

// Mock the shared XHR BEFORE requiring the module under test: rainbow-radar.js
// captures WeatherProvider.request at load time (same pattern as dwd.test.js).
const WeatherProvider = require('../src/pkjs/weather/provider.js');
var responder;
WeatherProvider.request = function(url, type, onSuccess, onError) { responder(url, type, onSuccess, onError); };
const rainbowRadar = require('../src/pkjs/weather/rainbow-radar.js');

const ENDPOINT = 'https://xyz.supabase.co/functions/v1/rainbow-nowcast';
const SLOT0 = 1700000100;   // 5-min aligned (1700000100 % 300 === 0)
const SLOT = 300;
const N = 24;

function zeros() { return new Array(N).fill(0); }

function respondWith(body) {
  responder = function(url, type, onSuccess) { onSuccess(JSON.stringify(body)); };
}

function fetchTuples(cb) {
  rainbowRadar.fetchRadarTuplesAt(ENDPOINT, 52.5, 13.4, SLOT0, cb);
}

test('builds the proxy URL with lat/lon/start and GETs it', () => {
  let seenUrl, seenType;
  responder = function(url, type, onSuccess) { seenUrl = url; seenType = type; onSuccess(JSON.stringify({ forecast: [] })); };
  fetchTuples(function() {});
  assert.equal(seenUrl, ENDPOINT + '?lat=52.5&lon=13.4&start=' + SLOT0);
  assert.equal(seenType, 'GET');
});

test('maps forecast intervals onto 5-min slots (mm/h ×10)', () => {
  // Interval covering slots 0-1 at 1.2 mm/h, an explicit dry interval for
  // slots 2-3, then 0.5 mm/h through the rest of the 2 h window.
  respondWith({ longitude: 13.4, latitude: 52.5, forecast: [
    { precipRate: 1.2, precipType: 'rain', timestampBegin: SLOT0,            timestampEnd: SLOT0 + 2 * SLOT },
    { precipRate: 0,   precipType: 'rain', timestampBegin: SLOT0 + 2 * SLOT, timestampEnd: SLOT0 + 4 * SLOT },
    { precipRate: 0.5, precipType: 'rain', timestampBegin: SLOT0 + 4 * SLOT, timestampEnd: SLOT0 + 24 * SLOT }
  ] });
  let out;
  fetchTuples(function(t) { out = t; });
  const expected = zeros();
  expected[0] = 12; expected[1] = 12;
  for (let i = 4; i < N; i += 1) { expected[i] = 5; }
  assert.deepEqual(out.RAIN_RADAR_TREND_UINT8, expected);
  assert.equal(out.RAIN_RADAR_START, SLOT0);
});

test('saturates at 255 (25.5 mm/h) and rounds the ×10 scaling', () => {
  respondWith({ forecast: [
    { precipRate: 30,   timestampBegin: SLOT0,        timestampEnd: SLOT0 + SLOT },
    { precipRate: 0.16, timestampBegin: SLOT0 + SLOT, timestampEnd: SLOT0 + 2 * SLOT }
  ] });
  let out;
  fetchTuples(function(t) { out = t; });
  assert.equal(out.RAIN_RADAR_TREND_UINT8[0], 255, '30 mm/h saturates the wire byte');
  assert.equal(out.RAIN_RADAR_TREND_UINT8[1], 2, '0.16 mm/h → round(1.6) = 2');
});

test('slot 0 before forecast[0] inherits forecast[0].precipRate (gap guard)', () => {
  // forecast starts 2 min after slot 0: slot 0 must NOT read as a spurious dry "now".
  respondWith({ forecast: [
    { precipRate: 2, timestampBegin: SLOT0 + 120, timestampEnd: SLOT0 + 24 * SLOT }
  ] });
  let out;
  fetchTuples(function(t) { out = t; });
  assert.equal(out.RAIN_RADAR_TREND_UINT8[0], 20, 'slot 0 inherits the first interval');
  assert.equal(out.RAIN_RADAR_TREND_UINT8[1], 20, 'slot 1 covered normally');
});

test('slots with no covering interval are 0 (gaps and beyond the horizon)', () => {
  respondWith({ forecast: [
    { precipRate: 1, timestampBegin: SLOT0,            timestampEnd: SLOT0 + SLOT },
    { precipRate: 1, timestampBegin: SLOT0 + 2 * SLOT, timestampEnd: SLOT0 + 3 * SLOT }
  ] });
  let out;
  fetchTuples(function(t) { out = t; });
  assert.equal(out.RAIN_RADAR_TREND_UINT8[1], 0, 'uncovered gap slot is dry');
  assert.equal(out.RAIN_RADAR_TREND_UINT8[3], 0, 'slot beyond the last interval is dry');
  assert.equal(out.RAIN_RADAR_TREND_UINT8[23], 0, 'horizon end is dry');
});

test('empty forecast → 24 zeros (out-of-coverage clear, not a failure)', () => {
  respondWith({ forecast: [] });
  let out;
  fetchTuples(function(t) { out = t; });
  assert.deepEqual(out.RAIN_RADAR_TREND_UINT8, zeros());
});

test('missing forecast field → 24 zeros', () => {
  respondWith({ longitude: 13.4, latitude: 52.5 });
  let out;
  fetchTuples(function(t) { out = t; });
  assert.deepEqual(out.RAIN_RADAR_TREND_UINT8, zeros());
});

test('area array is always 24 zeros (a point provider has no nearby signal)', () => {
  respondWith({ forecast: [
    { precipRate: 5, timestampBegin: SLOT0, timestampEnd: SLOT0 + 24 * SLOT }
  ] });
  let out;
  fetchTuples(function(t) { out = t; });
  assert.deepEqual(out.RAIN_RADAR_TREND_AREA_UINT8, zeros());
});

test('empty endpoint → one warning + callback(null), no network', () => {
  let requested = false;
  responder = function() { requested = true; };
  const logs = [];
  const origLog = console.log;
  console.log = function(m) { logs.push(m); };
  let out = 'unset';
  try {
    rainbowRadar.fetchRadarTuplesAt('', 52.5, 13.4, SLOT0, function(t) { out = t; });
  }
  finally {
    console.log = origLog;
  }
  assert.equal(out, null);
  assert.equal(requested, false);
  assert.equal(logs.length, 1, 'exactly one warning for this fetch (no persistent latch)');
  assert.ok(logs[0].indexOf('proxy endpoint') >= 0, 'warns about the missing endpoint');
});

test('HTTP failure → callback(null) (watch keeps its existing radar)', () => {
  responder = function(url, type, onSuccess, onError) { onError({ code: 'status_502', detail: 'http_status' }); };
  let out = 'unset';
  fetchTuples(function(t) { out = t; });
  assert.equal(out, null);
});

test('parse failure → callback(null)', () => {
  responder = function(url, type, onSuccess) { onSuccess('not json'); };
  let out = 'unset';
  fetchTuples(function(t) { out = t; });
  assert.equal(out, null);
});
