'use strict';
// The Plugin value slot's rules (plugin-values.js): what a slot picks and the source it names, the
// text the slot prints and the icon before it, how long a value shows, and a value's name. When it is read and what a read
// keeps are plugin-value-reads.test.js'; the dialog's list, plugin-value-list.test.js'; the
// reading and keeping, plugin-value-source.test.js'.
const test = require('node:test');
const assert = require('node:assert/strict');
const pv = require('../../../src/pkjs/status-bars/domain/plugin-values.js');
const catalog = require('../../../src/pkjs/status-bars/domain/status-line-catalog.js');
const { reading } = require('../../helpers/plugin-host.js');

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const T0 = Date.UTC(2026, 10, 23, 12, 0, 0);
const UUID = '6c7e0e4a-1b2c-4d5e-8f90-a1b2c3d4e5f6';
// What a slot picks (pv.pickOf): Muninn's days left.
const PICK = { plugin: UUID, id: 'muninn/stats/daysRemaining' };

test('pickOf: a slot\'s own plugin, value, icon and Updates, each as stored', () => {
  const settings = { statusTopRightPluginValuePlugin: UUID, statusTopRightPluginValueId: 'a/b/c',
    statusTopRightPluginValueIcon: 'wifi', statusTopRightPluginValueEvery: '15', statusTopLeftPluginValuePlugin: 'x' };
  assert.deepEqual(pv.pickOf(settings, 'statusTopRight'), { plugin: UUID, id: 'a/b/c', icon: 'wifi', every: '15' });
  assert.deepEqual(pv.pickOf(settings, 'statusTopMid'), { plugin: undefined, id: undefined, icon: undefined,
    every: undefined }, 'a slot that keeps none');
  assert.deepEqual(pv.pickOf(null, 'statusTopRight').plugin, undefined);
  const keys = catalog.pluginValueKeys('statusBar5Mid');
  assert.deepEqual(pv.pickOf({ [keys.plugin]: UUID, [keys.id]: 'a/b/c' }, 'statusBar5Mid'),
    { plugin: UUID, id: 'a/b/c', icon: undefined, every: undefined }, 'bars 4 to 6 too');
  assert.equal(pv.sourceOf(pv.pickOf(settings, 'statusTopMid')), null);
  assert.equal(pv.everyMs(pv.pickOf(settings, 'statusTopMid')), HOUR);
  assert.equal(pv.iconName(pv.pickOf(settings, 'statusTopMid')), 'none');
});

test('PICK_DEFAULTS: what a slot that keeps none picks, as the rest of the rules read it', () => {
  assert.deepEqual(pv.PICK_DEFAULTS, { plugin: '', id: '', icon: 'none', every: '60' });
  assert.equal(pv.sourceOf(pv.PICK_DEFAULTS), null);
  assert.equal(pv.iconName(pv.PICK_DEFAULTS), pv.iconName({}));
  assert.equal(pv.everyMs(pv.PICK_DEFAULTS), pv.everyMs({}));
});

test('sourceOf: the plugin and the value a slot picks, null while either is missing', () => {
  assert.deepEqual(pv.sourceOf(PICK), { plugin: UUID, id: 'muninn/stats/daysRemaining', category: 'muninn',
    item: 'stats', property: 'daysRemaining', key: UUID + '/muninn/stats/daysRemaining', complication: null });
  [null, {}, { plugin: UUID }, { id: 'a/b/c' },
    { plugin: '', id: 'a/b/c' }, { plugin: UUID, id: '' },
    { plugin: UUID, id: 'a/b' }, { plugin: UUID, id: 'a/b/c/d' },
    { plugin: UUID, id: 'a//c' }, { plugin: 5, id: 'a/b/c' }]
    .forEach((s) => assert.equal(pv.sourceOf(s), null, JSON.stringify(s)));
});

test('valueId: the id a slot keeps a value under, which sourceOf takes apart', () => {
  assert.equal(pv.valueId('muninn', 'stats', 'daysRemaining'), 'muninn/stats/daysRemaining');
  assert.deepEqual(pv.sourceOf({ plugin: UUID, id: pv.valueId('c', 'i', 'p') }),
    { plugin: UUID, id: 'c/i/p', category: 'c', item: 'i', property: 'p', key: UUID + '/c/i/p', complication: null });
});

