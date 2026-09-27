// test/wire-units.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { clampByte, mphToKmh, MPH_TO_KMH, zeroFilledArray } = require('../src/pkjs/wire-units');
const pair = require('../src/pkjs/status-pair.js');
// The UV slot's reader, in the (trend, peaks, mode[, warn]) shape these tests grew
// up on; `warn` is the kind's warn level the caller resolves (absent = no hold on it).
const uvShown = (trend, peaks, mode, warn) => require('../src/pkjs/wire-units.js')
  .dayMaxShown('uv', { UV_TREND_UINT8: trend, UV_DAY_PEAKS: peaks }, { uvSlotDisplay: mode }, warn);

test('clampByte rounds then clamps to 0..255', () => {
  assert.equal(clampByte(0), 0);
  assert.equal(clampByte(12.4), 12);
  assert.equal(clampByte(12.5), 13);
  assert.equal(clampByte(-3), 0);
  assert.equal(clampByte(300), 255);
  assert.equal(clampByte(255), 255);
});

test('clampByte treats non-finite as 0', () => {
  assert.equal(clampByte(NaN), 0);
  assert.equal(clampByte(undefined), 0);
});

test('mphToKmh multiplies by the mph→km/h constant', () => {
  assert.equal(MPH_TO_KMH, 1.60934);
  assert.equal(Math.round(mphToKmh(10) * 10000) / 10000, 16.0934);
  assert.equal(mphToKmh(0), 0);
});

test('mphToKmh treats non-numeric input as 0', () => {
  assert.equal(mphToKmh(undefined), 0);
  assert.equal(mphToKmh(null), 0);
});

test('zeroFilledArray returns a fresh array of N zeros', () => {
  const arr = zeroFilledArray(3);
  assert.deepEqual(arr, [0, 0, 0]);
  assert.equal(arr.length, 3);
  // Fresh array each call (no shared reference).
  assert.notEqual(zeroFilledArray(2), zeroFilledArray(2));
});

test('zeroFilledArray clamps non-positive lengths to an empty array', () => {
  assert.deepEqual(zeroFilledArray(0), []);
  assert.deepEqual(zeroFilledArray(-1), []);
});

// uvShown — the UV slot's shared reader (status-lines text AND status-thresholds
// level): the WHOLE numbers the slot prints. dayPeaks is UV_DAY_PEAKS: [rest of
// today, tomorrow, today's hours already begun] in tenths, null = unknown.
const S = (now, peak, nextDay) => ({ now, peak, nextDay });

test('uvShown: the peak only for the modes that show it, in whole UV', () => {
  const trend = [20, 40, 70];
  assert.deepEqual(uvShown(trend, [70, 110]), S(2, null, false), 'absent mode = current');
  assert.deepEqual(uvShown(trend, [70, 110], 'current'), S(2, null, false));
  assert.deepEqual(uvShown(trend, [70, 110], 'max'), S(null, 7, false), 'max: the peak alone');
  assert.deepEqual(uvShown(trend, [70, 110], 'both'), S(2, 7, false));
  assert.equal(uvShown([], [70, 110], 'both'), null, 'no UV at all');
  assert.equal(uvShown(undefined, [70, 110], 'both'), null);
  assert.deepEqual(uvShown(trend, undefined, 'max'), S(2, null, false),
    'a payload without day peaks (defensive: v1 snapshots are dropped on restore): ' +
    'the current reading alone');
});

test('uvShown: without today\'s earlier hours, today\'s peak gives way once nothing later beats now', () => {
  // A payload with no third peak (the day's first fetch at a new place, or a
  // snapshot stored before it existed): at the peak, the rest of the day never
  // rounds above now, and "running" cannot be told from "behind us".
  assert.deepEqual(uvShown([80, 76], [80, 60], 'both'), S(8, 6, true), 'both: "8/»6"');
  assert.deepEqual(uvShown([80, 76], [80, 60], 'max'), S(null, 6, true), 'max: a lone "»6"');
  assert.deepEqual(uvShown([80, 76], [80, 60, null], 'max'), S(null, 6, true), 'null = unknown too');
  // A warn level at or below the 8 holds it regardless (printed once in Both);
  // one above it leaves the plain rule to decide.
  assert.deepEqual(uvShown([80, 76], [80, 60], 'both', 6), S(8, null, false), 'warn 6: "8"');
  assert.deepEqual(uvShown([80, 76], [80, 60], 'max', 8), S(null, 8, false), 'warn 8: a lone "8"');
  assert.deepEqual(uvShown([80, 76], [80, 60], 'both', 9), S(8, 6, true), 'warn 9: "8/»6"');
  // Evening: today is spent (0 ahead), tomorrow's midday is next.
  assert.deepEqual(uvShown([0, 0], [0, 95], 'both'), S(0, 10, true));
});

