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
 * @returns {Object} A reading as valueOf keeps it, its other fields null.
 */
function reading(fields) {
  return Object.assign({ short: null, time: null, number: null, unit: null, state: null, long: null }, fields);
}

test('valueOf: a stored value, checked', () => {
  const value = { source: 's', reading: reading({ number: 5, unit: 'days' }), at: T0, validUntil: T0 + HOUR };
  assert.deepEqual(reads.valueOf(value), value);
  assert.deepEqual(reads.valueOf(Object.assign({}, value, { validUntil: 'x' })).validUntil, null);
  assert.deepEqual(reads.valueOf({ source: 's', reading: { short: 'a', number: '5', unit: 7, long: '', time: '1795453201',
    state: 'true', extra: 1 }, at: T0 }),
  { source: 's', reading: reading({ short: 'a' }), at: T0, validUntil: null }, 'its fields, each of its type');
  [null, 5, {}, Object.assign({}, value, { source: 7 }), Object.assign({}, value, { reading: null }),
    Object.assign({}, value, { reading: reading({}) }), Object.assign({}, value, { at: 0 }),
    Object.assign({}, value, { at: 'x' })].forEach((v) => assert.equal(reads.valueOf(v), null, JSON.stringify(v)));
});

test('valueOf: a value kept from before moments and states were read: theirs are none', () => {
  assert.deepEqual(reads.valueOf({ source: 's', reading: { short: '87%', number: 87, unit: '%', long: null }, at: T0,
    validUntil: null }).reading, reading({ short: '87%', number: 87, unit: '%' }));
});

test('valueOf: a plugin\'s answer, checked as it comes in: texts trimmed, a finite number, none without either', () => {
  const answer = (r) => reads.valueOf({ source: 's', reading: r, at: T0, validUntil: null });
  assert.deepEqual(answer({ short: '  5G \n', number: 0, unit: ' kWh ', long: undefined }).reading,
    reading({ short: '5G', number: 0, unit: 'kWh' }), 'trimmed; zero is a number');
  assert.deepEqual(answer({ short: 87, number: '87', unit: 3, long: 'ok' }).reading, reading({ long: 'ok' }),
    'fields of the wrong type');
  [{ short: null, number: null, unit: null, long: null }, { short: '   ', long: '' },
    { number: NaN, unit: '%' }, { number: Infinity }, { time: 'x', state: 1 }].forEach((r) =>
    assert.equal(answer(r), null, JSON.stringify(r) + ': no text, moment, number or state; a unit alone says nothing'));
});

test('valueOf: a boolean\'s state is kept, false as well as true, and is a value by itself', () => {
  const answer = (r) => reads.valueOf({ source: 's', reading: r, at: T0, validUntil: null });
  assert.deepEqual(answer({ state: false }).reading, reading({ state: false }));
  assert.deepEqual(answer({ state: true, short: 'Wi-Fi' }).reading, reading({ state: true, short: 'Wi-Fi' }));
});

/** A moment: 23 November 2026, 9:05 here, in epoch seconds and in epoch milliseconds. */
const MOMENT_MS = new Date(2026, 10, 23, 9, 5, 0).getTime();
const MOMENT_S = MOMENT_MS / 1000;

test('valueOf: a timestamp is a moment, kept in epoch milliseconds, and stays one through storage', () => {
  const answer = (r, source) => reads.valueOf({ source: source || 'u/weather/location/sunrise', reading: r, at: T0 });
  const kept = answer({ time: MOMENT_S });
  assert.deepEqual(kept.reading, reading({ time: MOMENT_MS }), 'seconds, as a plugin sends a timestamp');
  assert.deepEqual(reads.valueOf(JSON.parse(JSON.stringify(kept))), kept, 'milliseconds, as a value keeps it');
  assert.deepEqual(answer({ time: MOMENT_S, short: '14:00', long: '14:00' }).reading,
    reading({ time: MOMENT_MS, short: '14:00', long: '14:00' }), 'beside the plugin\'s words');
  assert.equal(answer({ time: MOMENT_S + 0.4 }).reading.time, MOMENT_MS + 400, 'a part of a second');
  [0, -MOMENT_S, 12345, 1e10, Infinity, NaN, '1795453201'].forEach((bad) =>
    assert.equal(answer({ time: bad }), null, String(bad) + ': no moment'));
});

