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
// The aux fetches call http.request through the module object, so stubbing
// the property here intercepts them (the old seam was WeatherProvider.request).
const http = require('../src/pkjs/weather/http.js');
const assert = require('node:assert/strict');
const aq = require('../src/pkjs/weather/air-quality.js');
const fetchOptions = require('../src/pkjs/weather/fetch-options.js');

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

test('fetchAqiInto is a no-op when provider.options.fetchAqi is false', () => {
  let called = false;
  const provider = { options: fetchOptions.defaults({ fetchAqi: false }) };
  aq.fetchAqiInto(provider, 1, 2, () => { called = true; });
  assert.equal(called, true);
  assert.equal(provider.aqiTrend, undefined);
});

test('fetchAqiInto populates aqiTrend on success', () => {
  const WeatherProvider = require('../src/pkjs/weather/provider.js');
  const orig = http.request;
  http.request = (url, method, onSuccess) =>
    onSuccess(JSON.stringify({ hourly: { time: [START], european_aqi: [42] } }));
  const provider = { options: fetchOptions.defaults({ fetchAqi: true, aqiSource: 'openmeteo', aqiScale: 'european' }), startTime: START };
  let done = false;
  aq.fetchAqiInto(provider, 1, 2, () => { done = true; });
  http.request = orig;
  assert.equal(done, true);
  assert.equal(provider.aqiTrend[0], 42);
});

test('waqi source populates a one-element aqiTrend on success', () => {
  const WeatherProvider = require('../src/pkjs/weather/provider.js');
  const orig = http.request;
  http.request = (url, method, onSuccess) =>
    onSuccess(JSON.stringify({ status: 'ok', data: { aqi: 42 } }));
  const provider = { options: fetchOptions.defaults({ fetchAqi: true, aqiSource: 'waqi', aqicnToken: 'T' }), startTime: START };
  let done = false;
  aq.fetchAqiInto(provider, 1, 2, () => { done = true; });
  http.request = orig;
  assert.equal(done, true);
  assert.deepEqual(provider.aqiTrend, [42]);
});

test('strict waqi leaves aqiTrend untouched when no station (slot shows --)', () => {
  const WeatherProvider = require('../src/pkjs/weather/provider.js');
  const orig = http.request;
  http.request = (url, method, onSuccess) =>
    onSuccess(JSON.stringify({ status: 'error', data: 'Unknown station' }));
  const provider = { options: fetchOptions.defaults({ fetchAqi: true, aqiSource: 'waqi', aqicnToken: 'T' }), startTime: START };
  let done = false;
  aq.fetchAqiInto(provider, 1, 2, () => { done = true; });
  http.request = orig;
  assert.equal(done, true);
  assert.equal(provider.aqiTrend, undefined);
});

test('auto falls back to Open-Meteo US field when WAQI has no station', () => {
  const WeatherProvider = require('../src/pkjs/weather/provider.js');
  const orig = http.request;
  const urls = [];
  http.request = (url, method, onSuccess) => {
    urls.push(url);
    if (url.indexOf('api.waqi.info') !== -1) {
      onSuccess(JSON.stringify({ status: 'error', data: 'Unknown station' }));
    } else {
      onSuccess(JSON.stringify({ hourly: { time: [START], us_aqi: [77] } }));
    }
  };
  const provider = { options: fetchOptions.defaults({ fetchAqi: true, aqiSource: 'auto', aqicnToken: 'T' }), startTime: START };
  let done = false;
  aq.fetchAqiInto(provider, 1, 2, () => { done = true; });
  http.request = orig;
  assert.equal(done, true);
  assert.equal(provider.aqiTrend[0], 77);
  assert.ok(urls[1].indexOf('hourly=us_aqi') !== -1);
});

