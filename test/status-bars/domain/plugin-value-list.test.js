'use strict';
// The plugins the Plugin value slot's dialog lists (plugin-value-list.js): what each plugin on
// the phone serves that the slot can show, written short (each item with its properties'
// names, from which the page makes the values; plugin-value-page.test.js) and capped, since the
// list rides the settings page's URL. The Preferences plugin's entry carries the user's
// complications instead (what they are is complications.test.js').
const test = require('node:test');
const assert = require('node:assert/strict');
const list = require('../../../src/pkjs/status-bars/domain/plugin-value-list.js');
const reads = require('../../../src/pkjs/status-bars/domain/plugin-reads.js');
const { PREFERENCES, UNPRINTABLE } = require('../../../src/pkjs/status-bars/domain/plugin-values.js');
const { PERMS, COMPLICATIONS_SOURCE, preferencesPlugin } = require('../../helpers/plugin-host.js');

/**
 * @param {string} uuid The plugin's uuid.
 * @param {string} name Its name.
 * @param {Array<Object>} sources Its sources' declarations.
 * @returns {Object} A plugin as Pebble.enumeratePlugins() lists it.
 */
function plugin(uuid, name, sources) {
  return { uuid: uuid, name: name, sources: sources, actions: [] };
}

const PHONE = plugin('00000000-0000-0000-0001-000000000001', 'Phone', [{ category: 'phone', items: ['phone_state'],
  properties: { battery_level: ['numericValue', 'shortText'], cell: ['shortText'], wifi: ['boolean', 'shortText'],
    charging: ['boolean'] }, suggestedRefreshIntervalSec: 60 }]);

test('each plugin with its items and the properties of them the slot can print', () => {
  assert.deepEqual(list.listOf([PHONE], PERMS, 'own'), [{ uuid: PHONE.uuid, name: 'Phone', items: [
    { category: 'phone', item: 'phone_state', multiple: false,
      properties: ['battery_level', 'cell', 'wifi', 'charging'], onOff: 12 }] }],
  'a boolean alone is printed too: on or off');
});

test('the values that are on or off, a bit each by their place among the names: the Icon row\'s icons that turn', () => {
  const lamp = plugin('l', 'Lamp', [{ category: 'home', items: ['lamp', 'door'],
    properties: { level: ['numericValue'], on: ['boolean'], label: ['shortText'], open: ['shortText', 'boolean'] } }]);
  assert.deepEqual(list.listOf([lamp], PERMS, 'own')[0].items.map((it) => it.onOff), [10, 10],
    'on and open, the second and the fourth name, on each item');
  const none = plugin('n', 'Numbers', [{ category: 'n', items: ['i'], properties: { level: ['numericValue'] } }]);
  assert.equal('onOff' in list.listOf([none], PERMS, 'own')[0].items[0], false, 'none: left out, as it costs the URL');
});

test('a timestamp alone is printed, as a clock time; a shape the slot cannot print is left out', () => {
  const sky = plugin('s', 'Sky', [{ category: 'sky', items: ['today'], properties: { sunrise: ['timestamp'],
    moon: ['icon', 'image'], hours: ['series.timestamp'], phase: ['image', 'shortText'] } }]);
  assert.deepEqual(list.listOf([sky], PERMS, 'own')[0].items[0].properties, ['sunrise', 'phase']);
});

test('a source that does something when it is read is never listed: Find My Phone rings the phone', () => {
  const phone = plugin(PHONE.uuid, 'Phone', PHONE.sources.concat([{ category: 'phone',
    items: ['find_my_phone', 'phone_state_copy'], properties: { ringing: ['boolean', 'shortText'] } }]));
  assert.deepEqual(list.listOf([phone], PERMS, 'own')[0].items.map((it) => it.item), ['phone_state', 'phone_state_copy']);
  assert.deepEqual(list.listOf([plugin('f', 'Find', [{ category: 'phone', items: ['find_my_phone'],
    properties: { ringing: ['boolean'] } }])], PERMS, 'own'), [], 'a plugin with nothing else offers nothing');
});

