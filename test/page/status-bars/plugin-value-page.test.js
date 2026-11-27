// test/page/status-bars/plugin-value-page.test.js — the Plugin value slots' dialogs on the
// settings page, one per slot: the Plugin, Value, Look and Icon rows' lists (the plugins the phone
// listed as the page opened, userData.plugins), their hints, the Icon row's pictures, the line
// with the value read last (userData.pluginValues), the rows' changes, the Edit button that opens
// a slot's dialog, what a save stores, the slot reset and the bars' pictures.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
require('../../../src/pkjs/config-ui/lib/schema-walk.js');
require('../../../src/pkjs/lib/color.js');
require('../../../src/pkjs/config-ui/lib/show-when.js');
require('../../../src/pkjs/config-ui/lib/engine.js');
require('../../../src/pkjs/page/settings/blocks.js');
const page = require('../../../src/pkjs/page/status-bars/plugin-value-page.js');
const schema = require('../../../src/pkjs/page/settings/schema.js');
const catalog = require('../../../src/pkjs/status-bars/domain/status-line-catalog.js');
const platform = require('../../../src/pkjs/config-ui/lib/platform.js');
const { sample, barSlots } = require('../../../src/pkjs/page/status-bars/preview-status-bars.js');
const PixelIcon = require('../../../src/pkjs/page/weather/pixel-icon.js');
const pluginReads = require('../../../src/pkjs/status-bars/domain/plugin-reads.js');
const { pluginValuePick } = require('../../helpers/status-slots.js');
const { PREFERENCES, PICK_DEFAULTS } = require('../../../src/pkjs/status-bars/domain/plugin-values.js');
const { reading } = require('../../helpers/plugin-host.js');

const PConf = global.PConf;
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const NOW = Date.UTC(2026, 10, 23, 12, 0, 0);
const BASALT = Object.assign(platform.computeEnv({ platform: 'basalt' }), { plugins: true });
const PHONE = '00000000-0000-0000-0001-000000000001';
const MUNINN = 'd008a08a-6e34-4cc4-98dc-bae02ce5e087';
/** What the phone lists (plugin-value-list.js listOf). */
const PLUGINS = [
  { uuid: PHONE, name: 'Phone', items: [
    { category: 'phone', item: 'phone_state', multiple: false, properties: ['battery_level', 'cell'] }] },
  { uuid: MUNINN, name: 'Muninn', items: [
    { category: 'muninn', item: 'stats', multiple: false, properties: ['daysRemaining'] },
    { category: 'muninn', item: 'estimate', multiple: true, properties: ['batteryLife'] }] }];
/** The slot whose dialog the tests open, unless one names another: the Watch bar's left. */
const SLOT = 'statusTopLeft';
const KEYS = catalog.pluginValueKeys(SLOT);
/** A pick's parts, in the catalog's order, and what each is on where the slot starts. */
const PARTS = Object.keys(KEYS);
const PARTS_AT_START = ['', '', 'text', 'switch', '', '60'];
/** The Phone plugin's Wi-Fi, a value that is on or off, with the Switch beside its text. */
const WIFI_BOTH = { plugin: PHONE, id: 'phone/phone_state/wifi', look: 'both', icon: 'switch' };

/**
 * Settings that pick for a slot.
 * @param {Object} pick {plugin, id, look, icon, label, every}, any of them (plugin-values.js pickOf).
 * @param {string} [slotKey] The slot (SLOT).
 * @returns {Object} The slot's Plugin value settings holding that pick.
 */
function pickIn(pick, slotKey = SLOT) {
  return pluginValuePick(slotKey, pick);
}
const LEVEL = pickIn({ plugin: PHONE, id: 'phone/phone_state/battery_level' });
const LEVEL_KEY = PHONE + '/phone/phone_state/battery_level';

/**
 * A resolver of a slot's dialog as the engine calls it: (S, env, the dialog's args).
 * @param {Function} fn The resolver (plugin-value-page.js).
 * @returns {function(Object, string=): *} It over settings, for SLOT or the slot given.
 */
const inSlot = (fn) => (S, slotKey = SLOT) => fn(S, BASALT, { slotKey: slotKey });
const pluginOptions = inSlot(page.pluginOptions);
const valueOptions = inSlot(page.valueOptions);
const pluginHint = inSlot(page.pluginHint);
const valueHint = inSlot(page.valueHint);
const lastLine = inSlot(page.lastLine);
const fromMuninn = inSlot(page.fromMuninn);
const iconOptions = inSlot(page.iconOptions);
const iconHint = inSlot(page.iconHint);
const labelShown = inSlot(page.labelShown);

/**
 * @param {string} key A settings key.
 * @returns {?Object} The one row of the schema that writes it.
 */
function rowOf(key) {
  let found = null;
  PConf.schemaWalk.eachItem(schema, (it) => { if (it.messageKey === key) { found = it; } });
  return found;
}

/**
 * A row's change, as the engine runs it (engine.js runOnChange): its hooks with the row's key
 * and its onChangeArgs, which name its slot.
 * @param {Object} S Settings (mutated). @param {string} key The row's key.
 * @param {*} oldV The value before. @param {*} newV The value now.
 * @returns {void}
 */
function changed(S, key, oldV, newV) {
  const row = rowOf(key);
  [].concat(row.onChange).forEach((id) => PConf.onChange.get(id)(S, oldV, newV, BASALT, key, row.onChangeArgs || {}));
}

/**
 * The Plugin row's change, as the engine runs it.
 * @param {Object} S Settings (mutated). @param {string} oldV The plugin before.
 * @param {string} newV The plugin now. @param {string} [slotKey] The slot (SLOT).
 * @returns {void}
 */
const picked = (S, oldV, newV, slotKey = SLOT) => changed(S, catalog.pluginValueKeys(slotKey).plugin, oldV, newV);

/**
 * The Value row's change, as the engine runs it.
 * @param {Object} S Settings (mutated). @param {string} [slotKey] The slot (SLOT).
 * @returns {void}
 */
const valuePicked = (S, slotKey = SLOT) =>
  changed(S, catalog.pluginValueKeys(slotKey).id, null, S[catalog.pluginValueKeys(slotKey).id]);

/**
 * The Look row's change to a Look, as the engine runs it: it stores the Look, then runs the hooks.
 * @param {Object} S Settings (mutated). @param {string} look The Look picked.
 * @param {string} [slotKey] The slot (SLOT).
 * @returns {void}
 */
const lookPicked = (S, look, slotKey = SLOT) => {
  const key = catalog.pluginValueKeys(slotKey).look;
  const before = S[key];
  S[key] = look;
  changed(S, key, before, look);
};

/**
 * The phone's userData for one test, the way the page reads it (INJECTED_USERDATA).
 * @param {Object} t The test context (its after hook clears it).
 * @param {Object} data userData.
 * @returns {void}
 */
function userData(t, data) {
  global.INJECTED_USERDATA = data;
  t.after(() => { delete global.INJECTED_USERDATA; });
}

/**
 * The page's clock, for one test.
 * @param {Object} t The test context.
 * @param {number} ms Now.
 * @returns {void}
 */
function clock(t, ms) {
  t.mock.method(Date, 'now', () => ms);
}

/**
 * A value as the phone hands it (plugin-value-source.js forPage).
 * @param {Object} fields Its reading's set fields.
 * @param {Object} [extra] Its other fields.
 * @returns {Object} The value.
 */
function kept(fields, extra) {
  return Object.assign({ source: LEVEL_KEY, reading: reading(fields), at: NOW - 5 * MIN, validUntil: null },
    extra || {});
}

/**
 * userData.pluginValues as the phone hands it: each value under the key of the source a slot
 * shows (plugin-value-source.js forPage), its own source's but for a complication's.
 * @param {Object} value A value (kept). @param {string} [key] The source's key (its own).
 * @returns {Object} The map.
 */
const handed = (value, key = value.source) => ({ [key]: value });

