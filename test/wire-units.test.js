// test/wire-units.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { clampByte, mphToKmh, MPH_TO_KMH, zeroFilledArray, uvReadings } = require('../src/pkjs/wire-units');

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

// uvReadings — the UV slot's shared reader (status-lines text AND status-thresholds
// level). dayPeaks is UV_DAY_PEAKS: [rest of today, tomorrow] in tenths, null = unknown.
const R = (now, max, tomorrow, judged) => ({ now, max, tomorrow, judged });

test('uvReadings: the peak only for the modes that show it', () => {
  const trend = [20, 40, 70];
  assert.deepEqual(uvReadings(trend, [70, 110]), R(20, null, false, 20), 'absent mode = current');
  assert.deepEqual(uvReadings(trend, [70, 110], 'current'), R(20, null, false, 20));
  assert.deepEqual(uvReadings(trend, [70, 110], 'max'), R(20, 70, false, 70));
  assert.deepEqual(uvReadings(trend, [70, 110], 'both'), R(20, 70, false, 70));
  assert.equal(uvReadings([], [70, 110], 'both'), null, 'no UV at all');
  assert.equal(uvReadings(undefined, [70, 110], 'both'), null);
  assert.deepEqual(uvReadings(trend, undefined, 'max'), R(20, null, false, 20),
    'no day peaks (a pre-peaks snapshot): the current reading alone');
});

test('uvReadings: once today\'s peak is reached, the max rolls to tomorrow\'s, flagged', () => {
  // At today's peak — the rest of the day never rounds above now.
  assert.deepEqual(uvReadings([80, 76], [80, 60], 'both'), R(80, 60, true, 80),
    'both: "8/»6" — judged on today\'s 8, never on tomorrow\'s marked 6');
  assert.deepEqual(uvReadings([80, 76], [80, 60], 'max'), R(80, 60, true, null),
    'max: only tomorrow\'s "»6" is on screen, so nothing is judged');
  // Evening: today is spent (0 ahead), tomorrow's midday is next — and not judged.
  assert.deepEqual(uvReadings([0, 0], [0, 95], 'both'), R(0, 95, true, 0));
});

test('uvReadings: the rollover compares the whole numbers the slot prints', () => {
  // 7.4 now, 7.6 later today: "7/8" still has a peak to come...
  assert.deepEqual(uvReadings([74], [76, 50], 'both'), R(74, 76, false, 76));
  // ...7.6 now, 7.9 later: both print 8, so "8/8" would say nothing — tomorrow instead.
  assert.deepEqual(uvReadings([76], [79, 50], 'both'), R(76, 50, true, 76));
});

test('uvReadings: no peak ahead known falls back to the current reading alone', () => {
  // Today's peak reached and tomorrow not covered by the feed.
  assert.deepEqual(uvReadings([80], [80, null], 'both'), R(80, null, false, 80));
  assert.deepEqual(uvReadings([80], [80, null], 'max'), R(80, null, false, 80));
  // Today unknown (no sourced hour left) with tomorrow known: tomorrow it is.
  assert.deepEqual(uvReadings([0], [null, 40], 'max'), R(0, 40, true, null));
  assert.deepEqual(uvReadings([0], [null, null], 'max'), R(0, null, false, 0));
});
