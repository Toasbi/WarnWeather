'use strict';
// test/config-screens-page.test.js — the Watchface tab's screens (page/layout/screens-page.js):
// the Screens card (a row per screen, a ✕ with Undo on each flick, "+ Add screen"), the
// screen editor (its picture, the rows top to bottom, a row's dropdowns and their pickers, its
// moves by drag and by key, ✕ and the Add chips, Delete screen, the radar-off row), Setup's Rain
// radar picker (Off keeps the source) and the modes Save works out from the screens. The module
// first, then the REAL generated page (test/helpers/page-harness.js), whose fake DOM carries the
// editor's overlay.
const test = require('node:test');
const assert = require('node:assert/strict');
require('../src/pkjs/config-ui/lib/schema-walk.js');
require('../src/pkjs/config-ui/lib/color.js');
require('../src/pkjs/config-ui/lib/show-when.js');
require('../src/pkjs/config-ui/lib/engine.js');
require('../src/pkjs/page/settings/blocks.js');   // registers screens-page.js' resolvers too
const SP = require('../src/pkjs/page/layout/screens-page.js');
const M = require('../src/pkjs/layout/domain/screens.js');
const P = require('../src/pkjs/page/layout/screen-presets.js');
const VC = require('../src/pkjs/layout/domain/view-cycle.js');
const platform = require('../src/pkjs/config-ui/lib/platform.js');
const ui = require('../src/pkjs/config-ui/lib/ui.js');
const { bootGeneratedPage } = require('./helpers/page-harness.js');
const { blankBar, slotsOf } = require('./helpers/status-slots.js');
const { editorRows, editorAddChips, editorAddGroups, editorRow, sheetTitle, sheetOptions } = require('./helpers/page-rows.js');

const PC = global.PConf;
const BASALT = platform.computeEnv({ platform: 'basalt' });
const APLITE = platform.computeEnv({ platform: 'aplite' });
const b = (k, o) => Object.assign({ k }, o || {});
// An upgraded install's three screens (compactCal, health all, radar graph, swap on): a new
// install starts on the Default screen alone.
const THREE = { provider: 'dwd', radarMode: 'graph', healthMode: 'all' };
// The three screens as lists.
const DEFAULT_SCREENS = [
  [b('strip'), b('cal', { rows: '2' }), b('clock'), b('fcbar'), b('fc', { size: 'fill' })],
  [b('strip'), b('clock'), b('healthbar'), b('health', { size: 'fill' })],
  [b('strip'), b('clock'), b('radarbar'), b('radar', { size: 'fill' })]];

/**
 * A preset install's settings: today's three-screen cycle unless overridden.
 * @param {Object} [over] Keys to set.
 * @returns {Object}
 */
function preset(over) {
  return Object.assign({ layoutPreset: 'compactCal', radarMode: 'graph', healthMode: 'all', swapClockStatus: true,
    radarEnabled: true, radarProvider: 'rainbow', viewCount: '1' }, over || {});
}

/**
 * The CLAY_VIEW words a settings blob compiles to.
 * @param {Object} S Settings.
 * @returns {number[]}
 */
function words(S) {
  return VC.resolveViewCycle(S, BASALT).map((v) => VC.packWire(v || null));
}

/**
 * The Screens card's rows as the page draws them: [name, what it shows, has a ✕].
 * @param {string} html The Watchface tab's markup.
 * @returns {Array<Array>}
 */
function cardRows(html) {
  const out = [];
  const re = /<div class="ui-row scr-row" data-scr-row="\d+">[\s\S]*?<span class="ui-n">([^<]*)(?:<span class="scr-pill">[^<]*<\/span>)?<\/span><span class="ui-d">([^<]*)<\/span>[\s\S]*?(<button type="button" class="scr-x"|<span class="scr-xpad")/g;
  let m;
  while ((m = re.exec(html))) { out.push([m[1], m[2], m[3].indexOf('scr-x"') !== -1]); }
  return out;
}

/**
 * The open overlay's body, header and title (the title's text: the screen's name, or Add a
 * screen; the header is a dialog's, ui.js header).
 * @param {Object} page bootGeneratedPage handle.
 * @returns {{title: string, body: string, head: string}}
 */
function editorOf(page) {
  const ed = page.editor();
  assert.ok(ed, 'the screen editor is open');
  const head = ed.querySelector('[data-se-head]').innerHTML;
  const m = /id="seTitle">([^<]*)<\/span>/.exec(head);
  return { title: m ? m[1] : '', head, body: ed.querySelector('[data-se-body]').innerHTML };
}

// --- the module ----------------------------------------------------------------------

test('a first edit turns a preset custom through its own keys: the other screens keep what they draw', () => {
  const S = preset();
  const before = words(S);
  assert.deepEqual(M.screensOf(S, BASALT), DEFAULT_SCREENS, 'premise: the preset\'s screens');
  SP.writeScreen(S, 2, M.remove(DEFAULT_SCREENS[2], 2), BASALT);   // the Radar bar off Flick 2
  assert.equal(S.layoutPreset, 'custom');
  assert.equal(S.customLayoutSeeded, true);
  const after = words(S);
  assert.deepEqual(after.slice(0, 2), before.slice(0, 2), 'Default and Flick 1 byte for byte');
  assert.notDeepEqual(after[2], before[2], 'Flick 2 changed');
  assert.deepEqual(M.screensOf(S, BASALT)[2], [b('strip'), b('clock'), b('radar', { size: 'fill' })]);
  assert.deepEqual([S.radarMode, S.healthMode], ['graph', 'all'], 'the modes the screens need');
});

// Bars never set up (helpers/status-slots.js blankBar).
const BLANK_HEALTH = blankBar('health');
const BLANK_RADAR = blankBar('radar');
const BLANK_FORECAST = blankBar('forecast');
// No flick screens: the Default screen alone.
const ONE = { radarMode: 'off', healthMode: 'off' };

