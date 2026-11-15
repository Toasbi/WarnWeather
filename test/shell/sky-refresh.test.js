// test/shell/sky-refresh.test.js
//
// The radar's sky rows on the phone side, end to end: Open-Meteo is asked once per UTC half
// hour (fetch-cycle.js takeSkyRequestSlot, radar-sky.js REFRESH_SECONDS), the cycles between
// re-serve that half hour's sky byte for byte, and the outbox's exact compare sends it once
// per request.
//
// Drives the real fetch-cycle → radar-sky-source → outbox → change-detector chain, with the
// shared Rainbow radar asked through a proxy endpoint; only the HTTP transport, the forecast
// provider and Pebble.sendAppMessage are stubbed.
const test = require('node:test');
const assert = require('node:assert/strict');

var sent = [];
var verdict = 'ack';
global.Pebble = {
  sendAppMessage: function(payload, ack, nack) {
    sent.push(payload);
    if (verdict === 'nack') { if (nack) { nack({}); } return; }
    if (ack) { ack(); }
  }
};
var store = {};
global.localStorage = {
  getItem: function(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
  setItem: function(k, v) { store[k] = String(v); },
  removeItem: function(k) { delete store[k]; }
};

const ENDPOINT = 'https://proxy.example/rainbow-nowcast';
const Q = 15 * 60;
var nowMs = 0;
var skyRequests = [];
var skyFails = false;
// The weather over the morning: each absolute quarter hour's cloud cover.
var cloudAt = function() { return 60; };

/**
 * An Open-Meteo minutely_15 answer from the quarter hour before now, far enough on for any
 * sky built at this time.
 * @returns {Object} The response body.
 */
function skyBody() {
  const from = Math.floor(nowMs / 1000 / Q) * Q - Q;
  const m = { time: [], cloud_cover: [], cloud_cover_low: [], cloud_cover_mid: [], cloud_cover_high: [],
    direct_normal_irradiance: [], lightning_potential: [], weather_code: [] };
  for (let i = 0; i < 16; i += 1) {
    const t = from + i * Q;
    m.time.push(t);
    m.cloud_cover.push(cloudAt(t)); m.cloud_cover_low.push(cloudAt(t)); m.cloud_cover_mid.push(0);
    m.cloud_cover_high.push(0); m.direct_normal_irradiance.push(0); m.lightning_potential.push(0);
    m.weather_code.push(3);
  }
  return { minutely_15: m };
}

// Mock the shared XHR before the radar modules load (they capture it).
const WeatherProvider = require('../../src/pkjs/weather/adapter/provider.js');
WeatherProvider.request = function(url, type, onSuccess, onError) {
  if (url.indexOf('minutely_15') !== -1) {
    skyRequests.push(nowMs);
    if (skyFails) { onError({ code: 'network_error' }); return; }
    onSuccess(JSON.stringify(skyBody()));
    return;
  }
  if (url === ENDPOINT) {   // the shared Rainbow radar: dry
    onSuccess(JSON.stringify({ latitude: 52.5, longitude: 13.4, forecast: [] }));
    return;
  }
  onError({ code: 'status_404' });
};
const createFetchCycle = require('../../src/pkjs/shell/fetch-cycle.js');
const outbox = require('../../src/pkjs/wire/adapter/outbox.js');
const authBackoff = require('../../src/pkjs/weather/adapter/auth-backoff.js');
const notices = require('../../src/pkjs/notices/adapter/notices.js');
const KEYS = require('../../src/pkjs/settings/domain/storage-keys.js');

// 20 s past a half hour (10:00:20 UTC).
const T0 = Date.UTC(2026, 8, 25, 10, 0, 20);
const MIN = 60 * 1000;
var settings = { radarMode: 'graph', radarSky: true, radarProvider: 'rainbow', fetchIntervalMin: '15' };

var provider = {
  id: 'stub',
  name: 'Stub',
  withCoordinates: function(ok) { ok(52.5, 13.4); },
  // An unchanged forecast rides along with whatever the radar step answered.
  fetchWithCoordinates: function(lat, lon, onSuccess, onFailure, force, extras) {
    outbox.sendWeather(Object.assign({ TEMP_MIN: 1, TEMP_MAX: 9, NUM_ENTRIES: 24 }, extras),
      onSuccess, function() { onFailure({ stage: 'app_message', code: 'nack' }); });
  }
};
const fetchCycle = createFetchCycle({
  getSettings: function() { return settings; },
  getWatchInfo: function() { return null; },   // unknown platform: radar-capable
  getProvider: function() { return provider; },
  isWatchConnected: function() { return true; },
  outbox: outbox,
  authBackoff: authBackoff,
  notices: notices,
  trackWeatherFetch: function() {},
  env: { waqiToken: '', rainbowEndpoint: ENDPOINT },
  now: function() { return new Date(nowMs); },
  // Everything answers synchronously; the watchdog each start arms is dropped.
  setTimeout: function() {}
});

/**
 * One fetch cycle at `ms`.
 * @param {number} ms Epoch ms.
 * @param {Object} [opts] {force, nack}.
 * @returns {{asked: boolean, sky: ?number[]}} Whether Open-Meteo was asked, and the sky the
 *   cycle's send carried (null when no send carried one).
 */
function cycle(ms, opts) {
  opts = opts || {};
  sent = [];
  nowMs = ms;
  verdict = opts.nack ? 'nack' : 'ack';
  const before = skyRequests.length;
  assert.equal(fetchCycle.start(Boolean(opts.force)), true, 'the cycle starts');
  const withSky = sent.filter(function(m) { return 'RADAR_SKY_UINT8' in m; });
  assert.ok(withSky.length <= 1, 'at most one sky send per cycle');
  return { asked: skyRequests.length > before, sky: withSky.length ? withSky[0].RADAR_SKY_UINT8 : null };
}

function reset() {
  for (var k in store) { delete store[k]; }
  skyRequests = [];
  skyFails = false;
  cloudAt = function() { return 60; };
  settings = { radarMode: 'graph', radarSky: true, radarProvider: 'rainbow', fetchIntervalMin: '15' };
}

test('Open-Meteo is asked once per half hour; the quarter hours between re-serve its sky', () => {
  reset();
  const asked = [0, 15, 30, 45, 60].map(function(m) { return cycle(T0 + m * MIN).asked; });
  assert.deepEqual(asked, [true, false, true, false, true]);
});

test('an unchanged sky goes out once per half hour, not every quarter hour', () => {
  reset();
  const sends = [0, 15, 30, 45, 60].map(function(m) { return cycle(T0 + m * MIN).sky !== null; });
  assert.deepEqual(sends, [true, false, true, false, true]);
});

test('on a 5-minute schedule too: two requests and two sends in the hour', () => {
  reset();
  settings.fetchIntervalMin = '5';
  let asked = 0;
  let skies = 0;
  for (let m = 0; m < 60; m += 5) {
    const c = cycle(T0 + m * MIN);
    asked += c.asked ? 1 : 0;
    skies += c.sky ? 1 : 0;
  }
  assert.equal(asked, 2, 'at :00 and :30');
  assert.equal(skies, 2);
});

test('a NACKed sky goes out again on the next cycle of its half hour, then stays', () => {
  reset();
  assert.ok(cycle(T0, { nack: true }).sky, 'the first send is NACKed');
  const again = cycle(T0 + 15 * MIN);
  assert.equal(again.asked, false, 'not asked again: the half hour\'s sky is re-served');
  assert.ok(again.sky, 're-served onto a forgotten cache, it goes out');
  assert.equal(cycle(T0 + 20 * MIN).sky, null, 'ACKed, it stays on the phone');
});

test('a forced fetch asks again inside the half hour', () => {
  reset();
  cycle(T0);
  assert.equal(cycle(T0 + 10 * MIN, { force: true }).asked, true);
});

test('a failed request is not kept: the next cycle asks again', () => {
  reset();
  skyFails = true;
  assert.equal(cycle(T0).asked, true);
  skyFails = false;
  const next = cycle(T0 + 15 * MIN);
  assert.equal(next.asked, true, 'nothing to re-serve, so it asks');
  assert.ok(next.sky);
});

test('a sky that changed shows at the next half hour\'s request', () => {
  reset();
  cycle(T0);
  cloudAt = function() { return 100; };
  assert.equal(cycle(T0 + 15 * MIN).sky, null, 're-served: the change waits for the next request');
  const half = cycle(T0 + 30 * MIN);
  assert.ok(half.sky);
  assert.equal(half.sky[5], 250, 'the new overcast');
});

test('rows switched off: no request, the clear goes out once, and the record is dropped', () => {
  reset();
  cycle(T0);
  assert.ok(store[KEYS.SKY_REQUEST_THROTTLE_KEY], 'the half hour\'s request is kept');
  settings.radarSky = false;
  const off = cycle(T0 + 15 * MIN);
  assert.equal(off.asked, false);
  assert.deepEqual(off.sky, [], 'the clear');
  assert.equal(store[KEYS.SKY_REQUEST_THROTTLE_KEY], undefined);
  assert.equal(cycle(T0 + 20 * MIN).sky, null, 'sent once');
});