test('the Plugin row lists None, then each plugin the phone listed', (t) => {
  userData(t, { plugins: PLUGINS });
  assert.deepEqual(pluginOptions({}), [['None', ''], ['Phone', PHONE], ['Muninn', MUNINN]]);
  assert.deepEqual(pluginOptions(LEVEL), [['None', ''], ['Phone', PHONE], ['Muninn', MUNINN]]);
});

test('a plugin the settings hold that the phone no longer lists stays, said as such', (t) => {
  userData(t, { plugins: PLUGINS });
  assert.deepEqual(pluginOptions(pickIn({ plugin: 'gone' })).slice(-1), [['Not on this phone', 'gone']]);
  assert.equal(pluginHint(pickIn({ plugin: 'gone' })),
    'This plugin is not on this phone. Until it is, the slot shows --.');
});

test('a phone that lists no plugin: None alone, and the hint says why', (t) => {
  [{}, { plugins: [] }, { plugins: 'x' }, null].forEach((data) => {
    global.INJECTED_USERDATA = data;
    assert.deepEqual(pluginOptions({}), [['None', '']], JSON.stringify(data));
    assert.equal(pluginHint({}), 'No app on this phone offers a value this slot can show.');
  });
  delete global.INJECTED_USERDATA;
  userData(t, { plugins: PLUGINS });
  assert.equal(pluginHint(LEVEL), null, 'a listed plugin needs no words');
});

test('a property\'s name made readable, after its item\'s where the plugin serves more than one', () => {
  [['battery_level', 'Battery level'], ['daysRemaining', 'Days remaining'], ['UVIndex', 'UV index'],
    ['uv_index', 'Uv index'], ['5G', '5G'], ['mobile_data', 'Mobile data'], ['HTTPStatus', 'HTTP status'],
    ['wifi', 'Wifi'], ['a-b c', 'A b c'], ['location: uv_index', 'Location: uv index'], ['a: UVIndex', 'A: UV index'],
    ['stats: daysRemaining', 'Stats: days remaining']].forEach(([name, label]) => assert.equal(page.labelOf(name), label, name));
});

test('the Value row lists the picked plugin\'s values, and keeps one it no longer offers under its name', (t) => {
  userData(t, { plugins: PLUGINS });
  assert.deepEqual(valueOptions(LEVEL), [['Battery level', 'phone/phone_state/battery_level'],
    ['Cell', 'phone/phone_state/cell']]);
  assert.deepEqual(valueOptions(pickIn({ plugin: MUNINN, id: 'muninn/stats/daysRemaining' })),
    [['Stats: days remaining', 'muninn/stats/daysRemaining'], ['Estimate: battery life', 'muninn/estimate/batteryLife']],
    'a plugin that serves more than one item: each value after its item');
  const old = pickIn({ plugin: PHONE, id: 'phone/phone_state/wifi_name' });
  assert.deepEqual(valueOptions(old).slice(-1),
    [['Wifi name', 'phone/phone_state/wifi_name', { desc: 'Not offered now' }]]);
  assert.equal(valueHint(old), 'The plugin no longer offers this value. Until it does, the slot shows --.');
  const gone = pickIn({ plugin: 'gone', id: 'muninn/stats/daysRemaining' });
  assert.deepEqual(valueOptions(gone), [['Days remaining', 'muninn/stats/daysRemaining', { desc: 'Not offered now' }]],
    'a plugin not on this phone: its value, under its name');
  assert.equal(valueHint(gone), null, 'the Plugin row says it');
  assert.deepEqual(valueOptions({}), [], 'None: no values');
});

test('the Value row says when the plugin offers the value for more than one thing', (t) => {
  userData(t, { plugins: PLUGINS });
  assert.equal(valueHint(pickIn({ plugin: MUNINN, id: 'muninn/estimate/batteryLife' })),
    'The plugin offers this for more than one thing. The slot shows the first.');
  assert.equal(valueHint(pickIn({ plugin: MUNINN, id: 'muninn/stats/daysRemaining' })), null);
});

test('a new plugin starts on its first value; None on none', (t) => {
  userData(t, { plugins: PLUGINS });
  const S = Object.assign({}, LEVEL, { [KEYS.id]: 'phone/phone_state/cell' });
  picked(S, PHONE, PHONE);
  assert.equal(S[KEYS.id], 'phone/phone_state/cell', 'the same plugin keeps its value');
  picked(S, PHONE, MUNINN);
  assert.equal(S[KEYS.id], 'muninn/stats/daysRemaining');
  picked(S, MUNINN, '');
  assert.equal(S[KEYS.id], '');
  picked(S, '', 'gone');
  assert.equal(S[KEYS.id], '', 'a plugin the phone does not list');
});

test('the last line: the value read last, as a middle slot prints it, and how long ago', (t) => {
  clock(t, NOW);
  userData(t, { plugins: PLUGINS, pluginValues: handed(kept({ short: '87%', number: 87, unit: '%' })) });
  assert.equal(lastLine(LEVEL), '87% (5 min ago).');
  global.INJECTED_USERDATA.pluginValues = handed(kept({ number: 12345, unit: 'kWh' }));
  assert.equal(lastLine(LEVEL), '12345 kWh (5 min ago).', 'the middle slot has room for the unit');
  global.INJECTED_USERDATA.pluginValues = handed(kept({ short: '<b>87</b>' }));
  assert.equal(lastLine(LEVEL), '&lt;b&gt;87&lt;/b&gt; (5 min ago).', 'another app\'s text, escaped');
});

/**
 * @param {number} days Days after NOW's, here.
 * @returns {Date} 13:40 here on that day.
 */
function twentyTo2(days) {
  const today = new Date(NOW);
  return new Date(today.getFullYear(), today.getMonth(), today.getDate() + days, 13, 40, 0);
}

test('the last line and the bars\' pictures print a moment as the watch does: a clock time in the user\'s format', (t) => {
  clock(t, NOW);
  const at = twentyTo2(0).getTime();
  userData(t, { plugins: PLUGINS, pluginValues: handed(kept({ time: at, number: at })) });
  const S = Object.assign({ [SLOT]: 'pluginValue', axisTimeFormat: '12h', timeShowAmPm: true }, LEVEL);
  assert.equal(lastLine(S), '1:40p (5 min ago).');
  assert.equal(sample('pluginValue', S, { cap: catalog.CAPS.EDGE_TEXT_MAX, env: BASALT, slotKey: SLOT }), '1:40p');
  assert.equal(lastLine(LEVEL), '13:40 (5 min ago).', '24 hours');
  global.INJECTED_USERDATA.pluginValues = handed(kept({ state: true }));
  assert.equal(lastLine(LEVEL), 'on (5 min ago).');
});

test('the last line and the bars\' pictures print a moment on another day with its date, as the watch does', (t) => {
  clock(t, NOW);
  const tomorrow = twentyTo2(1);
  const date = tomorrow.getDate() + ' Nov';
  userData(t, { plugins: PLUGINS, pluginValues: handed(kept({ time: tomorrow.getTime() })) });
  const S = Object.assign({ [SLOT]: 'pluginValue' }, LEVEL);
  assert.equal(lastLine(S), '13:40 ' + date + ' (5 min ago).');
  assert.equal(sample('pluginValue', S, { cap: catalog.CAPS.MID_TEXT_MAX, env: BASALT, slotKey: SLOT }), '13:40 ' + date);
  assert.equal(sample('pluginValue', S, { cap: catalog.CAPS.EDGE_TEXT_MAX, env: BASALT, slotKey: SLOT }), date,
    'an edge has no room for both');
});

test('the last line: a value too old to show says what the watch shows instead', (t) => {
  clock(t, NOW);
  userData(t, { plugins: PLUGINS, pluginValues: handed(kept({ short: '87%' }, { at: NOW - 4 * HOUR })) });
  assert.equal(lastLine(LEVEL),
    '87% (4 h ago). It is too old to show, so the watch shows -- until a new one comes in.');
});

