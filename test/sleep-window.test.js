// test/sleep-window.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { isWithinSleepWindow, isPastRefreshSlot } = require('../src/pkjs/sleep-window');

function at(hour) { const d = new Date(); d.setHours(hour, 0, 0, 0); return d; }
const ON = { sleepNightEnabled: true, sleepStartHour: '22', sleepEndHour: '7' };

test('disabled toggle is never in window', () => {
  assert.equal(isWithinSleepWindow(at(3), { sleepNightEnabled: false, sleepStartHour: '22', sleepEndHour: '7' }), false);
});

test('window wrapping midnight', () => {
  assert.equal(isWithinSleepWindow(at(23), ON), true);
  assert.equal(isWithinSleepWindow(at(3), ON), true);
  assert.equal(isWithinSleepWindow(at(7), ON), false); // end exclusive
  assert.equal(isWithinSleepWindow(at(12), ON), false);
});

test('non-wrapping window', () => {
  const s = { sleepNightEnabled: true, sleepStartHour: '1', sleepEndHour: '5' };
  assert.equal(isWithinSleepWindow(at(2), s), true);
  assert.equal(isWithinSleepWindow(at(6), s), false);
});

test('invalid hours fall back to 22..7', () => {
  const s = { sleepNightEnabled: true, sleepStartHour: 'x', sleepEndHour: '99' };
  assert.equal(isWithinSleepWindow(at(23), s), true);
  assert.equal(isWithinSleepWindow(at(8), s), false);
});

test('zero-length window is never in window', () => {
  const s = { sleepNightEnabled: true, sleepStartHour: '5', sleepEndHour: '5' };
  assert.equal(isWithinSleepWindow(at(5), s), false);
});

test('isPastRefreshSlot trips only when now is in a later slot', () => {
  const interval = 30 * 60 * 1000;
  assert.equal(isPastRefreshSlot(0, interval, interval), true);
  assert.equal(isPastRefreshSlot(interval, interval + 1, interval), false);
  assert.equal(isPastRefreshSlot(interval, 2 * interval, interval), true);
});
