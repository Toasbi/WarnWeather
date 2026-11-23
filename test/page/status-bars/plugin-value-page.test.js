// test/page/status-bars/plugin-value-page.test.js — the Plugin value slot's dialog on the
// settings page: the Plugin and Value rows' lists (the plugins the phone listed as the page
// opened, userData.plugins), their hints, the line with the value read last
// (userData.pluginValue), the Plugin row's change, the Edit button that opens the dialog, the
// slot reset and the bars' pictures.
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
const { sample } = require('../../../src/pkjs/page/status-bars/preview-status-bars.js');

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
const LEVEL = { pluginValuePlugin: PHONE, pluginValueId: 'phone/phone_state/battery_level' };
const LEVEL_KEY = PHONE + '/phone/phone_state/battery_level';

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
 * @param {Object} reading Its reading's set fields.
 * @param {Object} [extra] Its other fields.
 * @returns {Object} The value.
 */
function kept(reading, extra) {
  return Object.assign({ source: LEVEL_KEY, reading: Object.assign({ short: null, time: null, number: null,
    unit: null, state: null, long: null }, reading), at: NOW - 5 * MIN, validUntil: null }, extra || {});
}

test('the Plugin row lists None, then each plugin the phone listed', (t) => {
  userData(t, { plugins: PLUGINS });
  assert.deepEqual(page.pluginOptions({ pluginValuePlugin: '' }), [['None', ''], ['Phone', PHONE], ['Muninn', MUNINN]]);
  assert.deepEqual(page.pluginOptions(LEVEL), [['None', ''], ['Phone', PHONE], ['Muninn', MUNINN]]);
});

test('a plugin the settings hold that the phone no longer lists stays, said as such', (t) => {
  userData(t, { plugins: PLUGINS });
  assert.deepEqual(page.pluginOptions({ pluginValuePlugin: 'gone' }).slice(-1), [['Not on this phone', 'gone']]);
  assert.equal(page.pluginHint({ pluginValuePlugin: 'gone' }),
    'This plugin is not on this phone. Until it is, the slot shows --.');
});

test('a phone that lists no plugin: None alone, and the hint says why', (t) => {
  [{}, { plugins: [] }, { plugins: 'x' }, null].forEach((data) => {
    global.INJECTED_USERDATA = data;
    assert.deepEqual(page.pluginOptions({ pluginValuePlugin: '' }), [['None', '']], JSON.stringify(data));
    assert.equal(page.pluginHint({ pluginValuePlugin: '' }), 'No app on this phone offers a value this slot can show.');
  });
  delete global.INJECTED_USERDATA;
  userData(t, { plugins: PLUGINS });
  assert.equal(page.pluginHint(LEVEL), null, 'a listed plugin needs no words');
});

test('a property\'s name made readable, after its item\'s where the plugin serves more than one', () => {
  [['battery_level', 'Battery level'], ['daysRemaining', 'Days remaining'], ['UVIndex', 'UV index'],
    ['uv_index', 'Uv index'], ['5G', '5G'], ['mobile_data', 'Mobile data'], ['HTTPStatus', 'HTTP status'],
    ['wifi', 'Wifi'], ['a-b c', 'A b c'], ['location: uv_index', 'Location: uv index'], ['a: UVIndex', 'A: UV index'],
    ['stats: daysRemaining', 'Stats: days remaining']].forEach(([name, label]) => assert.equal(page.labelOf(name), label, name));
});

test('the Value row lists the picked plugin\'s values, and keeps one it no longer offers under its name', (t) => {
  userData(t, { plugins: PLUGINS });
  assert.deepEqual(page.valueOptions(LEVEL), [['Battery level', 'phone/phone_state/battery_level'],
    ['Cell', 'phone/phone_state/cell']]);
  assert.deepEqual(page.valueOptions({ pluginValuePlugin: MUNINN, pluginValueId: 'muninn/stats/daysRemaining' }),
    [['Stats: days remaining', 'muninn/stats/daysRemaining'], ['Estimate: battery life', 'muninn/estimate/batteryLife']],
    'a plugin that serves more than one item: each value after its item');
  const old = { pluginValuePlugin: PHONE, pluginValueId: 'phone/phone_state/wifi_name' };
  assert.deepEqual(page.valueOptions(old).slice(-1),
    [['Wifi name', 'phone/phone_state/wifi_name', { desc: 'Not offered now' }]]);
  assert.equal(page.valueHint(old), 'The plugin no longer offers this value. Until it does, the slot shows --.');
  const gone = { pluginValuePlugin: 'gone', pluginValueId: 'muninn/stats/daysRemaining' };
  assert.deepEqual(page.valueOptions(gone), [['Days remaining', 'muninn/stats/daysRemaining', { desc: 'Not offered now' }]],
    'a plugin not on this phone: its value, under its name');
  assert.equal(page.valueHint(gone), null, 'the Plugin row says it');
  assert.deepEqual(page.valueOptions({ pluginValuePlugin: '' }), [], 'None: no values');
});

