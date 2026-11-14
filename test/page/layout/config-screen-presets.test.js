'use strict';
// test/page/layout/config-screen-presets.test.js — screens with names, an order and presets (3.0): a
// screen's name (screens.js nameOf, the page-only viewName keys), a move to another place
// (screens-page.js moveScreen: the top screen is the Default, which always shows the clock),
// the presets Add screen offers (screen-presets.js) with the template's graph each draws on a
// Pebble Time 2 (graph-styles-page.js templateGraph, graph-styles.js TEMPLATE GRAPHS) and why one
// is greyed out, then the REAL
// generated page (test/helpers/page-harness.js): the Screens card's ≡, the Add a screen sheet
// and the editor's rename.
const test = require('node:test');
const assert = require('node:assert/strict');
require('../../../src/pkjs/config-ui/lib/schema-walk.js');
require('../../../src/pkjs/config-ui/lib/color.js');
require('../../../src/pkjs/config-ui/lib/show-when.js');
require('../../../src/pkjs/config-ui/lib/engine.js');
require('../../../src/pkjs/page/settings/blocks.js');
const SP = require('../../../src/pkjs/page/layout/screens-page.js');
const GSP = require('../../../src/pkjs/page/forecast-graphs/graph-styles-page.js');
const GS = require('../../../src/pkjs/forecast-graphs/domain/graph-styles.js');
const M = require('../../../src/pkjs/layout/domain/screens.js');
const P = require('../../../src/pkjs/page/layout/screen-presets.js');
const VC = require('../../../src/pkjs/layout/domain/view-cycle.js');
const WS = require('../../../src/pkjs/page/settings/wizard/wizard-screens.js');
const WF = require('../../../src/pkjs/page/settings/wizard/wizard-forecast.js');
const platform = require('../../../src/pkjs/config-ui/lib/platform.js');
const schema = require('../../../src/pkjs/page/settings/schema.js');
const { bootGeneratedPage } = require('../../helpers/page-harness.js');

const PC = global.PConf;
const BASALT = platform.computeEnv({ platform: 'basalt' });
const EMERY = platform.computeEnv({ platform: 'emery' });
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

// --- the screens Add a screen offers -----------------------------------------------------

const CAL = { none: '', compact: '2', full: '3', dense: P.DENSE };

// The templates a screen's forecast graph can draw, in the roll's order (the Graphs tab's New
// graph sheet's: the owner's, 2026-11-09, more of them, to show what the graph can draw;
// 2026-11-10, from the common ways to show the weather, and better too many than too few).
const TEMPLATE_IDS = ['classic', 'clean', 'stripes', 'simple', 'rain', 'sky', 'clouds', 'outdoor', 'sun', 'comfort', 'wind',
  'storm', 'pressure', 'meteogram'];
const KIND_IDS = ['blank', 'forecast', 'health', 'radar', 'healthfc', 'radarfc'];
// A first graph that draws four series already, for the five-metric limit.
const BUSY = { secondaryLine: 'precip_prob', secondaryLineStyle: 'line', thirdLine: 'wind', fourthLine: 'uv', fifthLine: 'gust' };

test('the kinds: Blank, the forecast screen, Health, Rain radar and two graphs on a screen; each watch the ones it can draw', () => {
  assert.deepEqual(P.KINDS.map((k) => k.name), ['Blank', 'Forecast', 'Health', 'Rain radar', 'Health + forecast',
    'Radar + forecast']);
  [EMERY, BASALT, DIORITE, FLINT].forEach((env) => assert.deepEqual(P.offered(env).map((k) => k.id), KIND_IDS,
    env.platform + ': every one'));
  assert.deepEqual(P.offered(APLITE).map((k) => k.id), ['blank', 'forecast'], 'no health, no radar');
  assert.deepEqual(P.offered(null).map((k) => k.id), KIND_IDS, 'an unknown watch is capable');
  // The headings (the owner's, 2026-11-10: the layout first, then the graph; Blank still the first).
  assert.deepEqual(P.GROUPS.map((g) => [g.name, P.KINDS.filter((k) => k.group === g.id).map((k) => k.id)]), [
    ['', ['blank']], ['With a forecast graph', ['forecast']], ['Other screens', ['health', 'radar', 'healthfc', 'radarfc']]]);
  assert.deepEqual(P.CALENDARS, [['None', ''], ['Compact', '2'], ['Full', '3'], ['Dense', 'dense']]);
  // Blank has no calendar, nor a screen of two graphs: its upper graph sits in the calendar's seat.
  assert.deepEqual(P.KINDS.filter((k) => !P.calendars(k).length).map((k) => k.id), ['blank', 'healthfc', 'radarfc']);
  // Dense (the owner's ask, 2026-11-10: more status bars at once) needs the rain radar for its bar.
  assert.deepEqual(P.calendars(P.byId('forecast'), { radar: false }), P.CALENDARS.slice(0, 3), 'no radar: no Dense');
  assert.deepEqual(P.KINDS.filter((k) => P.showsRadar(k, '')).map((k) => k.id), ['radar', 'radarfc'],
    'the screens that turn the radar on');
  assert.deepEqual(P.KINDS.filter((k) => !P.showsRadar(k, P.DENSE)).map((k) => k.id), ['blank', 'healthfc'],
    'Dense turns it on for its bar: every kind with a calendar');
  assert.equal(P.byId('nope'), null);
  assert.equal(P.byId('clean'), null, 'a template is a graph, not a screen');
  // Add a screen's cards: Blank, the forecast screen on None, Compact, Full and Dense, the others
  // once (Health's and Rain radar's calendar picked after them): 9 on every watch, where the
  // Pebble Time 2 had 66.
  const ids = ['blank:', 'forecast:', 'forecast:2', 'forecast:3', 'forecast:dense', 'health:', 'radar:', 'healthfc:',
    'radarfc:'];
  assert.deepEqual(P.cards(BASALT).map((c) => c.kind.id + ':' + c.cal), ids);
  assert.deepEqual(P.cards(EMERY).map((c) => c.kind.id + ':' + c.cal), ids, 'the Pebble Time 2 the same');
  assert.deepEqual(P.cards(Object.assign({}, BASALT, { radar: false })).map((c) => c.kind.id + ':' + c.cal),
    ['blank:', 'forecast:', 'forecast:2', 'forecast:3', 'health:', 'healthfc:'], 'no radar: no Dense, no radar screens');
  assert.deepEqual(P.cards(BASALT).map((c) => P.cardName(c.kind, c.cal)), ['Blank', 'No calendar', 'Compact calendar',
    'Full calendar', 'Dense', 'Health', 'Rain radar', 'Health + forecast', 'Radar + forecast'],
  'the forecast screen by its calendar');
  assert.equal(P.cardName(P.byId('health'), '3'), 'Health', 'the others by their own, whatever calendar');
  assert.equal(P.cardSaid(P.byId('forecast'), P.DENSE), 'compact calendar and radar bar', 'Dense\'s calendar said in full');
  assert.deepEqual(['', '2', '3'].map((cal) => P.cardSaid(P.byId('forecast'), cal)), ['', '', ''], 'the others\' names say it');
  assert.equal(P.cardSaid(P.byId('health'), P.DENSE), '', 'a kind whose calendar is picked after its card');
  // The templates a forecast graph can draw: the Graphs tab's, in its order, where the watch has
  // graph styles (wizard-forecast.js LOOKS, their one definition).
  assert.deepEqual(P.templates(EMERY).map((look) => look.id), TEMPLATE_IDS);
  assert.deepEqual(TEMPLATE_IDS, WF.LOOKS.map((look) => look.id));
  assert.deepEqual(P.templates(BASALT), [], 'a watch with one graph keeps it on every screen');
  assert.equal(P.templates(null).length, TEMPLATE_IDS.length, 'an unknown watch has graph styles');
  assert.equal(P.template('clean', EMERY).label, 'Clean');
  assert.equal(P.template('clean', BASALT), null);
  assert.equal(P.template('nope', EMERY), null);
});

