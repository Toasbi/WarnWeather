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
const WF = require('../src/pkjs/settings/wizard-forecast.js');
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

// --- the screens Add a screen offers -----------------------------------------------------

const CAL = { none: '', compact: '2', full: '3' };

// The templates' screens, in Add a screen's order (the owner's, 2026-11-09: more of them, to show
// what the graph can draw; 2026-11-10: from the common ways to show the weather).
const TEMPLATE_IDS = ['classic', 'clean', 'stripes', 'outdoor', 'meteogram', 'wind', 'comfort', 'clouds'];

test('the kinds: the templates, Health, Rain radar and two graphs on a screen; each watch the ones it can draw', () => {
  assert.deepEqual(P.KINDS.map((k) => k.name), ['Classic', 'Clean', 'Stripes', 'Outdoor', 'Meteogram', 'Wind', 'Comfort',
    'Clouds', 'Forecast', 'Health', 'Rain radar', 'Health + forecast', 'Radar + forecast']);
  assert.deepEqual(P.offered(EMERY).map((k) => k.id), TEMPLATE_IDS.concat(['health', 'radar', 'healthfc', 'radarfc']),
    'the Pebble Time 2: the templates, Health, Rain radar and the screens of two graphs');
  assert.deepEqual(P.offered(BASALT).map((k) => k.id), ['forecast', 'health', 'radar', 'healthfc', 'radarfc'],
    'a watch with one graph: one forecast screen, which keeps its graph');
  assert.deepEqual(P.offered(DIORITE).map((k) => k.id), P.offered(BASALT).map((k) => k.id), 'black and white too');
  assert.deepEqual(P.offered(APLITE).map((k) => k.id), ['forecast'], 'no health, no radar');
  assert.deepEqual(P.offered(null).map((k) => k.id), TEMPLATE_IDS.concat(['health', 'radar', 'healthfc', 'radarfc']),
    'an unknown watch is capable');
  // Each template's screen is a look, named as it is (wizard-forecast.js LOOKS, their one definition).
  assert.deepEqual(P.offered(EMERY).filter((k) => k.look).map((k) => k.look), WF.LOOKS.map((look) => look.id));
  P.KINDS.filter((k) => k.look).forEach((k) => assert.equal(k.name, WF.lookOf(k.look).label, k.id));
  // The headings: the forecast screens, then the others.
  assert.deepEqual(P.GROUPS.map((g) => g.name), ['Forecast', 'Health and radar']);
  assert.deepEqual(P.KINDS.filter((k) => k.group === 'fc').map((k) => k.id), TEMPLATE_IDS.concat(['forecast']));
  assert.ok(P.KINDS.every((k) => P.GROUPS.some((g) => g.id === k.group)), 'every kind under a heading');
  assert.deepEqual(P.CALENDARS, [['None', ''], ['Compact', '2'], ['Full', '3']]);
  // A screen of two graphs has no calendar: its upper graph sits in the calendar's seat.
  assert.deepEqual(P.KINDS.filter((k) => !P.calendars(k).length).map((k) => k.id), ['healthfc', 'radarfc']);
  assert.deepEqual(P.KINDS.filter(P.showsRadar).map((k) => k.id), ['radar', 'radarfc'], 'the screens that turn the radar on');
  assert.equal(P.byId('nope'), null);
  // Add a screen's cards: each kind once per calendar, None, Compact and Full; two graphs once.
  assert.deepEqual(P.cards(BASALT).map((c) => c.kind.id + ':' + c.cal), ['forecast:', 'forecast:2', 'forecast:3',
    'health:', 'health:2', 'health:3', 'radar:', 'radar:2', 'radar:3', 'healthfc:', 'radarfc:']);
  assert.equal(P.cards(EMERY).length, 8 * 3 + 2 * 3 + 2, 'the Pebble Time 2: 32 cards');
  assert.deepEqual(P.cards(EMERY).slice(0, 4).map((c) => [c.kind.id, c.cal, P.calendarName(c.kind, c.cal)]),
    [['classic', '', 'No calendar'], ['classic', '2', 'Compact calendar'], ['classic', '3', 'Full calendar'],
      ['clean', '', 'No calendar']]);
  assert.equal(P.calendarName(P.byId('radarfc'), ''), '', 'two graphs: no calendar to name');
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
  assert.deepEqual(P.screenOf(P.byId('clean'), CAL.compact), P.listOf('fc', CAL.compact));
  // Every kind with every calendar keeps the rules and fits as a flick screen on every watch that
  // is offered it.
  [EMERY, BASALT, CHALK, DIORITE, FLINT].forEach((env) => P.offered(env).forEach((kind) => Object.values(CAL)
    .forEach((cal) => {
      const list = P.screenOf(kind, cal);
      assert.equal(M.problem(list), '', kind.id + cal + ' keeps the rules');
      assert.ok(M.fits(list, 1, env.platform), kind.id + ' with ' + (cal || 'no') + ' calendar fits on ' + env.platform);
    })));
  // A screen read back: its calendar, and the graph it is a screen of (calendar and graph aside).
  assert.deepEqual(Object.values(CAL).map((cal) => P.calOf(P.listOf('fc', cal))), ['', '2', '3']);
  assert.equal(P.graphOf(P.listOf('radar', CAL.full)), 'radar');
  assert.equal(P.graphOf([b('strip'), b('clock'), b('fcbar'), b('fc', { size: 'fill', style: '3' })]), 'fc');
  assert.equal(P.graphOf([b('strip'), b('clock'), b('fc', { size: 'fill' })]), '', 'a screen of your own');
});