test('empty token degrades a waqi source to Open-Meteo US (dev builds)', () => {
  const WeatherProvider = require('../src/pkjs/weather/provider.js');
  const orig = http.request;
  let waqiCalled = false;
  http.request = (url, method, onSuccess) => {
    if (url.indexOf('api.waqi.info') !== -1) { waqiCalled = true; }
    onSuccess(JSON.stringify({ hourly: { time: [START], us_aqi: [55] } }));
  };
  const provider = { options: fetchOptions.defaults({ fetchAqi: true, aqiSource: 'waqi', aqicnToken: '' }), startTime: START };
  let done = false;
  aq.fetchAqiInto(provider, 1, 2, () => { done = true; });
  http.request = orig;
  assert.equal(done, true);
  assert.equal(waqiCalled, false);
  assert.equal(provider.aqiTrend[0], 55);
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

/**
 * Drive fetchWithCoordinates once per responder on ONE provider instance (as
 * index.js does between config closes), with the real air-quality fetch and only
 * the network, the outbox send and the city/sun/provider-data stages stubbed.
 * @param {Object} aqiSettings fetchAqi/aqiSource/aqicnToken/aqiScale overrides.
 * @param {Function[]} responders One http.request stub per cycle.
 * @returns {Object[]} The payload sent on each cycle.
 */
function fetchCyclesOnOneProvider(aqiSettings, responders) {
  const WeatherProvider = require('../src/pkjs/weather/provider.js');
  const outbox = require('../src/pkjs/outbox.js');
  const origRequest = http.request;
  const origSend = outbox.sendWeather;
  const sent = [];
  const provider = new WeatherProvider();
  provider.options = fetchOptions.defaults(aqiSettings);
  let cycleStart = START;
  provider.withCityName = (lat, lon, done) => done('Town', 'DE');
  provider.withSunEvents = (lat, lon, done) => done([{ type: 'sunrise', date: new Date(START * 1000) }]);
  provider.withProviderData = function (lat, lon, force, done) {
    this.tempTrend = new Array(24).fill(50);
    this.precipTrend = new Array(24).fill(0);
    this.currentTemp = 50;
    this.startTime = cycleStart;
    done();
  };
  outbox.sendWeather = (payload, onAck) => { sent.push(payload); onAck(); };
  try {
    responders.forEach((responder) => {
      http.request = responder;
      provider.fetchWithCoordinates(49.2, 7.0, () => {}, assert.fail, false, null, null);
      cycleStart += H;
    });
  } finally {
    http.request = origRequest;
    outbox.sendWeather = origSend;
  }
  return sent;
}

const waqiOk87 = (url, method, onSuccess) => onSuccess(JSON.stringify({ status: 'ok', data: { aqi: 87 } }));

[
  ['a "-" reading', (url, method, onSuccess) => onSuccess(JSON.stringify({ status: 'ok', data: { aqi: '-' } }))],
  ['no station', (url, method, onSuccess) => onSuccess(JSON.stringify({ status: 'error', data: 'Unknown station' }))],
  ['a transport error', (url, method, onSuccess, onError) => onError({ code: 0, message: 'timeout' })]
].forEach(([label, failing]) => {
  test('strict waqi on a reused provider ships no AQI after ' + label + ' (slot shows --, not the last reading)', () => {
    const sent = fetchCyclesOnOneProvider(
      { fetchAqi: true, aqiSource: 'waqi', aqicnToken: 'T' }, [waqiOk87, failing]);
    assert.equal(sent.length, 2);
    assert.deepEqual(sent[0].AQI_TREND, [87]);
    assert.deepEqual(sent[1].AQI_TREND, []);
  });
});

test('open-meteo AQI on a reused provider ships no AQI after a timeout (not the previous window)', () => {
  const sent = fetchCyclesOnOneProvider(
    { fetchAqi: true, aqiSource: 'openmeteo', aqiScale: 'european' }, [
      (url, method, onSuccess) => onSuccess(JSON.stringify({
        hourly: { time: [START, START + H, START + 2 * H], european_aqi: [30, 31, 32] }
      })),
      (url, method, onSuccess, onError) => onError({ code: 0, message: 'timeout' })
    ]);
  assert.equal(sent.length, 2);
  assert.equal(sent[0].AQI_TREND[0], 30);
  assert.deepEqual(sent[1].AQI_TREND, []);
});
