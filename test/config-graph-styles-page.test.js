'use strict';
// test/config-graph-styles-page.test.js — graph styles on the settings page, where each is "a
// graph" (src/pkjs/settings/graph-styles-page.js, Pebble Time 2): the swap that puts the picked
// graph's values in the flat keys on Graphs › Forecast and the first graph's everywhere else, the
// settings as Save stores them, the Your graphs card (a picture card per graph, New graph from a
// template or as a copy, the Show on row, Rename, Delete with Undo), the screen editor's graph
// card and picker, and the four-series limit. The module first, then the REAL generated page
// (test/helpers/page-harness.js).
const test = require('node:test');
const assert = require('node:assert/strict');
require('../src/pkjs/config-ui/lib/schema-walk.js');
require('../src/pkjs/config-ui/lib/color.js');
require('../src/pkjs/config-ui/lib/show-when.js');
require('../src/pkjs/config-ui/lib/engine.js');
require('../src/pkjs/settings/blocks.js');   // registers forecast-hints.js' pickers
const GSP = require('../src/pkjs/settings/graph-styles-page.js');
const GS = require('../src/pkjs/graph-styles.js');
const platform = require('../src/pkjs/config-ui/lib/platform.js');
const { bootGeneratedPage } = require('./helpers/page-harness.js');

const PC = global.PConf;
const EMERY = platform.computeEnv({ platform: 'emery' });
const BASALT = platform.computeEnv({ platform: 'basalt' });

/**
 * Custom-layout settings: one screen per entry, each a forecast-graph screen on that style
 * ('1' | '2' | '3').
 * @param {string[]} views One entry per screen.
 * @param {Object} [over] More settings.
 * @returns {Object}
 */
function layout(views, over) {
  const S = { layoutPreset: 'custom', radarMode: 'off', healthMode: 'off', viewCount: String(views.length) };
  views.forEach((v, i) => {
    S['viewTop' + i] = i === 0 ? 'cal' : 'none';
    S['viewBody' + i] = 'forecast';
    S['viewStyle' + i] = v;
  });
  return Object.assign(S, over || {});
}

/**
 * The graphStyles item for styles 2 and 3.
 * @param {?Object} two Style 2's values, or null.
 * @param {?Object} [three] Style 3's values, or null.
 * @param {string[]} [names] The three names.
 * @returns {string}
 */
function stylesItem(two, three, names) {
  return JSON.stringify({ names: names || ['', 'Long', ''], styles: [null, two || null, three || null] });
}

// Two screens: the Default on the first style (24 h), Flick 1 on "Long" (the long span, cloud).
const TWO = layout(['1', '2'], {
  provider: 'dwd', forecastHours: '24', secondaryLine: 'precip_prob', thirdLine: 'off',
  graphStyles: stylesItem({ forecastHours: '48', thirdLine: 'cloud', thirdLineStyle: 'stripeTop' })
});

test('the swap: the picked style in the flat keys, the first style held; normalize hands back the stored settings', () => {
  const S = Object.assign({}, TWO);
  GSP.swapIn(S, 1);
  assert.equal(S.forecastHours, '48');
  assert.equal(S.thirdLine, 'cloud');
  assert.equal(S.secondaryLine, 'precip_prob', 'a key the style holds no value of reads as the first style\'s');
  assert.equal(GSP.editing(S), 1);
  const N = GSP.normalize(S);
  assert.notEqual(N, S, 'a copy');
  assert.equal(N.forecastHours, '24', 'the first style back in the flat keys');
  assert.equal(N.thirdLine, 'off');
  assert.equal(N.graphStyles, TWO.graphStyles, 'a style left alone keeps its stored string');
  assert.equal(N[GSP.SWAP], undefined);
  assert.equal(S.forecastHours, '48', 'S is not touched');
  // An edit while swapped: written into the item, every governed key.
  S.forecastHours = '12';
  const N2 = GSP.normalize(S);
  const two = GS.parse(N2).styles[1];
  assert.equal(two.forecastHours, '12');
  assert.equal(two.thirdLine, 'cloud');
  assert.deepEqual(Object.keys(two).sort(), GS.GOVERNED.filter((k) => k in S).sort(), 'the style holds every governed key');
  assert.equal(N2.forecastHours, '24');
  // settle: the same, in place.
  GSP.settle(S);
  assert.equal(S.forecastHours, '24');
  assert.equal(S[GSP.SWAP], undefined);
  assert.equal(GS.parse(S).styles[1].forecastHours, '12');
  assert.equal(GSP.normalize(S), S, 'off the swap: S itself');
});

