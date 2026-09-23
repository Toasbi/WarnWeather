// test/fetch-backoff.test.js
// needRefresh() used to read only the last SUCCESS: once fetches started
// failing (provider 5xx or 429, no network, no GPS fix) every 60 s tick ran a
// full fetch cycle again — about 60x the configured hourly rate, against a
// provider that was down or rate-limiting, and a telemetry event per minute.
// Scheduled retries now back off: one tick after the first failure, doubling,
// capped at the refresh interval; a 429 waits the whole interval.
const test = require('node:test');
const assert = require('node:assert/strict');
const createChannelScheduler = require('../src/pkjs/channel-scheduler.js');
const { HARNESS_NOW, bootIndex, healthyNetwork } = require('./helpers/index-harness.js');

const MIN = 60 * 1000;
const HOUR_MS = 60 * MIN;
const FETCHING = /^Fetching from /;
const { failureBackoffMs } = createChannelScheduler;

/** A last-success marker two hours old, so a refresh is due from the start. */
function staleSuccess() {
  return { lastFetchSuccess: JSON.stringify({ time: new Date(HARNESS_NOW - 2 * HOUR_MS).toISOString() }) };
}

/**
 * The healthy network, except Open-Meteo answers `status` to every call.
 *
 * @param {number} status HTTP status for api.open-meteo.com.
 * @returns {Function} Harness network.
 */
function openMeteoDown(status) {
  return (url) => (/api\.open-meteo\.com/.test(url) ? { status, body: '' } : healthyNetwork(url));
}

test('failureBackoffMs: one tick, doubling, capped at the interval', () => {
  const steps = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => failureBackoffMs(n, { code: 'openmeteo_status_503' }, HOUR_MS) / MIN);
  assert.deepEqual(steps, [1, 2, 4, 8, 16, 32, 60, 60]);
  assert.equal(failureBackoffMs(3, null, 15 * MIN), 4 * MIN, 'a failure without a code backs off too');
  assert.equal(failureBackoffMs(9, { code: 'network_error' }, 15 * MIN), 15 * MIN, 'never past the interval');
});

test('failureBackoffMs: a rate limit waits the whole interval at once', () => {
  assert.equal(failureBackoffMs(1, { stage: 'provider_data', code: 'tomorrowio_status_429' }, HOUR_MS), HOUR_MS);
  assert.equal(failureBackoffMs(1, { stage: 'reverse_geocode', code: 'status_429' }, 30 * MIN), 30 * MIN);
  assert.equal(failureBackoffMs(1, { code: 'status_4290' }, HOUR_MS), MIN, 'only a real 429 suffix');
});

test('failureBackoffMs: garbage counters still give a sane backoff', () => {
  [0, -3, NaN, undefined, 'x', Infinity, 1e9].forEach((n) => {
    const ms = failureBackoffMs(n, { code: 'timeout' }, HOUR_MS);
    assert.ok(ms >= MIN && ms <= HOUR_MS, String(n) + ' -> ' + ms);
  });
});

test('a failing provider is retried on a backoff, not on every tick', (t) => {
  const h = bootIndex(t, { store: staleSuccess(), network: openMeteoDown(503) });
  h.ready();
  h.advance(5 * 1000);
  assert.equal(h.count(FETCHING), 1, 'the boot tick fetched and failed');
  h.minutes(1);
  assert.equal(h.count(FETCHING), 2, 'the first retry is on the very next tick');
  h.minutes(59);
  // Attempts at minutes 0, 1, 3, 7, 15, 31 — then 63. It used to be all 61.
  assert.equal(h.count(FETCHING), 6, 'six attempts in the first hour, not one per minute');
  assert.equal(h.store.weather_fetch_attempt, '6');
  assert.equal(h.requestsTo(/geocode\.arcgis\.com/), 6, 'the geocoder is spared too');
  h.minutes(120);
  const perHour = h.count(FETCHING) - 6;
  assert.ok(perHour <= 3, 'once capped, about one attempt per interval (saw ' + perHour + ' in 2 h)');
});

test('a 429 waits out the whole interval before the next scheduled try', (t) => {
  const h = bootIndex(t, { store: staleSuccess(), network: openMeteoDown(429) });
  h.ready();
  h.advance(5 * 1000);
  h.minutes(58);
  assert.equal(h.count(FETCHING), 1, 'no retry inside the interval against a rate limit');
  h.minutes(3);
  assert.equal(h.count(FETCHING), 2, 'retried once the interval passed');
});

test('the backoff is persisted: a restarted PKJS keeps waiting', (t) => {
  const store = staleSuccess();
  store.weather_fetch_attempt = '3';
  store.lastFetchAttempt = JSON.stringify({ time: new Date(HARNESS_NOW - MIN).toISOString(),
    id: 'openmeteo', name: 'Open-Meteo', error: { stage: 'provider_data', code: 'openmeteo_status_503' } });
  const h = bootIndex(t, { store });
  h.ready();
  h.minutes(2);
  assert.equal(h.count(FETCHING), 0, 'three failures in: 4 min from the last attempt, not now');
  h.minutes(2);
  assert.equal(h.count(FETCHING), 1);
  assert.equal(h.count(/Successfully fetched weather/), 1);
});

test('a corrupt attempt record means no backoff, and never kills the tick loop', (t) => {
  const store = staleSuccess();
  store.weather_fetch_attempt = '5';
  store.lastFetchAttempt = '{not json';
  const h = bootIndex(t, { store });
  h.ready();
  h.advance(5 * 1000);
  assert.equal(h.count(FETCHING), 1, 'fetched on the boot tick');
  const ticks = h.count(/^Tick from PKJS/);
  h.minutes(2);
  assert.equal(h.count(/^Tick from PKJS/) - ticks, 2, 'the tick loop is still alive');
});

test('a clock that went backwards past the last attempt does not stall fetching', (t) => {
  const store = staleSuccess();
  store.weather_fetch_attempt = '9';
  store.lastFetchAttempt = JSON.stringify({ time: new Date(HARNESS_NOW + 5 * HOUR_MS).toISOString(),
    error: { code: 'timeout' } });
  const h = bootIndex(t, { store });
  h.ready();
  h.advance(5 * 1000);
  assert.equal(h.count(FETCHING), 1);
});

test('a forced fetch ignores the backoff, and a success clears it', (t) => {
  let down = true;
  const h = bootIndex(t, {
    store: staleSuccess(),
    network: (url) => (down ? openMeteoDown(429)(url) : healthyNetwork(url)),
  });
  h.ready();
  h.advance(5 * 1000);
  h.minutes(5);
  assert.equal(h.count(FETCHING), 1, 'backing off the 429');
  down = false;
  h.saveSettings({ fetch: true });
  h.advance(5 * 1000);
  assert.equal(h.count(FETCHING), 2, 'the Force toggle fetches straight away');
  assert.equal(h.count(/Successfully fetched weather/), 1);
  assert.equal(h.store.weather_fetch_attempt, '0', 'the success reset the failure count');
});

test('a non-numeric refresh interval never turns the backoff into a permanent stall', (t) => {
  // No success marker makes a refresh due whatever the interval; a NaN
  // interval then gives a NaN wait, which must read as "no backoff".
  const h = bootIndex(t, {
    settings: { fetchIntervalMin: 'x' },
    store: { weather_fetch_attempt: '1', lastFetchAttempt: JSON.stringify({
      time: new Date(HARNESS_NOW - MIN).toISOString(), error: { code: 'timeout' } }) },
  });
  h.ready();
  h.advance(5 * 1000);
  assert.equal(h.count(FETCHING), 1, 'the boot tick fetches');
});
