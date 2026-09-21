// test/sleep-window.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { isWithinSleepWindow, resolveSleepWindow } = require('../src/pkjs/sleep-window');
// Fetch-cadence logic lives in its when-do-we-fetch home now (channel-scheduler.js).
const isPastRefreshSlot = require('../src/pkjs/channel-scheduler.js').isPastRefreshSlot;

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

// ---------------------------------------------------------------------------
// sleepNightMode: the Nighttime card lets the battery saver either FOLLOW the
// card's shared Night hours (sleepStartHour/sleepEndHour) or keep its OWN pair
// (sleepNightStartHour/sleepNightEndHour). The schema offered the choice before
// anything read it, so 'custom' silently did nothing: the window stayed the
// shared pair and the hours the user had explicitly removed still paused.
// ---------------------------------------------------------------------------

// Shared Night hours 0..7, saver's own hours 22..6 — deliberately different
// windows, and neither is a subset of the other, so reading the wrong pair
// shows up at BOTH ends (06 and 22/23).
function both(over) {
  return Object.assign({
    sleepNightEnabled: true,
    sleepStartHour: '0', sleepEndHour: '7',
    sleepNightStartHour: '22', sleepNightEndHour: '6'
  }, over || {});
}

// Every hour's verdict as a 24-char T/f string — the whole window in one assert,
// so a fix that merely shifts the bug by an hour can't pass.
function day(settings) {
  let out = '';
  for (let h = 0; h < 24; h += 1) { out += isWithinSleepWindow(at(h), settings) ? 'T' : 'f'; }
  return out;
}

const SHARED_0_7 = 'T'.repeat(7) + 'f'.repeat(17);              // hours 0..6
const OWN_22_6 = 'T'.repeat(6) + 'f'.repeat(16) + 'T'.repeat(2); // hours 22,23,0..5

test('mode custom uses the saver OWN hours, not the shared Night hours (the reported bug)', () => {
  // The exact case from the bug report: 06 was paused although the user moved
  // the saver's window to end at 06, and 22/23 were awake although it starts at 22.
  assert.equal(day(both({ sleepNightMode: 'custom' })), OWN_22_6);
});

test('mode night follows the shared Night hours and ignores the saver own pair', () => {
  assert.equal(day(both({ sleepNightMode: 'night' })), SHARED_0_7);
});

// The upgrade path. An install that predates the segmented control has NO
// sleepNightMode stored at all, and its sleepNightStartHour/EndHour may hold
// whatever the schema seeded. It must behave exactly as it did before.
test('mode absent (upgrade path) behaves exactly like mode night', () => {
  const upgraded = both();
  delete upgraded.sleepNightMode;
  assert.equal(day(upgraded), day(both({ sleepNightMode: 'night' })));
  assert.equal(day(upgraded), SHARED_0_7);
  // And an unknown/garbage mode is not 'custom' either — it falls back to following.
  assert.equal(day(both({ sleepNightMode: 'wat' })), SHARED_0_7);
});

test('mode custom, non-wrapping window', () => {
  const s = both({ sleepNightMode: 'custom', sleepNightStartHour: '1', sleepNightEndHour: '5' });
  assert.equal(isWithinSleepWindow(at(0), s), false);
  assert.equal(isWithinSleepWindow(at(1), s), true);
  assert.equal(isWithinSleepWindow(at(4), s), true);
  assert.equal(isWithinSleepWindow(at(5), s), false);  // end exclusive
  assert.equal(isWithinSleepWindow(at(23), s), false);
});

test('mode custom with start === end is never in window (not always)', () => {
  const s = both({ sleepNightMode: 'custom', sleepNightStartHour: '5', sleepNightEndHour: '5' });
  assert.equal(day(s), 'f'.repeat(24));
});

test('mode custom with garbage hours clamps to 22..7, same as the shared pair does', () => {
  const s = both({ sleepNightMode: 'custom', sleepNightStartHour: 'x', sleepNightEndHour: '99' });
  assert.equal(isWithinSleepWindow(at(23), s), true);
  assert.equal(isWithinSleepWindow(at(6), s), true);
  assert.equal(isWithinSleepWindow(at(7), s), false);
  assert.equal(isWithinSleepWindow(at(8), s), false);
  // Identical to the shared pair fed the same garbage — one clamp rule, not two.
  assert.equal(day(s), day({ sleepNightEnabled: true, sleepStartHour: 'x', sleepEndHour: '99' }));
});

test('the toggle still short-circuits in every mode', () => {
  ['night', 'custom', undefined].forEach((mode) => {
    assert.equal(day(both({ sleepNightMode: mode, sleepNightEnabled: false })), 'f'.repeat(24),
      'mode ' + mode + ' must not survive the toggle being off');
  });
});

test('resolveSleepWindow returns the effective pair and tolerates falsy settings', () => {
  assert.deepEqual(resolveSleepWindow(both({ sleepNightMode: 'night' })), { start: 0, end: 7 });
  assert.deepEqual(resolveSleepWindow(both({ sleepNightMode: 'custom' })), { start: 22, end: 6 });
  assert.deepEqual(resolveSleepWindow(both()), { start: 0, end: 7 });
  assert.deepEqual(resolveSleepWindow(null), { start: 22, end: 7 });
  // The resolver reports the pair; the "never" rule is the caller's, so a
  // zero-length window still comes back as a pair rather than being swallowed.
  assert.deepEqual(
    resolveSleepWindow(both({ sleepNightMode: 'custom', sleepNightStartHour: '5', sleepNightEndHour: '5' })),
    { start: 5, end: 5 });
});

test('isPastRefreshSlot trips only when now is in a later slot', () => {
  const interval = 30 * 60 * 1000;
  assert.equal(isPastRefreshSlot(0, interval, interval), true);
  assert.equal(isPastRefreshSlot(interval, interval + 1, interval), false);
  assert.equal(isPastRefreshSlot(interval, 2 * interval, interval), true);
});
