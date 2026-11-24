'use strict';
// The Plugin value slot in a bake: the text of the value another app's plugin serves
// (plugin-values.js textFor) on the text kind with its own icon id, which loads no drawing.
// Offered only where the Pebble app reads plugins, and never on aplite.
const test = require('node:test');
const assert = require('node:assert/strict');
const statusLines = require('../../../src/pkjs/status-bars/domain/status-lines.js');
const catalog = require('../../../src/pkjs/status-bars/domain/status-line-catalog.js');
const { decodeLine } = require('../../helpers/status-line-bytes.js');
const { reading } = require('../../helpers/plugin-host.js');

const NOW = new Date(2026, 10, 21, 12, 0, 0);
const HOUR = 60 * 60 * 1000;
const BASALT = { platform: 'basalt' };
const APLITE = { platform: 'aplite' };
const PHONE = '00000000-0000-0000-0001-000000000001';
const SOURCE = { pluginValuePlugin: PHONE, pluginValueId: 'phone/phone_state/battery_level' };
const KEY = PHONE + '/phone/phone_state/battery_level';
/** The slot in all three of the Watch bar's places. */
const EVERYWHERE = Object.assign({ statusTopLeft: 'pluginValue', statusTopMid: 'pluginValue',
  statusTopRight: 'pluginValue' }, SOURCE);
const TEXT = catalog.KINDS.TEXT;
const ICON = catalog.ICONS.PLUGIN_TEXT;

/** A payload the bake can read every slot from. */
function payload() {
  return { CITY: 'Bonn', CURRENT_TEMP: 68, FEELS_CURRENT: 66, SUN_EVENTS: [1, 0, 0, 0, 0] };
}

/**
 * A value as plugin-value-source.js keeps it.
 * @param {Object} fields Its reading's fields that are set.
 * @param {Object} [extra] Its other fields (source, at, validUntil).
 * @returns {Object} The value.
 */
function value(fields, extra) {
  return Object.assign({ source: KEY, reading: reading(fields), at: NOW.getTime() - 10 * 60 * 1000, validUntil: null },
    extra || {});
}

/**
 * Facts that hand out one value and count how often they are asked.
 * @param {?Object} kept The value (or null).
 * @param {boolean} [available] Whether the Pebble app reads plugins (default true).
 * @returns {Object} The facts, with .reads.
 */
function facts(kept, available) {
  const f = { available: available !== false, reads: 0 };
  f.value = () => { f.reads += 1; return kept; };
  return f;
}

/**
 * Bake the Watch bar's line (STATUS_LINE_3_UINT8) and decode it.
 * @param {Object} settings Settings.
 * @param {?Object} plugin The Plugin value slot's facts (or null).
 * @param {Object} [watchInfo] The watch (basalt by default).
 * @param {Date} [now] The instant the bake is for (NOW by default).
 * @returns {{bytes: number[], slots: Object[]}}
 */
function bakeTop(settings, plugin, watchInfo, now) {
  const p = statusLines.buildStatusLines(payload(), settings, watchInfo || BASALT, now || NOW, { plugin: plugin });
  return { bytes: p.STATUS_LINE_3_UINT8, slots: decodeLine(p.STATUS_LINE_3_UINT8) };
}

test('the value on the text kind, with the icon id that loads no drawing, in every place of a bar', () => {
  const { slots } = bakeTop(EVERYWHERE, facts(value({ short: '87%', number: 87, unit: '%' })));
  assert.deepEqual(slots, [{ kind: TEXT, icon: ICON, text: '87%' }, { kind: TEXT, icon: ICON, text: '87%' },
    { kind: TEXT, icon: ICON, text: '87%' }]);
});

test('each place prints the value at its own room: a unit an edge has no room for is left off there', () => {
  const { slots } = bakeTop(EVERYWHERE, facts(value({ number: 12345, unit: 'kWh' })));
  assert.deepEqual(slots.map((s) => s.text), ['12345', '12345 kWh', '12345']);
});

test('a moment prints as a clock time in the user\'s format, as the sun slot prints sunrise', () => {
  const at = new Date(2026, 10, 21, 13, 40, 0).getTime();
  assert.deepEqual(bakeTop(EVERYWHERE, facts(value({ time: at, number: at }))).slots.map((s) => s.text),
    ['13:40', '13:40', '13:40']);
  assert.deepEqual(bakeTop(Object.assign({ axisTimeFormat: '12h', timeShowAmPm: true }, EVERYWHERE),
    facts(value({ time: at }))).slots.map((s) => s.text), ['1:40p', '1:40p', '1:40p']);
});

