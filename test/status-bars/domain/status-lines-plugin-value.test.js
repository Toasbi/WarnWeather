'use strict';
// The Plugin value slots in a bake: each slot's own value another app's plugin serves, its text
// (plugin-values.js textFor) on the text kind, after the icon its dialog picks (iconId), or with
// its own icon id, which loads no drawing. Offered only where the Pebble app reads plugins, and
// never on aplite.
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
const ID = 'phone/phone_state/battery_level';
const KEY = PHONE + '/' + ID;
const TOP = ['statusTopLeft', 'statusTopMid', 'statusTopRight'];

/**
 * The settings of a slot that holds the Plugin value and picks a value of it.
 * @param {string} slotKey The slot. @param {Object} [more] Its pick's other parts ({icon, every}),
 *   or another id.
 * @returns {Object} Settings.
 */
function slot(slotKey, more) {
  const keys = catalog.pluginValueKeys(slotKey);
  const out = { [slotKey]: 'pluginValue', [keys.plugin]: PHONE, [keys.id]: ID };
  Object.keys(more || {}).forEach((name) => { out[keys[name]] = more[name]; });
  return out;
}

/**
 * @param {Object} [more] Each slot's pick's other parts (slot's more).
 * @returns {Object} The slot in all three of the Watch bar's places, each picking the same value.
 */
function everywhere(more) {
  return Object.assign({}, ...TOP.map((key) => slot(key, more)));
}
const EVERYWHERE = everywhere();
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
 * Facts that hand out values by their source and note each source they are asked for.
 * @param {?Object} kept The value of every source (or null), or the values by source key.
 * @param {boolean} [available] Whether the Pebble app reads plugins (default true).
 * @returns {Object} The facts, with .asked (the sources' keys, in order).
 */
function facts(kept, available) {
  const f = { available: available !== false, asked: [] };
  const byKey = kept && !kept.reading ? kept : null;
  f.valueOf = (source) => {
    f.asked.push(source.key);
    return byKey ? byKey[source.key] || null : kept;
  };
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

test('the icon the Icon row picks, before the text in every place: one that turns in the form the value has', () => {
  const I = catalog.ICONS;
  const wifi = everywhere({ icon: 'wifi' });
  const icons = (settings, kept, now) => bakeTop(settings, facts(kept), BASALT, now).slots.map((s) => s.icon);
  assert.deepEqual(icons(wifi, value({ short: 'Home', state: true })), [I.PV_WIFI, I.PV_WIFI, I.PV_WIFI]);
  assert.deepEqual(icons(wifi, value({ short: 'Home', state: false })), [I.PV_WIFI_OFF, I.PV_WIFI_OFF, I.PV_WIFI_OFF]);
  assert.deepEqual(bakeTop(wifi, facts(value({ short: 'Home', state: true }))).slots[0],
    { kind: TEXT, icon: I.PV_WIFI, text: 'Home' }, 'on the text kind, its text as before');
  const later = new Date(NOW.getTime() + 13 * HOUR);
  assert.deepEqual(icons(wifi, value({ short: 'Home', state: true }), later), [I.PV_WIFI_OFF, I.PV_WIFI_OFF, I.PV_WIFI_OFF],
    'a value grown too old: off, beside --');
  assert.deepEqual(icons(wifi, null), [I.PV_WIFI_OFF, I.PV_WIFI_OFF, I.PV_WIFI_OFF], 'not read: off');
  const plug = everywhere({ icon: 'plug' });
  assert.deepEqual(icons(plug, value({ number: 87, unit: '%' })), [I.PV_PLUG, I.PV_PLUG, I.PV_PLUG]);
  assert.deepEqual(icons(plug, null), [I.PV_PLUG, I.PV_PLUG, I.PV_PLUG], 'one that stays the same, read or not');
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
    if (plugin) { assert.deepEqual(plugin.asked, [], why); }
  });
});

