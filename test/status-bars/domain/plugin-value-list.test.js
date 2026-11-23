'use strict';
// The plugins the Plugin value slot's dialog lists (plugin-value-list.js): what each plugin on
// the phone serves that the slot can show, written short (each item with its properties'
// names, from which the page makes the values; plugin-value-page.test.js) and capped, since the
// list rides the settings page's URL.
const test = require('node:test');
const assert = require('node:assert/strict');
const list = require('../../../src/pkjs/status-bars/domain/plugin-value-list.js');

const PERMS = ['Location', 'Internet', 'ShowNotifications', 'Health'];

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
      properties: ['battery_level', 'cell', 'wifi', 'charging'] }] }], 'a boolean alone is printed too: Yes or No');
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