test('a moment on another day than the bake\'s carries its date: after its time in the middle, alone at the edges', () => {
  // Years from the clock the tests run by, so only the bake's own instant can make its day today.
  const baked = new Date(2030, 2, 14, 12, 0, 0);
  const read = { at: baked.getTime() - 10 * 60 * 1000 };
  const today = new Date(2030, 2, 14, 9, 5, 0).getTime();
  const tomorrow = new Date(2030, 2, 15, 9, 5, 0).getTime();
  assert.deepEqual(bakeTop(EVERYWHERE, facts(value({ time: today }, read)), BASALT, baked).slots
    .map((s) => s.text), ['9:05', '9:05', '9:05']);
  assert.deepEqual(bakeTop(EVERYWHERE, facts(value({ time: tomorrow }, read)), BASALT, baked).slots
    .map((s) => s.text), ['15 Mar', '9:05 15 Mar', '15 Mar']);
  assert.deepEqual(bakeTop(Object.assign({ axisTimeFormat: '12h', timeShowAmPm: true }, EVERYWHERE),
    facts(value({ time: tomorrow }, read)), BASALT, baked).slots.map((s) => s.text),
  ['15 Mar', '9:05a 15 Mar', '15 Mar']);
});

test('a state prints on or off', () => {
  assert.deepEqual(bakeTop(EVERYWHERE, facts(value({ state: false }))).slots.map((s) => s.text), ['off', 'off', 'off']);
});

test('a long text is cut to each place\'s bytes', () => {
  const { bytes, slots } = bakeTop(EVERYWHERE, facts(value({ long: 'Next: design review with the whole team' })));
  assert.deepEqual(slots.map((s) => s.text), ['Next: de', 'Next: design review', 'Next: de']);
  assert.ok(bytes.length <= catalog.CAPS.LINE_MAX, bytes.length + ' bytes');
});

test('-- for no value, another source\'s, one too old, and one with nothing to print', () => {
  [null, value({ short: '87%' }, { source: PHONE + '/phone/phone_state/cell' }),
    value({ short: '87%' }, { at: NOW.getTime() - 3 * HOUR }), value({})].forEach((kept) => {
    const { slots } = bakeTop(EVERYWHERE, facts(kept));
    assert.deepEqual(slots[0], { kind: TEXT, icon: ICON, text: '--' }, JSON.stringify(kept));
  });
  const { slots } = bakeTop(EVERYWHERE, facts(value({ short: '87%' }, { at: NOW.getTime() - 3 * HOUR + 1 })));
  assert.equal(slots[0].text, '87%', 'one just young enough');
});

test('where the Pebble app reads no plugins, and on aplite, the slot is empty and the value never read', () => {
  const empty = { kind: catalog.KINDS.EMPTY, icon: catalog.ICONS.NONE, text: '' };
  [[null, BASALT, 'no facts'], [facts(value({ short: '87%' }), false), BASALT, 'no plugins'],
    [facts(value({ short: '87%' })), APLITE, 'aplite']].forEach(([plugin, watch, why]) => {
    const { slots } = bakeTop(EVERYWHERE, plugin, watch);
    assert.deepEqual(slots[0], empty, why);
    if (plugin) { assert.equal(plugin.reads, 0, why); }
  });
});

test('the value is read once per bake, and only when a bar it sends shows the slot', () => {
  const both = facts(value({ short: '87%' }));
  bakeTop(EVERYWHERE, both);
  assert.equal(both.reads, 1, 'three places, one read');
  const none = facts(value({ short: '87%' }));
  bakeTop(SOURCE, none);
  assert.equal(none.reads, 0, 'no slot holds it');
  const hidden = facts(value({ short: '87%' }));
  bakeTop(Object.assign({ statusHealthLeft: 'pluginValue' }, SOURCE), hidden);
  assert.equal(hidden.reads, 0, 'a bar no screen shows is not baked');
});

test('wantsPluginValue: a source is picked, and a slot of a bar the watch is sent holds it', () => {
  assert.equal(statusLines.wantsPluginValue(Object.assign({ statusTopLeft: 'pluginValue' }, SOURCE), BASALT), true);
  assert.equal(statusLines.wantsPluginValue(Object.assign({ statusForecastMid: 'pluginValue' }, SOURCE), BASALT), true);
  assert.equal(statusLines.wantsPluginValue(SOURCE, BASALT), false, 'no slot');
  assert.equal(statusLines.wantsPluginValue(Object.assign({ statusHealthLeft: 'pluginValue' }, SOURCE), BASALT), false,
    'a bar no screen shows');
  assert.equal(statusLines.wantsPluginValue(Object.assign({ statusTopLeft: 'pluginValue' }, SOURCE), APLITE), false);
  assert.equal(statusLines.wantsPluginValue(Object.assign({ statusTopLeft: 'pluginValue' }, SOURCE), null), true,
    'an unknown watch may be one that shows it');
  assert.equal(statusLines.wantsPluginValue({ statusTopLeft: 'pluginValue' }, BASALT), false,
    'no source picked: the slot shows --, and nothing is read for it');
});