test('onRender: Graphs › Forecast shows the picked style, anywhere else the first; Rename\'s field follows the pick', () => {
  const S = Object.assign({}, TWO, { graphStylePick: '2' });
  GSP.onRender({ S, env: EMERY, tab: 'graphs', pane: 'forecast' });
  assert.equal(S.forecastHours, '48');
  assert.equal(S.graphStyleName, 'Long');
  GSP.onRender({ S, env: EMERY, tab: 'graphs', pane: 'radar' });
  assert.equal(S.forecastHours, '24', 'another pane: the first style');
  GSP.onRender({ S, env: EMERY, tab: 'graphs', pane: 'forecast' });
  S.thirdLine = 'wind';
  GSP.onRender({ S, env: EMERY, tab: 'watchface', pane: null });
  assert.equal(S.thirdLine, 'off', 'another tab: the first style');
  assert.equal(GS.parse(S).styles[1].thirdLine, 'wind', 'the edit kept in the style');
  // A pick that names no style reads as the first and is put right.
  const T = Object.assign({}, TWO, { graphStylePick: '3' });
  GSP.onRender({ S: T, env: EMERY, tab: 'graphs', pane: 'forecast' });
  assert.equal(T.graphStylePick, '1');
  assert.equal(T.forecastHours, '24');
  // A watch without styles: nothing moves.
  const B = Object.assign({}, TWO, { graphStylePick: '2' });
  GSP.onRender({ S: B, env: BASALT, tab: 'graphs', pane: 'forecast' });
  assert.equal(B.forecastHours, '24');
  assert.equal(B[GSP.SWAP], undefined);
});

test('the pickers\' graphs: each named with its length, where it shows under it', () => {
  const opts = GSP.styleOptions(TWO, EMERY);
  assert.deepEqual(opts.map((o) => o[1]), ['1', '2']);
  assert.equal(opts[0][0], 'Graph 1 · 24 h');
  assert.match(opts[1][0], /^Long · \d+ h$/);
  assert.notEqual(opts[1][0], 'Long · 48 h', 'the long span by the hours it shows');
  assert.equal(opts[0][2].desc, 'On Default');
  assert.equal(opts[1][2].desc, 'On Flick 1');
  const three = layout(['1', '2', '2'], { graphStyles: TWO.graphStyles, forecastHours: '24' });
  assert.equal(GSP.styleOptions(three, EMERY)[1][2].desc, 'On Flick 1 and Flick 2');
  assert.equal(GSP.styleOptions(layout(['1'], { graphStyles: TWO.graphStyles }), EMERY)[1][2].desc, 'On no screen');
  assert.equal(GSP.styleOptions(layout(['1', '3'], { graphStyles: TWO.graphStyles }), EMERY)[0][2].desc,
    'On Default and Flick 1', 'a screen on a style that does not exist draws the first');
  assert.equal(GSP.pickOnOpen(TWO, EMERY), '1', 'the page opens on the Default screen\'s style');
  assert.equal(GSP.pickOnOpen(layout(['2', '1'], { graphStyles: TWO.graphStyles }), EMERY), '2');
  assert.equal(GSP.pickOnOpen(layout(['3'], { graphStyles: TWO.graphStyles }), EMERY), '1', 'a style that does not exist');
  // The cards' line: the length, then the screens.
  assert.equal(GSP.cardLine(TWO, EMERY, 0), '24 h · Default');
  assert.match(GSP.cardLine(three, EMERY, 1), /^\d+ h · Flick 1, Flick 2$/);
  assert.match(GSP.cardLine(layout(['1'], { graphStyles: TWO.graphStyles }), EMERY, 1), /^\d+ h · No screen$/);
  // The screen editor's picker: the graphs, then while a slot is free the templates, each a new
  // graph for the screen; with no free slot, the graphs alone.
  GSP.beginScreenPick(TWO, 1, '2');
  const scr = GSP.styleOptions(TWO, EMERY, { screen: true });
  assert.deepEqual(scr.map((o) => o[1]), ['1', '2', '__group', 'new:classic', 'new:weathergraph', 'new:stripes']);
  assert.equal(scr[2][0], 'New graph from a template');
  assert.equal(scr[2][2].groupHeader, true);
  assert.deepEqual(scr.slice(3).map((o) => o[0]), ['Classic', 'Weathergraph', 'Stripes']);
  assert.match(scr[4][2].desc, /^\d+ h · Clouds along the top, solid rain bars$/, 'its length, then what it draws');
  assert.equal(scr[3][2].desc, '24 h · Rain chance and rain bars');
  const full = Object.assign({}, TWO, { graphStyles: stylesItem({ forecastHours: '48' }, { forecastHours: '12' }) });
  assert.deepEqual(GSP.styleOptions(full, EMERY, { screen: true }).map((o) => o[1]), ['1', '2', '3']);
});

