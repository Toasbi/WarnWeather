'use strict';
// The user's complications (complications.js): as the Pebble app's Preferences plugin serves
// them, as storage keeps them, why this app may not read one, and the read of the reading one
// names. Watching the list is complication-list.test.js'; listing it in the Plugin value slot's
// dialog, plugin-value-list.test.js'; reading the reading, plugin-value-source.test.js'.
const test = require('node:test');
const assert = require('node:assert/strict');
const complications = require('../../../src/pkjs/status-bars/domain/complications.js');

const PERMS = ['Location', 'Internet/api.met.no', 'ShowNotifications', 'Health'];

/**
 * One place of the Preferences plugin's answer, as the Pebble app sends it.
 * @param {string} instanceId The place.
 * @param {string} category The reading's source: its category. @param {string} item Its item.
 * @param {number} index Which instance. @param {string} property Which property.
 * @returns {Object} The instance.
 */
function place(instanceId, category, item, index, property) {
  return { instanceId: instanceId, properties: { category: { shortText: { text: category } },
    item: { shortText: { text: item } }, index: { numericValue: { value: index } },
    property: { shortText: { text: property } } } };
}

/** The Pebble app's own five, with the first empty: its defaults, moved down one. */
const ANSWER = { pluginUuid: '00000000-0000-0000-0001-000000000009', validUntilMs: null, instances: [
  place('1', 'weather', 'location', 0, 'temperature'), place('2', 'phone', 'phone_state', 0, 'battery_level'),
  place('3', 'calendar', 'event', 0, 'starts_at'), place('4', 'weather', 'location', 1, 'condition')] };

const LIST = [
  { position: 1, category: 'weather', item: 'location', index: 0, property: 'temperature' },
  { position: 2, category: 'phone', item: 'phone_state', index: 0, property: 'battery_level' },
  { position: 3, category: 'calendar', item: 'event', index: 0, property: 'starts_at' },
  { position: 4, category: 'weather', item: 'location', index: 1, property: 'condition' }];

/** The plugins the reading's sources come from, as Pebble.enumeratePlugins() lists them. */
const PLUGINS = [
  { uuid: 'w', name: 'Weather', sources: [{ category: 'weather', items: ['location'], callerPermissions: ['Location'] }] },
  { uuid: 'p', name: 'Phone', sources: [{ category: 'phone', items: ['phone_state'] }] },
  { uuid: 'c', name: 'Calendar', sources: [{ category: 'calendar', items: ['event'], callerPermissions: ['Calendar'] }] }];

test('listOf: one complication for each place the answer holds, in the order of the places', () => {
  assert.deepEqual(complications.listOf(ANSWER), LIST);
  assert.deepEqual(complications.listOf({ instances: ANSWER.instances.slice().reverse() }), LIST, 'whatever order they come in');
  assert.deepEqual(complications.listOf({ instances: [] }), [], 'every place empty');
  [null, undefined, {}, { instances: 'x' }].forEach((e) => assert.deepEqual(complications.listOf(e), [], JSON.stringify(e)));
});

test('listOf: a place that names no reading this app can read by its name is none', () => {
  const one = (inst) => complications.listOf({ instances: [inst] });
  const good = place('0', 'weather', 'location', 0, 'temperature');
  assert.equal(one(good).length, 1);
  [['a place past the five', place('5', 'weather', 'location', 0, 'temperature')],
    ['a place that is no number', place('x', 'weather', 'location', 0, 'temperature')],
    ['two digits', place('01', 'weather', 'location', 0, 'temperature')],
    ['an id that is a number', Object.assign({}, good, { instanceId: 0 })],
    ['no properties', { instanceId: '0' }],
    ['a name with a slash', place('0', 'weather/x', 'location', 0, 'temperature')],
    ['an empty name', place('0', 'weather', '', 0, 'temperature')],
    ['a name longer than any real one', place('0', 'weather', 'location', 0, 'p'.repeat(65))],
    ['an index that is no whole number', place('0', 'weather', 'location', 0.5, 'temperature')],
    ['a negative index', place('0', 'weather', 'location', -1, 'temperature')],
    ['an index past 99', place('0', 'weather', 'location', 100, 'temperature')],
    ['a reading of the Preferences plugin itself: its weather locations\' coordinates',
      place('0', 'preferences', 'weather_location', 0, 'latitude')]]
    .forEach(([why, inst]) => assert.deepEqual(one(inst), [], why));
  assert.equal(one(place('0', 'weather', 'location', 99, 'p'.repeat(64))).length, 1, 'the longest kept');
  assert.deepEqual(complications.listOf({ instances: [good, place('0', 'phone', 'phone_state', 0, 'cell')] })
    .map((c) => c.category), ['weather'], 'a place once: the first');
});

test('storedListOf: a list as stored, checked as an answer is; none for anything else', () => {
  assert.deepEqual(complications.storedListOf(JSON.parse(JSON.stringify(LIST))), LIST);
  assert.deepEqual(complications.storedListOf([]), []);
  assert.deepEqual(complications.storedListOf([LIST[0], null, { position: 9 }, Object.assign({}, LIST[1], { index: '0' })]),
    [LIST[0]]);
  [null, undefined, {}, 'x', 5].forEach((v) => assert.equal(complications.storedListOf(v), null, JSON.stringify(v)));
});

test('atPlace: the complication at a place, none for an empty one', () => {
  assert.deepEqual(complications.atPlace(LIST, 2), LIST[1]);
  assert.equal(complications.atPlace(LIST, 0), null);
  assert.equal(complications.atPlace(null, 1), null);
});

test('whyNot: none where this app may read the reading; else the permission it needs, or \'\'', () => {
  assert.equal(complications.whyNot(LIST[0], PLUGINS, PERMS), null, 'the weather: Location, which this app declares');
  assert.equal(complications.whyNot(LIST[1], PLUGINS, PERMS), null, 'the phone: none');
  assert.equal(complications.whyNot(LIST[2], PLUGINS, PERMS), 'Calendar');
  assert.equal(complications.whyNot(LIST[0], PLUGINS.concat([{ uuid: 'w2', sources: [{ category: 'weather',
    items: ['location'], callerPermissions: ['Contacts'] }] }]), PERMS), 'Contacts',
  'another plugin that serves it may be the one the Pebble app picks');
  assert.equal(complications.whyNot(LIST[0], [], PERMS), '', 'no plugin on the phone serves it');
  assert.equal(complications.whyNot({ position: 0, category: 'phone', item: 'find_my_phone', index: 0,
    property: 'ringing' }, [{ uuid: 'f', sources: [{ category: 'phone', items: ['find_my_phone'] }] }], PERMS), '',
  'reading it rings the phone');
});

test('requestOf: the reading\'s source, for its property, in the instance it names; no plugin named, this app\'s permissions', () => {
  assert.deepEqual(complications.requestOf(LIST[3], PERMS), { category: 'weather', item: 'location',
    properties: ['condition'], limit: 2, instance: 1, permissions: PERMS });
  assert.equal(complications.requestOf(LIST[0], PERMS).limit, 1);
});

test('keyOf: the reading, its property last', () => {
  assert.equal(complications.keyOf(LIST[3]), 'weather/location/1/condition');
});