test('a source this app never reads is never listed, whoever serves it: the user\'s weather locations and units', () => {
  assert.deepEqual(list.listOf([plugin('u', 'Units', [{ category: 'preferences',
    items: ['units', 'weather_location', 'other'], properties: { label: ['shortText'] } }])], PERMS, 'own')[0].items
    .map((it) => it.item), ['other']);
});

test('what is no value to show is never listed: an id, a link, an account, a position, a code, the Index\'s plumbing', () => {
  const home = plugin('h', 'Home', [{ category: 'home', items: ['device'], supportsMultiple: true, properties: {
    name: ['shortText'], id: ['longText'], deviceId: ['shortText'], room: ['shortText'], type: ['shortText'],
    capabilities: ['longText'], on: ['boolean', 'shortText'], url: ['longText'], web_link: ['longText'],
    latitude: ['numericValue'], home_lng: ['numericValue'], accuracyMeters: ['numericValue'], address: ['shortText'],
    condition_code: ['longText'], conditionCode: ['longText'], utc_offset: ['numericValue'], email: ['shortText'],
    api_key: ['shortText'], package: ['longText'], path: ['shortText'], account: ['shortText'],
    typeface: ['shortText'], keyboard: ['shortText'] } },
  { category: 'home', items: ['home_lights'], properties: { name: ['shortText'], on: ['boolean', 'shortText'] } }]);
  assert.deepEqual(list.listOf([home], PERMS, 'own')[0].items.map((it) => [it.item, it.properties]), [
    ['device', ['name', 'room', 'on', 'typeface', 'keyboard']], ['home_lights', ['on']]],
  'an instance\'s name only where the source serves more than one, which it labels; a word that only starts as '
    + 'one of them is no such name');
  const index = plugin('n', 'Notes', [{ category: 'notes', items: ['destination'], properties: { title: ['shortText'] } },
    { category: 'reminders', items: ['list'], supportsMultiple: true, properties: { title: ['shortText'] } },
    { category: 'agent', items: ['chats'], supportsMultiple: true, properties: { title: ['shortText'] } },
    { category: 'tasks', items: ['configured', 'today'], properties: { count: ['numericValue'] } }]);
  assert.deepEqual(list.listOf([index], PERMS, 'own')[0].items.map((it) => it.item), ['today'],
    'the places a plugin offers the Index for notes, reminders and chats, and whether one is set up');
  assert.deepEqual(list.listOf([plugin('i', 'Index only', [{ category: 'agent', items: ['chats'],
    properties: { title: ['shortText'] } }])], PERMS, 'own'), [], 'a plugin of nothing but that is not listed');
});

test('every item of every source, each value once, in the order the plugin declares them', () => {
  const weather = plugin('w', 'Weather', [
    { category: 'weather', items: ['location'], properties: { temperature: ['shortText'], uv_index: ['numericValue'] },
      supportsMultiple: true, callerPermissions: [{ name: 'Location' }] },
    { category: 'weather', items: ['hour', 'day'], properties: { temperature: ['series.numericValue', 'numericValue'] },
      callerPermissions: ['Location'] },
    { category: 'weather', items: ['location'], properties: { temperature: ['shortText'], pressure: ['longText'] } }]);
  assert.deepEqual(list.listOf([weather], PERMS, 'own')[0].items, [
    { category: 'weather', item: 'location', multiple: true, properties: ['temperature', 'uv_index'] },
    { category: 'weather', item: 'hour', multiple: false, properties: ['temperature'] },
    { category: 'weather', item: 'day', multiple: false, properties: ['temperature'] },
    { category: 'weather', item: 'location', multiple: false, properties: ['pressure'] }]);
});

test('a source that asks for a permission this app never declares is left out, as is this app\'s own plugin', () => {
  const calendar = plugin('cal', 'Calendar', [{ category: 'calendar', items: ['event'],
    properties: { name: ['shortText'] }, callerPermissions: [{ name: 'Calendar' }] }]);
  const theirs = plugin('t', 'Theirs', [{ category: 't', items: ['x'], properties: { v: ['shortText'] },
    callerPermissions: [{ name: 'Location', plugin: 'someone' }] }]);
  const odd = plugin('o', 'Odd', [{ category: 'o', items: ['x'], properties: { v: ['shortText'] },
    callerPermissions: [42] }]);
  const own = plugin('OWN', 'WarnWeather', [{ category: 'w', items: ['x'], properties: { v: ['shortText'] } }]);
  assert.deepEqual(list.listOf([calendar, theirs, odd, own, PHONE], PERMS, 'own').map((p) => p.name), ['Phone']);
});

