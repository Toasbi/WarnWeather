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

test('pickOf: a slot\'s own plugin, value, instance, Look, icon, label and Updates, each as stored', () => {
  const settings = { statusTopRightPluginValuePlugin: UUID, statusTopRightPluginValueId: 'a/b/c',
    statusTopRightPluginValueInstance: 'room-2', statusTopRightPluginValueLook: 'both',
    statusTopRightPluginValueIcon: 'wifi', statusTopRightPluginValueLabel: 'Lamp', statusTopRightPluginValueEvery: '15',
    statusTopLeftPluginValuePlugin: 'x' };
  assert.deepEqual(pv.pickOf(settings, 'statusTopRight'),
    { plugin: UUID, id: 'a/b/c', instance: 'room-2', look: 'both', icon: 'wifi', label: 'Lamp', every: '15' });
  assert.deepEqual(pv.pickOf(settings, 'statusTopMid'), { plugin: undefined, id: undefined, instance: undefined,
    look: undefined, icon: undefined, label: undefined, every: undefined }, 'a slot that keeps none');
  assert.deepEqual(pv.pickOf(null, 'statusTopRight').plugin, undefined);
  const keys = catalog.pluginValueKeys('statusBar5Mid');
  assert.deepEqual(pv.pickOf({ [keys.plugin]: UUID, [keys.id]: 'a/b/c' }, 'statusBar5Mid'),
    { plugin: UUID, id: 'a/b/c', instance: undefined, look: undefined, icon: undefined, label: undefined,
      every: undefined }, 'bars 4 to 6 too');
  assert.equal(pv.sourceOf(pv.pickOf(settings, 'statusTopMid')), null);
  assert.equal(pv.everyMs(pv.pickOf(settings, 'statusTopMid')), HOUR);
  assert.equal(pv.lookOf(pv.pickOf(settings, 'statusTopMid')), 'text');
  assert.equal(pv.iconName(pv.pickOf(settings, 'statusTopMid')), 'switch');
});

test('PICK_DEFAULTS: what a slot that keeps none picks, as the rest of the rules read it', () => {
  assert.deepEqual(pv.PICK_DEFAULTS,
    { plugin: '', id: '', instance: '', look: 'text', icon: 'switch', label: '', every: '60' });
  assert.equal(pv.labelText(pv.PICK_DEFAULTS), pv.labelText({}));
  assert.equal(pv.sourceOf(pv.PICK_DEFAULTS), null);
  assert.equal(pv.lookOf(pv.PICK_DEFAULTS), pv.lookOf({}));
  assert.equal(pv.iconName(pv.PICK_DEFAULTS), pv.iconName({}));
  assert.equal(pv.everyMs(pv.PICK_DEFAULTS), pv.everyMs({}));
});

test('sourceOf: the plugin and the value a slot picks, null while either is missing', () => {
  assert.deepEqual(pv.sourceOf(PICK), { plugin: UUID, id: 'muninn/stats/daysRemaining', category: 'muninn',
    item: 'stats', property: 'daysRemaining', instance: '', key: UUID + '/muninn/stats/daysRemaining',
    complication: null });
  [null, {}, { plugin: UUID }, { id: 'a/b/c' },
    { plugin: '', id: 'a/b/c' }, { plugin: UUID, id: '' },
    { plugin: UUID, id: 'a/b' }, { plugin: UUID, id: 'a/b/c/d' },
    { plugin: UUID, id: 'a//c' }, { plugin: 5, id: 'a/b/c' }]
    .forEach((s) => assert.equal(pv.sourceOf(s), null, JSON.stringify(s)));
});

test('valueId: the id a slot keeps a value under, which sourceOf takes apart', () => {
  assert.equal(pv.valueId('muninn', 'stats', 'daysRemaining'), 'muninn/stats/daysRemaining');
  assert.deepEqual(pv.sourceOf({ plugin: UUID, id: pv.valueId('c', 'i', 'p') }),
    { plugin: UUID, id: 'c/i/p', category: 'c', item: 'i', property: 'p', instance: '', key: UUID + '/c/i/p',
      complication: null });
});

