// Reused-instance fetch cycles: index.js constructs the provider once and
// re-fetches on it, so per-cycle state must reset. Patches WeatherProvider.request
// BEFORE requiring the adapter (which captures it at module load).
const test = require('node:test');
const assert = require('node:assert/strict');

const WeatherProvider = require('../src/pkjs/weather/provider.js');
var responder;
WeatherProvider.request = function(url, type, onSuccess, onError) { responder(url, onSuccess, onError); };
const openmeteo = require('../src/pkjs/weather/openmeteo.js');
const OpenMeteoProvider = openmeteo.OpenMeteoProvider || openmeteo;

const HOUR = 3600;
// Hour-aligned anchor for the deterministic clock.
const BASE = 1718841600;

/** @returns {Object} Main-call response shaped like api.open-meteo.com/v1/forecast. */
function mainResponse() {
  const time = [], temperature_2m = [], precipitation_probability = [], precipitation = [],
    windspeed_10m = [], windgusts_10m = [], pressure_msl = [];
  for (let i = 0; i < 48; i += 1) {
    time.push(BASE + i * HOUR);
    temperature_2m.push(50 + i);
    precipitation_probability.push(i);
    precipitation.push(0);
    windspeed_10m.push(i);
    windgusts_10m.push(null);
    pressure_msl.push(1013);
  }
  return {
    current: { temperature_2m: 71.5 },
    hourly: { time, temperature_2m, precipitation_probability, precipitation,
      windspeed_10m, windgusts_10m, pressure_msl }
  };
}

/** @returns {Object} best_match gust/feels aux response. */
function auxResponse() {
  const time = [], windgusts_10m = [], apparent_temperature = [];
  for (let i = 0; i < 48; i += 1) {
    time.push(BASE + i * HOUR);
    windgusts_10m.push(20 + i);
    apparent_temperature.push(40 + i);
  }
  return { hourly: { time, windgusts_10m, apparent_temperature },
    current: { apparent_temperature: 41.5 } };
}

function withMockedNow(epochSeconds, fn) {
  const realNow = Date.now;
  Date.now = function() { return epochSeconds * 1000; };
  try { fn(); } finally { Date.now = realNow; }
}

test('aux failure on a reused instance drops feels instead of shipping the stale window', () => {
  const p = new OpenMeteoProvider();
  p.fetchUv = false;

  // Cycle 1: main + aux succeed — feels adopted.
  responder = function(url, onSuccess) {
    onSuccess(JSON.stringify(url.indexOf('current=apparent_temperature') !== -1 ? auxResponse() : mainResponse()));
  };
  withMockedNow(BASE + 10, function() {
    p.withProviderData(0, 0, false, function() {},
      function(f) { throw new Error('cycle 1 failed: ' + JSON.stringify(f)); });
  });
  assert.equal(p.feelsTrend.length, 24, 'cycle 1 adopted the feels series');
  assert.equal(p.currentFeels, 41.5);

  // Cycle 2: main succeeds, aux request errors — feels must reset to the
  // defaults, not survive from cycle 1 anchored to the old startTime.
  responder = function(url, onSuccess, onError) {
    if (url.indexOf('current=apparent_temperature') !== -1) { onError({ code: 0, message: 'timeout' }); return; }
    onSuccess(JSON.stringify(mainResponse()));
  };
  withMockedNow(BASE + HOUR + 10, function() {
    p.withProviderData(0, 0, false, function() {},
      function(f) { throw new Error('cycle 2 failed: ' + JSON.stringify(f)); });
  });
  assert.deepEqual(p.feelsTrend, [], 'stale feels dropped when the aux call fails');
  assert.equal(p.currentFeels, null);
});

test('the aux gusts land in the same slot as the main call\'s rain for the same hour', () => {
  // Both calls stamp preceding-hour values at the END of the hour they cover.
  // A squall between 18:00 and 19:00 is stamped 19:00 in both, and at 18:10
  // the watch's slot 0 IS 18:00-19:00 — the rain bar and the gust head must
  // both show it there, not in the 19:00-20:00 slot.
  const p = new OpenMeteoProvider();
  p.fetchUv = false;
  responder = function(url, onSuccess) {
    if (url.indexOf('current=apparent_temperature') !== -1) {
      const aux = auxResponse();
      aux.hourly.windgusts_10m = aux.hourly.time.map((t) => (t === BASE + 19 * HOUR ? 70 : 20));
      onSuccess(JSON.stringify(aux));
      return;
    }
    const main = mainResponse();
    main.hourly.precipitation = main.hourly.time.map((t) => (t === BASE + 19 * HOUR ? 4 : 0));
    onSuccess(JSON.stringify(main));
  };
  withMockedNow(BASE + 18 * HOUR + 600, function() {
    p.withProviderData(0, 0, false, function() {},
      function(f) { throw new Error('fetch failed: ' + JSON.stringify(f)); });
  });
  assert.equal(p.startTime, BASE + 18 * HOUR);
  assert.deepEqual(p.rainTrend.slice(0, 2), [4, 0], 'rain in the 18:00-19:00 slot');
  assert.deepEqual(p.gustTrend.slice(0, 2), [70, 20], 'gust in the 18:00-19:00 slot');
  assert.equal(p.gustTrend.length, 24);
});

/** @returns {Object} UV response; the value at each hour is its GMT hour, so misalignment shows. */
function uvResponse() {
  const time = [], uv_index = [];
  for (let i = 0; i < 72; i += 1) {
    time.push(BASE + i * HOUR);
    uv_index.push(i % 24);
  }
  return { hourly: { time, uv_index } };
}

test('UV failure on a reused instance drops UV instead of shipping the previous window', () => {
  const p = new OpenMeteoProvider();
  p.fetchUv = true;
  function respond(uvFails) {
    return function(url, onSuccess, onError) {
      if (url.indexOf('hourly=uv_index') !== -1) {
        if (uvFails) { onError({ code: 0, message: 'timeout' }); return; }
        onSuccess(JSON.stringify(uvResponse()));
        return;
      }
      onSuccess(JSON.stringify(url.indexOf('current=apparent_temperature') !== -1 ? auxResponse() : mainResponse()));
    };
  }

  // Cycle 1 at 08:xx: UV succeeds, aligned to the 08:00 start.
  responder = respond(false);
  withMockedNow(BASE + 8 * HOUR + 300, function() {
    p.withProviderData(0, 0, false, function() {},
      function(f) { throw new Error('cycle 1 failed: ' + JSON.stringify(f)); });
  });
  assert.equal(p.startTime, BASE + 8 * HOUR);
  assert.equal(p.uvTrend[0], 8, 'cycle 1 adopted the UV window');

  // Cycle 2 at 09:xx: UV times out. The 08:00 window must not ship against the
  // new 09:00 start (UV an hour late in the slot, graph and day peaks).
  responder = respond(true);
  withMockedNow(BASE + 9 * HOUR + 300, function() {
    p.withProviderData(0, 0, false, function() {},
      function(f) { throw new Error('cycle 2 failed: ' + JSON.stringify(f)); });
  });
  assert.equal(p.startTime, BASE + 9 * HOUR);
  assert.deepEqual(p.uvTrend, [], 'stale UV dropped when the UV call fails');
  p.cityName = 'X';
  p.sunEvents = [{ type: 'sunrise', date: new Date((BASE + 10 * HOUR) * 1000) }];
  const payload = p.getPayload();
  assert.deepEqual(payload.UV_TREND_UINT8, [], 'UV line off for this cycle');
  assert.equal(payload.UV_DAY_PEAKS, undefined, 'no day peaks from a stale window');
});
