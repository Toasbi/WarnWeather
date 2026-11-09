'use strict';
// test/config-screen-presets.test.js — screens with names, an order and presets (2.7): a
// screen's name (screens.js nameOf, the page-only viewName keys), a move to another place
// (screens-page.js moveScreen: the top screen is the Default, which always shows the clock),
// the presets Add screen offers after Blank (screen-presets.js) with the graph each brings on
// a Pebble Time 2 (graph-styles-page.js presetGraph) and why one is greyed out, then the REAL
// generated page (test/helpers/page-harness.js): the Screens card's ≡, the Add a screen sheet
// and the editor's rename.
const test = require('node:test');
const assert = require('node:assert/strict');
require('../src/pkjs/config-ui/lib/schema-walk.js');
require('../src/pkjs/config-ui/lib/color.js');
require('../src/pkjs/config-ui/lib/show-when.js');
require('../src/pkjs/config-ui/lib/engine.js');
require('../src/pkjs/settings/blocks.js');
const SP = require('../src/pkjs/settings/screens-page.js');
const GSP = require('../src/pkjs/settings/graph-styles-page.js');
const GS = require('../src/pkjs/graph-styles.js');
const M = require('../src/pkjs/screens.js');
const P = require('../src/pkjs/screen-presets.js');
const VC = require('../src/pkjs/view-cycle.js');
const WS = require('../src/pkjs/settings/wizard-screens.js');
const platform = require('../src/pkjs/config-ui/lib/platform.js');
const schema = require('../src/pkjs/settings/schema.js');
const { bootGeneratedPage } = require('./helpers/page-harness.js');

const PC = global.PConf;
const BASALT = platform.computeEnv({ platform: 'basalt' });
const EMERY = platform.computeEnv({ platform: 'emery' });
const CHALK = platform.computeEnv({ platform: 'chalk' });
const APLITE = platform.computeEnv({ platform: 'aplite' });
const DIORITE = platform.computeEnv({ platform: 'diorite' });
const FLINT = platform.computeEnv({ platform: 'flint' });
const b = (k, o) => Object.assign({ k }, o || {});
// An upgraded install's three screens (compactCal, health all, radar graph): Default, the
// Health screen, the Rain radar screen.
const THREE = { provider: 'dwd', radarMode: 'graph', healthMode: 'all' };
const HEALTH = [b('strip'), b('clock'), b('healthbar'), b('health', { size: 'fill' })];
const RADAR = [b('strip'), b('clock'), b('radarbar'), b('radar', { size: 'fill' })];

/**
 * A new install's settings on a watch: the schema's defaults, hydrated as the page does.
 * @param {Object} env Platform env.
 * @param {Object} [over] Keys to set.
 * @returns {Object}
 */
function fresh(env, over) {
  return Object.assign(PC.engine.hydrate(schema, {}, env), { provider: 'dwd' }, over || {});
}

/**
 * A custom layout of the given screens, on a new install's defaults.
 * @param {Object} env Platform env.
 * @param {Array<Array<Object>>} lists The screens, the Default first.
 * @param {Object} [over] Keys to set.
 * @returns {Object}
 */
function withScreens(env, lists, over) {
  const S = fresh(env, over);
  SP.ensureCustom(S, env);
  lists.forEach((l, i) => Object.assign(S, M.compileKeys(l, i)));
  S.viewCount = String(lists.length);
  SP.applyModes(S, env);
  return S;
}

/**
 * The CLAY_VIEW words a settings blob compiles to.
 * @param {Object} S Settings.
 * @param {Object} env Platform env.
 * @returns {number[]}
 */
function words(S, env) {
  return VC.resolveViewCycle(S, env).map((v) => VC.packWire(v || null));
}

/**
 * Every screen's name.
 * @param {Object} S Settings.
 * @param {Object} env Platform env.
 * @returns {string[]}
 */
function names(S, env) {
  return M.screensOf(S, env).map((l, i) => M.nameOf(S, i));
}

// --- names -----------------------------------------------------------------------------