test('the last line: nothing read yet for the source the rows pick, and nothing while none is picked', (t) => {
  clock(t, NOW);
  userData(t, { plugins: PLUGINS, pluginValues: handed(kept({ short: '87%' })) });
  const NOTHING = 'None yet. When you pick a value and save, the watch shows it within about a minute.';
  assert.equal(lastLine(Object.assign({}, LEVEL, { [KEYS.id]: 'phone/phone_state/cell' })), NOTHING,
    'another value\'s');
  global.INJECTED_USERDATA.pluginValues = handed(kept({ short: '87%' }, { source: PHONE + '/phone/phone_state/cell' }),
    LEVEL_KEY);
  assert.equal(lastLine(LEVEL), NOTHING, 'a value of another source, under the source the rows pick');
  global.INJECTED_USERDATA.pluginValues = {};
  assert.equal(lastLine(LEVEL), NOTHING);
  global.INJECTED_USERDATA.pluginValues = null;
  assert.equal(lastLine(LEVEL), NOTHING);
  assert.equal(lastLine({}), '');
});

test('the bars\' pictures print the value read last at each slot\'s room, else --', (t) => {
  clock(t, NOW);
  userData(t, { plugins: PLUGINS, pluginValues: handed(kept({ number: 12345, unit: 'kWh' })) });
  const S = Object.assign({ [SLOT]: 'pluginValue' }, LEVEL);
  assert.equal(sample('pluginValue', S, { cap: catalog.CAPS.EDGE_TEXT_MAX, env: BASALT, slotKey: SLOT }), '12345');
  assert.equal(sample('pluginValue', S, { cap: catalog.CAPS.MID_TEXT_MAX, env: BASALT, slotKey: SLOT }), '12345 kWh');
  assert.equal(page.barText(Object.assign({}, S, { [KEYS.id]: 'phone/phone_state/cell' }), 19, SLOT), '--',
    'another value\'s');
  global.INJECTED_USERDATA.pluginValues = handed(kept({ short: '87%' }, { at: NOW - 3 * HOUR }));
  assert.equal(page.barText(S, 19, SLOT), '--', 'too old for the watch to show');
  global.INJECTED_USERDATA = {};
  assert.equal(page.barText(S, 19, SLOT), '--', 'none read');
});

// --- the user's complications ---------------------------------------------------

/**
 * What the phone lists: Preferences among the plugins, with the user's complications.
 * @param {*} list Its complications (plugin-value-list.js complicationsFor).
 * @returns {Array<Object>} The plugins.
 */
const withPrefs = (list) => PLUGINS.concat([{ uuid: PREFERENCES, name: 'Preferences', items: [], complications: list }]);
const COMPLICATIONS = [
  { position: 0, property: 'temperature', category: 'weather' },
  { position: 1, property: 'battery_level', category: 'phone' },
  { position: 2, property: 'starts_at', category: 'calendar', why: 'Calendar' },
  { position: 3, property: 'daysRemaining', category: 'muninn' },
  { position: 4, property: 'ringing', category: 'phone', why: '' }];
const PLACE = (n) => pickIn({ plugin: PREFERENCES, id: 'preferences/complications/' + n });

test('the Preferences plugin is listed as Complications, right after None, wherever the phone lists it', (t) => {
  userData(t, { plugins: withPrefs(COMPLICATIONS) });
  const COMPLICATIONS_ENTRY = ['Complications', PREFERENCES, { desc: 'Your picks in the Pebble app' }];
  assert.deepEqual(pluginOptions({}),
    [['None', ''], COMPLICATIONS_ENTRY, ['Phone', PHONE], ['Muninn', MUNINN]]);
  assert.deepEqual(pluginOptions(PLACE(0)), [['None', ''], COMPLICATIONS_ENTRY, ['Phone', PHONE],
    ['Muninn', MUNINN]], 'picked');
  global.INJECTED_USERDATA.plugins = withPrefs(COMPLICATIONS).reverse();
  assert.deepEqual(pluginOptions({}),
    [['None', ''], COMPLICATIONS_ENTRY, ['Muninn', MUNINN], ['Phone', PHONE]], 'the others in the phone\'s order');
});

test('its values are the complications by their places, each by what it shows, none of the plumbing', (t) => {
  userData(t, { plugins: withPrefs(COMPLICATIONS) });
  assert.deepEqual(valueOptions(PLACE(0)), [
    ['1 · Temperature (weather)', 'preferences/complications/0'],
    ['2 · Battery level (phone)', 'preferences/complications/1'],
    ['3 · Starts at (calendar)', 'preferences/complications/2', { disabled: true,
      desc: 'Needs the Calendar permission, which WarnWeather never asks for' }],
    ['4 · Days remaining (muninn)', 'preferences/complications/3'],
    ['5 · Ringing (phone)', 'preferences/complications/4', { disabled: true,
      desc: 'WarnWeather cannot read it here' }]]);
  assert.deepEqual(valueOptions(PLACE(1)).map((o) => o[1]), valueOptions(PLACE(0)).map((o) => o[1]),
    'the same list, whichever is picked');
  global.INJECTED_USERDATA.plugins = withPrefs([{ position: 1, property: 'battery_level', category: 'phone' }]);
  assert.deepEqual(valueOptions(PLACE(1)), [['2 · Battery level (phone)', 'preferences/complications/1']],
    'an empty place is not listed: the others keep their numbers');
  assert.deepEqual(valueOptions(PLACE(3)), [['2 · Battery level (phone)', 'preferences/complications/1'],
    ['4 · Empty', 'preferences/complications/3']], 'one the settings hold where the place is empty now');
  global.INJECTED_USERDATA.plugins = withPrefs([{ position: 0, property: 'hourly_UV_index', category: 'smartHome' }]);
  assert.equal(valueOptions(PLACE(0))[0][0], '1 · Hourly UV index (smart home)', 'names made readable');
  global.INJECTED_USERDATA.plugins = withPrefs([{ position: 0, property: 'state', category: 'lights',
    why: 'ReadWatchSettings' }]);
  assert.equal(valueOptions(PLACE(0))[0][2].desc, 'Needs the Read watch settings permission, which WarnWeather '
    + 'never asks for');
  global.INJECTED_USERDATA.plugins = withPrefs([{ position: 0, property: 'state', category: 'lights',
    why: pluginReads.ANOTHER_APPS }]);
  assert.equal(valueOptions(PLACE(0))[0][2].desc, 'Needs a permission of another app',
    'one another app\'s plugin defines: WarnWeather can never declare it');
  global.INJECTED_USERDATA.plugins = withPrefs([{ position: 0, property: 'level', category: 'tides', why: 'Internet' }]);
  assert.equal(valueOptions(PLACE(0))[0][2].desc, 'Needs internet access WarnWeather doesn\'t have',
    'WarnWeather asks for Internet, for its own sites only');
  [[], null, undefined, 'x'].forEach((list) => {
    global.INJECTED_USERDATA.plugins = withPrefs(list);
    assert.deepEqual(valueOptions(PLACE(0)), [['1 · Empty', 'preferences/complications/0']], String(list));
  });
});

test('the Value row\'s hint says where the complications are set, that the slot follows the one picked, '
  + 'and why it shows -- where it does', (t) => {
  userData(t, { plugins: withPrefs(COMPLICATIONS) });
  const hint = 'Your complications in the Pebble app (Settings › Plugins › Complications). The slot '
    + 'follows the one you pick when you change it there.';
  [PLACE(0), PLACE(3), pickIn({ plugin: PREFERENCES, id: '' })].forEach((S) =>
    assert.equal(valueHint(S), hint, S[KEYS.id]));
  assert.equal(valueHint(PLACE(2)), hint + ' Needs the Calendar permission, which WarnWeather never asks for, '
    + 'so the slot shows --.', 'one it may not read: the place\'s complication changed in the Pebble app since');
  assert.equal(valueHint(PLACE(4)), hint + ' WarnWeather cannot read it here, so the slot shows --.');
  assert.equal(valueHint(PLACE(9)), hint + ' This place is empty there, so the slot shows --.');
  global.INJECTED_USERDATA.plugins = withPrefs([]);
  assert.equal(valueHint(PLACE(0)), hint + ' This place is empty there, so the slot shows --.', 'none set up');
  assert.equal(valueHint(pickIn({ plugin: PREFERENCES, id: '' })), hint, 'none set up, none picked');
  global.INJECTED_USERDATA.plugins = withPrefs([{ position: 0, property: 'p', category: 'c', why: '<b>' }]);
  assert.equal(valueHint(PLACE(0)), hint + ' Needs the &lt;b&gt; permission, which WarnWeather never asks for, '
    + 'so the slot shows --.', 'another app\'s words, escaped: the hint is HTML');
});