test('a bar an edit brings onto the screens with nothing to show takes its default slots', () => {
  const S = preset(Object.assign({}, ONE, BLANK_HEALTH, BLANK_RADAR));
  SP.writeScreen(S, SP.addChosen(S, BASALT, 'blank'), M.add(M.add(P.BLANK, 'healthbar'), 'radarbar'), BASALT);
  assert.deepEqual(slotsOf(S, 'health'), ['steps', 'empty', 'sleep'], 'a new install\'s, no heart rate on a basalt');
  assert.deepEqual(slotsOf(S, 'radar'), ['uv', 'wind', 'gust']);
  // The modes follow what the shown bars hold (3.0.0): the Health bar's steps and sleep need
  // health; the Radar bar's UV, wind and gusts need no radar (the rain alert on the Watch
  // bar does).
  assert.deepEqual([S.radarMode, S.healthMode], ['countdown', 'slot'], 'the modes follow what the bars hold');
  // The watch's own defaults: emery's heart rate.
  const EMERY = platform.computeEnv({ platform: 'emery' });
  const E = preset(Object.assign({}, ONE, BLANK_HEALTH));
  SP.writeScreen(E, SP.addChosen(E, EMERY, 'blank'), M.add(P.BLANK, 'healthbar'), EMERY);
  assert.deepEqual(slotsOf(E, 'health'), ['steps', 'sleep', 'hr']);
  // An item this watch cannot show is nothing to show either: heart rate on a basalt.
  const hr = preset(Object.assign({}, ONE, BLANK_HEALTH, { statusHealthRight: 'hr' }));
  SP.writeScreen(hr, SP.addChosen(hr, BASALT, 'blank'), M.add(P.BLANK, 'healthbar'), BASALT);
  assert.deepEqual(slotsOf(hr, 'health'), ['steps', 'empty', 'sleep']);
});

test('a bar with a reading of its own, or one a screen shows already, keeps its slots', () => {
  const own = preset(Object.assign({}, ONE, BLANK_HEALTH, { statusHealthMid: 'distance' }));
  SP.writeScreen(own, SP.addChosen(own, BASALT, 'blank'), M.add(P.BLANK, 'healthbar'), BASALT);
  assert.deepEqual(slotsOf(own, 'health'), ['empty', 'distance', 'empty']);
  // The Default screen shows the Forecast bar Empty: a second screen with it changes nothing there.
  const shown = preset(Object.assign({}, ONE, BLANK_FORECAST));
  assert.ok(M.idxOf(M.screensOf(shown, BASALT)[0], 'fcbar') >= 0, 'premise: the Default screen shows the bar');
  SP.writeScreen(shown, SP.addChosen(shown, BASALT, 'blank'), M.add(P.BLANK, 'fcbar'), BASALT);
  assert.deepEqual(slotsOf(shown, 'forecast'), ['empty', 'empty', 'empty']);
  // A move or an option on a screen already showing the bar fills nothing either.
  const three = preset(BLANK_HEALTH);
  SP.writeScreen(three, 1, M.move(DEFAULT_SCREENS[1], 2, 1), BASALT);
  assert.deepEqual(slotsOf(three, 'health'), ['empty', 'empty', 'empty']);
});

test('a screen put in where a deleted one\'s keys still lie fills the bar it brings', () => {
  // Flick 2 (the Rain radar screen) deleted: its keys stay in the slot past the last screen.
  const S = preset(BLANK_RADAR);
  assert.equal(SP.deleteScreen(S, 2, BASALT), true);
  assert.equal(S.viewLower2, 'radar', 'premise: the deleted screen\'s Radar bar still in its keys');
  assert.equal(SP.insertScreen(S, 2, M.copy(DEFAULT_SCREENS[2]), BASALT), true);
  assert.deepEqual(slotsOf(S, 'radar'), ['uv', 'wind', 'gust']);
});

test('Delete a flick screen: the ones after it move up, and Undo puts every key back', () => {
  const S = preset();
  SP.ensureCustom(S, BASALT);
  const snap = SP.snapshot(S);
  const kept = JSON.stringify(S);
  assert.equal(SP.deleteScreen(S, 0, BASALT), false, 'the Default screen stays');
  assert.equal(SP.deleteScreen(S, 3, BASALT), false, 'no such screen');
  assert.equal(SP.deleteScreen(S, 1, BASALT), true);
  assert.equal(S.viewCount, '2');
  assert.deepEqual(M.screensOf(S, BASALT), [DEFAULT_SCREENS[0], DEFAULT_SCREENS[2]], 'the radar screen is Flick 1 now');
  assert.equal(S.healthMode, 'off', 'no screen shows health any more');
  SP.restore(S, snap, BASALT);
  assert.equal(JSON.stringify(S), kept, 'Undo: every key and both modes as they were');
});

test('Rain radar Off keeps the source, and the radar\'s screen with it', () => {
  // A preset install (the migration could not move it: its watch did not say what it is).
  const S = preset();
  SP.radarSourcePicked(S, 'rainbow', 'off', BASALT);
  assert.equal(S.radarEnabled, false);
  assert.equal(S.radarProvider, 'rainbow', 'Off keeps the source');
  assert.equal(S.radarMode, 'off', 'no radar fetch');
  assert.equal(S.layoutPreset, 'custom', 'turned custom first: a preset\'s screens follow its modes');
  assert.deepEqual(M.screensOf(S, BASALT), DEFAULT_SCREENS, 'the Rain radar screen stays, drawn without radar');
  assert.equal(SP.radarSourceValue(S), 'off');
  SP.radarSourcePicked(S, 'off', 'dwd', BASALT);
  assert.equal(S.radarEnabled, true);
  assert.equal(S.radarProvider, 'dwd');
  assert.equal(S.radarMode, 'graph', 'its screen shows the radar graph again');
  assert.equal(SP.radarSourceValue(S), 'dwd');
});

