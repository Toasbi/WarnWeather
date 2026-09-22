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
// level). Start times are LOCAL clock times so the day boundary is host-timezone-proof.
test('uvReadings: max only for the modes that show it, over the rest of today only', () => {
  const nine = new Date(2026, 6, 15, 9, 0, 0).getTime() / 1000;
  // 09..23 today (15 entries), then tomorrow 00:00 onward.
  const trend = [20, 40, 70, 50, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 110];
  assert.deepEqual(uvReadings(trend, nine), { now: 20, max: null }, 'absent mode = current');
  assert.deepEqual(uvReadings(trend, nine, 'current'), { now: 20, max: null });
  assert.deepEqual(uvReadings(trend, nine, 'max'), { now: 20, max: 70 },
    'tomorrow 00:00 (110) is past 23:59 and never counts');
  assert.deepEqual(uvReadings(trend, nine, 'both'), { now: 20, max: 70 });
  assert.equal(uvReadings([], nine, 'both'), null, 'no UV at all');
  assert.equal(uvReadings(undefined, nine, 'both'), null);
  assert.deepEqual(uvReadings(trend, undefined, 'max'), { now: 20, max: null },
    'no start time: the day cannot be placed, so no max');
  assert.deepEqual(uvReadings(trend, NaN, 'both'), { now: 20, max: null });
});

test('uvReadings: the last hour of the day is the only one left at 23:00', () => {
  const eleven = new Date(2026, 6, 15, 23, 0, 0).getTime() / 1000;
  assert.deepEqual(uvReadings([0, 90, 90], eleven, 'max'), { now: 0, max: 0 });
});
