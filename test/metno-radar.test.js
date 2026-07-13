// test/metno-radar.test.js
// Met.no Nowcast 2.0 → radar tuples. The API returns 23 strictly contiguous
// 5-min frames whose first frame is the current 5-min boundary (verified
// live), so mapping is a 1:1 index copy — no gap filling; slot 23 stays 0.
const test = require('node:test');
const assert = require('node:assert/strict');

// Stub the shared XHR BEFORE requiring the module under test (it captures
// WeatherProvider.request at load time — same pattern as rainbow-radar.test.js).
const WeatherProvider = require('../src/pkjs/weather/provider.js');
var responder;
WeatherProvider.request = function(url, type, onSuccess, onError, headers) {
  responder(url, type, onSuccess, onError, headers);
};
const metnoRadar = require('../src/pkjs/weather/metno-radar.js');

const SLOT0 = 1700000100;   // 5-min aligned (1700000100 % 300 === 0)
const SLOT = 300;
const N = 24;

function zeros() { return new Array(N).fill(0); }

function iso(epoch) { return new Date(epoch * 1000).toISOString().replace('.000Z', 'Z'); }

/** Build a nowcast body: one frame per rate, 5-min steps from firstEpoch. */
function nowcastBody(rates, coverage, firstEpoch) {
  const start = firstEpoch === undefined ? SLOT0 : firstEpoch;
  return {
    properties: {
      meta: { radar_coverage: coverage === undefined ? 'ok' : coverage },
      timeseries: rates.map((r, i) => ({
        time: iso(start + i * SLOT),
        data: { instant: { details: { precipitation_rate: r } } }
      }))
    }
  };
}

function respondWith(body) {
  responder = function(url, type, onSuccess) { onSuccess(JSON.stringify(body)); };
}

function fetchTuples(cb) {
  metnoRadar.fetchRadarTuplesAt(52.5, 13.4, SLOT0, cb);
}

test('builds the nowcast URL with 4-decimal coords and passes the Met.no headers', () => {
  let seenUrl, seenType, seenHeaders;
  responder = function(url, type, onSuccess, onError, headers) {
    seenUrl = url; seenType = type; seenHeaders = headers;
    onSuccess(JSON.stringify(nowcastBody([0])));
  };
  metnoRadar.fetchRadarTuplesAt(52.520008, 13.4049995, SLOT0, function() {});
  assert.equal(seenUrl, 'https://api.met.no/weatherapi/nowcast/2.0/complete?lat=52.52&lon=13.405');
  assert.equal(seenType, 'GET');
  assert.equal(seenHeaders['User-Agent'], 'WarnWeather github.com/Toasbi/WarnWeather');
  assert.equal(seenHeaders['Origin'], 'https://github.com/Toasbi/WarnWeather');
});

test('copies 23 frames 1:1 by index (mm/h ×10); slot 23 stays 0', () => {
  const rates = [];
  for (let i = 0; i < 23; i += 1) { rates.push(i * 0.1); }   // 0.0, 0.1, ... 2.2 mm/h
  respondWith(nowcastBody(rates));
  let out;
  fetchTuples(function(t) { out = t; });
  for (let i = 0; i < 23; i += 1) {
    assert.equal(out.RAIN_RADAR_TREND_UINT8[i], i, 'slot ' + i);
  }
  assert.equal(out.RAIN_RADAR_TREND_UINT8[23], 0, 'slot 23 has no frame and stays 0');
  assert.equal(out.RAIN_RADAR_START, SLOT0);
});

test('RAIN_RADAR_START comes from the first frame, not the passed slot epoch', () => {
  respondWith(nowcastBody([1, 2], 'ok', SLOT0 + SLOT));
  let out;
  fetchTuples(function(t) { out = t; });
  assert.equal(out.RAIN_RADAR_START, SLOT0 + SLOT);
});

test('saturates at 255 (25.5 mm/h) and rounds the ×10 scaling', () => {
  respondWith(nowcastBody([30, 0.16]));
  let out;
  fetchTuples(function(t) { out = t; });
  assert.equal(out.RAIN_RADAR_TREND_UINT8[0], 255);
  assert.equal(out.RAIN_RADAR_TREND_UINT8[1], 2, '0.16 mm/h → round(1.6) = 2');
});

test('area array is always 24 zeros (point nowcast, like Rainbow)', () => {
  respondWith(nowcastBody([5, 5, 5]));
  let out;
  fetchTuples(function(t) { out = t; });
  assert.deepEqual(out.RAIN_RADAR_TREND_AREA_UINT8, zeros());
});

test("coverage 'temporarily unavailable' → null (radar outage keeps watch radar)", () => {
  respondWith(nowcastBody([0], 'temporarily unavailable'));
  let out = 'unset';
  fetchTuples(function(t) { out = t; });
  assert.equal(out, null);
});

test("coverage 'no coverage' → 24 zeros with the passed slot epoch", () => {
  respondWith(nowcastBody([], 'no coverage'));
  let out;
  fetchTuples(function(t) { out = t; });
  assert.deepEqual(out.RAIN_RADAR_TREND_UINT8, zeros());
  assert.deepEqual(out.RAIN_RADAR_TREND_AREA_UINT8, zeros());
  assert.equal(out.RAIN_RADAR_START, SLOT0);
});

test('HTTP 422 (outside Nordic product area) → 24 zeros', () => {
  responder = function(url, type, onSuccess, onError) { onError({ code: 'status_422', detail: 'http_status' }); };
  let out;
  fetchTuples(function(t) { out = t; });
  assert.deepEqual(out.RAIN_RADAR_TREND_UINT8, zeros());
  assert.equal(out.RAIN_RADAR_START, SLOT0);
});

test('other HTTP failure → null (watch keeps its existing radar)', () => {
  responder = function(url, type, onSuccess, onError) { onError({ code: 'status_502', detail: 'http_status' }); };
  let out = 'unset';
  fetchTuples(function(t) { out = t; });
  assert.equal(out, null);
});

test('parse failure → null', () => {
  responder = function(url, type, onSuccess) { onSuccess('not json'); };
  let out = 'unset';
  fetchTuples(function(t) { out = t; });
  assert.equal(out, null);
});

test('unparsable first-frame time → null', () => {
  const body = nowcastBody([1]);
  body.properties.timeseries[0].time = 'garbage';
  respondWith(body);
  let out = 'unset';
  fetchTuples(function(t) { out = t; });
  assert.equal(out, null);
});
