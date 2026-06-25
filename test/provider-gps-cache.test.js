// test/provider-gps-cache.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const WeatherProvider = require('../src/pkjs/weather/provider.js');

test('computeGpsMaxAgeMs: max(cache, interval) minutes in ms', () => {
  assert.equal(WeatherProvider.computeGpsMaxAgeMs('5', '15'), 15 * 60000);
  assert.equal(WeatherProvider.computeGpsMaxAgeMs('30', '5'), 30 * 60000);
  assert.equal(WeatherProvider.computeGpsMaxAgeMs('60', '60'), 60 * 60000);
});

test('computeGpsMaxAgeMs: missing/garbage values treated as 0', () => {
  assert.equal(WeatherProvider.computeGpsMaxAgeMs(undefined, '15'), 15 * 60000);
  assert.equal(WeatherProvider.computeGpsMaxAgeMs('5', undefined), 5 * 60000);
  assert.equal(WeatherProvider.computeGpsMaxAgeMs('x', 'y'), 0);
});

test('withGpsCoordinates uses provider.gpsMaxAgeMs as maximumAge, 10s floor when unset', () => {
  var captured = null;
  // Node v24 exposes navigator as a getter-only property; use defineProperty to stub it.
  Object.defineProperty(global, 'navigator', {
    value: { geolocation: { getCurrentPosition: function (s, e, opts) { captured = opts; } } },
    configurable: true
  });

  var p = new WeatherProvider();
  p.gpsMaxAgeMs = 30 * 60000;
  p.withGpsCoordinates(function () {}, function () {});
  assert.equal(captured.maximumAge, 30 * 60000);
  assert.equal(captured.enableHighAccuracy, true);
  assert.equal(captured.timeout, 10000);

  var p2 = new WeatherProvider();   // gpsMaxAgeMs unset
  p2.withGpsCoordinates(function () {}, function () {});
  assert.equal(captured.maximumAge, 10000);
});