test('a watch that did not say what it is keeps its preset while only the modes move; a screen edit makes it custom', () => {
  const UNKNOWN = platform.computeEnv({});
  const S = preset({ layoutPreset: 'fullCal' });
  SP.radarSourcePicked(S, 'rainbow', 'off', UNKNOWN);
  assert.equal(S.layoutPreset, 'fullCal', 'it might be an aplite, which folds a custom layout to Compact calendar');
  assert.equal(S.radarMode, 'off', 'no radar fetch all the same');
  SP.radarSourcePicked(S, 'off', 'rainbow', UNKNOWN);
  assert.equal(S.layoutPreset, 'fullCal');
  // A screen edit is one the user asked for.
  SP.writeScreen(S, 0, M.screensOf(S, UNKNOWN)[0], UNKNOWN);
  assert.equal(S.layoutPreset, 'custom');
});

/**
 * The Default screen alone as a custom layout, the rain alert ticked nowhere unless asked.
 * @param {Object} [over] Keys to set.
 * @returns {Object}
 */
function defaultOnly(over) {
  return Object.assign(preset({ statusTopOnDemandLeftItems: 'bt,qt,snooze' }),
    { layoutPreset: 'custom', viewCount: '1' }, M.compileKeys(DEFAULT_SCREENS[0], 0), over || {});
}

test('the radar key is asked for only while a radar call is made: the radar mode Save stores', () => {
  const attention = PC.attentionResolvers.get('radarKeyAttention');
  const S = defaultOnly({ radarProvider: 'rainbowkey', rainbowApiKey: '' });
  assert.equal(SP.radarModeToSave(S, BASALT), 'off', 'on, but no screen and no rain alert needs it');
  assert.equal(attention(S, BASALT), null);
  S.statusTopOnDemandLeftItems = 'bt,qt,snooze,rain';
  assert.equal(SP.radarModeToSave(S, BASALT), 'countdown', 'the rain alert on the Watch bar needs it');
  assert.notEqual(attention(S, BASALT), null);
  assert.equal(S.radarMode, 'graph', 'the stored mode lags until Save; the check does not');
  assert.equal(attention(Object.assign({}, S, { radarEnabled: false }), BASALT), null, 'the radar off');
});

test('the call budgets count the radar calls Save will make, not a stored mode that lags', () => {
  const block = PC.blocks.get('rainbowBudget');
  const S = defaultOnly({ radarProvider: 'rainbowkey', rainbowApiKey: 'key', radarMode: 'countdown' });
  assert.equal(block(S, BASALT), '', 'nothing needs the radar: no call billed');
  Object.assign(S, { statusTopOnDemandLeftItems: 'bt,qt,snooze,rain', radarMode: 'off' });
  assert.match(block(S, BASALT), /calls\/month/, 'the rain alert needs it: billed');
  assert.deepEqual(PC.optionsResolvers.get('fetchIntervalBudget')(S, BASALT),
    PC.optionsResolvers.get('fetchIntervalBudget')(Object.assign({}, S, { radarMode: 'countdown' }), BASALT),
    'the interval choice reads it too');
});

test('a screen in a line, for its row on the Screens card: the Watch bar left out', () => {
  assert.equal(SP.contents(DEFAULT_SCREENS[0], {}), 'Calendar · Clock · Forecast bar · Forecast graph');
  assert.equal(SP.contents(DEFAULT_SCREENS[2], {}), 'Clock · Radar bar · Rain radar');
  assert.equal(SP.contents(DEFAULT_SCREENS[2], { radarEnabled: false }), 'Clock · Radar bar · Rain radar (off)');
  assert.equal(SP.contents([b('strip')], {}), 'Nothing yet');
});

test('aplite has no screens: no card, and its layout and modes stay its own', () => {
  assert.equal(SP.hasScreens(APLITE), false);
  assert.equal(SP.screensCard(preset(), APLITE), '');
  const S = preset({ layoutPreset: 'fullCal', radarMode: 'off', healthMode: 'off' });
  SP.applyModes(S, APLITE);
  assert.deepEqual([S.layoutPreset, S.radarMode, S.healthMode], ['fullCal', 'off', 'off']);
  assert.deepEqual(PC.optionsResolvers.get('apliteLayouts')(S, APLITE), SP.APLITE_LAYOUTS);
  assert.equal(PC.whenResolvers.get('manyScreens')(preset(), APLITE), false, 'no Screen switching card');
  assert.equal(PC.whenResolvers.get('manyScreens')(preset(), BASALT), true);
  assert.equal(PC.whenResolvers.get('manyScreens')(preset({ radarMode: 'off', healthMode: 'off' }), BASALT), false);
});

test('the Update interval says when the Battery saver pauses the updates', () => {
  const hint = PC.hintResolvers.get('batterySaverPauseHint');
  const own = 'Updates only send what actually changed.';
  assert.equal(hint({ sleepNightEnabled: true, sleepStartHour: '0', sleepEndHour: '7' }, BASALT, { staticHint: own }),
    own + ' Paused 0:00–7:00 by the Battery saver.');
  assert.equal(hint({ sleepNightEnabled: true, sleepStartHour: '22', sleepEndHour: '6' }, BASALT, {}),
    'Paused 22:00–6:00 by the Battery saver.');
  assert.equal(hint({ sleepNightEnabled: false }, BASALT, { staticHint: own }), own, 'the saver off: nothing paused');
});

// --- the page --------------------------------------------------------------------------

test('the Watchface tab: the screens pinned on top, the Screens card, then Screen switching', () => {
  const page = bootGeneratedPage(THREE);
  const html = page.scroll.innerHTML;
  assert.deepEqual(cardRows(html), [
    ['Default', 'Calendar · Clock · Forecast bar · Forecast graph', false],
    ['Flick 1', 'Clock · Health bar · Health graph', true],
    ['Flick 2', 'Clock · Radar bar · Rain radar', true]
  ], 'a row per screen, no pictures, a ✕ on each flick');
  assert.equal(html.indexOf('data-action="addScreen"'), -1, 'three screens: none to add');
  assert.ok(html.indexOf('<span class="ttl">Screen switching</span>') > html.indexOf('<span class="ttl">Screens</span>'));
  assert.ok(html.indexOf('>Double flick to switch<') !== -1);
  assert.ok(html.indexOf('>Back to Default after<') !== -1);
  assert.equal(html.indexOf('data-k="layoutPreset"'), -1, 'no Layout card off aplite');
  // A tap on a pinned screen or a card row opens its editor.
  page.tapAction('openScreen', 1);
  assert.equal(editorOf(page).title, 'Flick 1');
  page.tapEditor({ se: 'close' });
  assert.equal(page.editor(), null, 'closed');
});