test('a screen\'s name: its own, else its place\'s; trimmed, 24 characters at most', () => {
  assert.equal(M.nameOf({}, 0), 'Default');
  assert.equal(M.nameOf({ viewName1: '' }, 1), 'Flick 1');
  assert.equal(M.nameOf({ viewName2: '  Rain  ' }, 2), 'Rain');
  assert.equal(M.nameOf({ viewName0: '   ' }, 0), 'Default', 'blank is no name');
  assert.equal(M.cleanName('x'.repeat(30)).length, M.NAME_MAX);
  assert.equal(M.NAME_MAX, 24);
  const S = {};
  SP.renameScreen(S, 1, '  Weekend ');
  assert.equal(S.viewName1, 'Weekend');
  SP.renameScreen(S, 1, 'Flick 1');
  assert.equal(S.viewName1, '', 'the place\'s own name stores none: the screen keeps reading as its place');
  SP.renameScreen(S, 0, '');
  assert.equal(S.viewName0, '');
});

test('the names are the page\'s own: in the schema, never compiled', () => {
  const S = withScreens(BASALT, [M.screensOf(fresh(BASALT), BASALT)[0], HEALTH]);
  const before = words(S, BASALT);
  S.viewName0 = 'Home';
  S.viewName1 = 'Steps';
  assert.deepEqual(words(S, BASALT), before, 'the watch draws the same views');
  assert.equal(Object.keys(M.compileKeys(HEALTH, 1)).some((k) => /^viewName/.test(k)), false);
  assert.deepEqual(names(S, BASALT), ['Home', 'Steps']);
});

// --- moving a screen -------------------------------------------------------------------

test('a move: the screens in between shift a place, their keys, names and graphs along', () => {
  const S = withScreens(EMERY, [M.screensOf(fresh(EMERY), EMERY)[0], HEALTH, RADAR], { viewName1: 'Steps' });
  const w = words(S, EMERY);
  assert.equal(SP.moveScreen(S, 2, 0, EMERY), '');
  assert.deepEqual(words(S, EMERY), [w[2], w[0], w[1]], 'each screen draws what it drew, in its new place');
  assert.deepEqual(names(S, EMERY), ['Default', 'Flick 1', 'Steps'],
    'the top one is the Default; an unnamed one reads as its new place');
  assert.equal(S.viewClockOff1, false, 'the old Default keeps the clock it had');
  assert.equal(S.viewClockOff0, undefined, 'the top screen has no Clock off');
  assert.equal(SP.moveScreen(S, 0, 2, EMERY), '');
  assert.deepEqual(words(S, EMERY), [w[0], w[1], w[2]], 'and back');
  assert.deepEqual(names(S, EMERY), ['Default', 'Steps', 'Flick 2']);
  assert.deepEqual([S.radarMode, S.healthMode], ['graph', 'all'], 'the modes follow the screens');
});

test('a forecast screen moves with its graph', () => {
  const S = withScreens(EMERY, [M.screensOf(fresh(EMERY), EMERY)[0], [b('strip'), b('clock'),
    b('fc', { size: 'fill', style: '2' })]], { graphStyles: JSON.stringify({ names: ['', '', ''],
    styles: [null, { forecastHours: '24' }, null] }) });
  assert.equal(SP.moveScreen(S, 1, 0, EMERY), '');
  assert.equal(S.viewStyle0, '2', 'the screen at the top draws the second graph');
  assert.equal(S.viewStyle1, '1');
});

test('a screen moved to the top gets the clock; one with no room for it stays, and says why', () => {
  const noClock = [b('strip'), b('healthbar'), b('health', { size: 'fill' })];
  const S = withScreens(BASALT, [M.screensOf(fresh(BASALT), BASALT)[0], noClock]);
  assert.equal(S.viewClockOff1, true, 'premise: the flick screen has no clock');
  assert.equal(SP.moveScreen(S, 1, 0, BASALT), '');
  assert.deepEqual(M.screensOf(S, BASALT)[0], [b('strip'), b('clock'), b('healthbar'), b('health', { size: 'fill' })]);
  // A 3-row calendar, two bars and a graph: a flick screen without the clock fits, the
  // Default with it does not.
  const tall = [b('strip'), b('cal', { rows: '3' }), b('fcbar'), b('radarbar'), b('fc', { size: 'fill' })];
  assert.ok(M.fits(tall, 1, 'basalt') && !M.fits(M.add(tall, 'clock'), 0, 'basalt'), 'premise');
  const T = withScreens(BASALT, [M.screensOf(fresh(BASALT), BASALT)[0], tall], { viewName1: 'Tall' });
  const kept = JSON.stringify(T);
  assert.equal(SP.moveScreen(T, 1, 0, BASALT), 'Tall' + SP.NO_ROOM_FOR_CLOCK);
  assert.equal(JSON.stringify(T), kept, 'nothing moved');
});

