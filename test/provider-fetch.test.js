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

// The compose step runs inside an XHR callback in production, so a throw there
// escapes both callbacks and leaves index.js's fetchInProgress set for good.
// It must fail the fetch instead — once, and never on top of a success.
function composeHarness(t, payloadTransform, onAckHook) {
  const outbox = require('../src/pkjs/outbox.js');
  const realSend = outbox.sendWeather;
  const sends = [];
  outbox.sendWeather = function (payload, onAck) { sends.push(payload); onAck(); };
  t.after(function () { outbox.sendWeather = realSend; });

  const p = new WeatherProvider();
  p.withCityName = function (lat, lon, cb) { cb('Berlin', 'DE'); };
  p.withSunEvents = function (lat, lon, cb) {
    cb([{ type: 'sunset', date: new Date(1781989200 * 1000) },
      { type: 'sunrise', date: new Date(1782018000 * 1000) }]);
  };
  p.withProviderData = function (lat, lon, force, onSuccess) {
    p.tempTrend = new Array(24).fill(10);
    p.precipTrend = new Array(24).fill(0);
    p.startTime = 1781949600;
    p.currentTemp = 5;
    onSuccess();
  };
  const outcome = { success: 0, failures: [], sends: sends, escaped: null };
  try {
    p.fetchWithCoordinates(52.5, 13.4,
      function () { outcome.success += 1; if (onAckHook) { onAckHook(); } },
      function (f) { outcome.failures.push(f); },
      false, null, payloadTransform);
  } catch (ex) {
    outcome.escaped = ex;
  }
  return outcome;
}

test('a payload build error fails the fetch exactly once instead of escaping', (t) => {
  const outcome = composeHarness(t, function () { throw new TypeError('boom'); });
  assert.equal(outcome.escaped, null, 'nothing escapes into the XHR callback');
  assert.deepEqual(outcome.failures, [{ stage: 'compose', code: 'exception' }],
    'onFailure fires once, so index.js releases fetchInProgress');
  assert.equal(outcome.success, 0);
  assert.equal(outcome.sends.length, 0, 'nothing half-built reaches the outbox');
});

test('a throw from inside the ACK callback is not also reported as a failure', (t) => {
  const outcome = composeHarness(t, null, function () { throw new Error('in onSuccess'); });
  assert.equal(outcome.success, 1);
  assert.deepEqual(outcome.failures, [], 'sendWeather sits outside the compose guard');
  assert.equal(outcome.escaped && outcome.escaped.message, 'in onSuccess');
});
