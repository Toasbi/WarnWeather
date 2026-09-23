// test/wire-units.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { clampByte, mphToKmh, MPH_TO_KMH, zeroFilledArray } = require('../src/pkjs/wire-units');
// The UV slot's reader, in the (trend, peaks, mode) shape these tests grew up on.
const uvShown = (trend, peaks, mode) => require('../src/pkjs/wire-units.js')
  .dayMaxShown('uv', { UV_TREND_UINT8: trend, UV_DAY_PEAKS: peaks }, { uvSlotDisplay: mode });

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
  // Evening: today is spent (0 ahead), tomorrow's midday is next.
  assert.deepEqual(uvShown([0, 0], [0, 95], 'both'), S(0, 10, true));
});

test('uvShown: today\'s peak holds until the reading drops below it', () => {
  // The owner's day: UV 5 from 13:00 to 15:00, 6 tomorrow. dayPeaks' third entry
  // is the peak of today's hours before the current one (the UV day record).
  const at = (now, rest, earlier, mode) => uvShown([now], [rest, 60, earlier], mode);
  assert.deepEqual(at(30, 50, 20, 'both'), S(3, 5, false), '11:00: the peak is ahead');
  assert.deepEqual(at(50, 50, 40, 'both'), S(5, 5, false), '13:00: it has begun — "5/5", not "5/»6"');
  assert.deepEqual(at(50, 50, 40, 'max'), S(null, 5, false), '13:00 in Day max: "5"');
  assert.deepEqual(at(50, 50, 50, 'both'), S(5, 5, false), '14:00: still running');
  assert.deepEqual(at(40, 40, 50, 'both'), S(4, 6, true), '15:00: below it — tomorrow\'s takes over');
  assert.deepEqual(at(40, 40, 50, 'max'), S(null, 6, true));
  assert.deepEqual(at(0, 0, 50, 'both'), S(0, 6, true), 'evening');
  assert.deepEqual(at(0, 50, 0, 'both'), S(0, 5, false),
    '00:xx: nothing came earlier (0), the peak is ahead');
});

test('uvShown: holding the peak judges the whole numbers, and a day that stays at 0 has none', () => {
  const at = (now, rest, earlier) => uvShown([now], [rest, 60, earlier], 'both');
  // 5.4 earlier, 4.6 now: both print 5, so the reading has not dropped below it.
  assert.deepEqual(at(46, 46, 54), S(5, 5, false));
  // 5.4 now after 5.6 earlier: prints 5 below an earlier 6 — behind us.
  assert.deepEqual(at(54, 54, 56), S(5, 6, true));
  // A 0 day (polar night, deep winter) has no peak to hold: tomorrow's.
  assert.deepEqual(at(0, 0, 0), S(0, 6, true));
  assert.deepEqual(at(4, 4, 3), S(0, 6, true), 'rounding to 0 counts as 0');
});

test('uvShown: a second, lower peak holds like the first; the same number on the way down does not', () => {
  // 6 at 11:00, 4 at 12:00, 5 at 13:00. The third peak runs back only to the
  // last hour below the peak held (day-peak-record's earlierPeak).
  assert.deepEqual(uvShown([40], [50, 70, 0], 'both'), S(4, 5, false), '12:00: 5 is still to come');
  assert.deepEqual(uvShown([50], [50, 70, 0], 'both'), S(5, 5, false),
    '13:00: it runs — the noon dip ended the morning\'s 6');
  // 6 at 11:00, then 5 at 12:00 and 13:00 with no dip between: the 5s are the
  // way down from the day's peak, which is behind us.
  assert.deepEqual(uvShown([50], [50, 70, 60], 'both'), S(5, 7, true));
});

test('uvShown: the rollover compares the whole numbers the slot prints', () => {
  // 7.4 now, 7.6 later today: "7/8" still has a peak to come...
  assert.deepEqual(uvShown([74], [76, 50], 'both'), S(7, 8, false));
  // ...7.6 now, 7.9 later: both print 8, so "8/8" would say nothing — tomorrow instead.
  assert.deepEqual(uvShown([76], [79, 50], 'both'), S(8, 5, true));
});

test('uvShown: no peak ahead known falls back to the current reading alone', () => {
  // Today's peak reached and tomorrow not covered by the feed.
  assert.deepEqual(uvShown([80], [80, null], 'both'), S(8, null, false));
  assert.deepEqual(uvShown([80], [80, null], 'max'), S(8, null, false));
  // Today unknown (no sourced hour left) with tomorrow known: tomorrow it is.
  assert.deepEqual(uvShown([0], [null, 40], 'max'), S(null, 4, true));
  assert.deepEqual(uvShown([0], [null, null], 'max'), S(0, null, false));
});