test('a pick of the Preferences plugin\'s own reading, which 3.4.0 listed, is a value the plugin no longer offers', (t) => {
  userData(t, { plugins: withPrefs(COMPLICATIONS) });
  const S = pickIn({ plugin: PREFERENCES, id: 'preferences/weather_location/latitude' });
  assert.equal(valueHint(S), 'The plugin no longer offers this value. Until it does, the slot shows --.');
  assert.deepEqual(valueOptions(S).slice(-1),
    [['Latitude', 'preferences/weather_location/latitude', { desc: 'Not offered now' }]]);
});

test('picking Preferences starts on the first complication WarnWeather can read', (t) => {
  userData(t, { plugins: withPrefs(COMPLICATIONS.slice(2)) });
  const S = Object.assign({}, LEVEL);
  picked(S, PHONE, PREFERENCES);
  assert.equal(S[KEYS.id], 'preferences/complications/3', 'the calendar one is passed over');
  global.INJECTED_USERDATA.plugins = withPrefs([COMPLICATIONS[2]]);
  picked(S, PHONE, PREFERENCES);
  assert.equal(S[KEYS.id], '', 'none it can read');
  global.INJECTED_USERDATA.plugins = withPrefs([]);
  picked(S, PHONE, PREFERENCES);
  assert.equal(S[KEYS.id], '', 'none known');
});

test('Preferences picked where no complication can be read: the Value row holds None, never one greyed out', (t) => {
  userData(t, { plugins: withPrefs([COMPLICATIONS[2], COMPLICATIONS[4]]) });
  const S = slotSettings(LEVEL);
  S[KEYS.plugin] = PREFERENCES;
  picked(S, PHONE, PREFERENCES);
  assert.deepEqual(valueOptions(S).map((o) => o[1]), ['', 'preferences/complications/2',
    'preferences/complications/4'], 'None first');
  dialogHtml(S);
  assert.equal(S[KEYS.id], '', 'drawn, the row keeps None');
  PConf.engine.snapShownOptions(schema, S, BASALT);
  assert.equal(S[KEYS.id], '', 'and so does the snap of every shown row, which Save stores');
  global.INJECTED_USERDATA.plugins = withPrefs(COMPLICATIONS);
  dialogHtml(S);
  assert.equal(S[KEYS.id], '', 'None stays while one can be read now: the user picks it');
  assert.deepEqual(valueOptions(Object.assign({}, S, { [KEYS.id]: 'preferences/complications/0' }))[0],
    ['1 \u00b7 Temperature (weather)', 'preferences/complications/0'], 'no None once one is picked');
});

test('the last line and the bars\' pictures show the value the phone hands for a complication\'s place, by the place', (t) => {
  // The phone hands the page a complication's value only while its place names the reading it
  // was read from (plugin-value-source.js forPage), so the page judges it by the place alone.
  clock(t, NOW);
  userData(t, { plugins: withPrefs(COMPLICATIONS), pluginValues: handed(kept({ short: '21°' },
    { source: PREFERENCES + '/preferences/complications/0/weather/location/0/temperature' }),
  PREFERENCES + '/preferences/complications/0') });
  const S = Object.assign({ [SLOT]: 'pluginValue' }, PLACE(0));
  assert.equal(lastLine(S), '21° (5 min ago).');
  assert.equal(page.barText(S, 8, SLOT), '21°');
  assert.equal(page.barText(PLACE(1), 8, SLOT), '--', 'another place\'s');
  assert.equal(lastLine(PLACE(1)), 'None yet. When you pick a value and save, the watch shows it within about a minute.');
});

test('the Edit button opens each slot\'s own dialog, in every bar, not on aplite', () => {
  const resolve = PConf.sheetResolvers.get('statusSlotEditSheet');
  const sheets = new Set();
  catalog.everySlotKey().forEach((slotKey) => {
    const S = { [slotKey]: 'pluginValue' };
    const sheet = resolve(S, { thresholds: true }, { messageKey: slotKey });
    assert.equal(sheet, catalog.pluginValueSheet(slotKey), slotKey);
    const dialog = schema.tabs.find((tab) => tab.id === 'watch').sections.find((sec) => sec.sheetId === sheet);
    assert.ok(dialog, slotKey + ': its dialog is in the schema');
    assert.ok(dialog.items.some((it) => it.messageKey === catalog.pluginValueKeys(slotKey).plugin),
      slotKey + ': its Plugin row is the slot\'s');
    sheets.add(sheet);
    assert.equal(resolve(S, { thresholds: false }, { messageKey: slotKey }), null, slotKey + ' on aplite');
  });
  assert.equal(sheets.size, 21, 'a dialog of its own for each slot');
  assert.equal(catalog.pluginValueSheet('statusTopRight'), 'threshPluginValueTopRight');
});

test('the Edit button\'s B lights on every Plugin value slot while the item prints bold, but in the Icon look', () => {
  const badge = PConf.badgeResolvers.get('thresholdPenState');
  const env = { thresholds: true };
  const state = (S, slotKey) => badge(Object.assign({ [slotKey]: 'pluginValue' }, S), env, { messageKey: slotKey });
  ['statusTopLeft', 'statusBar6Right'].forEach((slotKey) => {
    const look = catalog.pluginValueKeys(slotKey).look;
    assert.equal(state({}, slotKey).bold, false, slotKey + ': Off by default');
    assert.equal(state({ threshPluginValueBoldMode: 'always' }, slotKey).bold, true, slotKey + ': Always');
    assert.equal(state({ statusBoldAll: 'all' }, slotKey).bold, true, slotKey + ': the master All');
    assert.equal(state({ statusBoldAll: 'off', threshPluginValueBoldMode: 'always' }, slotKey).bold, false,
      slotKey + ': the master Off');
    assert.equal(state({ threshPluginValueBoldMode: 'always', [look]: 'both' }, slotKey).bold, true,
      slotKey + ': Icon + text prints its text');
    assert.equal(state({ threshPluginValueBoldMode: 'always', [look]: 'icon' }, slotKey), null,
      slotKey + ': the icon alone has no text to print bold');
  });
  assert.equal(state({ threshPluginValueBoldMode: 'always', statusTopRightPluginValueLook: 'icon' }, 'statusTopLeft').bold,
    true, 'another slot\'s Look');
  assert.equal(badge({ statusTopLeft: 'pluginValue' }, { thresholds: false }, { messageKey: 'statusTopLeft' }), null,
    'aplite badges nothing');
});

/**
 * Settings with a Plugin value in the Watch bar's left slot, hydrated as the page holds them.
 * @param {Object} [over] Settings over the slot's.
 * @returns {Object} The settings.
 */
function slotSettings(over) {
  return PConf.engine.hydrate(schema, Object.assign({ [SLOT]: 'pluginValue' }, over), BASALT);
}

/**
 * A slot's Plugin value dialog as the engine draws it open over these settings.
 * @param {Object} state Settings (slotSettings).
 * @param {string} [slotKey] The slot whose dialog it is (SLOT).
 * @returns {string} The dialog's HTML.
 */
function dialogHtml(state, slotKey = SLOT) {
  return PConf.engine.renderEditModal(schema, { S: state, ENV: BASALT, USERDATA: {}, openColor: null,
    openSelect: null, openEdit: catalog.pluginValueSheet(slotKey), selectQuery: '', collapsed: {},
    evalCtx: Object.assign({}, state, { env: BASALT }) });
}

/**
 * @param {string} html A dialog's HTML. @param {string[]} texts What it shows, in its order.
 * @returns {void}
 */
function inOrder(html, texts) {
  let at = 0;
  texts.forEach((text) => {
    assert.ok(html.indexOf(text, at) !== -1, 'the dialog shows ' + text + ', in its place');
    at = html.indexOf(text, at);
  });
}