test('a move with nowhere to go changes nothing', () => {
  const S = withScreens(BASALT, [M.screensOf(fresh(BASALT), BASALT)[0], HEALTH]);
  const kept = JSON.stringify(S);
  [[1, 1], [0, 2], [-1, 0], [2, 0]].forEach(([from, to]) => assert.equal(SP.moveScreen(S, from, to, BASALT), ''));
  assert.equal(JSON.stringify(S), kept);
});

test('a delete and an insert carry the names with their screens', () => {
  const S = withScreens(BASALT, [M.screensOf(fresh(BASALT), BASALT)[0], HEALTH, RADAR],
    { viewName1: 'Steps', viewName2: 'Rain' });
  assert.equal(SP.deleteScreen(S, 1, BASALT), true);
  assert.deepEqual(names(S, BASALT), ['Default', 'Rain']);
  assert.equal(SP.insertScreen(S, 1, M.copy(HEALTH), BASALT), true);
  assert.deepEqual(names(S, BASALT), ['Default', 'Flick 1', 'Rain'], 'a screen put in starts with its place\'s name');
});

// --- the presets -----------------------------------------------------------------------

test('the presets: the owner\'s six, each keeping the screens\' rules; each watch gets the ones it can draw', () => {
  assert.deepEqual(P.PRESETS.map((p) => p.name),
    ['Classic', 'Weathergraph', 'Clean', 'Stripes', 'Health + calendar', 'Health']);
  P.PRESETS.forEach((p) => {
    assert.equal(M.problem(p.list), '', p.id + ' keeps the rules');
    assert.equal(M.idxOf(p.list, 'strip'), 0, p.id + ': the Watch bar first');
    assert.ok(M.idxOf(p.list, 'clock') >= 0, p.id + ' shows the clock');
  });
  assert.deepEqual(P.BLANK, [b('strip'), b('clock')]);
  assert.deepEqual(P.offered(EMERY).map((p) => p.id), ['classic', 'weathergraph', 'clean', 'stripes', 'healthCal', 'health']);
  assert.deepEqual(P.offered(BASALT).map((p) => p.id), ['classic', 'stripes', 'healthCal', 'health'],
    'Weathergraph and Clean need the Pebble Time 2\'s graphs');
  assert.deepEqual(P.offered(APLITE).map((p) => p.id), ['classic', 'stripes'], 'no health');
  assert.equal(P.offered(null).length, 6, 'an unknown watch is capable');
  // Each fits as a flick screen on every watch that is offered it (Add screen offers them all).
  [EMERY, BASALT, CHALK, DIORITE, FLINT].forEach((env) => P.offered(env).forEach((p) =>
    assert.ok(M.fits(p.list, 1, env.platform), p.id + ' fits on ' + env.platform)));
  assert.deepEqual(P.offered(EMERY).filter((p) => p.look).map((p) => [p.id, p.look]),
    [['classic', 'classic'], ['weathergraph', 'clean'], ['clean', 'clean'], ['stripes', 'stripes']]);
});

test('a card\'s line: on a watch with one graph a forecast preset says it keeps yours', () => {
  assert.equal(P.describe(P.byId('classic'), EMERY), 'ForecasWatch2\'s look, 24 h.');
  assert.equal(P.describe(P.byId('classic'), BASALT), '3-row calendar, Forecast bar and your graph.');
  assert.equal(P.describe(P.byId('health'), BASALT), 'Health bar and health graph.');
  assert.equal(P.byId('nope'), null);
});

