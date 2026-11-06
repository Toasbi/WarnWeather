'use strict';
const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const places = require('../lib/places');
const cache = require('../lib/cache');
const { installHost, uninstallHost, weatherLocation } = require('./helpers/host');

afterEach(() => uninstallHost());

test('the user\'s weather locations, in their order, the current one at the phone\'s position', async () => {
  installHost({
    locations: [
      weatherLocation('home', 'Freiburg', 47.99, 7.85),
      weatherLocation('here', 'Current location', null, null),
      weatherLocation('work', 'Basel', 47.56, 7.59),
    ],
    position: { latitude: 48.001, longitude: 7.842 },
  });
  const found = await places.readPlaces();
  assert.deepEqual(found.map((place) => place.id), ['home', 'here', 'work']);
  assert.deepEqual(found[0].coords, { latitude: 47.99, longitude: 7.85 });
  assert.deepEqual(found[1], { id: 'here', name: 'Current location', current: true,
    coords: { latitude: 48.001, longitude: 7.842 } });
});

test('without weather locations, just where the phone is', async () => {
  installHost({ locations: new Error('unavailable'), position: { latitude: 52.5, longitude: 13.4 } });
  const found = await places.readPlaces();
  assert.deepEqual(found, [{ id: 'current', name: 'Current location', current: true,
    coords: { latitude: 52.5, longitude: 13.4 } }]);
});

test('a refused position marks the place, so the source can say permission', async () => {
  installHost({
    locations: [weatherLocation('here', 'Current location', null, null), weatherLocation('home', 'Kiel', 54.32, 10.12)],
    position: Object.assign(new Error('refused'), { code: 1 }),
  });
  const found = await places.readPlaces();
  assert.equal(found[0].error.permission, true);
  assert.equal(found[0].coords, undefined);
  assert.deepEqual(found[1].coords, { latitude: 54.32, longitude: 10.12 });
});

test('coordinates are rounded to two decimals before they leave the phone', () => {
  assert.deepEqual(places.roundCoords({ latitude: 47.98765, longitude: -7.8449 }), { latitude: 47.99, longitude: -7.84 });
});

test('a fresh entry is served without a fetch', async () => {
  const entries = { k: { fetchedAt: 1000, expiresAt: 5000, forecast: 'stored' } };
  const result = await cache.cached(entries, 'k', {
    nowMs: 2000, ttlMs: 4000, staleMs: 10000, retryMs: 100, fetch: () => assert.fail('fetched'),
  });
  assert.deepEqual(result, { forecast: 'stored', validUntilMs: 5000, updated: false, stale: false });
});

test('an expired entry is fetched again and replaced', async () => {
  const entries = { k: { fetchedAt: 1000, expiresAt: 5000, forecast: 'old' } };
  const result = await cache.cached(entries, 'k', {
    nowMs: 6000, ttlMs: 4000, staleMs: 10000, retryMs: 100, fetch: async () => 'new',
  });
  assert.deepEqual(result, { forecast: 'new', validUntilMs: 10000, updated: true, stale: false });
  assert.deepEqual(entries.k, { fetchedAt: 6000, expiresAt: 10000, forecast: 'new' });
});

test('a failed fetch falls back to a recent entry, retried soon; an old one gives up', async () => {
  const entries = { k: { fetchedAt: 1000, expiresAt: 5000, forecast: 'old' } };
  const failing = async () => {
    throw new Error('down');
  };
  const stale = await cache.cached(entries, 'k', { nowMs: 6000, ttlMs: 4000, staleMs: 10000, retryMs: 300, fetch: failing });
  assert.deepEqual(stale, { forecast: 'old', validUntilMs: 6300, updated: false, stale: true });
  await assert.rejects(cache.cached(entries, 'k', { nowMs: 12000, ttlMs: 4000, staleMs: 10000, retryMs: 300, fetch: failing }), /down/);
});

test('an entry stamped in the future (a clock change) counts as expired', async () => {
  const entries = { k: { fetchedAt: 9000, expiresAt: 13000, forecast: 'odd' } };
  const result = await cache.cached(entries, 'k', { nowMs: 2000, ttlMs: 1000, staleMs: 10, retryMs: 1, fetch: async () => 'new' });
  assert.equal(result.forecast, 'new');
});

test('entries round-trip through localStorage, pruned by age and count', () => {
  installHost({});
  const now = 100 * 24 * 3600 * 1000;
  const staleMs = 6 * 3600 * 1000;
  // Past the source's staleMs an entry can never be served again, not even when a fetch fails.
  const entries = { old: { fetchedAt: now - staleMs, expiresAt: 0, forecast: 1 } };
  for (let i = 0; i < cache.MAX_ENTRIES + 3; i += 1) {
    entries['p' + i] = { fetchedAt: now - i * 1000, expiresAt: now, forecast: i };
  }
  cache.save(entries, now, staleMs);
  const loaded = cache.load();
  assert.equal(Object.keys(loaded).length, cache.MAX_ENTRIES);
  assert.equal(loaded.old, undefined);
  assert.equal(loaded.p0.forecast, 0);
  assert.equal(loaded['p' + (cache.MAX_ENTRIES + 2)], undefined);
});

test('an unreadable or older-version store reads as empty', () => {
  installHost({});
  localStorage.setItem(cache.STORAGE_KEY, '{not json');
  assert.deepEqual(cache.load(), {});
  localStorage.setItem(cache.STORAGE_KEY, JSON.stringify({ v: cache.VERSION - 1, entries: { k: {} } }));
  assert.deepEqual(cache.load(), {});
});