test('the Value row says when the plugin offers the value for more than one thing', (t) => {
  userData(t, { plugins: PLUGINS });
  assert.equal(page.valueHint({ pluginValuePlugin: MUNINN, pluginValueId: 'muninn/estimate/batteryLife' }),
    'The plugin offers this for more than one thing. The slot shows the first.');
  assert.equal(page.valueHint({ pluginValuePlugin: MUNINN, pluginValueId: 'muninn/stats/daysRemaining' }), null);
});

test('a new plugin starts on its first value; None on none', (t) => {
  userData(t, { plugins: PLUGINS });
  const S = Object.assign({}, LEVEL, { pluginValueId: 'phone/phone_state/cell' });
  page.pluginPicked(S, PHONE, PHONE);
  assert.equal(S.pluginValueId, 'phone/phone_state/cell', 'the same plugin keeps its value');
  page.pluginPicked(S, PHONE, MUNINN);
  assert.equal(S.pluginValueId, 'muninn/stats/daysRemaining');
  page.pluginPicked(S, MUNINN, '');
  assert.equal(S.pluginValueId, '');
  page.pluginPicked(S, '', 'gone');
  assert.equal(S.pluginValueId, '', 'a plugin the phone does not list');
});

test('the last line: the value read last, as a middle slot prints it, and how long ago', (t) => {
  clock(t, NOW);
  userData(t, { plugins: PLUGINS, pluginValue: kept({ short: '87%', number: 87, unit: '%' }) });
  assert.equal(page.lastLine(LEVEL), '87% (5 min ago).');
  global.INJECTED_USERDATA.pluginValue = kept({ number: 12345, unit: 'kWh' });
  assert.equal(page.lastLine(LEVEL), '12345 kWh (5 min ago).', 'the middle slot has room for the unit');
  global.INJECTED_USERDATA.pluginValue = kept({ short: '<b>87</b>' });
  assert.equal(page.lastLine(LEVEL), '&lt;b&gt;87&lt;/b&gt; (5 min ago).', 'another app\'s text, escaped');
});

test('the last line and the bars\' pictures print a moment as the watch does: a clock time in the user\'s format', (t) => {
  clock(t, NOW);
  const at = new Date(2026, 10, 23, 13, 40, 0).getTime();
  userData(t, { plugins: PLUGINS, pluginValue: kept({ time: at, number: at }) });
  const S = Object.assign({ statusTopLeft: 'pluginValue', axisTimeFormat: '12h', timeShowAmPm: true }, LEVEL);
  assert.equal(page.lastLine(S), '1:40p (5 min ago).');
  assert.equal(sample('pluginValue', S, { cap: catalog.CAPS.EDGE_TEXT_MAX, env: BASALT }), '1:40p');
  assert.equal(page.lastLine(LEVEL), '13:40 (5 min ago).', '24 hours');
  global.INJECTED_USERDATA.pluginValue = kept({ state: true });
  assert.equal(page.lastLine(LEVEL), 'Yes (5 min ago).');
});

test('the last line: a value too old to show says what the watch shows instead', (t) => {
  clock(t, NOW);
  userData(t, { plugins: PLUGINS, pluginValue: kept({ short: '87%' }, { at: NOW - 4 * HOUR }) });
  assert.equal(page.lastLine(LEVEL),
    '87% (4 h ago). It is too old to show, so the watch shows -- until a new one comes in.');
});

test('the last line: nothing read yet for the source the rows pick, and nothing while none is picked', (t) => {
  clock(t, NOW);
  userData(t, { plugins: PLUGINS, pluginValue: kept({ short: '87%' }) });
  const NOTHING = 'None yet. When you pick a value and save, the watch shows it within about a minute.';
  assert.equal(page.lastLine(Object.assign({}, LEVEL, { pluginValueId: 'phone/phone_state/cell' })), NOTHING,
    'another value\'s');
  global.INJECTED_USERDATA.pluginValue = null;
  assert.equal(page.lastLine(LEVEL), NOTHING);
  assert.equal(page.lastLine({ pluginValuePlugin: '' }), '');
});