test('an item is judged by the first of the plugin\'s sources that serves it, as the Pebble app judges its read', () => {
  const twice = (first, second) => plugin('w', 'Weather', [
    { category: 'weather', items: ['location'], properties: { temperature: ['shortText'] }, callerPermissions: first },
    { category: 'weather', items: ['location', 'hour'], properties: { pressure: ['shortText'] },
      callerPermissions: second }]);
  const items = (p) => list.listOf([p], PERMS, 'own')[0].items.map((i) => i.item + ':' + i.properties.join());
  assert.deepEqual(items(twice(['Calendar'], [])), ['hour:pressure'],
    'the first asks for Calendar: neither lists the location; the hour is the second\'s own');
  assert.deepEqual(items(twice([], ['Calendar'])), ['location:temperature', 'location:pressure'],
    'the first asks for none: the second lists the location too, but not its own hour');
});

test('the Preferences plugin offers the user\'s complications, and nothing else of what it serves', () => {
  const UNITS = { category: 'preferences', items: ['units'], properties: { clock: ['shortText'], locale: ['shortText'] } };
  const LOCATIONS = { category: 'preferences', items: ['weather_location'], supportsMultiple: true,
    properties: { name: ['shortText'], latitude: ['numericValue'], longitude: ['numericValue'], current: ['boolean'] },
    callerPermissions: [{ name: 'Location' }] };
  const KNOWN = [{ position: 1, category: 'phone', item: 'phone_state', index: 0, property: 'battery_level' }];
  assert.deepEqual(list.listOf([preferencesPlugin([UNITS, COMPLICATIONS_SOURCE, LOCATIONS]), PHONE], PERMS, 'own', KNOWN)
    .map((p) => [p.name, p.items, p.complications]), [['Preferences', [], [{ position: 1, property: 'battery_level',
    category: 'phone', item: 'phone_state' }]], ['Phone', list.listOf([PHONE], PERMS, 'own')[0].items, undefined]],
  'its units are plumbing, and its weather locations\' coordinates are the user\'s position');
  assert.deepEqual(list.listOf([preferencesPlugin()], PERMS, 'own', null)[0].complications, [], 'none known yet');
  assert.deepEqual(list.listOf([preferencesPlugin([UNITS, LOCATIONS])], PERMS, 'own', KNOWN), [],
    'a Pebble app without complications');
  assert.equal(list.listOf([plugin(PREFERENCES.toUpperCase(), 'Preferences', [COMPLICATIONS_SOURCE])], PERMS, 'own',
    KNOWN)[0].complications.length, 1, 'its uuid in either case');
});

test('a complication the slot cannot print is greyed out as such: a series or a picture', () => {
  const weather = plugin('w', 'Weather', [{ category: 'weather', items: ['location'], properties: {
    temperature: ['shortText'], hourly_temperature: ['series.numericValue', 'series.shortText'] } }]);
  const music = plugin('m', 'Music', [{ category: 'music', items: ['track'], properties: { artwork: ['image'] },
    callerPermissions: ['ReadMusic'] }]);
  const known = [
    { position: 0, category: 'weather', item: 'location', index: 0, property: 'hourly_temperature' },
    { position: 1, category: 'music', item: 'track', index: 0, property: 'artwork' },
    { position: 2, category: 'weather', item: 'location', index: 0, property: 'temperature' },
    { position: 3, category: 'weather', item: 'location', index: 0, property: 'humidity' }];
  const whys = (plugins, permissions) => list.listOf([preferencesPlugin()].concat(plugins), permissions, 'own', known)[0]
    .complications.map((c) => c.why);
  assert.deepEqual(whys([weather, music], PERMS.concat('ReadMusic')), [UNPRINTABLE, UNPRINTABLE, undefined, undefined],
    'a series, a picture, a text; one no plugin declares, which the one the user prefers may serve all the same');
  assert.equal(whys([weather, music], PERMS)[1], 'ReadMusic', 'the permission it needs comes first');
  const other = plugin('o', 'Other weather', [{ category: 'weather', items: ['location'],
    properties: { hourly_temperature: ['numericValue'] } }]);
  assert.equal(whys([weather, other], PERMS)[0], undefined,
    'another plugin serves it as a number: the user may prefer that one');
});

