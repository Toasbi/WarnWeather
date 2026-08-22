// test/provider-fetch.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const WeatherProvider = require('../src/pkjs/weather/provider.js');

test('fetchWithCoordinates drives the chain from the passed coords, never resolving them', () => {
  var p = new WeatherProvider();
  var resolvedAgain = false;
  var seen = null;
  p.withCoordinates = function () { resolvedAgain = true; };
  // Stub the first link in the chain to capture coords and stop (no network).
  p.withCityName = function (lat, lon) { seen = { lat: lat, lon: lon }; };

  p.fetchWithCoordinates(52.5, 13.4, function () {}, function () {}, false, {}, null);

  assert.deepEqual(seen, { lat: 52.5, lon: 13.4 });
  assert.equal(resolvedAgain, false);
});

test('withCoordinates resets countryCode to null even when coordinate resolution fails', () => {
  // Simulates a stale countryCode from a previous successful fetch that should
  // be cleared at the start of each cycle so coord-failure telemetry is not stale.
  global.localStorage = (function () {
    var store = {};
    return {
      getItem: function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
      setItem: function (k, v) { store[k] = String(v); },
      removeItem: function (k) { delete store[k]; }
    };
  }());

  var p = new WeatherProvider();
  p.countryCode = 'DE'; // stale value from previous fetch
  p.location = null;    // GPS mode
  // Stub out the GPS call so no native API is invoked; simulates a coord failure
  // by doing nothing (neither callback nor onFailure fires — we only care about
  // the synchronous reset that withCoordinates must do before dispatching).
  p.withGpsCoordinates = function () {};

  p.withCoordinates(function () {}, function () {});

  assert.equal(p.countryCode, null);
});