test('a complication: the Preferences plugin\'s, by its place in the user\'s list', () => {
  const PREFS = '00000000-0000-0000-0001-000000000009';
  assert.equal(pv.PREFERENCES, PREFS);
  assert.equal(pv.complicationId(0), 'preferences/complications/0');
  assert.deepEqual(pv.sourceOf({ plugin: PREFS, id: pv.complicationId(2) }),
    { plugin: PREFS, id: 'preferences/complications/2', category: 'preferences', item: 'complications',
      property: '2', key: PREFS + '/preferences/complications/2', complication: 2 });
  assert.equal(pv.sourceOf({ plugin: PREFS.toUpperCase(), id: pv.complicationId(9) }).complication,
    9, 'the uuid in either case; the tenth place');
  [['another plugin', UUID, 'preferences/complications/0'], ['not a place', PREFS, 'preferences/complications/x'],
    ['written otherwise', PREFS, 'preferences/complications/01'], ['past the places', PREFS, 'preferences/complications/10'],
    ['another of its sources', PREFS, 'preferences/units/clock'], ['a part', PREFS, 'preferences/complications/1.5']]
    .forEach(([why, plugin, id]) => assert.equal(pv.sourceOf({ plugin: plugin, id: id }).complication,
      null, why));
});

test('readFrom: a value is the source\'s when it was read from it; a complication\'s, from any reading it names', () => {
  const PREFS = pv.PREFERENCES;
  const first = pv.sourceOf({ plugin: PREFS, id: pv.complicationId(0) });
  const own = pv.sourceOf(PICK);
  assert.equal(pv.readFrom({ source: own.key }, own), true);
  assert.equal(pv.readFrom({ source: own.key + '/x' }, own), false, 'a value of a plugin\'s own is only its source\'s');
  assert.equal(pv.readFrom({ source: first.key + '/weather/location/0/temperature' }, first), true);
  assert.equal(pv.readFrom({ source: first.key + '0/weather/location/0/temperature' }, first), false, 'the eleventh place');
  assert.equal(pv.readFrom({ source: PREFS + '/preferences/complications/1/w/l/0/t' }, first), false, 'another place');
  assert.equal(pv.readFrom(null, first), false);
  assert.equal(pv.readFrom({ source: first.key }, null), false);
});