test('a ✕ deletes a flick screen at once, and Undo puts it back', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const page = bootGeneratedPage(THREE);
  page.tapAction('deleteScreen', 1);
  assert.deepEqual(cardRows(page.scroll.innerHTML).map((r) => r.slice(0, 2)), [
    ['Default', 'Calendar · Clock · Forecast bar · Forecast graph'],
    ['Flick 1', 'Clock · Radar bar · Rain radar']
  ]);
  // The page's one Undo (ui.js undoToast), as after a Delete status bar or a deleted graph.
  assert.match(page.scroll.innerHTML, /<div class="ui-toast" role="status"><span>Flick 1 deleted\.<\/span><button type="button" class="ui-undo" data-action="undoDeleteScreen">Undo<\/button><\/div>/);
  assert.ok(page.scroll.innerHTML.indexOf('<button type="button" class="ui-row ui-new" data-action="addScreen"><svg class="ui-ic"')
    !== -1 && page.scroll.innerHTML.indexOf('<span class="ui-n">Add screen</span></button>') !== -1,
  'room for one more: the New row, as New status bar and New graph');
  page.tapAction('undoDeleteScreen');
  assert.equal(cardRows(page.scroll.innerHTML).length, 3, 'Undo: all three again');
  assert.equal(page.scroll.innerHTML.indexOf('ui-toast'), -1, 'and the toast goes');
  // Unanswered, the toast goes by itself.
  page.tapAction('deleteScreen', 2);
  assert.ok(page.scroll.innerHTML.indexOf('Flick 2 deleted.') !== -1);
  t.mock.timers.tick(5000);
  assert.equal(page.scroll.innerHTML.indexOf('ui-toast'), -1, 'gone after five seconds');
});

test('a new install: the Default screen alone; + Add screen adds a screen and opens its editor', () => {
  const page = bootGeneratedPage({ provider: 'dwd' });   // the shipped defaults
  assert.deepEqual(cardRows(page.scroll.innerHTML).map((r) => r[0]), ['Default']);
  assert.equal(page.scroll.innerHTML.indexOf('Screen switching'), -1, 'one screen: nothing to switch');
  page.tapAction('addScreen');
  assert.equal(editorOf(page).title, 'Add a screen');
  page.tapEditor({ se: 'pick', id: 'health' });
  page.tapEditor({ se: 'acal', v: '' });
  assert.equal(page.S.viewCount, '1', 'nothing added until Add screen');
  page.tapEditor({ se: 'addnow' });
  assert.equal(page.S.viewCount, '2');
  assert.equal(page.S.layoutPreset, 'custom');
  let ed = editorOf(page);
  assert.equal(ed.title, 'Health');
  assert.deepEqual(editorRows(ed.body), ['Watch bar', 'Clock', 'Health bar', 'Health graph · Fill']);
  // Its rows taken off one by one: the Watch bar and the Clock left.
  page.tapEditor({ se: 'rm', j: 3 });
  page.tapEditor({ se: 'rm', j: 2 });
  ed = editorOf(page);
  assert.deepEqual(editorRows(ed.body), ['Watch bar', 'Clock']);
  assert.ok(editorRow(ed.body, 0).indexOf('<span class="se-grip off" aria-hidden="true"></span><div class="se-mid">'
    + '<span class="se-name">Watch bar</span><span class="se-ctl">' + ui.editButton('Edit', { 'data-se': 'editbar',
      'data-j': 0, 'aria-haspopup': 'dialog', 'aria-label': 'Edit Watch bar' }) + '</span></div>') !== -1,
  'the Watch bar has no handle; its Edit opens its dialog');
  assert.ok(ed.body.indexOf('aria-label="Remove Clock"') !== -1, 'a flick screen may drop its Clock');
  assert.deepEqual(editorAddGroups(ed.body), [
    ['Add a status bar', 'Forecast bar', 'Radar bar', 'Health bar'],
    ['Add a graph', 'Forecast graph', 'Rain radar', 'Health graph'],
    ['Add the calendar', 'Calendar']], 'a chip each, grouped by what it adds');
  assert.equal(ed.body.indexOf('se-hint'), -1, 'one row that moves: nothing to reorder');
  assert.ok(ed.body.endsWith('</div><button type="button" class="ui-del" data-se="delscreen">Delete screen</button>'),
    'Delete screen: the page\'s one Delete, last, under the card');
  page.tapEditor({ se: 'close' });
  assert.ok(page.scroll.innerHTML.indexOf('<span class="ttl">Screen switching</span>') !== -1, 'two screens now');
});

