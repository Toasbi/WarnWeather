// test/fetch-watchdog.test.js
// A weather fetch is asynchronous from the first geolocation call to the
// AppMessage ACK, and app.fetchInProgress used to clear only when a completion
// callback ran. A callback that threw (inside an XHR handler, beyond the
// fetch's own try) or a platform call that never answered left the flag set:
// every later tick skipped with "another fetch is already in progress", and
// every forced fetch (a settings save) started a 3 s retry loop that re-armed
// itself for the rest of the PKJS session — one loop per save. These tests pin
// the watchdog, the single queued forced fetch, and the once-only completion.
const test = require('node:test');
const assert = require('node:assert/strict');
const { HARNESS_NOW, bootIndex, healthyNetwork } = require('./helpers/index-harness.js');

const HOUR_MS = 60 * 60 * 1000;
const WATCHDOG_MS = 2 * 60 * 1000;
const SKIP_IN_PROGRESS = /another fetch is already in progress/;
const FETCHING = /^Fetching from /;

/** A last-success marker two hours old, so every tick finds a refresh due. */
function staleSuccess() {
  return { lastFetchSuccess: JSON.stringify({ time: new Date(HARNESS_NOW - 2 * HOUR_MS).toISOString() }) };
}

test('a geolocation that never answers is abandoned, and queued forced fetches do not poll', (t) => {
  const h = bootIndex(t, { settings: { location: '' }, store: staleSuccess() });
  h.ready();
  assert.equal(h.geoRequests.length, 1, 'the boot tick asked for a GPS fix');

  // Two settings saves while that fetch hangs. Each used to start its own
  // self-re-arming 3 s retry.
  h.saveSettings({ fetch: true });
  h.saveSettings({ fetch: true });
  h.advance(0);
  const skipsBefore = h.count(SKIP_IN_PROGRESS);
  h.advance(50 * 1000);
  assert.ok(h.count(SKIP_IN_PROGRESS) - skipsBefore <= 1,
    'no 3 s polling while the fetch is in flight (saw '
    + (h.count(SKIP_IN_PROGRESS) - skipsBefore) + ' skips in 50 s)');

  h.advance(WATCHDOG_MS);
  assert.equal(h.count(/"stage":"fetch","code":"watchdog_timeout"/), 1,
    'the hung fetch is abandoned and reported as a failure');
  assert.equal(h.geoRequests.length, 2,
    'the queued forced fetch ran once the hung one was abandoned — exactly once for two saves');
  assert.equal(h.uncaught.length, 0);
});

test('a throw inside a response callback cannot stop fetching for the session', (t) => {
  let throwOnce = true;
  const h = bootIndex(t, {
    store: staleSuccess(),
    // The first weather send throws inside the pollen XHR callback, beyond
    // fetch()'s synchronous try/catch.
    onSend: (dict) => {
      if (throwOnce && 'FORECAST_START' in dict) { throwOnce = false; return 'throw'; }
      return 'ack';
    },
  });
  h.ready();
  h.advance(5 * 1000);
  assert.equal(h.uncaught.length, 1, 'the throw escaped into the runtime, as on a phone');
  assert.equal(h.count(/Successfully fetched weather/), 0);

  h.minutes(6);
  assert.ok(h.count(FETCHING) >= 2, 'a later tick starts a fresh fetch');
  assert.equal(h.count(/Successfully fetched weather/), 1, 'and that one delivers');
  const success = JSON.parse(h.store.lastFetchSuccess);
  assert.ok(Date.now() - new Date(success.time).getTime() < 10 * 60 * 1000, 'lastFetchSuccess advanced');
});

test('a forced fetch arriving mid-flight runs once, after the in-flight fetch settles', (t) => {
  const h = bootIndex(t, { store: staleSuccess(), latencyMs: 1000 });
  h.ready();
  assert.equal(h.count(FETCHING), 1);
  h.saveSettings({ fetch: true });
  h.saveSettings({ fetch: true });
  h.advance(0);
  assert.equal(h.count(FETCHING), 1, 'no second fetch overlaps the first');
  h.advance(30 * 1000);
  assert.equal(h.count(FETCHING), 2, 'both forced requests coalesce into ONE refetch');
  assert.equal(h.count(/Successfully fetched weather/), 2);
  assert.equal(h.uncaught.length, 0);
});

