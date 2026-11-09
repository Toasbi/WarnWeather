'use strict';
// test/config-graph-styles-page.test.js — graph styles on the settings page, where each is "a
// graph" (src/pkjs/settings/graph-styles-page.js, Pebble Time 2): the swap that puts the picked
// graph's values in the flat keys on Graphs › Forecast and the first graph's everywhere else, the
// settings as Save stores them, the Your graphs card (a plain row per graph, renamed in place with
// OK; New graph from a template or as a copy; the Show on row; Delete with Undo), the screen
// editor's Graph dropdown and its sheet (your graphs, and a copy of the screen's), and the
// five-series limit. The module first, then the REAL generated page (test/helpers/page-harness.js).
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
const { editorRows, editorRow } = require('./helpers/page-rows.js');

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

test('onRender: Graphs › Forecast shows the picked style, anywhere else the first', () => {
  const S = Object.assign({}, TWO, { graphStylePick: '2' });
  GSP.onRender({ S, env: EMERY, tab: 'graphs', pane: 'forecast' });
  assert.equal(S.forecastHours, '48');
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
  // The screen editor's picker (the owner's, 2026-11-09): your graphs alone, the screen's own
  // saying where else it shows; while a slot is free New graph, a copy of the screen's graph for
  // it. Templates stay on the Graphs tab.
  GSP.beginScreenPick(TWO, 1, '2');
  const scr = GSP.styleOptions(TWO, EMERY, { screen: true });
  assert.deepEqual(scr.map((o) => o[1]), ['1', '2', 'new:copy2']);
  assert.equal(scr[0][2].desc, 'On Default');
  assert.equal(scr[1][2].desc, 'Only on this screen', 'the screen\'s own graph');
  assert.deepEqual(scr[2], ['New graph', 'new:copy2', { add: true, desc: 'A copy of Long, for this screen' }]);
  GSP.beginScreenPick(three, 1, '2');
  assert.equal(GSP.styleOptions(three, EMERY, { screen: true })[1][2].desc, 'Also on Flick 2');
  const full = Object.assign({}, TWO, { graphStyles: stylesItem({ forecastHours: '48' }, { forecastHours: '12' }) });
  GSP.beginScreenPick(full, 1, '2');
  assert.deepEqual(GSP.styleOptions(full, EMERY, { screen: true }).map((o) => o[1]), ['1', '2', '3'], 'no free slot');
});