test('Add a screen on a basalt: Blank first, then its presets; one of your screens already is greyed out', () => {
  const S = fresh(BASALT);
  const choices = SP.addChoices(S, BASALT);
  assert.deepEqual(choices.map((c) => c.id), ['blank', 'classic', 'stripes', 'healthCal', 'health']);
  assert.deepEqual(choices.map((c) => c.why), ['', '', SP.ALREADY, '', ''],
    'a new install\'s Default is Stripes\' rows (2-row calendar, clock, Forecast bar, graph)');
  assert.deepEqual(choices[0].list, P.BLANK);
  assert.equal(choices[0].desc, 'Watch bar and clock. You add the rest.');
  assert.ok(choices.every((c) => c.graph === null), 'one graph: no preset brings one');
  // Each choice's picture settings hold the screen it adds, after the others.
  choices.forEach((c) => assert.deepEqual(M.screensOf(c.W, BASALT)[1], c.list, c.id + '\'s picture'));
  assert.equal(JSON.stringify(S), JSON.stringify(fresh(BASALT)), 'reading the choices changes nothing');
  // The Health screen there already: Health is greyed out too.
  const two = withScreens(BASALT, [M.screensOf(fresh(BASALT), BASALT)[0], HEALTH]);
  assert.equal(SP.addChoices(two, BASALT).filter((c) => c.id === 'health')[0].why, SP.ALREADY);
  // Three screens: nothing to add.
  assert.deepEqual(SP.addChoices(withScreens(BASALT, [M.screensOf(fresh(BASALT), BASALT)[0], HEALTH, RADAR]), BASALT), []);
});

test('adding a preset: its rows after the others, named after it; Blank keeps its place\'s name', () => {
  const S = fresh(BASALT);
  assert.equal(SP.addChosen(S, BASALT, 'healthCal'), 1);
  assert.deepEqual(M.screensOf(S, BASALT)[1], P.byId('healthCal').list);
  assert.equal(S.viewName1, 'Health + calendar');
  assert.equal(S.healthMode, 'all', 'the modes follow');
  assert.equal(SP.addChosen(S, BASALT, 'blank'), 2);
  assert.deepEqual(M.screensOf(S, BASALT)[2], P.BLANK);
  assert.equal(S.viewName2, '');
  assert.equal(SP.addChosen(S, BASALT, 'health'), -1, 'no fourth screen');
  // A greyed-out choice, or one that is not there, adds nothing.
  const T = fresh(BASALT), kept = JSON.stringify(T);
  assert.equal(SP.addChosen(T, BASALT, 'stripes'), -1, 'greyed out');
  assert.equal(SP.addChosen(T, BASALT, 'weathergraph'), -1, 'not offered on a basalt');
  assert.equal(JSON.stringify(T), kept);
});

test('a preset on a Pebble Time 2 brings its graph: a new one from its template, picked on the Graphs tab', () => {
  const S = fresh(EMERY);
  const c = SP.addChoices(S, EMERY).filter((x) => x.id === 'weathergraph')[0];
  assert.deepEqual([c.graph.k, Boolean(c.graph.values), c.why], [1, true, ''],
    'the first graph does not read as Clean: a new graph in the first free slot');
  assert.equal(SP.addChosen(S, EMERY, 'weathergraph'), 1);
  assert.equal(GS.count(S), 2);
  assert.equal(GS.name(S, 1), 'Graph 2');
  assert.equal(S.viewStyle1, '2', 'the new screen draws it');
  assert.equal(S[GSP.PICK], '2');
  assert.equal(S.viewName1, 'Weathergraph');
  assert.deepEqual(M.screensOf(S, EMERY)[1].map((x) => x.k), ['strip', 'clock', 'fcbar', 'fc', 'healthbar']);
  assert.equal(GS.settingsFor(S, 1).forecastHours, GSP.templateValues(S, EMERY, 'clean').forecastHours);
  // Clean reads as the same template: it uses that graph, and makes none.
  const clean = SP.addChoices(S, EMERY).filter((x) => x.id === 'clean')[0];
  assert.deepEqual([clean.graph.k, clean.graph.values, clean.why], [1, null, '']);
  assert.equal(SP.addChosen(S, EMERY, 'clean'), 2);
  assert.equal(GS.count(S), 2, 'no new graph');
  assert.equal(S.viewStyle2, '2');
});