test('sourceOf: the instance a slot picks, written into the key where no reader of it looks', () => {
  const lamp = pv.sourceOf({ plugin: UUID, id: 'home/light/on', instance: 'hue/light 3' });
  assert.equal(lamp.instance, 'hue/light 3');
  assert.equal(lamp.key, UUID + '#hue%2Flight%203/home/light/on', 'the id as a URI component: no \'/\' in it');
  assert.deepEqual(lamp.key.split('/').slice(-3), ['home', 'light', 'on'], 'the value\'s parts, last, where they were');
  assert.notEqual(lamp.key, pv.sourceOf({ plugin: UUID, id: 'home/light/on' }).key, 'the first\'s is another');
  assert.notEqual(lamp.key, pv.sourceOf({ plugin: UUID, id: 'home/light/on', instance: 'hue/light 4' }).key);
  [undefined, null, 5, '', 'x'.repeat(pv.MAX_INSTANCE_ID + 1)].forEach((instance) =>
    assert.deepEqual(pv.sourceOf({ plugin: UUID, id: 'home/light/on', instance: instance }),
      pv.sourceOf({ plugin: UUID, id: 'home/light/on' }), 'the first: ' + String(instance).slice(0, 8)));
  assert.equal(pv.sourceOf({ plugin: UUID, id: 'home/light/on', instance: 'x'.repeat(pv.MAX_INSTANCE_ID) }).instance
    .length, pv.MAX_INSTANCE_ID, 'the longest id kept');
  assert.equal(pv.itemKeyOf(pv.sourceOf({ plugin: UUID.toUpperCase(), id: 'home/light/on', instance: 'a' })),
    UUID + '/home/light', 'the item it is of, by the uuid in lower case');
});

test('cutName: a name cut to its characters, the ellipsis the last, a character outside the BMP whole', () => {
  assert.equal(pv.cutName('Kitchen', 7), 'Kitchen');
  assert.equal(pv.cutName('Kitchens', 7), 'Kitche\u2026');
  assert.equal(pv.cutName('\ud83d\udca1\ud83d\udca1\ud83d\udca1', 2), '\ud83d\udca1\u2026');
});

