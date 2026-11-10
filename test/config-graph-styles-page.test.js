'use strict';
// test/config-graph-styles-page.test.js — graph styles on the settings page, where each is "a
// graph" (src/pkjs/settings/graph-styles-page.js, Pebble Time 2): the swap that puts the picked
// graph's values in the flat keys while its dialog is open and the first graph's otherwise, the
// settings as Save stores them, the Your graphs card (a row per graph with its picture, its
// screens, its metrics and the room left; New graph from a template or as a copy; the Undo of a
// Delete), a graph's dialog behind its row (renamed in its title, its settings, Show on and
// Delete), the screen editor's graph chips (a chip per graph, the row named after its graph), and
// the five-series limit with its count in the card's header ("4/5 metrics active" and its '?').
// The module first, then the REAL generated page (test/helpers/page-harness.js).
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
const ui = require('../src/pkjs/config-ui/lib/ui.js');
const { editorRows, editorRow, editorAddChips } = require('./helpers/page-rows.js');

const PC = global.PConf;
const EMERY = platform.computeEnv({ platform: 'emery' });
const BASALT = platform.computeEnv({ platform: 'basalt' });

/**
 * Graph k's row on the Your graphs card (listRows).
 * @param {Object} S Settings.
 * @param {Object} env Platform env.
 * @param {number} k A style index.
 * @returns {Object}
 */
function row(S, env, k) {
  return GSP.listRows(S, env).rows.filter((r) => r.k === k)[0];
}

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

test('onRender: a graph\'s dialog shows the picked style, anywhere else the first', () => {
  const S = Object.assign({}, TWO, { graphStylePick: '2' });
  GSP.onRender({ S, env: EMERY, tab: 'graphs', pane: 'forecast', dialog: 'graph' });
  assert.equal(S.forecastHours, '48');
  GSP.onRender({ S, env: EMERY, tab: 'graphs', pane: 'forecast', dialog: null });
  assert.equal(S.forecastHours, '24', 'the dialog closed: the first style, on the pane too');
  GSP.onRender({ S, env: EMERY, tab: 'graphs', pane: 'forecast', dialog: 'graph' });
  S.thirdLine = 'wind';
  GSP.onRender({ S, env: EMERY, tab: 'statusbars', pane: null, dialog: 'barWeather' });
  assert.equal(S.thirdLine, 'off', 'another dialog: the first style');
  assert.equal(GS.parse(S).styles[1].thirdLine, 'wind', 'the edit kept in the style');
  // A pick that names no style (a graph just deleted) reads as the first, and its dialog shows
  // nothing, so it closes.
  const T = Object.assign({}, TWO, { graphStylePick: '3' });
  GSP.onRender({ S: T, env: EMERY, tab: 'graphs', pane: 'forecast', dialog: 'graph' });
  assert.equal(T.forecastHours, '24');
  assert.equal(GSP.graphShown(T, EMERY), false);
  assert.equal(GSP.graphShown(S, EMERY), true);
  assert.equal(GSP.graphShown(T, BASALT), true, 'a watch with one graph: its dialog always shows');
  // The dialog and its gate read the pick alike: one that names no graph by its number is the
  // first, which always exists.
  ['0', '-1', 'x', ''].forEach((pick) => {
    const P = Object.assign({}, TWO, { graphStylePick: pick });
    assert.equal(GSP.pickIndex(P), 0, 'pick ' + JSON.stringify(pick));
    assert.equal(GSP.graphShown(P, EMERY), true, 'pick ' + JSON.stringify(pick) + ': the first graph shows');
  });
  // A watch without styles: nothing moves.
  const B = Object.assign({}, TWO, { graphStylePick: '2' });
  GSP.onRender({ S: B, env: BASALT, tab: 'graphs', pane: 'forecast', dialog: 'graph' });
  assert.equal(B.forecastHours, '24');
  assert.equal(B[GSP.SWAP], undefined);
});

// Two graphs on two screens with five metrics between them: Graph 1 the rain chance, UV and
// gusts; Graph 2 the rain chance, cloud cover and wind.
const FULL_FIVE = layout(['1', '2'], {
  provider: 'dwd', forecastHours: '24', secondaryLine: 'precip_prob', secondaryLineStyle: 'line', thirdLine: 'uv',
  fourthLine: 'gust', fifthLine: 'off',
  graphStyles: stylesItem({ secondaryLine: 'precip_prob', secondaryLineStyle: 'line', thirdLine: 'cloud',
    thirdLineStyle: 'line', fourthLine: 'wind', fifthLine: 'off' })
});

test('over the limit: a pick is taken, and the line\'s dialog offers each line that makes room, and Undo', () => {
  // The owner's ask, 2026-11-10: adding a metric past the five lets you choose which line of
  // which graph goes. Graph 2's fourth metric becomes pressure, a sixth.
  const p = bootGeneratedPage(FULL_FIVE, 'emery');
  p.clickTab('graphs');
  p.tapAction('openGraph', 2);
  p.openNestedSheet('lineFourth');
  assert.equal(p.modal.innerHTML.indexOf('class="gl-over"'), -1, 'five: no note');
  p.openModalSelect('fifthLine');
  p.pickOption('fifthLine', 'pressure');
  assert.equal(GS.settingsFor(GSP.normalize(p.S), 1).fifthLine, 'pressure', 'the pick is taken');
  const html = p.modal.innerHTML;
  assert.ok(html.indexOf('That makes 6 metrics on your screens, and the watch can show 5. Turn off one of these lines:')
    !== -1, 'the note says how many');
  const offered = (h) => (h.match(/data-action="graphLimitOff" data-action-arg="([^"]+)"/g) || [])
    .map((m) => m.replace(/.*data-action-arg="([^"]+)"/, '$1'));
  // Every line whose metric no other line draws, the Main metrics aside (they have no Off).
  assert.deepEqual(offered(html), ['0:thirdLine', '0:fourthLine', '1:thirdLine', '1:fourthLine', '1:fifthLine']);
  assert.ok(/Graph 1: UV Index<\/button>/.test(html), 'by graph and metric');
  assert.ok(html.indexOf('data-action="graphLimitUndo"') !== -1, 'and Undo');
  // Graph 1's UV goes (it waits held while Graph 2 is in the dialog): five again, the note gone.
  p.tapAction('graphLimitOff', '0:thirdLine', 'modal');
  assert.equal(p.modal.innerHTML.indexOf('class="gl-over"'), -1);
  const N = GSP.normalize(p.S);
  assert.deepEqual([N.thirdLine, GS.settingsFor(N, 1).fifthLine], ['off', 'pressure']);
  p.backDialog();
  p.doneDialog();
  assert.equal(GSP.normalize(p.S).thirdLine, 'off', 'kept through Done');
  assert.equal(GSP.metricsNote(p.S, EMERY).text, '5/5 metrics active');
  // Undo puts the pick back.
  const u = bootGeneratedPage(FULL_FIVE, 'emery');
  u.clickTab('graphs');
  u.tapAction('openGraph', 2);
  u.openNestedSheet('lineFourth');
  u.openModalSelect('fifthLine');
  u.pickOption('fifthLine', 'pressure');
  u.tapAction('graphLimitUndo', undefined, 'modal');
  assert.equal(u.modal.innerHTML.indexOf('class="gl-over"'), -1);
  assert.equal(GS.settingsFor(GSP.normalize(u.S), 1).fifthLine, 'off');
  assert.equal(GSP.normalize(u.S).thirdLine, 'uv', 'nothing else moved');
  // A chip for a line it does not offer changes nothing (the Main metric has no Off).
  u.openModalSelect('fifthLine');
  u.pickOption('fifthLine', 'pressure');
  u.tapAction('graphLimitOff', '0:secondaryLine', 'modal');
  assert.equal(GSP.normalize(u.S).secondaryLine, 'precip_prob');
});