test('a complication that is no value to show is greyed out as the slot cannot show it', () => {
  const people = plugin('p', 'People', [{ category: 'people', items: ['location'], supportsMultiple: true,
    properties: { name: ['shortText'], latitude: ['numericValue'], place: ['shortText'] } }]);
  const hue = plugin('h', 'Hue', [{ category: 'home', items: ['home_lights'], properties: { name: ['shortText'] } }]);
  const known = [
    { position: 0, category: 'people', item: 'location', index: 0, property: 'latitude' },
    { position: 1, category: 'people', item: 'location', index: 0, property: 'name' },
    { position: 2, category: 'home', item: 'home_lights', index: 0, property: 'name' },
    { position: 3, category: 'notes', item: 'destination', index: 0, property: 'title' }];
  const notes = plugin('n', 'Notes', [{ category: 'notes', items: ['destination'], properties: { title: ['shortText'] } }]);
  assert.deepEqual(list.listOf([preferencesPlugin(), people, hue, notes], PERMS, 'own', known)[0].complications
    .map((c) => c.why), [UNPRINTABLE, undefined, UNPRINTABLE, UNPRINTABLE],
  'a position; the name of one of several, which says which; the name of the one instance, the same always; '
    + 'the Index\'s plumbing');
  assert.equal(list.listOf([preferencesPlugin(), people, hue], PERMS, 'own', known)[0].complications[3].why, '',
    'where no plugin serves it, that is said first');
});

test('each complication by its place, what it shows, and why this app may not read it, where it may not', () => {
  const weather = plugin('w', 'Weather', [{ category: 'weather', items: ['location'],
    properties: { temperature: ['shortText'] }, callerPermissions: ['Location'] }]);
  const calendar = plugin('c', 'Calendar', [{ category: 'calendar', items: ['event'],
    properties: { starts_at: ['timestamp'] }, callerPermissions: [{ name: 'Calendar' }] }]);
  const find = plugin('f', 'Phone', [{ category: 'phone', items: ['find_my_phone'], properties: { ringing: ['boolean'] } }]);
  const lights = plugin('l', 'Lights', [{ category: 'lights', items: ['room'], properties: { state: ['boolean'] },
    callerPermissions: [{ name: '6c7e0e4a-1b2c-4d5e-8f90-a1b2c3d4e5f6:HomeControl' }] }]);
  const known = [
    { position: 0, category: 'muninn', item: 'stats', index: 0, property: 'daysRemaining' },
    { position: 1, category: 'weather', item: 'location', index: 0, property: 'temperature' },
    { position: 2, category: 'lights', item: 'room', index: 0, property: 'state' },
    { position: 3, category: 'calendar', item: 'event', index: 0, property: 'starts_at' },
    { position: 4, category: 'phone', item: 'find_my_phone', index: 0, property: 'ringing' }];
  assert.deepEqual(list.listOf([preferencesPlugin(), weather, lights, calendar, find], PERMS, 'own', known)[0]
    .complications, [
    { position: 0, property: 'daysRemaining', category: 'muninn', item: 'stats', why: '' },
    { position: 1, property: 'temperature', category: 'weather', item: 'location' },
    { position: 2, property: 'state', category: 'lights', item: 'room', onOff: true, why: reads.ANOTHER_APPS },
    { position: 3, property: 'starts_at', category: 'calendar', item: 'event', why: 'Calendar' },
    { position: 4, property: 'ringing', category: 'phone', item: 'find_my_phone', onOff: true, why: '' }],
  'no plugin on the phone serves the first; the lights need a permission of another app, which no uuid stands for; '
    + 'reading the last rings the phone; the index does not ride; the lights and the ringing are on or off');
  const other = plugin('o', 'Other lights', [{ category: 'lights', items: ['room'], properties: { state: ['shortText'] } }]);
  assert.equal(list.listOf([preferencesPlugin(), lights, other], PERMS, 'own', known)[0].complications[2].onOff, undefined,
    'on or off only as every plugin serving its source declares it');
  const long = { position: 0, category: 'c'.repeat(64), item: 'i'.repeat(64), index: 0, property: 'p'.repeat(64) };
  const asks = plugin('a', 'Asks', [{ category: long.category, items: [long.item], callerPermissions: ['A'.repeat(64)] }]);
  assert.deepEqual(list.listOf([preferencesPlugin(), asks], PERMS, 'own', [long])[0].complications, [{ position: 0,
    property: 'p'.repeat(31) + '\u2026', category: 'c'.repeat(31) + '\u2026', item: 'i'.repeat(31) + '\u2026',
    why: 'A'.repeat(31) + '\u2026' }],
  'each name capped as a plugin\'s is: the list rides the page\'s URL');
});

