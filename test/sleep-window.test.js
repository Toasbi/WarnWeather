// test/sleep-window.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { isWithinSleepWindow, parseHour } = require('../src/pkjs/sleep-window');
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
// The Nighttime card groups the battery saver with the theme switch and the
// backlight dim, but shares NO window with them: the saver's hours are
// sleepStartHour/sleepEndHour, the pair its switch has always owned, and there
// is no mode key to pick a different pair. These are the negative controls —
// the retired sleepNightMode/sleepNightStartHour/sleepNightEndHour that a dev
// build of the branch could still have in storage, plus the other two
// features' keys, none of which this module may read.
// ---------------------------------------------------------------------------

// The saver's own hours are 0..7; the retired pair holds a deliberately
// DIFFERENT window (22..6), and neither is a subset of the other, so a reader
// that picked up the wrong pair shows up at BOTH ends (06 and 22/23).
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

const OWN_0_7 = 'T'.repeat(7) + 'f'.repeat(17);                  // hours 0..6

test('the window is sleepStartHour/sleepEndHour, whatever else is in storage', () => {
  // Every one of these was a mode or a pair the shared-window design read. None
  // of them may move the verdict by an hour now.
  [{}, { sleepNightMode: 'custom' }, { sleepNightMode: 'night' },
    { sleepNightMode: 'wat' }, { sleepNightMode: undefined },
    { sleepNightStartHour: '13', sleepNightEndHour: '14' },
    { backlightDimStartHour: '22', backlightDimEndHour: '6' },
    { themeAutoMode: 'manual', themeAutoStartHour: '20', themeAutoEndHour: '7' }
  ].forEach((over) => {
    assert.equal(day(both(over)), OWN_0_7,
      'the saver must keep its own window for ' + JSON.stringify(over));
  });
});

test('a non-wrapping own window', () => {
  const s = both({ sleepStartHour: '1', sleepEndHour: '5' });
  assert.equal(isWithinSleepWindow(at(0), s), false);
  assert.equal(isWithinSleepWindow(at(1), s), true);
  assert.equal(isWithinSleepWindow(at(4), s), true);
  assert.equal(isWithinSleepWindow(at(5), s), false);  // end exclusive
  assert.equal(isWithinSleepWindow(at(23), s), false);
});

test('start === end is never in window (not always)', () => {
  assert.equal(day(both({ sleepStartHour: '5', sleepEndHour: '5' })), 'f'.repeat(24));
});

test('garbage hours clamp to the saver own 22..7 fallback', () => {
  const s = both({ sleepStartHour: 'x', sleepEndHour: '99' });
  assert.equal(isWithinSleepWindow(at(23), s), true);
  assert.equal(isWithinSleepWindow(at(6), s), true);
  assert.equal(isWithinSleepWindow(at(7), s), false);
  assert.equal(isWithinSleepWindow(at(8), s), false);
});

test('the toggle short-circuits whatever the hours say', () => {
  [{}, { sleepNightMode: 'custom' }, { sleepStartHour: '1', sleepEndHour: '5' }
  ].forEach((over) => {
    assert.equal(day(both(Object.assign({ sleepNightEnabled: false }, over))),
      'f'.repeat(24), JSON.stringify(over) + ' must not survive the toggle being off');
  });
});

test('parseHour is exported as THE hour parse rule (night-light.js imports it)', () => {
  assert.equal(typeof parseHour, 'function');
  assert.equal(parseHour('0', 22), 0);
  assert.equal(parseHour('23', 22), 23);
  ['x', '24', '-1', '', undefined, null, {}].forEach((v) => {
    assert.equal(parseHour(v, 22), 22, 'unparseable must clamp: ' + JSON.stringify(v));
  });
});

test('isPastRefreshSlot trips only when now is in a later slot', () => {
  const interval = 30 * 60 * 1000;
  assert.equal(isPastRefreshSlot(0, interval, interval), true);
  assert.equal(isPastRefreshSlot(interval, interval + 1, interval), false);
  assert.equal(isPastRefreshSlot(interval, 2 * interval, interval), true);
});
