// test/holidays-registry.test.js
const test = require('node:test');
const assert = require('node:assert/strict');

const registry = require('../src/pkjs/holidays/registry.js');

test('getProvider returns null for none and empty values', () => {
  assert.equal(registry.getProvider('none'), null);
  assert.equal(registry.getProvider(''), null);
  assert.equal(registry.getProvider(undefined), null);
});

test('getProvider returns an API-backed provider for any real country', () => {
  ['US', 'DE', 'GB', 'CH'].forEach((cc) => {
    const p = registry.getProvider(cc);
    assert.ok(p, cc + ' should have a provider');
    assert.equal(typeof p.isHoliday, 'function');
    assert.equal(typeof p.ensure, 'function');
  });
});

const KEYS = require('../src/pkjs/storage-keys');

test('getProvider binds the country and reorders args to the source', () => {
  const store = {};
  global.localStorage = {
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    setItem: function (k, v) { store[k] = String(v); },
    removeItem: function (k) { delete store[k]; }
  };
  // Seed DE 2026 with a nationwide New Year's Day holiday (compact cache shape).
  store[KEYS.HOLIDAY_CACHE_PREFIX + 'DE_2026'] = JSON.stringify({ f: 1, h: [['01-01', null]] });

  const jan1 = new Date(2026, 0, 1);
  // DE sees it (country bound + args reordered correctly); US (unseeded) does not.
  // A broken closure or a (date,region) arg pass-through would make DE false too.
  assert.equal(registry.getProvider('DE').isHoliday(jan1, 'all'), true, 'DE provider sees the seeded DE holiday');
  assert.equal(registry.getProvider('US').isHoliday(jan1, 'all'), false, 'US provider does not (country is bound)');
});