test('each plugin once', () => {
  assert.deepEqual(list.listOf([PHONE, Object.assign({}, PHONE, { name: 'Twin' })], PERMS, 'own').map((p) => p.name),
    ['Phone']);
});

test('the caps: 12 plugins, 24 values each, names of 32 characters', () => {
  const props = {};
  for (let i = 0; i < 30; i++) { props['v' + String(i).padStart(2, '0')] = ['shortText']; }
  const many = [];
  for (let i = 0; i < 15; i++) {
    many.push(i === 0 ? plugin('u0', 'A plugin with a long name, number 0', [{ category: 'c', items: ['i'], properties: props }])
      : plugin('u' + i, 'P' + i, [{ category: 'c', items: i === 1 ? ['i', 'j'] : ['i'], properties: { v: ['shortText'] } }]));
  }
  const listed = list.listOf(many, PERMS, 'own');
  assert.ok(many.reduce((sum, p) => sum + list.urlCost(list.listOf([p], PERMS, 'own')[0]), 0) <= list.LIST_COST,
    'all of them would cost the URL no more than it may');
  assert.equal(listed.length, 12);
  assert.deepEqual(listed[0].items.map((it) => it.properties.length), [24], 'the first 24, as declared');
  assert.equal(listed[0].items[0].properties[23], 'v23');
  assert.deepEqual(listed[1].items.map((it) => it.item), ['i', 'j']);
  assert.equal(listed[0].name.length, 32);
  assert.equal(listed[0].name, 'A plugin with a long name, numb\u2026');
});

test('an item no value id can hold takes none of the 24 values\' room', () => {
  const props = {};
  for (let i = 0; i < 20; i++) { props['v' + i] = ['shortText']; }
  const listed = list.listOf([plugin('u', 'U', [{ category: 'c', items: ['a/b', 'temp'], properties: props }])],
    PERMS, 'own');
  assert.deepEqual(listed[0].items.map((it) => [it.item, it.properties.length]), [['temp', 20]]);
});

test('a name is cut at a character\'s edge: a character outside the BMP stays whole', () => {
  const name = 'A'.repeat(30) + '\ud83d\ude00' + ' and more';
  assert.equal(list.listOf([plugin('u', name, PHONE.sources)], PERMS, 'own')[0].name,
    'A'.repeat(30) + '\ud83d\ude00\u2026');
});

test('the list costs the settings page\'s URL no more than LIST_COST characters: a plugin past that is left out', () => {
  const props = {};
  for (let i = 0; i < 24; i++) { props['a_long_property_name_number_' + i] = ['shortText']; }
  const big = (n) => plugin('big' + n, 'Big ' + n, [{ category: 'c', items: ['i'], properties: props }]);
  const small = plugin('small', 'Small', [{ category: 'c', items: ['i'], properties: { v: ['shortText'] } }]);
  const one = list.urlCost(list.listOf([big(0)], PERMS, 'own')[0]);
  const fit = Math.floor(list.LIST_COST / one);
  const plugins = [];
  for (let i = 0; i <= fit; i++) { plugins.push(big(i)); }
  plugins.push(small);
  const listed = list.listOf(plugins, PERMS, 'own');
  assert.deepEqual(listed.map((p) => p.name), plugins.slice(0, fit).map((p) => p.name).concat(['Small']),
    'the big one past the cost is left out; the small one after it still fits');
  assert.ok(listed.reduce((sum, p) => sum + list.urlCost(p), 0) <= list.LIST_COST);
  assert.equal(list.urlCost({ a: 'b c' }), encodeURIComponent('{"a":"b c"}').length);
});

