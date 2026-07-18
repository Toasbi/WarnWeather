// Install a localStorage mock BEFORE any watch module loads (provider.js pulls
// in storage-consuming modules). See test/change-detector.test.js for the pattern.
global.localStorage = (function () {
  const store = {};
  return {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    clear: () => { Object.keys(store).forEach((k) => delete store[k]); }
  };
})();

const test = require('node:test');
const assert = require('node:assert/strict');
const aq = require('../src/pkjs/weather/air-quality.js');

const START = 1767258000;
const H = 3600;

test('buildAqiUrl targets the keyless air-quality host with the scale field', () => {
  const eu = aq.buildAqiUrl(49.2, 7.0, 'european');
  assert.ok(eu.indexOf('air-quality-api.open-meteo.com/v1/air-quality') !== -1);
  assert.ok(eu.indexOf('hourly=european_aqi') !== -1);
  assert.ok(eu.indexOf('timeformat=unixtime') !== -1);
  assert.ok(eu.indexOf('latitude=49.2') !== -1);
  assert.ok(aq.buildAqiUrl(49.2, 7.0, 'us').indexOf('hourly=us_aqi') !== -1);
});

test('mapAqi aligns hourly AQI to startTime by timestamp', () => {
  const json = { hourly: { time: [START - H, START, START + H], european_aqi: [10, 42, 55] } };
  const out = aq.mapAqi(json, START, 'european');
  assert.equal(out[0], 42);
  assert.equal(out[1], 55);
});

test('mapAqi reads us_aqi for the us scale and nulls missing buckets', () => {
  const out = aq.mapAqi({ hourly: { time: [START], us_aqi: [99] } }, START, 'us');
  assert.equal(out[0], 99);
  assert.equal(out[1], null);
});

test('mapAqi returns null on malformed input', () => {
  assert.equal(aq.mapAqi({}, 0, 'european'), null);
  assert.equal(aq.mapAqi({ hourly: { time: 5 } }, 0, 'european'), null);
});

test('fetchAqiInto is a no-op when provider.fetchAqi is false', () => {
  let called = false;
  const provider = { fetchAqi: false };
  aq.fetchAqiInto(provider, 1, 2, () => { called = true; });
  assert.equal(called, true);
  assert.equal(provider.aqiTrend, undefined);
});

test('fetchAqiInto populates aqiTrend on success', () => {
  const WeatherProvider = require('../src/pkjs/weather/provider.js');
  const orig = WeatherProvider.request;
  WeatherProvider.request = (url, method, onSuccess) =>
    onSuccess(JSON.stringify({ hourly: { time: [START], european_aqi: [42] } }));
  const provider = { fetchAqi: true, aqiScale: 'european', startTime: START };
  let done = false;
  aq.fetchAqiInto(provider, 1, 2, () => { done = true; });
  WeatherProvider.request = orig;
  assert.equal(done, true);
  assert.equal(provider.aqiTrend[0], 42);
});

function stubProvider() {
  const WeatherProvider = require('../src/pkjs/weather/provider.js');
  const p = new WeatherProvider();
  p.tempTrend = new Array(24).fill(20);
  p.precipTrend = new Array(24).fill(0);
  p.startTime = START;
  p.currentTemp = 68;
  p.cityName = 'Test';
  p.sunEvents = [{ type: 'sunrise', date: new Date(START * 1000) }];
  return p;
}

test('provider constructor defaults aqiTrend to an empty array', () => {
  const WeatherProvider = require('../src/pkjs/weather/provider.js');
  assert.deepEqual(new WeatherProvider().aqiTrend, []);
});

test('getPayload emits transient AQI_TREND from aqiTrend', () => {
  const p = stubProvider();
  p.aqiTrend = [42, 43, 44];
  assert.deepEqual(p.getPayload().AQI_TREND, [42, 43, 44]);
});

test('getPayload emits empty AQI_TREND when aqiTrend is empty', () => {
  assert.deepEqual(stubProvider().getPayload().AQI_TREND, []);
});

test('buildWaqiUrl targets the WAQI geo feed with the token', () => {
  const u = aq.buildWaqiUrl(49.2, 7.0, 'TKN');
  assert.ok(u.indexOf('api.waqi.info/feed/geo:49.2;7') !== -1);
  assert.ok(u.indexOf('token=TKN') !== -1);
});

test('mapWaqi returns the numeric current AQI on status ok', () => {
  assert.equal(aq.mapWaqi({ status: 'ok', data: { aqi: 42 } }), 42);
});

test('mapWaqi returns null for error envelope, non-numeric aqi, or malformed input', () => {
  assert.equal(aq.mapWaqi({ status: 'error', data: 'Unknown station' }), null);
  assert.equal(aq.mapWaqi({ status: 'ok', data: { aqi: '-' } }), null);
  assert.equal(aq.mapWaqi({ status: 'ok', data: {} }), null);
  assert.equal(aq.mapWaqi({}), null);
  assert.equal(aq.mapWaqi(null), null);
});
