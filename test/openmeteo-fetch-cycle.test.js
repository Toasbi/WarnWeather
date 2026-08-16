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