test('a preset whose graph is one of yours already uses it; on the screen too, it is greyed out', () => {
  const tpl = GSP.templateValues(fresh(EMERY), EMERY, 'clean');
  const item = JSON.stringify({ names: ['', 'Long', ''], styles: [null, tpl, null] });
  const S = withScreens(EMERY, [M.screensOf(fresh(EMERY), EMERY)[0]], { graphStyles: item });
  const c = SP.addChoices(S, EMERY).filter((x) => x.id === 'weathergraph')[0];
  assert.deepEqual([c.graph.k, c.graph.values, c.why], [1, null, ''], 'Long reads as Clean');
  assert.equal(SP.addChosen(S, EMERY, 'weathergraph'), 1);
  assert.equal(GS.count(S), 2, 'no graph made');
  assert.equal(SP.addChoices(S, EMERY).filter((x) => x.id === 'weathergraph')[0].why, SP.ALREADY);
  // The same rows on another graph are not the preset.
  const other = withScreens(EMERY, [M.screensOf(fresh(EMERY), EMERY)[0], P.byId('weathergraph').list],
    { graphStyles: item });
  assert.equal(SP.addChoices(other, EMERY).filter((x) => x.id === 'weathergraph')[0].why, '',
    'its graph is the first, not Long');
});

test('no free graph slot, or a graph that would make too many lines: the preset is greyed out with the reason', () => {
  // Graphs 2 and 3 taken by graphs no preset reads as.
  const odd = { forecastHours: '12', secondaryLine: 'wind' };
  const full = withScreens(EMERY, [M.screensOf(fresh(EMERY), EMERY)[0]], {
    graphStyles: JSON.stringify({ names: ['', '', ''], styles: [null, odd, Object.assign({}, odd, { thirdLine: 'uv' })] })
  });
  const byId = (S) => SP.addChoices(S, EMERY).reduce((o, c) => { o[c.id] = c.why; return o; }, {});
  const whyFull = byId(full);
  ['classic', 'weathergraph', 'clean', 'stripes'].forEach((id) => assert.equal(whyFull[id], SP.NO_GRAPH_ROOM, id));
  assert.equal(whyFull.health, '', 'a preset with no forecast graph needs no graph');
  assert.equal(SP.addChosen(full, EMERY, 'stripes'), -1);
  // The first graph draws four series already: Stripes' cloud and rain-chance stripes make six.
  const busy = withScreens(EMERY, [M.screensOf(fresh(EMERY), EMERY)[0]], {
    secondaryLine: 'precip_prob', secondaryLineStyle: 'line', thirdLine: 'wind', fourthLine: 'uv', fifthLine: 'gust'
  });
  const why = byId(busy).stripes;
  assert.match(why, /^Also needs .*: that makes \d+ lines and stripes on your screens; the watch can show 5\.$/);
  const kept = JSON.stringify(busy);
  assert.equal(SP.addChosen(busy, EMERY, 'stripes'), -1);
  assert.equal(JSON.stringify(busy), kept, 'no graph made');
});

test('a watch with one graph: a forecast preset brings its rows and keeps your graph', () => {
  const S = fresh(BASALT, { secondaryLine: 'wind' });
  assert.equal(SP.addChosen(S, BASALT, 'classic'), 1);
  assert.deepEqual(M.screensOf(S, BASALT)[1], P.byId('classic').list);
  assert.equal(S.secondaryLine, 'wind', 'the graph as it was');
  assert.equal(S.graphStyles, fresh(BASALT).graphStyles, 'no graph made');
});

// --- setup ---------------------------------------------------------------------------

test('setup\'s Health screen is the Health preset, and setup names what it adds', () => {
  assert.deepEqual(WS.byId('health').list, P.byId('health').list);
  assert.equal(WS.nameOf(HEALTH, 1), 'Health', 'a screen added before names: its template');
  assert.equal(WS.nameOf(HEALTH, 1, { viewName1: 'Steps' }), 'Steps', 'its own name first');
  assert.equal(WS.nameOf([b('strip'), b('clock')], 0, { viewName0: 'Home' }), 'Home');
  assert.equal(WS.nameOf([b('strip'), b('clock')], 2), 'Flick 2');
});