test('the four-series limit: a pick that would make a fifth series is greyed out on a shown style only', () => {
  // Style 1 draws rain chance and UV; style 2 rain chance, cloud and wind: four series between them.
  const S = layout(['1', '2'], {
    secondaryLine: 'precip_prob', secondaryLineStyle: 'line', thirdLine: 'uv', fourthLine: 'off', fifthLine: 'off',
    graphStyles: stylesItem({ secondaryLine: 'precip_prob', secondaryLineStyle: 'line', thirdLine: 'cloud',
      thirdLineStyle: 'line', fourthLine: 'wind', fifthLine: 'off' })
  });
  const metric = PC.optionsResolvers.get('forecastMetric');
  const off = (opts) => opts.filter((o) => o[2] && o[2].disabled).map((o) => o[1]);
  // The first style's fourth line: a metric another style draws is free, a new one is not.
  const fourth = metric(S, EMERY, { key: 'fourthLine', off: true, exclude: ['secondaryLine', 'thirdLine'] });
  assert.deepEqual(off(fourth), ['gust', 'pressure', 'feels', 'dew']);
  assert.equal(fourth.find((o) => o[1] === 'gust')[2].desc, GSP.LIMIT);
  // Its style: the rain chance as a stripe is a series of its own, while style 2 still draws its
  // line; UV as dots is the same series as UV as a line.
  const style = PC.optionsResolvers.get('lineStyleOptions');
  assert.deepEqual(off(style(S, EMERY, { metricKey: 'secondaryLine' })), ['stripeTop', 'stripeBottom']);
  assert.deepEqual(off(style(S, EMERY, { metricKey: 'thirdLine' })), [], 'UV cannot be a stripe');
  // The current pick is never greyed out, a style no screen shows is free, and so is every
  // watch without styles.
  assert.deepEqual(off(metric(S, EMERY, { key: 'thirdLine', off: true, exclude: ['secondaryLine'] })), []);
  const dormant = Object.assign({}, S, { viewStyle1: '1' });
  assert.deepEqual(off(metric(dormant, EMERY, { key: 'fourthLine', off: true, exclude: ['secondaryLine', 'thirdLine'] })), []);
  assert.deepEqual(off(metric(S, BASALT, { key: 'fourthLine', off: true, exclude: ['secondaryLine', 'thirdLine'] })), []);
  // While style 2 sits in the flat keys, its pickers count the first style's series: its empty
  // fifth line may take UV (style 1 draws it), nothing new. Its wind line may become anything:
  // wind's row is then free.
  const W = Object.assign({}, S);
  GSP.swapIn(W, 1);
  const lines = ['secondaryLine', 'thirdLine', 'fourthLine'];
  assert.deepEqual(off(metric(W, EMERY, { key: 'fifthLine', off: true, exclude: lines })), ['gust', 'pressure', 'feels', 'dew']);
  assert.deepEqual(off(metric(W, EMERY, { key: 'fourthLine', off: true, exclude: lines.slice(0, 2) })), []);
  // The screen editor's picker: a style that would bring a fifth series onto the screens.
  const busy = layout(['1', '1'], {
    secondaryLine: 'precip_prob', thirdLine: 'uv', fourthLine: 'wind', fifthLine: 'gust',
    graphStyles: stylesItem({ secondaryLine: 'cloud', thirdLine: 'off', fourthLine: 'off', fifthLine: 'off' })
  });
  GSP.beginScreenPick(busy, 1, '1');
  const opts = GSP.styleOptions(busy, EMERY, { screen: true });
  assert.equal(opts[1][2].disabled, true, 'cloud would be a fifth series');
  assert.equal(opts[1][2].desc, GSP.LIMIT);
  assert.equal(GSP.screenOverflows(busy, EMERY, 1, 0), false);
  // A template that would bring a fifth series: Weathergraph's cloud stripe.
  const tpl = (o) => o.filter((x) => x[1].indexOf(GSP.NEW) === 0);
  assert.deepEqual(tpl(opts).map((o) => [o[1], Boolean(o[2].disabled)]),
    [['new:classic', false], ['new:weathergraph', true], ['new:stripes', true]]);
  assert.equal(tpl(opts)[1][2].desc, GSP.LIMIT);
});

/**
 * The Your graphs cards in the page: [value, picked, name, line] per card.
 * @param {string} html The page's HTML.
 * @returns {Array<Array>}
 */
