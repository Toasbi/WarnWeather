'use strict';
// The record of the last read of another app's plugin, and the waits every such read shares
// (plugin-reads.js). Muninn's rhythm on top of it is estimate-reads.test.js'.
const test = require('node:test');
const assert = require('node:assert/strict');
const reads = require('../../../src/pkjs/status-bars/domain/plugin-reads.js');

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const T0 = Date.UTC(2026, 10, 21, 9, 0, 0);

test('a failed read waits an hour first', () => {
  assert.equal(reads.RETRY_MS, HOUR);
});

test('a time: a finite number after 1970, as a plugin sent it or as stored', () => {
  assert.equal(reads.timeOf(T0), T0);
  [-1, 0, NaN, Infinity, null, undefined, String(T0)].forEach((v) =>
    assert.equal(reads.timeOf(v), null, String(v)));
});

test('a record is a time after 1970, a whole count of failed reads, and the time its reader keeps', () => {
  assert.deepEqual(reads.recordOf({ at: T0, failures: 0, made: T0 - HOUR }, 'made'),
    { at: T0, failures: 0, made: T0 - HOUR });
  assert.deepEqual(reads.recordOf({ at: T0, failures: 3, made: null }, 'made'), { at: T0, failures: 3, made: null });
  assert.deepEqual(reads.recordOf({ at: T0, failures: 0 }, 'made'), { at: T0, failures: 0, made: null },
    'one kept before the time was: no time');
  assert.deepEqual(reads.recordOf({ at: T0, failures: 0, made: 'x' }, 'made'), { at: T0, failures: 0, made: null });
  assert.deepEqual(reads.recordOf({ at: T0, failures: 0, made: -1, extra: 1 }, 'made'),
    { at: T0, failures: 0, made: null }, 'only its three fields');
  assert.deepEqual(reads.recordOf({ at: T0, failures: 2, validUntil: T0 + DAY, made: T0 }, 'validUntil'),
    { at: T0, failures: 2, validUntil: T0 + DAY }, 'the time under the reader\'s own name');
  [null, undefined, 5, 'x', true, [], {}, { at: T0 }, { failures: 0 },
    { at: 0, failures: 0 }, { at: -1, failures: 0 }, { at: NaN, failures: 0 }, { at: Infinity, failures: 0 },
    { at: String(T0), failures: 0 }, { at: T0, failures: -1 }, { at: T0, failures: 1.5 },
    { at: T0, failures: '1' }, { at: T0, failures: Infinity }, { at: T0, failures: null }]
    .forEach((value) => assert.equal(reads.recordOf(value, 'made'), null, JSON.stringify(value)));
});

test('a failed read is tried again an hour later, then 2, 4 and 8 hours, up to the reader\'s longest wait', () => {
  [[1, 1], [2, 2], [3, 4], [4, 8], [5, 12], [6, 12], [40, 12], [2000, 12]].forEach(([failures, hours]) =>
    assert.equal(reads.retryWait(failures, 12 * HOUR), hours * HOUR, failures + ' in a row'));
  [[1, 1], [2, 2], [3, 3], [9, 3]].forEach(([failures, hours]) =>
    assert.equal(reads.retryWait(failures, 3 * HOUR), hours * HOUR, failures + ' in a row, 3 hours at most'));
  assert.equal(reads.retryWait(1, 30 * MIN), 30 * MIN, 'a longest wait under an hour holds from the first');
});

test('the clock went back when it is behind the last read', () => {
  const record = { at: T0, failures: 0, made: null };
  assert.equal(reads.clockWentBack(record, T0 - 1), true);
  assert.equal(reads.clockWentBack(record, T0 - 3 * DAY), true);
  assert.equal(reads.clockWentBack(record, T0), false);
  assert.equal(reads.clockWentBack(record, T0 + DAY), false);
});