test('a screen\'s rows: the Watch bar, its calendar, the clock, its bar and its graph; each fits everywhere', () => {
  assert.deepEqual(P.listOf('fc', CAL.full), [b('strip'), b('cal', { rows: '3' }), b('clock'), b('fcbar'), b('fc', { size: 'fill' })],
    'Classic\'s screen as it was');
  assert.deepEqual(P.listOf('health', CAL.none), HEALTH, 'the Health screen as it was');
  assert.deepEqual(P.listOf('radar', CAL.none), RADAR, 'setup\'s Rain radar screen as it was');
  assert.deepEqual(P.listOf('health', CAL.compact), [b('strip'), b('cal', { rows: '2' }), b('clock'), b('healthbar'),
    b('health', { size: 'fill' })], 'Health + calendar as it was');
  // Two graphs: the upper one three rows high in the calendar's seat, whatever calendar is asked.
  assert.deepEqual(P.screenOf(P.byId('healthfc'), CAL.full), [b('strip'), b('health', { size: '3' }), b('clock'), b('fcbar'),
    b('fc', { size: 'fill' })]);
  assert.deepEqual(P.screenOf(P.byId('radarfc'), CAL.none), [b('strip'), b('radar', { size: '3' }), b('clock'), b('fcbar'),
    b('fc', { size: 'fill' })]);
  assert.deepEqual(P.screenOf(P.byId('forecast'), CAL.compact), P.listOf('fc', CAL.compact));
  // Blank: the Watch bar and the clock, whatever calendar is asked, a copy of its own.
  const blank = P.screenOf(P.byId('blank'), CAL.full);
  assert.deepEqual(blank, [b('strip'), b('clock')]);
  blank[0].k = 'cal';
  assert.deepEqual(P.BLANK, [b('strip'), b('clock')], 'the copy is its own');
  // Dense: the compact calendar with the radar bar right under it, the graph's own bar under the
  // clock; the Rain radar's is the forecast bar.
  assert.deepEqual(P.listOf('fc', CAL.dense), [b('strip'), b('cal', { rows: '2' }), b('radarbar'), b('clock'), b('fcbar'),
    b('fc', { size: 'fill' })]);
  assert.deepEqual(P.listOf('health', CAL.dense), [b('strip'), b('cal', { rows: '2' }), b('radarbar'), b('clock'),
    b('healthbar'), b('health', { size: 'fill' })]);
  assert.deepEqual(P.listOf('radar', CAL.dense), [b('strip'), b('cal', { rows: '2' }), b('radarbar'), b('clock'), b('fcbar'),
    b('radar', { size: 'fill' })], 'the radar bar once');
  assert.deepEqual(P.screenOf(P.byId('radarfc'), CAL.dense), P.screenOf(P.byId('radarfc'), CAL.none), 'two graphs: no calendar');
  // Every kind with every calendar it can have keeps the rules and fits as a flick screen on
  // every watch that is offered it.
  [EMERY, BASALT, DIORITE, FLINT].forEach((env) => P.offered(env).forEach((kind) => {
    (P.calendars(kind, env).length ? P.calendars(kind, env) : [['', '']]).forEach(([, cal]) => {
      const list = P.screenOf(kind, cal);
      assert.equal(M.problem(list), '', kind.id + cal + ' keeps the rules');
      assert.ok(M.fits(list, 1, env.platform), kind.id + ' with ' + (cal || 'no') + ' calendar fits on ' + env.platform);
    });
  }));
  // A screen read back: its calendar, and the graph it is a screen of (calendar and graph aside).
  assert.deepEqual(Object.values(CAL).map((cal) => P.calOf(P.listOf('fc', cal))), ['', '2', '3', '2'],
    'Dense\'s calendar is the compact one');
  assert.equal(P.graphOf(P.listOf('radar', CAL.full)), 'radar');
  assert.equal(P.graphOf([b('strip'), b('clock'), b('fcbar'), b('fc', { size: 'fill', style: '3' })]), 'fc');
  assert.equal(P.graphOf([b('strip'), b('clock'), b('fc', { size: 'fill' })]), '', 'a screen of your own');
});

test('Forecast length: a template\'s lengths, on the Pebble Time 2 only', () => {
  assert.deepEqual(P.spanOptions('clean', EMERY, {}), [['12 h', '12'], ['24 h', '24'], ['66 h', '48']]);
  assert.deepEqual(P.spanOptions('clean', BASALT, {}), [], 'no templates there');
  assert.deepEqual(P.spanOptions('nope', EMERY, {}), []);
});

test('Add a screen\'s cards two a row, Blank across the top; the roll\'s graphs larger than the mockup\'s, one in the middle', () => {
  const rule = (sel) => (new RegExp('(?:^|\\})' + sel.replace(/\./g, '\\.') + '\\{([^}]*)\\}').exec(SP.CSS) || [])[1] || '';
  assert.match(rule('.sa-grid'), /grid-template-columns:1fr 1fr/, 'two cards a row');
  assert.match(rule('.sa-card'), /flex-direction:column/, 'a card\'s picture over its name');
  assert.match(rule('.sa-card.sa-wide'), /flex-direction:row/, 'Blank\'s beside its name');
  assert.match(rule('.sa-card.sa-wide'), /grid-column:1\/-1/, 'across its group\'s grid');
  // The owner's ask, 2026-11-10: "the graphs need to be larger" than the mockup's 96 px.
  const w = Number((/width:(\d+)px/.exec(rule('.sa-g')) || [])[1]);
  assert.ok(w >= 150, 'a graph in the roll is ' + w + ' px wide');
  assert.match(rule('.sa-th'), /width:100%/, 'its picture as wide');
  assert.match(rule('.sa-reel'), /scroll-snap-type:x mandatory/, 'the roll settles on one graph');
  assert.match(rule('.sa-g'), /scroll-snap-align:center/, 'in its middle');
  assert.ok(rule('.sa-reel').indexOf('padding:12px calc(50% - ' + w / 2 + 'px) 4px') !== -1,
    'the first and the last graph can reach the middle');
  assert.match(rule('.sa-big'), /width:224px/, 'the screen bigger than on its card');
  // The owner's ask, 2026-11-10: the graph's name once, in the roll; whose it is under it, for the
  // graph in the middle alone.
  assert.match(rule('.sa-gt'), /visibility:hidden/);
  assert.match(rule('.sa-g.on .sa-gt'), /visibility:visible/);
  assert.match(rule('.sa-cfg'), /grid-template-columns:minmax\(0,1fr\)/, 'the roll\'s length never widens the page');
});

test('Add a screen\'s cards: Blank, the forecast screen on each calendar, the others; each with your graph', () => {
  const S = fresh(BASALT);
  const choices = SP.addChoices(S, BASALT);
  assert.deepEqual(choices.map((c) => [c.id, c.cal, c.name, c.span]),
    [['blank', '', '', ''], ['forecast', '', 'Forecast', ''], ['forecast', '2', 'Forecast', ''], ['forecast', '3', 'Forecast', ''],
      ['forecast', 'dense', 'Forecast', ''], ['health', '', 'Health', ''], ['radar', '', 'Rain radar', ''],
      ['healthfc', '', 'Health + forecast', ''], ['radarfc', '', 'Radar + forecast', '']]);
  assert.ok(choices.every((c) => c.kind === P.byId(c.id)), 'each with its kind');
  assert.ok(choices.every((c) => c.graph === null), 'your graph: no screen brings one');
  // Each card's picture settings hold the screen it adds, after the others, on its calendar.
  choices.forEach((c) => assert.deepEqual(M.screensOf(c.W, BASALT)[1], c.list, c.id + '\'s picture'));
  assert.deepEqual(choices[0].list, [b('strip'), b('clock')], 'Blank');
  assert.deepEqual(choices.slice(1, 5).map((c) => P.calOf(c.list)), ['', '2', '3', '2']);
  const card = (id, cal) => choices.find((c) => c.id === id && c.cal === cal);
  assert.equal(card('radar', '').W.radarEnabled, true, 'the Rain radar card draws the radar it turns on');
  assert.equal(card('radar', '').W.radarMode, 'graph', 'as its screen will draw it: a graph, its sky rows and all');
  assert.equal(S.radarMode, 'countdown', 'premise: no screen of yours draws the radar as a graph');
  assert.equal(card('radarfc', '').W.radarEnabled, true, 'so does Radar + forecast');
  assert.equal(card('forecast', 'dense').W.radarEnabled, true, 'and the Dense card, for its radar bar');
  assert.equal(card('forecast', '2').W.radarEnabled, S.radarEnabled, 'a card without the radar leaves it as it is');
  assert.equal(JSON.stringify(S), JSON.stringify(fresh(BASALT)), 'reading the cards changes nothing');
  // On the Pebble Time 2 the same cards, each with your first graph: its graph is picked after it.
  const E = SP.addChoices(fresh(EMERY), EMERY);
  assert.deepEqual(E.map((c) => c.id + ':' + c.cal), choices.map((c) => c.id + ':' + c.cal));
  assert.deepEqual(E.map((c) => c.k), [-1, 0, 0, 0, 0, -1, -1, 0, 0], 'your first graph wherever a forecast graph is');
  assert.ok(E.every((c) => c.graph === null && !c.look));
  // Three screens: nothing to add.
  assert.deepEqual(SP.addChoices(withScreens(BASALT, [M.screensOf(fresh(BASALT), BASALT)[0], HEALTH, RADAR]), BASALT), []);
});

test('the roll\'s graphs: yours first, by their names, then the templates; none on a watch with one graph', () => {
  const S = withScreens(EMERY, [M.screensOf(fresh(EMERY), EMERY)[0]], {
    graphStyles: JSON.stringify({ names: ['', 'Wind'], styles: [null, { forecastHours: '12', secondaryLine: 'wind' }] })
  });
  assert.deepEqual(SP.rollItems(GSP.asStored(S), EMERY).map((it) => [it.v, it.name, it.k, it.look]),
    [['1', 'Graph 1', 0, ''], ['2', 'Wind', 1, '']].concat(TEMPLATE_IDS.map((id) => [id, WF.lookOf(id).label, -1, id])));
  assert.deepEqual(SP.rollItems(GSP.asStored(fresh(BASALT)), BASALT), []);
});

test('Change layout: the screen picked takes a screen\'s place, its name kept; three screens and the Default too', () => {
  // The owner's pick, 2026-11-10: the screen you have takes a layout (and a graph) as a new one does.
  const S = fresh(BASALT);
  const count = S.viewCount;
  assert.equal(SP.addChosen(S, BASALT, 'health', CAL.none, undefined, undefined, 0), 0, 'the Default\'s place');
  assert.deepEqual(M.screensOf(S, BASALT), [HEALTH], 'no screen added');
  assert.equal(S.viewCount, count);
  assert.equal(M.nameOf(S, 0), 'Default', 'its name kept');
  assert.equal(S.healthMode, 'all', 'the modes follow');
  // Three screens: no room to add one, but each can change its layout, its name kept.
  const T = withScreens(BASALT, [M.screensOf(fresh(BASALT), BASALT)[0], HEALTH, RADAR], { viewName2: 'Rain' });
  assert.deepEqual(SP.addChoices(T, BASALT), [], 'no room to add');
  assert.equal(SP.addChoices(T, BASALT, 2).length, P.cards(BASALT).length, 'Change layout offers every card');
  assert.ok(SP.addChoices(T, BASALT, 2).every((c) => c.n === 2), 'each in the place of the screen it replaces');
  assert.equal(SP.addChosen(T, BASALT, 'blank', '', undefined, undefined, 2), 2);
  assert.deepEqual(M.screensOf(T, BASALT)[2], [b('strip'), b('clock')]);
  assert.equal(T.viewName2, 'Rain');
  assert.notEqual(T.radarMode, 'graph', 'no screen shows the radar graph now');
  // Every layout keeps the clock the Default always shows, so each can take its place.
  P.cards(BASALT).forEach((card) => {
    assert.ok(SP.addPreview(fresh(BASALT), BASALT, card.kind.id, card.cal, undefined, undefined, 0), card.kind.id + card.cal);
  });
  // A place no screen has is no Change layout: the screen goes after the others, as Add a screen's.
  const U = fresh(BASALT);
  assert.equal(SP.addChosen(U, BASALT, 'health', CAL.none, undefined, undefined, 5), 1);
});