test('the dialog: Plugin with its list, then Value, Look, Updates, the last line and Bold once one is picked', (t) => {
  clock(t, NOW);
  userData(t, { plugins: PLUGINS, pluginValues: handed(kept({ short: '87%' })) });
  const S = slotSettings(LEVEL);
  assert.equal(S[KEYS.every], '60', 'every hour by default');
  assert.equal(S[KEYS.look], 'text', 'the text alone by default');
  assert.equal(S[KEYS.icon], 'switch', 'the Switch for a Look with an icon');
  const html = dialogHtml(S);
  inOrder(html, ['Plugin value slot', 'Plugin', 'Phone', 'Value', 'Battery level', 'Look', 'Icon + text',
    '>Text<', '>Icon<', 'Updates', 'Every hour', 'Last value', 'Bold', 'For every Plugin value slot.']);
  assert.ok(html.indexOf('data-k="' + KEYS.look + '" data-v="text"') !== -1, 'the Look picks the slot\'s own');
  assert.equal(html.indexOf('data-select="' + KEYS.icon + '"'), -1, 'no Icon row in the Text look');
  assert.ok(html.indexOf('<div class="lbl">Last value</div><div class="hint">87% (5 min ago).</div>') !== -1,
    'the last value is a row like the others: its label, the value in the hint\'s grey under it');
  assert.ok(html.indexOf('data-k="threshPluginValueBoldMode"') !== -1, 'Bold sets the item\'s one mode');
  const both = dialogHtml(slotSettings(Object.assign(pickIn({ look: 'both', icon: 'plug' }), LEVEL)));
  inOrder(both, ['Look', 'Icon + text', 'data-select="' + KEYS.icon + '"', 'Plug', 'Updates', 'Last value', 'Bold']);
  const alone = dialogHtml(slotSettings(Object.assign(pickIn({ look: 'icon', icon: 'switch' }), LEVEL)));
  inOrder(alone, ['Look', 'data-select="' + KEYS.icon + '"', 'Switch', 'Updates', 'Last value']);
  assert.equal(alone.indexOf('data-k="threshPluginValueBoldMode"'), -1, 'no Bold in the Icon look: it prints no text');
  const empty = dialogHtml(slotSettings());
  ['Value', 'Look', 'Icon', 'Updates', 'Last value', 'Bold'].forEach((text) =>
    assert.equal(empty.indexOf('>' + text + '<'), -1, 'no ' + text + ' while no plugin is picked'));
});

test('Muninn picked: a note above the Plugin row says the Watch battery slot shows its estimate by itself', (t) => {
  userData(t, { plugins: PLUGINS });
  assert.equal(fromMuninn(pickIn({ plugin: MUNINN })), true, 'a plugin serving Muninn\'s category');
  assert.equal(fromMuninn(LEVEL), false, 'the Phone plugin');
  assert.equal(fromMuninn({}), false, 'none picked');
  assert.equal(fromMuninn(pickIn({ plugin: 'gone' })), false, 'one the phone no longer lists');
  assert.equal(fromMuninn(pickIn({ plugin: MUNINN }, 'statusTopRight')), false, 'another slot\'s pick');
  const muninn = dialogHtml(slotSettings(pickIn({ plugin: MUNINN, id: 'muninn/stats/daysRemaining' })));
  const at = muninn.indexOf('<div class="card info"><div class="cardHdr"><span class="ttlwrap"><span class="ttl">Days left from Muninn</span>');
  assert.ok(at !== -1, 'a card of its own in the info look');
  const text = muninn.indexOf('The Watch battery slot can show Muninn\'s estimate by itself');
  assert.ok(text > at, 'with what to do');
  const rows = muninn.indexOf('data-select="' + KEYS.plugin + '"');
  assert.ok(rows > text, 'above the Plugin row');
  assert.ok(muninn.slice(text, rows).indexOf('<div class="card nohdr">') !== -1, 'which is in a plain card of its own');
  [dialogHtml(slotSettings(LEVEL)), dialogHtml(slotSettings())].forEach((html, i) => {
    assert.equal(html.indexOf('card info'), -1, i ? 'none while no plugin is picked' : 'none for another plugin');
    assert.ok(html.indexOf('<div class="card nohdr"><div><div class="row') !== -1, 'the rows\' card opens the dialog');
  });
});

test('a plugin the phone no longer lists is not swapped for another as the dialog draws', (t) => {
  userData(t, { plugins: PLUGINS });
  const S = slotSettings(pickIn({ plugin: 'gone', id: 'gone/item/value' }));
  dialogHtml(S);
  assert.deepEqual([S[KEYS.plugin], S[KEYS.id]], ['gone', 'gone/item/value']);
});

/**
 * @param {string} key A settings key.
 * @returns {*} Its default as the page's actions get it (engine.js defaultAsStored): the one row
 *   that writes it, its default for basalt.
 */
function defaultOf(key) {
  const found = rowOf(key);
  return found ? PConf.engine.storedDefault(found, BASALT) : undefined;
}

test('Reset status bars puts each slot\'s Plugin value source, Look, icon, label and Updates back', () => {
  const S = Object.assign(pickIn({ every: '360', look: 'both', icon: 'wifi', label: 'Lamp' }), LEVEL,
    pickIn({ plugin: MUNINN, id: 'muninn/stats/daysRemaining', look: 'icon', icon: 'plug', every: '15' },
      'statusHealthRight'));
  PConf.actions.resetStatusSlots(null, S, BASALT, defaultOf);
  ['statusTopLeft', 'statusHealthRight'].forEach((slotKey) => {
    const keys = catalog.pluginValueKeys(slotKey);
    assert.deepEqual(PARTS.map((name) => S[keys[name]]), PARTS_AT_START, slotKey);
  });
  assert.deepEqual(PARTS.map((name) => defaultOf(KEYS[name])), PARTS.map((name) => PICK_DEFAULTS[name]),
    'what plugin-values.js reads for none');
});

test('Reset status bars puts bars 4 to 6 back too, the bars staying with their names', () => {
  const EMERY = Object.assign(platform.computeEnv({ platform: 'emery' }), { plugins: true, phoneBattery: true });
  const S = Object.assign({ statusBar4Made: true, statusBar4Name: 'Garden', statusBar4Left: 'phoneBattery',
    statusBar4LeftPhoneBatteryLook: 'text', statusBar4Mid: 'pluginValue', statusBar6Right: 'countdown',
    statusBar6RightCountdown: '2026-12-24' },
  pickIn({ plugin: MUNINN, id: 'muninn/stats/daysRemaining', look: 'icon', icon: 'plug', label: 'Lamp', every: '15' },
    'statusBar4Mid'));
  PConf.actions.resetStatusSlots(null, S, EMERY, defaultOf);
  // Every slot's item and phone battery Look: config-thresholds.test.js, battery-slots.test.js.
  const keys = catalog.pluginValueKeys('statusBar4Mid');
  assert.deepEqual(PARTS.map((name) => S[keys[name]]), PARTS_AT_START, 'the Plugin value\'s');
  assert.equal(S.statusBar4Made, true, 'the bar stays on its screens');
  assert.equal(S.statusBar4Name, 'Garden', 'with its name');
  assert.equal(S.statusBar6RightCountdown, '2026-12-24', 'a countdown date stays, as in the other bars');
});

test('a save stores a slot\'s picks alone: never a row\'s default, and nothing of a slot without one', () => {
  const S = slotSettings(LEVEL);
  const stored = (state) => PConf.engine.serialize(schema, state, BASALT);
  const keys = catalog.everySlotKey().reduce((all, slotKey) => all.concat(catalog.pluginValueKeyList(slotKey)), []);
  assert.equal(keys.length, 126, 'six for each of the 21 slots');
  keys.forEach((key) => assert.ok(key in S, key + ': the page holds every row\'s value'));
  const blob = stored(S);
  assert.deepEqual(keys.filter((key) => key in blob), [KEYS.plugin, KEYS.id], 'the slot\'s plugin and value');
  S[KEYS.look] = 'both';
  S[KEYS.icon] = 'wifi';
  S[KEYS.label] = 'Lamp';
  S[KEYS.every] = '15';
  assert.deepEqual(keys.filter((key) => key in stored(S)),
    [KEYS.plugin, KEYS.id, KEYS.look, KEYS.icon, KEYS.label, KEYS.every], 'a Look, an icon, a label and Updates picked are stored');
  S[KEYS.look] = 'text';
  S[KEYS.icon] = 'switch';
  S[KEYS.label] = '';
  S[KEYS.every] = '60';
  assert.deepEqual(keys.filter((key) => key in stored(S)), [KEYS.plugin, KEYS.id], 'and go once they are the defaults again');
});