// --- the page --------------------------------------------------------------------------

/**
 * The Screens card's rows: [name, its pill or '', a ≡].
 * @param {string} html The Watchface tab's markup.
 * @returns {Array<Array>}
 */
function cardRows(html) {
  const out = [];
  const re = /<div class="scr-row" data-scr-row="\d+">(<button type="button" class="scr-grip"[^>]*>)?[\s\S]*?<span class="scr-t">([^<]*)(?:<span class="scr-pill">([^<]*)<\/span>)?<\/span>/g;
  let m;
  while ((m = re.exec(html))) { out.push([m[2], m[3] || '', Boolean(m[1])]); }
  return out;
}

/**
 * A handle on the card as the browser hands it to the listeners.
 * @param {number} i The screen's place.
 * @returns {Object}
 */
function grip(i) {
  const g = { getAttribute: (n) => (n === 'data-scr-grip' ? String(i) : null), setPointerCapture() {} };
  g.closest = (sel) => (sel === '[data-scr-grip]' ? g : null);
  return g;
}

test('the Screens card: a ≡ on each screen with two or more, the line that says so, the arrow keys move', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const one = bootGeneratedPage({ provider: 'dwd' });
  assert.deepEqual(cardRows(one.scroll.innerHTML), [['Default', '', false]], 'one screen: nothing to move');
  assert.equal(one.scroll.innerHTML.indexOf(SP.REORDER_HINT), -1);
  const page = bootGeneratedPage(Object.assign({ viewName1: 'Steps' }, THREE));
  let html = page.scroll.innerHTML;
  assert.deepEqual(cardRows(html), [['Default', '', true], ['Steps', '', true], ['Flick 2', '', true]]);
  assert.ok(html.indexOf('<div class="scr-hint" id="scrHint">' + SP.REORDER_HINT + '</div>') !== -1);
  assert.ok(html.indexOf('aria-label="Move Steps (arrow keys)" aria-describedby="scrHint"') !== -1);
  const key = (i, k) => page.docDispatch('keydown', { key: k, target: grip(i), preventDefault() {} });
  key(1, 'ArrowUp');
  assert.deepEqual(cardRows(page.scroll.innerHTML).map((r) => r.slice(0, 2)),
    [['Steps', 'Default'], ['Flick 1', ''], ['Flick 2', '']], 'Steps is the Default now; its pill says so');
  assert.deepEqual(M.screensOf(page.S, BASALT).map((l) => l[l.length - 1].k), ['health', 'fc', 'radar']);
  key(0, 'ArrowUp');
  assert.deepEqual(M.screensOf(page.S, BASALT).map((l) => l[l.length - 1].k), ['health', 'fc', 'radar'],
    'nowhere to go above the top');
  key(0, 'ArrowDown');
  assert.deepEqual(cardRows(page.scroll.innerHTML).map((r) => r[0]), ['Default', 'Steps', 'Flick 2']);
  html = page.scroll.innerHTML;
  assert.equal(html.indexOf('scr-note'), -1, 'no reason to give');
});