test('the five-series limit: a pick that would make a sixth series is greyed out on a shown style only', () => {
  // Style 1 draws rain chance, UV and gusts; style 2 rain chance, cloud and wind: five series
  // between them, the most the watch takes (four lines' rows and the spare).
  const S = layout(['1', '2'], {
    secondaryLine: 'precip_prob', secondaryLineStyle: 'line', thirdLine: 'uv', fourthLine: 'gust', fifthLine: 'off',
    graphStyles: stylesItem({ secondaryLine: 'precip_prob', secondaryLineStyle: 'line', thirdLine: 'cloud',
      thirdLineStyle: 'line', fourthLine: 'wind', fifthLine: 'off' })
  });
  const metric = PC.optionsResolvers.get('forecastMetric');
  const off = (opts) => opts.filter((o) => o[2] && o[2].disabled).map((o) => o[1]);
  // The first style's fifth line: a metric another style draws is free, a new one is not.
  const lines = ['secondaryLine', 'thirdLine', 'fourthLine'];
  const fifth = metric(S, EMERY, { key: 'fifthLine', off: true, exclude: lines });
  assert.deepEqual(off(fifth), ['pressure', 'feels', 'dew']);
  assert.equal(fifth.find((o) => o[1] === 'pressure')[2].desc, GSP.LIMIT);
  assert.equal(GSP.LIMIT, 'That makes 6 lines and stripes on your screens. The watch can show 5.');
  // Changing a line swaps one series for another, so the first style's gust line may become
  // anything.
  assert.deepEqual(off(metric(S, EMERY, { key: 'fourthLine', off: true, exclude: lines.slice(0, 2) })), []);
  // Its style: the rain chance as a stripe is a series of its own, while style 2 still draws its
  // line; UV as dots is the same series as UV as a line.
  const style = PC.optionsResolvers.get('lineStyleOptions');
  assert.deepEqual(off(style(S, EMERY, { metricKey: 'secondaryLine' })), ['stripeTop', 'stripeBottom']);
  assert.deepEqual(off(style(S, EMERY, { metricKey: 'thirdLine' })), [], 'UV cannot be a stripe');
  // The current pick is never greyed out, a style no screen shows is free, and so is every
  // watch without styles.
  assert.deepEqual(off(metric(S, EMERY, { key: 'thirdLine', off: true, exclude: ['secondaryLine'] })), []);
  const dormant = Object.assign({}, S, { viewStyle1: '1' });
  assert.deepEqual(off(metric(dormant, EMERY, { key: 'fifthLine', off: true, exclude: lines })), []);
  assert.deepEqual(off(metric(S, BASALT, { key: 'fifthLine', off: true, exclude: lines })), []);
  // While style 2 sits in the flat keys, its pickers count the first style's series: its empty
  // fifth line may take UV or gusts (style 1 draws them), nothing new. Its wind line may become
  // anything: wind's row is then free.
  const W = Object.assign({}, S);
  GSP.swapIn(W, 1);
  assert.deepEqual(off(metric(W, EMERY, { key: 'fifthLine', off: true, exclude: lines })), ['pressure', 'feels', 'dew']);
  assert.deepEqual(off(metric(W, EMERY, { key: 'fourthLine', off: true, exclude: lines.slice(0, 2) })), []);
  // The screen editor's picker: a style whose fifth series fits beside a graph of four, one
  // whose sixth does not.
  const fits = layout(['1', '1'], {
    secondaryLine: 'precip_prob', thirdLine: 'uv', fourthLine: 'wind', fifthLine: 'gust',
    graphStyles: stylesItem({ secondaryLine: 'cloud', thirdLine: 'off', fourthLine: 'off', fifthLine: 'off' })
  });
  assert.equal(GSP.screenOverflows(fits, EMERY, 1, 1), false, 'cloud: the fifth series, on the spare row');
  const busy = Object.assign({}, fits, {
    graphStyles: stylesItem({ secondaryLine: 'cloud', thirdLine: 'pressure', fourthLine: 'off', fifthLine: 'off' }) });
  GSP.beginScreenPick(busy, 1, '1');
  const opts = GSP.styleOptions(busy, EMERY, { screen: true });
  assert.equal(opts[1][2].disabled, true, 'cloud and pressure would be a sixth series');
  assert.equal(opts[1][2].desc, 'Also needs Cloud cover % and Air pressure (hPa): that makes 6 lines and stripes on your'
    + ' screens. The watch can show 5.', 'what it adds, and the count');
  assert.equal(GSP.screenOverflows(busy, EMERY, 1, 0), false);
  // New graph, a copy of the screen's own graph, never adds a series: never greyed out.
  assert.deepEqual(opts[2].slice(0, 2), ['New graph', 'new:copy1']);
  assert.equal(opts[2][2].disabled, undefined);
  // A line and a stripe of one metric are two series.
  const stripes = Object.assign({}, fits, { graphStyles: stylesItem({ secondaryLine: 'cloud',
    secondaryLineStyle: 'stripeTop', thirdLine: 'precip_prob', thirdLineStyle: 'stripeTop', fourthLine: 'off', fifthLine: 'off' }) });
  GSP.beginScreenPick(stripes, 1, '1');
  assert.equal(GSP.styleOptions(stripes, EMERY, { screen: true })[1][2].desc, 'Also needs Cloud cover % (stripe) and'
    + ' Precipitation % (stripe): that makes 6 lines and stripes on your screens. The watch can show 5.');
});

/**
 * The Your graphs rows in the page: [value, picked, name, line] per row.
 * @param {string} html The page's HTML.
 * @returns {Array<Array>}
 */
