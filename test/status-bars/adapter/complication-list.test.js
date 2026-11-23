'use strict';
// The user's complications as the Pebble app's Preferences plugin serves them
// (complication-list.js): watched where the Plugin value slot is offered, kept in storage for
// the settings page and the next PKJS start. What a list holds is complications.test.js'.
const test = require('node:test');
const assert = require('node:assert/strict');
const { fakePebble } = require('../../helpers/plugin-host.js');

// AGENTS.md: a module that touches storage needs `global.localStorage` mocked BEFORE the
// watch modules load. One store object, emptied in place; `writes` lists each key written.
const storage = {};
const writes = [];
global.localStorage = {
  getItem(k) { return Object.prototype.hasOwnProperty.call(storage, k) ? storage[k] : null; },
  setItem(k, v) { writes.push(k); storage[k] = String(v); },
  removeItem(k) { writes.push(k); delete storage[k]; }
};

const complicationList = require('../../../src/pkjs/status-bars/adapter/complication-list.js');
const KEYS = require('../../../src/pkjs/settings/domain/storage-keys.js');

const logged = [];
const realLog = console.log;
test.before(() => { console.log = function () { logged.push(Array.prototype.join.call(arguments, ' ')); }; });
test.after(() => { console.log = realLog; });

const PREFS = '00000000-0000-0000-0001-000000000009';

/**
 * The Preferences plugin's answer.
 * @param {Array<Array>} places [instanceId, category, item, index, property] for each place.
 * @returns {Object} The envelope.
 */
function answer(places) {
  return { pluginUuid: PREFS, validUntilMs: null, instances: places.map(([id, category, item, index, property]) => ({
    instanceId: id, properties: { category: { shortText: { text: category } }, item: { shortText: { text: item } },
      index: { numericValue: { value: index } }, property: { shortText: { text: property } } } })) };
}

const TEMPERATURE = { position: 0, category: 'weather', item: 'location', index: 0, property: 'temperature' };
const BATTERY = { position: 1, category: 'phone', item: 'phone_state', index: 0, property: 'battery_level' };

/**
 * A PKJS start.
 * @param {Object} [opts] {pebble, offered (default true), keepStorage, onChange}.
 * @returns {Object} The fake Pebble.
 */
function boot(opts) {
  opts = opts || {};
  if (!opts.keepStorage) { Object.keys(storage).forEach((k) => { delete storage[k]; }); }
  writes.length = 0;
  const pebble = Object.prototype.hasOwnProperty.call(opts, 'pebble') ? opts.pebble : fakePebble();
  complicationList.init({ pebble: pebble, offered: opts.offered !== false, onChange: opts.onChange });
  return pebble;
}

test('watched where the slot is offered: the Preferences plugin, asked by name, for its complications', () => {
  const pebble = boot();
  assert.deepEqual(pebble.subs.map((s) => s.request), [{ category: 'preferences', item: 'complications', plugin: PREFS }]);
  assert.equal(complicationList.current(), null, 'none known before the first answer');
});

test('not watched where the slot is not offered, nor in a Pebble app without plugins', () => {
  assert.equal(boot({ offered: false }).subs.length, 0);
  [null, {}].forEach((pebble) => assert.doesNotThrow(() => boot({ pebble: pebble })));
});

test('each answer is the list as it is now, kept in storage when it changed', () => {
  const pebble = boot();
  pebble.subs[0].push(answer([['0', 'weather', 'location', 0, 'temperature']]));
  assert.deepEqual(complicationList.current(), [TEMPERATURE]);
  assert.deepEqual(JSON.parse(storage[KEYS.COMPLICATIONS]), [TEMPERATURE]);
  writes.length = 0;
  pebble.subs[0].push(answer([['0', 'weather', 'location', 0, 'temperature']]));
  assert.deepEqual(writes, [], 'the same list again: nothing written');
  pebble.subs[0].push(answer([['0', 'weather', 'location', 0, 'temperature'], ['1', 'phone', 'phone_state', 0,
    'battery_level']]));
  assert.deepEqual(complicationList.current(), [TEMPERATURE, BATTERY]);
  pebble.subs[0].push(answer([]));
  assert.deepEqual(complicationList.current(), [], 'every place emptied');
  assert.equal(storage[KEYS.COMPLICATIONS], '[]');
  assert.equal(pebble.subs[0].unsubscribed, 0, 'it stays watched');
});

test('an answer that changes the list says so, once the list is held: the slot reads its place again at once', () => {
  storage[KEYS.COMPLICATIONS] = JSON.stringify([BATTERY]);
  const seen = [];
  const pebble = boot({ keepStorage: true, onChange: () => seen.push(complicationList.current()) });
  assert.deepEqual(seen, [], 'not for the list kept: the slot\'s start reads it by itself');
  pebble.subs[0].push(answer([['1', 'phone', 'phone_state', 0, 'battery_level']]));
  assert.deepEqual(seen, [], 'not for the same list');
  pebble.subs[0].push(answer([['1', 'weather', 'location', 0, 'temperature']]));
  assert.deepEqual(seen, [[Object.assign({}, TEMPERATURE, { position: 1 })]], 'the new list, held as it is told');
  pebble.subs[0].fail('TIMEOUT');
  assert.equal(seen.length, 1, 'a failure that keeps the list');
  pebble.subs[0].fail('PLUGIN_UNAVAILABLE');
  assert.deepEqual(seen.slice(1), [null], 'nor any known now');
});

test('a start has the list kept as it starts, before the first answer, checked', () => {
  storage[KEYS.COMPLICATIONS] = JSON.stringify([BATTERY, { position: 'x' }]);
  boot({ keepStorage: true });
  assert.deepEqual(complicationList.current(), [BATTERY]);
  storage[KEYS.COMPLICATIONS] = '{not json';
  boot({ keepStorage: true });
  assert.equal(complicationList.current(), null, 'unreadable: none known');
  storage[KEYS.COMPLICATIONS] = JSON.stringify([BATTERY]);
  boot({ keepStorage: true, offered: false });
  assert.deepEqual(complicationList.current(), [BATTERY], 'kept where the slot is not offered as well');
});

test('a Pebble app without the source drops the list; any other failure keeps it', () => {
  storage[KEYS.COMPLICATIONS] = JSON.stringify([BATTERY]);
  const pebble = boot({ keepStorage: true });
  pebble.subs[0].fail('TIMEOUT');
  assert.deepEqual(complicationList.current(), [BATTERY]);
  pebble.subs[0].fail('PLUGIN_UNAVAILABLE');
  assert.equal(complicationList.current(), null);
  assert.equal(storage[KEYS.COMPLICATIONS], undefined);
});

test('a start ends the last start\'s subscription', () => {
  const first = boot();
  boot();
  assert.equal(first.subs[0].unsubscribed, 1);
});

test('the list is never logged, only how long it is', () => {
  const pebble = boot();
  logged.length = 0;
  pebble.subs[0].push(answer([['0', 'weather', 'location', 0, 'temperature']]));
  pebble.subs[0].fail('PLUGIN_UNAVAILABLE');
  assert.ok(logged.length > 0);
  assert.deepEqual(logged.filter((line) => /weather|temperature|location/.test(line)), []);
});
