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

test('a record is what it read, a time after 1970, a whole count of failed reads, and the time its reader keeps', () => {
  assert.deepEqual(reads.recordOf({ source: null, at: T0, failures: 0, made: T0 - HOUR }, 'made'),
    { source: null, at: T0, failures: 0, made: T0 - HOUR });
  assert.deepEqual(reads.recordOf({ at: T0, failures: 3, made: null }, 'made'),
    { source: null, at: T0, failures: 3, made: null }, 'one kept before what it read was: a reader of one thing');
  assert.deepEqual(reads.recordOf({ source: 5, at: T0, failures: 0 }, 'made'),
    { source: null, at: T0, failures: 0, made: null }, 'one kept before the time was: no time');
  assert.deepEqual(reads.recordOf({ at: T0, failures: 0, made: 'x' }, 'made'),
    { source: null, at: T0, failures: 0, made: null });
  assert.deepEqual(reads.recordOf({ at: T0, failures: 0, made: -1, extra: 1 }, 'made'),
    { source: null, at: T0, failures: 0, made: null }, 'only its four fields');
  assert.deepEqual(reads.recordOf({ source: 'p/c/i/v', at: T0, failures: 2, validUntil: T0 + DAY, made: T0 },
    'validUntil'), { source: 'p/c/i/v', at: T0, failures: 2, validUntil: T0 + DAY },
  'the time under the reader\'s own name');
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

test('a failure can pass by the next minute when the plugin did not answer in time or gave no reason', () => {
  ['TIMEOUT', 'UNKNOWN'].forEach((code) => assert.equal(reads.passing(code), true, code));
  ['PERMISSION_DENIED', 'RATE_LIMITED', 'AUTH_REQUIRED', 'INVALID_ARGS', 'INVALID_REQUEST',
    'PLUGIN_UNAVAILABLE', '', undefined].forEach((code) => assert.equal(reads.passing(code), false, String(code)));
});