test('the bars\' pictures print the value read last at each slot\'s room, else --', (t) => {
  clock(t, NOW);
  userData(t, { plugins: PLUGINS, pluginValue: kept({ number: 12345, unit: 'kWh' }) });
  const S = Object.assign({ statusTopLeft: 'pluginValue' }, LEVEL);
  assert.equal(sample('pluginValue', S, { cap: catalog.CAPS.EDGE_TEXT_MAX, env: BASALT }), '12345');
  assert.equal(sample('pluginValue', S, { cap: catalog.CAPS.MID_TEXT_MAX, env: BASALT }), '12345 kWh');
  assert.equal(page.barText(Object.assign({}, S, { pluginValueId: 'phone/phone_state/cell' }), 19), '--',
    'another value\'s');
  global.INJECTED_USERDATA.pluginValue = kept({ short: '87%' }, { at: NOW - 3 * HOUR });
  assert.equal(page.barText(S, 19), '--', 'too old for the watch to show');
  global.INJECTED_USERDATA = {};
  assert.equal(page.barText(S, 19), '--', 'none read');
});

// --- the user's complications ---------------------------------------------------

const PREFS = '00000000-0000-0000-0001-000000000009';
/**
 * What the phone lists: Preferences among the plugins, with the user's complications.
 * @param {*} list Its complications (plugin-value-list.js complicationsFor).
 * @returns {Array<Object>} The plugins.
 */
const withPrefs = (list) => PLUGINS.concat([{ uuid: PREFS, name: 'Preferences', items: [], complications: list }]);
const COMPLICATIONS = [
  { position: 0, property: 'temperature', category: 'weather' },
  { position: 1, property: 'battery_level', category: 'phone' },
  { position: 2, property: 'starts_at', category: 'calendar', why: 'Calendar' },
  { position: 3, property: 'daysRemaining', category: 'muninn' },
  { position: 4, property: 'ringing', category: 'phone', why: '' }];
const PLACE = (n) => ({ pluginValuePlugin: PREFS, pluginValueId: 'preferences/complications/' + n });

test('the Preferences plugin is listed as the user\'s complications in the Pebble app', (t) => {
  userData(t, { plugins: withPrefs(COMPLICATIONS) });
  assert.deepEqual(page.pluginOptions({ pluginValuePlugin: '' }).slice(-1),
    [['Preferences', PREFS, { desc: 'Your complications in the Pebble app' }]]);
});

test('its values are the complications by their places, each by what it shows, none of the plumbing', (t) => {
  userData(t, { plugins: withPrefs(COMPLICATIONS) });
  assert.deepEqual(page.valueOptions(PLACE(0)), [
    ['1 · Temperature (weather)', 'preferences/complications/0'],
    ['2 · Battery level (phone)', 'preferences/complications/1'],
    ['3 · Starts at (calendar)', 'preferences/complications/2', { disabled: true,
      desc: 'Needs the Calendar permission, which WarnWeather never asks for' }],
    ['4 · Days remaining (muninn)', 'preferences/complications/3'],
    ['5 · Ringing (phone)', 'preferences/complications/4', { disabled: true,
      desc: 'WarnWeather cannot read it here' }]]);
  assert.deepEqual(page.valueOptions(PLACE(1)).map((o) => o[1]), page.valueOptions(PLACE(0)).map((o) => o[1]),
    'the same list, whichever is picked');
  global.INJECTED_USERDATA.plugins = withPrefs([{ position: 1, property: 'battery_level', category: 'phone' }]);
  assert.deepEqual(page.valueOptions(PLACE(1)), [['2 · Battery level (phone)', 'preferences/complications/1']],
    'an empty place is not listed: the others keep their numbers');
  assert.deepEqual(page.valueOptions(PLACE(3)), [['2 · Battery level (phone)', 'preferences/complications/1'],
    ['4 · Empty', 'preferences/complications/3']], 'one the settings hold where the place is empty now');
  global.INJECTED_USERDATA.plugins = withPrefs([{ position: 0, property: 'hourly_UV_index', category: 'smartHome' }]);
  assert.equal(page.valueOptions(PLACE(0))[0][0], '1 · Hourly UV index (smart home)', 'names made readable');
  global.INJECTED_USERDATA.plugins = withPrefs([{ position: 0, property: 'state', category: 'lights',
    why: 'ReadWatchSettings' }]);
  assert.equal(page.valueOptions(PLACE(0))[0][2].desc, 'Needs the Read watch settings permission, which WarnWeather '
    + 'never asks for');
  [[], null, undefined, 'x'].forEach((list) => {
    global.INJECTED_USERDATA.plugins = withPrefs(list);
    assert.deepEqual(page.valueOptions(PLACE(0)), [['1 · Empty', 'preferences/complications/0']], String(list));
  });
});