test('Change layout on the Pebble Time 2: a template\'s graph only the screen drew goes, its slot free for the new one', () => {
  const S = fresh(EMERY);
  // Three screens, each on a template's graph: every template slot is taken.
  ['outdoor', 'sky'].forEach((look) => assert.ok(SP.addChosen(S, EMERY, 'forecast', CAL.none, look) > 0));
  S.viewStyle0 = 't3';
  S.graphStyles = GS.withTemplate(S, 8, 'clean', { secondaryLine: 'precip_prob', forecastHours: '24' });
  assert.deepEqual([0, 1, 2].map((i) => S['viewStyle' + i]), ['t3', 't1', 't2']);
  // Screen 2 changes to Stripes: the slot its Sky held is its again, Sky gone.
  assert.equal(SP.addChosen(S, EMERY, 'forecast', CAL.compact, 'stripes', '24', 2), 2);
  assert.equal(S.viewStyle2, 't2');
  assert.deepEqual(GS.parse(S).looks.slice(GS.MAX_STYLES), ['outdoor', 'stripes', 'clean']);
  assert.deepEqual(M.screensOf(S, EMERY)[2].map((x) => x.k), P.listOf('fc', CAL.compact).map((x) => x.k));
  // To one of your graphs: its template's graph goes.
  assert.equal(SP.addChosen(S, EMERY, 'forecast', CAL.none, '1', '', 1), 1);
  assert.equal(S.viewStyle1, '1');
  assert.equal(GS.exists(S, GS.MAX_STYLES), false, 'Outdoor\'s graph gone with it');
});

test('Change layout in the editor: under the picture, Add a screen\'s cards for the screen, its pick in the screen\'s place', () => {
  const page = bootGeneratedPage(THREE);
  page.tapAction('openScreen', 1);
  const head = () => page.editor().querySelector('[data-se-head]').innerHTML;
  const body = () => page.editor().querySelector('[data-se-body]').innerHTML;
  assert.ok(body().indexOf('<div class="se-relayout">' + require('../../../src/pkjs/config-ui/lib/ui.js').chip('Change layout',
    { 'data-se': 'relayout', 'aria-haspopup': 'dialog' }, { icon: 'swap' }) + '</div>') !== -1, 'under the picture');
  page.tapEditor({ se: 'relayout' });
  assert.match(head(), /Change layout/);
  assert.match(head(), /data-se="relayoutback"/, '‹ goes back to the screen');
  assert.ok(body().indexOf('The screen keeps its name and its place.') !== -1);
  assert.ok(body().indexOf('data-se="pick" data-id="radar"') !== -1, 'the cards, though there are three screens');
  // ‹ and Escape: back to the screen's editor, nothing changed.
  page.tapEditor({ se: 'relayoutback' });
  assert.match(body(), /data-se="relayout"/);
  page.tapEditor({ se: 'relayout' });
  page.docDispatch('keydown', { key: 'Escape', target: {}, preventDefault() {} });
  assert.ok(page.editor(), 'still open');
  assert.match(body(), /data-se="relayout"/, 'the editor again');
  // A card, then Use this layout: the screen takes its place, its name kept, its editor next.
  const before = JSON.stringify(M.screensOf(page.S, BASALT)[0]);
  page.tapEditor({ se: 'relayout' });
  page.tapEditor({ se: 'pick', id: 'radar', cal: '' });
  assert.ok(part(page.editor(), 'foot').indexOf('<button type="button" class="sa-add" data-se="addnow">Use this layout</button>')
    !== -1, 'its last button');
  page.tapEditor({ se: 'addnow' });
  assert.equal(M.screensOf(page.S, BASALT).length, 3, 'no screen added');
  assert.deepEqual(M.screensOf(page.S, BASALT)[1], P.listOf('radar', CAL.none));
  assert.equal(JSON.stringify(M.screensOf(page.S, BASALT)[0]), before, 'the others as they were');
  assert.match(head(), new RegExp(M.nameOf(page.S, 1)), 'the screen\'s editor');
  assert.match(body(), /data-se="relayout"/);
});

test('adding a screen: its rows on the calendar picked, after the others, named after it; the same one twice; Blank', () => {
  const S = fresh(BASALT);
  assert.equal(SP.addChosen(S, BASALT, 'health', CAL.none), 1);
  assert.deepEqual(M.screensOf(S, BASALT)[1], HEALTH);
  assert.equal(S.viewName1, 'Health');
  assert.equal(S.healthMode, 'all', 'the modes follow');
  assert.equal(SP.addChosen(S, BASALT, 'health', CAL.full), 2, 'the same screen again');
  assert.deepEqual(M.screensOf(S, BASALT)[2], P.listOf('health', CAL.full));
  assert.equal(S.viewName2, 'Health 2', 'told apart by its name');
  assert.equal(SP.addChosen(S, BASALT, 'radar'), -1, 'no fourth screen');
  // Without a calendar named, the Default's.
  const T = fresh(BASALT);
  assert.equal(SP.addChosen(T, BASALT, 'forecast'), 1);
  assert.deepEqual(M.screensOf(T, BASALT)[1], P.listOf('fc', CAL.compact));
  assert.equal(T.viewName1, 'Forecast');
  // Blank: the Watch bar and the clock, named by its place.
  const B = fresh(BASALT);
  assert.equal(SP.addChosen(B, BASALT, 'blank'), 1);
  assert.deepEqual(M.screensOf(B, BASALT)[1], [b('strip'), b('clock')]);
  assert.equal(B.viewName1, '', 'no name of its own');
  assert.equal(M.nameOf(B, 1), 'Flick 1');
  // One that is not offered adds nothing.
  const U = fresh(BASALT), kept = JSON.stringify(U);
  assert.equal(SP.addChosen(U, BASALT, 'clean'), -1, 'a template is no kind');
  assert.equal(SP.addChosen(U, BASALT, 'forecast', CAL.none, 'clean'), -1, 'nor drawn on a basalt');
  assert.equal(SP.addChosen(U, BASALT, 'forecast', CAL.none, '2'), -1, 'no second graph on a basalt');
  assert.equal(SP.addChosen(U, BASALT, 'nope'), -1);
  assert.equal(SP.addChosen(U, Object.assign({}, BASALT, { radar: false }), 'forecast', CAL.dense), -1,
    'Dense needs the rain radar');
  assert.equal(SP.addChosen(U, BASALT, 'healthfc', CAL.full), -1, 'two graphs have no calendar');
  assert.equal(JSON.stringify(U), kept);
  // A free name: the first number no other screen has; the screen's own slot never counts.
  const named = withScreens(BASALT, [M.screensOf(fresh(BASALT), BASALT)[0], HEALTH, RADAR],
    { viewName0: 'Classic', viewName1: 'Classic 2', viewName2: 'Classic' });
  assert.equal(SP.freeName(named, BASALT, 'Classic', 2), 'Classic 3');
  assert.equal(SP.freeName(named, BASALT, 'Classic 2', 1), 'Classic 2', 'its own name');
  assert.equal(SP.freeName(named, BASALT, 'Health', 2), 'Health');
});

test('a Rain radar screen turns the radar on, its source kept', () => {
  const S = fresh(BASALT, { radarEnabled: false, radarProvider: 'dwd' });
  assert.equal(SP.addChosen(S, BASALT, 'radar', CAL.none), 1);
  assert.equal(S.radarEnabled, true);
  assert.equal(S.radarProvider, 'dwd');
  assert.equal(S.radarMode, 'graph');
});

test('a forecast screen on a Pebble Time 2 draws the template picked at the length picked, none of your six', () => {
  const S = fresh(EMERY), T1 = GS.MAX_STYLES;
  const c = SP.addPreview(S, EMERY, 'forecast', CAL.full, 'clean');
  assert.deepEqual([c.graph.k, c.span, c.name, c.why], [T1, '48', 'Clean', ''],
    'the first template graph, after the six, on its own length');
  assert.equal(SP.addChosen(S, EMERY, 'forecast', CAL.full, 'clean', '24'), 1);
  assert.equal(GS.count(S), 1, 'not one of your graphs (the owner\'s, 2026-11-10)');
  assert.deepEqual(GSP.existing(S), [0], 'nor on the Graphs tab');
  assert.equal(GS.lookOf(S, T1), 'clean', 'it names its template');
  assert.equal(S.viewStyle1, 't1', 'the new screen draws it');
  assert.equal(S.viewName1, 'Clean');
  assert.deepEqual(M.screensOf(S, EMERY)[1].map((x) => x.k), ['strip', 'cal', 'clock', 'fcbar', 'fc']);
  assert.equal(GS.settingsFor(S, T1).forecastHours, '24', 'the length picked, not the template\'s');
  // Clean again: a template graph of its own, whatever its length.
  assert.equal(SP.addPreview(S, EMERY, 'forecast', CAL.none, 'clean').graph.k, T1 + 1);
  assert.equal(SP.addChosen(S, EMERY, 'forecast', CAL.none, 'clean', '24'), 2);
  assert.equal(GS.count(S), 1, 'still none of yours');
  assert.equal(S.viewStyle2, 't2');
  assert.equal(S.viewName2, 'Clean 2');
  assert.deepEqual(GS.stylesSent(S, EMERY), [0, T1, T1 + 1], 'the watch is sent both');
  // A screen deleted takes its template graph along; the last one leaves nothing behind.
  assert.equal(SP.deleteScreen(S, 1, EMERY), true);
  assert.equal(S.viewStyle1, 't2', 'the screen after it moved up, its graph along');
  assert.deepEqual([GS.exists(S, T1), GS.exists(S, T1 + 1)], [false, true]);
  assert.equal(SP.deleteScreen(S, 1, EMERY), true);
  assert.equal(S.graphStyles, fresh(EMERY).graphStyles, 'nothing left behind');
});