function cards(html) {
  const out = [], re = /<button type="button" class="gc( on)?" aria-pressed="(true|false)" data-action="pickGraph" data-action-arg="(\d)">(?:(?!<\/button>)[\s\S])*?<span class="gc-n">([^<]*)<\/span><span class="gc-d">([^<]*)<\/span><\/button>/g;
  let m;
  while ((m = re.exec(html))) { out.push([m[3], m[2] === 'true', m[4], m[5]]); }
  return out;
}

/**
 * The Show on chips in the page: [screen name, state] per chip, the state 'on' (ticked, a tap
 * takes it off), 'kept' (ticked, no tap: the first graph), 'off' (a tap puts the graph on) or
 * 'dim' (greyed out).
 * @param {string} html The page's HTML.
 * @returns {Array<Array<string>>}
 */
function chips(html) {
  const out = [], re = /<button type="button" class="gc-chip( on)?"([^>]*)>(?:<svg[\s\S]*?<\/svg>)?([^<]*)<\/button>/g;
  let m;
  while ((m = re.exec(html))) {
    const a = m[2];
    out.push([m[3], / disabled/.test(a) && !/aria-disabled/.test(a) ? 'dim' : /aria-disabled="true"/.test(a) ? 'kept'
      : m[1] ? 'on' : 'off']);
  }
  return out;
}

test('the page: Your graphs sits above the pinned preview on emery only, a picture card per graph', () => {
  const p = bootGeneratedPage(TWO, 'emery');
  p.clickTab('graphs');
  const html = p.scroll.innerHTML;
  assert.ok(html.indexOf('Your graphs') !== -1, 'the card\'s title');
  assert.ok(html.indexOf('data-action="pickGraph"') < html.indexOf('class="pin"'), 'above the pinned preview');
  assert.ok(html.indexOf('pane-seg') < html.indexOf('data-action="pickGraph"'), 'under the pane switcher');
  const c = cards(html);
  assert.equal(c.length, 2, 'one card per graph');
  assert.deepEqual(c[0], ['1', true, 'Graph 1', '24 h · Default'], 'the first graph, picked');
  assert.deepEqual(c[1].slice(0, 3), ['2', false, 'Long']);
  assert.match(c[1][3], /^\d+ h · Flick 1$/);
  // Each card draws its graph, its ids its own.
  assert.match(html, /<span class="gc-pic" aria-hidden="true"><svg class="wiz-graph-scr"/);
  assert.ok(html.indexOf('id="nh-gc0"') !== -1 && html.indexOf('id="nh-gc1"') !== -1, 'tagged ids');
  assert.ok(html.indexOf('class="gc add" data-select="graphStyleNewFrom"') !== -1, 'New graph while a slot is free');
  assert.ok(html.indexOf('Tap a graph to change it below.') !== -1);
  assert.ok(html.indexOf('data-edit-sheet="graphStyleRename"') !== -1, 'Rename');
  assert.equal(html.indexOf('data-action="deleteGraphStyle"'), -1, 'no Delete on the first graph');
  const b = bootGeneratedPage(TWO, 'basalt');
  b.clickTab('graphs');
  assert.equal(b.scroll.innerHTML.indexOf('pickGraph'), -1, 'basalt: one look, no card');
  // One graph: no Show on row, the hint says what New graph is for.
  const one = bootGeneratedPage(layout(['1', '1'], { provider: 'dwd' }), 'emery');
  one.clickTab('graphs');
  assert.equal(cards(one.scroll.innerHTML).length, 1);
  assert.equal(one.scroll.innerHTML.indexOf('gc-chip'), -1);
  assert.ok(one.scroll.innerHTML.indexOf('New graph gives a screen a graph of its own.') !== -1);
});

test('the page: picking a style edits it; Save stores it in graphStyles and the first style in the flat keys', async () => {
  const p = bootGeneratedPage(TWO, 'emery');
  p.clickTab('graphs');
  p.tapAction('pickGraph', 2);
  assert.equal(p.S.forecastHours, '48', 'Long\'s length in the Forecast length row');
  assert.deepEqual(cards(p.scroll.innerHTML).map((c) => c[1]), [false, true], 'the ring on Long');
  // The page shows Revert only once something changed (the harness's classList is a stub).
  const revert = p.window.document.getElementById('revert');
  assert.equal(revert.hidden, true, 'a pick alone is no change');
  assert.ok(p.scroll.innerHTML.indexOf('data-action="deleteGraphStyle"') !== -1, 'Delete on another style');
  // An edit on Long: its length.
  const t = { getAttribute: (n) => (n === 'data-k' ? 'forecastHours' : (n === 'data-v' ? '12' : null)),
    closest: (sel) => (sel === '[data-v]' ? t : null) };
  p.scroll.dispatch('click', { target: t });
  assert.equal(p.S.forecastHours, '12');
  assert.equal(revert.hidden, false, 'an edit is');
  p.clickPane('graphs', 'radar');
  assert.equal(p.S.forecastHours, '24', 'off the pane the flat keys hold the first style');
  p.clickPane('graphs', 'forecast');
  assert.equal(p.S.forecastHours, '12', 'and Long comes back with its edit');
  const blob = await p.save();
  assert.equal(blob.forecastHours, '24', 'the first style stored in the flat keys');
  const two = GS.parse(blob).styles[1];
  assert.equal(two.forecastHours, '12', 'Long\'s edit in graphStyles');
  assert.equal(two.thirdLine, 'cloud');
  assert.equal(blob.graphStylePick, undefined, 'the pick is the page\'s own');
});

