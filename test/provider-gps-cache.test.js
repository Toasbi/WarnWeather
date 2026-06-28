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

// Watch modules touch global.localStorage; install a simple in-memory mock.
function withLocalStorage(map) {
  global.localStorage = {
    getItem: function (k) {
      return Object.prototype.hasOwnProperty.call(map, k) ? map[k] : null;
    },
    setItem: function (k, v) { map[k] = String(v); },
    removeItem: function (k) { delete map[k]; }
  };
}

// Stub navigator.geolocation; tracker records whether native was called + the opts.
// Node exposes navigator as a getter-only property, so defineProperty is required.
function stubGeolocation(impl) {
  var tracker = { called: false, opts: null };
  Object.defineProperty(global, 'navigator', {
    value: {
      geolocation: {
        getCurrentPosition: function (success, error, opts) {
          tracker.called = true;
          tracker.opts = opts;
          if (impl) { impl(success, error, opts); }
        }
      }
    },
    configurable: true
  });
  return tracker;
}

test('withGpsCoordinates: native call requests a fresh fix (maximumAge 0, high accuracy)', () => {
  withLocalStorage({});
  var tracker = stubGeolocation();

  var p = new WeatherProvider();
  p.gpsMaxAgeMs = 30 * 60000;        // window set, but no cache present -> native call
  p.withGpsCoordinates(function () {}, function () {});
  assert.equal(tracker.opts.maximumAge, 0);
  assert.equal(tracker.opts.enableHighAccuracy, true);
  assert.equal(tracker.opts.timeout, 10000);

  var p2 = new WeatherProvider();    // gpsMaxAgeMs unset -> no app reuse -> native call
  p2.withGpsCoordinates(function () {}, function () {});
  assert.equal(tracker.opts.maximumAge, 0);
});

test('withGpsCoordinates reuses a cached fix within the window without calling native GPS', () => {
  var now = Date.now();
  withLocalStorage({ gpsCache: JSON.stringify({ lat: 52.5, lon: 13.4, time: now - 10 * 60000 }) });
  var tracker = stubGeolocation();

  var p = new WeatherProvider();
  p.gpsMaxAgeMs = 30 * 60000;        // 30 min window, fix 10 min old
  var got = null;
  p.withGpsCoordinates(
    function (lat, lon) { got = { lat: lat, lon: lon }; },
    function () { assert.fail('onFailure should not run on a cache hit'); }
  );

  assert.deepEqual(got, { lat: 52.5, lon: 13.4 });
  assert.equal(tracker.called, false);
  assert.equal(p.usedGpsCache, true);
  assert.equal(p.gpsErrorCode, null);
});

test('withGpsCoordinates re-acquires when the cached fix is older than the window', () => {
  var now = Date.now();
  withLocalStorage({ gpsCache: JSON.stringify({ lat: 52.5, lon: 13.4, time: now - 40 * 60000 }) });
  var tracker = stubGeolocation();

  var p = new WeatherProvider();
  p.gpsMaxAgeMs = 30 * 60000;        // 30 min window, fix 40 min old -> stale
  var got = null;
  p.withGpsCoordinates(function (lat, lon) { got = { lat: lat, lon: lon }; }, function () {});

  assert.equal(got, null);
  assert.equal(tracker.called, true);
});

test('withGpsCoordinates re-acquires when there is no cached fix', () => {
  withLocalStorage({});
  var tracker = stubGeolocation();
  var p = new WeatherProvider();
  p.gpsMaxAgeMs = 30 * 60000;
  p.withGpsCoordinates(function () {}, function () {});
  assert.equal(tracker.called, true);
});

test('withGpsCoordinates ignores the app cache when no window is configured', () => {
  var now = Date.now();
  withLocalStorage({ gpsCache: JSON.stringify({ lat: 52.5, lon: 13.4, time: now - 1000 }) });
  var tracker = stubGeolocation();
  var p = new WeatherProvider();   // gpsMaxAgeMs unset -> 0
  var got = null;
  p.withGpsCoordinates(function (lat, lon) { got = { lat: lat, lon: lon }; }, function () {});
  assert.equal(got, null);
  assert.equal(tracker.called, true);
});

test('withGpsCoordinates falls back to a cached fix when native GPS errors', () => {
  var now = Date.now();
  withLocalStorage({ gpsCache: JSON.stringify({ lat: 48.1, lon: 11.6, time: now - 60000 }) });
  stubGeolocation(function (success, error) { error({ code: 2, message: 'position unavailable' }); });

  var p = new WeatherProvider();
  p.gpsMaxAgeMs = 0;    // no app-side window -> reach native -> error -> fallback
  var got = null;
  var failed = false;
  p.withGpsCoordinates(
    function (lat, lon) { got = { lat: lat, lon: lon }; },
    function () { failed = true; }
  );

  assert.deepEqual(got, { lat: 48.1, lon: 11.6 });
  assert.equal(failed, false);
  assert.equal(p.usedGpsCache, true);
  assert.equal(p.gpsErrorCode, 2);
});

test('withGpsCoordinates reports failure when native GPS errors and no cache exists', () => {
  withLocalStorage({});
  stubGeolocation(function (success, error) { error({ code: 1, message: 'denied' }); });

  var p = new WeatherProvider();
  p.gpsMaxAgeMs = 0;
  var failureArg = null;
  p.withGpsCoordinates(
    function () { assert.fail('callback should not fire without a cache'); },
    function (f) { failureArg = f; }
  );

  assert.ok(failureArg);
  assert.equal(p.gpsErrorCode, 1);
});
