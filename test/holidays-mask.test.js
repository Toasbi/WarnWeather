// test/holidays-mask.test.js
const test = require('node:test');
const assert = require('node:assert/strict');

// localStorage shim must exist before requiring the modules (nager-source reads it).
const store = {};
global.localStorage = {
  getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; },
  clear: () => { Object.keys(store).forEach((k) => { delete store[k]; }); },
  key: (i) => { const ks = Object.keys(store); return i >= 0 && i < ks.length ? ks[i] : null; },
  get length() { return Object.keys(store).length; }
};

const holidayMask = require('../src/pkjs/holidays/holiday-mask.js');
const daysFromCivil = require('../src/pkjs/holidays/serial-day.js');
const nagerSource = require('../src/pkjs/holidays/nager-source.js');

const JUN_25_2026 = new Date(2026, 5, 25); // Thursday

// Seed a country's cache the way a real fetch would, then return.
function seed(country, apiList) {
  global.localStorage.clear();
  nagerSource.ensure(country, [2026], () => {}, {
    now: () => Date.UTC(2026, 5, 25),
    request: (url, ok) => ok(JSON.stringify(apiList))
  });
}

test('anchor is grid cell-0 for the four weekStart/firstWeek combos', () => {
  seed('US', [{ date: '2026-07-03', global: true, counties: null }]);
  const base = { country: 'US', region: 'all', enabled: true };
  assert.equal(holidayMask.build(Object.assign({}, base, { startMon: false, prevWeek: false }), JUN_25_2026).anchor, daysFromCivil(2026, 6, 21));
  assert.equal(holidayMask.build(Object.assign({}, base, { startMon: false, prevWeek: true }), JUN_25_2026).anchor, daysFromCivil(2026, 6, 14));
  assert.equal(holidayMask.build(Object.assign({}, base, { startMon: true, prevWeek: false }), JUN_25_2026).anchor, daysFromCivil(2026, 6, 22));
  assert.equal(holidayMask.build(Object.assign({}, base, { startMon: true, prevWeek: true }), JUN_25_2026).anchor, daysFromCivil(2026, 6, 15));
});

test('a cached observed holiday sets its bit (Fri Jul 3 2026)', () => {
  seed('US', [{ date: '2026-07-03', global: true, counties: null }]);
  const result = holidayMask.build({ startMon: false, prevWeek: false, country: 'US', region: 'all', enabled: true }, JUN_25_2026);
  const bit = daysFromCivil(2026, 7, 3) - result.anchor;
  assert.ok(bit >= 0 && bit < 28);
  assert.equal((result.mask >>> bit) & 1, 1);
  const bitSat = daysFromCivil(2026, 7, 4) - result.anchor;
  assert.equal((result.mask >>> bitSat) & 1, 0);
});

test('empty cache yields mask 0 with a valid anchor (offline / pre-fetch)', () => {
  global.localStorage.clear();
  const result = holidayMask.build({ startMon: false, prevWeek: false, country: 'US', region: 'all', enabled: true }, JUN_25_2026);
  assert.equal(result.mask, 0);
  assert.equal(result.anchor, daysFromCivil(2026, 6, 21));
});

test('country none yields mask 0 with a valid anchor', () => {
  seed('US', [{ date: '2026-07-03', global: true, counties: null }]);
  const result = holidayMask.build({ startMon: false, prevWeek: false, country: 'none', region: 'all', enabled: true }, JUN_25_2026);
  assert.equal(result.mask, 0);
  assert.equal(result.anchor, daysFromCivil(2026, 6, 21));
});

test('disabled yields mask 0 but a valid anchor', () => {
  seed('US', [{ date: '2026-07-03', global: true, counties: null }]);
  const result = holidayMask.build({ startMon: false, prevWeek: false, country: 'US', region: 'all', enabled: false }, JUN_25_2026);
  assert.equal(result.mask, 0);
  assert.equal(result.anchor, daysFromCivil(2026, 6, 21));
});

test('region threading: a regional day lights only when its region is selected', () => {
  // Controlled in-window fixture (Jul 6 2026 is inside the Jun 21..Jul 18 window).
  seed('DE', [{ date: '2026-07-06', global: false, counties: ['DE-BY'] }]);
  const all = holidayMask.build({ startMon: false, prevWeek: false, country: 'DE', region: 'all', enabled: true }, JUN_25_2026);
  const by = holidayMask.build({ startMon: false, prevWeek: false, country: 'DE', region: 'DE-BY', enabled: true }, JUN_25_2026);
  assert.equal(all.mask, 0);    // not nationwide
  assert.ok(by.mask !== 0);     // Bavaria sees it
});

test('windowYears returns one year normally', () => {
  assert.deepEqual(holidayMask.windowYears({ startMon: false, prevWeek: false }, new Date(2026, 5, 25)), [2026]);
});

test('windowYears returns two years when the window crosses into next year', () => {
  assert.deepEqual(holidayMask.windowYears({ startMon: false, prevWeek: false }, new Date(2026, 11, 28)), [2026, 2027]);
});

test('pack is little-endian and round-trips', () => {
  const bytes = holidayMask.pack(0x01020304, 0xAABBCCDD);
  assert.deepEqual(bytes, [0x04, 0x03, 0x02, 0x01, 0xDD, 0xCC, 0xBB, 0xAA]);
  const anchor = bytes[0] | (bytes[1] << 8) | (bytes[2] << 16) | (bytes[3] << 24);
  const mask = (bytes[4] | (bytes[5] << 8) | (bytes[6] << 16) | (bytes[7] << 24)) >>> 0;
  assert.equal(anchor, 0x01020304);
  assert.equal(mask, 0xAABBCCDD);
});