test('uvShown: today\'s peak holds until the reading drops below it', () => {
  // The owner's day: UV 5 from 13:00 to 15:00, 6 tomorrow. dayPeaks' third entry
  // is the peak of today's hours before the current one (the UV day record).
  const at = (now, rest, earlier, mode, warn) => uvShown([now], [rest, 60, earlier], mode, warn);
  assert.deepEqual(at(30, 50, 20, 'both'), S(3, 5, false), '11:00: the peak is ahead');
  // A running peak equals now, so Both prints it once: peak null, the text "5".
  assert.deepEqual(at(50, 50, 40, 'both'), S(5, null, false), '13:00: it has begun — "5", not "5/»6"');
  assert.deepEqual(at(50, 50, 40, 'max'), S(null, 5, false), '13:00 in \'max\' mode: "5"');
  assert.deepEqual(at(50, 50, 50, 'both'), S(5, null, false), '14:00: still running');
  assert.deepEqual(at(40, 40, 50, 'both'), S(4, 6, true), '15:00: below it — tomorrow\'s takes over');
  assert.deepEqual(at(40, 40, 50, 'max'), S(null, 6, true));
  assert.deepEqual(at(40, 40, 50, 'max', 6), S(null, 6, true), '...with warn 6 too: 4 is below it');
  assert.deepEqual(at(0, 0, 50, 'both'), S(0, 6, true), 'evening');
  assert.deepEqual(at(0, 50, 0, 'both'), S(0, 5, false),
    '00:xx: nothing came earlier (0), the peak is ahead');
});

test('uvShown: holding the peak judges the whole numbers, and a day that stays at 0 has none', () => {
  const at = (now, rest, earlier) => uvShown([now], [rest, 60, earlier], 'both');
  // 5.4 earlier, 4.6 now: both print 5, so the reading has not dropped below it
  // (and the held 5 prints once).
  assert.deepEqual(at(46, 46, 54), S(5, null, false));
  // 5.4 now after 5.6 earlier: prints 5 below an earlier 6 — behind us.
  assert.deepEqual(at(54, 54, 56), S(5, 6, true));
  // A 0 day (polar night, deep winter) has no peak to hold: tomorrow's.
  assert.deepEqual(at(0, 0, 0), S(0, 6, true));
  assert.deepEqual(at(4, 4, 3), S(0, 6, true), 'rounding to 0 counts as 0');
});

test('uvShown: a second, lower peak holds like the first; the same number on the way down does not', () => {
  // 6 at 11:00, 4 at 12:00, 5 at 13:00. The third peak runs back only to the
  // last hour below the peak held (day-peaks's earlierPeak).
  assert.deepEqual(uvShown([40], [50, 70, 0], 'both'), S(4, 5, false), '12:00: 5 is still to come');
  assert.deepEqual(uvShown([50], [50, 70, 0], 'both'), S(5, null, false),
    '13:00: it runs — the noon dip ended the morning\'s 6 — and prints once');
  // 6 at 11:00, then 5 at 12:00 and 13:00 with no dip between: the 5s are the
  // way down from the day's peak, which is behind us.
  assert.deepEqual(uvShown([50], [50, 70, 60], 'both'), S(5, 7, true));
  // ...unless 5 is at or above the warn level: then it is still worth showing.
  assert.deepEqual(uvShown([50], [50, 70, 60], 'both', 5), S(5, null, false));
});

test('uvShown: the rollover compares the whole numbers the slot prints', () => {
  // 7.4 now, 7.6 later today: "7/8" still has a peak to come...
  assert.deepEqual(uvShown([74], [76, 50], 'both'), S(7, 8, false));
  // ...7.6 now, 7.9 later: both print 8, so "8/8" would say nothing — tomorrow instead.
  assert.deepEqual(uvShown([76], [79, 50], 'both'), S(8, 5, true));
  // With a warn level of 8 or less that 8 holds, once ("8", not "8/»5").
  assert.deepEqual(uvShown([76], [79, 50], 'both', 8), S(8, null, false));
  assert.deepEqual(uvShown([76], [79, 50], 'max', 8), S(null, 8, false));
  assert.deepEqual(uvShown([76], [79, 50], 'both', 9), S(8, 5, true), 'warn 9: 8 is below it');
});