test('a drag on the card moves a screen; one with no room for the clock snaps back and says why', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const tall = M.compileKeys([b('strip'), b('cal', { rows: '3' }), b('fcbar'), b('radarbar'), b('fc', { size: 'fill' })], 1);
  const page = bootGeneratedPage(Object.assign({ layoutPreset: 'custom', viewCount: '2', viewName1: 'Tall',
    radarMode: 'status' }, M.compileKeys(M.screensOf(fresh(BASALT), BASALT)[0], 0), tall));
  const rows = [0, 1].map((j) => ({ style: {}, classList: { add() {}, remove() {} },
    getBoundingClientRect: () => ({ top: j * 60, height: 60 }) }));
  const list = { classList: { add() {}, remove() {} }, querySelectorAll: () => rows };
  const press = (i, from, to, id) => {
    const g = grip(i);
    g.closest = (sel) => (sel === '[data-scr-grip]' ? g : sel === '.scr-list' ? list : null);
    page.docDispatch('pointerdown', { target: g, clientY: from, pointerId: id, button: 0, preventDefault() {} });
    page.docDispatch('pointermove', { clientY: to, pointerId: id });
    page.docDispatch('pointerup', { pointerId: id });
  };
  press(1, 90, 10, 1);
  assert.ok(page.scroll.innerHTML.indexOf('<div class="scr-note" role="status">Tall' + SP.NO_ROOM_FOR_CLOCK + '</div>') !== -1);
  assert.deepEqual(cardRows(page.scroll.innerHTML).map((r) => r[0]), ['Default', 'Tall'], 'nothing moved');
  t.mock.timers.tick(4000);
  assert.equal(page.scroll.innerHTML.indexOf('scr-note'), -1, 'the note goes after four seconds');
  // The Default dragged below it: Tall would be the top screen again, the same reason.
  press(0, 30, 110, 2);
  assert.ok(page.scroll.innerHTML.indexOf('Tall' + SP.NO_ROOM_FOR_CLOCK) !== -1);
  // A screen that fits with the clock moves.
  const ok = bootGeneratedPage(THREE);
  const rows3 = [0, 1, 2].map((j) => ({ style: {}, classList: { add() {}, remove() {} },
    getBoundingClientRect: () => ({ top: j * 60, height: 60 }) }));
  const list3 = { classList: { add() {}, remove() {} }, querySelectorAll: () => rows3 };
  const g = grip(2);
  g.closest = (sel) => (sel === '[data-scr-grip]' ? g : sel === '.scr-list' ? list3 : null);
  ok.docDispatch('pointerdown', { target: g, clientY: 150, pointerId: 3, button: 0, preventDefault() {} });
  ok.docDispatch('pointermove', { clientY: 10, pointerId: 3 });
  ok.docDispatch('pointerup', { pointerId: 3 });
  assert.deepEqual(M.screensOf(ok.S, BASALT).map((l) => l[l.length - 1].k), ['radar', 'fc', 'health']);
});

/**
 * The Add a screen sheet's cards: [id, name, line, greyed out].
 * @param {string} body The overlay's body.
 * @returns {Array<Array>}
 */
