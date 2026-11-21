'use strict';
// The days the watch has left, as its battery percentage slot shows them in place of the
// percentage: what counts as an estimate, how it is counted down, and when the slot goes
// back to the percentage.
const test = require('node:test');
const assert = require('node:assert/strict');
const batteryDays = require('../../../src/pkjs/status-bars/domain/battery-days.js');

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.UTC(2026, 10, 21, 12, 0, 0);

test('the slot shows the days only when it is set to', () => {
  assert.equal(batteryDays.wanted({ batteryPctSlotShow: 'days' }), true);
  assert.equal(batteryDays.wanted({ batteryPctSlotShow: 'percent' }), false);
  assert.equal(batteryDays.wanted({}), false, 'the percentage is the default');
  assert.equal(batteryDays.wanted(null), false);
  assert.equal(batteryDays.wanted({ batteryPctSlotShow: 'DAYS' }), false, 'exactly "days"');
});

test('an estimate needs whole days and the time it was made at', () => {
  assert.deepEqual(batteryDays.estimateOf(5, T0), { days: 5, updatedAt: T0 });
  assert.deepEqual(batteryDays.estimateOf(5.9, T0), { days: 5, updatedAt: T0 }, 'whole days, never rounded up');
  // Muninn reports -1 for a number it does not have yet, and 0 days reads as none too.
  [-1, 0, 0.5, NaN, Infinity, null, undefined, '5'].forEach((days) =>
    assert.equal(batteryDays.estimateOf(days, T0), null, 'days ' + String(days)));
  [-1, 0, NaN, Infinity, null, undefined, '1'].forEach((at) =>
    assert.equal(batteryDays.estimateOf(5, at), null, 'updatedAt ' + String(at)));
});

test('the days count down by the whole days since the estimate was made', () => {
  const estimate = { days: 5, updatedAt: T0 };
  assert.equal(batteryDays.daysLeft(estimate, T0), 5);
  assert.equal(batteryDays.daysLeft(estimate, T0 + DAY - 1), 5, 'not before a whole day has passed');
  assert.equal(batteryDays.daysLeft(estimate, T0 + DAY), 4);
  assert.equal(batteryDays.daysLeft(estimate, T0 + 2 * DAY), 3, 'the oldest estimate still shown');
});

test('an estimate older than two days is not shown', () => {
  const estimate = { days: 9, updatedAt: T0 };
  assert.equal(batteryDays.daysLeft(estimate, T0 + batteryDays.MAX_AGE_MS), 7);
  assert.equal(batteryDays.daysLeft(estimate, T0 + batteryDays.MAX_AGE_MS + 1), null);
});

test('less than a day left reads as the percentage', () => {
  assert.equal(batteryDays.daysLeft({ days: 1, updatedAt: T0 }, T0), 1);
  assert.equal(batteryDays.daysLeft({ days: 1, updatedAt: T0 }, T0 + DAY), null);
  assert.equal(batteryDays.daysLeft({ days: 2, updatedAt: T0 }, T0 + 2 * DAY), null);
});

test('no estimate, or one that is none, reads as the percentage', () => {
  [null, undefined, {}, { days: -1, updatedAt: T0 }, { days: 5, updatedAt: -1 },
    { days: 5 }, { updatedAt: T0 }].forEach((estimate) =>
    assert.equal(batteryDays.daysLeft(estimate, T0), null, JSON.stringify(estimate)));
});

test('a clock that went backwards counts no age', () => {
  assert.equal(batteryDays.daysLeft({ days: 5, updatedAt: T0 }, T0 - 3 * DAY), 5);
});

test('the slot prints at most 99 days, in three bytes', () => {
  assert.equal(batteryDays.daysLeft({ days: 240, updatedAt: T0 }, T0), 99);
  assert.equal(batteryDays.text(99), '99d');
  assert.equal(batteryDays.text(5), '5d');
});
