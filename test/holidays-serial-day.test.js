// test/holidays-serial-day.test.js
const test = require('node:test');
const assert = require('node:assert/strict');

const daysFromCivil = require('../src/pkjs/holidays/serial-day.js');

test('epoch and known anchors', () => {
  assert.equal(daysFromCivil(1970, 1, 1), 0);
  assert.equal(daysFromCivil(2000, 1, 1), 10957);
  assert.equal(daysFromCivil(2021, 1, 1), 18628);
});

test('consecutive days differ by one', () => {
  assert.equal(daysFromCivil(2026, 1, 2) - daysFromCivil(2026, 1, 1), 1);
  assert.equal(daysFromCivil(2027, 1, 1) - daysFromCivil(2026, 12, 31), 1);
});

test('leap day is counted in a leap year', () => {
  // 2024 is a leap year: Feb 28 → Mar 1 spans two days (Feb 29 exists).
  assert.equal(daysFromCivil(2024, 3, 1) - daysFromCivil(2024, 2, 28), 2);
  // 2026 is not a leap year: Feb 28 → Mar 1 spans one day.
  assert.equal(daysFromCivil(2026, 3, 1) - daysFromCivil(2026, 2, 28), 1);
});
