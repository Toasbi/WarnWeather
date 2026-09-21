// test/tomorrowio-budget.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const budget = require('../src/pkjs/settings/tomorrowio-budget.js');
const sleepWindow = require('../src/pkjs/sleep-window.js');

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

// The budget block sits two cards below the Nighttime card, so it has to read the
// SAME window the battery saver actually runs on: sleepStartHour/sleepEndHour, the
// saver's own pair. The card's other two features (theme switching, dim backlight)
// have windows of their own and pause no fetches, so none of their keys may reach
// this number — nor may the retired sleepNight* keys a dev build could still hold.
test('sleepHours reads the saver own pair and nothing else in the Nighttime card', () => {
  const base = { sleepNightEnabled: true, sleepStartHour: '0', sleepEndHour: '7' };
  [{}, { sleepNightMode: 'custom' }, { sleepNightMode: 'night' },
    { sleepNightStartHour: '22', sleepNightEndHour: '6' },
    { backlightDimStartHour: '22', backlightDimEndHour: '6' },
    { themeAutoMode: 'manual', themeAutoStartHour: '20', themeAutoEndHour: '7' }
  ].forEach((over) => {
    assert.equal(budget.sleepHours(S(Object.assign({}, base, over))), 7,
      'the pause must stay the saver own 7 h for ' + JSON.stringify(over));
  });
  // ...and the toggle still wins over any of it.
  assert.equal(budget.sleepHours(S(Object.assign({}, base, { sleepNightEnabled: false }))), 0);
});

// This file is concatenated into the flat config page, which has no require(), so its
// window rule is a hand-kept COPY of sleep-window.js's. Pin the two together over the
// whole input matrix — a change to one that isn't made to the other fails here rather
// than shipping a budget block that disagrees with the watch. Compared against the
// watch's OWN verdict (count the hours isWithinSleepWindow actually pauses), which is
// the invariant that matters rather than the shape of either implementation.
test('the budget pause length matches sleep-window.js exactly (mirror parity)', () => {
  const HOURS = ['0', '5', '7', '22', '23', 'x', '99', undefined];
  const NOISE = [undefined, 'night', 'custom', 'wat'];
  NOISE.forEach((mode) => HOURS.forEach((a) => HOURS.forEach((b) => {
    // sleepNightMode/sleepNight*Hour are the retired keys; they ride along as noise
    // so a reader that quietly started honouring one again fails here.
    const s = { sleepNightEnabled: true, sleepNightMode: mode,
      sleepStartHour: a, sleepEndHour: b, sleepNightStartHour: b, sleepNightEndHour: a };
    let paused = 0;
    for (let h = 0; h < 24; h += 1) {
      const d = new Date();
      d.setHours(h, 0, 0, 0);
      if (sleepWindow.isWithinSleepWindow(d, s)) { paused += 1; }
    }
    assert.equal(budget.sleepHours(s), paused,
      'sleepHours disagrees with the watch for mode=' + mode + ' a=' + a + ' b=' + b);
  })));
});

test('callsPerCycle counts weather and radar selections independently', () => {
  assert.equal(budget.callsPerCycle(S()), 2);
  assert.equal(budget.callsPerCycle(S({ radarProvider: 'rainbow' })), 1);
  assert.equal(budget.callsPerCycle(S({ provider: 'dwd' })), 1);
  assert.equal(budget.callsPerCycle(S({ provider: 'dwd', radarMode: 'off' })), 0);
});

test('callsPerCycle: radarMode off zeroes the radar call even with tomorrow.io selected; any other mode still costs it', () => {
  // provider: 'dwd' isolates the radar contribution (weather call excluded).
  assert.equal(budget.callsPerCycle(S({ provider: 'dwd', radarProvider: 'tomorrowio', radarMode: 'off' })), 0);
  assert.equal(budget.callsPerCycle(S({ provider: 'dwd', radarProvider: 'tomorrowio', radarMode: 'countdown' })), 1);
});

test('fits() truth table from the spec', () => {
  // 5 min + radar + no pause: 24*12*2 = 576 > 500 -> no
  assert.equal(budget.fits(S(), 5), false);
  // 5 min + radar + 4 h pause: 20*12*2 = 480 <= 500, hourly 24 <= 25 -> yes
  assert.equal(budget.fits(S({ sleepNightEnabled: true, sleepStartHour: '0', sleepEndHour: '4' }), 5), true);
  // 5 min, weather only, no pause: 24*12*1 = 288 -> yes
  assert.equal(budget.fits(S({ radarMode: 'off' }), 5), true);
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
  assert.deepEqual(budget.fittingOptions(S({ provider: 'dwd', radarMode: 'off' })).map((o) => o[1]),
    ['5', '10', '15', '30', '60']);
  assert.deepEqual(
    budget.fittingOptions(S({ sleepNightEnabled: true, sleepStartHour: '0', sleepEndHour: '4' })).map((o) => o[1]),
    ['5', '10', '15', '30', '60']);
});

test('minSleepHoursFor derives the unlock rule (5 min + radar needs >= 4 h)', () => {
  assert.equal(budget.minSleepHoursFor(S(), 5), 4);
  // weather-only 5 min already fits with zero pause
  assert.equal(budget.minSleepHoursFor(S({ radarMode: 'off' }), 5), 0);
  // no tomorrow.io in play -> 0 (nothing to unlock)
  assert.equal(budget.minSleepHoursFor(S({ provider: 'dwd', radarMode: 'off' }), 5), 0);
});