test('Forecast length: a forecast screen\'s lengths, on the Pebble Time 2 only', () => {
  assert.deepEqual(P.spanOptions(P.byId('clean'), EMERY, {}), [['12 h', '12'], ['24 h', '24'], ['66 h', '48']]);
  assert.deepEqual(P.spanOptions(P.byId('health'), EMERY, {}), []);
  assert.deepEqual(P.spanOptions(P.byId('healthfc'), EMERY, {}), [], 'a screen of two graphs keeps your graph');
  assert.deepEqual(P.spanOptions(P.byId('forecast'), BASALT, {}), []);
});

test('Add a screen\'s cards: each kind on each calendar, on its template\'s length', () => {
  const S = fresh(BASALT);
  const choices = SP.addChoices(S, BASALT);
  assert.deepEqual(choices.map((c) => [c.id, c.cal, c.calName, c.span, c.why]),
    [['forecast', '', 'No calendar', '', ''], ['forecast', '2', 'Compact calendar', '', ''],
      ['forecast', '3', 'Full calendar', '', ''], ['health', '', 'No calendar', '', ''],
      ['health', '2', 'Compact calendar', '', ''], ['health', '3', 'Full calendar', '', ''],
      ['radar', '', 'No calendar', '', ''], ['radar', '2', 'Compact calendar', '', ''], ['radar', '3', 'Full calendar', '', ''],
      ['healthfc', '', '', '', ''], ['radarfc', '', '', '', '']], 'a screen of two graphs: one card, no calendar');
  assert.ok(choices.every((c) => c.graph === null), 'one graph: no screen brings one');
  // Each card's picture settings hold the screen it adds, after the others, on its calendar.
  choices.forEach((c) => assert.deepEqual(M.screensOf(c.W, BASALT)[1], c.list, c.id + '\'s picture'));
  assert.deepEqual(choices.slice(3, 6).map((c) => P.calOf(c.list)), ['', '2', '3']);
  assert.equal(choices[6].W.radarEnabled, true, 'the Rain radar card draws the radar it turns on');
  assert.equal(choices[6].W.radarMode, 'graph', 'as its screen will draw it: a graph, its sky rows and all');
  assert.equal(S.radarMode, 'countdown', 'premise: no screen of yours draws the radar as a graph');
  assert.equal(choices[10].W.radarEnabled, true, 'so does Radar + forecast');
  assert.equal(JSON.stringify(S), JSON.stringify(fresh(BASALT)), 'reading the cards changes nothing');
  // On the Pebble Time 2 each template starts on its own length, on all three of its cards.
  assert.deepEqual(SP.addChoices(fresh(EMERY), EMERY).filter((c) => c.cal === '2').map((c) => [c.id, c.span]),
    [['classic', '24'], ['clean', '48'], ['stripes', '24'], ['outdoor', '48'], ['meteogram', '48'], ['wind', '24'],
      ['comfort', '24'], ['clouds', '48'], ['health', ''], ['radar', '']]);
  // Three screens: nothing to add.
  assert.deepEqual(SP.addChoices(withScreens(BASALT, [M.screensOf(fresh(BASALT), BASALT)[0], HEALTH, RADAR]), BASALT), []);
});

