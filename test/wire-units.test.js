// test/wire-units.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { clampByte, mphToKmh, MPH_TO_KMH, zeroFilledArray, uvShown } = require('../src/pkjs/wire-units');

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
// today, tomorrow] in tenths, null = unknown.
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

test('uvShown: once today\'s peak is reached, the peak rolls to tomorrow\'s, flagged', () => {
  // At today's peak — the rest of the day never rounds above now.
  assert.deepEqual(uvShown([80, 76], [80, 60], 'both'), S(8, 6, true), 'both: "8/»6"');
  assert.deepEqual(uvShown([80, 76], [80, 60], 'max'), S(null, 6, true), 'max: a lone "»6"');
  // Evening: today is spent (0 ahead), tomorrow's midday is next.
  assert.deepEqual(uvShown([0, 0], [0, 95], 'both'), S(0, 10, true));
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