function rows(html) {
  const out = [], re = /<div class="ui-row gl-row( on)?" role="listitem"><button type="button" class="gl-pick" aria-pressed="(true|false)" data-action="pickGraph" data-action-arg="(\d)"><span class="gl-txt"><span class="ui-n">([^<]*)<\/span><span class="ui-d">([^<]*)<\/span>/g;
  let m;
  while ((m = re.exec(html))) {
    assert.equal(Boolean(m[1]), m[2] === 'true', 'a picked row is tinted');
    out.push([m[3], m[2] === 'true', m[4], m[5]]);
  }
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
  const out = [], re = /<button type="button" class="ui-chip( on)?"([^>]*)>(?:<svg[\s\S]*?<\/svg>)?([^<]*)<\/button>/g;
  let m;
  while ((m = re.exec(html))) {
    const a = m[2];
    out.push([m[3], / disabled/.test(a) && !/aria-disabled/.test(a) ? 'dim' : /aria-disabled="true"/.test(a) ? 'kept'
      : m[1] ? 'on' : 'off']);
  }
  return out;
}

test('the page: Your graphs sits above the pinned preview on emery only, a plain row per graph', () => {
  const p = bootGeneratedPage(TWO, 'emery');
  p.clickTab('graphs');
  const html = p.scroll.innerHTML;
  assert.ok(html.indexOf('Your graphs') !== -1, 'the card\'s title');
  assert.ok(html.indexOf('data-action="pickGraph"') < html.indexOf('class="pin"'), 'above the pinned preview');
  assert.ok(html.indexOf('pane-seg') < html.indexOf('data-action="pickGraph"'), 'under the pane switcher');
  assert.ok(html.indexOf('<div class="gl-lead">Tap a graph to change it below.</div>') !== -1, 'what a tap does, first');
  const r = rows(html);
  assert.equal(r.length, 2, 'one row per graph');
  assert.deepEqual(r[0], ['1', true, 'Graph 1', '24 h · Default'], 'the first graph, picked');
  assert.deepEqual(r[1].slice(0, 3), ['2', false, 'Long']);
  assert.match(r[1][3], /^\d+ h · Flick 1$/);
  // No pictures: the preview below draws the picked graph (the owner's, 2026-11-09).
  assert.equal(html.indexOf('id="nh-gc0"'), -1, 'no picture per graph');
  assert.ok(html.indexOf('data-action-arg="1"><span class="gl-txt"><span class="ui-n">Graph 1</span><span class="ui-d">24 h · '
    + 'Default</span></span><svg class="ui-ic"') !== -1, 'the picked row ticked');
  assert.ok(html.indexOf('<button type="button" class="ui-pen" data-action="renameGraph" aria-label="Rename Graph 1">') !== -1,
    'its pencil');
  assert.equal((html.match(/data-action="renameGraph"/g) || []).length, 1, 'on the picked row alone');
  assert.ok(html.indexOf('<button type="button" class="ui-row ui-new" data-select="graphStyleNewFrom">') !== -1,
    'New graph while a slot is free');
  assert.ok(html.indexOf('<span class="ui-n">New graph</span><span class="ui-d">2 of 3 graphs</span>') !== -1, 'its count');
  assert.equal(html.indexOf('data-action="deleteGraphStyle"'), -1, 'no Delete on the first graph');
  const b = bootGeneratedPage(TWO, 'basalt');
  b.clickTab('graphs');
  assert.equal(b.scroll.innerHTML.indexOf('pickGraph'), -1, 'basalt: one look, no card');
  // One graph: no Show on row, the lead says what New graph is for.
  const one = bootGeneratedPage(layout(['1', '1'], { provider: 'dwd' }), 'emery');
  one.clickTab('graphs');
  assert.equal(rows(one.scroll.innerHTML).length, 1);
  assert.equal(one.scroll.innerHTML.indexOf('ui-chip'), -1);
  assert.ok(one.scroll.innerHTML.indexOf('New graph gives a screen a graph of its own.') !== -1);
  // Three graphs: why there is no New graph.
  const full = bootGeneratedPage(Object.assign({}, TWO, { graphStyles: stylesItem({ forecastHours: '48' }, { forecastHours: '12' }) }),
    'emery');
  full.clickTab('graphs');
  assert.equal(full.scroll.innerHTML.indexOf('ui-new'), -1);
  assert.ok(full.scroll.innerHTML.indexOf('You have 3 graphs, the most there can be. Delete one to make another.') !== -1);
});

