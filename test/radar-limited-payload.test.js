// test/radar-limited-payload.test.js
//
// The radar answer through the REAL provider success path: fetchWithCoordinates
// → composeWeatherPayload (merges the fetch cycle's extras) → the render
// transform (forecast-series.js applyForecastSeries, which rewrites the payload
// in place) → the outbox → Pebble.sendAppMessage. The fetch-cycle harnesses
// (radar-permanent-failure, rainbow-radar-throttle) stub fetchWithCoordinates
// and merge the extras by hand, so a change to this path that dropped the limit
// notice or the radar arrays would pass them all.
const test = require('node:test');
const assert = require('node:assert/strict');

// AGENTS.md: the storage mock goes in BEFORE the watch modules load
// (applyForecastSeries reaches phone-battery.js, the outbox its caches).
var store = {};
global.localStorage = {
  getItem: function(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
  setItem: function(k, v) { store[k] = String(v); },
  removeItem: function(k) { delete store[k]; }
};
var sent = [];
global.Pebble = {
  sendAppMessage: function(payload, ack) { sent.push(payload); if (ack) { ack(); } }
};

const WeatherProvider = require('../src/pkjs/weather/provider.js');
const airQuality = require('../src/pkjs/weather/air-quality.js');
const pollen = require('../src/pkjs/weather/pollen.js');
const forecastSeries = require('../src/pkjs/forecast-series.js');
const radarWire = require('../src/pkjs/weather/radar-wire.js');

const RADAR_ARRAYS = ['RAIN_RADAR_TREND_UINT8', 'RAIN_RADAR_TREND_AREA_UINT8', 'RAIN_RADAR_START'];
const SETTINGS = {
  provider: 'dwd', secondaryLine: 'precip_prob', thirdLine: 'off', barSource: 'off', theme: 'dark'
};
const WATCH = { platform: 'basalt' };
const N = 24;

/** The fetch cycle's transform (fetch-cycle.js hands the provider this one). */
function transform(payload) {
  return forecastSeries.applyForecastSeries(payload, SETTINGS, WATCH);
}

/** A provider whose data stages answer at once with a valid 24-hour forecast. */
function makeProvider() {
  const provider = new WeatherProvider();
  provider.withCityName = function(lat, lon, done) { done('Berlin', 'DE'); };
  provider.withSunEvents = function(lat, lon, done) {
    done([{ type: 'sunrise', date: new Date(1790003600000) }]);
  };
  provider.withProviderData = function(lat, lon, force, done) {
    const temps = [];
    const precips = [];
    for (let i = 0; i < N; i += 1) { temps.push(60 + (i % 5)); precips.push(i % 3 === 0 ? 0.2 : 0); }
    provider.tempTrend = temps;
    provider.precipTrend = precips;
    provider.currentTemp = 61;
    provider.startTime = 1790000000;
    provider.numEntries = N;
    done();
  };
  return provider;
}

/** Run `fn` with the keyless AQI and pollen lookups answering nothing, off the network. */
function withoutAuxFetches(fn) {
  const originalAqi = airQuality.fetchAqiInto;
  const originalPollen = pollen.fetchPollenInto;
  airQuality.fetchAqiInto = function(p, lat, lon, done) { done(); };
  pollen.fetchPollenInto = function(p, lat, lon, done) { done(); };
  try { fn(); } finally {
    airQuality.fetchAqiInto = originalAqi;
    pollen.fetchPollenInto = originalPollen;
  }
}

function reset() {
  for (const k in store) { delete store[k]; }
  sent = [];
}

test('composeWeatherPayload keeps the limit notice through the render transform, with no radar arrays', () => {
  reset();
  const provider = makeProvider();
  provider.withProviderData(0, 0, false, function() {});
  provider.cityName = 'Berlin';
  provider.sunEvents = [];
  const payload = provider.composeWeatherPayload(
    Object.assign({ IS_SLEEPING: false }, radarWire.limitedRadarTuples()), transform);
  assert.equal(payload.RAIN_RADAR_LIMITED, 1);
  RADAR_ARRAYS.forEach(function(k) { assert.equal(k in payload, false, k + ' must not ride with the notice'); });
  // The transform really ran: the wire temp series replaced the transient one.
  assert.ok(Array.isArray(payload.TEMP_TREND_UINT8), 'the forecast series were built');
  assert.equal('TEMP_RAW_TREND' in payload, false, 'the transient temps were consumed');
});

test('the limit notice reaches the wire through fetchWithCoordinates and the outbox', () => {
  reset();
  const provider = makeProvider();
  let ok = 0;
  withoutAuxFetches(function() {
    provider.fetchWithCoordinates(52.5, 13.4, function() { ok += 1; }, assert.fail, false,
      Object.assign({ IS_SLEEPING: false }, radarWire.limitedRadarTuples()), transform);
  });
  assert.equal(ok, 1, 'the fetch succeeds');
  assert.equal(sent.length, 1, 'one bundled send');
  assert.equal(sent[0].RAIN_RADAR_LIMITED, 1, 'the notice rides the weather message');
  RADAR_ARRAYS.forEach(function(k) { assert.equal(k in sent[0], false, k + ' stays off the wire'); });
  assert.ok(Array.isArray(sent[0].TEMP_TREND_UINT8), 'beside the forecast it came with');
});

test('a radar window reaches the wire through the same path, without the notice', () => {
  reset();
  const provider = makeProvider();
  const exact = [];
  const area = [];
  for (let i = 0; i < N; i += 1) { exact.push(i >= 12 ? 30 : 0); area.push(i >= 10 ? 20 : 0); }
  withoutAuxFetches(function() {
    provider.fetchWithCoordinates(52.5, 13.4, function() {}, assert.fail, false, {
      IS_SLEEPING: false,
      RAIN_RADAR_TREND_UINT8: exact,
      RAIN_RADAR_TREND_AREA_UINT8: area,
      RAIN_RADAR_START: 1790000100
    }, transform);
  });
  assert.equal(sent.length, 1, 'one bundled send');
  assert.deepEqual(sent[0].RAIN_RADAR_TREND_UINT8, exact);
  assert.deepEqual(sent[0].RAIN_RADAR_TREND_AREA_UINT8, area);
  assert.equal(sent[0].RAIN_RADAR_START, 1790000100);
  assert.equal('RAIN_RADAR_LIMITED' in sent[0], false, 'no notice with a window');
});