test('the editor says how to reorder while two rows can move, and its calendar and clock group names what it adds', () => {
  const page = bootGeneratedPage(THREE);
  page.tapAction('openScreen', 1);
  let body = editorOf(page).body;
  // Flick 1: the Watch bar (it stays on top), the Clock, the Health bar and graph.
  const hint = '<div class="ui-foot se-hint">' + SP.ROWS_HINT + '</div>';
  // How to reorder alone: that the watch shows the rows top to bottom goes without saying (the
  // owner's, 2026-11-09).
  assert.equal(SP.ROWS_HINT, 'Drag\u00a0≡ to change the order.', '"Drag ≡" on one line');
  assert.ok(body.indexOf(hint) !== -1, 'how to reorder, as the Screens card says it');
  assert.ok(body.indexOf(hint) > body.indexOf('id="seList"') && body.indexOf(hint) < body.indexOf('<div class="se-adds">'),
    'under the rows, over the Add groups');
  // ✕ the Clock: the calendar and the clock, under one caption that names both.
  page.tapEditor({ se: 'rm', j: 1 });
  body = editorOf(page).body;
  assert.deepEqual(editorAddGroups(body).pop(), ['Add the calendar or the clock', 'Calendar', 'Clock']);
  assert.ok(body.indexOf('<div class="se-add" role="group" aria-labelledby="seAdd-rows"><span class="ui-cap" id="seAdd-rows">'
    + 'Add the calendar or the clock</span>') !== -1, 'the group named by its caption');
  assert.ok(body.indexOf(hint) !== -1, 'the bar and the graph still move');
  // ✕ the Health bar: one row left that moves, so nothing to reorder.
  page.tapEditor({ se: 'rm', j: 1 });
  assert.deepEqual(editorRows(editorOf(page).body), ['Watch bar', 'Health graph · Fill']);
  assert.equal(editorOf(page).body.indexOf('se-hint'), -1);
  // The Watch bar is a status bar: ✕ it, and its chip comes back in that group.
  page.tapEditor({ se: 'rm', j: 0 });
  assert.deepEqual(editorAddGroups(editorOf(page).body)[0], ['Add a status bar', 'Watch bar', 'Forecast bar', 'Radar bar',
    'Health bar']);
});

test('+ Health bar on a new screen draws the bar\'s default readings, not an empty row', () => {
  const page = bootGeneratedPage(Object.assign({ provider: 'dwd' }, BLANK_HEALTH));
  page.tapAction('addScreen');
  page.tapEditor({ se: 'pick', id: 'radar' });
  page.tapEditor({ se: 'addnow' });
  page.tapEditor({ se: 'add', k: 'healthbar' });
  const pic = /<span class="se-pic-card"[\s\S]*?<\/span><\/div>/.exec(editorOf(page).body)[0];
  assert.match(pic, />6\.2k</, 'steps');
  assert.match(pic, />7h12</, 'sleep');
  assert.deepEqual(slotsOf(page.S, 'health'), ['steps', 'empty', 'sleep']);
});

test('the editor: a row\'s dropdown opens its picker; a pick, a move, a ✕ and + Add, each stored at once', () => {
  const page = bootGeneratedPage(THREE);
  page.tapAction('openScreen', 0);
  let ed = editorOf(page);
  assert.equal(ed.title, 'Default');
  assert.deepEqual(editorRows(ed.body), ['Watch bar', 'Calendar · 2 rows', 'Clock', 'Forecast bar', 'Forecast graph · Fill']);
  assert.equal(ed.body.indexOf('aria-label="Remove Clock"'), -1, 'the Default screen keeps its Clock');
  assert.equal(ed.body.indexOf('Delete screen'), -1, 'nor can the Default screen go');
  // The forecast graph's Size: its picker over the editor, titled by the row; never 2 rows (the
  // high and low would overlap), each greyed-out size saying why, Fill said in words.
  page.tapEditor({ se: 'size', j: 4 });
  assert.ok(page.editor(), 'the editor stays under the picker');
  assert.equal(sheetTitle(page, 'screenRowSize'), 'Forecast graph size');
  assert.deepEqual(sheetOptions(page), ['2 rows (off: Too small for the high and low temperatures)', '3 rows', '4 rows',
    'Fill ✓ (All the room the other rows leave)']);
  page.pickOption('screenRowSize', '3');
  assert.deepEqual(M.screensOf(page.S, page.S.env)[0][4], b('fc', { size: '3' }));
  assert.equal(page.S.layoutPreset, 'custom', 'the first edit turned the preset custom');
  assert.deepEqual(editorRows(editorOf(page).body)[4], 'Forecast graph · 3 rows', 'the editor repaints as the picker closes');
  // A greyed-out size is never taken, whatever asks for it: not even into the stored key, which
  // reads back as 3 rows (the watch clamps the forecast to 3).
  assert.equal(page.S.viewBodySize0, '3', 'premise: the key the size is stored in');
  page.tapEditor({ se: 'size', j: 4 });
  page.pickOption('screenRowSize', '2');
  assert.equal(page.S.viewBodySize0, '3');
  // The calendar's rows.
  page.tapEditor({ se: 'size', j: 1 });
  assert.equal(sheetTitle(page, 'screenRowSize'), 'Calendar rows');
  assert.deepEqual(sheetOptions(page), ['2 rows ✓', '3 rows']);
  page.pickOption('screenRowSize', '3');
  assert.deepEqual(editorRows(editorOf(page).body)[1], 'Calendar · 3 rows');
  // Under the calendar's 3 rows, 4 rows of graph would not fit the watch: greyed out, saying why.
  page.tapEditor({ se: 'size', j: 4 });
  assert.deepEqual(sheetOptions(page), ['2 rows (off: Too small for the high and low temperatures)', '3 rows ✓',
    '4 rows (off: Too tall for the watch)', 'Fill (All the room the other rows leave)']);
  page.pickOption('screenRowSize', '3');
  // Move the Forecast bar above the Clock (its ≡ and the arrow keys), then remove it, then add it back.
  page.docDispatch('keydown', { key: 'ArrowUp', target: grip(3), preventDefault() {} });
  assert.deepEqual(editorRows(editorOf(page).body), ['Watch bar', 'Calendar · 3 rows', 'Forecast bar', 'Clock',
    'Forecast graph · 3 rows']);
  page.tapEditor({ se: 'rm', j: 2 });
  assert.deepEqual(editorRows(editorOf(page).body), ['Watch bar', 'Calendar · 3 rows', 'Clock', 'Forecast graph · 3 rows']);
  page.tapEditor({ se: 'add', k: 'fcbar' });
  assert.deepEqual(editorRows(editorOf(page).body), ['Watch bar', 'Calendar · 3 rows', 'Clock', 'Forecast bar',
    'Forecast graph · 3 rows'], 'at its natural place: above the bottom graph');
  // Each edit is on the page at once: the Screens card under the editor follows.
  assert.equal(cardRows(page.scroll.innerHTML)[0][1], 'Calendar · Clock · Forecast bar · Forecast graph');
});