test('a forecast screen with one of your graphs draws it, named after it (Forecast while it has its default name)', () => {
  const S = withScreens(EMERY, [M.screensOf(fresh(EMERY), EMERY)[0]], {
    graphStyles: JSON.stringify({ names: ['', 'Wind'], styles: [null, { forecastHours: '12', secondaryLine: 'wind' }] })
  });
  const kept = S.graphStyles;
  assert.equal(SP.addChosen(S, EMERY, 'forecast', CAL.none, '2'), 1);
  assert.equal(S.viewStyle1, '2', 'it draws Wind');
  assert.equal(S.viewName1, 'Wind', 'named after it');
  assert.equal(SP.addChosen(S, EMERY, 'forecast', CAL.compact, '1'), 2);
  assert.equal(S.viewStyle2, '1', 'your first graph');
  assert.equal(S.viewName2, 'Forecast', 'Graph 1 is its default name: the screen is the Forecast');
  assert.deepEqual(M.screensOf(S, EMERY)[2], P.listOf('fc', CAL.compact), 'no style on its row: the first graph');
  assert.equal(S.graphStyles, kept, 'no graph made');
  assert.equal(SP.addPreview(S, EMERY, 'forecast', CAL.none, '3'), null, 'a graph you do not have');
  assert.equal(SP.addPreview(S, EMERY, 'forecast', CAL.none, '7'), null, 'nor a template graph\'s slot');
});

test('a template\'s graph becomes one of yours when you edit it, named after its template', () => {
  const S = fresh(EMERY), T1 = GS.MAX_STYLES;
  assert.equal(SP.addChosen(S, EMERY, 'forecast', CAL.none, 'outdoor', '24'), 1);
  const drawn = GS.valuesOf(S, T1);
  assert.equal(GSP.adoptTemplate(S, T1), 1, 'the first free graph');
  assert.equal(GS.count(S), 2);
  assert.equal(GS.name(S, 1), 'Outdoor');
  assert.equal(S.viewStyle1, '2', 'the screen draws it');
  assert.equal(GS.exists(S, T1), false, 'the template graph gone');
  assert.deepEqual(GS.valuesOf(S, 1), drawn, 'its values as it drew them');
  // Another Outdoor: its graph is "Graph 3", Outdoor being taken.
  assert.equal(SP.addChosen(S, EMERY, 'forecast', CAL.none, 'outdoor', '24'), 2);
  assert.equal(S.viewStyle2, 't1', 'the free template graph again');
  assert.equal(GSP.adoptTemplate(S, T1), 2);
  assert.equal(GS.name(S, 2), 'Graph 3');
  assert.equal(GSP.adoptTemplate(S, T1), -1, 'no template graph left to make yours');
  // Six graphs of yours: none made, nothing changed.
  const full = withScreens(EMERY, [M.screensOf(fresh(EMERY), EMERY)[0]], {
    graphStyles: JSON.stringify({ names: [], styles: [null].concat([1, 2, 3, 4, 5].map(() => ({ forecastHours: '12' }))) })
  });
  assert.equal(SP.addChosen(full, EMERY, 'forecast', CAL.none, 'outdoor', '24'), 1, 'a template screen goes in all the same');
  assert.equal(GS.count(full), 6);
  const kept = JSON.stringify(full);
  assert.equal(GSP.adoptTemplate(full, T1), -1);
  assert.equal(JSON.stringify(full), kept);
});

test('Outdoor brings its feels-like line on 12 and 24 hours, not over the long span', () => {
  const S = fresh(EMERY), T1 = GS.MAX_STYLES;
  const at = (span) => GSP.templateValues(S, EMERY, 'outdoor', span);
  assert.equal(at('48').fourthLine, 'off');
  assert.equal(at('24').fourthLine, 'feels');
  assert.equal(at('12').fourthLine, 'feels');
  assert.equal(at('24').fourthLineStyle, 'line');
  assert.equal(at('24').thirdLine, 'uv', 'its UV line on every length');
  assert.equal(at('48').rainBarFrom, 'top', 'its bars from the top');
  // Added at 24 hours: its graph draws the line; the long one beside it does not.
  assert.equal(SP.addChosen(S, EMERY, 'forecast', CAL.none, 'outdoor', '24'), 1);
  assert.equal(GS.settingsFor(S, T1).fourthLine, 'feels');
  assert.equal(GS.settingsFor(S, T1).forecastHours, '24');
  assert.equal(SP.addChosen(S, EMERY, 'forecast', CAL.none, 'outdoor', '48'), 2);
  assert.equal(GS.settingsFor(S, T1 + 1).fourthLine, 'off');
  assert.equal(S.viewName2, 'Outdoor 2');
  // New graph from the template: its own length, the long span, without the line.
  const N = fresh(EMERY);
  assert.equal(GSP.createGraph(N, 'outdoor', EMERY), 1);
  assert.equal(GS.settingsFor(N, 1).fourthLine, 'off');
  assert.equal(GSP.createGraph(N, 'outdoor', EMERY, { forecastHours: '12' }), 2);
  assert.equal(GS.settingsFor(N, 2).fourthLine, 'feels', 'a length given: the values at it');
});

test('six graphs of yours stop no screen; a graph that would make too many metrics cannot be added, and says why', () => {
  // Graphs 2 to 6 taken, none on a screen: a template's graph is none of them.
  const odd = { forecastHours: '12', secondaryLine: 'wind' };
  const full = withScreens(EMERY, [M.screensOf(fresh(EMERY), EMERY)[0]], {
    graphStyles: JSON.stringify({ names: [], styles: [null].concat(['uv', 'cloud', 'gust', 'dew_point', 'pressure']
      .map((m) => Object.assign({}, odd, { thirdLine: m }))) })
  });
  const one = withScreens(EMERY, [M.screensOf(fresh(EMERY), EMERY)[0]]);
  TEMPLATE_IDS.forEach((id) => assert.equal(SP.addPreview(full, EMERY, 'forecast', CAL.none, id).why,
    SP.addPreview(one, EMERY, 'forecast', CAL.none, id).why, id + ' says what it says with one graph'));
  assert.equal(SP.addChosen(full, EMERY, 'forecast', CAL.none, 'stripes'), 1);
  assert.equal(GS.count(full), 6, 'still six');
  // The first graph draws four series already: Stripes' cloud and rain-chance stripes make six.
  const busy = withScreens(EMERY, [M.screensOf(fresh(EMERY), EMERY)[0]], BUSY);
  const why = SP.addPreview(busy, EMERY, 'forecast', CAL.none, 'stripes').why;
  assert.match(why, /^Also needs .*: that makes \d+ metrics on your screens. The watch can show 5\.$/);
  const kept = JSON.stringify(busy);
  assert.equal(SP.addChosen(busy, EMERY, 'forecast', CAL.none, 'stripes'), -1);
  assert.equal(JSON.stringify(busy), kept, 'no graph made');
  // So can one of yours that no screen shows yet.
  const mine = withScreens(EMERY, [M.screensOf(fresh(EMERY), EMERY)[0]], Object.assign({
    graphStyles: JSON.stringify({ names: [], styles: [null, { secondaryLine: 'cloud', secondaryLineStyle: 'line',
      thirdLine: 'pressure', fourthLine: 'off', fifthLine: 'off' }] })
  }, BUSY));
  assert.match(SP.addPreview(mine, EMERY, 'forecast', CAL.none, '2').why, /^Also needs Cloud cover % and Air pressure \(hPa\): that makes 6 metrics/);
  assert.equal(SP.addPreview(mine, EMERY, 'forecast', CAL.none, '1').why, '', 'the one the screens show already adds none');
  assert.equal(SP.addChosen(mine, EMERY, 'forecast', CAL.none, '2'), -1);
});

test('a watch with one graph: the Forecast screen brings its rows and keeps your graph', () => {
  const S = fresh(BASALT, { secondaryLine: 'wind' });
  assert.equal(SP.addChosen(S, BASALT, 'forecast', CAL.full), 1);
  assert.deepEqual(M.screensOf(S, BASALT)[1], P.listOf('fc', CAL.full));
  assert.equal(S.secondaryLine, 'wind', 'the graph as it was');
  assert.equal(S.graphStyles, fresh(BASALT).graphStyles, 'no graph made');
  assert.equal(S.viewName1, 'Forecast');
});

// --- setup ---------------------------------------------------------------------------

