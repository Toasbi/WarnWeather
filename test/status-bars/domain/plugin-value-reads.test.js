'use strict';
// The Plugin value slot's reads (plugin-value-reads.js): when the value is read again, and the
// value a read keeps. The record and the retry waits are plugin-reads.test.js'; the reads
// themselves, plugin-value-source.test.js'.
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

/**
 * @param {Object} fields The reading's fields that are set.
 * @returns {Object} A reading as plugin-reader.js readingOf hands it over.
 */
function reading(fields) {
  return Object.assign({ short: null, number: null, unit: null, long: null }, fields);
}

test('valueOf: a stored value, checked', () => {
  const value = { source: 's', reading: reading({ number: 5, unit: 'days' }), at: T0, validUntil: T0 + HOUR };
  assert.deepEqual(reads.valueOf(value), value);
  assert.deepEqual(reads.valueOf(Object.assign({}, value, { validUntil: 'x' })).validUntil, null);
  assert.deepEqual(reads.valueOf({ source: 's', reading: { short: 'a', number: '5', unit: 7, long: '', extra: 1 }, at: T0 }),
    { source: 's', reading: reading({ short: 'a' }), at: T0, validUntil: null }, 'its fields, each of its type');
  [null, 5, {}, Object.assign({}, value, { source: 7 }), Object.assign({}, value, { reading: null }),
    Object.assign({}, value, { reading: reading({}) }), Object.assign({}, value, { at: 0 }),
    Object.assign({}, value, { at: 'x' })].forEach((v) => assert.equal(reads.valueOf(v), null, JSON.stringify(v)));
});

test('valueOf: a plugin\'s answer, checked as it comes in: texts trimmed, a finite number, none without either', () => {
  const answer = (r) => reads.valueOf({ source: 's', reading: r, at: T0, validUntil: null });
  assert.deepEqual(answer({ short: '  5G \n', number: 0, unit: ' kWh ', long: undefined }).reading,
    reading({ short: '5G', number: 0, unit: 'kWh' }), 'trimmed; zero is a number');
  assert.deepEqual(answer({ short: 87, number: '87', unit: 3, long: 'ok' }).reading, reading({ long: 'ok' }),
    'fields of the wrong type');
  [{ short: null, number: null, unit: null, long: null }, { short: '   ', long: '' },
    { number: NaN, unit: '%' }, { number: Infinity }].forEach((r) =>
    assert.equal(answer(r), null, JSON.stringify(r) + ': no text and no number; a unit alone says nothing'));
});

test('valueOf: a value keeps 64 bytes of each text, never half a character', () => {
  const long = 'x'.repeat(100);
  const value = reads.valueOf({ source: 's', reading: { short: long, long: long, unit: long }, at: T0 });
  assert.equal(reads.MAX_TEXT, 64);
  assert.deepEqual([value.reading.short, value.reading.long, value.reading.unit], ['x'.repeat(64), 'x'.repeat(64),
    'x'.repeat(64)]);
  assert.equal(reads.valueOf({ source: 's', reading: { short: '\u00e4'.repeat(40) }, at: T0 }).reading.short,
    '\u00e4'.repeat(32), 'two bytes each');
  const emoji = 'x'.repeat(63) + '\ud83d\ude00';
  assert.equal(reads.valueOf({ source: 's', reading: { short: emoji }, at: T0 }).reading.short, 'x'.repeat(63),
    'the emoji would be cut in half: it goes whole');
  assert.equal(reads.valueOf({ source: 's', reading: { short: '\ud83d\ude00' }, at: T0 }).reading.short, '\ud83d\ude00');
});

test('sameReading: the same four fields, in whatever order they come', () => {
  const r = reading({ short: '87%', number: 87, unit: '%' });
  assert.equal(reads.sameReading(r, { long: null, unit: '%', number: 87, short: '87%' }), true);
  assert.equal(reads.sameReading(r, reads.valueOf({ source: 's', reading: r, at: T0 }).reading), true, 'through storage');
  [{ short: '86%' }, { number: 86 }, { unit: 'pct' }, { long: 'x' }].forEach((change) =>
    assert.equal(reads.sameReading(r, Object.assign({}, r, change)), false, JSON.stringify(change)));
  assert.equal(reads.sameReading(null, null), true);
  assert.equal(reads.sameReading(r, null), false);
  assert.equal(reads.sameReading(null, r), false);
});