test('a uuid or a value id longer than any real one is left out', () => {
  const name = 'p'.repeat(list.MAX_ID - 'c/i/'.length);
  const listed = list.listOf([plugin('u', 'U', [{ category: 'c', items: ['i'],
    properties: { [name]: ['shortText'], [name + 'q']: ['shortText'] } }]),
  plugin('u'.repeat(list.MAX_ID + 1), 'Long', [{ category: 'c', items: ['i'], properties: { v: ['shortText'] } }])],
  PERMS, 'own');
  assert.deepEqual(listed.map((p) => p.items[0].properties), [[name]]);
});

test('instancesKept: the Which row\'s instances, in the plugin\'s order, the first 16, each with an id a slot can pick and a name', () => {
  const one = (id, name) => ({ id: id, name: name });
  assert.deepEqual(list.instancesKept([one('k', 'Kitchen'), one('h', 'Hall')]), [one('k', 'Kitchen'), one('h', 'Hall')]);
  assert.deepEqual(list.instancesKept([one('', 'x'), one(5, 'x'), one('a', ''), null, one('i'.repeat(65), 'x'),
    one('\ud800', 'x'), one('i'.repeat(64), 'Long')]), [one('i'.repeat(64), 'Long')],
  'no id, no name, an id longer than 64, or one no key can hold');
  assert.equal(list.instancesKept(Array.from({ length: 20 }, (_, i) => one('r' + i, 'Room ' + i))).length,
    list.MAX_INSTANCES);
  assert.equal(list.instancesKept([one('l', 'L'.repeat(40))])[0].name, 'L'.repeat(31) + '\u2026',
    'a name cut to 32 characters');
  assert.equal(list.instancesKept([one('b', '\u{1F4A1}'.repeat(40))])[0].name, '\u{1F4A1}'.repeat(31) + '\u2026',
    'a character outside the BMP whole');
  const dear = Array.from({ length: 16 }, (_, i) => one(String(i).padStart(4, '0') + '\u{1F4A1}'.repeat(30),
    '\u{1F4A1}'.repeat(32)));
  const kept = list.instancesKept(dear);
  assert.ok(kept.length < 16, 'the cost cuts the list short');
  assert.ok(kept.reduce((sum, e) => sum + encodeURIComponent(JSON.stringify(e)).length, 0) <= list.MAX_INSTANCES_COST,
    'no more than MAX_INSTANCES_COST characters of the settings page\'s URL');
  assert.deepEqual(list.instancesKept(dear.slice(0, 3).concat([one('k', 'Kitchen')])).map((e) => e.id),
    [dear[0].id, dear[1].id, 'k'], 'one that would cost more is left out, the next cheaper one kept');
});

test('the list takes what enumeratePlugins hands over, whatever its shape', () => {
  [null, undefined, 5, 'x', {}].forEach((v) => assert.deepEqual(list.listOf(v, PERMS, 'own'), []));
  assert.deepEqual(list.listOf([null, {}, { uuid: '' }, { uuid: 'a/b', sources: PHONE.sources }, { uuid: 'n', sources: 'x' },
    { uuid: 'm', sources: [null, { category: 'c' }, { category: 'c', items: [5], properties: { v: ['shortText'] } },
      { category: 'c', items: 'i', properties: { v: ['shortText'] } },
      { category: 'c/d', items: ['i'], properties: { v: ['shortText'] } },
      { category: 'c', items: ['i/j', ''], properties: { v: ['shortText'] } },
      { category: 'c', items: ['i'], properties: { 'v/w': ['shortText'], '': ['shortText'] } },
      { category: 'c', items: ['i'], properties: { v: 'shortText', w: null } }] }], PERMS, 'own'), [],
  'shapes and items given as text, not as lists, are left out, as are names a value\'s id cannot hold');
  assert.equal(list.listOf([plugin('nameless', '', PHONE.sources)], PERMS, 'own')[0].name, 'nameless',
    'a plugin with no name goes by its uuid');
  assert.equal(list.listOf([plugin('x', ' Two\nlines ', PHONE.sources)], PERMS, 'own')[0].name, 'Two lines');
});