// The hold on the warn level: the slot is an alert, not a record. Today's peak
// stays on screen while it is still ahead or running (as before) AND while it is
// at or above the kind's warn level, so a 7 falling from an 8 keeps warning
// instead of rolling to tomorrow's »8 and going quiet. The spec's worked table,
// UV with warn 6: each row is [now, today, next, earlier] in tenths.
test('uvShown: today holds while the highest value left today is at or above warn', () => {
  const WARN = 6;
  const rows = [
    // name,               now, today, next, earlier,  both,          max,           text both / max
    ['a morning',           20,  80,    80,   0,       S(2, 8, false), S(null, 8, false), '2/8', '8'],
    ['b at peak',           80,  80,    80,   80,      S(8, null, false), S(null, 8, false), '8', '8'],
    ['c falling, >= warn',  70,  70,    80,   80,      S(7, null, false), S(null, 7, false), '7', '7'],
    ['d falling, < warn',   50,  50,    80,   80,      S(5, 8, true),  S(null, 8, true),  '5/»8', '»8'],
    ['e low day, ahead',    10,  40,    50,   0,       S(1, 4, false), S(null, 4, false), '1/4', '4'],
    ['f behind, < warn',    30,  30,    50,   40,      S(3, 5, true),  S(null, 5, true),  '3/»5', '»5'],
    ['g second peak later', 60,  70,    80,   80,      S(6, 7, false), S(null, 7, false), '6/7', '7'],
    ['h no tomorrow',       70,  70,    null, 80,      S(7, null, false), S(null, 7, false), '7', '7']
  ];
  rows.forEach(([name, now, today, next, earlier, both, max, bothText, maxText]) => {
    const peaks = [today, next, earlier];
    assert.deepEqual(uvShown([now], peaks, 'both', WARN), both, name + ' (both)');
    assert.deepEqual(uvShown([now], peaks, 'max', WARN), max, name + ' (max)');
    assert.equal(pair.formatPeak('uv', uvShown([now], peaks, 'both', WARN), {}), bothText, name + ' text (both)');
    assert.equal(pair.formatPeak('uv', uvShown([now], peaks, 'max', WARN), {}), maxText, name + ' text (max)');
  });
  // Row (c) is the bug this hold fixes: before it, Alert mode printed »8 and the
  // highlight went silent although the 7 on screen was above warn.
  assert.deepEqual(uvShown([70], [70, 80, 80], 'max'), S(null, 8, true), 'without the warn: tomorrow\'s');
  // The warn is judged on the whole number the slot prints: 5.5 prints 6 and holds.
  assert.deepEqual(uvShown([55], [55, 80, 80], 'both', WARN), S(6, null, false));
  assert.deepEqual(uvShown([54], [54, 80, 80], 'both', WARN), S(5, 8, true), '5.4 prints 5: below');
  // Today's earlier hours unknown (no third peak) do not matter to this hold.
  assert.deepEqual(uvShown([70], [70, 80, null], 'both', WARN), S(7, null, false));
  assert.deepEqual(uvShown([70], [70, 80], 'max', WARN), S(null, 7, false));
  // A day at 0 never holds, whatever the warn (0 is enterable).
  assert.deepEqual(uvShown([0], [0, 80, 0], 'both', 0), S(0, 8, true));
  assert.deepEqual(uvShown([4], [4, 80, 0], 'max', 0), S(null, 8, true), 'rounds to 0');
  // The mode still gates: Now mode never shows a peak.
  assert.deepEqual(uvShown([70], [70, 80, 80], 'current', WARN), S(7, null, false));
});

test('uvShown: a null warn keeps the plain rule (plus the collapse)', () => {
  // Every 3-arg call — and null, undefined, NaN, a string — holds only on ahead
  // or running; the sole change from the pre-warn rule is that a held today
  // equal to now prints once in Both.
  const plain = (trend, peaks, mode) => uvShown(trend, peaks, mode);
  [undefined, null, NaN, Infinity, '6', ''].forEach((warn) => {
    const label = 'warn ' + String(warn);
    assert.deepEqual(uvShown([70], [70, 80, 80], 'both', warn), plain([70], [70, 80, 80], 'both'), label);
    assert.deepEqual(uvShown([70], [70, 80, 80], 'both', warn), S(7, 8, true), label + ': rolls over');
    assert.deepEqual(uvShown([70], [70, 80, 80], 'max', warn), S(null, 8, true), label);
    assert.deepEqual(uvShown([20], [80, 80, 0], 'both', warn), S(2, 8, false), label + ': ahead');
    assert.deepEqual(uvShown([80], [80, 80, 80], 'both', warn), S(8, null, false), label + ': running, once');
    assert.deepEqual(uvShown([80], [80, 80, 80], 'max', warn), S(null, 8, false), label + ': running in max');
  });
});

test('uvShown: no peak ahead known falls back to the current reading alone', () => {
  // Today's peak reached and tomorrow not covered by the feed.
  assert.deepEqual(uvShown([80], [80, null], 'both'), S(8, null, false));
  assert.deepEqual(uvShown([80], [80, null], 'max'), S(8, null, false));
  // Today unknown (no sourced hour left) with tomorrow known: tomorrow it is.
  assert.deepEqual(uvShown([0], [null, 40], 'max'), S(null, 4, true));
  assert.deepEqual(uvShown([0], [null, null], 'max'), S(0, null, false));
});
