// test/fixture-holidays.test.js — a screenshot fixture's holidays: seeded into nager-source's
// cache and the holiday window built for the fixture's date (src/pkjs/fixture-holidays.js).
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

const fixtureHolidays = require('../src/pkjs/fixture-holidays.js');
const holidayMask = require('../src/pkjs/holidays/holiday-mask.js');
const daysFromCivil = require('../src/pkjs/holidays/serial-day.js');
const nagerSource = require('../src/pkjs/holidays/nager-source.js');
const storageKeys = require('../src/pkjs/storage-keys.js');

// The store art's Whitsun Saturday, with Germany's nationwide holidays of 2026.
const FIXTURE = {
  watch: { now: { year: 2026, month: 5, day: 23, hour: 18, minute: 30, second: 0 } },
  holidays: { country: 'DE', year: 2026, days: [['05-14', null], ['05-25', null], ['06-04', ['DE-BW']]] },
};

test('the fixture\'s date is its watch.now, local', () => {
  const d = fixtureHolidays.fixtureDate(FIXTURE);
  assert.deepEqual([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()], [2026, 4, 23, 18, 30]);
  assert.equal(fixtureHolidays.fixtureDate(null), null);
  assert.equal(fixtureHolidays.fixtureDate({ watch: {} }), null);
});

test('a fixture\'s holidays land in nager-source\'s cache, fresh; none without a block', () => {
  global.localStorage.clear();
  assert.equal(fixtureHolidays.seedHolidays({ watch: FIXTURE.watch }, global.localStorage, 1000), false);
  assert.equal(global.localStorage.length, 0);
  assert.equal(fixtureHolidays.seedHolidays(FIXTURE, global.localStorage, 1000), true);
  const entry = JSON.parse(global.localStorage.getItem(storageKeys.HOLIDAY_CACHE_PREFIX + 'DE_2026'));
  assert.deepEqual(entry, { f: 1000, h: FIXTURE.holidays.days });
  assert.equal(nagerSource.isHoliday('DE', 'all', new Date(2026, 4, 25)), true);
  assert.equal(nagerSource.isHoliday('DE', 'all', new Date(2026, 5, 4)), false);
  assert.equal(nagerSource.isHoliday('DE', 'DE-BW', new Date(2026, 5, 4)), true);
});

test('the holiday window built for the fixture\'s date marks Whit Monday and Ascension', () => {
  global.localStorage.clear();
  fixtureHolidays.seedHolidays(FIXTURE, global.localStorage, Date.now());
  const built = holidayMask.build({ startMon: true, prevWeek: true, country: 'DE', region: 'all', enabled: true },
    fixtureHolidays.fixtureDate(FIXTURE));
  // The window's first cell is the Monday of the week before (11 May 2026).
  assert.equal(built.anchor, daysFromCivil(2026, 5, 11));
  assert.equal(built.mask, (1 << (14 - 11)) | (1 << (25 - 11)));
});