test('setup\'s screens are Add a screen\'s, on a calendar; setup names what it adds', () => {
  assert.deepEqual(WS.listOf(WS.byId('health'), ''), HEALTH);
  assert.deepEqual(WS.listOf(WS.byId('radar'), '3'), P.listOf('radar', '3'));
  assert.deepEqual(WS.listOf(WS.byId('long'), '2'), P.listOf('fc', '2'));
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
  const re = /<div class="ui-row scr-row" data-scr-row="\d+">(<button type="button" class="scr-grip"[^>]*>)?[\s\S]*?<span class="ui-n">([^<]*)(?:<span class="scr-pill">([^<]*)<\/span>)?<\/span>/g;
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
  assert.ok(html.indexOf('<div class="ui-row ui-foot" id="scrHint">' + SP.REORDER_HINT + '</div>') !== -1);
  // No "the watch starts on the top screen": it goes without saying (the owner's, 2026-11-09).
  assert.equal(SP.REORDER_HINT, 'Each flick shows the next one. Drag\u00a0≡ to change the order.');
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
  assert.equal(html.indexOf('ui-note'), -1, 'no reason to give');
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
  assert.ok(page.scroll.innerHTML.indexOf('<div class="ui-note" role="status">Tall' + SP.NO_ROOM_FOR_CLOCK + '</div>') !== -1);
  assert.deepEqual(cardRows(page.scroll.innerHTML).map((r) => r[0]), ['Default', 'Tall'], 'nothing moved');
  t.mock.timers.tick(4000);
  assert.equal(page.scroll.innerHTML.indexOf('ui-note'), -1, 'the note goes after four seconds');
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
 * Add a screen's cards: [id, calendar, name, what a screen reader hears after it, the line under
 * it (Blank's)].
 * @param {string} body The overlay's body.
 * @returns {Array<Array<string>>}
 */
function sheetCards(body) {
  const re = /<button type="button" class="sa-card(?: sa-wide)?" data-se="pick" data-id="([^"]*)" data-cal="([^"]*)"><span class="sa-pic" aria-hidden="true">[\s\S]*?<\/span><span class="sa-txt"><span class="sa-n">([^<]*)(?:<span class="sr-only">, ([^<]*)<\/span>)?<\/span>(?:<span class="sa-d">([^<]*)<\/span>)?<\/span><\/button>/g;
  return [...body.matchAll(re)].map((m) => [m[1], m[2], m[3], m[4] || '', m[5] || '']);
}

/**
 * A segmented row of the picked screen: [label, value, on, off] per segment.
 * @param {string} html Its markup.
 * @param {string} act 'acal' | 'aspan'.
 * @returns {Array<Array>}
 */
function segments(html, act) {
  const re = new RegExp('<button type="button" data-se="' + act + '" data-v="([^"]*)"( class="on")? aria-pressed="(true|false)"( disabled)?>([^<]*)</button>', 'g');
  return [...html.matchAll(re)].map((m) => [m[5], m[1], Boolean(m[2]), Boolean(m[4])]);
}

/**
 * Add a screen's roll as it was drawn (screens-page.js drawRoll: once while it is open, with the
 * first screen picked that has a forecast graph): '' before.
 * @param {Object} ed The overlay.
 * @returns {string}
 */
function reel(ed) {
  return ed.querySelector('[data-sa-roll]').innerHTML;
}

/**
 * Whether Add a screen shows a picked screen, over its cards; and whether that screen shows the
 * roll.
 * @param {Object} ed The overlay.
 * @returns {Array<boolean>} [the picked screen, its roll]
 */
function pickShown(ed) {
  return [ed.querySelector('[data-sa-pick]').style.display !== 'none',
    ed.querySelector('[data-sa-rollwrap]').style.display !== 'none'];
}

/**
 * Whether a graph in the roll is marked picked, as a pick after it was drawn marks it
 * (screens-page.js markRoll): null for one no pick has marked since.
 * @param {Object} ed The overlay.
 * @param {string} v The graph's value.
 * @returns {?string} its aria-pressed
 */
function marked(ed, v) {
  return ed.querySelector('[data-sa-roll]').querySelector('[data-sa-g="' + v + '"]').getAttribute('aria-pressed');
}

/**
 * One of the picked screen's places (screens-page.js renderPick): 'big' its picture, 'sel' its
 * legend, 'foot' its choices and Add screen.
 * @param {Object} ed The overlay.
 * @param {string} name The place.
 * @returns {string}
 */
function part(ed, name) {
  return ed.querySelector('[data-sa-' + name + ']').innerHTML;
}

/**
 * The picked screen's legend: its rows by name, then what the weather service leaves out as
 * "! note".
 * @param {Object} ed The overlay.
 * @returns {Array<string>}
 */
function legend(ed) {
  return [...part(ed, 'sel').matchAll(/<span class="sl-n">([^<]*)<\/span>|<div class="sa-gap">([^<]*)<\/div>/g)]
    .map((m) => (m[2] !== undefined ? '! ' + m[2] : m[1]));
}

/**
 * The graph on the picked screen: its name, as the screen's picture names it to a screen reader
 * (on the page it shows once, under its picture in the roll), and whose it is, as the roll says
 * under that name; null without a roll.
 * @param {Object} ed The overlay.
 * @returns {?Array<string>}
 */
function graphName(ed) {
  const name = /^<div class="sa-big" role="img" aria-label="[^",:]*, ([^":]*):/.exec(part(ed, 'big'));
  const it = name && roll(reel(ed)).find((x) => x[1] === name[1]);
  return it ? [it[1], it[3]] : null;
}

/**
 * The roll's graphs as it was drawn: [value, name, picked, whose].
 * @param {string} html The roll (reel).
 * @returns {Array<Array>}
 */
function roll(html) {
  return [...html.matchAll(/<button type="button" class="sa-g( on)?" data-se="agraph" data-sa-g="([^"]*)" data-v="[^"]*" aria-pressed="(?:true|false)"><span class="sa-th"[^>]*>[\s\S]*?<\/span><span class="sa-gn">([^<]*)<\/span><span class="sa-gt">([^<]*)<\/span><\/button>/g)]
    .map((m) => [m[2], m[3], Boolean(m[1]), m[4]]);
}

/**
 * Whether Add a screen shows its cards: they stay drawn under a picked screen, hidden.
 * @param {Object} ed The overlay.
 * @returns {boolean}
 */
function cardsShown(ed) {
  return ed.querySelector('[data-sa-cards]').style.display !== 'none';
}

const YOUR_LENGTH = 'Your graph keeps its own length. Change it on the Graphs tab.';
const TEMPLATE_FINE = '<div class="sa-fine">A template’s graph becomes one of your graphs only when you edit it.</div>';

test('+ Add screen opens Add a screen: Blank first, then the forecast screen on each calendar, then the other screens', () => {
  const page = bootGeneratedPage({ provider: 'dwd' }, 'emery');
  page.tapAction('addScreen');
  const ed = page.editor(), head = ed.querySelector('[data-se-head]'), bodyEl = ed.querySelector('[data-se-body]');
  // A dialog's header (ui.js header): ‹, the kicker over the title, no Done (nothing to be done).
  assert.ok(head.innerHTML.indexOf('<button type="button" class="dlg-x" data-se="close" aria-label="Back">&#8249;</button>')
    !== -1, '‹ closes it');
  assert.ok(head.innerHTML.indexOf('<span class="dlg-kick">Screens</span>') !== -1, 'where it opened from');
  assert.ok(head.innerHTML.indexOf('id="seTitle">Add a screen</span></span></div></div>') !== -1, 'titled, no pencil');
  const body = bodyEl.innerHTML;
  // The owner's, 2026-11-10: the layout first, then its graph; Blank still the first.
  assert.deepEqual(sheetCards(body), [['blank', '', 'Blank', '', 'The Watch bar and the clock. You add the rest.'],
    ['forecast', '', 'No calendar', '', ''], ['forecast', '2', 'Compact calendar', '', ''],
    ['forecast', '3', 'Full calendar', '', ''], ['forecast', 'dense', 'Dense', 'compact calendar and radar bar', ''],
    ['health', '', 'Health', '', ''], ['radar', '', 'Rain radar', '', ''], ['healthfc', '', 'Health + forecast', '', ''],
    ['radarfc', '', 'Radar + forecast', '', '']]);
  assert.match(body, /^<div data-sa-cards><div class="sa-group"><div class="sa-grid"><button type="button" class="sa-card sa-wide" data-se="pick" data-id="blank"/,
    'Blank across the top, under no heading');
  const pics = [...body.matchAll(/<span class="sa-pic" aria-hidden="true">(<svg[\s\S]*?<\/svg>)<\/span><span class="sa-txt">/g)];
  assert.equal(pics.length, 9);
  assert.ok(pics.every((m) => m[1].length > 3000), 'each card draws its picture as it opens: 9 of them, where there were 66');
  assert.deepEqual([...body.matchAll(/<span class="ui-cap" id="saGrp-([a-z]+)">([^<]*)<\/span><div class="sa-grid">/g)]
    .map((m) => [m[1], m[2]]), [['fc', 'With a forecast graph'], ['more', 'Other screens']]);
  assert.ok(body.indexOf('<div class="sa-fine">A screen with a forecast graph picks its graph next: one of yours or a '
    + 'template. Your status bars keep what they show.</div>') !== -1);
  // A layout: its screen big, the roll under it (your graph, then the templates), yours picked.
  page.tapEditor({ se: 'pick', id: 'forecast', cal: '2' });
  assert.equal(page.S.viewCount, '1', 'nothing added yet');
  assert.ok(head.innerHTML.indexOf('<button type="button" class="dlg-x" data-se="addback" aria-label="Back">') !== -1,
    '‹ goes back to the cards');
  assert.ok(head.innerHTML.indexOf('<span class="dlg-kick">Add a screen</span>') !== -1);
  assert.ok(head.innerHTML.indexOf('id="seTitle">Compact calendar</span>') !== -1, 'titled by its layout');
  assert.equal(cardsShown(ed), false, 'the cards hidden under it');
  assert.deepEqual(pickShown(ed), [true, true], 'the screen picked over them, with its roll');
  const drawn = reel(ed);
  assert.deepEqual(roll(drawn), [['1', 'Graph 1', true, 'Your graph']]
    .concat(TEMPLATE_IDS.map((id) => [id, WF.lookOf(id).label, false, 'Template'])), 'each graph says whose it is');
  assert.ok(drawn.indexOf('</button><span class="sa-sep" aria-hidden="true"></span><button type="button" class="sa-g" '
    + 'data-se="agraph" data-sa-g="classic"') !== -1, 'a line between yours and the templates');
  assert.ok(body.indexOf('<div class="sa-roll" role="group" aria-label="Graph" data-sa-rollwrap><span class="sa-caret" '
    + 'aria-hidden="true"></span><div class="sa-reel" data-sa-roll></div></div>') !== -1, 'the red mark over its middle');
  assert.ok(body.indexOf('data-sa-big></div><div class="sa-roll"') !== -1, 'right under the screen\'s picture');
  assert.match(part(ed, 'big'), /^<div class="sa-big" role="img" aria-label="Compact calendar, Graph 1: [^"]*Calendar \(2 rows\)[^"]*"><svg/,
    'its picture says its calendar and its graph');
  assert.deepEqual(graphName(ed), ['Graph 1', 'Your graph']);
  assert.equal(part(ed, 'sel').indexOf('Graph 1'), -1, 'its name once: under its picture in the roll');
  assert.deepEqual(legend(ed), ['Temperature', 'Rain chance', 'Rain']);
  // Your graph keeps its own length: shown, not picked here.
  let foot = part(ed, 'foot');
  assert.deepEqual(segments(foot, 'aspan'), [['12 h', '12', false, true], ['24 h', '24', false, true], ['66 h', '48', true, true]]);
  assert.ok(foot.indexOf('<div class="sa-gap">' + YOUR_LENGTH + '</div>') !== -1);
  assert.ok(foot.indexOf('<button type="button" class="sa-add" data-se="addnow">Add screen</button>') !== -1);
  assert.equal(foot.indexOf('sa-fine'), -1);
  page.tapEditor({ se: 'aspan', v: '12', disabled: true });
  assert.deepEqual(segments(part(ed, 'foot'), 'aspan').map((x) => x[2]), [false, false, true], 'a tap on it does nothing');
  // A template in the roll: its graph on the screen, at its own length, which can be picked.
  page.tapEditor({ se: 'agraph', v: 'clean' });
  assert.deepEqual(graphName(ed), ['Clean', 'Template']);
  assert.equal(part(ed, 'sel').indexOf('Clean'), -1, 'a template\'s name once too');
  assert.ok(head.innerHTML.indexOf('id="seTitle">Compact calendar</span>') !== -1, 'the layout\'s name stays');
  assert.equal(reel(ed), drawn, 'the roll stays as drawn: it may be rolling');
  assert.deepEqual([marked(ed, '1'), marked(ed, 'clean')], ['false', 'true'], 'Clean marked in it');
  foot = part(ed, 'foot');
  assert.deepEqual(segments(foot, 'aspan'), [['12 h', '12', false, false], ['24 h', '24', false, false],
    ['66 h', '48', true, false]], 'its own length');
  assert.ok(foot.endsWith(TEMPLATE_FINE), 'what a template is');
  page.tapEditor({ se: 'aspan', v: '24' });
  assert.deepEqual(segments(part(ed, 'foot'), 'aspan').map((x) => x[2]), [false, true, false]);
  // Add screen: the screen goes in after the others, its editor next.
  page.tapEditor({ se: 'addnow' });
  assert.equal(page.S.viewName1, 'Clean');
  assert.equal(page.S.viewStyle1, 't1', 'its template\'s graph');
  assert.equal(GS.settingsFor(GSP.normalize(page.S), GS.MAX_STYLES).forecastHours, '24');
  assert.deepEqual(M.screensOf(page.S, EMERY)[1], [b('strip'), b('cal', { rows: '2' }), b('clock'), b('fcbar'),
    b('fc', { size: 'fill', style: 't1' })], 'the compact calendar');
  assert.ok(head.innerHTML.indexOf('id="seTitle">Clean</span><button type="button" class="ui-pen" data-se="rename" '
    + 'aria-label="Rename Clean">') !== -1, 'its editor, by its name, the pencil after it');
  assert.ok(head.innerHTML.indexOf('<button type="button" class="dlg-done" data-se="close">Done</button>') !== -1, 'Done');
  page.tapEditor({ se: 'close' });
  assert.ok(page.scroll.innerHTML.indexOf('<span class="ui-n">Clean</span>') !== -1, 'the card names it');
});

test('Blank goes in at once, the Watch bar and the clock, its editor next', () => {
  const page = bootGeneratedPage({ provider: 'dwd' }, 'emery');
  page.tapAction('addScreen');
  page.tapEditor({ se: 'pick', id: 'blank', cal: '' });
  assert.equal(page.S.viewCount, '2');
  assert.deepEqual(M.screensOf(page.S, EMERY)[1], [b('strip'), b('clock')]);
  const head = page.editor().querySelector('[data-se-head]').innerHTML;
  assert.ok(head.indexOf('id="seTitle">Flick 1</span><button type="button" class="ui-pen"') !== -1,
    'its editor, by its place\'s name');
  assert.equal(page.S.graphStyles, fresh(EMERY).graphStyles, 'no graph made');
});

test('the roll is drawn once while it is open: the graphs beside the one picked at once, the others a few a frame after it', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const page = bootGeneratedPage({ provider: 'dwd' }, 'emery');
  page.tapAction('addScreen');
  const ed = page.editor();
  page.tapEditor({ se: 'pick', id: 'health', cal: '' });
  assert.deepEqual([reel(ed), pickShown(ed)], ['', [true, false]], 'none for a screen without a forecast graph');
  page.tapEditor({ se: 'addback' });
  page.tapEditor({ se: 'pick', id: 'forecast', cal: '' });
  const pics = [...reel(ed).matchAll(/<span class="sa-th" aria-hidden="true" data-sa-th="([^"]+)">(<svg[\s\S]*?<\/svg>)<\/span><span class="sa-gn">/g)];
  assert.equal(pics.length, 1 + TEMPLATE_IDS.length);
  assert.deepEqual(pics.filter((m) => m[2].length > 3000).map((m) => m[1]), ['1', 'classic', 'clean'],
    'the one picked and the two beside it');
  assert.ok(pics.filter((m) => m[2].length <= 3000).every((m) => /^<svg[^>]*><rect[^>]*><\/rect><\/svg>$/.test(m[2])),
    'the others their ground, the size a picture takes');
  const drawn = (v) => ed.querySelector('[data-sa-th="' + v + '"]').innerHTML.length > 3000;
  assert.ok(!TEMPLATE_IDS.some(drawn), 'not yet');
  t.mock.timers.tick(16);
  assert.deepEqual(TEMPLATE_IDS.filter(drawn), ['stripes', 'simple', 'rain'], 'three a frame, nearest first');
  // Back to the cards: the rest go on into their places, which stay, hidden.
  page.tapEditor({ se: 'addback' });
  assert.deepEqual(pickShown(ed)[0], false);
  let steps = 1;
  for (; steps < 20 && !TEMPLATE_IDS.slice(2).every(drawn); steps++) { t.mock.timers.tick(16); }
  assert.equal(steps, 4, 'then the rest');
  // Another layout, Health or a screen of two graphs: the roll as it is, hidden where it has no use;
  // a layout picked anew has its graph put back in the middle (Sky 1000 px in, the roll 390 wide).
  const strip = ed.querySelector('[data-sa-roll]'), sky = strip.querySelector('[data-sa-g="sky"]');
  Object.assign(strip, { clientWidth: 390, scrollLeft: 0 });
  Object.assign(sky, { offsetLeft: 1000, offsetWidth: 156 });
  let writes = 0, html = strip.innerHTML;
  Object.defineProperty(strip, 'innerHTML', { get: () => html, set: (v) => { html = v; writes += 1; } });
  page.tapEditor({ se: 'pick', id: 'forecast', cal: '3' });
  page.tapEditor({ se: 'agraph', v: 'sky' });
  assert.equal(strip.scrollLeft, 883, 'Sky rolled to the middle');
  page.tapEditor({ se: 'addback' });
  strip.scrollLeft = 0;
  page.tapEditor({ se: 'pick', id: 'forecast', cal: '2' });
  assert.equal(strip.scrollLeft, 883, 'in the middle again');
  assert.deepEqual(pickShown(ed), [true, true]);
  page.tapEditor({ se: 'addback' });
  page.tapEditor({ se: 'pick', id: 'health', cal: '' });
  assert.deepEqual(pickShown(ed), [true, false], 'Health: no roll');
  page.tapEditor({ se: 'addback' });
  page.tapEditor({ se: 'pick', id: 'radarfc', cal: '' });
  assert.deepEqual(pickShown(ed), [true, true], 'the radar over a forecast graph: the roll again');
  assert.equal(writes, 0, 'never drawn anew');
});

test('the roll\'s graphs draw no legend: the legend shows once, under the row', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const page = bootGeneratedPage({ provider: 'dwd' }, 'emery');
  page.tapAction('addScreen');
  const ed = page.editor();
  page.tapEditor({ se: 'pick', id: 'forecast', cal: '' });
  for (let i = 0; i < 5; i++) { t.mock.timers.tick(16); }
  // Every picture: those drawn with the roll, and those drawn into their places after it.
  const inline = new Map([...reel(ed).matchAll(/data-sa-th="([^"]+)">(<svg[\s\S]*?<\/svg>)<\/span><span class="sa-gn">/g)]
    .map((m) => [m[1], m[2]]));
  const pics = ['1'].concat(TEMPLATE_IDS).map((v) => [v, ed.querySelector('[data-sa-th="' + v + '"]').innerHTML || inline.get(v)]);
  assert.ok(pics.every((m) => m[1].length > 3000), 'all drawn');
  const label = />(Temp|Precip %|Cloud %|Wind|Gust|UV|Pressure|Feels|Dew|Rain)<\/text>/;
  assert.deepEqual(pics.filter((m) => label.test(m[1])).map((m) => m[0]), [], 'no legend in the roll');
  const tall = (svg) => Number(/viewBox="(?:\S+ ){3}(\S+)"/.exec(svg)[1]);
  const heights = new Set(pics.map((m) => tall(m[1])));
  assert.equal(heights.size, 1, 'every picture one height');
  const pickers = pics.map((m) => GSP.valuePicture(page.S, EMERY, m[0], {}, 'gs-' + m[0]));
  assert.equal(pickers.filter((svg) => !label.test(svg)).length, 0, 'the same graphs keep theirs in the pickers');
  assert.ok([...heights][0] < Math.min(...pickers.map(tall)), 'no room kept for one: the frame ends under the hours');
  assert.deepEqual(legend(ed), ['Temperature', 'Rain chance', 'Rain'], 'under the row: the picked graph\'s');
});

test('the roll: the graph a scroll settles on is picked; a tap rolls one to the middle; the arrow keys pick the next', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const page = bootGeneratedPage({ provider: 'dwd' }, 'emery');
  page.tapAction('addScreen');
  const ed = page.editor();
  page.tapEditor({ se: 'pick', id: 'forecast', cal: '' });
  // The roll as the WebView lays it out: the graphs 168 px apart, the middle at 195 px.
  const strip = ed.querySelector('[data-sa-roll]'), ids = roll(reel(ed)).map((x) => x[0]);
  let centre = '1';
  strip.getBoundingClientRect = () => ({ left: 0, width: 390 });
  strip.querySelectorAll = () => ids.map((v, x) => ({ getAttribute: () => v,
    getBoundingClientRect: () => ({ left: 117 + (x - ids.indexOf(centre)) * 168, width: 156 }) }));
  const settle = (v) => { centre = v; strip.dispatch('scroll', {}); t.mock.timers.tick(16); };
  settle('storm');
  assert.deepEqual(graphName(ed), ['Storm', 'Template'], 'the graph in the middle is the one on the screen');
  assert.deepEqual(segments(part(ed, 'foot'), 'aspan').map((x) => x[2]), [false, true, false], 'at its own length: 24 h');
  page.tapEditor({ se: 'aspan', v: '12' });
  assert.deepEqual(segments(part(ed, 'foot'), 'aspan').map((x) => x[2]), [true, false, false]);
  // A tap picks at once; the graphs the roll passes on its way there stay unpicked.
  page.tapEditor({ se: 'agraph', v: 'meteogram' });
  assert.deepEqual(graphName(ed), ['Meteogram', 'Template']);
  assert.deepEqual(segments(part(ed, 'foot'), 'aspan').map((x) => x[2]), [false, false, true],
    'its own length, 66 h, not the one picked for Storm');
  settle('pressure');
  assert.equal(graphName(ed)[0], 'Meteogram', 'passing Pressure');
  settle('meteogram');
  settle('pressure');
  assert.equal(graphName(ed)[0], 'Pressure', 'arrived: the roll picks again');
  // A tap whose roll is cut short: the roll picks again after a moment.
  page.tapEditor({ se: 'agraph', v: 'classic' });
  settle('wind');
  assert.equal(graphName(ed)[0], 'Classic');
  t.mock.timers.tick(700);
  settle('wind');
  assert.equal(graphName(ed)[0], 'Wind');
  // The arrow keys on a graph in the roll: the one beside it, the focus along.
  const key = (k, v) => page.docDispatch('keydown', { key: k, preventDefault() {},
    target: { closest: (sel) => (sel === '[data-sa-g]' ? { getAttribute: () => v } : null) } });
  key('ArrowRight', 'wind');
  assert.equal(graphName(ed)[0], 'Storm');
  assert.ok(ed.querySelector('[data-sa-g="storm"]').focuses > 0, 'the focus goes along');
  key('ArrowLeft', '1');
  assert.equal(graphName(ed)[0], 'Storm', 'nothing before the first');
  key('ArrowLeft', 'classic');
  assert.deepEqual(graphName(ed), ['Graph 1', 'Your graph']);
});

