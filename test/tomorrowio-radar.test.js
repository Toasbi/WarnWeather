// test/tomorrowio-radar.test.js
const test = require('node:test');
const assert = require('node:assert/strict');

// Mock the shared XHR BEFORE requiring the module under test (it captures
// WeatherProvider.request at load time — same pattern as rainbow-radar.test.js).
const WeatherProvider = require('../src/pkjs/weather/provider.js');
var responder;
WeatherProvider.request = function(url, type, onSuccess, onError) { responder(url, type, onSuccess, onError); };
const tomorrowioRadar = require('../src/pkjs/weather/tomorrowio-radar.js');

const SLOT0 = 1700000100;   // 5-min aligned (1700000100 % 300 === 0)
const SLOT = 300;
const N = 24;

function zeros() { return new Array(N).fill(0); }

/** intervals[i] at SLOT0 + i*300 with the given mm/h rates. */
function body(rates) {
  const intervals = rates.map((rate, i) => ({
    startTime: new Date((SLOT0 + i * SLOT) * 1000).toISOString(),
    values: { precipitationIntensity: rate }
  }));
  return { data: { timelines: [{ timestep: '5m', intervals }] } };
}

function fetchTuples(cb) {
  tomorrowioRadar.fetchRadarTuplesAt('KEY123', 52.5, 13.4, SLOT0, cb);
}

test('builds the 5m Timelines URL with key, location and slot-0 start', () => {
  let seenUrl, seenType;
  responder = function(url, type, onSuccess) { seenUrl = url; seenType = type; onSuccess(JSON.stringify(body([0]))); };
  fetchTuples(function() {});
  assert.equal(seenType, 'GET');
  assert.match(seenUrl, /^https:\/\/api\.tomorrow\.io\/v4\/timelines\?/);
  assert.match(seenUrl, /location=52\.5,13\.4/);
  assert.match(seenUrl, /timesteps=5m/);
  assert.match(seenUrl, /fields=precipitationIntensity/);
  assert.match(seenUrl, /apikey=KEY123/);
  assert.ok(seenUrl.indexOf('startTime=' + encodeURIComponent(new Date(SLOT0 * 1000).toISOString())) >= 0);
});

test('maps 5-min frames 1:1 (mm/h ×10) with single-point zero area and data-anchored start', () => {
  const rates = new Array(23).fill(0);
  rates[0] = 1.2; rates[1] = 1.2; rates[4] = 0.5;
  responder = (url, type, onSuccess) => onSuccess(JSON.stringify(body(rates)));
  let out;
  fetchTuples((t) => { out = t; });
  const expected = zeros();
  expected[0] = 12; expected[1] = 12; expected[4] = 5;   // slot 23 stays 0 (23 frames)
  assert.deepEqual(out.RAIN_RADAR_TREND_UINT8, expected);
  assert.deepEqual(out.RAIN_RADAR_TREND_AREA_UINT8, zeros());
  assert.equal(out.RAIN_RADAR_START, SLOT0);
});

test('saturates at 255 (25.5 mm/h and up)', () => {
  const rates = new Array(24).fill(0);
  rates[0] = 99;
  responder = (url, type, onSuccess) => onSuccess(JSON.stringify(body(rates)));
  let out;
  fetchTuples((t) => { out = t; });
  assert.equal(out.RAIN_RADAR_TREND_UINT8[0], 255);
});

test('missing key, parse error, HTTP error, and empty intervals all soft-fail with null', () => {
  let out = 'unset';
  tomorrowioRadar.fetchRadarTuplesAt('', 52.5, 13.4, SLOT0, (t) => { out = t; });
  assert.equal(out, null, 'missing key');

  responder = (url, type, onSuccess) => onSuccess('not json');
  out = 'unset'; fetchTuples((t) => { out = t; });
  assert.equal(out, null, 'parse error');

  responder = (url, type, onSuccess, onError) => onError({ code: 'status_429', detail: 'http_status' });
  out = 'unset'; fetchTuples((t) => { out = t; });
  assert.equal(out, null, 'HTTP 429');

  responder = (url, type, onSuccess) => onSuccess(JSON.stringify({ data: { timelines: [{ intervals: [] }] } }));
  out = 'unset'; fetchTuples((t) => { out = t; });
  assert.equal(out, null, 'empty intervals');
});
