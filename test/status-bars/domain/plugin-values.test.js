'use strict';
// The Plugin value slot's rules (plugin-values.js): the source the settings pick, the text the
// slot prints, how long a value shows, and a value's name. When it is read and what a read
// keeps are plugin-value-reads.test.js'; the dialog's list, plugin-value-list.test.js'; the
// reading and keeping, plugin-value-source.test.js'.
const test = require('node:test');
const assert = require('node:assert/strict');
const pv = require('../../../src/pkjs/status-bars/domain/plugin-values.js');

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const T0 = Date.UTC(2026, 10, 23, 12, 0, 0);
const UUID = '6c7e0e4a-1b2c-4d5e-8f90-a1b2c3d4e5f6';
const SETTINGS = { pluginValuePlugin: UUID, pluginValueReading: 'muninn/stats/daysRemaining' };

/**
 * @param {Object} fields The reading's fields that are set.
 * @returns {Object} A reading as plugin-reader.js readingOf hands it over.
 */
function reading(fields) {
  return Object.assign({ short: null, number: null, unit: null, long: null }, fields);
}

test('sourceOf: the plugin and the value the settings pick, null while either is missing', () => {
  assert.deepEqual(pv.sourceOf(SETTINGS), { plugin: UUID, id: 'muninn/stats/daysRemaining', category: 'muninn',
    item: 'stats', property: 'daysRemaining', key: UUID + '/muninn/stats/daysRemaining' });
  [null, {}, { pluginValuePlugin: UUID }, { pluginValueReading: 'a/b/c' },
    { pluginValuePlugin: '', pluginValueReading: 'a/b/c' }, { pluginValuePlugin: UUID, pluginValueReading: '' },
    { pluginValuePlugin: UUID, pluginValueReading: 'a/b' }, { pluginValuePlugin: UUID, pluginValueReading: 'a/b/c/d' },
    { pluginValuePlugin: UUID, pluginValueReading: 'a//c' }, { pluginValuePlugin: 5, pluginValueReading: 'a/b/c' }]
    .forEach((s) => assert.equal(pv.sourceOf(s), null, JSON.stringify(s)));
});

test('everyMs: the Updates row, every hour by default', () => {
  assert.equal(pv.everyMs({ pluginValueEvery: '30' }), 30 * MIN);
  assert.equal(pv.everyMs({ pluginValueEvery: '180' }), 3 * HOUR);
  assert.equal(pv.everyMs({ pluginValueEvery: '360' }), 6 * HOUR);
  [undefined, null, '', '45', 60, '60'].forEach((v) =>
    assert.equal(pv.everyMs({ pluginValueEvery: v }), HOUR, String(v)));
  assert.equal(pv.everyMs(null), HOUR);
  assert.deepEqual(pv.EVERY_CHOICES, ['30', '60', '180', '360']);
  assert.equal(pv.EVERY_DEFAULT, '60');
});

test('the text: the short text first, on one line', () => {
  assert.equal(pv.textFor(reading({ short: '87%', number: 87, unit: '%', long: 'Battery at 87%' }), 8), '87%');
  assert.equal(pv.textFor(reading({ short: ' 5G\n\tLTE ' }), 19), '5G LTE', 'control characters and runs of spaces');
  assert.equal(pv.textFor(reading({ short: 'Rain\u001fRN' }), 19), 'Rain RN', 'never the short form\'s separator');
  assert.equal(pv.textFor(reading({ short: '\u0001', long: 'ok' }), 19), 'ok', 'a short text of nothing is none');
});

test('the text: else the number, one decimal under 10, none from 10 up', () => {
  [[87, '87'], [9.94, '9.9'], [9.96, '10'], [21.46, '21'], [0.04, '0'], [-0.04, '0'], [-3.25, '-3.2'],
    [-12.6, '-13'], [0, '0'], [3, '3'], [12345.6, '12346']].forEach(([n, text]) =>
    assert.equal(pv.textFor(reading({ number: n }), 19), text, String(n)));
});

test('the text: the unit attaches when it is % or a degree, follows a space when it is any other', () => {
  assert.equal(pv.textFor(reading({ number: 87, unit: '%' }), 8), '87%');
  assert.equal(pv.textFor(reading({ number: 21.4, unit: '\u00b0C' }), 8), '21\u00b0C');
  assert.equal(pv.textFor(reading({ number: 3.24, unit: 'kWh' }), 8), '3.2 kWh');
  assert.equal(pv.textFor(reading({ number: 12, unit: 'km/h' }), 8), '12 km/h');
  assert.equal(pv.textFor(reading({ number: 12, unit: '  ' }), 8), '12', 'a unit of nothing');
});

