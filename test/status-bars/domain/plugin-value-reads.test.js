'use strict';
// When the Plugin value slot's value is read again (plugin-value-reads.js). The record and the
// retry waits are plugin-reads.test.js'; the reads themselves, plugin-value-source.test.js'.
const test = require('node:test');
const assert = require('node:assert/strict');
const reads = require('../../../src/pkjs/status-bars/domain/plugin-value-reads.js');

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const T0 = Date.UTC(2026, 10, 23, 12, 0, 0);

/**
 * @param {number} failures Failed reads in a row.
 * @param {?number} validUntil Until when the plugin said its answer holds.
 * @returns {Object} A record of a read at T0.
 */
function readAt(failures, validUntil) {
  return { at: T0, failures: failures, validUntil: validUntil };
}

test('an answer is read again after the Updates interval', () => {
  [30 * MIN, HOUR, 3 * HOUR, 6 * HOUR].forEach((every) =>
    assert.equal(reads.nextReadAt(readAt(0, null), every), T0 + every, String(every / MIN)));
});

test('an answer the plugin says holds longer is read again once it no longer does, 12 hours on at most', () => {
  assert.equal(reads.nextReadAt(readAt(0, T0 + 5 * HOUR), HOUR), T0 + 5 * HOUR);
  assert.equal(reads.nextReadAt(readAt(0, T0 + 12 * HOUR), HOUR), T0 + 12 * HOUR);
  assert.equal(reads.nextReadAt(readAt(0, T0 + 30 * HOUR), HOUR), T0 + 12 * HOUR, 'no more than 12 hours');
  assert.equal(reads.nextReadAt(readAt(0, T0 + 20 * MIN), HOUR), T0 + HOUR, 'one that holds less: the interval');
  assert.equal(reads.nextReadAt(readAt(0, T0 - HOUR), HOUR), T0 + HOUR, 'one already past');
});

test('a failed read is tried again an hour later, doubling, up to the Updates interval', () => {
  [[1, 1], [2, 2], [3, 4], [4, 6], [9, 6]].forEach(([failures, hours]) =>
    assert.equal(reads.nextReadAt(readAt(failures, null), 6 * HOUR), T0 + hours * HOUR, failures + ' in a row'));
  assert.equal(reads.nextReadAt(readAt(1, null), 30 * MIN), T0 + 30 * MIN, 'every 30 minutes: 30 minutes');
  assert.equal(reads.nextReadAt(readAt(2, T0 + 10 * HOUR), HOUR), T0 + HOUR,
    'what the plugin said last does not keep a retry away');
});