function sheetCards(body) {
  const out = [];
  const re = /<button type="button" class="sa-card[^"]*" data-se="pick" data-id="([^"]*)"( disabled)?>[\s\S]*?<span class="sa-n">([^<]*)<\/span><span class="sa-d">([^<]*)<\/span>/g;
  let m;
  while ((m = re.exec(body))) { out.push([m[1], m[3], m[4], Boolean(m[2])]); }
  return out;
}

test('+ Add screen opens Add a screen: Blank, then the presets with their pictures; a pick opens its editor', () => {
  const page = bootGeneratedPage({ provider: 'dwd' }, 'emery');
  page.tapAction('addScreen');
  const ed = page.editor();
  assert.equal(ed.querySelector('[data-se-title]').innerHTML, 'Add a screen');
  assert.equal(ed.querySelector('.se-done').style.display, 'none', 'nothing to be done: ‹ closes it');
  const body = ed.querySelector('[data-se-body]').innerHTML;
  assert.deepEqual(sheetCards(body).map((c) => c.slice(0, 2)), [['blank', 'Blank'], ['classic', 'Classic'],
    ['weathergraph', 'Weathergraph'], ['clean', 'Clean'], ['stripes', 'Stripes'], ['healthCal', 'Health + calendar'],
    ['health', 'Health']]);
  assert.ok(body.indexOf('class="sa-card wide" data-se="pick" data-id="blank"') !== -1, 'Blank across the top');
  assert.equal((body.match(/<span class="sa-pic" aria-hidden="true"><svg/g) || []).length, 7, 'a picture each');
  assert.ok(body.indexOf('A preset brings its graph, or uses one of yours that matches.') !== -1);
  page.tapEditor({ se: 'pick', id: 'weathergraph' });
  assert.equal(page.S.viewName1, 'Weathergraph');
  assert.equal(page.S.viewStyle1, '2');
  const title = ed.querySelector('[data-se-title]').innerHTML;
  assert.ok(title.indexOf('data-se="rename" aria-label="Rename Weathergraph"><span>Weathergraph</span>') !== -1,
    'its editor, by its name');
  assert.equal(ed.querySelector('.se-done').style.display, '');
  page.tapEditor({ se: 'close' });
  assert.ok(page.scroll.innerHTML.indexOf('<span class="scr-t">Weathergraph</span>') !== -1, 'the card names it');
});

test('a greyed-out preset is a disabled card with its reason; a basalt says its graph stays', () => {
  const page = bootGeneratedPage({ provider: 'dwd' });
  page.tapAction('addScreen');
  const body = page.editor().querySelector('[data-se-body]').innerHTML;
  assert.deepEqual(sheetCards(body).filter((c) => c[3]), [['stripes', 'Stripes', SP.ALREADY, true]]);
  assert.ok(body.indexOf('A preset brings its rows. Your graph and your bars stay as they are.') !== -1);
  page.tapEditor({ se: 'pick', id: 'stripes', disabled: true });
  assert.equal(page.S.viewCount, '1', 'nothing added');
  assert.equal(page.editor().querySelector('[data-se-title]').innerHTML, 'Add a screen', 'still open');
});

test('the editor\'s title renames the screen: Enter keeps the name, Escape drops it', () => {
  const page = bootGeneratedPage(THREE);
  page.tapAction('openScreen', 1);
  const ed = page.editor(), title = ed.querySelector('[data-se-title]');
  assert.ok(title.innerHTML.indexOf('aria-label="Rename Flick 1"') !== -1);
  page.tapEditor({ se: 'rename' });
  assert.match(title.innerHTML, /<input type="text" class="se-name-in" maxlength="24" aria-label="Screen name" autocomplete="off" value="Flick 1">/);
  const input = title.querySelector('input');
  assert.ok(input.focuses > 0, 'the field takes the focus');
  input.value = '  Steps ';
  input.dispatch('keydown', { key: 'Enter', preventDefault() {}, stopPropagation() {} });
  assert.equal(page.S.viewName1, 'Steps');
  assert.ok(title.innerHTML.indexOf('<span>Steps</span>') !== -1);
  assert.ok(page.scroll.innerHTML.indexOf('<span class="scr-t">Steps</span>') !== -1, 'the card follows');
  // Escape: the name as it was, the editor still open.
  page.tapEditor({ se: 'rename' });
  const again = title.querySelector('input');
  again.value = 'Nope';
  again.dispatch('keydown', { key: 'Escape', preventDefault() {}, stopPropagation() {} });
  assert.equal(page.S.viewName1, 'Steps');
  assert.ok(page.editor(), 'still open');
  // Blur keeps what was typed; the place's name stores none.
  page.tapEditor({ se: 'rename' });
  const third = title.querySelector('input');
  third.value = 'Flick 1';
  third.dispatch('blur', {});
  assert.equal(page.S.viewName1, '');
  assert.ok(title.innerHTML.indexOf('<span>Flick 1</span>') !== -1);
});

test('the names everywhere: the pinned watch\'s captions, the delete toast and the graph chips', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const page = bootGeneratedPage(Object.assign({ viewName0: 'Home', viewName2: 'Rain' }, THREE));
  const html = page.scroll.innerHTML;
  assert.ok(html.indexOf('<span class="wpv-cap" aria-hidden="true">Home</span>') !== -1);
  assert.ok(html.indexOf('<span class="wpv-cap" aria-hidden="true">Rain</span>') !== -1);
  assert.deepEqual(cardRows(html).map((r) => r.slice(0, 2)), [['Home', 'Default'], ['Flick 1', ''], ['Rain', '']]);
  page.tapAction('deleteScreen', 2);
  assert.ok(page.scroll.innerHTML.indexOf('Rain deleted.') !== -1);
  // The Graphs tab names the screens a graph shows on by their names.
  const S = withScreens(EMERY, [M.screensOf(fresh(EMERY), EMERY)[0]], { viewName0: 'Home' });
  assert.deepEqual(GSP.screensOn(S, EMERY, 0), ['Home']);
  assert.equal(GSP.whereText(S, EMERY, 0), 'On Home');
});