/**
 * An editor row's ≡ as the browser hands it to the listeners.
 * @param {number} j The row.
 * @returns {Object}
 */
function grip(j) {
  const g = { getAttribute: (n) => (n === 'data-grip' ? String(j) : null), setPointerCapture() {} };
  g.closest = (sel) => (sel === '[data-grip]' ? g : null);
  return g;
}

test('Add: a chip per status bar, by its name, in the bars\' place; a tap puts the bar there at once', () => {
  const page = bootGeneratedPage(Object.assign({ statusRadarName: 'Sky' }, THREE));
  page.tapAction('openScreen', 1);
  let body = editorOf(page).body;
  // Flick 1 shows the Health bar: the other two by their names, in the status bars' group. No
  // picker, and no New status bar on a watch without bars 4 to 6.
  assert.deepEqual(editorAddChips(body), ['Forecast bar', 'Sky', 'Forecast graph', 'Rain radar', 'Calendar']);
  assert.ok(body.indexOf(ui.chip('Sky', { 'data-se': 'add', 'data-k': 'radarbar' }, { icon: 'plus' })) !== -1);
  assert.equal(body.indexOf('data-se="newbar"'), -1);
  // A bar the screen shows is never added again, whatever asks for it.
  page.tapEditor({ se: 'add', k: 'healthbar' });
  assert.deepEqual(M.screensOf(page.S, BASALT)[1].map((x) => x.k), ['strip', 'clock', 'healthbar', 'health']);
  // A tap: the bar above the bottom graph, the editor repainted.
  page.tapEditor({ se: 'add', k: 'radarbar' });
  assert.deepEqual(M.screensOf(page.S, BASALT)[1].map((x) => x.k), ['strip', 'clock', 'healthbar', 'radarbar', 'health']);
  body = editorOf(page).body;
  assert.deepEqual(editorRows(body), ['Watch bar', 'Clock', 'Health bar', 'Sky', 'Health graph · Fill']);
  // Two bars: a screen's most, so no bar chips, and a forged tap adds no third.
  assert.deepEqual(editorAddChips(body), ['Forecast graph', 'Calendar']);
  page.tapEditor({ se: 'add', k: 'fcbar' });
  assert.equal(M.screensOf(page.S, BASALT)[1].length, 5);
});

test('the editor\'s rows: the calendar\'s rows and a graph\'s size are dropdowns, a bar and the forecast graph have Edit; nothing folds or shows twice', () => {
  const page = bootGeneratedPage(THREE);
  page.tapAction('openScreen', 0);
  const body = editorOf(page).body;
  // The Calendar: its name, its rows as the page's dropdown (which opens its picker), its ✕.
  assert.ok(editorRow(body, 1).indexOf('<div class="se-mid"><span class="se-name">Calendar</span><span class="se-ctl">'
    + ui.dropdown('2 rows', { 'data-se': 'size', 'data-j': 1, 'aria-haspopup': 'dialog', 'aria-label': 'Rows: 2 rows' })
    + '</span></div>') !== -1, editorRow(body, 1));
  // A graph: its size the same way (no graph picker on a watch with one graph), then the
  // forecast graph's Edit, which opens its dialog over the editor (the owner's ask, 2026-11-10).
  assert.ok(editorRow(body, 4).indexOf('<span class="se-ctl">'
    + ui.dropdown('Fill', { 'data-se': 'size', 'data-j': 4, 'aria-haspopup': 'dialog', 'aria-label': 'Size: Fill' })
    + ui.editButton('Edit', { 'data-se': 'editgraph', 'data-j': 4, 'aria-haspopup': 'dialog',
      'aria-label': 'Edit ' + editorRows(body)[4].split(' · ')[0] })
    + '</span>') !== -1, editorRow(body, 4));
  // A bar: its Edit, which opens the bar's dialog over the editor (the owner's pick, B,
  // 2026-11-10). Its Add chip picked which bar.
  assert.ok(editorRow(body, 3).indexOf('<div class="se-mid"><span class="se-name">Forecast bar</span><span class="se-ctl">'
    + ui.editButton('Edit', { 'data-se': 'editbar', 'data-j': 3, 'aria-haspopup': 'dialog', 'aria-label': 'Edit Forecast bar' })
    + '</span></div>') !== -1, editorRow(body, 3));
  // The Clock: its name alone.
  assert.ok(editorRow(body, 2).indexOf('<div class="se-mid"><span class="se-name">Clock</span></div>') !== -1);
  // Nothing folds, nothing is said twice, no move buttons, no graph picker; Edit on the bars and the graph.
  ['class="chev', 'aria-expanded', 'se-val', 'se-more', 'Also on', 'Move up', 'Move down', 'data-se="style"'].forEach((gone) => {
    assert.equal(body.indexOf(gone), -1, gone);
  });
  assert.deepEqual([...body.matchAll(/data-se="editbar" data-j="(\d+)"/g)].map((m) => Number(m[1])), [0, 3],
    'the Watch bar and the Forecast bar');
  // The ≡ is a button the arrow keys move; the Watch bar has none.
  assert.ok(editorRow(body, 1).indexOf('<button type="button" class="se-grip" data-grip="1" title="Drag to move" '
    + 'aria-label="Move Calendar (arrow keys)">' + ui.icon('grip') + '</button>') !== -1, editorRow(body, 1));
  assert.equal(editorRow(body, 0).indexOf('data-grip'), -1);
});