test('the Value row\'s hint says where the complications are set, that the slot follows the one picked, '
  + 'and why it shows -- where it does', (t) => {
  userData(t, { plugins: withPrefs(COMPLICATIONS) });
  const hint = 'Your complications in the Pebble app (Settings › Plugins › Complications). The slot '
    + 'follows the one you pick when you change it there.';
  [PLACE(0), PLACE(3), { pluginValuePlugin: PREFS, pluginValueId: '' }].forEach((S) =>
    assert.equal(page.valueHint(S), hint, S.pluginValueId));
  assert.equal(page.valueHint(PLACE(2)), hint + ' Needs the Calendar permission, which WarnWeather never asks for, '
    + 'so the slot shows --.', 'one it may not read: the place\'s complication changed in the Pebble app since');
  assert.equal(page.valueHint(PLACE(4)), hint + ' WarnWeather cannot read it here, so the slot shows --.');
  assert.equal(page.valueHint(PLACE(9)), hint + ' This place is empty there, so the slot shows --.');
  global.INJECTED_USERDATA.plugins = withPrefs([]);
  assert.equal(page.valueHint(PLACE(0)), hint + ' This place is empty there, so the slot shows --.', 'none set up');
  assert.equal(page.valueHint({ pluginValuePlugin: PREFS, pluginValueId: '' }), hint, 'none set up, none picked');
  global.INJECTED_USERDATA.plugins = withPrefs([{ position: 0, property: 'p', category: 'c', why: '<b>' }]);
  assert.equal(page.valueHint(PLACE(0)), hint + ' Needs the &lt;b&gt; permission, which WarnWeather never asks for, '
    + 'so the slot shows --.', 'another app\'s words, escaped: the hint is HTML');
});

test('a pick of the Preferences plugin\'s own reading, which 3.4.0 listed, is a value the plugin no longer offers', (t) => {
  userData(t, { plugins: withPrefs(COMPLICATIONS) });
  const S = { pluginValuePlugin: PREFS, pluginValueId: 'preferences/weather_location/latitude' };
  assert.equal(page.valueHint(S), 'The plugin no longer offers this value. Until it does, the slot shows --.');
  assert.deepEqual(page.valueOptions(S).slice(-1),
    [['Latitude', 'preferences/weather_location/latitude', { desc: 'Not offered now' }]]);
});

test('picking Preferences starts on the first complication WarnWeather can read', (t) => {
  userData(t, { plugins: withPrefs(COMPLICATIONS.slice(2)) });
  const S = Object.assign({}, LEVEL);
  page.pluginPicked(S, PHONE, PREFS);
  assert.equal(S.pluginValueId, 'preferences/complications/3', 'the calendar one is passed over');
  global.INJECTED_USERDATA.plugins = withPrefs([COMPLICATIONS[2]]);
  page.pluginPicked(S, PHONE, PREFS);
  assert.equal(S.pluginValueId, '', 'none it can read');
  global.INJECTED_USERDATA.plugins = withPrefs([]);
  page.pluginPicked(S, PHONE, PREFS);
  assert.equal(S.pluginValueId, '', 'none known');
});

test('the last line and the bars\' pictures show the value the phone hands for a complication\'s place, by the place', (t) => {
  // The phone hands the page a complication's value only while its place names the reading it
  // was read from (plugin-value-source.js forPage), so the page judges it by the place alone.
  clock(t, NOW);
  userData(t, { plugins: withPrefs(COMPLICATIONS), pluginValue: kept({ short: '21°' },
    { source: PREFS + '/preferences/complications/0/weather/location/0/temperature' }) });
  const S = Object.assign({ statusTopLeft: 'pluginValue' }, PLACE(0));
  assert.equal(page.lastLine(S), '21° (5 min ago).');
  assert.equal(page.barText(S, 8), '21°');
  assert.equal(page.barText(PLACE(1), 8), '--', 'another place\'s');
  assert.equal(page.lastLine(PLACE(1)), 'None yet. When you pick a value and save, the watch shows it within about a minute.');
});

test('the Edit button opens the dialog from every slot that holds the item, not on aplite', () => {
  const resolve = PConf.sheetResolvers.get('statusSlotEditSheet');
  catalog.allSlotKeys().forEach((slotKey) => {
    const S = { [slotKey]: 'pluginValue' };
    assert.equal(resolve(S, { thresholds: true }, { messageKey: slotKey }), 'threshPluginValue', slotKey);
    assert.equal(resolve(S, { thresholds: false }, { messageKey: slotKey }), null, slotKey + ' on aplite');
  });
});