test('the page: picking a style edits it; Save stores it in graphStyles and the first style in the flat keys', async () => {
  const p = bootGeneratedPage(TWO, 'emery');
  p.clickTab('graphs');
  p.tapAction('pickGraph', 2);
  assert.equal(p.S.forecastHours, '48', 'Long\'s length in the Forecast length row');
  assert.deepEqual(rows(p.scroll.innerHTML).map((c) => c[1]), [false, true], 'the tick on Long');
  // The page shows Revert only once something changed (the harness's classList is a stub).
  const revert = p.window.document.getElementById('revert');
  assert.equal(revert.hidden, true, 'a pick alone is no change');
  // Delete: the page's one Delete, under the Your graphs card as the editor's Delete screen.
  const html2 = p.scroll.innerHTML, del = html2.indexOf('<button type="button" class="ui-del" data-action="deleteGraphStyle">'
    + 'Delete Long</button>');
  assert.ok(del !== -1, 'Delete on another style, by its name');
  assert.ok(html2.lastIndexOf('</div></div>', del) === del - '</div></div>'.length, 'under the card, outside it');
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
  assert.ok(sheet.indexOf('<div class="ssel-lead">Start from a template. You get your own copy, and the template stays as it is.</div>') !== -1);
  assert.equal(sheet.indexOf('ssel-chk'), -1, 'nothing ticked');
  assert.match(sheet, />Classic<[\s\S]*>Clean<[\s\S]*>Stripes<[\s\S]*Or copy one of your graphs[\s\S]*>Copy of Graph 1<[\s\S]*>Copy of Long</,
    'the templates, then a copy of each graph');
  assert.equal((sheet.match(/class="ssel-pic"/g) || []).length, 5, 'a picture for each template and copy');
  assert.ok(sheet.indexOf('id="nh-gs-clean"') !== -1 && sheet.indexOf('id="nh-gs-copy2"') !== -1, 'tagged ids');
  p.pickOption('graphStyleNewFrom', 'clean');
  assert.equal(p.S.graphStylePick, '3', 'the new graph takes the free slot and is picked');
  assert.equal(GS.name(GSP.normalize(p.S), 2), 'Graph 3', 'never the template\'s name');
  assert.equal(GS.parse(GSP.normalize(p.S)).names[2], '', 'stored as the default name');
  assert.equal(p.S.forecastHours, '48', 'the template\'s length, in the flat keys while it shows');
  assert.deepEqual([p.S.thirdLine, p.S.thirdLineStyle, p.S.rainBarColor, p.S.forecastAxisNumbers, p.S.dayNightShading],
    ['cloud', 'stripeTop', 'white', 'graph', true], 'the template\'s lines, bars, high and low and night shading');
  assert.equal(p.S.graphStyleNewFrom, '', 'the picker is cleared');
  assert.equal(p.scroll.innerHTML.indexOf('data-select="graphStyleNewFrom"'), -1, 'three graphs: no New graph');
  assert.match(rows(p.scroll.innerHTML)[2][3], /^\d+ h · No screen$/, 'a new graph is on no screen yet');
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

test('the page: the picked graph\'s pencil makes its name a field; OK, Enter and leaving it store the name, Escape keeps it', () => {
  const p = bootGeneratedPage(TWO, 'emery');
  p.clickTab('graphs');
  p.tapAction('pickGraph', 2);
  p.tapAction('renameGraph');
  let html = p.scroll.innerHTML;
  assert.ok(html.indexOf('<div class="ui-row gl-row on rn" role="listitem"><input type="text" class="ui-rn-in" data-gl-rename-in '
    + 'maxlength="24" autocomplete="off" aria-label="Graph name" placeholder="Graph 2" value="Long"><button type="button" '
    + 'class="dlg-done" data-action="renameGraphOk">OK</button></div>') !== -1, 'the field holds the name, OK beside it');
  p.typeName('[data-gl-rename-in]', '  Weekend ');
  p.tapAction('renameGraphOk');
  assert.equal(GS.name(p.S, 1), 'Weekend', 'trimmed');
  html = p.scroll.innerHTML;
  assert.equal(rows(html)[1][2], 'Weekend', 'the row shows the new name');
  assert.equal(html.indexOf('data-gl-rename-in'), -1, 'the field gone');
  // The default name back: stored as none.
  p.tapAction('renameGraph');
  p.typeName('[data-gl-rename-in]', 'Graph 2');
  p.tapAction('renameGraphOk');
  assert.equal(GS.parse(GSP.normalize(p.S)).names[1], '');
  // Enter stores it as OK does.
  const field = (value) => {
    const f = { value, closest: (sel) => (sel === '[data-gl-rename-in]' ? f : null) };
    return f;
  };
  p.tapAction('renameGraph');
  p.typeName('[data-gl-rename-in]', 'Weekend');
  p.docDispatch('keydown', { key: 'Enter', target: field('Weekend'), preventDefault() {} });
  assert.equal(GS.name(p.S, 1), 'Weekend');
  assert.equal(p.scroll.innerHTML.indexOf('data-gl-rename-in'), -1);
  // Escape keeps the old name.
  p.tapAction('renameGraph');
  p.typeName('[data-gl-rename-in]', 'Other');
  p.docDispatch('keydown', { key: 'Escape', target: field('Other'), preventDefault() {} });
  assert.equal(GS.name(p.S, 1), 'Weekend');
  assert.equal(p.scroll.innerHTML.indexOf('data-gl-rename-in'), -1, 'the field gone');
  // Leaving the field for anything but OK stores the name.
  p.tapAction('renameGraph');
  p.docDispatch('focusout', { target: field('Away'), relatedTarget: null });
  assert.equal(GS.name(p.S, 1), 'Away');
  // Picking another graph ends a rename, and keeps the name stored.
  p.tapAction('renameGraph');
  p.tapAction('pickGraph', 1);
  assert.equal(p.scroll.innerHTML.indexOf('data-gl-rename-in'), -1);
  assert.equal(GS.name(GSP.normalize(p.S), 1), 'Away');
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

test('the screen editor: the forecast row\'s Graph dropdown names its graph before its size; the sheet lists your graphs and a copy', () => {
  const M = require('../src/pkjs/screens.js');
  const p = bootGeneratedPage(TWO, 'emery');
  p.tapAction('openScreen', 1);
  const j = M.idxOf(M.screensOf(p.S, EMERY)[1], 'fc');
  const body = () => p.editor().querySelector('[data-se-body]').innerHTML;
  // The row: the graph's dropdown by its name, then its size's; no Edit (the Graphs tab edits a
  // graph), no card.
  const row = editorRow(body(), j);
  assert.ok(row.indexOf('<span class="se-ctl"><button type="button" class="sel-wrap" data-se="style" data-j="' + j
    + '" aria-haspopup="dialog" aria-label="Graph: Long"><span>Long</span><i class="sel-chev"></i></button>'
    + '<button type="button" class="sel-wrap" data-se="size" data-j="' + j + '"') !== -1, row);
  assert.match(editorRows(body())[j], /^Forecast graph · Long · (?:Fill|\d rows)$/);
  assert.equal(row.indexOf('editstyle'), -1);
  assert.equal(body().indexOf('se-graph'), -1, 'no card');
  // The picker: the page's select sheet over the editor, your graphs alone, no pictures.
  p.tapEditor({ se: 'style', j });
  let sheet = p.modal.innerHTML;
  assert.match(sheet, /Graph on this screen/);
  assert.ok(sheet.indexOf('<div class="ssel-lead">Pick the graph this screen shows. To start one from a template, use New graph'
    + ' on the Graphs tab.</div>') !== -1, 'templates are on the Graphs tab');
  assert.equal(sheet.indexOf('class="ssel-pic"'), -1, 'no pictures');
  assert.equal(sheet.indexOf('>Classic<'), -1, 'no templates');
  assert.match(sheet, />Graph 1 · 24 h<\/span><span class="ssel-opt-desc">On Default</);
  assert.match(sheet, />Long · \d+ h<\/span><span class="ssel-opt-desc">Only on this screen</);
  assert.match(sheet, /class="ssel-opt add"[^>]*data-select-pick="new:copy2"[\s\S]*?>New graph<\/span><span class="ssel-opt-desc">A copy of Long, for this screen</);
  p.pickOption('screenGraphStyle', '1');
  assert.equal(p.S.viewStyle1, '1', 'Flick 1 draws the first graph');
  assert.match(body(), /aria-label="Graph: Graph 1"/, 'the editor repaints');
  // New graph: a copy of the screen's graph, put on this screen and picked on the Graphs tab.
  p.tapEditor({ se: 'style', j });
  p.pickOption('screenGraphStyle', 'new:copy1');
  assert.equal(GS.count(p.S), 3);
  assert.equal(p.S.viewStyle1, '3', 'Flick 1 draws the new graph');
  assert.equal(p.S.graphStylePick, '3');
  const N = GSP.normalize(p.S);
  assert.deepEqual(GS.valuesOf(N, 2), GS.valuesOf(N, 0), 'Graph 1\'s values');
  assert.equal(GS.name(N, 2), 'Graph 3');
  assert.match(body(), /aria-label="Graph: Graph 3"/);
  p.tapEditor({ se: 'style', j });
  sheet = p.modal.innerHTML;
  assert.equal(sheet.indexOf('data-select-pick="new:'), -1, 'no free slot: no New graph');
  p.pickOption('screenGraphStyle', '2');
  assert.equal(p.S.viewStyle1, '2');
  // One graph: its picker offers New graph, a copy of it.
  const one = bootGeneratedPage(layout(['1', '1'], { provider: 'dwd' }), 'emery');
  one.tapAction('openScreen', 0);
  const fc = M.idxOf(M.screensOf(one.S, EMERY)[0], 'fc');
  one.tapEditor({ se: 'style', j: fc });
  assert.match(one.modal.innerHTML, />Graph 1 · \d+ h<\/span><span class="ssel-opt-desc">Also on Flick 1</);
  assert.ok(one.modal.innerHTML.indexOf('data-select-pick="new:copy1"') !== -1);
  // basalt: no Graph dropdown, the size alone.
  const b = bootGeneratedPage(TWO, 'basalt');
  b.tapAction('openScreen', 0);
  const bBody = b.editor().querySelector('[data-se-body]').innerHTML;
  assert.match(editorRows(bBody)[M.idxOf(M.screensOf(b.S, BASALT)[0], 'fc')], /^Forecast graph · (?:Fill|\d rows)$/);
  assert.equal(bBody.indexOf('data-se="style"'), -1);
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
  assert.match(rows(p.scroll.innerHTML)[1][3], /^\d+ h · Flick 1$/);
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
  // The limit: a screen that would make the screens draw a sixth series is greyed out.
  const busy = layout(['1', '1'], { provider: 'dwd',
    secondaryLine: 'precip_prob', thirdLine: 'uv', fourthLine: 'wind', fifthLine: 'gust',
    graphStyles: stylesItem({ secondaryLine: 'cloud', thirdLine: 'pressure', fourthLine: 'off', fifthLine: 'off' }) });
  const q = bootGeneratedPage(busy, 'emery');
  q.clickTab('graphs');
  q.tapAction('pickGraph', 2);
  // Graph 1 draws four series on the other screen, so Long's cloud and pressure would make six
  // on either.
  assert.deepEqual(chips(q.scroll.innerHTML), [['Default', 'dim'], ['Flick 1', 'dim']]);
  assert.ok(q.scroll.innerHTML.indexOf('The watch can show 5 lines and stripes across all your screens. In use: Precipitation %,'
    + ' UV Index, Wind speed, Wind gusts. Long also needs Cloud cover % and Air pressure (hPa). To make room, turn off a line'
    + ' in one of your graphs.') !== -1, 'the limit says why: what is in use, what Long adds, what to do');
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
