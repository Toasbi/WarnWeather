// test/tomorrowio-budget.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const budget = require('../src/pkjs/settings/tomorrowio-budget.js');

// Base state: tomorrow.io weather + radar, night pause off.
function S(over) {
  return Object.assign({
    provider: 'tomorrowio', radarProvider: 'tomorrowio',
    sleepNightEnabled: false, sleepStartHour: '0', sleepEndHour: '7'
  }, over || {});
}

test('sleepHours: off -> 0; simple window; midnight-crossing window; start==end -> 0; garbage clamps to 22..7', () => {
  assert.equal(budget.sleepHours(S()), 0);
  assert.equal(budget.sleepHours(S({ sleepNightEnabled: true, sleepStartHour: '0', sleepEndHour: '7' })), 7);
  assert.equal(budget.sleepHours(S({ sleepNightEnabled: true, sleepStartHour: '23', sleepEndHour: '7' })), 8);
  assert.equal(budget.sleepHours(S({ sleepNightEnabled: true, sleepStartHour: '5', sleepEndHour: '5' })), 0);
  // NaN/out-of-range fall back to 22 / 7 (sleep-window.js parity) -> 9 h
  assert.equal(budget.sleepHours(S({ sleepNightEnabled: true, sleepStartHour: 'x', sleepEndHour: '99' })), 9);
});

test('callsPerCycle counts weather and radar selections independently', () => {
  assert.equal(budget.callsPerCycle(S()), 2);
  assert.equal(budget.callsPerCycle(S({ radarProvider: 'rainbow' })), 1);
  assert.equal(budget.callsPerCycle(S({ provider: 'dwd' })), 1);
  assert.equal(budget.callsPerCycle(S({ provider: 'dwd', radarProvider: 'disabled' })), 0);
});

test('fits() truth table from the spec', () => {
  // 5 min + radar + no pause: 24*12*2 = 576 > 500 -> no
  assert.equal(budget.fits(S(), 5), false);
  // 5 min + radar + 4 h pause: 20*12*2 = 480 <= 500, hourly 24 <= 25 -> yes
  assert.equal(budget.fits(S({ sleepNightEnabled: true, sleepStartHour: '0', sleepEndHour: '4' }), 5), true);
  // 5 min, weather only, no pause: 24*12*1 = 288 -> yes
  assert.equal(budget.fits(S({ radarProvider: 'disabled' }), 5), true);
  // midnight-crossing 23->7 = 8 h: 16*12*2 = 384 -> yes
  assert.equal(budget.fits(S({ sleepNightEnabled: true, sleepStartHour: '23', sleepEndHour: '7' }), 5), true);
  // 10 min + radar + no pause: 24*6*2 = 288 -> yes
  assert.equal(budget.fits(S(), 10), true);
});

test('dailyCalls/hourlyCalls match the spec worked example (17 active hours, 5 min, 2 calls -> 408)', () => {
  const s = S({ sleepNightEnabled: true, sleepStartHour: '0', sleepEndHour: '7' });
  assert.equal(budget.dailyCalls(s, 5), 408);
  assert.equal(budget.hourlyCalls(s, 5), 24);
});

test('fittingOptions filters the ladder; full ladder when no tomorrow.io selection; never returns empty', () => {
  assert.deepEqual(budget.fittingOptions(S()).map((o) => o[1]), ['10', '15', '30', '60']);
  assert.deepEqual(budget.fittingOptions(S({ provider: 'dwd', radarProvider: 'disabled' })).map((o) => o[1]),
    ['5', '10', '15', '30', '60']);
  assert.deepEqual(
    budget.fittingOptions(S({ sleepNightEnabled: true, sleepStartHour: '0', sleepEndHour: '4' })).map((o) => o[1]),
    ['5', '10', '15', '30', '60']);
});

test('minSleepHoursFor derives the unlock rule (5 min + radar needs >= 4 h)', () => {
  assert.equal(budget.minSleepHoursFor(S(), 5), 4);
  // weather-only 5 min already fits with zero pause
  assert.equal(budget.minSleepHoursFor(S({ radarProvider: 'disabled' }), 5), 0);
  // no tomorrow.io in play -> 0 (nothing to unlock)
  assert.equal(budget.minSleepHoursFor(S({ provider: 'dwd', radarProvider: 'disabled' }), 5), 0);
});