test('the editor: a bar\'s Edit opens its dialog over the editor, which shows what Done kept and nothing × put back', () => {
  const page = bootGeneratedPage(THREE);
  page.tapAction('openScreen', 0);
  page.tapEditor({ se: 'editbar', j: 3 });
  let dlg = page.modal.innerHTML;
  assert.ok(dlg.indexOf('id="esheet-ttl-bar-forecast">Forecast bar</span>') !== -1, 'the Forecast bar\'s dialog');
  assert.ok(dlg.indexOf('<span class="dlg-kick">Default</span>') !== -1, 'opened from the screen');
  assert.equal(dlg.indexOf('data-dlg-rename-ok'), -1, 'its name is not open to type');
  page.renameDialog();
  page.enterRename('Commute');
  page.doneDialog();
  assert.equal(page.modal.innerHTML, '', 'the dialog closed');
  assert.ok(page.editor(), 'back in the editor');
  assert.equal(page.S.statusForecastName, 'Commute');
  assert.deepEqual(editorRows(editorOf(page).body).slice(3, 4), ['Commute'], 'the row says the name Done kept');
  // × puts back what the dialog changed, and the editor shows it.
  page.tapEditor({ se: 'editbar', j: 3 });
  page.renameDialog();
  page.enterRename('Errands');
  page.cancelDialog();
  assert.equal(page.S.statusForecastName, 'Commute');
  assert.deepEqual(editorRows(editorOf(page).body).slice(3, 4), ['Commute']);
  // The Watch bar's Edit opens the Watch bar's dialog.
  page.tapEditor({ se: 'editbar', j: 0 });
  dlg = page.modal.innerHTML;
  assert.ok(dlg.indexOf('id="esheet-ttl-bar-top">Watch bar</span>') !== -1, 'the Watch bar\'s dialog');
  page.doneDialog();
  // A forged Edit on a row that shows no bar (the Clock) opens nothing.
  page.tapEditor({ se: 'editbar', j: 2 });
  assert.equal(page.modal.innerHTML, '');
});

test('the editor: the forecast graph\'s Edit opens the graph the screen draws in its dialog over the editor', () => {
  // A watch with one graph: its one graph's dialog, opened from the screen.
  const page = bootGeneratedPage(THREE);
  page.tapAction('openScreen', 0);
  page.tapEditor({ se: 'editgraph', j: 4 });
  let dlg = page.modal.innerHTML;
  assert.ok(dlg.indexOf('id="esheet-ttl-graph"') !== -1, 'the graph\'s dialog');
  assert.ok(dlg.indexOf('<span class="dlg-kick">Default</span>') !== -1, 'opened from the screen');
  page.doneDialog();
  assert.equal(page.modal.innerHTML, '', 'the dialog closed');
  assert.ok(page.editor(), 'back in the editor');
  // A forged Edit on a row that is no forecast graph (the Clock) opens nothing.
  page.tapEditor({ se: 'editgraph', j: 2 });
  assert.equal(page.modal.innerHTML, '');
  // The Pebble Time 2: the graph the screen draws, here the second of two.
  const GS = require('../src/pkjs/forecast-graphs/domain/graph-styles.js');
  const two = { provider: 'dwd', layoutPreset: 'custom', radarMode: 'off', healthMode: 'off', forecastHours: '24',
    viewCount: '2', viewTop0: 'cal', viewBody0: 'forecast', viewStyle0: '1', viewTop1: 'none', viewBody1: 'forecast',
    viewStyle1: '2', graphStyles: GS.withName({ graphStyles: GS.withStyle({}, 1, { forecastHours: '48' }) }, 1, 'Long') };
  const e = bootGeneratedPage(two, 'emery');
  e.tapAction('openScreen', 1);
  const j = M.idxOf(M.screensOf(e.S, platform.computeEnv({ platform: 'emery' }))[1], 'fc');
  assert.match(editorOf(e).body, new RegExp('data-se="editgraph" data-j="' + j + '"'));
  e.tapEditor({ se: 'editgraph', j: j });
  assert.ok(e.modal.innerHTML.indexOf('id="esheet-ttl-graph">Long</span>') !== -1, 'Long\'s dialog');
  assert.equal(e.S.forecastHours, '48', 'Long in the dialog');
  e.doneDialog();
  assert.equal(e.S.forecastHours, '24', 'closed: the first graph back in the flat keys');
});

test('the editor\'s ≡ and the arrow keys: a row moves a place, keeps the focus, and a move that breaks a rule stays with why', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const page = bootGeneratedPage(THREE);
  page.tapAction('openScreen', 0);
  const ed = page.editor();
  const key = (j, k) => page.docDispatch('keydown', { key: k, target: grip(j), preventDefault() {} });
  key(2, 'ArrowDown');
  assert.deepEqual(M.screensOf(page.S, BASALT)[0].map((x) => x.k), ['strip', 'cal', 'fcbar', 'clock', 'fc']);
  assert.equal(ed.querySelector('[data-grip="3"]').focuses, 1, 'the ≡ keeps the focus at its new place');
  // The graph above the bar: with a calendar it stays at the bottom, and the toast says so.
  key(4, 'ArrowUp');
  assert.deepEqual(M.screensOf(page.S, BASALT)[0].map((x) => x.k), ['strip', 'cal', 'fcbar', 'clock', 'fc'], 'nothing moved');
  assert.equal(ed.querySelector('[data-se-toast]').textContent, 'With a calendar, the graph stays at the bottom.');
  assert.equal(ed.querySelector('[data-grip="4"]').focuses, 1, 'the focus stays on the ≡ that did not move');
  t.mock.timers.tick(3000);
  assert.equal(ed.querySelector('[data-se-toast]').textContent, '');
  // Nowhere to go below the last row; other keys do nothing.
  key(4, 'ArrowDown');
  key(1, 'Enter');
  assert.deepEqual(M.screensOf(page.S, BASALT)[0].map((x) => x.k), ['strip', 'cal', 'fcbar', 'clock', 'fc']);
  assert.ok(page.editor(), 'still open');
  // Escape closes the editor.
  page.docDispatch('keydown', { key: 'Escape' });
  assert.equal(page.editor(), null);
});