test('a complication: the Preferences plugin\'s, by its place in the user\'s list', () => {
  const PREFS = '00000000-0000-0000-0001-000000000009';
  assert.equal(pv.PREFERENCES, PREFS);
  assert.equal(pv.complicationId(0), 'preferences/complications/0');
  assert.deepEqual(pv.sourceOf({ plugin: PREFS, id: pv.complicationId(2) }),
    { plugin: PREFS, id: 'preferences/complications/2', category: 'preferences', item: 'complications',
      property: '2', instance: '', key: PREFS + '/preferences/complications/2', complication: 2 });
  assert.deepEqual(pv.sourceOf({ plugin: PREFS, id: pv.complicationId(2), instance: 'x' }),
    pv.sourceOf({ plugin: PREFS, id: pv.complicationId(2) }), 'a complication names its own instance');
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

test('the text: a moment on another day than the slot is baked for carries its day, alone where both do not fit', () => {
  const tomorrow = new Date(2026, 10, 24, 23, 10).getTime();
  const nextWeek = new Date(2026, 10, 30, 23, 10).getTime();
  assert.equal(pv.textFor(reading({ time: tomorrow }), 19, {}, TODAY), 'Tue 23:10', 'the middle: its weekday');
  assert.equal(pv.textFor(reading({ time: tomorrow }), 19, { axisTimeFormat: '12h', timeShowAmPm: true }, TODAY),
    'Tue 11:10p');
  assert.equal(pv.textFor(reading({ time: tomorrow }), 8, {}, TODAY), 'Tue', 'an edge: 9 bytes in 8');
  assert.equal(pv.textFor(reading({ time: new Date(2026, 10, 28, 9, 15).getTime() }), 8, {}, TODAY), 'Sat 9:15',
    'an edge: 8 bytes in 8');
  assert.equal(pv.textFor(reading({ time: nextWeek }), 19, {}, TODAY), '23:10 30 Nov', 'a week on: its date');
  assert.equal(pv.textFor(reading({ time: nextWeek }), 8, {}, TODAY), '30 Nov');
  assert.equal(pv.textFor(reading({ time: tomorrow }), 19, {}, tomorrow), '23:10', 'baked on its day');
});

test('the text: the moment over the number, so Muninn\'s updatedAt prints as the time it was updated', () => {
  assert.equal(pv.textFor(reading({ time: EVENING, number: EVENING }), 19, {}, TODAY), '17:04');
  assert.equal(pv.textFor(reading({ number: EVENING }), 19), String(EVENING), 'a number alone stays a number');
});

test('the text: the plugin\'s short text over its state: its words say more', () => {
  assert.equal(pv.textFor(reading({ short: 'Off', state: false }), 8), 'Off');
});

test('the text: a short text that is only a clock time gives way to its moment, in the user\'s format and with its date', () => {
  const tomorrow = new Date(2026, 10, 24, 9, 15).getTime();
  const later = new Date(2026, 10, 23, 14, 30).getTime();
  assert.equal(pv.textFor(reading({ short: '09:15', time: tomorrow }), 8, {}, TODAY), 'Tue 9:15', 'tomorrow, not today');
  assert.equal(pv.textFor(reading({ short: '09:15', time: tomorrow }), 19, {}, TODAY), 'Tue 9:15');
  assert.equal(pv.textFor(reading({ short: '14:30', time: later }), 8, { axisTimeFormat: '12h', timeShowAmPm: true },
    TODAY), '2:30p', 'today, on a 12 hour clock');
  assert.equal(pv.textFor(reading({ short: '7:55 AM', time: new Date(2026, 10, 23, 7, 55).getTime() }), 8, {}, TODAY),
    '7:55', 'the Pebble app\'s 12 hours, in the user\'s 24');
  assert.equal(pv.textFor(reading({ short: '19.30', time: new Date(2026, 10, 23, 19, 30).getTime() }), 8,
    { axisTimeFormat: '12h' }, TODAY), '7:30');
});

test('the text: words beside a moment only on its day, its day on another; an all-day event\'s day is the one in UTC', () => {
  const todays = Date.UTC(2026, 10, 23);
  const mondays = Date.UTC(2026, 10, 30);
  assert.equal(pv.textFor(reading({ short: 'All day', time: todays }), 8, {}, TODAY), 'All day');
  assert.equal(pv.textFor(reading({ short: 'All day', time: mondays }), 8, {}, TODAY), '30 Nov',
    'next Monday\'s: a week on, its date');
  assert.equal(pv.textFor(reading({ short: 'All day', time: Date.UTC(2026, 10, 29) }), 8, {}, TODAY), 'Sun',
    'Sunday\'s: in the coming week, its weekday');
  assert.equal(pv.textFor(reading({ short: 'All day', time: Date.UTC(2026, 10, 22) }), 8, {}, TODAY), '22 Nov',
    'yesterday\'s: its date');
  assert.equal(pv.textFor(reading({ short: 'Soon', time: new Date(2026, 10, 24, 10, 30).getTime() }), 8, {}, TODAY),
    'Tue', 'words beside another day\'s time');
  assert.equal(pv.textFor(reading({ short: 'Soon', time: EVENING }), 8, {}, TODAY), 'Soon', 'its own day');
  const zone = process.env.TZ;
  process.env.TZ = 'America/New_York';
  try {
    const tuesdays = Date.UTC(2026, 10, 24);
    assert.equal(pv.textFor(reading({ short: 'All day', time: tuesdays }), 8, {}, new Date(2026, 10, 23, 20).getTime()),
      'Tue', 'the evening before, west of UTC: not today\'s');
    assert.equal(pv.textFor(reading({ short: 'All day', time: tuesdays }), 8, {}, new Date(2026, 10, 24, 10).getTime()),
      'All day', 'on its day');
  } finally {
    if (zone === undefined) { delete process.env.TZ; } else { process.env.TZ = zone; }
  }
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

test('the text: cut to the slot\'s bytes at a character\'s edge, with an ellipsis after it', () => {
  assert.equal(pv.textFor(reading({ short: 'Partly cloudy' }), 8), 'Partl\u2026');
  assert.equal(pv.textFor(reading({ short: 'Light rain, thunder' }), 8), 'Light\u2026', 'no blank or comma before it');
  assert.equal(pv.textFor(reading({ short: 'Light rain, thunder' }), 19), 'Light rain, thunder', 'a text that fits');
  assert.equal(pv.textFor(reading({ short: 'Days remaining 12' }), 8), 'Days\u2026', 'a number with no decimals');
  assert.equal(pv.textFor(reading({ long: 'Next: Design review at 14:00' }), 19), 'Next: Design rev\u2026');
  assert.equal(pv.textFor(reading({ short: 'Gr\u00fc\u00dfe aus K\u00f6ln' }), 8), 'Gr\u00fc\u2026', 'two bytes each');
  assert.equal(pv.textFor(reading({ number: 123456789 }), 8), '12345\u2026');
  assert.equal(pv.textFor(reading({ short: '+CHF 11189.84' }), 8), '+CHF\u2026', 'a number that fits no rounding');
  assert.equal(pv.textFor(reading({ short: '...........' }), 8), '........', 'nothing but what the cut strips');
});

test('the text: a number that does not fit loses the decimals it must, rounded, its sign and unit kept', () => {
  [['\u20ac189.84', 8, '\u20ac189.8'], ['\u20ac1189.84', 8, '\u20ac1190'], ['CHF 92.14', 8, 'CHF 92.1'],
    ['+CHF 0.09', 8, '+CHF 0.1'], ['189.84 \u20ac', 8, '190 \u20ac'], ['21.46 \u00b0C', 8, '21.5 \u00b0C'],
    ['99.96%', 5, '100%'], ['99.5', 3, '100'], ['0.94', 3, '0.9'], ['0.96', 3, '1.0'],
    ['$91,234.56', 8, '$91,235'], ['9,999.5', 6, '10,000'], ['Room 2: 21.46', 12, 'Room 2: 21.5'],
    ['1.234,56 \u20ac', 10, '1.235 \u20ac'], ['12,5 km', 6, '13 km'],
    ['0.125 mm/h', 8, '0.1 mm/h']].forEach(([text, cap, shown]) => {
    assert.equal(pv.textFor(reading({ short: text }), cap), shown, text + ' in ' + cap);
  });
  assert.equal(pv.textFor(reading({ short: '\u20ac189.84' }), 19), '\u20ac189.84', 'whole where it fits');
});

test('the text: a number whose decimals are not sure is cut, not rounded', () => {
  assert.equal(pv.textFor(reading({ short: '1.234 kWh' }), 8), '1.234\u2026', '1.234 is 1234 in German');
  assert.equal(pv.textFor(reading({ short: '12,345 ft' }), 8), '12,34\u2026', '12,345 is 12345 in English');
  assert.equal(pv.textFor(reading({ short: '1,234,567 steps' }), 8), '1,234\u2026', 'thousands grouped twice');
  assert.equal(pv.textFor(reading({ short: '1,234,567' }), 6), '1,2\u2026', 'never rounded to 1,235');
  assert.equal(pv.textFor(reading({ short: '999,999.5' }), 8), '999,9\u2026', 'a carry that would group it wrongly');
});

test('the Look: the text alone by default and for a choice it does not know, the id that loads no drawing', () => {
  const textOnly = catalog.ICONS.PLUGIN_TEXT;
  assert.deepEqual(pv.LOOKS, ['both', 'text', 'icon'], 'the Look row\'s choices, as the other slots\' rows name them');
  assert.equal(pv.lookOf(null), 'text');
  assert.equal(pv.lookOf({}), 'text');
  ['none', 'toString', '__proto__', 7].forEach((look) => assert.equal(pv.lookOf({ look: look }), 'text', String(look)));
  ['both', 'icon'].forEach((look) => assert.equal(pv.lookOf({ look: look }), look));
  ['switch', 'plug', 'calendar', undefined].forEach((icon) => {
    assert.equal(pv.iconId({ icon: icon }, reading({ state: true })), textOnly, 'no icon in the Text look: ' + icon);
    assert.equal(pv.iconId({ look: 'text', icon: icon }, null), textOnly, String(icon));
  });
});

test('the icon: the Switch by default and for a choice it does not know, the None of before the Look too', () => {
  assert.equal(pv.iconName(null), 'switch');
  assert.equal(pv.iconName({}), 'switch');
  ['none', 'lamp', 'toString', 'constructor', '__proto__', 7].forEach((name) => {
    assert.equal(pv.iconName({ icon: name }), 'switch', String(name));
    assert.equal(pv.iconId({ look: 'both', icon: name }, reading({ state: true })), catalog.ICONS.PV_SWITCH, String(name));
  });
});

test('the text: none in the Icon look, the value\'s in the others, -- in every Look while there is none', () => {
  const r = reading({ short: '87%' });
  assert.equal(pv.slotTextOf({ look: 'icon' }, r, 8, {}, T0), '');
  assert.equal(pv.slotTextOf({ look: 'both' }, r, 8, {}, T0), '87%');
  assert.equal(pv.slotTextOf({}, r, 8, {}, T0), '87%');
  assert.equal(pv.slotTextOf({ look: 'text' }, null, 8, {}, T0), '--', 'not read: --');
  assert.equal(pv.slotTextOf({ look: 'icon' }, null, 8, {}, T0), '--', 'not read: -- beside the icon, off');
});

test('the label: in place of a value that is on or off, beside an icon that turns, and nowhere else', () => {
  const lamp = { look: 'both', icon: 'switch', label: 'Lamp' };
  const ON = reading({ state: true });
  // What a slot that picks the lamp, or the lamp with `more`, prints of a reading.
  const text = (more, r, cap = 19) => pv.slotTextOf(Object.assign({}, lamp, more), r, cap, {}, T0);
  [ON, reading({ state: false }), reading({ state: true, short: 'Charging' })].forEach((r) => {
    assert.equal(text({}, r), 'Lamp', JSON.stringify(r));
  });
  assert.equal(text({}, null), '--', 'not read: --, so the icon off never passes for a value that is off');
  assert.equal(text({}, reading({ short: 'Home' })), 'Home', 'a value with no state: its own text');
  assert.equal(text({ look: 'text' }, ON), 'on', 'the Text look: the text is all that shows the value');
  assert.equal(text({ look: 'icon' }, ON), '');
  assert.equal(text({ icon: 'plug' }, ON), 'on', 'an icon that stays the same shows no state');
  assert.equal(text({ label: ' \t ' }, reading({ state: false })), 'off', 'a label of blanks is none');
  assert.equal(text({ label: 'Wohnzimmerlampe' }, ON, 8), 'Wohnzimm', 'cut to the slot, as any text');
  assert.equal(text({ label: 'K\u00fcche\u00fc' }, ON, 6), 'K\u00fcche', 'at a character\'s edge');
  assert.equal(text({ label: 'Kitchen lamp' }, ON, 8), 'Kitchen', 'no blank left where it is cut');
  assert.equal(pv.labelText(Object.assign({}, lamp, { label: ' Garden\n lamp ' })), 'Garden lamp', 'on one line');
  [null, {}, { look: 'both', icon: 'switch', label: 7 }].forEach((pick) => assert.equal(pv.labelText(pick), '', JSON.stringify(pick)));
  assert.deepEqual([pv.showsLabel(lamp), pv.showsLabel({ look: 'both', icon: 'wifi' }), pv.showsLabel({ look: 'both' }),
    pv.showsLabel({ look: 'both', icon: 'calendar' }), pv.showsLabel({ look: 'text', icon: 'switch' })],
  [true, true, true, false, false], 'the Switch by default turns');
});

test('the icon: one that turns is on only while the value is on; off, too old or not read, it is off', () => {
  const I = catalog.ICONS;
  [['switch', I.PV_SWITCH, I.PV_SWITCH_OFF], ['wifi', I.PV_WIFI, I.PV_WIFI_OFF],
    ['bluetooth', I.PV_BT, I.PV_BT_OFF]].forEach(([name, on, off]) => {
    const s = { look: 'both', icon: name };
    assert.equal(pv.iconId({ look: 'icon', icon: name }, reading({ state: true })), on, name + ': the Icon look too');
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
    const s = { look: 'both', icon: name };
    [reading({ state: true }), reading({ state: false }), reading({ number: 87 }), null].forEach((r) => {
      assert.equal(pv.iconId(s, r), id, name);
    });
  });
  assert.deepEqual(Object.keys(pv.ICON_FORMS), ['switch', 'wifi', 'bluetooth', 'plug', 'phone', 'calendar'],
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