test('valueOf: a number whose name says it is a moment, in epoch seconds or milliseconds, is one', () => {
  const answer = (name, number) => reads.valueOf({ source: 'u/muninn/stats/' + name, reading: { number: number },
    at: T0 }).reading;
  assert.deepEqual(answer('updatedAt', MOMENT_MS), reading({ time: MOMENT_MS, number: MOMENT_MS }),
    'Muninn\'s updatedAt, in milliseconds');
  assert.equal(answer('updatedAt', MOMENT_S).time, MOMENT_MS, 'in seconds');
  assert.deepEqual(answer('daysRemaining', MOMENT_MS), reading({ number: MOMENT_MS }), 'a name that says nothing of it');
  assert.equal(answer('updatedAt', 5).time, null, 'a number that is no moment');
  assert.equal(answer('updatedAt', 5).number, 5);
  assert.equal(reads.valueOf({ source: 'u/muninn/stats/updatedAt', reading: { number: MOMENT_MS,
    time: MOMENT_S + 60 }, at: T0 }).reading.time, MOMENT_MS + 60000, 'a timestamp beside it is the moment');
});

test('valueOf: a value of such a number kept before it was read as a moment is one now', () => {
  const stored = JSON.parse(JSON.stringify({ source: 'd008a08a-6e34-4cc4-98dc-bae02ce5e087/muninn/stats/updatedAt',
    reading: { short: null, number: 1795453201716, unit: null, long: null }, at: T0, validUntil: null }));
  assert.equal(reads.valueOf(stored).reading.time, 1795453201716);
});

test('epochMs: 10 digits of seconds or 13 of milliseconds, from September 2001; every other number none', () => {
  [[1e9, 1e12], [MOMENT_S, MOMENT_MS], [9999999999, 9999999999000], [1e12, 1e12], [MOMENT_MS, MOMENT_MS],
    [9999999999999, 9999999999999]].forEach(([v, ms]) => assert.equal(reads.epochMs(v), ms, String(v)));
  [999999999, 1e10, 99999999999, 999999999999, 1e13, 0, -1e12, -MOMENT_S, NaN, Infinity, null, '1795453201', true]
    .forEach((v) => assert.equal(reads.epochMs(v), null, String(v)));
});

test('namesMoment: a name ending in At or Time after a small letter or a digit, or in _at or _time', () => {
  ['updatedAt', 'startsAt', 'v2At', 'startTime', 'lastSyncTime', 'updated_at', 'starts_at', 'UPDATED_AT', 'start_time',
    'Start_Time'].forEach((name) => assert.equal(reads.namesMoment(name), true, name));
  ['at', 'At', 'time', 'Time', '_at', '_time', 'format', 'heat', 'SAT', 'uptime', 'runtime', 'lifetime', 'daysRemaining',
    'batteryLife', 'updatedat', 'updated at', 'at_time_', 'temperature'].forEach((name) =>
    assert.equal(reads.namesMoment(name), false, name));
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

test('sameReading: the same six fields, in whatever order they come', () => {
  const r = reading({ short: '87%', number: 87, unit: '%' });
  assert.equal(reads.sameReading(r, { long: null, state: null, unit: '%', number: 87, time: null, short: '87%' }), true);
  assert.equal(reads.sameReading(r, reads.valueOf({ source: 's', reading: r, at: T0 }).reading), true, 'through storage');
  [{ short: '86%' }, { time: MOMENT_MS }, { number: 86 }, { unit: 'pct' }, { state: false }, { long: 'x' }]
    .forEach((change) => assert.equal(reads.sameReading(r, Object.assign({}, r, change)), false, JSON.stringify(change)));
  assert.equal(reads.sameReading(null, null), true);
  assert.equal(reads.sameReading(r, null), false);
  assert.equal(reads.sameReading(null, r), false);
});