test('over the limit: Visible values count, a template\'s graph is never offered, a graph no screen shows is free', () => {
  // UV with all its values on Graph 1 and alerts only on Graph 2 (Graph 2 drew wind before):
  // six metrics.
  const S = Object.assign({}, FULL_FIVE, { graphStyles: stylesItem({ secondaryLine: 'precip_prob',
    secondaryLineStyle: 'line', thirdLine: 'cloud', thirdLineStyle: 'line', fourthLine: 'wind', fifthLine: 'uv',
    uvLineShow: 'all' }) });
  assert.equal(GSP.overBy(S, EMERY), 0, 'UV in both with all its values: five');
  const W = Object.assign({}, S);
  GSP.swapIn(W, 1);
  W.uvLineShow = 'alert';
  assert.equal(GSP.overBy(W, EMERY), 6);
  assert.ok(GSP.offLines(W, EMERY).some((c) => c.k === 1 && c.key === 'fifthLine' && c.s.alert), 'the Alert UV line');
  assert.match(GSP.limitBlock(W, EMERY), /Graph 2: UV Index \(alerts only\)|: UV Index \(alerts only\)/);
  // The graph in the dialog shown on no screen: nothing to say.
  const free = Object.assign({}, W, { viewStyle1: '1' });
  assert.equal(GSP.overBy(free, EMERY), 0);
  assert.equal(GSP.limitBlock(free, EMERY), '');
  // A template's graph counts, but its lines are not offered: it is none of yours.
  const T = Object.assign({}, FULL_FIVE, { viewStyle1: 't1', graphStyles: GS.withTemplate(FULL_FIVE, 6, 'outdoor',
    { secondaryLine: 'precip_prob', thirdLine: 'cloud', fourthLine: 'wind', fifthLine: 'pressure' }) });
  assert.equal(GSP.overBy(T, EMERY), 6);
  assert.deepEqual(GSP.offLines(T, EMERY).map((c) => c.k + ':' + c.key), ['0:thirdLine', '0:fourthLine']);
  // A watch without graph styles never is.
  assert.equal(GSP.overBy(W, BASALT), 0);
});

test('the cards\' line: a graph\'s length and the screens it shows on', () => {
  // The cards' line: the length, then the screens.
  const line = (S, k) => row(S, EMERY, k).where;
  assert.equal(line(TWO, 0), '24 h · Default');
  assert.match(line(TWO, 1), /^\d+ h · Flick 1$/);
  assert.notEqual(line(TWO, 1), '48 h · Flick 1', 'the long span by the hours it shows');
  const three = layout(['1', '2', '2'], { graphStyles: TWO.graphStyles, forecastHours: '24' });
  assert.match(line(three, 1), /^\d+ h · Flick 1, Flick 2$/);
  assert.match(line(layout(['1'], { graphStyles: TWO.graphStyles }), 1), /^\d+ h · No screen$/);
  assert.equal(line(layout(['1', '3'], { graphStyles: TWO.graphStyles }), 0), '24 h · Default, Flick 1',
    'a screen on a style that does not exist draws the first');
  assert.equal(row(TWO, BASALT, 0).where, '', 'one graph: no screens line');
});

test('the five-series limit: a pick that would make a sixth series says so on a shown style only, and stays a pick', () => {
  // Style 1 draws rain chance, UV and gusts; style 2 rain chance, cloud and wind: five series
  // between them, the most the watch takes (four lines' rows and the spare).
  const S = layout(['1', '2'], {
    secondaryLine: 'precip_prob', secondaryLineStyle: 'line', thirdLine: 'uv', fourthLine: 'gust', fifthLine: 'off',
    graphStyles: stylesItem({ secondaryLine: 'precip_prob', secondaryLineStyle: 'line', thirdLine: 'cloud',
      thirdLineStyle: 'line', fourthLine: 'wind', fifthLine: 'off' })
  });
  const metric = PC.optionsResolvers.get('forecastMetric');
  // Over the limit: said in the option's line, never greyed out (the owner's ask, 2026-11-10:
  // the pick is taken and the line's dialog then asks which line to turn off).
  const off = (opts) => {
    assert.deepEqual(opts.filter((o) => o[2] && o[2].disabled), [], 'nothing greyed out');
    return opts.filter((o) => o[2] && o[2].desc === GSP.LIMIT).map((o) => o[1]);
  };
  // The first style's fifth line: a metric another style draws is free, a new one is not.
  const lines = ['secondaryLine', 'thirdLine', 'fourthLine'];
  const fifth = metric(S, EMERY, { key: 'fifthLine', off: true, exclude: lines });
  assert.deepEqual(off(fifth), ['pressure', 'feels', 'dew']);
  assert.equal(fifth.find((o) => o[1] === 'pressure')[2].desc, GSP.LIMIT);
  assert.equal(GSP.LIMIT, 'That makes 6 metrics on your screens. The watch can show 5, so you then turn off a line.');
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
  // A screen's graph (the screen editor's graph chips, Add a screen's presets): a style whose
  // fifth series fits beside a graph of four, one whose sixth does not.
  const fits = layout(['1', '1'], {
    secondaryLine: 'precip_prob', thirdLine: 'uv', fourthLine: 'wind', fifthLine: 'gust',
    graphStyles: stylesItem({ secondaryLine: 'cloud', thirdLine: 'off', fourthLine: 'off', fifthLine: 'off' })
  });
  assert.equal(GSP.screenOverflows(fits, EMERY, 1, 1), false, 'cloud: the fifth series, on the spare row');
  const busy = Object.assign({}, fits, {
    graphStyles: stylesItem({ secondaryLine: 'cloud', thirdLine: 'pressure', fourthLine: 'off', fifthLine: 'off' }) });
  assert.equal(GSP.screenOverflows(busy, EMERY, 1, 1), true, 'cloud and pressure would be a sixth series');
  assert.equal(GSP.screenOverflows(busy, EMERY, 1, 0), false);
  // Why, as Add a screen says it under a preset: what the graph adds, and the count.
  const onFlick = (T) => Object.assign({}, GSP.asStored(T), { viewStyle1: '2' });
  assert.equal(GSP.limitDesc(onFlick(busy), EMERY, 1), 'Also needs Cloud cover % and Air pressure (hPa): that makes 6'
    + ' metrics on your screens. The watch can show 5.');
  // A line and a stripe of one metric are two series.
  const stripes = Object.assign({}, fits, { graphStyles: stylesItem({ secondaryLine: 'cloud',
    secondaryLineStyle: 'stripeTop', thirdLine: 'precip_prob', thirdLineStyle: 'stripeTop', fourthLine: 'off', fifthLine: 'off' }) });
  assert.equal(GSP.screenOverflows(stripes, EMERY, 1, 1), true);
  assert.equal(GSP.limitDesc(onFlick(stripes), EMERY, 1), 'Also needs Cloud cover % (stripe) and Precipitation % (stripe):'
    + ' that makes 6 metrics on your screens. The watch can show 5.');
  // The Show on row's note under its greyed-out screens: the rule, what the screens use, what the
  // dialog's graph needs on top.
  const two = Object.assign({}, fits, { graphStyles: stylesItem({ secondaryLine: 'cloud', thirdLine: 'pressure',
    fourthLine: 'off', fifthLine: 'off' }, { secondaryLine: 'dew', thirdLine: 'feels', fourthLine: 'off', fifthLine: 'off' },
  ['', 'Long', 'Air']) });
  const inUse = 'The watch can show 5 metrics across all your screens. In use: Precipitation %, UV Index, Wind'
    + ' speed, Wind gusts.';
  assert.equal(GSP.limitNote(two, EMERY, 1), inUse + ' Long also needs Cloud cover % and Air pressure (hPa). To make room,'
    + ' turn off a line in one of your graphs.');
  assert.equal(GSP.limitNote(two, EMERY, 2), inUse + ' Air also needs Dew point and Feels-like temperature. To make room,'
    + ' turn off a line in one of your graphs.');
});

/**
 * The Your graphs rows in the page: [arg, name, where, metrics, room] per row, where '' on a row
 * that names no screens (a watch with one graph). Every row draws its graph.
 * @param {string} html The page's HTML.
 * @returns {Array<Array<string>>}
 */