test('Outdoor at the length picked; the graph picked stays for the next layout; Health picks its calendar; ‹ and Escape go back', () => {
  const page = bootGeneratedPage({ provider: 'dwd' }, 'emery');
  page.tapAction('addScreen');
  const ed = page.editor();
  page.tapEditor({ se: 'pick', id: 'forecast', cal: '' });
  page.tapEditor({ se: 'agraph', v: 'outdoor' });
  assert.deepEqual(legend(ed), ['Temperature', 'Rain chance', 'UV index', 'Rain'], 'the long span: no feels-like line');
  page.tapEditor({ se: 'aspan', v: '12' });
  assert.deepEqual(legend(ed).slice(2, 4), ['UV index', 'Feels like']);
  // ‹, then another layout: Outdoor still, at 12 hours, marked in its roll.
  page.tapEditor({ se: 'addback' });
  assert.deepEqual([cardsShown(ed), pickShown(ed)[0]], [true, false], 'the cards again');
  page.tapEditor({ se: 'pick', id: 'forecast', cal: '3' });
  assert.deepEqual(graphName(ed), ['Outdoor', 'Template']);
  assert.deepEqual([marked(ed, '1'), marked(ed, 'outdoor')], ['false', 'true'], 'marked in its roll');
  assert.deepEqual(segments(part(ed, 'foot'), 'aspan').map((x) => x[2]), [true, false, false]);
  page.tapEditor({ se: 'addnow' });
  assert.deepEqual(M.screensOf(page.S, EMERY)[1].map((x) => x.k), ['strip', 'cal', 'clock', 'fcbar', 'fc'], 'the full calendar');
  assert.equal(GS.settingsFor(GSP.normalize(page.S), GS.MAX_STYLES).fourthLine, 'feels',
    'the graph it brings draws what it said');
  // Health: no roll, no length; its calendar picked here, from none.
  page.tapEditor({ se: 'close' });
  page.tapAction('addScreen');
  const again = page.editor(), bodyAgain = again.querySelector('[data-se-body]');
  // The cards stay as drawn under a picked screen: ‹ shows them, not drawn anew.
  let writes = 0, cards = bodyAgain.innerHTML;
  Object.defineProperty(bodyAgain, 'innerHTML', { get: () => cards, set: (v) => { cards = v; writes += 1; } });
  page.tapEditor({ se: 'pick', id: 'health', cal: '' });
  assert.deepEqual(pickShown(again), [true, false], 'no roll');
  assert.equal(graphName(again), null);
  assert.deepEqual(segments(part(again, 'foot'), 'acal'), [['None', '', true, false], ['Compact', '2', false, false],
    ['Full', '3', false, false], ['Dense', 'dense', false, false]]);
  assert.deepEqual(segments(part(again, 'foot'), 'aspan'), [], 'no length');
  assert.deepEqual(legend(again), ['Steps', 'Heart rate', 'Sleep']);
  page.tapEditor({ se: 'acal', v: '3' });
  assert.match(part(again, 'big'), /aria-label="Health: [^"]*Calendar \(3 rows\)/, 'the full calendar on its picture');
  assert.ok(again.querySelector('[data-se-head]').innerHTML.indexOf('id="seTitle">Health</span>') !== -1);
  page.tapEditor({ se: 'addback' });
  assert.deepEqual([cardsShown(again), pickShown(again)[0]], [true, false], 'the cards again');
  page.tapEditor({ se: 'pick', id: 'radar', cal: '' });
  page.docDispatch('keydown', { key: 'Escape', target: {}, preventDefault() {} });
  assert.ok(page.editor(), 'still open');
  assert.deepEqual([cardsShown(again), pickShown(again)[0]], [true, false], 'Escape: the cards again');
  assert.equal(writes, 0, 'never drawn anew');
  assert.equal(sheetCards(cards).length, 9);
  page.docDispatch('keydown', { key: 'Escape', target: {}, preventDefault() {} });
  assert.equal(page.editor(), null, 'Escape on the cards closes it');
});

