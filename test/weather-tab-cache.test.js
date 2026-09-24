// test/weather-tab-cache.test.js — the phone's copy of the Weather tab's data:
// stored per the place the tab opens on, served to the page only while it is from
// today, refreshed on settings open at most once a day.
const test = require('node:test');
const assert = require('node:assert/strict');

// Storage must exist before the module loads (the change-detector pattern).
const store = {};
global.localStorage = {
  getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; }
};
const cache = require('../src/pkjs/weather-tab-cache.js');
const storageKeys = require('../src/pkjs/storage-keys.js');
const data = require('../src/pkjs/settings/weather-tab-data.js');

const DAY0 = Math.floor(Date.now() / 86400000) * 86400000;
const SEED = { lat: 52.52, lon: 13.405, name: 'Berlin', gps: true };
const SETTINGS = { graphsProvider: 'openmeteo', graphsLocation: 'current' };

/** @returns {Object} a minimal Open-Meteo response the adapter accepts */
function openMeteoBody() {
  const time = [];
  for (let h = 0; h <= 48; h += 1) { time.push((DAY0 + h * 3600000) / 1000); }
  const fill = (v) => time.map(() => v);
  return {
    utc_offset_seconds: 0,
    hourly: {
      time, temperature_2m: fill(15), precipitation: fill(0), precipitation_probability: fill(10),
      wind_speed_10m: fill(10), wind_gusts_10m: fill(18), wind_direction_10m: fill(200),
      relative_humidity_2m: fill(60), dew_point_2m: fill(8), pressure_msl: fill(1013), weather_code: fill(0)
    },
    daily: { time: [DAY0 / 1000], weather_code: [0], temperature_2m_max: [20], temperature_2m_min: [10],
      precipitation_sum: [0], precipitation_probability_max: [5], sunshine_duration: [28800] }
  };
}

/**
 * Install a fake XHR. `mode` 'ok' answers at once, 'hold' keeps the answer for
 * a later `release()`, 'fail' times out.
 * @param {string} mode Answer mode.
 * @returns {{urls: string[], release: function():void, restore: function():void}} Handle.
 */
function fakeXhr(mode) {
  const urls = [];
  const held = [];
  class FakeXhr {
    open(method, url) { urls.push(url); }
    send() {
      const answer = () => {
        if (mode === 'fail') { this.ontimeout(); return; }
        this.status = 200;
        this.responseText = JSON.stringify(openMeteoBody());
        this.onload();
      };
      if (mode === 'hold') { held.push(answer); } else { answer(); }
    }
  }
  const real = globalThis.XMLHttpRequest;
  globalThis.XMLHttpRequest = FakeXhr;
  return {
    urls,
    release: () => { held.splice(0).forEach((fn) => fn()); },
    restore: () => {
      if (real === undefined) { delete globalThis.XMLHttpRequest; } else { globalThis.XMLHttpRequest = real; }
    }
  };
}

/** Midday of the phone's current local day: "today" whatever time the suite runs. */
function todayNoon() {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  return d.getTime();
}

function reset() {
  Object.keys(store).forEach((k) => { delete store[k]; });
  cache._reset();
  data.clearCache();
}

test('the tab opens on the same provider and place as the page resolves', () => {
  assert.deepEqual(cache.target(SETTINGS, SEED), { provider: 'openmeteo', lat: 52.52, lon: 13.405 });
  const slot = { graphsLocation: '1', savedLocation1: JSON.stringify({ name: 'Oslo', lat: 59.9, lon: 10.7 }) };
  assert.deepEqual(cache.target(slot, SEED), { provider: 'openmeteo', lat: 59.9, lon: 10.7 });
  assert.equal(cache.target({}, null), null, 'no place yet: nothing to fetch');
});

test('an empty phone fetches once on open, then serves the page for the rest of the day', () => {
  reset();
  const xhr = fakeXhr('ok');
  try {
    const now = Date.now();
    assert.equal(cache.forPage(SETTINGS, SEED, now), null, 'nothing stored yet');
    let stored = null;
    assert.equal(cache.refreshIfStale(SETTINGS, SEED, now, (ok) => { stored = ok; }), true);
    assert.equal(stored, true);
    assert.equal(xhr.urls.length, 1);
    const page = cache.forPage(SETTINGS, SEED, now);
    assert.ok(page && page.hourly && page.meta.provider === 'openmeteo', 'today\'s data for the page');
    assert.equal(cache.refreshIfStale(SETTINGS, SEED, now), false, 'a later open the same day: no request');
    assert.equal(xhr.urls.length, 1);
  } finally {
    xhr.restore();
  }
});

test('the stored copy serves only today, this provider and this place', () => {
  reset();
  const xhr = fakeXhr('ok');
  try {
    cache.refreshIfStale(SETTINGS, SEED, Date.now());
    const fetchedAt = cache.read().meta.fetchedAt;
    assert.ok(cache.forPage(SETTINGS, { lat: 52.53, lon: 13.41 }, fetchedAt), 'GPS jitter (~1 km) keeps it');
    assert.equal(cache.forPage(SETTINGS, { lat: 52.6, lon: 13.405 }, fetchedAt), null, '9 km away: another place');
    assert.equal(cache.forPage({ graphsProvider: 'dwd' }, SEED, fetchedAt), null, 'another provider');
    assert.equal(cache.forPage(SETTINGS, SEED, fetchedAt + 36 * 3600000), null, 'tomorrow: stale');
    assert.equal(cache.refreshIfStale(SETTINGS, SEED, fetchedAt + 36 * 3600000), true, 'tomorrow\'s first open refreshes');
  } finally {
    xhr.restore();
  }
});

test('one request at a time, and a failure keeps the old copy', () => {
  reset();
  const hold = fakeXhr('hold');
  try {
    assert.equal(cache.refreshIfStale(SETTINGS, SEED, Date.now()), true);
    assert.equal(cache.refreshIfStale(SETTINGS, SEED, Date.now()), false, 'a reopen while in flight waits');
    assert.equal(hold.urls.length, 1);
    hold.release();
  } finally {
    hold.restore();
  }
  const before = store[storageKeys.WEATHER_TAB_CACHE_KEY];
  const fail = fakeXhr('fail');
  try {
    const tomorrow = Date.now() + 86400000;
    let ok = null;
    assert.equal(cache.refreshIfStale(SETTINGS, SEED, tomorrow, (r) => { ok = r; }), true);
    assert.equal(ok, false);
    assert.equal(store[storageKeys.WEATHER_TAB_CACHE_KEY], before, 'the old copy stays');
    assert.equal(cache.refreshIfStale(SETTINGS, SEED, tomorrow), true, 'and the next open tries again');
  } finally {
    fail.restore();
  }
});

test('a corrupt or foreign stored value reads as empty', () => {
  reset();
  store[storageKeys.WEATHER_TAB_CACHE_KEY] = '{not json';
  assert.equal(cache.read(), null);
  store[storageKeys.WEATHER_TAB_CACHE_KEY] = JSON.stringify({ v: 99, data: { hourly: {}, meta: {} } });
  assert.equal(cache.read(), null, 'another version');
  store[storageKeys.WEATHER_TAB_CACHE_KEY] = JSON.stringify({ v: 1, data: { hourly: {}, meta: { provider: 'openmeteo' } } });
  assert.equal(cache.read(), null, 'no fetch time or place');
  assert.equal(cache.forPage(SETTINGS, SEED, todayNoon()), null);
});
