// src/pkjs/settings/schema.test.js — guards that the holiday pickers use the searchable control.
const test = require('node:test');
const assert = require('node:assert/strict');
const schema = require('./schema.js');

function findItem(s, key) {
  let found = null;
  s.tabs.forEach((t) => t.sections.forEach((sec) => (sec.items || []).forEach((it) => {
    if (it.messageKey === key) { found = it; }
  })));
  return found;
}

test('holiday pickers use the searchSelect control', () => {
  // holidayCountry has a static options list; holidayRegion uses optionsFrom.
  const countryItem = findItem(schema, 'holidayCountry');
  assert.ok(countryItem, 'missing schema item holidayCountry');
  assert.equal(countryItem.type, 'searchSelect', 'holidayCountry should be searchSelect');
  assert.ok(Array.isArray(countryItem.options) && countryItem.options.length > 0, 'holidayCountry keeps its options');

  const regionItem = findItem(schema, 'holidayRegion');
  assert.ok(regionItem, 'missing schema item holidayRegion');
  assert.equal(regionItem.type, 'searchSelect', 'holidayRegion should be searchSelect');
  assert.ok(regionItem.optionsFrom && typeof regionItem.optionsFrom === 'object', 'holidayRegion uses optionsFrom');
});

test('non-holiday selects stay plain select (spot check)', () => {
  assert.equal(findItem(schema, 'fetchIntervalMin').type, 'select');
  assert.equal(findItem(schema, 'btIcons').type, 'select');
});