test('adding a screen: its rows on the calendar picked, after the others, named after it; the same one twice', () => {
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
  // One that is not offered adds nothing.
  const U = fresh(BASALT), kept = JSON.stringify(U);
  assert.equal(SP.addChosen(U, BASALT, 'clean'), -1, 'not offered on a basalt');
  assert.equal(SP.addChosen(U, BASALT, 'nope'), -1);
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

test('a forecast screen on a Pebble Time 2 brings its graph: a new one from its template at the length picked', () => {
  const S = fresh(EMERY);
  const c = SP.addChoices(S, EMERY).filter((x) => x.id === 'clean')[0];
  assert.deepEqual([c.graph.k, Boolean(c.graph.values), c.why], [1, true, ''],
    'the first graph does not read as Clean: a new graph in the first free slot');
  assert.equal(SP.addChosen(S, EMERY, 'clean', CAL.full, '24'), 1);
  assert.equal(GS.count(S), 2);
  assert.equal(GS.name(S, 1), 'Graph 2');
  assert.equal(S.viewStyle1, '2', 'the new screen draws it');
  assert.equal(S.viewName1, 'Clean');
  assert.deepEqual(M.screensOf(S, EMERY)[1].map((x) => x.k), ['strip', 'cal', 'clock', 'fcbar', 'fc']);
  assert.equal(GS.settingsFor(S, 1).forecastHours, '24', 'the length picked, not the template\'s');
  // Clean again at the same length reads as that graph: it uses it, and makes none.
  const again = SP.addChoices(S, EMERY).filter((x) => x.id === 'clean')[0];
  assert.deepEqual([again.graph.k, Boolean(again.graph.values)], [2, true], 'Clean starts on the long span: a graph of its own');
  assert.equal(SP.addChosen(S, EMERY, 'clean', CAL.none, '24'), 2);
  assert.equal(GS.count(S), 2, 'no new graph');
  assert.equal(S.viewStyle2, '2');
  assert.equal(S.viewName2, 'Clean 2');
});

test('Outdoor brings its feels-like line on 12 and 24 hours, not over the long span', () => {
  const S = fresh(EMERY);
  const at = (span) => GSP.presetGraph(S, EMERY, 'outdoor', span);
  assert.equal(at('48').values.fourthLine, 'off');
  assert.equal(at('24').values.fourthLine, 'feels');
  assert.equal(at('12').values.fourthLine, 'feels');
  assert.equal(at('24').values.fourthLineStyle, 'line');
  assert.equal(at('24').values.thirdLine, 'uv', 'its UV line on every length');
  assert.equal(at('48').values.rainBarFrom, 'top', 'its bars from the top');
  // Added at 24 hours: the graph it makes draws the line; the long one beside it does not.
  assert.equal(SP.addChosen(S, EMERY, 'outdoor', CAL.none, '24'), 1);
  assert.equal(GS.settingsFor(S, 1).fourthLine, 'feels');
  assert.equal(GS.settingsFor(S, 1).forecastHours, '24');
  assert.equal(SP.addChosen(S, EMERY, 'outdoor', CAL.none, '48'), 2);
  assert.equal(GS.settingsFor(S, 2).fourthLine, 'off');
  assert.equal(S.viewName2, 'Outdoor 2');
  // Each one reads as Outdoor at its own length: a third at 24 hours uses the first.
  assert.deepEqual(GSP.presetGraph(S, EMERY, 'outdoor', '24'), { k: 1, values: null });
  assert.deepEqual(GSP.presetGraph(S, EMERY, 'outdoor', '48'), { k: 2, values: null });
  // New graph from the template: its own length, the long span, without the line.
  const N = fresh(EMERY);
  assert.equal(GSP.createGraph(N, 'outdoor', EMERY), 1);
  assert.equal(GS.settingsFor(N, 1).fourthLine, 'off');
  assert.equal(GSP.createGraph(N, 'outdoor', EMERY, { forecastHours: '12' }), 2);
  assert.equal(GS.settingsFor(N, 2).fourthLine, 'feels', 'a length given: the values at it');
});

test('a forecast screen whose graph is one of yours already uses it', () => {
  const tpl = GSP.templateValues(fresh(EMERY), EMERY, 'clean');
  const item = JSON.stringify({ names: ['', 'Long', ''], styles: [null, tpl, null] });
  const S = withScreens(EMERY, [M.screensOf(fresh(EMERY), EMERY)[0]], { graphStyles: item });
  const c = SP.addChoices(S, EMERY).filter((x) => x.id === 'clean')[0];
  assert.deepEqual([c.graph.k, c.graph.values, c.why], [1, null, ''], 'Long reads as Clean');
  assert.equal(SP.addChosen(S, EMERY, 'clean'), 1);
  assert.equal(GS.count(S), 2, 'no graph made');
  assert.equal(SP.addChoices(S, EMERY).filter((x) => x.id === 'clean')[0].why, '', 'and can be added again');
});

test('no free graph slot, or a graph that would make too many metrics: it cannot be added, and says why', () => {
  // Graphs 2 to 6 taken by graphs no template reads as.
  const odd = { forecastHours: '12', secondaryLine: 'wind' };
  const full = withScreens(EMERY, [M.screensOf(fresh(EMERY), EMERY)[0]], {
    graphStyles: JSON.stringify({ names: [], styles: [null].concat(['uv', 'cloud', 'gust', 'dew_point', 'pressure']
      .map((m) => Object.assign({}, odd, { thirdLine: m }))) })
  });
  const byId = (S) => SP.addChoices(S, EMERY).reduce((o, c) => { o[c.id] = c.why; return o; }, {});
  const whyFull = byId(full);
  ['classic', 'clean', 'stripes'].forEach((id) => assert.equal(whyFull[id], SP.NO_GRAPH_ROOM, id));
  assert.equal(SP.NO_GRAPH_ROOM, 'It needs a new graph, and you have 6 already. Delete one on the Graphs tab.');
  assert.equal(whyFull.health, '', 'a screen with no forecast graph needs no graph');
  assert.equal(SP.addChosen(full, EMERY, 'stripes'), -1);
  // The first graph draws four series already: Stripes' cloud and rain-chance stripes make six.
  const busy = withScreens(EMERY, [M.screensOf(fresh(EMERY), EMERY)[0]], {
    secondaryLine: 'precip_prob', secondaryLineStyle: 'line', thirdLine: 'wind', fourthLine: 'uv', fifthLine: 'gust'
  });
  const why = byId(busy).stripes;
  assert.match(why, /^Also needs .*: that makes \d+ metrics on your screens. The watch can show 5\.$/);
  const kept = JSON.stringify(busy);
  assert.equal(SP.addChosen(busy, EMERY, 'stripes'), -1);
  assert.equal(JSON.stringify(busy), kept, 'no graph made');
});

test('a watch with one graph: the Forecast screen brings its rows and keeps your graph', () => {
  const S = fresh(BASALT, { secondaryLine: 'wind' });
  assert.equal(SP.addChosen(S, BASALT, 'forecast', CAL.full), 1);
  assert.deepEqual(M.screensOf(S, BASALT)[1], P.listOf('fc', CAL.full));
  assert.equal(S.secondaryLine, 'wind', 'the graph as it was');
  assert.equal(S.graphStyles, fresh(BASALT).graphStyles, 'no graph made');
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
 * Add a screen's cards: [id, calendar, name, the calendar a screen reader hears after it, the
 * legend's rows by name].
 * @param {string} body The overlay's body.
 * @returns {Array<Array>}
 */
function sheetCards(body) {
  const out = [];
  const re = /<button type="button" class="sa-card" data-se="pick" data-id="([^"]*)" data-cal="([^"]*)">[\s\S]*?<span class="sa-n">([^<]*)(?:<span class="sr-only">, ([^<]*)<\/span>)?<\/span><span class="sl-card">([\s\S]*?)<\/span><\/span><\/button>/g;
  let m;
  while ((m = re.exec(body))) {
    out.push([m[1], m[2], m[3], m[4] || '', [...m[5].matchAll(/<span class="sl-n">([^<]*)<\/span>/g)].map((x) => x[1]).join(', ')]);
  }
  return out;
}

/**
 * A segmented row of the picked screen: [label, value, on] per segment.
 * @param {string} body The overlay's body.
 * @param {string} act 'aspan'.
 * @returns {Array<Array>}
 */
function segments(body, act) {
  const out = [];
  const re = new RegExp('<button type="button" data-se="' + act + '" data-v="([^"]*)"( class="on")? aria-pressed="(true|false)">([^<]*)</button>', 'g');
  let m;
  while ((m = re.exec(body))) { out.push([m[4], m[1], Boolean(m[2])]); }
  return out;
}

/**
 * The picked screen's What it shows: its legend's rows as "Name: how", each graph's caption
 * before its rows as "# caption", then what the weather service leaves out as "! note".
 * @param {string} body The overlay's body.
 * @returns {?Array<string>} null without What it shows
 */
function shows(body) {
  const m = /<div class="sa-row"><div class="sa-lbl">What it shows<\/div>([\s\S]*?)<\/div>(?:<div class="sa-row"|<div class="sa-why"|<button)/.exec(body);
  if (!m) { return null; }
  return [...m[1].matchAll(/<div class="ui-cap sl-cap">([^<]*)<\/div>|<span class="sl-n">([^<]*)<\/span><span class="sl-h">([^<]*)<\/span>|<div class="sa-gap">([^<]*)<\/div>/g)]
    .map((x) => (x[1] !== undefined ? '# ' + x[1] : x[4] !== undefined ? '! ' + x[4] : x[2] + ': ' + x[3]));
}

test('+ Add screen opens Add a screen: a row of cards a heading, scrolled sideways; three a preset, one per calendar, each with its legend', () => {
  const page = bootGeneratedPage({ provider: 'dwd' }, 'emery');
  page.tapAction('addScreen');
  const ed = page.editor(), head = ed.querySelector('[data-se-head]'), bodyEl = ed.querySelector('[data-se-body]');
  // A dialog's header (ui.js header): ‹, the kicker over the title, no Done (nothing to be done).
  assert.ok(head.innerHTML.indexOf('<button type="button" class="dlg-x" data-se="close" aria-label="Back">&#8249;</button>')
    !== -1, '‹ closes it');
  assert.ok(head.innerHTML.indexOf('<span class="dlg-kick">Screens</span>') !== -1, 'where it opened from');
  assert.ok(head.innerHTML.indexOf('id="seTitle">Add a screen</span></span></div></div>') !== -1, 'titled, no pencil');
  let body = bodyEl.innerHTML;
  const cards = sheetCards(body);
  assert.equal(cards.length, 32);
  assert.deepEqual([...new Set(cards.map((c) => c[0] + ':' + c[2]))], ['classic:Classic', 'clean:Clean', 'stripes:Stripes',
    'outdoor:Outdoor', 'meteogram:Meteogram', 'wind:Wind', 'comfort:Comfort', 'clouds:Clouds', 'health:Health',
    'radar:Rain radar', 'healthfc:Health + forecast', 'radarfc:Radar + forecast']);
  // Each preset three times, on no calendar, the compact and the full one, which its picture shows
  // (a screen reader hears it after the name); beside its picture, the legend of what it shows.
  assert.deepEqual(cards.slice(9, 12), [
    ['outdoor', '', 'Outdoor', 'no calendar', 'Temperature, Rain chance, UV index, Rain'],
    ['outdoor', '2', 'Outdoor', 'compact calendar', 'Temperature, Rain chance, UV index, Rain'],
    ['outdoor', '3', 'Outdoor', 'full calendar', 'Temperature, Rain chance, UV index, Rain']]);
  assert.deepEqual(cards.slice(30), [['healthfc', '', 'Health + forecast', '', 'Health graph, Temperature, Rain chance, Rain'],
    ['radarfc', '', 'Radar + forecast', '', 'Rain radar, Temperature, Rain chance, Rain']],
  'two graphs: one card, no calendar; the upper graph in one row');
  assert.equal(body.replace(/<span class="sr-only">[^<]*<\/span>/g, '').indexOf('calendar'), -1,
    'no calendar line: the picture shows it');
  assert.equal((body.match(/<span class="sa-pic" aria-hidden="true"><svg/g) || []).length, 32, 'a picture each');
  // A row a heading, scrolled sideways: the forecast screens, then the others.
  assert.deepEqual([...body.matchAll(/<span class="ui-cap" id="saGrp-([a-z]+)">([^<]*)<\/span><div class="sa-strip" data-sa-strip="([a-z]+)">/g)]
    .map((m) => [m[1], m[2], m[3]]), [['fc', 'Forecast', 'fc'], ['more', 'Health and radar', 'more']]);
  assert.match(body, /data-sa-strip="fc">(?:(?!saGrp-more)[\s\S])*data-id="clouds" data-cal="3"/);
  assert.match(body, /data-sa-strip="more"><button type="button" class="sa-card" data-se="pick" data-id="health" data-cal="">/);
  assert.ok(body.indexOf('A forecast screen brings its own graph, or uses one of yours that looks the same.') !== -1);
  // A card: its screen big, on its card's calendar and its template's length, and what it shows.
  page.tapEditor({ se: 'pick', id: 'clean', cal: '3' });
  assert.equal(page.S.viewCount, '1', 'nothing added yet');
  assert.ok(head.innerHTML.indexOf('<button type="button" class="dlg-x" data-se="addback" aria-label="Back">') !== -1,
    '‹ goes back to the cards');
  assert.ok(head.innerHTML.indexOf('<span class="dlg-kick">Add a screen</span>') !== -1);
  assert.ok(head.innerHTML.indexOf('id="seTitle">Clean</span>') !== -1, 'titled by its name');
  body = bodyEl.innerHTML;
  assert.match(body, /<div class="sa-big" role="img" aria-label="Clean: [^"]*Calendar \(3 rows\)[^"]*"><svg/,
    'its picture says its calendar');
  assert.equal(body.indexOf('sa-cal'), -1, 'no calendar line under it');
  assert.deepEqual(shows(body), ['Temperature: thick line', 'Rain chance: shaded area', 'Rain: bars'],
    'the template\'s graph is the screen: no caption');
  assert.equal(body.indexOf('data-se="acal"'), -1, 'no calendar to pick: its card picked it');
  assert.deepEqual(segments(body, 'aspan'), [['12 h', '12', false], ['24 h', '24', false], ['66 h', '48', true]]);
  assert.ok(body.indexOf('<button type="button" class="sa-add" data-se="addnow">Add screen</button>') !== -1);
  // The length picked redraws it.
  page.tapEditor({ se: 'aspan', v: '24' });
  body = bodyEl.innerHTML;
  assert.deepEqual(segments(body, 'aspan').map((x) => x[2]), [false, true, false]);
  // Add screen: the screen goes in after the others, its editor next.
  page.tapEditor({ se: 'addnow' });
  assert.equal(page.S.viewName1, 'Clean');
  assert.equal(page.S.viewStyle1, '2');
  assert.equal(GS.settingsFor(GSP.normalize(page.S), 1).forecastHours, '24');
  assert.deepEqual(M.screensOf(page.S, EMERY)[1], [b('strip'), b('cal', { rows: '3' }), b('clock'), b('fcbar'),
    b('fc', { size: 'fill', style: '2' })], 'the full calendar');
  assert.ok(head.innerHTML.indexOf('id="seTitle">Clean</span><button type="button" class="ui-pen" data-se="rename" '
    + 'aria-label="Rename Clean">') !== -1, 'its editor, by its name, the pencil after it');
  assert.ok(head.innerHTML.indexOf('<button type="button" class="dlg-done" data-se="close">Done</button>') !== -1, 'Done');
  page.tapEditor({ se: 'close' });
  assert.ok(page.scroll.innerHTML.indexOf('<span class="ui-n">Clean</span>') !== -1, 'the card names it');
});

test('Outdoor\'s picked screen says what it shows at the length picked; ‹ and Escape go back to the cards', () => {
  const page = bootGeneratedPage({ provider: 'dwd' }, 'emery');
  page.tapAction('addScreen');
  const ed = page.editor(), bodyEl = ed.querySelector('[data-se-body]');
  page.tapEditor({ se: 'pick', id: 'outdoor', cal: '' });
  assert.deepEqual(shows(bodyEl.innerHTML), ['Temperature: thick line', 'Rain chance: shaded area', 'UV index: line',
    'Rain: bars from the top'], 'the long span: no feels-like line');
  page.tapEditor({ se: 'aspan', v: '12' });
  assert.deepEqual(shows(bodyEl.innerHTML).slice(2, 4), ['UV index: line', 'Feels like: line']);
  page.tapEditor({ se: 'addnow' });
  assert.deepEqual(M.screensOf(page.S, EMERY)[1].map((x) => x.k), ['strip', 'clock', 'fcbar', 'fc'], 'no calendar');
  assert.equal(GS.settingsFor(GSP.normalize(page.S), 1).fourthLine, 'feels', 'the graph it brings draws what it said');
  // Health: its calendar from its card, no length; ‹ and Escape go back to the cards.
  page.tapEditor({ se: 'close' });
  page.tapAction('addScreen');
  const bodyAgain = page.editor().querySelector('[data-se-body]');
  page.tapEditor({ se: 'pick', id: 'health', cal: '2' });
  assert.deepEqual(segments(bodyAgain.innerHTML, 'aspan'), [], 'no length');
  assert.deepEqual(shows(bodyAgain.innerHTML), ['# Health graph, last 24 hours', 'Steps: bars', 'Heart rate: line',
    'Sleep: band along the bottom']);
  page.tapEditor({ se: 'addback' });
  assert.equal(sheetCards(bodyAgain.innerHTML).length, 32, 'the cards again');
  page.tapEditor({ se: 'pick', id: 'radar', cal: '3' });
  page.docDispatch('keydown', { key: 'Escape', target: {}, preventDefault() {} });
  assert.ok(page.editor(), 'still open');
  assert.equal(sheetCards(bodyAgain.innerHTML).length, 32, 'Escape: the cards again');
  page.docDispatch('keydown', { key: 'Escape', target: {}, preventDefault() {} });
  assert.equal(page.editor(), null, 'Escape on the cards closes it');
});

test('the picked screen says what the weather service leaves out of its graph, under its legend', () => {
  const page = bootGeneratedPage({ provider: 'yandex' }, 'emery');
  page.tapAction('addScreen');
  page.tapEditor({ se: 'pick', id: 'meteogram', cal: '' });
  const rows = shows(page.editor().querySelector('[data-se-body]').innerHTML);
  assert.deepEqual(rows.slice(-2), ['Rain: bars', '! Yandex sends no clouds or air pressure.']);
  page.tapEditor({ se: 'addback' });
  page.tapEditor({ se: 'pick', id: 'wind', cal: '' });
  assert.ok(shows(page.editor().querySelector('[data-se-body]').innerHTML).every((r) => r.charAt(0) !== '!'),
    'Yandex sends the wind and gusts');
});

test('a screen that cannot be added: its reason, Add screen off; a basalt says its graph stays', () => {
  const busy = { provider: 'dwd', secondaryLine: 'precip_prob', secondaryLineStyle: 'line', thirdLine: 'wind',
    fourthLine: 'uv', fifthLine: 'gust' };
  const page = bootGeneratedPage(busy, 'emery');
  page.tapAction('addScreen');
  const bodyEl = page.editor().querySelector('[data-se-body]');
  page.tapEditor({ se: 'pick', id: 'stripes', cal: '2' });
  assert.match(bodyEl.innerHTML, /<div class="sa-why" role="status">Also needs [^<]*The watch can show 5\.<\/div>/);
  assert.ok(bodyEl.innerHTML.indexOf('<button type="button" class="sa-add" data-se="addnow" disabled>Add screen</button>') !== -1);
  page.tapEditor({ se: 'addnow', disabled: true });
  assert.equal(page.S.viewCount, '1', 'nothing added');
  const basalt = bootGeneratedPage({ provider: 'dwd' });
  basalt.tapAction('addScreen');
  const body = basalt.editor().querySelector('[data-se-body]').innerHTML;
  assert.deepEqual([...new Set(sheetCards(body).map((c) => c[0]))], ['forecast', 'health', 'radar', 'healthfc', 'radarfc']);
  assert.ok(body.indexOf('A screen brings its rows. Your graph and your status bars stay as they are.') !== -1);
  basalt.tapEditor({ se: 'pick', id: 'forecast', cal: '2' });
  assert.deepEqual(shows(basalt.editor().querySelector('[data-se-body]').innerHTML), ['# Your forecast graph',
    'Temperature: thick line', 'Rain chance: shaded area', 'Rain: bars']);
});

test('Add a screen draws its cards once while it is open, anew each time it opens: they follow your graph', () => {
  const page = bootGeneratedPage({ provider: 'dwd' });
  page.tapAction('addScreen');
  const body = () => page.editor().querySelector('[data-se-body]').innerHTML;
  assert.equal(sheetCards(body())[0][4], 'Temperature, Rain chance, Rain');
  page.tapEditor({ se: 'pick', id: 'forecast', cal: '3' });
  page.tapEditor({ se: 'addback' });
  assert.equal(sheetCards(body()).length, 11, 'back on the cards');
  page.tapEditor({ se: 'close' });
  assert.equal(page.editor(), null);
  page.S.secondaryLine = 'wind';
  page.tapAction('addScreen');
  assert.equal(sheetCards(body())[0][4], 'Temperature, Wind, Rain', 'your graph as it is now');
});

test('a screen of two graphs: no calendar, the health graph or the radar over your forecast', () => {
  const page = bootGeneratedPage({ provider: 'dwd', radarEnabled: false });
  page.tapAction('addScreen');
  const ed = page.editor(), bodyEl = ed.querySelector('[data-se-body]');
  page.tapEditor({ se: 'pick', id: 'radarfc', cal: '' });
  const body = bodyEl.innerHTML;
  assert.ok(ed.querySelector('[data-se-head]').innerHTML.indexOf('id="seTitle">Radar + forecast</span>') !== -1);
  assert.deepEqual(segments(body, 'aspan'), [], 'your graph, at its length');
  assert.deepEqual(shows(body), ['# Rain radar, next 2 hours', 'Rain: bars', 'Clouds: stripe', 'Sun: stripe', 'Lightning: bolt',
    '# Your forecast graph', 'Temperature: thick line', 'Rain chance: shaded area', 'Rain: bars'], 'each graph under its caption');
  page.tapEditor({ se: 'addnow' });
  assert.deepEqual(M.screensOf(page.S, BASALT)[1], P.screenOf(P.byId('radarfc'), ''), 'its rows');
  assert.equal(page.S.viewName1, 'Radar + forecast');
  assert.equal(page.S.radarEnabled, true, 'the radar on for it');
  assert.equal(page.S.radarMode, 'graph', 'the modes follow');
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