// --- the icon --------------------------------------------------------------------

/** The Phone plugin as the phone lists it with Wi-Fi, which is on or off (plugin-value-list.js onOff). */
const WITH_WIFI = [{ uuid: PHONE, name: 'Phone', items: [{ category: 'phone', item: 'phone_state', multiple: false,
  properties: ['battery_level', 'wifi'], onOff: 2 }] }].concat(PLUGINS.slice(1));
const WIFI = pickIn({ plugin: PHONE, id: 'phone/phone_state/wifi' });
const WIFI_KEY = PHONE + '/phone/phone_state/wifi';
const TURNS = ['switch', 'wifi', 'bluetooth'];

/**
 * @param {Array<Array>} options An Icon row's list.
 * @returns {string[]} The icons greyed out in it.
 */
const greyed = (options) => options.filter((o) => o[2] && o[2].disabled && !o[2].groupHeader).map((o) => o[1]);

const TURNING_OPTIONS = [
  ['Turns with a value that is on or off', '__hdr_turns', { disabled: true, groupHeader: true }],
  ['Switch', 'switch', { groupChild: true, groupEnd: false }],
  ['Wi-Fi', 'wifi', { groupChild: true, groupEnd: false }],
  ['Bluetooth', 'bluetooth', { groupChild: true, groupEnd: true }]];

test('the Icon row lists the icons that turn, then those that stay the same; the Icon look, those that turn', (t) => {
  userData(t, { plugins: WITH_WIFI });
  assert.deepEqual(iconOptions(Object.assign(pickIn({ look: 'both' }), WIFI)), TURNING_OPTIONS.concat([
    ['Always the same', '__hdr_same', { disabled: true, groupHeader: true }],
    ['Plug', 'plug', { groupChild: true, groupEnd: false }],
    ['Phone', 'phone', { groupChild: true, groupEnd: false }],
    ['Calendar', 'calendar', { groupChild: true, groupEnd: true }]]));
  assert.deepEqual(iconOptions(Object.assign(pickIn({ look: 'icon' }), WIFI)), TURNING_OPTIONS,
    'alone, an icon that stays the same would show nothing of the value');
});

test('the icons that turn are greyed out for a value that is neither on nor off, but the one the settings hold', (t) => {
  userData(t, { plugins: WITH_WIFI.concat([{ uuid: PREFERENCES, name: 'Preferences', items: [], complications: [
    { position: 0, property: 'wifi', category: 'phone', onOff: true },
    { position: 1, property: 'battery_level', category: 'phone' }] }]) });
  const plug = pickIn({ look: 'both', icon: 'plug' });
  const level = Object.assign({}, plug, LEVEL);
  assert.deepEqual(greyed(iconOptions(level)), TURNS, 'a number: such an icon would stay off');
  assert.deepEqual(greyed(iconOptions(Object.assign({}, level, { [KEYS.icon]: 'wifi' }))), ['switch', 'bluetooth'],
    'the one the settings hold stays pickable');
  assert.deepEqual(greyed(iconOptions(Object.assign({}, level, { [KEYS.icon]: undefined }))), ['wifi', 'bluetooth'],
    'the Switch a slot starts on is the one it holds');
  assert.deepEqual(greyed(iconOptions(Object.assign({}, plug, WIFI))), [], 'Wi-Fi is on or off');
  assert.deepEqual(greyed(iconOptions(Object.assign({}, plug, pickIn({ plugin: PHONE, id: 'phone/phone_state/gone' })))),
    [], 'a value the phone no longer lists: not known, so nothing is held back');
  assert.deepEqual(greyed(iconOptions(Object.assign({}, plug, PLACE(0)))), [], 'a complication that is on or off');
  assert.deepEqual(greyed(iconOptions(Object.assign({}, plug, PLACE(1)))), TURNS, 'one that is neither');
});

test('the Icon row\'s hint says how an icon that turns follows the value; none for the rest', (t) => {
  userData(t, { plugins: WITH_WIFI });
  assert.equal(iconHint(Object.assign(pickIn({ icon: 'wifi' }), WIFI)), 'On while the value is on, off while it is off.');
  assert.equal(iconHint(Object.assign(pickIn({ icon: 'switch' }), LEVEL)),
    'This value is neither on nor off, so the icon stays off.');
  ['plug', 'phone', 'calendar'].forEach((icon) =>
    assert.equal(iconHint(Object.assign(pickIn({ icon: icon }), WIFI)), null, icon));
  assert.equal(iconHint(WIFI), 'On while the value is on, off while it is off.', 'the Switch, as a slot starts');
});

test('the Look row greys out Icon for a value that is neither on nor off, and its hint says why', (t) => {
  userData(t, { plugins: WITH_WIFI.concat([{ uuid: PREFERENCES, name: 'Preferences', items: [], complications: [
    { position: 0, property: 'wifi', category: 'phone', onOff: true },
    { position: 1, property: 'battery_level', category: 'phone' }] }]) });
  const neither = (S) => PConf.whenResolvers.get('pluginValueNeither')(S, BASALT, { slotKey: SLOT });
  const hint = (S) => PConf.hintResolvers.get('pluginValueLookHint')(S, BASALT, { slotKey: SLOT });
  [[LEVEL, true], [WIFI, false], [PLACE(0), false], [PLACE(1), true],
    [pickIn({ plugin: PHONE, id: 'phone/phone_state/gone' }), false], [{}, false]].forEach(([S, is], i) => {
    assert.equal(neither(S), is, 'case ' + i);
    assert.equal(hint(S), is ? 'The Icon look is for a value that is on or off.' : null, 'case ' + i);
  });
  const html = dialogHtml(slotSettings(LEVEL));
  assert.ok(html.indexOf('data-k="' + KEYS.look + '" data-v="icon" disabled') !== -1, 'Icon greyed out');
  assert.ok(html.indexOf('data-k="' + KEYS.look + '" data-v="both">') !== -1, 'Icon + text stays');
  assert.ok(html.indexOf('The Icon look is for a value that is on or off.') !== -1, 'under the row');
  assert.ok(dialogHtml(slotSettings(WIFI)).indexOf('data-k="' + KEYS.look + '" data-v="icon">') !== -1,
    'pickable for a value that is on or off');
});

const LEVEL_ID = 'phone/phone_state/battery_level';

test('the page makes a plugin\'s values once while the phone\'s list stays, and anew for a new list', (t) => {
  let reads = 0;
  const item = Object.assign({}, WITH_WIFI[0].items[0]);
  const properties = item.properties;
  Object.defineProperty(item, 'properties', { get: () => { reads += 1; return properties; } });
  const phone = Object.assign({}, WITH_WIFI[0], { items: [item] });
  userData(t, { plugins: [phone] });
  const S = slotSettings(Object.assign(pickIn({ look: 'both', icon: 'wifi' }), WIFI));
  dialogHtml(S);
  PConf.engine.snapShownOptions(schema, S, BASALT);
  dialogHtml(S);
  assert.equal(reads, 1, 'every row and render after the first reads the values made then');
  global.INJECTED_USERDATA = { plugins: [phone] };
  dialogHtml(S);
  assert.equal(reads, 2, 'a new list from the phone: made anew');
});