/**
 * Settings with a Plugin value in the Watch bar's left slot, hydrated as the page holds them.
 * @param {Object} [over] Settings over the slot's.
 * @returns {Object} The settings.
 */
function slotSettings(over) {
  return PConf.engine.hydrate(schema, Object.assign({ statusTopLeft: 'pluginValue' }, over), BASALT);
}

/**
 * The Plugin value dialog as the engine draws it open over these settings.
 * @param {Object} state Settings (slotSettings).
 * @returns {string} The dialog's HTML.
 */
function dialogHtml(state) {
  return PConf.engine.renderEditModal(schema, { S: state, ENV: BASALT, USERDATA: {}, openColor: null,
    openSelect: null, openEdit: 'threshPluginValue', selectQuery: '', collapsed: {},
    evalCtx: Object.assign({}, state, { env: BASALT }) });
}

test('the dialog: Plugin with its list, then Value, Updates and the last line once one is picked', (t) => {
  clock(t, NOW);
  userData(t, { plugins: PLUGINS, pluginValue: kept({ short: '87%' }) });
  const S = slotSettings(LEVEL);
  assert.equal(S.pluginValueEvery, '60', 'every hour by default');
  const html = dialogHtml(S);
  ['Plugin value slot', 'Plugin', 'Phone', 'Value', 'Battery level', 'Updates', 'Every hour']
    .forEach((text) => assert.ok(html.indexOf(text) !== -1, 'the dialog shows ' + text));
  assert.ok(html.indexOf('<div class="lbl">Last value</div><div class="hint">87% (5 min ago).</div>') !== -1,
    'the last value is a row like the others: its label, the value in the hint\'s grey under it');
  assert.ok(html.indexOf('BoldMode') === -1, 'no Bold: the item has no bold kind');
  const empty = dialogHtml(slotSettings());
  ['Value', 'Updates', 'Last value'].forEach((text) =>
    assert.equal(empty.indexOf('>' + text + '<'), -1, 'no ' + text + ' while no plugin is picked'));
});

test('Muninn picked: a note above the Plugin row says the Watch battery slot shows its estimate by itself', (t) => {
  userData(t, { plugins: PLUGINS });
  assert.equal(page.fromMuninn({ pluginValuePlugin: MUNINN }), true, 'a plugin serving Muninn\'s category');
  assert.equal(page.fromMuninn(LEVEL), false, 'the Phone plugin');
  assert.equal(page.fromMuninn({ pluginValuePlugin: '' }), false, 'none picked');
  assert.equal(page.fromMuninn({ pluginValuePlugin: 'gone' }), false, 'one the phone no longer lists');
  const muninn = dialogHtml(slotSettings({ pluginValuePlugin: MUNINN, pluginValueId: 'muninn/stats/daysRemaining' }));
  const at = muninn.indexOf('<div class="card info"><div class="cardHdr"><span class="ttlwrap"><span class="ttl">Days left from Muninn</span>');
  assert.ok(at !== -1, 'a card of its own in the info look');
  const text = muninn.indexOf('The Watch battery slot can show Muninn\'s estimate by itself');
  assert.ok(text > at, 'with what to do');
  const rows = muninn.indexOf('data-select="pluginValuePlugin"');
  assert.ok(rows > text, 'above the Plugin row');
  assert.ok(muninn.slice(text, rows).indexOf('<div class="card nohdr">') !== -1, 'which is in a plain card of its own');
  [dialogHtml(slotSettings(LEVEL)), dialogHtml(slotSettings())].forEach((html, i) => {
    assert.equal(html.indexOf('card info'), -1, i ? 'none while no plugin is picked' : 'none for another plugin');
    assert.ok(html.indexOf('<div class="card nohdr"><div><div class="row') !== -1, 'the rows\' card opens the dialog');
  });
});

test('a plugin the phone no longer lists is not swapped for another as the dialog draws', (t) => {
  userData(t, { plugins: PLUGINS });
  const S = slotSettings({ pluginValuePlugin: 'gone', pluginValueId: 'gone/item/value' });
  dialogHtml(S);
  assert.deepEqual([S.pluginValuePlugin, S.pluginValueId], ['gone', 'gone/item/value']);
});

test('Reset status bars puts the Plugin value\'s source and Updates back', () => {
  const S = Object.assign({ pluginValueEvery: '360' }, LEVEL);
  const defaults = { pluginValuePlugin: '', pluginValueId: '', pluginValueEvery: '60' };
  PConf.actions.resetStatusSlots(null, S, BASALT, (key) => (key in defaults ? defaults[key] : undefined));
  assert.deepEqual([S.pluginValuePlugin, S.pluginValueId, S.pluginValueEvery], ['', '', '60']);
});