test('each slot shows its own value, and the icon its own dialog picks', () => {
  const I = catalog.ICONS;
  const CELL = PHONE + '/phone/phone_state/cell';
  const settings = Object.assign(slot('statusTopLeft', { icon: 'wifi' }), slot('statusTopRight', { id: 'phone/phone_state/cell' }),
    { statusTopMid: 'date' });
  const { slots } = bakeTop(settings, facts({ [KEY]: value({ short: 'Home', state: true }),
    [CELL]: value({ short: 'LTE' }, { source: CELL }) }));
  assert.deepEqual([slots[0], slots[2]], [{ kind: TEXT, icon: I.PV_WIFI, text: 'Home' }, { kind: TEXT, icon: ICON, text: 'LTE' }]);
});

test('a slot\'s value shows for that slot\'s own Updates: one value too old in one slot shows in another', () => {
  // Read 100 minutes ago: past three 30-minute Updates, within three hourly ones (three hours at least).
  const kept = value({ short: '87%' }, { at: NOW.getTime() - 100 * 60 * 1000 });
  const settings = Object.assign(slot('statusTopLeft', { every: '30' }), slot('statusTopRight', { every: '360' }),
    { statusTopMid: 'empty' });
  assert.deepEqual(bakeTop(settings, facts(kept)).slots.map((s) => s.text), ['87%', '', '87%'],
    'three hours at least, whatever the Updates');
  const older = value({ short: '87%' }, { at: NOW.getTime() - 4 * HOUR });
  assert.deepEqual(bakeTop(settings, facts(older)).slots.map((s) => s.text), ['--', '', '87%'],
    'past three hours: only the slot that updates every 6 hours shows it');
});

test('a slot without a source of its own shows --, beside one with', () => {
  const settings = Object.assign(slot('statusTopLeft'), { statusTopMid: 'empty', statusTopRight: 'pluginValue' });
  const f = facts(value({ short: '87%' }));
  assert.deepEqual(bakeTop(settings, f).slots.map((s) => s.text), ['87%', '', '--']);
  assert.deepEqual(f.asked, [KEY], 'nothing is asked for the slot without one');
});

test('the facts are asked for each slot it bakes, that slot\'s source, only when a bar it sends shows it', () => {
  const three = facts(value({ short: '87%' }));
  bakeTop(EVERYWHERE, three);
  assert.deepEqual(three.asked, [KEY, KEY, KEY], 'three places, each its own');
  const none = facts(value({ short: '87%' }));
  const unheld = slot('statusTopLeft');
  delete unheld.statusTopLeft;
  bakeTop(unheld, none);
  assert.deepEqual(none.asked, [], 'no slot holds it');
  const hidden = facts(value({ short: '87%' }));
  bakeTop(slot('statusHealthLeft'), hidden);
  assert.deepEqual(hidden.asked, [], 'a bar no screen shows is not baked');
});

test('wantedPluginValues: the slots of the bars the watch is sent that hold it with a source picked', () => {
  const wanted = (settings, watch) => statusLines.wantedPluginValues(settings, watch).map((s) => s.slotKey);
  assert.deepEqual(wanted(slot('statusTopLeft'), BASALT), ['statusTopLeft']);
  assert.deepEqual(wanted(slot('statusForecastMid'), BASALT), ['statusForecastMid']);
  const unheld = slot('statusTopLeft');
  delete unheld.statusTopLeft;
  assert.deepEqual(wanted(unheld, BASALT), [], 'no slot');
  assert.deepEqual(wanted(slot('statusHealthLeft'), BASALT), [], 'a bar no screen shows');
  assert.deepEqual(wanted(slot('statusTopLeft'), APLITE), []);
  assert.deepEqual(wanted(slot('statusTopLeft'), null), ['statusTopLeft'], 'an unknown watch may be one that shows it');
  assert.deepEqual(wanted({ statusTopLeft: 'pluginValue' }, BASALT), [],
    'no source picked: the slot shows --, and nothing is read for it');
  const two = statusLines.wantedPluginValues(Object.assign(slot('statusForecastLeft', { icon: 'plug' }),
    slot('statusTopRight', { id: 'phone/phone_state/cell' })), BASALT);
  assert.deepEqual(two.map((s) => [s.slotKey, s.source.key, s.pick.icon]),
    [['statusForecastLeft', KEY, 'plug'], ['statusTopRight', PHONE + '/phone/phone_state/cell', undefined]],
    'each with what it picks and its source, in the lines\' order');
});