test('the Screens card\'s rows open a screen of their own, so each ends on the red arrow', () => {
  const page = bootGeneratedPage(THREE);
  const html = page.scroll.innerHTML;
  [0, 1, 2].forEach((i) => {
    // The card's row (the pictures pinned over the card open the editor too, by the picture).
    const row = html.indexOf('<div class="ui-row scr-row" data-scr-row="' + i + '">');
    assert.ok(row !== -1, 'row ' + i);
    const at = html.indexOf('data-action="openScreen" data-action-arg="' + i + '"', row);
    const end = html.indexOf('</button>', at) + '</button>'.length;
    assert.ok(html.slice(at, end).endsWith(ui.navArrow() + '</button>'), html.slice(at, end));
  });
});

test('a drag by the handle moves a row; one that breaks a rule snaps back and says which', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const page = bootGeneratedPage(THREE);
  page.tapAction('openScreen', 0);
  const ed = page.editor();
  // The list's rows as the browser lays them out: 40 px each, from the top.
  ed.querySelector('#seList').children = [0, 1, 2, 3, 4].map((j) => ({ style: {},
    classList: { add() {}, remove() {} }, getBoundingClientRect: () => ({ top: j * 40, height: 40 }) }));
  const drag = (j, from, to, id) => {
    ed.dispatch('pointerdown', { target: grip(j), clientY: from, pointerId: id, button: 0, preventDefault() {} });
    ed.dispatch('pointermove', { clientY: to, pointerId: id });
    ed.dispatch('pointerup', { pointerId: id });
    t.mock.timers.tick(0);   // the click a drag ends in is not a tap
  };
  // The Forecast graph dragged up under the Watch bar: with a calendar it stays at the bottom.
  drag(4, 180, 50, 1);
  const toast = ed.querySelector('[data-se-toast]');
  assert.equal(toast.textContent, 'With a calendar, the graph stays at the bottom.');
  assert.deepEqual(M.screensOf(page.S, BASALT)[0], DEFAULT_SCREENS[0], 'nothing moved');
  t.mock.timers.tick(3000);
  assert.equal(toast.textContent, '', 'the note goes after three seconds');
  // The Forecast bar dragged above the Clock keeps every rule: it moves.
  drag(3, 140, 90, 2);
  assert.deepEqual(M.screensOf(page.S, BASALT)[0].map((x) => x.k), ['strip', 'cal', 'fcbar', 'clock', 'fc']);
  assert.equal(toast.textContent, '');
});

test('Delete screen at the foot of a flick screen\'s editor', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const page = bootGeneratedPage(THREE);
  page.tapAction('openScreen', 2);
  page.tapEditor({ se: 'delscreen' });
  assert.equal(page.editor(), null, 'the editor closes');
  assert.deepEqual(cardRows(page.scroll.innerHTML).map((r) => r[0]), ['Default', 'Flick 1']);
  assert.ok(page.scroll.innerHTML.indexOf('Flick 2 deleted.') !== -1, 'with its Undo');
});

test('the radar off: the Rain radar row says so with a way back on, and the picture draws without it', () => {
  const page = bootGeneratedPage(THREE);
  page.clickTab('setup');
  page.openSelect('radarSource');
  page.pickOption('radarSource', 'off');
  assert.equal(page.S.radarEnabled, false);
  assert.equal(page.S.radarProvider, 'rainbow', 'the source is kept');
  page.clickTab('watchface');
  assert.equal(cardRows(page.scroll.innerHTML)[2][1], 'Clock · Radar bar · Rain radar (off)');
  page.tapAction('openScreen', 2);
  let ed = editorOf(page);
  assert.ok(ed.body.indexOf('<div class="se-sub se-off"><span>The rain radar is off.</span>'
    + '<button type="button" class="se-link" data-se="radaron">Turn on</button></div>') !== -1);
  assert.match(ed.body, /aria-label="Flick 2: Clock · Radar bar · Rain radar \(off\)"/);
  page.tapEditor({ se: 'radaron' });
  ed = editorOf(page);
  assert.equal(page.S.radarEnabled, true);
  assert.equal(page.S.radarProvider, 'rainbow');
  assert.equal(ed.body.indexOf('The rain radar is off.'), -1);
  assert.equal(page.S.radarMode, 'graph');
});

test('Save writes the modes the screens work out, and the Rain radar picker\'s two keys', async () => {
  const page = bootGeneratedPage(THREE);
  page.tapAction('deleteScreen', 2);   // the Rain radar screen
  page.tapAction('deleteScreen', 1);   // the Health screen
  let blob = await page.save();
  // Rain stays ticked on the Watch bar (the default), so the radar is still fetched for it.
  assert.deepEqual([blob.layoutPreset, blob.viewCount, blob.radarMode, blob.healthMode],
    ['custom', '1', 'countdown', 'off']);
  assert.equal(blob.radarSource, undefined, 'the picker itself is page-only');
  // The radar off: no fetch, the source kept.
  const off = bootGeneratedPage(Object.assign({ radarProvider: 'dwd' }, THREE));
  off.clickTab('setup');
  off.openSelect('radarSource');
  off.pickOption('radarSource', 'off');
  blob = await off.save();
  assert.deepEqual([blob.radarEnabled, blob.radarProvider, blob.radarMode, blob.healthMode], [false, 'dwd', 'off', 'all']);
});

test('aplite: the Layout card, no Screens card, no Rain radar row', () => {
  const page = bootGeneratedPage(THREE, 'aplite');
  const html = page.scroll.innerHTML;
  assert.deepEqual((html.match(/data-k="layoutPreset" data-v="[^"]*"/g) || []).map((x) => /data-v="([^"]*)"/.exec(x)[1]),
    ['fullCal', 'compactCal', 'noCal']);
  assert.equal(cardRows(html).length, 0, 'no Screens card');
  assert.equal(html.indexOf('data-action="openScreen"'), -1, 'the pinned screen is a picture');
  page.clickTab('setup');
  assert.equal(page.scroll.innerHTML.indexOf('data-select="radarSource"'), -1);
});
