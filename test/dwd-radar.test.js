const test = require('node:test');
const assert = require('node:assert/strict');

// dwd-radar.js reaches the network through radar-fetch.js, which resolves
// WeatherProvider.request at call time — stubbing it on the provider module
// works at any point before a fetch runs (same pattern as rainbow-radar.test.js).
const WeatherProvider = require('../src/pkjs/weather/provider.js');
let responder;
WeatherProvider.request = function(url, type, onSuccess, onError) { responder(url, type, onSuccess, onError); };
const radar = require('../src/pkjs/weather/dwd-radar.js');

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

test('transient request failure (onError) -> callback(null): no radar keys in this send', () => {
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

// A frame is stamped at the END of its 5 minutes (Brightsky's RadarParser
// reads the RV product's enddate/endtime): frame T is [T-5min, T). Slot i is
// [SLOT0 + 5i, SLOT0 + 5i + 5), so it takes the frame stamped SLOT0 + 5(i+1).
const iso = (epoch) => new Date(epoch * 1000).toISOString().replace('.000Z', '+00:00');
const framesAt = (stamps, wet) => stamps.map((t) => ({
  timestamp: iso(t), precipitation_5: [[wet.indexOf(t) !== -1 ? 50 : 0]]
}));
const minutes = (from, to) => {
  const out = [];
  for (let m = from; m <= to; m += 5) { out.push(SLOT0 + m * 60); }
  return out;
};

test('asks for the frames that close each slot: one frame past slot 0 through the 2 h mark', () => {
  let seenUrl;
  responder = function(url, type, onSuccess) { seenUrl = url; onSuccess(JSON.stringify({ radar: [] })); };
  fetchTuples(function() {});
  const q = (k) => decodeURIComponent(new RegExp('[?&]' + k + '=([^&]+)').exec(seenUrl)[1]);
  assert.equal(Date.parse(q('date')) / 1000, SLOT0 + 300, 'slot 0 is closed by the frame 5 min on');
  assert.equal(Date.parse(q('last_date')) / 1000, SLOT0 + 24 * 300, 'slot 23 by the one at +2 h');
});

test('a frame fills the slot its 5 minutes cover, by its timestamp', () => {
  // Rain stamped +15 and +20 fell 10-20 min from slot 0: slots 2 and 3.
  respondWith({ latlon_position: { x: 0, y: 0 },
    radar: framesAt(minutes(5, 120), [SLOT0 + 15 * 60, SLOT0 + 20 * 60]) });
  let out;
  fetchTuples(function(t) { out = t; });
  const expected = zeros();
  expected[2] = 60;
  expected[3] = 60;
  assert.deepEqual(out.RAIN_RADAR_TREND_UINT8, expected);
  assert.equal(out.RAIN_RADAR_START, SLOT0, 'the window still opens at slot 0');

  // A frame Brightsky skips leaves its slot dry; it does not slide the rest.
  respondWith({ latlon_position: { x: 0, y: 0 },
    radar: framesAt(minutes(5, 120).filter((t) => t !== SLOT0 + 15 * 60), [SLOT0 + 20 * 60]) });
  fetchTuples(function(t) { out = t; });
  assert.equal(out.RAIN_RADAR_TREND_UINT8[2], 0);
  assert.equal(out.RAIN_RADAR_TREND_UINT8[3], 60, 'the +20 frame stays in slot 3');

  // A frame for the five minutes before slot 0, or one off the 5-min grid,
  // has no slot.
  respondWith({ latlon_position: { x: 0, y: 0 },
    radar: framesAt([SLOT0, SLOT0 + 5 * 60 + 30], [SLOT0, SLOT0 + 5 * 60 + 30]) });
  fetchTuples(function(t) { out = t; });
  assert.deepEqual(out.RAIN_RADAR_TREND_UINT8, zeros());
});

test('past the newest run\'s 2 h horizon the last frame holds, briefly', () => {
  // The run stamped slot 0 is not out yet: frames stop at +115, and slot 23
  // repeats slot 22 rather than reading a shower as ending there.
  respondWith({ latlon_position: { x: 0, y: 0 },
    radar: framesAt(minutes(5, 115), minutes(100, 115)) });
  let out;
  fetchTuples(function(t) { out = t; });
  assert.deepEqual(out.RAIN_RADAR_TREND_UINT8.slice(18), [0, 60, 60, 60, 60, 60]);
  // Two slots at most: frames that stop at +105 leave slot 23 dry.
  respondWith({ latlon_position: { x: 0, y: 0 },
    radar: framesAt(minutes(5, 105), minutes(90, 105)) });
  fetchTuples(function(t) { out = t; });
  assert.deepEqual(out.RAIN_RADAR_TREND_UINT8.slice(17), [60, 60, 60, 60, 60, 60, 0]);
  assert.deepEqual(out.RAIN_RADAR_TREND_AREA_UINT8.slice(17), [60, 60, 60, 60, 60, 60, 0]);
});
