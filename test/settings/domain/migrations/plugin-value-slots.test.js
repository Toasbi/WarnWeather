'use strict';
// 3.5.0 gave each Plugin value slot a value of its own (migrations/status-slots.js
// movePluginValueIntoSlots): the one set of plugin, value, icon and Updates that every slot
// holding the item showed becomes each such slot's own, so each shows what it showed, and the
// set goes. An icon came before the value, which a slot's Look Icon + text draws.
const test = require('node:test');
const assert = require('node:assert/strict');
const statusSlots = require('../../../../src/pkjs/settings/domain/migrations/status-slots.js');
const registry = require('../../../../src/pkjs/settings/domain/migrations/registry.js');
const KEYS = require('../../../../src/pkjs/settings/domain/storage-keys.js');
const catalog = require('../../../../src/pkjs/status-bars/domain/status-line-catalog.js');
const statusLines = require('../../../../src/pkjs/status-bars/domain/status-lines.js');
const pluginValues = require('../../../../src/pkjs/status-bars/domain/plugin-values.js');

const move = statusSlots.movePluginValueIntoSlots;
const SHARED = { pluginValuePlugin: 'aaaaaaaa-0000-0000-0000-000000000001', pluginValueId: 'weather/now/level',
  pluginValueIcon: 'plug', pluginValueEvery: '30' };

/**
 * @param {string} slotKey A slot. @param {Object} set {plugin, id, look, icon, every}, any of them.
 * @returns {Object} The slot's own Plugin value settings holding that set.
 */
function own(slotKey, set) {
  const keys = catalog.pluginValueKeys(slotKey);
  return Object.keys(set).reduce((out, name) => {
    out[keys[name]] = set[name];
    return out;
  }, {});
}
const SET = { plugin: SHARED.pluginValuePlugin, id: SHARED.pluginValueId, look: 'both', icon: 'plug', every: '30' };

test.beforeEach((t) => { t.mock.method(console, 'log', () => {}); });

test('each slot holding the item takes the set, in any bar, and the set goes', () => {
  const blob = Object.assign({ statusTopLeft: 'pluginValue', statusTopMid: 'date', statusForecastRight: 'pluginValue',
    statusBar6Mid: 'pluginValue' }, SHARED);
  assert.deepEqual(move(blob), { changed: true, send: false });
  assert.deepEqual(blob, Object.assign({ statusTopLeft: 'pluginValue', statusTopMid: 'date',
    statusForecastRight: 'pluginValue', statusBar6Mid: 'pluginValue' }, own('statusTopLeft', SET),
  own('statusForecastRight', SET), own('statusBar6Mid', SET)));
});

test('a slot\'s own pick stays: a blob the new page saved before this boot', () => {
  const mine = { plugin: 'bbbbbbbb-0000-0000-0000-000000000002', id: 'muninn/stats/daysRemaining' };
  const blob = Object.assign({ statusTopLeft: 'pluginValue', statusTopRight: 'pluginValue' },
    own('statusTopLeft', mine), SHARED);
  move(blob);
  assert.deepEqual(blob, Object.assign({ statusTopLeft: 'pluginValue', statusTopRight: 'pluginValue' },
    own('statusTopLeft', Object.assign({}, mine, { look: 'both', icon: 'plug', every: '30' })), own('statusTopRight', SET)));
  const looks = Object.assign({ statusTopLeft: 'pluginValue', statusTopRight: 'pluginValue' },
    own('statusTopLeft', { look: 'icon', icon: 'wifi' }), own('statusTopRight', { look: 'text' }), SHARED);
  move(looks);
  assert.deepEqual([looks.statusTopLeftPluginValueLook, looks.statusTopLeftPluginValueIcon], ['icon', 'wifi'],
    'its own Look and icon');
  assert.deepEqual([looks.statusTopRightPluginValueLook, looks.statusTopRightPluginValueIcon], ['text', 'plug'],
    'its own Look, with the set\'s icon');
});

test('the set\'s icon None, the value alone, is the Text look a slot starts on; another icon comes before the text', () => {
  const blob = Object.assign({ statusTopLeft: 'pluginValue' }, SHARED, { pluginValueIcon: 'none' });
  move(blob);
  assert.deepEqual(blob, Object.assign({ statusTopLeft: 'pluginValue' }, own('statusTopLeft', { plugin: SET.plugin,
    id: SET.id, every: '30' })));
  const level = statusLines.wantedPluginValues(blob, { platform: 'basalt' })[0];
  assert.equal(pluginValues.iconId(level.pick, null), catalog.ICONS.PLUGIN_TEXT, 'the Text look: no icon drawn');
  const wifi = Object.assign({ statusTopLeft: 'pluginValue' }, SHARED, { pluginValueIcon: 'wifi' });
  move(wifi);
  assert.deepEqual([wifi.statusTopLeftPluginValueLook, wifi.statusTopLeftPluginValueIcon], ['both', 'wifi']);
});

test('only what the set holds is copied: a slot takes the defaults of the rest', () => {
  const blob = { statusTopLeft: 'pluginValue', pluginValuePlugin: SET.plugin, pluginValueId: SET.id };
  move(blob);
  assert.deepEqual(blob, Object.assign({ statusTopLeft: 'pluginValue' }, own('statusTopLeft', { plugin: SET.plugin,
    id: SET.id })));
});

test('where no slot holds the item the set goes too: a slot that takes it later starts on None', () => {
  const blob = Object.assign({ statusTopLeft: 'date' }, SHARED);
  assert.deepEqual(move(blob), { changed: true, send: false });
  assert.deepEqual(blob, { statusTopLeft: 'date' });
});

test('with no set it changes nothing, and it runs once more to no effect', () => {
  [{}, { statusTopLeft: 'pluginValue' }, Object.assign({ statusTopLeft: 'pluginValue' }, own('statusTopLeft', SET))]
    .forEach((stored) => {
      const blob = Object.assign({}, stored);
      assert.deepEqual(move(blob), { changed: false, send: false }, JSON.stringify(stored));
      assert.deepEqual(blob, stored);
    });
  const blob = Object.assign({ statusTopLeft: 'pluginValue' }, SHARED);
  move(blob);
  const once = Object.assign({}, blob);
  assert.deepEqual(move(blob), { changed: false, send: false });
  assert.deepEqual(blob, once);
});

test('a migrated install reads what it read: each slot asks for the set\'s source', () => {
  const blob = Object.assign({ statusTopLeft: 'pluginValue', statusTopRight: 'pluginValue' }, SHARED);
  move(blob);
  const wanted = statusLines.wantedPluginValues(blob, { platform: 'basalt' });
  assert.deepEqual(wanted.map((slot) => [slot.slotKey, slot.source.key, slot.pick.look, slot.pick.icon, slot.pick.every]), [
    ['statusTopLeft', SET.plugin + '/' + SET.id, 'both', 'plug', '30'],
    ['statusTopRight', SET.plugin + '/' + SET.id, 'both', 'plug', '30']]);
});

test('the ledger runs it last, marks it at once and counts it reset-safe', () => {
  const entry = registry[registry.length - 1];
  assert.equal(entry.key, KEYS.PLUGIN_VALUE_SLOTS_MIGRATION_KEY);
  assert.equal(entry.key, 'v3.5.0_plugin_value_slots_migration');
  assert.equal(entry.run, statusSlots.movePluginValueIntoSlots);
  assert.equal(entry.markOn, 'now');
  assert.equal(entry.markOnReset, true);
});
