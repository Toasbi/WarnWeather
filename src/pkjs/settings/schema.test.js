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
  ['holidayCountry', 'holidayRegionDE', 'holidayRegionAT', 'holidayRegionCH',
   'holidayRegionES', 'holidayRegionGB', 'holidayRegionUS'].forEach((key) => {
    const it = findItem(schema, key);
    assert.ok(it, 'missing schema item ' + key);
    assert.equal(it.type, 'searchSelect', key + ' should be searchSelect');
    assert.ok(Array.isArray(it.options) && it.options.length > 0, key + ' keeps its options');
  });
});

test('non-holiday selects stay plain select (spot check)', () => {
  assert.equal(findItem(schema, 'fetchIntervalMin').type, 'select');
  assert.equal(findItem(schema, 'btIcons').type, 'select');
});
