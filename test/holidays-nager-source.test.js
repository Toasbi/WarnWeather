// test/holidays-nager-source.test.js
const test = require('node:test');
const assert = require('node:assert/strict');

// Minimal localStorage fake, reinstalled before each test (the module reads the
// global `localStorage` at call time, matching clay-settings.test.js).
function installStorage() {
  const store = {};
  global.localStorage = {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    clear: () => { Object.keys(store).forEach((k) => { delete store[k]; }); },
    key: (i) => { const ks = Object.keys(store); return i >= 0 && i < ks.length ? ks[i] : null; },
    get length() { return Object.keys(store).length; }
  };
}

installStorage();
const nagerSource = require('../src/pkjs/holidays/nager-source.js');

const NOW = Date.UTC(2026, 5, 25);
const DAY = 24 * 60 * 60 * 1000;
const DE_2026 = JSON.stringify([
  { date: '2026-01-01', global: true,  counties: null },                        // nationwide
  { date: '2026-01-06', global: false, counties: ['DE-BW', 'DE-BY', 'DE-ST'] }   // regional
]);

test.beforeEach(() => { installStorage(); });

test('ensure fetches a missing year, caches it, and calls onUpdated', () => {
  let updated = 0;
  let requestedUrl = '';
  nagerSource.ensure('DE', [2026], () => { updated += 1; }, {
    now: () => NOW,
    request: (url, onOk) => { requestedUrl = url; onOk(DE_2026); }
  });
  assert.equal(requestedUrl, 'https://date.nager.at/api/v3/PublicHolidays/2026/DE');
  assert.equal(updated, 1);
  assert.equal(nagerSource.isHoliday('DE', 'all', new Date(2026, 0, 1)), true);
});

test('second ensure within the 30-day TTL makes no request', () => {
  nagerSource.ensure('DE', [2026], () => {}, { now: () => NOW, request: (u, ok) => ok(DE_2026) });
  let called = false;
  nagerSource.ensure('DE', [2026], () => {}, {
    now: () => NOW + DAY,
    request: () => { called = true; }
  });
  assert.equal(called, false);
});

test('stale cache (> 30 days) re-fetches', () => {
  nagerSource.ensure('DE', [2026], () => {}, { now: () => NOW, request: (u, ok) => ok(DE_2026) });
  let called = false;
  nagerSource.ensure('DE', [2026], () => {}, {
    now: () => NOW + 31 * DAY,
    request: (u, ok) => { called = true; ok(DE_2026); }
  });
  assert.equal(called, true);
});

test('regional holiday matches only its region, not "all"', () => {
  nagerSource.ensure('DE', [2026], () => {}, { now: () => NOW, request: (u, ok) => ok(DE_2026) });
  const epiphany = new Date(2026, 0, 6);
  assert.equal(nagerSource.isHoliday('DE', 'all', epiphany), false);
  assert.equal(nagerSource.isHoliday('DE', 'DE-BY', epiphany), true);
  assert.equal(nagerSource.isHoliday('DE', 'DE-BE', epiphany), false);
});

test('nationwide holiday matches "all" and every region', () => {
  nagerSource.ensure('DE', [2026], () => {}, { now: () => NOW, request: (u, ok) => ok(DE_2026) });
  const ny = new Date(2026, 0, 1);
  assert.equal(nagerSource.isHoliday('DE', 'all', ny), true);
  assert.equal(nagerSource.isHoliday('DE', 'DE-BY', ny), true);
});

test('uncached country/year and ordinary dates return false', () => {
  assert.equal(nagerSource.isHoliday('FR', 'all', new Date(2026, 0, 1)), false);
  nagerSource.ensure('DE', [2026], () => {}, { now: () => NOW, request: (u, ok) => ok(DE_2026) });
  assert.equal(nagerSource.isHoliday('DE', 'all', new Date(2026, 2, 17)), false);
});

test('failed fetch sets a backoff that suppresses the next attempt', () => {
  let attempts = 0;
  nagerSource.ensure('DE', [2026], () => {}, {
    now: () => NOW,
    request: (u, ok, err) => { attempts += 1; err(); }
  });
  assert.equal(attempts, 1);
  nagerSource.ensure('DE', [2026], () => {}, {
    now: () => NOW + 60 * 1000,
    request: (u, ok, err) => { attempts += 1; err(); }
  });
  assert.equal(attempts, 1); // within the 1-hour backoff window
});

test('non-global holiday with null/empty counties is inert (never highlighted)', () => {
  const DE_INERT = JSON.stringify([
    { date: '2026-05-01', global: false, counties: null }   // unattributed regional -> inert
  ]);
  nagerSource.ensure('DE', [2026], () => {}, { now: () => NOW, request: (u, ok) => ok(DE_INERT) });
  const mayDay = new Date(2026, 4, 1);
  assert.equal(nagerSource.isHoliday('DE', 'all', mayDay), false);
  assert.equal(nagerSource.isHoliday('DE', 'DE-BY', mayDay), false);
});

test('ensure prunes stale year and other-country keys, keeps the wanted window', () => {
  const KEYS = require('../src/pkjs/storage-keys');
  global.localStorage.setItem(KEYS.HOLIDAY_CACHE_PREFIX + 'DE_2025', JSON.stringify({ f: NOW, h: [] }));
  global.localStorage.setItem(KEYS.HOLIDAY_CACHE_PREFIX + 'US_2026', JSON.stringify({ f: NOW, h: [] }));
  global.localStorage.setItem(KEYS.HOLIDAY_BACKOFF_PREFIX + 'US', String(NOW + DAY));
  global.localStorage.setItem('unrelatedKey', 'kept');
  nagerSource.ensure('DE', [2026, 2027], () => {}, { now: () => NOW, request: (u, ok) => ok(DE_2026) });
  assert.equal(global.localStorage.getItem(KEYS.HOLIDAY_CACHE_PREFIX + 'DE_2025'), null);
  assert.equal(global.localStorage.getItem(KEYS.HOLIDAY_CACHE_PREFIX + 'US_2026'), null);
  assert.equal(global.localStorage.getItem(KEYS.HOLIDAY_BACKOFF_PREFIX + 'US'), null);
  assert.equal(global.localStorage.getItem('unrelatedKey'), 'kept');
  assert.notEqual(global.localStorage.getItem(KEYS.HOLIDAY_CACHE_PREFIX + 'DE_2026'), null);
  assert.notEqual(global.localStorage.getItem(KEYS.HOLIDAY_CACHE_PREFIX + 'DE_2027'), null);
});

test('ensure fetches each year across a year boundary and caches both', () => {
  const requested = [];
  function respond(url, onOk) {
    requested.push(url);
    const year = url.slice(-7, -3); // ".../PublicHolidays/<year>/DE"
    onOk(JSON.stringify([{ date: year + '-01-01', global: true, counties: null }]));
  }
  nagerSource.ensure('DE', [2026, 2027], () => {}, { now: () => NOW, request: respond });
  assert.ok(requested.includes('https://date.nager.at/api/v3/PublicHolidays/2026/DE'));
  assert.ok(requested.includes('https://date.nager.at/api/v3/PublicHolidays/2027/DE'));
  assert.equal(nagerSource.isHoliday('DE', 'all', new Date(2026, 0, 1)), true);
  assert.equal(nagerSource.isHoliday('DE', 'all', new Date(2027, 0, 1)), true);
});