test('the text: a unit the slot has no room for is left off', () => {
  assert.equal(pv.textFor(reading({ number: 1234, unit: 'kWh' }), 8), '1234 kWh', '8 bytes: fits');
  assert.equal(pv.textFor(reading({ number: 12345, unit: 'kWh' }), 8), '12345', '9 bytes: the unit goes');
  assert.equal(pv.textFor(reading({ number: 12345, unit: 'kWh' }), 19), '12345 kWh', 'the middle has room');
  assert.equal(pv.textFor(reading({ number: 12345, unit: '\u00b0C' }), 8), '12345\u00b0C', 'the degree is 2 bytes');
  assert.equal(pv.textFor(reading({ number: 123456, unit: '\u00b0C' }), 8), '123456');
});

test('the text: else the long text, else --', () => {
  assert.equal(pv.textFor(reading({ long: 'Next: Design review' }), 19), 'Next: Design review');
  assert.equal(pv.textFor(reading({}), 19), '--');
  assert.equal(pv.textFor(null, 19), '--');
});

test('the text: cut to the slot\'s bytes at a character\'s edge, as the bake cuts it', () => {
  assert.equal(pv.textFor(reading({ short: 'Days remaining 12' }), 8), 'Days rem');
  assert.equal(pv.textFor(reading({ long: 'Next: Design review at 14:00' }), 19), 'Next: Design review');
  assert.equal(pv.textFor(reading({ short: 'Gr\u00fc\u00dfe' }), 4), 'Gr\u00fc', 'two bytes each');
  assert.equal(pv.textFor(reading({ number: 123456789 }), 8), '12345678');
});

test('a value shows for three Updates intervals after it was read, three hours at least', () => {
  const r = reading({ number: 5 });
  const value = { source: pv.sourceOf(SETTINGS).key, reading: r, at: T0, validUntil: null };
  assert.equal(pv.shownReading(value, SETTINGS, T0), r);
  assert.equal(pv.shownReading(value, SETTINGS, T0 + 3 * HOUR - 1), r, 'every hour: three hours');
  assert.equal(pv.shownReading(value, SETTINGS, T0 + 3 * HOUR), null);
  const half = Object.assign({ pluginValueEvery: '30' }, SETTINGS);
  assert.equal(pv.shownReading(value, half, T0 + 3 * HOUR - 1), r, 'every 30 minutes: still three hours');
  assert.equal(pv.shownReading(value, half, T0 + 3 * HOUR), null);
  const six = Object.assign({ pluginValueEvery: '360' }, SETTINGS);
  assert.equal(pv.shownReading(value, six, T0 + 18 * HOUR - 1), r, 'every 6 hours: 18 hours');
  assert.equal(pv.shownReading(value, six, T0 + 18 * HOUR), null);
  assert.equal(pv.shownReading(value, SETTINGS, T0 - HOUR), r, 'a clock that went back');
});

test('a value the plugin said holds longer shows until then, but no more than 12 hours on', () => {
  const r = reading({ number: 5 });
  const key = pv.sourceOf(SETTINGS).key;
  const longer = { source: key, reading: r, at: T0, validUntil: T0 + 8 * HOUR };
  assert.equal(pv.shownReading(longer, SETTINGS, T0 + 8 * HOUR - 1), r);
  assert.equal(pv.shownReading(longer, SETTINGS, T0 + 8 * HOUR), null);
  const far = { source: key, reading: r, at: T0, validUntil: T0 + 100 * HOUR };
  assert.equal(pv.shownReading(far, SETTINGS, T0 + 12 * HOUR - 1), r);
  assert.equal(pv.shownReading(far, SETTINGS, T0 + 12 * HOUR), null);
  const shorter = { source: key, reading: r, at: T0, validUntil: T0 + MIN };
  assert.equal(pv.shownReading(shorter, SETTINGS, T0 + 3 * HOUR - 1), r, 'never shorter than the Updates rule');
});

test('a value shows only for the source it was read from', () => {
  const value = { source: pv.sourceOf(SETTINGS).key, reading: reading({ number: 5 }), at: T0, validUntil: null };
  assert.equal(pv.shownReading(value, Object.assign({}, SETTINGS, { pluginValueReading: 'muninn/stats/batteryLife' }),
    T0), null, 'another value');
  assert.equal(pv.shownReading(value, Object.assign({}, SETTINGS, { pluginValuePlugin: 'other' }), T0), null,
    'another plugin');
  assert.equal(pv.shownReading(value, {}, T0), null, 'none picked');
  assert.equal(pv.shownReading(null, SETTINGS, T0), null, 'none kept');
});

test('labelOf: a name made readable', () => {
  [['battery_level', 'Battery level'], ['daysRemaining', 'Days remaining'], ['UVIndex', 'UV index'],
    ['uv_index', 'Uv index'], ['5G', '5G'], ['mobile_data', 'Mobile data'], ['HTTPStatus', 'HTTP status'],
    ['wifi', 'Wifi'], ['a-b c', 'A b c'], ['location: uv_index', 'Location: uv index'], ['a: UVIndex', 'A: UV index'],
    ['stats: daysRemaining', 'Stats: days remaining']].forEach(([name, label]) => assert.equal(pv.labelOf(name), label, name));
});