test('a value that is neither on nor off takes the first icon that stays the same in Icon + text', (t) => {
  userData(t, { plugins: WITH_WIFI });
  const S = Object.assign(pickIn({ look: 'both', icon: 'wifi' }), WIFI);
  valuePicked(S);
  assert.equal(S[KEYS.icon], 'wifi', 'Wi-Fi is on or off');
  S[KEYS.id] = LEVEL_ID;
  valuePicked(S);
  assert.equal(S[KEYS.icon], 'plug', 'an icon that turns would stay off');
  S[KEYS.icon] = 'phone';
  valuePicked(S);
  assert.equal(S[KEYS.icon], 'phone', 'an icon that stays the same fits any value');
  const gone = Object.assign(pickIn({ look: 'both', icon: 'switch' }), WIFI, { [KEYS.id]: 'phone/phone_state/gone' });
  valuePicked(gone);
  assert.equal(gone[KEYS.icon], 'switch', 'a value the phone no longer lists: kept');
  const text = Object.assign(pickIn({ icon: 'wifi' }), WIFI, { [KEYS.id]: LEVEL_ID });
  valuePicked(text);
  assert.deepEqual([text[KEYS.look], text[KEYS.icon]], [undefined, 'wifi'], 'the Text look draws no icon: kept');
  lookPicked(text, 'both');
  assert.deepEqual([text[KEYS.look], text[KEYS.icon]], ['both', 'plug'], 'until a Look draws it');
});

test('the Icon look takes an icon that turns, and goes back to Text for a value that is neither on nor off', (t) => {
  userData(t, { plugins: WITH_WIFI });
  const S = Object.assign(pickIn({ look: 'both', icon: 'calendar' }), WIFI);
  // Each render snaps the rows shown onto their lists, and so does Save (engine.js).
  lookPicked(S, 'icon');
  PConf.engine.snapShownOptions(schema, S, BASALT);
  assert.deepEqual([S[KEYS.look], S[KEYS.icon]], ['icon', 'switch'], 'the first that turns');
  S[KEYS.icon] = 'bluetooth';
  lookPicked(S, 'icon');
  PConf.engine.snapShownOptions(schema, S, BASALT);
  assert.equal(S[KEYS.icon], 'bluetooth', 'one that turns: kept');
  S[KEYS.id] = LEVEL_ID;
  valuePicked(S);
  assert.deepEqual([S[KEYS.look], S[KEYS.icon]], ['text', 'bluetooth'], 'alone, the icon would show nothing');
  const gone = Object.assign(pickIn({ look: 'both', icon: 'plug' }), WIFI, { [KEYS.id]: 'phone/phone_state/gone' });
  lookPicked(gone, 'icon');
  PConf.engine.snapShownOptions(schema, gone, BASALT);
  assert.deepEqual([gone[KEYS.look], gone[KEYS.icon]], ['icon', 'switch'], 'a value the phone no longer lists');
});

test('a new plugin starts on its first value, with a Look and an icon that fit it; Plugin None on the defaults', (t) => {
  userData(t, { plugins: WITH_WIFI });
  // The engine stores the new plugin, then runs the row's change.
  const other = Object.assign(pickIn({ look: 'both', icon: 'bluetooth' }), WIFI, { [KEYS.plugin]: MUNINN });
  picked(other, PHONE, MUNINN);
  assert.deepEqual([other[KEYS.id], other[KEYS.look], other[KEYS.icon]], ['muninn/stats/daysRemaining', 'both', 'plug'],
    'a number: Icon + text with an icon that stays the same');
  const alone = Object.assign(pickIn({ look: 'icon', icon: 'wifi' }), WIFI, { [KEYS.plugin]: MUNINN });
  picked(alone, PHONE, MUNINN);
  assert.deepEqual([alone[KEYS.look], alone[KEYS.icon]], ['text', 'wifi'], 'the Icon look goes back to Text');
  // Plugin None hides the Look and Icon rows, so they go back to where a slot starts.
  const off = Object.assign(pickIn({ look: 'icon', icon: 'wifi' }), WIFI, { [KEYS.plugin]: '' });
  picked(off, PHONE, '');
  assert.deepEqual([off[KEYS.id], off[KEYS.look], off[KEYS.icon]], ['', 'text', 'switch'], 'Plugin None');
  const same = Object.assign(pickIn({ look: 'both', icon: 'plug' }), WIFI);
  picked(same, PHONE, PHONE);
  assert.deepEqual([same[KEYS.look], same[KEYS.icon]], ['both', 'plug'], 'the same plugin again: kept');
});

test('an Icon option\'s picture: the watch\'s drawing of each form it takes, on before off', () => {
  const glyph = (key) => PixelIcon.glyph(key, BASALT);
  assert.ok(glyph('WIFI').indexOf('<svg ') === 0, 'drawn');
  assert.equal(page.iconPicture({}, BASALT, { value: 'switch' }), glyph('SWITCH') + glyph('SWITCH_OFF'));
  assert.equal(page.iconPicture({}, BASALT, { value: 'wifi' }), glyph('WIFI') + glyph('WIFI_OFF'));
  assert.equal(page.iconPicture({}, BASALT, { value: 'bluetooth' }), glyph('BT') + glyph('BT_OFF'));
  assert.equal(page.iconPicture({}, BASALT, { value: 'plug' }), glyph('PLUG'));
  assert.equal(page.iconPicture({}, BASALT, { value: 'phone' }), glyph('PHONE_BATTERY'), 'the Phone battery slot\'s');
  assert.equal(page.iconPicture({}, BASALT, { value: 'calendar' }), glyph('COUNTDOWN'), 'the Countdown slot\'s');
  ['__hdr_turns', '__hdr_same', 'none', 'toString'].forEach((v) =>
    assert.equal(page.iconPicture({}, BASALT, { value: v }), '', v));
});

test('the bars\' pictures draw the icon picked, in the form the value read last takes', (t) => {
  clock(t, NOW);
  userData(t, { plugins: WITH_WIFI, pluginValues: handed(kept({ state: true, short: 'Home' }, { source: WIFI_KEY })) });
  const MID = catalog.pluginValueKeys('statusTopMid');
  const S = Object.assign({ statusTopMid: 'pluginValue' },
    pickIn({ plugin: PHONE, id: 'phone/phone_state/wifi', look: 'both', icon: 'wifi' }, 'statusTopMid'));
  assert.equal(page.barDrawing(S, 'statusTopMid'), 'WIFI', 'on');
  const slot = barSlots(S, BASALT, 'top', true, new Date(NOW))[1];
  assert.deepEqual([slot.code, slot.text, slot.drawing], ['pluginValue', 'Home', 'WIFI'], 'the watch pictures\' drawing');
  assert.equal(slot.icon, PixelIcon.glyph('WIFI', BASALT), 'the Status bars tab\'s glyph');
  global.INJECTED_USERDATA.pluginValues = handed(kept({ state: false, short: 'Home' }, { source: WIFI_KEY }));
  assert.equal(page.barDrawing(S, 'statusTopMid'), 'WIFI_OFF', 'off');
  global.INJECTED_USERDATA.pluginValues = handed(kept({ state: true }, { source: WIFI_KEY, at: NOW - 3 * HOUR }));
  assert.equal(page.barDrawing(S, 'statusTopMid'), 'WIFI_OFF', 'too old to show: off, as the watch shows it');
  global.INJECTED_USERDATA = { plugins: WITH_WIFI };
  assert.equal(page.barDrawing(S, 'statusTopMid'), 'WIFI_OFF', 'none read');
  const none = barSlots(Object.assign({}, S, { [MID.look]: 'icon' }), BASALT, 'top', true, new Date(NOW))[1];
  assert.deepEqual([none.text, none.drawing], ['--', 'WIFI_OFF'], 'the Icon look with none read: -- beside it');
  assert.equal(page.barDrawing(Object.assign({}, S, { [MID.icon]: 'plug' }), 'statusTopMid'), 'PLUG');
  const text = Object.assign({}, S, { [MID.look]: 'text' });
  assert.equal(page.barDrawing(text, 'statusTopMid'), null);
  global.INJECTED_USERDATA.pluginValues = handed(kept({ state: true, short: 'Home' }, { source: WIFI_KEY }));
  const bare = barSlots(text, BASALT, 'top', true, new Date(NOW))[1];
  assert.deepEqual([bare.text, bare.icon, bare.drawing], ['Home', null, null], 'the Text look: the value alone');
  const alone = barSlots(Object.assign({}, S, { [MID.look]: 'icon' }), BASALT, 'top', true, new Date(NOW))[1];
  assert.deepEqual([alone.text, alone.drawing], ['', 'WIFI'], 'the Icon look: the icon alone');
});

