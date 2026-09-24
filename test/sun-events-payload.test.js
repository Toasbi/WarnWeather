// test/sun-events-payload.test.js
// SUN_EVENTS on the weather payload: getPayload must never throw over the sun
// events, and must leave the key out rather than ship a pair the watch cannot
// use. Above the Arctic Circle SunCalc has no sunrise/sunset during midnight
// sun and polar night; the empty list used to throw inside the XHR callback
// chain, so the fetch never finished and every later fetch was skipped.
const test = require('node:test');
const assert = require('node:assert/strict');

global.localStorage = (function () {
  var store = {};
  return {
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    setItem: function (k, v) { store[k] = String(v); },
    removeItem: function (k) { delete store[k]; }
  };
}());

const WeatherProvider = require('../src/pkjs/weather/provider.js');
const outbox = require('../src/pkjs/outbox.js');

const TROMSO = { lat: 69.65, lon: 18.96 };

/**
 * @param {Array|undefined} sunEvents Value for provider.sunEvents.
 * @returns {WeatherProvider} A provider holding enough data for getPayload.
 */
function providerWith(sunEvents) {
  const p = new WeatherProvider();
  p.tempTrend = new Array(24).fill(10);
  p.precipTrend = new Array(24).fill(0);
  p.startTime = 1781949600;
  p.currentTemp = 5;
  p.cityName = 'Tromso';
  p.sunEvents = sunEvents;
  return p;
}

test('getPayload leaves SUN_EVENTS out when there are no sun events', () => {
  [[], undefined, null].forEach(function (events) {
    const payload = providerWith(events).getPayload();
    assert.equal(Object.prototype.hasOwnProperty.call(payload, 'SUN_EVENTS'), false,
      JSON.stringify(events) + ' → key absent, so the outbox skips the sun category');
    assert.equal(payload.CITY, 'Tromso', 'the rest of the payload is still built');
  });
});

test('getPayload leaves SUN_EVENTS out for a single event (the watch needs a pair)', () => {
  const payload = providerWith([
    { type: 'sunset', date: new Date('2026-05-17T21:40:00Z') }
  ]).getPayload();
  assert.equal(Object.prototype.hasOwnProperty.call(payload, 'SUN_EVENTS'), false);
});

test('an Invalid Date never packs as epoch 0', () => {
  const payload = providerWith([
    { type: 'sunrise', date: new Date('2026-06-21T01:00:00Z') },
    { type: 'sunset', date: new Date(NaN) }
  ]).getPayload();
  assert.equal(Object.prototype.hasOwnProperty.call(payload, 'SUN_EVENTS'), false,
    'one real date is not a pair');
});

test('a real pair still encodes as start byte + two little-endian epochs', () => {
  const payload = providerWith([
    { type: 'sunset', date: new Date(1781989200 * 1000) },
    { type: 'sunrise', date: new Date(1782018000 * 1000) }
  ]).getPayload();
  const bytes = payload.SUN_EVENTS;
  assert.equal(bytes.length, 9);
  assert.equal(bytes[0], 1, 'starts on a sunset');
  const view = new DataView(Uint8Array.from(bytes.slice(1)).buffer);
  assert.equal(view.getInt32(0, true), 1781989200);
  assert.equal(view.getInt32(4, true), 1782018000);
});

// The whole chain, with the REAL base withSunEvents: the stages that would
// hit the network are stubbed to answer synchronously, so a throw anywhere in
// the continuation surfaces here instead of being lost in an XHR callback.
function runFetch(t, isoNow) {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse(isoNow) });
  const realSend = outbox.sendWeather;
  const sent = [];
  outbox.sendWeather = function (payload, onAck) { sent.push(payload); onAck(); };
  t.after(function () { outbox.sendWeather = realSend; });

  const p = new WeatherProvider();
  p.withCityName = function (lat, lon, cb) { cb('Tromso', 'NO'); };
  p.withProviderData = function (lat, lon, force, onSuccess) {
    p.tempTrend = new Array(24).fill(10);
    p.precipTrend = new Array(24).fill(0);
    p.startTime = Math.floor(Date.now() / 1000);
    p.currentTemp = 5;
    onSuccess();
  };
  const outcome = { success: 0, failure: [] };
  p.fetchWithCoordinates(TROMSO.lat, TROMSO.lon,
    function () { outcome.success += 1; },
    function (f) { outcome.failure.push(f); },
    false, null, null);
  outcome.sent = sent;
  return outcome;
}

test('a Tromso fetch during midnight sun completes and sends the forecast', (t) => {
  const outcome = runFetch(t, '2026-06-21T12:00:00Z');
  assert.equal(outcome.success, 1, 'onSuccess fires, so the fetch cycle releases its in-progress flag');
  assert.deepEqual(outcome.failure, []);
  assert.equal(outcome.sent.length, 1, 'the forecast reaches the outbox');
  const sun = outcome.sent[0].SUN_EVENTS;
  assert.equal(sun && sun.length, 9, 'a full pair, so the watch replaces its stale one');
  assert.equal(sun[0], 0, 'sunrise then sunset: no night shading');
});

test('a Tromso fetch during polar night completes and sends the forecast', (t) => {
  const outcome = runFetch(t, '2026-12-15T12:00:00Z');
  assert.equal(outcome.success, 1);
  assert.deepEqual(outcome.failure, []);
  assert.equal(outcome.sent.length, 1);
  const sun = outcome.sent[0].SUN_EVENTS;
  assert.equal(sun && sun.length, 9);
  assert.equal(sun[0], 1, 'sunset then sunrise: the whole chart is night');
});