test('the page: Revert puts every style back, the pick too', () => {
  const p = bootGeneratedPage(TWO, 'emery');
  p.clickTab('graphs');
  p.tapAction('pickGraph', 2);
  const t = { getAttribute: (n) => (n === 'data-k' ? 'forecastHours' : (n === 'data-v' ? '12' : null)),
    closest: (sel) => (sel === '[data-v]' ? t : null) };
  p.scroll.dispatch('click', { target: t });
  p.window.document.getElementById('revert').dispatch('click', { target: {} });
  const act = { getAttribute: (n) => (n === 'data-confirm' ? 'action' : null) };
  p.modal.dispatch('click', { target: { closest: (sel) => (sel === '[data-confirm]' ? act : null) } });
  assert.equal(p.S.graphStylePick, '1');
  assert.equal(p.S.forecastHours, '24');
  assert.equal(p.S[GSP.SWAP], undefined);
  assert.equal(p.S.graphStyles, TWO.graphStyles, 'Long as it was');
});

test('the page: New graph from a template, picked at once and called Graph <n>; a fourth is not offered', async () => {
  const p = bootGeneratedPage(TWO, 'emery');
  p.clickTab('graphs');
  p.openSelect('graphStyleNewFrom');
  const sheet = p.modal.innerHTML;
  assert.match(sheet, /New graph/);
  assert.ok(sheet.indexOf('<div class="ssel-lead">Start from a template. Templates never change: you get your own copy.</div>') !== -1);
  assert.equal(sheet.indexOf('ssel-chk'), -1, 'nothing ticked');
  assert.match(sheet, />Classic<[\s\S]*>Weathergraph<[\s\S]*>Stripes<[\s\S]*Or copy one of your graphs[\s\S]*>Copy of Graph 1<[\s\S]*>Copy of Long</,
    'the templates, then a copy of each graph');
  assert.equal((sheet.match(/class="ssel-pic"/g) || []).length, 5, 'a picture for each template and copy');
  assert.ok(sheet.indexOf('id="nh-gs-weathergraph"') !== -1 && sheet.indexOf('id="nh-gs-copy2"') !== -1, 'tagged ids');
  p.pickOption('graphStyleNewFrom', 'weathergraph');
  assert.equal(p.S.graphStylePick, '3', 'the new graph takes the free slot and is picked');
  assert.equal(GS.name(GSP.normalize(p.S), 2), 'Graph 3', 'never the template\'s name');
  assert.equal(GS.parse(GSP.normalize(p.S)).names[2], '', 'stored as the default name');
  assert.equal(p.S.forecastHours, '48', 'the template\'s length, in the flat keys while it shows');
  assert.deepEqual([p.S.thirdLine, p.S.thirdLineStyle, p.S.rainBarColor, p.S.forecastAxisNumbers, p.S.dayNightShading],
    ['cloud', 'stripeTop', 'white', 'graph', true], 'the template\'s lines, bars, high and low and night shading');
  assert.equal(p.S.graphStyleNewFrom, '', 'the picker is cleared');
  assert.equal(p.scroll.innerHTML.indexOf('data-select="graphStyleNewFrom"'), -1, 'three graphs: no New graph');
  assert.match(cards(p.scroll.innerHTML)[2][3], /^\d+ h · No screen$/, 'a new graph is on no screen yet');
  const blob = await p.save();
  assert.equal(GS.count(blob), 3);
  assert.equal(blob.thirdLine, 'off', 'the first graph is untouched');
  assert.equal(GS.settingsFor(blob, 2).thirdLine, 'cloud', 'the new graph holds the template');
});