test('a GPS fix that arrives after the watchdog gave up starts nothing and sends nothing', (t) => {
  const h = bootIndex(t, { settings: { location: '' }, store: staleSuccess() });
  h.ready();
  h.advance(WATCHDOG_MS + 1000);
  h.minutes(1);
  assert.equal(h.geoRequests.length, 2, 'the abandoned fetch was replaced by a new one');

  // The abandoned fetch's fix finally lands, minutes late.
  h.geoRequests[0].ok({ coords: { latitude: 48.1, longitude: 11.6 } });
  h.advance(10 * 1000);
  assert.equal(h.requestsTo(/geocode\.arcgis\.com/), 0, 'the stale fix spends no requests');
  assert.equal(h.weatherSends().length, 0, 'and puts nothing on the channel');

  // The live fetch still completes normally.
  h.geoRequests[1].ok({ coords: { latitude: 52.52, longitude: 13.4 } });
  h.advance(10 * 1000);
  assert.equal(h.count(/Successfully fetched weather/), 1);
  assert.equal(h.weatherSends().length, 1);
});

// --- the async continuations report a throw as a failure --------------------

test('fetchWithCoordinates reports a compose throw as a failure instead of stranding the fetch', () => {
  const WeatherProvider = require('../src/pkjs/weather/provider.js');
  const airQuality = require('../src/pkjs/weather/air-quality.js');
  const pollen = require('../src/pkjs/weather/pollen.js');
  const outbox = require('../src/pkjs/outbox.js');
  const saved = [airQuality.fetchAqiInto, pollen.fetchPollenInto, outbox.sendWeather];
  const p = new WeatherProvider();
  p.withCityName = (lat, lon, done) => { done('Tromso', 'NO'); };
  p.withSunEvents = (lat, lon, done) => { done([]); };
  p.withProviderData = (lat, lon, force, done) => { done(); };
  p.hasValidData = () => true;
  p.composeWeatherPayload = () => { throw new TypeError("Cannot read properties of undefined (reading 'type')"); };
  airQuality.fetchAqiInto = (prov, lat, lon, done) => { done(); };
  pollen.fetchPollenInto = (prov, lat, lon, done) => { done(); };
  let sent = 0;
  outbox.sendWeather = () => { sent += 1; };
  const failures = [];
  try {
    p.fetchWithCoordinates(69.65, 18.96, assert.fail, (f) => { failures.push(f); }, false, {}, null);
  } finally {
    [airQuality.fetchAqiInto, pollen.fetchPollenInto, outbox.sendWeather] = saved;
  }
  assert.deepEqual(failures, [{ stage: 'compose', code: 'exception' }]);
  assert.equal(sent, 0);
});

test('fetchWithCoordinates drops the payload of a fetch its caller abandoned', () => {
  const WeatherProvider = require('../src/pkjs/weather/provider.js');
  const airQuality = require('../src/pkjs/weather/air-quality.js');
  const pollen = require('../src/pkjs/weather/pollen.js');
  const outbox = require('../src/pkjs/outbox.js');
  const saved = [airQuality.fetchAqiInto, pollen.fetchPollenInto, outbox.sendWeather];
  const p = new WeatherProvider();
  p.withCityName = (lat, lon, done) => { done('Berlin', 'DE'); };
  p.withSunEvents = (lat, lon, done) => { done([]); };
  p.withProviderData = (lat, lon, force, done) => { done(); };
  p.hasValidData = () => true;
  p.composeWeatherPayload = () => ({ CITY: 'Berlin' });
  airQuality.fetchAqiInto = (prov, lat, lon, done) => { done(); };
  pollen.fetchPollenInto = (prov, lat, lon, done) => { done(); };
  let sent = 0;
  outbox.sendWeather = () => { sent += 1; };
  try {
    p.fetchWithCoordinates(52.52, 13.4, assert.fail, assert.fail, false, {}, null, () => false);
    assert.equal(sent, 0, 'an abandoned fetch never sends');
    p.fetchWithCoordinates(52.52, 13.4, assert.fail, assert.fail, false, {}, null, () => true);
    assert.equal(sent, 1, 'the live one does');
  } finally {
    [airQuality.fetchAqiInto, pollen.fetchPollenInto, outbox.sendWeather] = saved;
  }
});