test('a template screen in its editor: its graph by its template\'s name; its Edit makes it yours and opens it', () => {
  const page = bootGeneratedPage({ provider: 'dwd' }, 'emery');
  page.tapAction('addScreen');
  page.tapEditor({ se: 'pick', id: 'forecast', cal: '' });
  page.tapEditor({ se: 'agraph', v: 'outdoor' });
  page.tapEditor({ se: 'addnow' });
  const body = () => page.editor().querySelector('[data-se-body]').innerHTML;
  const note = '<div class="se-sub se-off"><span>' + SP.TEMPLATE_NOTE + '</span></div>';
  assert.ok(body().indexOf('<span class="se-name">Outdoor</span>') !== -1, 'its graph by its template\'s name');
  assert.ok(body().indexOf(note) !== -1, 'what that means');
  assert.match(body(), /<button type="button" class="thr-btn" data-se="adopt" data-j="\d+" aria-haspopup="dialog" aria-label="Edit Outdoor">/,
    'the row\'s Edit makes it yours');
  assert.equal(body().indexOf('data-se="editgraph"'), -1, 'not yet one of yours');
  assert.equal(SP.TEMPLATE_NOTE, 'Not one of your graphs until you edit it.');
  assert.match(body(), /data-se="switch" data-k="fc" data-g="0"/, 'Switch graph offers your graph, though you have one');
  // Its Edit: one of yours, named after its template, its dialog over the editor.
  page.tapEditor({ se: 'adopt' });
  assert.equal(GS.count(page.S), 2);
  assert.equal(GS.name(page.S, 1), 'Outdoor');
  assert.equal(page.S.viewStyle1, '2', 'the screen draws it');
  assert.ok(page.modal.innerHTML.indexOf('id="esheet-ttl-graph">Outdoor</span>') !== -1, 'its dialog');
  assert.ok(page.modal.innerHTML.indexOf('<span class="dlg-kick">Outdoor</span>') !== -1, 'opened from the screen');
  assert.ok(page.editor(), 'the editor under it');
  assert.equal(body().indexOf(SP.TEMPLATE_NOTE), -1, 'one of yours now: no note');
  // A screen's Switch graph to your first graph lets its template graph go.
  const other = bootGeneratedPage({ provider: 'dwd' }, 'emery');
  other.tapAction('addScreen');
  other.tapEditor({ se: 'pick', id: 'forecast', cal: '2' });
  other.tapEditor({ se: 'agraph', v: 'sky' });
  other.tapEditor({ se: 'addnow' });
  other.tapEditor({ se: 'switch', k: 'fc', g: '0' });
  assert.equal(other.S.viewStyle1, '1');
  assert.equal(GS.exists(other.S, GS.MAX_STYLES), false, 'nothing left behind');
});