function rows(html) {
  const out = [], re = /<div class="ui-row gl-row" role="listitem"><button type="button" class="gl-open" data-action="openGraph" data-action-arg="(\d)"><span class="ssel-pic gl-pic" aria-hidden="true">([\s\S]*?)<\/span><span class="gl-txt"><span class="ui-n">([^<]*)<\/span>(?:<span class="ui-d">([^<]*)<\/span>)?<span class="ui-d gl-met">([^<]*)<\/span><span class="ui-d">([^<]*)<\/span><\/span><span class="chev nav" aria-hidden="true">&#8250;<\/span><\/button><\/div>/g;
  let m;
  while ((m = re.exec(html))) {
    assert.match(m[2], /^<svg class="wiz-graph-scr" /, 'the row\'s picture of its graph');
    out.push([m[1], m[3], m[4] || '', m[5], m[6]]);
  }
  return out;
}

/**
 * The card titles of the open dialog, in order.
 * @param {string} html The dialog's HTML.
 * @returns {string[]}
 */
function cardTitles(html) {
  return [...html.matchAll(/<span class="ttl">([^<]*)<\/span>/g)].map((m) => m[1]);
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

test('the page: Your graphs lists each graph with its picture, where it shows, its metrics and the room left', () => {
  const p = bootGeneratedPage(TWO, 'emery');
  p.clickTab('graphs');
  const html = p.scroll.innerHTML;
  assert.ok(html.indexOf('<span class="ttl" data-title-by="graphStyle">Your graphs</span>') !== -1, 'the card\'s title');
  assert.ok(html.indexOf('pane-seg') < html.indexOf('data-action="openGraph"'), 'under the pane switcher');
  assert.equal(html.indexOf('pin-blk'), -1, 'no pinned preview: each row draws its graph, its dialog pins it');
  const r = rows(html);
  assert.deepEqual(r.map((x) => [x[0], x[1], x[3], x[4]]), [
    ['1', 'Graph 1', 'Precipitation %', 'Room for 3 more metrics'],
    ['2', 'Long', 'Precipitation %, Cloud cover % (stripe)', 'Room for 2 more metrics']], 'a row per graph, a tap opens it');
  assert.equal(r[0][2], '24 h · Default', 'its length and its screens');
  assert.match(r[1][2], /^\d+ h · Flick 1$/);
  assert.ok(html.indexOf('id="nh-gl0"') !== -1 && html.indexOf('id="nh-gl1"') !== -1, 'each picture\'s ids its own');
  assert.equal(html.indexOf('gl-lead'), -1, 'two graphs: no lead');
  ['pickGraph', 'renameGraph', 'ui-pen', 'deleteGraphStyle', 'graphOnScreen'].forEach((gone) =>
    assert.equal(html.indexOf(gone), -1, gone + ': the dialog\'s, not the list\'s'));
  assert.ok(html.indexOf('<button type="button" class="ui-row ui-new" data-action="newGraph">') !== -1,
    'New graph while a slot is free');
  assert.ok(html.indexOf('<span class="ui-n">New graph</span><span class="ui-d">2 of 6 graphs</span>') !== -1, 'its count');
  // A watch without graphs of its own: its one graph, untitled, named Forecast graph.
  const b = bootGeneratedPage(TWO, 'basalt');
  b.clickTab('graphs');
  const bh = b.scroll.innerHTML;
  assert.deepEqual(rows(bh), [['1', 'Forecast graph', '', 'Precipitation %', 'Room for 3 more metrics']]);
  ['Your graphs', 'hdr-note', 'newGraph', 'gl-lead'].forEach((gone) => assert.equal(bh.indexOf(gone), -1, gone));
  // One graph: the lead says what New graph is for.
  const one = bootGeneratedPage(layout(['1', '1'], { provider: 'dwd' }), 'emery');
  one.clickTab('graphs');
  assert.equal(rows(one.scroll.innerHTML).length, 1);
  assert.ok(one.scroll.innerHTML.indexOf('<div class="gl-lead">New graph gives a screen a graph of its own.</div>') !== -1);
  assert.ok(one.scroll.innerHTML.indexOf('<span class="ui-n">New graph</span><span class="ui-d">1 of 6 graphs</span>') !== -1);
  // Six graphs: why there is no New graph.
  const full = bootGeneratedPage(Object.assign({}, TWO, { graphStyles: JSON.stringify({ names: [],
    styles: [null, { forecastHours: '48' }, { forecastHours: '12' }, {}, {}, {}] }) }), 'emery');
  full.clickTab('graphs');
  assert.equal(rows(full.scroll.innerHTML).length, 6, 'a row per graph');
  assert.equal(full.scroll.innerHTML.indexOf('ui-new'), -1);
  assert.ok(full.scroll.innerHTML.indexOf('You have 6 graphs, the most there can be. Delete one to make another.') !== -1);
});

test('a row\'s room: the graph\'s free lines, and on a graph the screens show no more than their five metrics leave', () => {
  assert.equal(GS.linesDrawn(EMERY), 4);
  assert.equal(GS.linesDrawn(BASALT), 4);
  assert.equal(GS.linesDrawn(null), 4, 'an unknown watch reads as one that draws them all');
  const APLITE = platform.computeEnv({ platform: 'aplite' });
  assert.equal(GS.linesDrawn(APLITE), 2, 'aplite draws two lines');
  const room = (S, env, k) => row(S, env, k).room;
  assert.equal(room(layout(['1'], { secondaryLine: 'precip_prob', thirdLine: 'off', fourthLine: 'uv' }), APLITE, 0),
    'Room for 1 more metric', 'a third line aplite does not draw leaves room in its two');
  // Graph 1 draws four metrics on the Default, Long the fifth on Flick 1.
  const four = layout(['1', '2'], { secondaryLine: 'precip_prob', thirdLine: 'uv', fourthLine: 'wind', fifthLine: 'gust',
    graphStyles: stylesItem({ secondaryLine: 'cloud', thirdLine: 'off', fourthLine: 'off', fifthLine: 'off' }) });
  assert.equal(room(four, EMERY, 0), 'Full: 4 metrics', 'every line taken');
  assert.equal(room(four, EMERY, 1), 'Full: the screens show 5 metrics', 'three lines free, the screens full');
  assert.equal(room(Object.assign({}, four, { viewStyle1: '1' }), EMERY, 1), 'Room for 3 more metrics',
    'a graph no screen shows: its free lines');
  const three = Object.assign({}, four, { fifthLine: 'off' });
  assert.equal(room(three, EMERY, 0), 'Room for 1 more metric');
  assert.equal(room(three, EMERY, 1), 'Room for 1 more metric', 'the one the screens leave');
});

test('the page: a row opens its graph\'s dialog; its edits are that graph\'s, Done keeps them, × puts them back, Save stores them', async () => {
  const p = bootGeneratedPage(TWO, 'emery');
  p.clickTab('graphs');
  const revert = p.window.document.getElementById('revert');
  p.tapAction('openGraph', 2);
  assert.equal(p.S.graphStylePick, '2');
  assert.equal(p.S.forecastHours, '48', 'Long\'s length in the flat keys');
  const dlg = p.modal.innerHTML;
  assert.ok(dlg.indexOf('<span class="dlg-kick">Your graphs</span>') !== -1, 'the list it came from, over the title');
  assert.ok(dlg.indexOf('id="esheet-ttl-graph">Long</span>') !== -1, 'the graph\'s name as the title');
  assert.ok(dlg.indexOf('<div class="pin dlg-pin">') !== -1, 'its preview pinned at the top');
  assert.deepEqual(cardTitles(dlg), ['Lines', 'Rain bars', 'Other', 'Left axis', 'Show on']);
  assert.ok(dlg.indexOf('data-edit-sheet="graphColors"') !== -1, 'Graph colors, a card of its own');
  assert.ok(dlg.endsWith('</div></div></div></div><button type="button" class="ui-del" data-action="deleteGraphStyle">Delete Long'
    + '</button></div>'), 'Delete under the last card, by the graph\'s name');
  assert.equal(revert.hidden, true, 'opening a graph is no change');
  const listBefore = rows(p.scroll.innerHTML);
  assert.equal(listBefore.length, 2);
  p.tapSegment('forecastHours', '12', 'modal');
  assert.equal(p.S.forecastHours, '12');
  assert.equal(revert.hidden, false, 'an edit is');
  assert.deepEqual(rows(p.scroll.innerHTML), listBefore,
    'the list the dialog covers is not drawn again (no picture redrawn per tap); Done draws it afresh');
  p.asked.length = 0;
  p.doneDialog();
  assert.equal(p.modal.innerHTML, '', 'Done closes it');
  assert.equal(p.S.forecastHours, '24', 'and the flat keys hold the first graph again');
  assert.equal(p.S[GSP.SWAP], undefined);
  assert.equal(rows(p.scroll.innerHTML)[1][2], '12 h · Flick 1', 'the row says the new length');
  assert.ok(p.asked.indexOf('[data-action="openGraph"][data-action-arg="2"]') !== -1, 'the focus goes back to its row');
  assert.ok(p.scroll.innerHTML.indexOf('data-action="openGraph" data-action-arg="2"') !== -1);
  // × puts back what the dialog changed.
  p.tapAction('openGraph', 2);
  assert.equal(p.S.forecastHours, '12', 'Long with its edit, in the flat keys while its dialog is open');
  p.tapSegment('forecastHours', '24', 'modal');
  p.cancelDialog();
  assert.equal(p.S.forecastHours, '24', 'the first graph\'s');
  assert.equal(GS.parse(p.S).styles[1].forecastHours, '12', 'Long keeps the edit Done stored');
  const blob = await p.save();
  assert.equal(blob.forecastHours, '24', 'the first graph stored in the flat keys');
  const two = GS.parse(blob).styles[1];
  assert.equal(two.forecastHours, '12', 'Long\'s edit in graphStyles');
  assert.equal(two.thirdLine, 'cloud');
  assert.equal(blob.graphStylePick, undefined, 'the pick is the page\'s own');
});

test('the page: the one graph\'s dialog on a watch without graphs of its own', () => {
  const b = bootGeneratedPage(TWO, 'basalt');
  b.clickTab('graphs');
  b.tapAction('openGraph', 1);
  const dlg = b.modal.innerHTML;
  assert.ok(dlg.indexOf('<span class="dlg-kick">Graphs</span>') !== -1, 'the tab over the title');
  assert.ok(dlg.indexOf('id="esheet-ttl-graph">Forecast graph</span>') !== -1);
  assert.deepEqual(cardTitles(dlg), ['Lines', 'Rain bars', 'Other']);
  ['data-dlg-rename', 'deleteGraphStyle', 'graphOnScreen'].forEach((gone) => assert.equal(dlg.indexOf(gone), -1, gone));
});

test('the page: Revert puts every graph back, the pick too', () => {
  const p = bootGeneratedPage(TWO, 'emery');
  p.clickTab('graphs');
  p.tapAction('openGraph', 2);
  p.tapSegment('forecastHours', '12', 'modal');
  p.doneDialog();
  p.window.document.getElementById('revert').dispatch('click', { target: {} });
  const act = { getAttribute: (n) => (n === 'data-confirm' ? 'action' : null) };
  p.modal.dispatch('click', { target: { closest: (sel) => (sel === '[data-confirm]' ? act : null) } });
  assert.equal(p.S.graphStylePick, '1');
  assert.equal(p.S.forecastHours, '24');
  assert.equal(p.S[GSP.SWAP], undefined);
  assert.equal(p.S.graphStyles, TWO.graphStyles, 'Long as it was');
});

test('the page: New graph from a template opens the new graph\'s dialog, its name ready to type; a seventh is not offered', async () => {
  const WF = require('../src/pkjs/settings/wizard-forecast.js');
  const p = bootGeneratedPage(TWO, 'emery');
  p.clickTab('graphs');
  p.tapAction('newGraph');
  const sheet = p.modal.innerHTML;
  assert.match(sheet, /New graph/);
  assert.ok(sheet.indexOf('<div class="ssel-lead">Start from a template. You get your own copy, and the template stays as it is.</div>') !== -1);
  assert.equal(sheet.indexOf('ssel-chk'), -1, 'nothing ticked');
  assert.deepEqual([...sheet.matchAll(/data-select-pick="([a-z0-9]+)"/g)].map((m) => m[1]),
    WF.LOOKS.map((look) => look.id).concat(['copy1', 'copy2']), 'the templates in their order, then a copy of each graph');
  assert.match(sheet, />Classic<[\s\S]*>Clean<[\s\S]*>Stripes<[\s\S]*>Simple<[\s\S]*>Rain<[\s\S]*>Sky<[\s\S]*>Clouds<[\s\S]*>Outdoor<[\s\S]*>Sun<[\s\S]*>Comfort<[\s\S]*>Wind<[\s\S]*>Storm<[\s\S]*>Pressure<[\s\S]*>Meteogram<[\s\S]*Or copy one of your graphs[\s\S]*>Copy of Graph 1<[\s\S]*>Copy of Long</,
    'by their names');
  assert.equal((sheet.match(/class="ssel-pic"/g) || []).length, 16, 'a picture for each template and copy');
  assert.ok(sheet.indexOf('id="nh-gs-clean"') !== -1 && sheet.indexOf('id="nh-gs-copy2"') !== -1, 'tagged ids');
  // Under each template, its length and what it draws, in the words setup writes from its values.
  assert.deepEqual([...sheet.matchAll(/<span class="ssel-opt-desc">([^<]*)<\/span>/g)].map((m) => m[1]).slice(0, 14), [
    '24 h · Rain chance as a shaded area, rain bars',
    '66 h · Rain chance as a shaded area, solid rain bars',
    '24 h · Feels-like temperature as a line, clouds and rain chance as stripes, solid rain bars from the top',
    '24 h · Rain chance as a line',
    '12 h · Rain chance as a stripe, rain bars',
    '24 h · Rain chance as a line, clouds as a stripe, solid rain bars',
    '66 h · Clouds as a thick line, solid rain bars',
    '66 h · UV index as a line, rain chance as a shaded area, solid rain bars from the top',
    '24 h · UV index as a thick line, clouds as a stripe, solid rain bars',
    '24 h · Feels-like temperature as a line, rain chance as a shaded area, dew point as \u00d7 marks, rain bars',
    '24 h · Wind as a thick line, gusts as dots, rain bars',
    '24 h · Air pressure as a line, gusts as a thick line, rain chance as a stripe, rain bars',
    '66 h · Air pressure as a line, rain chance as a shaded area, solid rain bars',
    '66 h · Air pressure as a line, wind as dots, clouds as a stripe, rain bars']);
  p.pickOption('graphStyleNewFrom', 'clean');
  assert.equal(p.S.graphStylePick, '3', 'the new graph takes the free slot and is picked');
  assert.equal(GS.name(GSP.normalize(p.S), 2), 'Graph 3', 'never the template\'s name');
  assert.equal(GS.parse(GSP.normalize(p.S)).names[2], '', 'stored as the default name');
  assert.ok(p.modal.innerHTML.indexOf('data-dlg-rename-in maxlength="24" autocomplete="off" aria-label="Graph name"'
    + ' placeholder="Graph 3" value="Graph 3">') !== -1, 'its dialog, the name field open');
  // The template's values, in the flat keys while it shows (wizard-forecast.js LOOKS, the one
  // definition of a template).
  const clean = WF.lookOf('clean');
  assert.equal(p.S.forecastHours, clean.span, 'the template\'s length');
  Object.keys(clean.over).forEach((k) => assert.equal(p.S[k], clean.over[k], k));
  assert.equal(p.S.graphStyleNewFrom, '', 'the picker is cleared');
  p.enterRename('Weekend');
  assert.equal(GS.name(p.S, 2), 'Weekend', 'named as it is made');
  p.doneDialog();
  const html = p.scroll.innerHTML;
  assert.ok(html.indexOf('<span class="ui-n">New graph</span><span class="ui-d">3 of 6 graphs</span>') !== -1,
    'three graphs: room for three more');
  assert.deepEqual(rows(html).map((x) => x[1]), ['Graph 1', 'Long', 'Weekend']);
  assert.match(rows(html)[2][2], /^\d+ h · No screen$/, 'a new graph is on no screen yet');
  const blob = await p.save();
  assert.equal(GS.count(blob), 3);
  assert.equal(blob.thirdLine, 'off', 'the first graph is untouched');
  assert.equal(GS.settingsFor(blob, 2).thirdLine, clean.over.thirdLine, 'the new graph holds the template');
});

test('the page: New graph as a copy of a graph; a renamed graph keeps its default name from a new one', () => {
  const p = bootGeneratedPage(TWO, 'emery');
  p.clickTab('graphs');
  p.tapAction('newGraph');
  p.pickOption('graphStyleNewFrom', 'copy2');
  const N = GSP.normalize(p.S);
  assert.equal(GS.name(N, 2), 'Graph 3');
  assert.deepEqual(GS.valuesOf(N, 2), GS.valuesOf(N, 1), 'Long\'s values');
  assert.ok(p.modal.innerHTML.indexOf('placeholder="Graph 3" value="Graph 3">') !== -1, 'its dialog, the name field open');
  // A graph renamed to the name the new one would have: the new one takes the first free number.
  const S = layout(['1'], { graphStyles: stylesItem({ forecastHours: '48' }, null, ['', 'Graph 3', '']) });
  assert.equal(GSP.createGraph(S, 'classic', EMERY), 2);
  assert.equal(GS.name(S, 2), 'Graph 2');
  assert.deepEqual([3, 4, 5].map(() => GSP.createGraph(S, 'classic', EMERY)), [3, 4, 5], 'up to six graphs');
  assert.deepEqual([3, 4, 5].map((k) => GS.name(S, k)), ['Graph 4', 'Graph 5', 'Graph 6']);
  assert.equal(GSP.createGraph(S, 'classic', EMERY), -1, 'no free slot');
  assert.equal(GSP.createGraph(layout(['1']), 'nothing', EMERY), -1, 'no such template');
  assert.equal(GSP.createGraph(layout(['1']), 'copy3', EMERY), -1, 'no such graph');
});

test('the page: a graph\'s name is its dialog\'s title; OK, Enter and leaving the field store it, Escape keeps it, × puts it back', () => {
  const p = bootGeneratedPage(TWO, 'emery');
  p.clickTab('graphs');
  p.tapAction('openGraph', 2);
  assert.ok(p.modal.innerHTML.indexOf('<button type="button" class="ui-pen" data-dlg-rename aria-label="Rename Long">') !== -1,
    'the title\'s pencil');
  p.renameDialog();
  assert.ok(p.modal.innerHTML.indexOf('<input type="text" class="ui-rn-in" data-dlg-rename-in maxlength="24" autocomplete="off"'
    + ' aria-label="Graph name" placeholder="Graph 2" value="Long"><button type="button" class="dlg-done"'
    + ' data-dlg-rename-ok>OK</button>') !== -1, 'the field holds the name, OK beside it');
  p.typeName('[data-dlg-rename-in]', '  Weekend ');
  p.okRename();
  assert.equal(GS.name(p.S, 1), 'Weekend', 'trimmed');
  let dlg = p.modal.innerHTML;
  assert.ok(dlg.indexOf('id="esheet-ttl-graph">Weekend</span>') !== -1, 'the title says it');
  assert.ok(dlg.indexOf('>Delete Weekend</button>') !== -1, 'so does Delete');
  assert.equal(dlg.indexOf('data-dlg-rename-in'), -1, 'the field gone');
  // The default name back: stored as none.
  p.renameDialog();
  p.enterRename('Graph 2');
  assert.equal(GS.parse(GSP.normalize(p.S)).names[1], '');
  // Enter stores it as OK does.
  p.renameDialog();
  p.enterRename('Weekend');
  assert.equal(GS.name(p.S, 1), 'Weekend');
  // Escape keeps the name and the dialog.
  p.renameDialog();
  p.typeName('[data-dlg-rename-in]', 'Other');
  p.escapeDialog();
  assert.equal(GS.name(p.S, 1), 'Weekend');
  assert.ok(p.modal.innerHTML.indexOf('data-dlg-rename aria-label="Rename Weekend"') !== -1, 'the title is back');
  // Leaving the field stores it; Done keeps it, and the list says it.
  p.renameDialog();
  p.leaveRename('Away');
  assert.equal(GS.name(p.S, 1), 'Away');
  p.doneDialog();
  assert.equal(rows(p.scroll.innerHTML)[1][1], 'Away');
  // × puts back every name the dialog stored.
  p.tapAction('openGraph', 2);
  p.renameDialog();
  p.enterRename('Gone');
  dlg = p.modal.innerHTML;
  assert.ok(dlg.indexOf('id="esheet-ttl-graph">Gone</span>') !== -1);
  p.cancelDialog();
  assert.equal(GS.name(GSP.normalize(p.S), 1), 'Away');
  // The first graph renames too.
  p.tapAction('openGraph', 1);
  p.renameDialog();
  p.enterRename('Today');
  p.doneDialog();
  assert.equal(GS.name(GSP.normalize(p.S), 0), 'Today');
});

test('the page: Delete in a graph\'s dialog closes it and moves its screens to the first graph; Undo on the list brings both back', () => {
  const p = bootGeneratedPage(TWO, 'emery');
  p.clickTab('graphs');
  p.tapAction('openGraph', 1);
  assert.equal(p.modal.innerHTML.indexOf('deleteGraphStyle'), -1, 'the first graph has no Delete');
  p.doneDialog();
  p.tapAction('openGraph', 2);
  p.tapAction('deleteGraphStyle', undefined, 'modal');
  assert.equal(p.modal.innerHTML, '', 'the dialog closes: its graph is gone');
  assert.equal(GSP.graphShown(p.S, EMERY), false);
  assert.equal(GS.count(p.S), 1);
  assert.equal(p.S.viewStyle1, '1', 'Flick 1 draws the first graph');
  assert.equal(p.S.forecastHours, '24');
  assert.deepEqual(rows(p.scroll.innerHTML).map((x) => x[1]), ['Graph 1']);
  assert.match(p.scroll.innerHTML, /Long deleted\./);
  p.tapAction('undoDeleteGraphStyle');
  assert.equal(GS.count(p.S), 2);
  assert.equal(p.S.viewStyle1, '2');
  assert.equal(GS.settingsFor(p.S, 1).forecastHours, '48', 'Long with its values');
  assert.equal(p.S.forecastHours, '24', 'the first graph in the flat keys');
  assert.equal(p.scroll.innerHTML.indexOf('deleted.'), -1, 'the Undo is gone');
  assert.equal(p.modal.innerHTML, '', 'and no dialog opens');
});

test('the screen editor: with several graphs a chip per graph adds the forecast graph, and its row is named after its graph', () => {
  const M = require('../src/pkjs/screens.js');
  const p = bootGeneratedPage(TWO, 'emery');
  p.tapAction('openScreen', 1);
  const body = () => p.editor().querySelector('[data-se-body]').innerHTML;
  const fc = () => M.idxOf(M.screensOf(p.S, EMERY)[1], 'fc');
  // The row: its graph's name, its size's dropdown and its Edit, which opens the graph's dialog
  // (the owner's ask, 2026-11-10).
  assert.deepEqual(editorRows(body()), ['Watch bar', 'Clock', 'Long · Fill']);
  assert.ok(editorRow(body(), fc()).indexOf('<div class="se-mid"><span class="se-name">Long</span><span class="se-ctl">'
    + ui.dropdown('Fill', { 'data-se': 'size', 'data-j': fc(), 'aria-haspopup': 'dialog', 'aria-label': 'Size: Fill' })
    + ui.editButton('Edit', { 'data-se': 'editgraph', 'data-j': fc(), 'aria-haspopup': 'dialog', 'aria-label': 'Edit Long' })
    + '</span></div>') !== -1, editorRow(body(), fc()));
  ['data-se="style"', 'editstyle', 'se-graph'].forEach((gone) => assert.equal(body().indexOf(gone), -1, gone));
  // ✕ it: a chip per graph by its name, in the forecast graph's place.
  p.tapEditor({ se: 'rm', j: fc() });
  assert.deepEqual(editorAddChips(body()), ['Forecast bar', 'Radar bar', 'Health bar', 'New status bar', 'Graph 1', 'Long',
    'Rain radar', 'Health graph', 'Calendar']);
  assert.ok(body().indexOf(ui.chip('Long', { 'data-se': 'add', 'data-k': 'fc', 'data-g': 1 }, { icon: 'plus' })) !== -1);
  assert.equal(body().indexOf('aria-disabled'), -1, 'nothing greyed out');
  // A tap puts that graph on the screen.
  p.tapEditor({ se: 'add', k: 'fc', g: 0 });
  assert.equal(p.S.viewStyle1, '1');
  assert.deepEqual(editorRows(body()), ['Watch bar', 'Clock', 'Graph 1 · Fill']);
  p.tapEditor({ se: 'rm', j: fc() });
  p.tapEditor({ se: 'add', k: 'fc', g: 1 });
  assert.equal(p.S.viewStyle1, '2');
  assert.deepEqual(editorRows(body()), ['Watch bar', 'Clock', 'Long · Fill']);
  // A graph that does not exist is never put on, whatever asks for it.
  p.tapEditor({ se: 'rm', j: fc() });
  p.tapEditor({ se: 'add', k: 'fc', g: 2 });
  assert.equal(fc(), -1);
  // One graph: the Forecast graph chip, and the row says Forecast graph.
  const one = bootGeneratedPage(layout(['1', '1'], { provider: 'dwd' }), 'emery');
  one.tapAction('openScreen', 1);
  const oneBody = () => one.editor().querySelector('[data-se-body]').innerHTML;
  assert.match(editorRows(oneBody()).pop(), /^Forecast graph · (?:Fill|\d rows)$/);
  one.tapEditor({ se: 'rm', j: M.idxOf(M.screensOf(one.S, EMERY)[1], 'fc') });
  const oneChips = editorAddChips(oneBody());
  assert.ok(oneChips.indexOf('Forecast graph') !== -1 && oneChips.indexOf('Graph 1') === -1, oneChips.join(' | '));
  // basalt: no graph chips, the row says Forecast graph.
  const b = bootGeneratedPage(TWO, 'basalt');
  b.tapAction('openScreen', 0);
  const bBody = b.editor().querySelector('[data-se-body]').innerHTML;
  assert.match(editorRows(bBody)[M.idxOf(M.screensOf(b.S, BASALT)[0], 'fc')], /^Forecast graph · (?:Fill|\d rows)$/);
  assert.equal(bBody.indexOf('data-g='), -1);
});

test('the screen editor: a graph that would make the screens show a sixth metric is a greyed-out chip; a tap on it says why', () => {
  const M = require('../src/pkjs/screens.js');
  // Default draws Graph 1's four series; Flick 1 has no forecast graph. Long would add cloud and
  // pressure (six), Sky cloud alone (five, on the spare row).
  const S = layout(['1', '1'], { provider: 'dwd', viewBody1: 'none', viewTop1: 'cal',
    secondaryLine: 'precip_prob', thirdLine: 'uv', fourthLine: 'wind', fifthLine: 'gust',
    graphStyles: stylesItem({ secondaryLine: 'cloud', thirdLine: 'pressure', fourthLine: 'off', fifthLine: 'off' },
      { secondaryLine: 'cloud', thirdLine: 'off', fourthLine: 'off', fifthLine: 'off' }, ['', 'Long', 'Sky']) });
  const p = bootGeneratedPage(S, 'emery');
  p.tapAction('openScreen', 1);
  const body = () => p.editor().querySelector('[data-se-body]').innerHTML;
  assert.deepEqual(editorAddChips(body()).filter((c) => /^(Graph 1|Long|Sky)/.test(c)), ['Graph 1', 'Long (off)', 'Sky']);
  assert.ok(body().indexOf(ui.chip('Long', { 'data-se': 'add', 'data-k': 'fc', 'data-g': 1, 'aria-disabled': 'true' },
    { icon: 'plus', dim: true })) !== -1, 'greyed out, still a tap');
  assert.equal(body().indexOf('The watch can show 5 metrics'), -1, 'no note under the chips: the Graphs tab explains the limit');
  // A tap on it says why and adds nothing.
  const toast = p.editor().querySelector('[data-se-toast]');
  p.tapEditor({ se: 'add', k: 'fc', g: 1 });
  assert.equal(M.idxOf(M.screensOf(p.S, EMERY)[1], 'fc'), -1);
  assert.equal(toast.textContent, 'Long also needs Cloud cover % and Air pressure (hPa): that makes 6 metrics on your'
    + ' screens. The watch can show 5.');
  assert.equal(toast.className, 'toast show');
  // Sky fits: on it goes, the fifth series.
  p.tapEditor({ se: 'add', k: 'fc', g: 2 });
  assert.equal(p.S.viewStyle1, '3');
  assert.match(editorRows(body()).pop(), /^Sky · /);
});

/**
 * The screen editor's Switch graph chips, as the page draws them: each label, "(off)" after a
 * greyed-out one.
 * @param {string} html The editor's body.
 * @returns {string[]}
 */
function switchChips(html) {
  const at = html.indexOf('<span class="ui-cap" id="seAdd-switch">Switch graph</span>');
  if (at === -1) { return []; }
  const group = html.slice(at, html.indexOf('</div></div>', at));
  return Array.from(group.matchAll(/<button type="button" class="ui-chip( dim)?"[^>]*data-se="switch"[^>]*>[\s\S]*?<\/svg>([^<]*)<\/button>/g))
    .map((m) => m[2] + (m[1] ? ' (off)' : ''));
}

test('the screen editor: with its forecast graph on, Switch graph offers the other graphs; a tap puts one in its place', () => {
  const M = require('../src/pkjs/screens.js');
  // Three graphs; Flick 1 draws Long over the calendar, its graph 3 rows.
  const S = layout(['1', '2'], { provider: 'dwd', forecastHours: '24', secondaryLine: 'precip_prob', thirdLine: 'off',
    viewTop1: 'cal', viewBodySize1: '3',
    graphStyles: stylesItem({ forecastHours: '48', thirdLine: 'cloud', thirdLineStyle: 'stripeTop' },
      { forecastHours: '12' }, ['', 'Long', 'Short']) });
  const p = bootGeneratedPage(S, 'emery');
  p.tapAction('openScreen', 1);
  const body = () => p.editor().querySelector('[data-se-body]').innerHTML;
  const screen = () => M.screensOf(p.S, EMERY)[1];
  const before = editorRows(body());
  assert.equal(before[M.idxOf(screen(), 'fc')], 'Long · 3 rows');
  // The graphs it does not draw, each with the swap icon; no Add chip for the forecast graph.
  assert.deepEqual(switchChips(body()), ['Graph 1', 'Short']);
  assert.ok(body().indexOf(ui.chip('Short', { 'data-se': 'switch', 'data-k': 'fc', 'data-g': 2 }, { icon: 'swap' })) !== -1);
  assert.equal(body().indexOf('data-se="add" data-k="fc"'), -1);
  // A tap: Short in Long's place, the row where it was and as big.
  p.tapEditor({ se: 'switch', k: 'fc', g: 2 });
  assert.equal(p.S.viewStyle1, '3');
  assert.deepEqual(editorRows(body()), before.map((r) => r.replace(/^Long · /, 'Short · ')));
  assert.deepEqual(switchChips(body()), ['Graph 1', 'Long']);
  // Back to the first graph: the block names no style.
  p.tapEditor({ se: 'switch', k: 'fc', g: 0 });
  assert.equal(p.S.viewStyle1, '1');
  assert.equal(screen()[M.idxOf(screen(), 'fc')].style, undefined);
  assert.deepEqual(switchChips(body()), ['Long', 'Short']);
  // A graph the screen draws, or one that does not exist, is never switched to.
  p.tapEditor({ se: 'switch', k: 'fc', g: 0 });
  p.tapEditor({ se: 'switch', k: 'fc', g: 4 });
  assert.equal(p.S.viewStyle1, '1');
  // Without its forecast graph the screen gets the Add chips back, and no Switch graph.
  p.tapEditor({ se: 'rm', j: M.idxOf(screen(), 'fc') });
  assert.deepEqual(switchChips(body()), []);
  assert.ok(editorAddChips(body()).indexOf('Short') !== -1);
  // One graph, or a watch with one: nothing to switch to.
  const one = bootGeneratedPage(layout(['1', '1'], { provider: 'dwd' }), 'emery');
  one.tapAction('openScreen', 1);
  assert.equal(one.editor().querySelector('[data-se-body]').innerHTML.indexOf('data-se="switch"'), -1);
  const b = bootGeneratedPage(TWO, 'basalt');
  b.tapAction('openScreen', 1);
  assert.equal(b.editor().querySelector('[data-se-body]').innerHTML.indexOf('data-se="switch"'), -1);
});

test('the screen editor: a graph that would make the screens show a sixth metric is a greyed-out Switch graph chip', () => {
  const M = require('../src/pkjs/screens.js');
  // Default draws Graph 1's four series; Flick 1 draws Sky (cloud: the fifth). Long would make
  // it cloud and pressure (six).
  const S = layout(['1', '3'], { provider: 'dwd', viewTop1: 'cal',
    secondaryLine: 'precip_prob', thirdLine: 'uv', fourthLine: 'wind', fifthLine: 'gust',
    graphStyles: stylesItem({ secondaryLine: 'cloud', thirdLine: 'pressure', fourthLine: 'off', fifthLine: 'off' },
      { secondaryLine: 'cloud', thirdLine: 'off', fourthLine: 'off', fifthLine: 'off' }, ['', 'Long', 'Sky']) });
  const p = bootGeneratedPage(S, 'emery');
  p.tapAction('openScreen', 1);
  const body = () => p.editor().querySelector('[data-se-body]').innerHTML;
  assert.deepEqual(switchChips(body()), ['Graph 1', 'Long (off)']);
  assert.ok(body().indexOf(ui.chip('Long', { 'data-se': 'switch', 'data-k': 'fc', 'data-g': 1, 'aria-disabled': 'true' },
    { icon: 'swap', dim: true })) !== -1, 'greyed out, still a tap');
  const toast = p.editor().querySelector('[data-se-toast]');
  p.tapEditor({ se: 'switch', k: 'fc', g: 1 });
  assert.equal(p.S.viewStyle1, '3', 'Sky stays');
  // Sky leaves the screens with the switch, so Long needs its cloud cover too.
  assert.equal(toast.textContent, 'Long also needs Cloud cover % and Air pressure (hPa): that makes 6 metrics on your'
    + ' screens. The watch can show 5.');
  // Graph 1 fits: its four series are the Default's.
  p.tapEditor({ se: 'switch', k: 'fc', g: 0 });
  assert.equal(p.S.viewStyle1, '1');
  assert.match(editorRows(body())[M.idxOf(M.screensOf(p.S, EMERY)[1], 'fc')], /^Graph 1 · /);
});

test('the page: Show on in a graph\'s dialog puts the graph on a screen or takes it off', async () => {
  // Default and Flick 1 draw graph 1, Flick 2 has no forecast graph; Long is on no screen.
  const S = layout(['1', '1', '1'], { provider: 'dwd', forecastHours: '24', viewBody2: 'none', viewTop2: 'cal',
    graphStyles: stylesItem({ forecastHours: '48', thirdLine: 'cloud', thirdLineStyle: 'stripeTop' }) });
  const p = bootGeneratedPage(S, 'emery');
  p.clickTab('graphs');
  // Graph 1: its ticks stay (a screen draws it unless it has another graph).
  p.tapAction('openGraph', 1);
  assert.deepEqual(chips(p.modal.innerHTML), [['Default', 'kept'], ['Flick 1', 'kept'], ['Flick 2', 'dim']]);
  assert.ok(p.modal.innerHTML.indexOf('Flick 2 has no forecast graph. A screen shows Graph 1 unless you give it another graph.') !== -1);
  p.doneDialog();
  p.tapAction('openGraph', 2);
  assert.deepEqual(chips(p.modal.innerHTML), [['Default', 'off'], ['Flick 1', 'off'], ['Flick 2', 'dim']]);
  p.tapAction('graphOnScreen', 1, 'modal');
  assert.equal(p.S.viewStyle1, '2', 'Flick 1 draws Long');
  assert.equal(p.S.forecastHours, '48', 'Long is still the graph on show');
  assert.deepEqual(chips(p.modal.innerHTML), [['Default', 'off'], ['Flick 1', 'on'], ['Flick 2', 'dim']]);
  p.tapAction('graphOnScreen', 2, 'modal');
  assert.equal(p.S.viewStyle2, '1', 'a screen without a forecast graph is left alone');
  p.tapAction('graphOnScreen', 1, 'modal');
  assert.equal(p.S.viewStyle1, '1', 'off again: Flick 1 draws the first graph');
  p.tapAction('graphOnScreen', 0, 'modal');
  p.doneDialog();
  assert.match(rows(p.scroll.innerHTML)[1][2], /^\d+ h · Default$/, 'the list says where it shows');
  // × puts back the screens the dialog changed.
  p.tapAction('openGraph', 2);
  p.tapAction('graphOnScreen', 1, 'modal');
  assert.equal(p.S.viewStyle1, '2');
  p.cancelDialog();
  assert.equal(p.S.viewStyle1, '1');
  p.tapAction('openGraph', 1);
  assert.deepEqual(chips(p.modal.innerHTML), [['Default', 'off'], ['Flick 1', 'kept'], ['Flick 2', 'dim']]);
  p.tapAction('graphOnScreen', 1, 'modal');
  assert.equal(p.S.viewStyle1, '1', 'the first graph\'s own tick does nothing');
  p.doneDialog();
  const blob = await p.save();
  assert.equal(blob.viewStyle0, '2');
  assert.equal(blob.viewStyle1, '1');
  assert.equal(blob.forecastHours, '24', 'the first graph back in the flat keys');
  // One graph: nothing to show on.
  const one = bootGeneratedPage(layout(['1', '1'], { provider: 'dwd' }), 'emery');
  one.clickTab('graphs');
  one.tapAction('openGraph', 1);
  assert.equal(cardTitles(one.modal.innerHTML).indexOf('Show on'), -1);
  assert.equal(one.modal.innerHTML.indexOf('ui-chip'), -1);
  // The limit: a screen that would make the screens draw a sixth series is greyed out.
  const busy = layout(['1', '1'], { provider: 'dwd',
    secondaryLine: 'precip_prob', thirdLine: 'uv', fourthLine: 'wind', fifthLine: 'gust',
    graphStyles: stylesItem({ secondaryLine: 'cloud', thirdLine: 'pressure', fourthLine: 'off', fifthLine: 'off' }) });
  const q = bootGeneratedPage(busy, 'emery');
  q.clickTab('graphs');
  q.tapAction('openGraph', 2);
  // Graph 1 draws four series on the other screen, so Long's cloud and pressure would make six
  // on either.
  assert.deepEqual(chips(q.modal.innerHTML), [['Default', 'dim'], ['Flick 1', 'dim']]);
  assert.ok(q.modal.innerHTML.indexOf('The watch can show 5 metrics across all your screens. In use: Precipitation %,'
    + ' UV Index, Wind speed, Wind gusts. Long also needs Cloud cover % and Air pressure (hPa). To make room, turn off a line'
    + ' in one of your graphs.') !== -1, 'the limit says why: what is in use, what Long adds, what to do');
  q.tapAction('graphOnScreen', 0, 'modal');
  assert.equal(q.S.viewStyle0, '1', 'a greyed-out chip does nothing');
});

/**
 * The Your graphs card's header note: how many metrics the screens use ("2/5"), its words for a
 * screen reader, and whether its '?' is on.
 * @param {string} html The page's HTML.
 * @returns {?{text: string, label: string, open: boolean}} null when the header has none
 */
function headerNote(html) {
  const m = /<span class="ttl" data-title-by="graphStyle">Your graphs<\/span><\/span><span class="hdr-note"><span aria-hidden="true">([^<]*)<\/span><span class="sr-only">([^<]*)<\/span><button type="button" class="info-q( on)?" data-info="n:graphs:graphStyle\/0" aria-expanded="(true|false)"/.exec(html);
  return m ? { text: m[1], label: m[2], open: m[4] === 'true' } : null;
}

// What the note's '?' says after the metrics active (metricsNote).
const COUNTS = '<p class="intro-more">The graphs on your screens can show 5 metrics between them, up to 4 in one graph.'
  + ' A metric in two graphs counts once, or twice when they draw it differently: as a line and as a stripe, or with all'
  + ' values and with alerts only. Temperature, the rain bars and a graph no screen shows don&#39;t count.</p>';

test('the page: Your graphs\' header counts the metrics the screens use, "2/5 metrics active"; its \'?\' says which', () => {
  // Graph 1 draws the rain chance on the Default; Long the rain chance too and the cloud stripe
  // on Flick 1: the rain chance counts once.
  const p = bootGeneratedPage(TWO, 'emery');
  p.clickTab('graphs');
  let html = p.scroll.innerHTML;
  // The count and what it counts, on the title's right (the owner's, 2026-11-09); what it
  // means waits behind the '?'.
  assert.deepEqual(headerNote(html), { text: '2/5 metrics active', label: '2 of 5 metrics active', open: false });
  assert.equal(html.indexOf('Active:'), -1);
  p.toggleInfo('n:graphs:graphStyle/0');
  html = p.scroll.innerHTML;
  assert.equal(headerNote(html).open, true);
  const info = '<div class="intro">Active: Precipitation %, Cloud cover % (stripe).' + COUNTS + '</div>';
  assert.ok(html.indexOf(info) !== -1, 'the metrics active, then what counts');
  assert.ok(html.indexOf(info) < html.indexOf('data-action="openGraph"'), 'first in the card');
  p.toggleInfo('n:graphs:graphStyle/0');
  assert.equal(p.scroll.innerHTML.indexOf('Active:'), -1, 'the \'?\' again hides it');
  // It follows the screens: Long off Flick 1 draws Graph 1 there, and a graph no screen shows
  // does not count.
  p.tapAction('openGraph', 2);
  p.tapAction('graphOnScreen', 1, 'modal');
  p.doneDialog();
  assert.equal(p.S.viewStyle1, '1');
  assert.equal(headerNote(p.scroll.innerHTML).text, '1/5 metrics active');
  // And the lines: a third metric on Long while it is back on Flick 1.
  p.tapAction('openGraph', 2);
  p.tapAction('graphOnScreen', 1, 'modal');
  p.openNestedSheet('lineThird');
  p.pickOption('fourthLine', 'gust');
  p.backDialog();
  p.doneDialog();
  assert.equal(GS.settingsFor(GSP.normalize(p.S), 1).fourthLine, 'gust', 'Long\'s');
  assert.equal(headerNote(p.scroll.innerHTML).text, '3/5 metrics active');
  // The same on a page with every info text behind a '?' (Hide info text).
  const hidden = bootGeneratedPage(Object.assign({}, TWO, { hideInfoText: true }), 'emery');
  hidden.clickTab('graphs');
  assert.deepEqual(headerNote(hidden.scroll.innerHTML), { text: '2/5 metrics active', label: '2 of 5 metrics active',
    open: false });
  // A watch without graphs of its own has no card, so no count.
  const b = bootGeneratedPage(TWO, 'basalt');
  b.clickTab('graphs');
  assert.equal(b.scroll.innerHTML.indexOf('hdr-note'), -1);
});

test('the metrics count: a line and a stripe of one metric count twice; all five active says how to make room', () => {
  const note = PC.displayResolvers.get('graphMetricsNote');
  assert.equal(note, GSP.metricsNote, 'the Your graphs card\'s note');
  const both = layout(['1', '2'], { secondaryLine: 'cloud', secondaryLineStyle: 'line', thirdLine: 'off', fourthLine: 'off',
    fifthLine: 'off', graphStyles: stylesItem({ secondaryLine: 'cloud', secondaryLineStyle: 'stripeTop' }) });
  assert.deepEqual(note(both, EMERY), { text: '2/5 metrics active', label: '2 of 5 metrics active',
    info: 'Active: Cloud cover %, Cloud cover % (stripe).' + COUNTS });
  const full = layout(['1', '2'], { secondaryLine: 'precip_prob', thirdLine: 'uv', fourthLine: 'wind', fifthLine: 'gust',
    graphStyles: stylesItem({ secondaryLine: 'cloud', thirdLine: 'off', fourthLine: 'off', fifthLine: 'off' }) });
  assert.deepEqual(note(full, EMERY), { text: '5/5 metrics active', label: '5 of 5 metrics active',
    info: 'Active: Precipitation %, UV Index, Wind speed, Wind gusts, Cloud cover %. To make room, turn off a line in one of'
      + ' your graphs.' + COUNTS });
  // All values in one graph and alerts only in another count twice, each named (the owner's,
  // 2026-11-10: each graph its own Visible values).
  const shows = layout(['1', '2'], { secondaryLine: 'uv', thirdLine: 'off', fourthLine: 'off', fifthLine: 'off',
    uvLineShow: 'all', graphStyles: stylesItem({ secondaryLine: 'uv', uvLineShow: 'alert' }) });
  assert.equal(note(shows, EMERY).info.split('.')[0], 'Active: UV Index, UV Index (alerts only)');
  // No screen with a forecast graph: nothing active.
  const none = layout(['1'], { viewBody0: 'none' });
  assert.deepEqual(note(none, EMERY), { text: '0/5 metrics active', label: '0 of 5 metrics active',
    info: 'No screen shows a forecast graph yet.' + COUNTS });
  // While the pane shows another graph (the swap), the count is the stored settings'.
  const W = Object.assign({}, full);
  GSP.swapIn(W, 1);
  assert.equal(note(W, EMERY).text, '5/5 metrics active');
  assert.equal(note(full, BASALT), null, 'a watch without graphs of its own');
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
  p.tapAction('openGraph', 2);
  p.openAllMore('modal');
  const tail = 'Every graph shares this.';
  assert.ok(p.modal.innerHTML.indexOf('Draw the graph axis labels in bigger type. ' + tail) !== -1, 'Larger graph fonts');
  assert.equal(GSP.sharedHint(layout(['1']), EMERY), '', 'one style: no tail');
  assert.equal(GSP.sharedHint(TWO, BASALT), '', 'a watch without styles: none');
  const one = bootGeneratedPage(layout(['1'], { provider: 'dwd' }), 'emery');
  one.clickTab('graphs');
  one.tapAction('openGraph', 1);
  one.openAllMore('modal');
  assert.ok(one.modal.innerHTML.indexOf('Draw the graph axis labels in bigger type.') !== -1);
  assert.equal(one.modal.innerHTML.indexOf(tail), -1);
});

test('the card\'s lead: with one graph what New graph is for; with more the rows speak for themselves', () => {
  assert.equal(GSP.cardHint(TWO), '');
  assert.equal(GSP.cardHint(layout(['1', '1'])), 'New graph gives a screen a graph of its own.');
});