test('requestMapped reports a throwing map as <id>_map_error', () => {
  const WeatherProvider = require('../src/pkjs/weather/provider.js');
  const realRequest = WeatherProvider.request;
  WeatherProvider.request = (url, method, onSuccess) => { onSuccess('{"hourly":{}}'); };
  const failures = [];
  try {
    WeatherProvider.requestMapped({ url: 'https://x.test', id: 'openmeteo',
      map: () => { throw new TypeError('boom'); } }, assert.fail, (f) => { failures.push(f); });
  } finally {
    WeatherProvider.request = realRequest;
  }
  assert.deepEqual(failures, [{ stage: 'provider_data', code: 'openmeteo_map_error' }]);
});

test('a throwing radar interpret preserves the radar (null) instead of stranding the chain', () => {
  const WeatherProvider = require('../src/pkjs/weather/provider.js');
  const radarFetch = require('../src/pkjs/weather/radar-fetch.js');
  const realRequest = WeatherProvider.request;
  WeatherProvider.request = (url, method, onSuccess) => { onSuccess('{}'); };
  const results = [];
  try {
    radarFetch.fetchRadarJson({ url: 'https://x.test', label: 'Test' },
      () => { throw new TypeError('boom'); }, (tuples) => { results.push(tuples); });
  } finally {
    WeatherProvider.request = realRequest;
  }
  assert.deepEqual(results, [null], 'called back exactly once, with null');
});

test('the healthy harness network completes a fetch (harness self-check)', (t) => {
  const h = bootIndex(t, { store: staleSuccess(), network: healthyNetwork });
  h.ready();
  h.advance(5 * 1000);
  assert.equal(h.count(/Successfully fetched weather/), 1);
  assert.equal(h.weatherSends().length, 1);
});

test('a storage throw in the attempt bookkeeping neither wedges the fetch nor stops the tick loop', (t) => {
  const h = bootIndex(t, { store: staleSuccess() });
  // A full localStorage: the attempt counter and record writes throw, and so
  // does the failure path that records the resulting exception.
  const realSet = global.localStorage.setItem;
  global.localStorage.setItem = (k, v) => {
    if (k === 'weather_fetch_attempt' || k === 'lastFetchAttempt') { throw new Error('QuotaExceededError'); }
    realSet(k, v);
  };
  assert.doesNotThrow(() => h.ready(), 'the throw stays inside fetch(), off the scheduler tick');
  assert.equal(h.count(/"stage":"fetch","code":"exception"/), 1, 'reported as a failure');
  const ticks = h.count(/^Tick from PKJS/);
  h.minutes(2);
  assert.equal(h.count(/^Tick from PKJS/) - ticks, 2, 'the tick loop is still alive');
  assert.equal(h.count(SKIP_IN_PROGRESS), 0, 'and the in-progress flag did not wedge');
});

['ack', 'nack'].forEach((answer) => {
  test('a late ' + answer.toUpperCase() + ' for an abandoned fetch is ignored and leaves the live fetch in charge', (t) => {
    let holdFirst = true;
    const h = bootIndex(t, {
      store: staleSuccess(),
      latencyMs: 1000,
      // The boot fetch's weather send gets no answer until the test gives one,
      // long after the watchdog gave up on it.
      onSend: (dict) => {
        if (holdFirst && 'FORECAST_START' in dict) { holdFirst = false; return 'hold'; }
        return 'ack';
      },
    });
    h.ready();
    // The watchdog and the next tick fall due together: the boot fetch is
    // abandoned, then the tick starts a fresh one (its first reply is 1 s out).
    h.advance(WATCHDOG_MS);
    assert.equal(h.held.length, 1, 'the boot fetch sent and is still waiting on the watch');
    assert.equal(h.count(/"stage":"fetch","code":"watchdog_timeout"/), 1, 'the watchdog gave up on it');
    assert.equal(h.count(FETCHING), 2, 'a live fetch is in flight');
    const failures = h.count(/Provider failed to update weather/);

    if (answer === 'ack') { h.held[0].ack({}); } else { h.held[0].nack({}); }
    assert.equal(h.count(/Successfully fetched weather/), 0, 'the late answer records no success');
    assert.equal(h.count(/Provider failed to update weather/), failures, 'nor a second failure');

    h.saveSettings({ fetch: true });
    h.advance(0);
    assert.ok(h.count(SKIP_IN_PROGRESS) >= 1,
      'the live fetch still holds the in-progress flag: the late answer did not clear it');
    assert.equal(h.count(FETCHING), 2, 'so no third fetch overlaps it');

    h.advance(30 * 1000);
    assert.equal(h.count(/Successfully fetched weather/), 2,
      'the live fetch and the forced one queued behind it both complete');
    assert.equal(h.uncaught.length, 0);
  });
});
