// test/holidays-us-federal.test.js
const test = require('node:test');
const assert = require('node:assert/strict');

const usFederal = require('../src/pkjs/holidays/us-federal.js');

// JS Date month arg is 0-based.
const d = (y, m1to12, day) => new Date(y, m1to12 - 1, day);

test('fixed-date holidays on a weekday', () => {
  assert.equal(usFederal.isHoliday(d(2026, 1, 1)), true);   // New Year (Thu)
  assert.equal(usFederal.isHoliday(d(2026, 12, 25)), true); // Christmas (Fri)
});

test('weekday-of-month holidays', () => {
  assert.equal(usFederal.isHoliday(d(2026, 1, 19)), true);  // MLK (3rd Mon Jan)
  assert.equal(usFederal.isHoliday(d(2026, 11, 26)), true); // Thanksgiving (4th Thu Nov)
});

test('weekend-observed shift: Jul 4 2026 is Saturday → observed Friday Jul 3', () => {
  assert.equal(usFederal.isHoliday(d(2026, 7, 4)), false);  // actual date, Saturday
  assert.equal(usFederal.isHoliday(d(2026, 7, 3)), true);   // observed, Friday
});

test('non-holiday weekday and weekends are not holidays', () => {
  assert.equal(usFederal.isHoliday(d(2026, 3, 16)), false); // ordinary Monday
  assert.equal(usFederal.isHoliday(d(2026, 6, 20)), false); // a Saturday
  assert.equal(usFederal.isHoliday(d(2026, 6, 21)), false); // a Sunday
});
