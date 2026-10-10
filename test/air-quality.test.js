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
const KEYS = require('../src/pkjs/storage-keys.js');

const START = 1767258000;
const H = 3600;

// Every test starts without a last good AQI reading (or any other record): a
// reading one test stores must not stand in for another's lookup.
test.beforeEach(() => { localStorage.clear(); });

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

test('strict waqi leaves aqiTrend untouched when no station and no recent reading (slot shows --)', () => {
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
 * @param {Function} [between] Run between two cycles (e.g. to move the clock).
 * @returns {Object[]} The payload sent on each cycle.
 */
function fetchCyclesOnOneProvider(aqiSettings, responders, between) {
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
    responders.forEach((responder, i) => {
      if (i > 0 && between) { between(); }
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

const waqiDash = (url, method, onSuccess) => onSuccess(JSON.stringify({ status: 'ok', data: { aqi: '-' } }));

[
  ['a "-" reading', waqiDash],
  ['no station', (url, method, onSuccess) => onSuccess(JSON.stringify({ status: 'error', data: 'Unknown station' }))],
  ['a transport error', (url, method, onSuccess, onError) => onError({ code: 0, message: 'timeout' })]
].forEach(([label, failing]) => {
  test('strict waqi on a reused provider ships the last reading after ' + label + ' (same place and scale, under 2 h)', () => {
    const sent = fetchCyclesOnOneProvider(
      { fetchAqi: true, aqiSource: 'waqi', aqicnToken: 'T' }, [waqiOk87, failing]);
    assert.equal(sent.length, 2);
    assert.deepEqual(sent[0].AQI_TREND, [87]);
    assert.deepEqual(sent[1].AQI_TREND, [87]);
  });
});

test('strict waqi on a reused provider ships no AQI after a "-" once the last reading is over 2 h old', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: START * 1000 });
  const sent = fetchCyclesOnOneProvider(
    { fetchAqi: true, aqiSource: 'waqi', aqicnToken: 'T' }, [waqiOk87, waqiDash],
    () => t.mock.timers.tick(2 * H * 1000 + 1));
  assert.equal(sent.length, 2);
  assert.deepEqual(sent[0].AQI_TREND, [87]);
  assert.deepEqual(sent[1].AQI_TREND, []);
});

test('open-meteo AQI on a reused provider ships the last reading alone after a timeout, not the previous window', () => {
  const sent = fetchCyclesOnOneProvider(
    { fetchAqi: true, aqiSource: 'openmeteo', aqiScale: 'european' }, [
      (url, method, onSuccess) => onSuccess(JSON.stringify({
        hourly: { time: [START, START + H, START + 2 * H], european_aqi: [30, 31, 32] }
      })),
      (url, method, onSuccess, onError) => onError({ code: 0, message: 'timeout' })
    ]);
  assert.equal(sent.length, 2);
  assert.equal(sent[0].AQI_TREND[0], 30);
  assert.ok(Array.isArray(sent[0].AQI_DAY_PEAKS), 'the forecast carries a day max');
  assert.deepEqual(sent[1].AQI_TREND, [30]);
  assert.equal(sent[1].AQI_DAY_PEAKS, undefined, 'the reading alone carries none');
});

// --- the last good reading (settleAqi) ----------------------------------------

const MIN_MS = 60 * 1000;
const WAQI = { aqiSource: 'waqi', aqicnToken: 'T' };
const OPEN_METEO_EU = { aqiSource: 'openmeteo', aqiScale: 'european' };
const HERE = { lat: 52.52, lon: 13.4 };

/**
 * Store a last good AQI reading taken `agoMin` minutes ago at HERE (overrides on top).
 * @param {number} agoMin Its age in minutes (negative: in the future).
 * @param {Object} [over] Field overrides.
 * @returns {void}
 */
function storeLastAqi(agoMin, over) {
  localStorage.setItem(KEYS.LAST_AQI_KEY, JSON.stringify(Object.assign(
    { scale: 'us', at: Date.now() - agoMin * MIN_MS, lat: HERE.lat, lon: HERE.lon, aqi: 61 }, over)));
}

/**
 * One fetchAqiInto on a provider the fetch cycle just reset, against a stubbed
 * network, with its log captured.
 * @param {Object} settings AQI fetch options (fetchAqi is on).
 * @param {Function} responder The http.request stub.
 * @param {number|string} [lat] Latitude (HERE).
 * @param {number|string} [lon] Longitude (HERE).
 * @returns {{provider: Object, logs: string[], doneCalls: number}} The outcome.
 */
function lookup(settings, responder, lat, lon) {
  const orig = http.request;
  const realLog = console.log;
  const logs = [];
  const provider = { options: fetchOptions.defaults(Object.assign({ fetchAqi: true }, settings)),
    startTime: START, aqiTrend: [], aqiFeedId: null };
  let doneCalls = 0;
  http.request = responder;
  console.log = (msg) => { logs.push(String(msg)); };
  try {
    aq.fetchAqiInto(provider, lat === undefined ? HERE.lat : lat, lon === undefined ? HERE.lon : lon,
      () => { doneCalls += 1; });
  } finally {
    http.request = orig;
    console.log = realLog;
  }
  return { provider, logs, doneCalls };
}

/**
 * @param {number[]} times Epoch seconds.
 * @param {Array.<?number>} values european_aqi values.
 * @returns {Function} An http.request stub answering an Open-Meteo air-quality body.
 */
function openMeteoAnswer(times, values) {
  return (url, method, onSuccess) => onSuccess(JSON.stringify({ hourly: { time: times, european_aqi: values } }));
}

test('a WAQI "-" takes the last reading from the same place and scale under 2 h old', () => {
  storeLastAqi(30);
  const r = lookup(WAQI, waqiDash, HERE.lat + 0.04, HERE.lon - 0.04);
  assert.equal(r.doneCalls, 1);
  assert.deepEqual(r.provider.aqiTrend, [61]);
  assert.equal(r.provider.aqiFeedId, null, 'the reading alone: no day max');
  assert.deepEqual(r.logs, ['AQI: no reading (waqi: ok/string)', 'AQI: showing the reading from 30 min ago']);
});

test('a WAQI answer without a station logs its status codes, not its text', () => {
  const r = lookup(WAQI, (url, method, onSuccess) =>
    onSuccess(JSON.stringify({ status: 'error', data: 'Unknown station' })));
  assert.deepEqual(r.logs, ['AQI: no reading (waqi: error/none)', 'AQI: no recent reading, slot shows --']);
});

[
  ['is over 2 h old', () => storeLastAqi(121)],
  ['is from the future (a clock set back)', () => storeLastAqi(-5)],
  ['is over 0.05 degrees of latitude away', () => storeLastAqi(30, { lat: HERE.lat + 0.06 })],
  ['is over 0.05 degrees of longitude away', () => storeLastAqi(30, { lon: HERE.lon - 0.06 })],
  ['is in the other scale', () => storeLastAqi(30, { scale: 'european' })],
  ['holds no reading', () => storeLastAqi(30, { aqi: null })],
  ['is unreadable', () => localStorage.setItem(KEYS.LAST_AQI_KEY, '{not json')],
  ['is not there', () => {}]
].forEach(([label, arrange]) => {
  test('a WAQI "-" shows -- when the last reading ' + label, () => {
    arrange();
    const r = lookup(WAQI, waqiDash);
    assert.equal(r.doneCalls, 1);
    assert.deepEqual(r.provider.aqiTrend, []);
    assert.equal(r.provider.aqiFeedId, null);
    assert.equal(r.logs[r.logs.length - 1], 'AQI: no recent reading, slot shows --');
  });
});

test('a lookup whose storage throws still finishes: no stand-in, no thrown error', () => {
  storeLastAqi(30);
  const saved = global.localStorage;
  const throwing = () => { throw new Error('storage unavailable'); };
  global.localStorage = { getItem: throwing, setItem: throwing, removeItem: throwing, clear: throwing };
  try {
    const missed = lookup(WAQI, waqiDash);
    assert.equal(missed.doneCalls, 1);
    assert.deepEqual(missed.provider.aqiTrend, []);
    const read = lookup(WAQI, waqiOk87);
    assert.equal(read.doneCalls, 1);
    assert.deepEqual(read.provider.aqiTrend, [87], 'a failed store costs only the stand-in');
  } finally {
    global.localStorage = saved;
  }
});

test('a fresh reading replaces the stored one, coordinates as numbers', () => {
  storeLastAqi(90, { scale: 'european', aqi: 12, lat: 1, lon: 2 });
  const before = Date.now();
  const r = lookup(WAQI, waqiOk87, '52.52', '13.40');
  const rec = JSON.parse(localStorage.getItem(KEYS.LAST_AQI_KEY));
  assert.deepEqual(r.provider.aqiTrend, [87]);
  assert.equal(rec.scale, 'us', 'WAQI reports the US-EPA index');
  assert.equal(rec.aqi, 87);
  assert.equal(rec.lat, 52.52);
  assert.equal(rec.lon, 13.4);
  assert.ok(rec.at >= before && rec.at <= Date.now());
  assert.deepEqual(r.logs, []);
});

test('an Open-Meteo reading is stored in its scale', () => {
  lookup(OPEN_METEO_EU, openMeteoAnswer([START, START + H], [33, 34]));
  const rec = JSON.parse(localStorage.getItem(KEYS.LAST_AQI_KEY));
  assert.equal(rec.scale, 'european');
  assert.equal(rec.aqi, 33);
});

test('an Open-Meteo window without its current hour takes the last reading there, keeping its forecast', () => {
  storeLastAqi(20, { scale: 'european', aqi: 33 });
  const stored = localStorage.getItem(KEYS.LAST_AQI_KEY);
  const r = lookup(OPEN_METEO_EU, openMeteoAnswer([START + H, START + 2 * H], [40, 41]));
  assert.equal(r.doneCalls, 1);
  assert.deepEqual(r.provider.aqiTrend.slice(0, 3), [33, 40, 41], 'the stand-in fills the current hour only');
  assert.equal(r.provider.aqiFeedId, 'openmeteo-aqi-european',
    'the feed stays: the day max and the alert keep the forecast peaks');
  assert.deepEqual(r.logs, ['AQI: no reading (open-meteo: empty head)', 'AQI: showing the reading from 20 min ago']);
  assert.equal(localStorage.getItem(KEYS.LAST_AQI_KEY), stored,
    'a stand-in is not stored again: its 2 h run from the real reading');
});

test('an all-null Open-Meteo window takes the last reading alone', () => {
  storeLastAqi(20, { scale: 'european', aqi: 33 });
  const r = lookup(OPEN_METEO_EU, openMeteoAnswer([START, START + H], [null, null]));
  assert.deepEqual(r.provider.aqiTrend, [33]);
  assert.equal(r.provider.aqiFeedId, null, 'no forecast to keep: the reading alone');
});

test('open-meteo AQI on a reused provider keeps the day peaks when the next window misses its current hour', () => {
  // Cycle 2 starts an hour later (START + H) but its window only from START + 2 h:
  // the GMT day rolled over between the forecast and the air-quality request.
  const sent = fetchCyclesOnOneProvider(
    { fetchAqi: true, aqiSource: 'openmeteo', aqiScale: 'european' }, [
      openMeteoAnswer([START, START + H, START + 2 * H], [30, 31, 32]),
      openMeteoAnswer([START + 2 * H, START + 3 * H], [90, 91])
    ]);
  assert.equal(sent.length, 2);
  assert.deepEqual(sent[1].AQI_TREND.slice(0, 3), [30, 90, 91], 'the last reading, then the forecast');
  assert.ok(Array.isArray(sent[1].AQI_DAY_PEAKS), 'the forecast still carries its day peaks');
});

test('without a recent reading, an Open-Meteo window missing its current hour keeps its forecast', () => {
  const r = lookup(OPEN_METEO_EU, openMeteoAnswer([START + H, START + 2 * H], [40, 41]));
  assert.equal(r.provider.aqiTrend[0], null);
  assert.equal(r.provider.aqiTrend[1], 40);
  assert.equal(r.provider.aqiFeedId, 'openmeteo-aqi-european');
  assert.equal(localStorage.getItem(KEYS.LAST_AQI_KEY), null, 'no current reading to store');
});

test('an all-null Open-Meteo window is no answer: no feed of nulls', () => {
  const r = lookup(OPEN_METEO_EU, openMeteoAnswer([START, START + H], [null, null]));
  assert.deepEqual(r.provider.aqiTrend, []);
  assert.equal(r.provider.aqiFeedId, null);
  assert.deepEqual(r.logs, ['AQI: no reading (open-meteo: empty head)', 'AQI: no recent reading, slot shows --']);
});

test('auto: no station and a failed Open-Meteo fallback take the last US reading', () => {
  storeLastAqi(45);
  const r = lookup({ aqiSource: 'auto', aqicnToken: 'T' }, (url, method, onSuccess, onError) => {
    if (url.indexOf('api.waqi.info') !== -1) {
      onSuccess(JSON.stringify({ status: 'error', data: 'Unknown station' }));
    } else {
      onError({ code: 0, message: 'timeout' });
    }
  });
  assert.equal(r.doneCalls, 1);
  assert.deepEqual(r.provider.aqiTrend, [61]);
});

// A build without a WAQI token sends 'waqi' and 'auto' to Open-Meteo (US): that
// branch settles too, in the US scale WAQI's readings are stored in.
const NO_TOKEN = { aqiSource: 'waqi', aqicnToken: '' };

/**
 * @param {number[]} times Epoch seconds.
 * @param {Array.<?number>} values us_aqi values.
 * @returns {Function} An http.request stub answering an Open-Meteo US air-quality body.
 */
function openMeteoUsAnswer(times, values) {
  return (url, method, onSuccess) => onSuccess(JSON.stringify({ hourly: { time: times, us_aqi: values } }));
}

test('without a WAQI token, an Open-Meteo answer without a reading takes the last US reading', () => {
  storeLastAqi(30);
  const r = lookup(NO_TOKEN, openMeteoUsAnswer([START, START + H], [null, null]));
  assert.equal(r.doneCalls, 1);
  assert.deepEqual(r.provider.aqiTrend, [61]);
  assert.equal(r.provider.aqiFeedId, null);
});

test('without a WAQI token, a failed Open-Meteo request takes the last US reading', () => {
  storeLastAqi(30);
  const r = lookup(NO_TOKEN, (url, method, onSuccess, onError) => onError({ code: 0, message: 'timeout' }));
  assert.equal(r.doneCalls, 1);
  assert.deepEqual(r.provider.aqiTrend, [61]);
  assert.equal(r.provider.aqiFeedId, null);
});

test('without a WAQI token, an Open-Meteo reading is stored in the US scale', () => {
  lookup(NO_TOKEN, openMeteoUsAnswer([START, START + H], [44, 45]));
  const rec = JSON.parse(localStorage.getItem(KEYS.LAST_AQI_KEY));
  assert.equal(rec.scale, 'us');
  assert.equal(rec.aqi, 44);
});
