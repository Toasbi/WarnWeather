const test = require('node:test');
const assert = require('node:assert/strict');

// radar.js captures WeatherProvider.request at load time, so stub it BEFORE
// requiring the module under test (same pattern as rainbow-radar.test.js).
const WeatherProvider = require('../src/pkjs/weather/provider.js');
let responder;
WeatherProvider.request = function(url, type, onSuccess, onError) { responder(url, type, onSuccess, onError); };
const radar = require('../src/pkjs/weather/radar.js');

const SLOT0 = 1700000100;   // 5-min aligned (1700000100 % 300 === 0)
const N = 24;

function zeros() { return new Array(N).fill(0); }

function respondWith(body) {
  responder = function(url, type, onSuccess) { onSuccess(JSON.stringify(body)); };
}

function fetchTuples(cb) {
  radar.fetchRadarTuplesAt(52.5, 13.4, SLOT0, cb);
}

test('requests Brightsky /radar with format=plain and the coordinates', () => {
  let seenUrl, seenType;
  responder = function(url, type, onSuccess) { seenUrl = url; seenType = type; onSuccess(JSON.stringify({ radar: [] })); };
  fetchTuples(function() {});
  assert.equal(seenType, 'GET');
  assert.ok(seenUrl.indexOf('/radar') >= 0, 'hits the /radar endpoint');
  assert.ok(seenUrl.indexOf('format=plain') >= 0, 'requests the plain grid format');
  assert.ok(seenUrl.indexOf('lat=52.5') >= 0 && seenUrl.indexOf('lon=13.4') >= 0, 'passes coordinates');
});

test('parses body.radar frames into slots 0..N in order (mm/h x10, x1.2 scale)', () => {
  // Three 1x1 grids: 10, 20, 0 (0.01 mm/5min); wire = clampByte(v * 1.2).
  respondWith({
    latlon_position: { x: 0, y: 0 },
    radar: [
      { precipitation_5: [[10]] },
      { precipitation_5: [[20]] },
      { precipitation_5: [[0]] }
    ]
  });
  let out;
  fetchTuples(function(t) { out = t; });
  const expected = zeros();
  expected[0] = 12;   // round(10 * 1.2) = 12
  expected[1] = 24;   // round(20 * 1.2) = 24
  assert.deepEqual(out.RAIN_RADAR_TREND_UINT8, expected);
  assert.equal(out.RAIN_RADAR_START, SLOT0);
});

test('bilinear-samples the exact point at a fractional sub-pixel position', () => {
  // 2x2 grid, user at (0.5, 0.5) => mean of the four corners = (0+40+80+100)/4 = 55.
  respondWith({
    latlon_position: { x: 0.5, y: 0.5 },
    radar: [{ precipitation_5: [[0, 40], [80, 100]] }]
  });
  let out;
  fetchTuples(function(t) { out = t; });
  assert.equal(out.RAIN_RADAR_TREND_UINT8[0], 66, 'round(55 * 1.2) = 66');
  // nearby = max over the 2 km disk = 100 => round(120) = 120 (>= exact, invariant holds).
  assert.equal(out.RAIN_RADAR_TREND_AREA_UINT8[0], 120);
});

test('nearby disk-max picks up a wet cell within 2 km even when the exact point is dry', () => {
  // Exact cell (col 0, row 1) is 0; a cell 2 grid units (~2 km) to its right is 90.
  respondWith({
    latlon_position: { x: 0, y: 1 },
    radar: [{ precipitation_5: [[0, 0, 0], [0, 0, 90], [0, 0, 0]] }]
  });
  let out;
  fetchTuples(function(t) { out = t; });
  assert.equal(out.RAIN_RADAR_TREND_UINT8[0], 0, 'exact point is dry');
  assert.equal(out.RAIN_RADAR_TREND_AREA_UINT8[0], 108, 'nearby max = round(90 * 1.2) = 108');
});

test('out-of-coverage (radar: []) ships 24 zeros with slotZeroEpoch (not a failure)', () => {
  respondWith({ latlon_position: { x: 0, y: 0 }, radar: [] });
  let out = 'unset';
  fetchTuples(function(t) { out = t; });
  assert.deepEqual(out.RAIN_RADAR_TREND_UINT8, zeros());
  assert.deepEqual(out.RAIN_RADAR_TREND_AREA_UINT8, zeros());
  assert.equal(out.RAIN_RADAR_START, SLOT0);
});

test('transient request failure (onError) -> callback(null) preserves the watch radar', () => {
  responder = function(url, type, onSuccess, onError) { onError({ code: 'status_502' }); };
  let out = 'unset';
  fetchTuples(function(t) { out = t; });
  assert.equal(out, null);
});

test('parse error -> callback(null)', () => {
  responder = function(url, type, onSuccess) { onSuccess('not json'); };
  let out = 'unset';
  fetchTuples(function(t) { out = t; });
  assert.equal(out, null);
});

test('missing body.radar field -> callback(null)', () => {
  respondWith({ latlon_position: { x: 0, y: 0 } });
  let out = 'unset';
  fetchTuples(function(t) { out = t; });
  assert.equal(out, null);
});