test('everyMs: the Updates row, every hour by default', () => {
  assert.equal(pv.everyMs({ every: '15' }), 15 * MIN);
  assert.equal(pv.everyMs({ every: '30' }), 30 * MIN);
  assert.equal(pv.everyMs({ every: '180' }), 3 * HOUR);
  assert.equal(pv.everyMs({ every: '360' }), 6 * HOUR);
  [undefined, null, '', '45', 60, '60'].forEach((v) =>
    assert.equal(pv.everyMs({ every: v }), HOUR, String(v)));
  assert.equal(pv.everyMs(null), HOUR);
  assert.deepEqual(pv.EVERY_CHOICES, ['15', '30', '60', '180', '360']);
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

/** 17:04 and 9:05 here, in epoch milliseconds, as a value keeps a moment, and noon of their day. */
const EVENING = new Date(2026, 10, 23, 17, 4, 0).getTime();
const MORNING = new Date(2026, 10, 23, 9, 5, 0).getTime();
const TODAY = new Date(2026, 10, 23, 12, 0, 0).getTime();

test('the text: else its moment, as a clock time in the user\'s format, as the sun slot prints sunrise', () => {
  assert.equal(pv.textFor(reading({ time: EVENING }), 8, undefined, TODAY), '17:04', 'no settings: 24 hours');
  assert.equal(pv.textFor(reading({ time: MORNING }), 8, {}, TODAY), '9:05');
  assert.equal(pv.textFor(reading({ time: MORNING }), 8, { timeLeadingZero: true }, TODAY), '09:05');
  assert.equal(pv.textFor(reading({ time: EVENING }), 8, { axisTimeFormat: '12h' }, TODAY), '5:04');
  assert.equal(pv.textFor(reading({ time: EVENING }), 8, { axisTimeFormat: '12h', timeShowAmPm: true }, TODAY),
    '5:04p');
  assert.equal(pv.textFor(reading({ time: MORNING }), 8, { axisTimeFormat: '12h', timeShowAmPm: true,
    timeLeadingZero: true }, TODAY), '09:05a');
  assert.equal(pv.textFor(reading({ time: new Date(2026, 10, 23, 0, 30).getTime() }), 8,
    { axisTimeFormat: '12h', timeShowAmPm: true }, TODAY), '12:30a', 'half past midnight');
  assert.equal(pv.textFor(reading({ time: new Date(2026, 10, 23, 12, 45).getTime() }), 8,
    { axisTimeFormat: '12h', timeShowAmPm: true, timeLeadingZero: true }, TODAY), '12:45p',
  'the longest fits an edge slot');
});

test('the text: a moment on another day than the slot is baked for carries its date, alone where both do not fit', () => {
  const tomorrow = new Date(2026, 10, 24, 23, 10).getTime();
  assert.equal(pv.textFor(reading({ time: tomorrow }), 19, {}, TODAY), '23:10 24 Nov', 'the middle');
  assert.equal(pv.textFor(reading({ time: tomorrow }), 19, { axisTimeFormat: '12h', timeShowAmPm: true }, TODAY),
    '11:10p 24 Nov');
  assert.equal(pv.textFor(reading({ time: tomorrow }), 8, {}, TODAY), '24 Nov', 'an edge');
  assert.equal(pv.textFor(reading({ time: tomorrow }), 8, { axisTimeFormat: '12h', timeShowAmPm: true }, TODAY),
    '24 Nov');
  assert.equal(pv.textFor(reading({ time: tomorrow }), 19, {}, tomorrow), '23:10', 'baked on its day');
});

test('the text: the moment over the number, so Muninn\'s updatedAt prints as the time it was updated', () => {
  assert.equal(pv.textFor(reading({ time: EVENING, number: EVENING }), 19, {}, TODAY), '17:04');
  assert.equal(pv.textFor(reading({ number: EVENING }), 19), String(EVENING), 'a number alone stays a number');
});

test('the text: the plugin\'s short text over its moment and its state: its words say more', () => {
  assert.equal(pv.textFor(reading({ short: 'All day', time: new Date(2026, 10, 23).getTime() }), 8), 'All day');
  assert.equal(pv.textFor(reading({ short: 'Off', state: false }), 8), 'Off');
});

test('the text: else its state, on or off, lowercase; the number before it, the long text after it', () => {
  assert.equal(pv.textFor(reading({ state: true }), 8), 'on');
  assert.equal(pv.textFor(reading({ state: false }), 8), 'off');
  assert.equal(pv.textFor(reading({ state: true, number: 1 }), 8), '1');
  assert.equal(pv.textFor(reading({ state: false, long: 'Not charging' }), 19), 'off');
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

test('the icon: none by default and for a choice it does not know, the id that loads no drawing', () => {
  const none = catalog.ICONS.PLUGIN_TEXT;
  assert.equal(pv.iconName(null), 'none');
  assert.equal(pv.iconName({}), 'none');
  ['lamp', 'toString', 'constructor', '__proto__', 7].forEach((name) => {
    assert.equal(pv.iconName({ icon: name }), 'none', String(name));
    assert.equal(pv.iconId({ icon: name }, reading({ state: true })), none, String(name));
  });
  assert.equal(pv.iconId({ icon: 'none' }, reading({ state: true })), none);
});

test('the icon: one that turns is on only while the value is on; off, too old or not read, it is off', () => {
  const I = catalog.ICONS;
  [['switch', I.PV_SWITCH, I.PV_SWITCH_OFF], ['wifi', I.PV_WIFI, I.PV_WIFI_OFF],
    ['bluetooth', I.PV_BT, I.PV_BT_OFF]].forEach(([name, on, off]) => {
    const s = { icon: name };
    assert.equal(pv.iconName(s), name);
    assert.equal(pv.iconId(s, reading({ state: true })), on, name + ': on');
    assert.equal(pv.iconId(s, reading({ short: 'Lamp', state: true })), on, name + ': on, whatever the text says');
    assert.equal(pv.iconId(s, reading({ state: false })), off, name + ': off');
    assert.equal(pv.iconId(s, reading({ short: 'On' })), off, name + ': no state is no on');
    assert.equal(pv.iconId(s, null), off, name + ': too old or not read');
  });
});

test('the icon: one that stays the same is the same whatever the value', () => {
  const I = catalog.ICONS;
  [['plug', I.PV_PLUG], ['phone', I.PV_PHONE], ['calendar', I.PV_CALENDAR]].forEach(([name, id]) => {
    const s = { icon: name };
    [reading({ state: true }), reading({ state: false }), reading({ number: 87 }), null].forEach((r) => {
      assert.equal(pv.iconId(s, r), id, name);
    });
  });
  assert.deepEqual(Object.keys(pv.ICON_FORMS), ['none', 'switch', 'wifi', 'bluetooth', 'plug', 'phone', 'calendar'],
    'the Icon row\'s choices, in its order');
});

test('a value shows for three Updates intervals after it was read, three hours at least', () => {
  const r = reading({ number: 5 });
  const value = { source: pv.sourceOf(PICK).key, reading: r, at: T0, validUntil: null };
  assert.equal(pv.shownReading(value, PICK, T0), r);
  assert.equal(pv.shownReading(value, PICK, T0 + 3 * HOUR - 1), r, 'every hour: three hours');
  assert.equal(pv.shownReading(value, PICK, T0 + 3 * HOUR), null);
  const half = Object.assign({ every: '30' }, PICK);
  assert.equal(pv.shownReading(value, half, T0 + 3 * HOUR - 1), r, 'every 30 minutes: still three hours');
  assert.equal(pv.shownReading(value, half, T0 + 3 * HOUR), null);
  const six = Object.assign({ every: '360' }, PICK);
  assert.equal(pv.shownReading(value, six, T0 + 18 * HOUR - 1), r, 'every 6 hours: 18 hours');
  assert.equal(pv.shownReading(value, six, T0 + 18 * HOUR), null);
  assert.equal(pv.shownReading(value, PICK, T0 - HOUR), r, 'a clock that went back');
});

test('a value the plugin said holds longer shows until then, but no more than 12 hours on', () => {
  const r = reading({ number: 5 });
  const key = pv.sourceOf(PICK).key;
  const longer = { source: key, reading: r, at: T0, validUntil: T0 + 8 * HOUR };
  assert.equal(pv.shownReading(longer, PICK, T0 + 8 * HOUR - 1), r);
  assert.equal(pv.shownReading(longer, PICK, T0 + 8 * HOUR), null);
  const far = { source: key, reading: r, at: T0, validUntil: T0 + 100 * HOUR };
  assert.equal(pv.shownReading(far, PICK, T0 + 12 * HOUR - 1), r);
  assert.equal(pv.shownReading(far, PICK, T0 + 12 * HOUR), null);
  const shorter = { source: key, reading: r, at: T0, validUntil: T0 + MIN };
  assert.equal(pv.shownReading(shorter, PICK, T0 + 3 * HOUR - 1), r, 'never shorter than the Updates rule');
});

test('a value shows only for the source it was read from', () => {
  const value = { source: pv.sourceOf(PICK).key, reading: reading({ number: 5 }), at: T0, validUntil: null };
  assert.equal(pv.shownReading(value, Object.assign({}, PICK, { id: 'muninn/stats/batteryLife' }),
    T0), null, 'another value');
  assert.equal(pv.shownReading(value, Object.assign({}, PICK, { plugin: 'other' }), T0), null,
    'another plugin');
  assert.equal(pv.shownReading(value, {}, T0), null, 'none picked');
  assert.equal(pv.shownReading(null, PICK, T0), null, 'none kept');
});