test('the page: New graph as a copy of a graph; a renamed graph keeps its default name from a new one', () => {
  const p = bootGeneratedPage(TWO, 'emery');
  p.clickTab('graphs');
  p.openSelect('graphStyleNewFrom');
  p.pickOption('graphStyleNewFrom', 'copy2');
  const N = GSP.normalize(p.S);
  assert.equal(GS.name(N, 2), 'Graph 3');
  assert.deepEqual(GS.valuesOf(N, 2), GS.valuesOf(N, 1), 'Long\'s values');
  // A graph renamed to the name the new one would have: the new one takes the first free number.
  const S = layout(['1'], { graphStyles: stylesItem({ forecastHours: '48' }, null, ['', 'Graph 3', '']) });
  assert.equal(GSP.createGraph(S, 'classic', EMERY), 2);
  assert.equal(GS.name(S, 2), 'Graph 2');
  assert.equal(GSP.createGraph(S, 'classic', EMERY), -1, 'no free slot');
  assert.equal(GSP.createGraph(layout(['1']), 'nothing', EMERY), -1, 'no such template');
  assert.equal(GSP.createGraph(layout(['1']), 'copy3', EMERY), -1, 'no such graph');
});

test('the page: Rename names the picked style; × keeps the old name', () => {
  const p = bootGeneratedPage(TWO, 'emery');
  p.clickTab('graphs');
  p.tapAction('pickGraph', 2);
  p.openEditSheet('graphStyleRename');
  assert.match(p.modal.innerHTML, /data-k="graphStyleName" value="Long"/, 'the field holds the name');
  const type = (value) => {
    const inp = { value, getAttribute: (n) => (n === 'data-k' ? 'graphStyleName' : null),
      closest: (sel) => (sel === 'input[type=text]' ? inp : null) };
    ['focusin', 'input', 'change'].forEach((ev) => p.modal.dispatch(ev, { target: inp }));
  };
  type('  Weekend ');
  p.doneDialog();
  assert.equal(GS.name(p.S, 1), 'Weekend', 'trimmed');
  assert.equal(cards(p.scroll.innerHTML)[1][2], 'Weekend', 'the card shows the new name');
  // The default name back: stored as none.
  p.openEditSheet('graphStyleRename');
  type('Graph 2');
  p.doneDialog();
  assert.equal(GS.parse(GSP.normalize(p.S)).names[1], '');
  p.openEditSheet('graphStyleRename');
  type('Weekend');
  p.doneDialog();
  p.openEditSheet('graphStyleRename');
  type('Other');
  p.cancelDialog();
  assert.equal(GS.name(p.S, 1), 'Weekend', '× puts the name back');
});

test('the page: Delete moves its screens to the first style; Undo brings both back', () => {
  const p = bootGeneratedPage(TWO, 'emery');
  p.clickTab('graphs');
  p.tapAction('pickGraph', 2);
  p.tapAction('deleteGraphStyle');
  assert.equal(GS.count(p.S), 1);
  assert.equal(p.S.viewStyle1, '1', 'Flick 1 draws the first style');
  assert.equal(p.S.graphStylePick, '1');
  assert.equal(p.S.forecastHours, '24');
  assert.match(p.scroll.innerHTML, /Long deleted\./);
  p.tapAction('undoDeleteGraphStyle');
  assert.equal(GS.count(p.S), 2);
  assert.equal(p.S.viewStyle1, '2');
  assert.equal(p.S.graphStylePick, '2');
  assert.equal(p.S.forecastHours, '48', 'Long picked again, in the flat keys');
  assert.equal(p.scroll.innerHTML.indexOf('deleted.'), -1, 'the Undo is gone');
});