test('the Dense card: the compact calendar, the radar bar under it, more status bars at once; the radar on for it', () => {
  const page = bootGeneratedPage({ provider: 'dwd', radarEnabled: false }, 'emery');
  page.tapAction('addScreen');
  page.tapEditor({ se: 'pick', id: 'forecast', cal: 'dense' });
  page.tapEditor({ se: 'addnow' });
  assert.deepEqual(M.screensOf(page.S, EMERY)[1].map((x) => x.k), ['strip', 'cal', 'radarbar', 'clock', 'fcbar', 'fc']);
  assert.equal(page.S.radarEnabled, true, 'its radar bar needs the radar');
  assert.equal(page.S.viewName1, 'Forecast', 'your first graph, on its default name');
  assert.equal(page.S.graphStyles, fresh(EMERY).graphStyles, 'no graph made');
});

test('the picked screen says what the weather service leaves out of its graph, under its legend', () => {
  const page = bootGeneratedPage({ provider: 'yandex' }, 'emery');
  page.tapAction('addScreen');
  page.tapEditor({ se: 'pick', id: 'forecast', cal: '' });
  page.tapEditor({ se: 'agraph', v: 'meteogram' });
  assert.deepEqual(legend(page.editor()).slice(-2), ['Rain', '! Yandex sends no clouds or air pressure.']);
  page.tapEditor({ se: 'agraph', v: 'wind' });
  assert.ok(legend(page.editor()).every((r) => r.charAt(0) !== '!'), 'Yandex sends the wind and gusts');
});

test('a screen that cannot be added: its reason, Add screen off; a basalt keeps its graph', () => {
  const page = bootGeneratedPage(Object.assign({ provider: 'dwd' }, BUSY), 'emery');
  page.tapAction('addScreen');
  page.tapEditor({ se: 'pick', id: 'forecast', cal: '2' });
  assert.equal(part(page.editor(), 'foot').indexOf('sa-why'), -1, 'your graph adds no metric');
  page.tapEditor({ se: 'agraph', v: 'stripes' });
  const foot = part(page.editor(), 'foot');
  assert.match(foot, /<div class="sa-why" role="status">Also needs [^<]*The watch can show 5\.<\/div>/);
  assert.ok(foot.indexOf('<button type="button" class="sa-add" data-se="addnow" disabled>Add screen</button>') !== -1);
  page.tapEditor({ se: 'addnow', disabled: true });
  assert.equal(page.S.viewCount, '1', 'nothing added');
  const basalt = bootGeneratedPage({ provider: 'dwd' });
  basalt.tapAction('addScreen');
  const body = basalt.editor().querySelector('[data-se-body]').innerHTML;
  assert.deepEqual(sheetCards(body).map((c) => c[0] + ':' + c[1]), ['blank:', 'forecast:', 'forecast:2', 'forecast:3',
    'forecast:dense', 'health:', 'radar:', 'healthfc:', 'radarfc:'], 'the same cards');
  assert.ok(body.indexOf('A screen brings its rows. Your graph and your status bars stay as they are.') !== -1);
  basalt.tapEditor({ se: 'pick', id: 'forecast', cal: '2' });
  const ed = basalt.editor();
  assert.deepEqual(pickShown(ed), [true, false], 'one graph: no roll');
  assert.equal(graphName(ed), null);
  assert.deepEqual(segments(part(ed, 'foot'), 'aspan'), [], 'nor a length: the watch has one');
  assert.deepEqual(legend(ed), ['Temperature', 'Rain chance', 'Rain'], 'your graph');
  basalt.tapEditor({ se: 'addnow' });
  assert.equal(basalt.S.viewName1, 'Forecast');
});

test('Add a screen draws its cards once while it is open, anew each time it opens: they follow your graph', () => {
  const page = bootGeneratedPage({ provider: 'dwd' });
  page.tapAction('addScreen');
  const body = () => page.editor().querySelector('[data-se-body]').innerHTML;
  assert.equal(sheetCards(body()).length, 9);
  page.tapEditor({ se: 'pick', id: 'forecast', cal: '3' });
  assert.deepEqual(legend(page.editor()), ['Temperature', 'Rain chance', 'Rain']);
  page.tapEditor({ se: 'addback' });
  assert.equal(sheetCards(body()).length, 9, 'back on the cards');
  const drawn = page.scroll.writes;
  page.tapEditor({ se: 'close' });
  assert.equal(page.editor(), null);
  assert.equal(page.scroll.writes, drawn, 'closed without adding a screen: the page stays as drawn');
  page.S.secondaryLine = 'wind';
  page.tapAction('addScreen');
  page.tapEditor({ se: 'pick', id: 'forecast', cal: '' });
  assert.deepEqual(legend(page.editor()), ['Temperature', 'Wind', 'Rain'], 'your graph as it is now');
});

test('a screen of two graphs: no calendar, the health graph or the radar over the forecast graph picked', () => {
  const page = bootGeneratedPage({ provider: 'dwd', radarEnabled: false });
  page.tapAction('addScreen');
  const ed = page.editor();
  page.tapEditor({ se: 'pick', id: 'radarfc', cal: '' });
  assert.ok(ed.querySelector('[data-se-head]').innerHTML.indexOf('id="seTitle">Radar + forecast</span>') !== -1);
  assert.deepEqual(segments(part(ed, 'foot'), 'acal'), [], 'no calendar to pick');
  assert.deepEqual(segments(part(ed, 'foot'), 'aspan'), [], 'your graph, at its length');
  assert.deepEqual(legend(ed), ['Rain radar', 'Temperature', 'Rain chance', 'Rain'], 'the radar in one row, then the forecast');
  page.tapEditor({ se: 'addnow' });
  assert.deepEqual(M.screensOf(page.S, BASALT)[1], P.screenOf(P.byId('radarfc'), ''), 'its rows');
  assert.equal(page.S.viewName1, 'Radar + forecast');
  assert.equal(page.S.radarEnabled, true, 'the radar on for it');
  assert.equal(page.S.radarMode, 'graph', 'the modes follow');
  // On the Pebble Time 2 its forecast graph is picked in the roll, as any forecast screen's.
  const emery = bootGeneratedPage({ provider: 'dwd' }, 'emery');
  emery.tapAction('addScreen');
  emery.tapEditor({ se: 'pick', id: 'healthfc', cal: '' });
  assert.equal(roll(reel(emery.editor())).length, 1 + TEMPLATE_IDS.length);
  emery.tapEditor({ se: 'agraph', v: 'clean' });
  assert.deepEqual(legend(emery.editor()), ['Health graph', 'Temperature', 'Rain chance', 'Rain']);
  emery.tapEditor({ se: 'addnow' });
  assert.deepEqual(M.screensOf(emery.S, EMERY)[1].map((x) => x.k), ['strip', 'health', 'clock', 'fcbar', 'fc']);
  assert.equal(emery.S.viewStyle1, 't1', 'Clean\'s graph under the health graph');
  assert.equal(emery.S.viewName1, 'Health + forecast');
});

test('the editor\'s title renames the screen: Enter keeps the name, Escape drops it', () => {
  const page = bootGeneratedPage(THREE);
  page.tapAction('openScreen', 1);
  const ed = page.editor(), title = ed.querySelector('[data-se-head]');
  assert.ok(title.innerHTML.indexOf('aria-label="Rename Flick 1"') !== -1);
  page.tapEditor({ se: 'rename' });
  // The page's one rename (ui.js renameField): the field in the title's place, OK in Done's.
  assert.match(title.innerHTML, /<input type="text" class="ui-rn-in" data-se-name maxlength="24" autocomplete="off" aria-label="Screen name" placeholder="Flick 1" value="Flick 1"><button type="button" class="dlg-done" data-se="renameok">OK<\/button><\/div>$/);
  assert.equal(title.innerHTML.indexOf('>Done</button>'), -1, 'OK in Done\'s place');
  const input = ed.querySelector('[data-se-name]');
  assert.ok(input.focuses > 0, 'the field takes the focus');
  input.value = '  Steps ';
  input.dispatch('keydown', { key: 'Enter', preventDefault() {}, stopPropagation() {} });
  assert.equal(page.S.viewName1, 'Steps');
  assert.ok(title.innerHTML.indexOf('id="seTitle">Steps</span>') !== -1);
  assert.ok(page.scroll.innerHTML.indexOf('<span class="ui-n">Steps</span>') !== -1, 'the card follows');
  // Escape: the name as it was, the editor still open.
  page.tapEditor({ se: 'rename' });
  const again = ed.querySelector('[data-se-name]');
  again.value = 'Nope';
  again.dispatch('keydown', { key: 'Escape', preventDefault() {}, stopPropagation() {} });
  assert.equal(page.S.viewName1, 'Steps');
  assert.ok(page.editor(), 'still open');
  // Blur keeps what was typed; the place's name stores none.
  page.tapEditor({ se: 'rename' });
  const third = ed.querySelector('[data-se-name]');
  third.value = 'Flick 1';
  third.dispatch('blur', {});
  assert.equal(page.S.viewName1, '');
  assert.ok(title.innerHTML.indexOf('id="seTitle">Flick 1</span>') !== -1);
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
  assert.match(GSP.listRows(S, EMERY).rows[0].where, / · Home$/);
});
