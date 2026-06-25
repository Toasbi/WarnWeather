// test/holidays-registry.test.js
const test = require('node:test');
const assert = require('node:assert/strict');

const registry = require('../src/pkjs/holidays/registry.js');

test('getProvider returns the US provider', () => {
  const p = registry.getProvider('US');
  assert.ok(p, 'US should have a provider');
  assert.equal(typeof p.isHoliday, 'function');
});

test('getProvider returns null for none, unimplemented, and unknown countries', () => {
  assert.equal(registry.getProvider('none'), null);
  assert.equal(registry.getProvider('DE'), null); // listed in UI, no provider yet
  assert.equal(registry.getProvider('ZZ'), null); // unknown code
  assert.equal(registry.getProvider(undefined), null);
});