test('the screen editor: the forecast row shows its graph, folded or not; its picker picks one or makes one', () => {
  const M = require('../src/pkjs/screens.js');
  const p = bootGeneratedPage(TWO, 'emery');
  p.tapAction('openScreen', 1);
  const j = M.idxOf(M.screensOf(p.S, EMERY)[1], 'fc');
  const body = () => p.editor().querySelector('[data-se-body]').innerHTML;
  // Folded: the graph card is in view, first under the row.
  assert.match(body(), /Graph<\/span><button type="button" class="se-graph" data-se="style" data-j="\d+" aria-haspopup="dialog">/);
  assert.match(body(), /<span class="se-gpic" aria-hidden="true"><svg class="wiz-graph-scr"/, 'its picture');
  assert.match(body(), /<span class="se-gname">Long · \d+ h<\/span>/, 'the screen\'s graph, named with its length');
  assert.match(body(), /Tap to pick another graph or start a new one/);
  assert.match(body(), /Edit Long on the Graphs tab ›/);
  // Open: still first, above the size.
  p.tapEditor({ se: 'expand', j });
  assert.ok(body().indexOf('class="se-graph"') < body().indexOf('>Size<'), 'the graph before the size');
  // The picker: the page's select sheet over the editor, each graph and template drawn.
  p.tapEditor({ se: 'style', j });
  const sheet = p.modal.innerHTML;
  assert.match(sheet, /Graph on this screen/);
  assert.match(sheet, /Graph 1 · 24 h/);
  assert.match(sheet, /On Default/);
  assert.match(sheet, /New graph from a template[\s\S]*>Classic<[\s\S]*>Weathergraph<[\s\S]*>Stripes</);
  assert.equal((sheet.match(/class="ssel-pic"/g) || []).length, 5, 'two graphs and three templates');
  p.pickOption('screenGraphStyle', '1');
  assert.equal(p.S.viewStyle1, '1', 'Flick 1 draws the first graph');
  assert.match(body(), /<span class="se-gname">Graph 1 · 24 h<\/span>/, 'the editor repaints');
  // A template: a new graph, put on this screen and picked on the Graphs tab.
  p.tapEditor({ se: 'style', j });
  p.pickOption('screenGraphStyle', 'new:stripes');
  assert.equal(GS.count(p.S), 3);
  assert.equal(p.S.viewStyle1, '3', 'Flick 1 draws the new graph');
  assert.equal(p.S.graphStylePick, '3');
  assert.equal(GS.settingsFor(p.S, 2).secondaryLineStyle, 'stripeTop', 'Stripes\' lines');
  assert.match(body(), /<span class="se-gname">Graph 3 · 24 h<\/span>/);
  assert.match(body(), /Tap to pick another graph</, 'no free slot: no new one offered');
  p.tapEditor({ se: 'style', j });
  assert.equal(p.modal.innerHTML.indexOf('New graph from a template'), -1);
  p.pickOption('screenGraphStyle', '2');
  assert.equal(p.S.viewStyle1, '2');
  // The link: the Graphs tab, on that graph.
  p.tapEditor({ se: 'editstyle', j });
  assert.equal(p.editor(), null, 'the editor closes');
  assert.equal(p.S.graphStylePick, '2');
  assert.equal(p.S.forecastHours, '48', 'Graphs › Forecast shows Long');
  assert.deepEqual(cards(p.scroll.innerHTML).map((c) => c[1]), [false, true, false], 'on the Graphs tab, Long ringed');
  // One graph: the card says what a tap is for.
  const one = bootGeneratedPage(layout(['1', '1'], { provider: 'dwd' }), 'emery');
  one.tapAction('openScreen', 0);
  assert.match(one.editor().querySelector('[data-se-body]').innerHTML, /Tap to give this screen a graph of its own/);
  // basalt: no graph card.
  const b = bootGeneratedPage(TWO, 'basalt');
  b.tapAction('openScreen', 0);
  b.tapEditor({ se: 'expand', j: M.idxOf(M.screensOf(b.S, BASALT)[0], 'fc') });
  assert.equal(b.editor().querySelector('[data-se-body]').innerHTML.indexOf('data-se="style"'), -1);
});