// --- the label ---------------------------------------------------------------------

test('the Label row shows where the slot prints it: Icon + text with an icon that turns, for a value that is on or off', (t) => {
  userData(t, { plugins: WITH_WIFI });
  const shown = (more) => labelShown(pickIn(Object.assign({}, WIFI_BOTH, more)));
  assert.equal(shown({}), true);
  assert.equal(shown({ icon: 'bluetooth' }), true, 'any icon that turns');
  assert.equal(shown({ look: 'text' }), false, 'the Text look: the text shows the value');
  assert.equal(shown({ look: 'icon' }), false, 'the Icon look prints no text');
  assert.equal(shown({ icon: 'plug' }), false, 'an icon that stays the same shows no state');
  assert.equal(shown({ id: 'phone/phone_state/battery_level' }), false, 'a value that is neither on nor off');
  assert.equal(shown({ plugin: '' }), false, 'no plugin');
  const S = slotSettings(pickIn(WIFI_BOTH));
  assert.ok(dialogHtml(S).indexOf('>Label<') !== -1, 'in the dialog');
  assert.equal(dialogHtml(slotSettings(pickIn(Object.assign({}, WIFI_BOTH, { look: 'text' })))).indexOf('>Label<'), -1);
  assert.equal(rowOf(KEYS.label).attributes.maxlength, catalog.CAPS.MID_TEXT_MAX, 'no longer than the widest slot prints');
});

test('another value or plugin takes no label typed for the one before; another Look keeps it', (t) => {
  userData(t, { plugins: WITH_WIFI });
  const S = pickIn(Object.assign({}, WIFI_BOTH, { label: 'Lamp' }));
  lookPicked(S, 'text');
  assert.equal(S[KEYS.label], 'Lamp', 'another Look');
  changed(S, KEYS.id, 'phone/phone_state/wifi', 'phone/phone_state/wifi');
  assert.equal(S[KEYS.label], 'Lamp', 'the same value');
  S[KEYS.id] = 'phone/phone_state/battery_level';
  changed(S, KEYS.id, 'phone/phone_state/wifi', S[KEYS.id]);
  assert.equal(S[KEYS.label], '', 'another value');
  S[KEYS.label] = 'Lamp';
  picked(S, PHONE, MUNINN);
  assert.equal(S[KEYS.label], '', 'another plugin');
});

test('the bars\' pictures print the label beside the icon, whichever way the value is', (t) => {
  clock(t, NOW);
  userData(t, { plugins: WITH_WIFI, pluginValues: handed(kept({ state: true, short: 'Home' }, { source: WIFI_KEY })) });
  const S = Object.assign({ statusTopMid: 'pluginValue' }, pickIn({ plugin: PHONE, id: 'phone/phone_state/wifi',
    look: 'both', icon: 'wifi', label: ' Garden\tlamp ' }, 'statusTopMid'));
  const slot = () => barSlots(S, BASALT, 'top', true, new Date(NOW))[1];
  assert.deepEqual([slot().text, slot().drawing], ['Garden lamp', 'WIFI'], 'on, on one line');
  global.INJECTED_USERDATA.pluginValues = handed(kept({ state: false, short: 'Home' }, { source: WIFI_KEY }));
  assert.deepEqual([slot().text, slot().drawing], ['Garden lamp', 'WIFI_OFF'], 'off');
  global.INJECTED_USERDATA = { plugins: WITH_WIFI };
  assert.deepEqual([slot().text, slot().drawing], ['--', 'WIFI_OFF'], 'none read: --, as without a label');
});

// --- two slots, two values -------------------------------------------------------

test('two slots, two dialogs: each lists, says and shows what its own pick does', (t) => {
  clock(t, NOW);
  const days = kept({ short: '5 d', number: 5, unit: 'd' }, { source: MUNINN + '/muninn/stats/daysRemaining' });
  userData(t, { plugins: WITH_WIFI, pluginValues: Object.assign(handed(kept({ short: '87%' })), handed(days)) });
  const S = Object.assign({ statusTopLeft: 'pluginValue', statusTopRight: 'pluginValue' }, LEVEL,
    pickIn({ plugin: MUNINN, id: 'muninn/stats/daysRemaining', look: 'both', icon: 'calendar' }, 'statusTopRight'));
  assert.deepEqual(valueOptions(S).map((o) => o[1]), ['phone/phone_state/battery_level', 'phone/phone_state/wifi']);
  assert.deepEqual(valueOptions(S, 'statusTopRight').map((o) => o[1]), ['muninn/stats/daysRemaining',
    'muninn/estimate/batteryLife']);
  assert.deepEqual([fromMuninn(S), fromMuninn(S, 'statusTopRight')], [false, true]);
  assert.deepEqual([lastLine(S), lastLine(S, 'statusTopRight')], ['87% (5 min ago).', '5 d (5 min ago).']);
  assert.deepEqual([iconHint(Object.assign({}, S, { [KEYS.icon]: 'switch' })), iconHint(S, 'statusTopRight')],
    ['This value is neither on nor off, so the icon stays off.', null]);
  const slots = barSlots(S, BASALT, 'top', true, new Date(NOW));
  assert.deepEqual([slots[0].text, slots[0].drawing], ['87%', null], 'the left slot: its value alone');
  assert.deepEqual([slots[2].text, slots[2].drawing], ['5 d', 'COUNTDOWN'], 'the right slot: its value, its icon');
  const right = dialogHtml(S, 'statusTopRight');
  assert.ok(right.indexOf('data-select="' + catalog.pluginValueKeys('statusTopRight').plugin + '"') !== -1,
    'the right slot\'s dialog holds its own rows');
  assert.equal(right.indexOf('data-select="' + KEYS.plugin + '"'), -1, 'and none of the left slot\'s');
  assert.ok(right.indexOf('Days left from Muninn') !== -1 && dialogHtml(S).indexOf('Days left from Muninn') === -1,
    'the Muninn note in the dialog of the slot that picks Muninn alone');
});

test('a row\'s change touches its own slot alone', (t) => {
  userData(t, { plugins: WITH_WIFI });
  const RIGHT = catalog.pluginValueKeys('statusTopRight');
  const S = Object.assign(pickIn({ look: 'icon', icon: 'wifi' }), WIFI,
    pickIn({ plugin: PHONE, id: 'phone/phone_state/wifi', look: 'icon', icon: 'wifi' }, 'statusTopRight'));
  S[RIGHT.plugin] = MUNINN;
  picked(S, PHONE, MUNINN, 'statusTopRight');
  assert.deepEqual([S[RIGHT.id], S[RIGHT.look]], ['muninn/stats/daysRemaining', 'text'], 'the right slot starts anew');
  assert.deepEqual([S[KEYS.plugin], S[KEYS.id], S[KEYS.look], S[KEYS.icon]], [PHONE, 'phone/phone_state/wifi', 'icon',
    'wifi'], 'the left slot keeps its pick');
  lookPicked(S, 'both', 'statusTopRight');
  assert.deepEqual([S[RIGHT.icon], S[KEYS.icon]], ['plug', 'wifi'], 'the right slot\'s Look fits its icon alone');
  S[KEYS.id] = LEVEL_ID;
  valuePicked(S);
  assert.equal(S[KEYS.look], 'text', 'the left slot\'s Look fits its new value');
  Object.assign(S, pickIn({ plugin: PHONE, id: LEVEL_ID, look: 'both', icon: 'switch' }, 'statusTopRight'),
    pickIn({ id: 'phone/phone_state/wifi', look: 'both', icon: 'switch' }));
  valuePicked(S, 'statusTopRight');
  assert.deepEqual([S[RIGHT.icon], S[KEYS.icon]], ['plug', 'switch'],
    'the right slot\'s icon fits its value; the left slot\'s, on Wi-Fi, stays');
});