test('the page: Show on puts the picked graph on a screen or takes it off', async () => {
  // Default and Flick 1 draw graph 1, Flick 2 has no forecast graph; Long is on no screen.
  const S = layout(['1', '1', '1'], { provider: 'dwd', forecastHours: '24', viewBody2: 'none', viewTop2: 'cal',
    graphStyles: stylesItem({ forecastHours: '48', thirdLine: 'cloud', thirdLineStyle: 'stripeTop' }) });
  const p = bootGeneratedPage(S, 'emery');
  p.clickTab('graphs');
  // Graph 1: its ticks stay (a screen draws it unless it has another graph).
  assert.deepEqual(chips(p.scroll.innerHTML), [['Default', 'kept'], ['Flick 1', 'kept'], ['Flick 2', 'dim']]);
  assert.ok(p.scroll.innerHTML.indexOf('Flick 2 has no forecast graph. A screen shows Graph 1 unless you give it another graph.') !== -1);
  p.tapAction('pickGraph', 2);
  assert.deepEqual(chips(p.scroll.innerHTML), [['Default', 'off'], ['Flick 1', 'off'], ['Flick 2', 'dim']]);
  p.tapAction('graphOnScreen', 1);
  assert.equal(p.S.viewStyle1, '2', 'Flick 1 draws Long');
  assert.equal(p.S.forecastHours, '48', 'Long is still the graph on show');
  assert.deepEqual(chips(p.scroll.innerHTML), [['Default', 'off'], ['Flick 1', 'on'], ['Flick 2', 'dim']]);
  assert.match(cards(p.scroll.innerHTML)[1][3], /^\d+ h · Flick 1$/);
  p.tapAction('graphOnScreen', 2);
  assert.equal(p.S.viewStyle2, '1', 'a screen without a forecast graph is left alone');
  p.tapAction('graphOnScreen', 1);
  assert.equal(p.S.viewStyle1, '1', 'off again: Flick 1 draws the first graph');
  p.tapAction('graphOnScreen', 0);
  p.tapAction('pickGraph', 1);
  assert.deepEqual(chips(p.scroll.innerHTML), [['Default', 'off'], ['Flick 1', 'kept'], ['Flick 2', 'dim']]);
  p.tapAction('graphOnScreen', 1);
  assert.equal(p.S.viewStyle1, '1', 'the first graph\'s own tick does nothing');
  const blob = await p.save();
  assert.equal(blob.viewStyle0, '2');
  assert.equal(blob.viewStyle1, '1');
  assert.equal(blob.forecastHours, '24', 'the first graph back in the flat keys');
  // The limit: a screen that would make the screens draw a fifth series is greyed out.
  const busy = layout(['1', '1'], { provider: 'dwd',
    secondaryLine: 'precip_prob', thirdLine: 'uv', fourthLine: 'wind', fifthLine: 'gust',
    graphStyles: stylesItem({ secondaryLine: 'cloud', thirdLine: 'off', fourthLine: 'off', fifthLine: 'off' }) });
  const q = bootGeneratedPage(busy, 'emery');
  q.clickTab('graphs');
  q.tapAction('pickGraph', 2);
  // Graph 1 draws four series on the other screen, so Long's cloud would be a fifth on either.
  assert.deepEqual(chips(q.scroll.innerHTML), [['Default', 'dim'], ['Flick 1', 'dim']]);
  assert.ok(q.scroll.innerHTML.indexOf(GSP.LIMIT) !== -1, 'the limit says why');
  q.tapAction('graphOnScreen', 0);
  assert.equal(q.S.viewStyle0, '1', 'a greyed-out chip does nothing');
});

test('a screen picture draws its forecast graph with the screen\'s style', () => {
  const PW = require('../src/pkjs/settings/preview-watch.js');
  const VC = require('../src/pkjs/view-cycle.js');
  const S = Object.assign({}, TWO, { graphStyles: stylesItem({ forecastHours: '12', barSource: 'off' }) });
  const cycle = VC.resolveViewCycle(S, EMERY);
  const svg = (spec, st) => PW.screenSvg(spec, 0, st, EMERY, {}, 1, new Date(2026, 10, 8, 12, 0), 'x').svg;
  // Flick 1 draws style 2: the same picture as the Default screen's view drawn from style 2's settings.
  assert.equal(cycle[1].graphStyle, 1);
  const two = GS.settingsFor(S, 1);
  const plain = Object.assign({}, cycle[1]);
  delete plain.graphStyle;
  assert.equal(svg(cycle[1], S), svg(plain, two), 'the style\'s settings');
  assert.notEqual(svg(cycle[1], S), svg(plain, S), 'not the first style\'s');
  // basalt draws one look on every screen.
  const B = VC.resolveViewCycle(S, BASALT);
  assert.equal(PW.screenSvg(B[1], 0, S, BASALT, {}, 0, new Date(2026, 10, 8, 12, 0), 'x').svg,
    PW.screenSvg(Object.assign({}, B[1], { graphStyle: undefined }), 0, S, BASALT, {}, 0, new Date(2026, 10, 8, 12, 0), 'x').svg);
});

test('a shared row says every graph shares it, while more than one graph exists', () => {
  const p = bootGeneratedPage(TWO, 'emery');
  p.clickTab('graphs');
  p.openAllMore();
  const tail = 'Every graph shares this.';
  assert.ok(p.scroll.innerHTML.indexOf('Draw the graph axis labels in bigger type. ' + tail) !== -1, 'Larger graph fonts');
  assert.equal(GSP.sharedHint(layout(['1']), EMERY), '', 'one style: no tail');
  assert.equal(GSP.sharedHint(TWO, BASALT), '', 'a watch without styles: none');
  const one = bootGeneratedPage(layout(['1'], { provider: 'dwd' }), 'emery');
  one.clickTab('graphs');
  one.openAllMore();
  assert.equal(one.scroll.innerHTML.indexOf(tail), -1);
});

test('the card\'s hint: what a tap on a card does, or with one graph what New graph is for', () => {
  assert.equal(GSP.cardHint(TWO), 'Tap a graph to change it below.');
  assert.equal(GSP.cardHint(layout(['1', '1'])), 'New graph gives a screen a graph of its own.');
});
