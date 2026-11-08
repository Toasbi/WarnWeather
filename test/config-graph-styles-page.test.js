'use strict';
// test/config-graph-styles-page.test.js — graph styles on the settings page
// (src/pkjs/settings/graph-styles-page.js, Pebble Time 2): the swap that puts the picked style's
// values in the flat keys on Graphs › Forecast and the first style's everywhere else, the
// settings as Save stores them, the Graph style card (its options, New style, Rename, Delete with
// Undo) and the four-series limit. The module first, then the REAL generated page
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

test('the card\'s options: each style named with its length, where it shows under it', () => {
  const opts = GSP.styleOptions(TWO, EMERY);
  assert.deepEqual(opts.map((o) => o[1]), ['1', '2']);
  assert.equal(opts[0][0], 'Graph style 1 · 24 h');
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
});

test('the page: the card sits above the pinned preview on emery only', () => {
  const p = bootGeneratedPage(TWO, 'emery');
  p.clickTab('graphs');
  const html = p.scroll.innerHTML;
  assert.ok(html.indexOf('data-select="graphStylePick"') !== -1, 'the style select');
  assert.ok(html.indexOf('data-select="graphStylePick"') < html.indexOf('class="pin"'), 'above the pinned preview');
  assert.ok(html.indexOf('pane-seg') < html.indexOf('data-select="graphStylePick"'), 'under the pane switcher');
  assert.ok(html.indexOf('data-edit-sheet="graphStyleRename"') !== -1, 'Rename');
  assert.ok(html.indexOf('data-select="graphStyleNewFrom"') !== -1, 'New style');
  assert.equal(html.indexOf('data-action="deleteGraphStyle"'), -1, 'no Delete on the first style');
  const b = bootGeneratedPage(TWO, 'basalt');
  b.clickTab('graphs');
  assert.equal(b.scroll.innerHTML.indexOf('graphStylePick'), -1, 'basalt: one look, no card');
});

test('the page: picking a style edits it; Save stores it in graphStyles and the first style in the flat keys', async () => {
  const p = bootGeneratedPage(TWO, 'emery');
  p.clickTab('graphs');
  p.openSelect('graphStylePick');
  p.pickOption('graphStylePick', '2');
  assert.equal(p.S.forecastHours, '48', 'Long\'s length in the Forecast length row');
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
  p.openSelect('graphStylePick');
  p.pickOption('graphStylePick', '2');
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

test('the page: New style from a look or as a copy, picked at once; a fourth is not offered', async () => {
  const p = bootGeneratedPage(TWO, 'emery');
  p.clickTab('graphs');
  p.openSelect('graphStyleNewFrom');
  assert.match(p.modal.innerHTML, /Start the new style from/);
  assert.match(p.modal.innerHTML, /Copy of Graph style 1/);
  assert.equal(p.modal.innerHTML.indexOf('ssel-chk'), -1, 'nothing ticked');
  p.pickOption('graphStyleNewFrom', 'classic');
  assert.equal(p.S.graphStylePick, '3', 'the new style takes the free slot and is picked');
  assert.equal(GS.name(GSP.normalize(p.S), 2), 'Classic');
  assert.equal(p.S.forecastHours, '24', 'the look\'s length, in the flat keys while it shows');
  assert.equal(p.S.thirdLine, 'uv', 'the look\'s lines');
  assert.equal(p.S.graphStyleNewFrom, '', 'the picker is cleared');
  assert.equal(p.scroll.innerHTML.indexOf('data-select="graphStyleNewFrom"'), -1, 'three styles: no New style');
  const blob = await p.save();
  assert.equal(GS.count(blob), 3);
  assert.equal(blob.thirdLine, 'off', 'the first style is untouched');
});

test('the page: Rename names the picked style; × keeps the old name', () => {
  const p = bootGeneratedPage(TWO, 'emery');
  p.clickTab('graphs');
  p.openSelect('graphStylePick');
  p.pickOption('graphStylePick', '2');
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
  assert.match(p.scroll.innerHTML, /Weekend · \d+ h/, 'the select shows the new name');
  p.openEditSheet('graphStyleRename');
  type('Other');
  p.cancelDialog();
  assert.equal(GS.name(p.S, 1), 'Weekend', '× puts the name back');
});

test('the page: Delete moves its screens to the first style; Undo brings both back', () => {
  const p = bootGeneratedPage(TWO, 'emery');
  p.clickTab('graphs');
  p.openSelect('graphStylePick');
  p.pickOption('graphStylePick', '2');
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

test('the screen editor: the forecast row picks the screen\'s style and links to it on the Graphs tab', () => {
  const M = require('../src/pkjs/screens.js');
  const p = bootGeneratedPage(TWO, 'emery');
  p.tapAction('openScreen', 1);
  const j = M.idxOf(M.screensOf(p.S, EMERY)[1], 'fc');
  p.tapEditor({ se: 'expand', j });
  const body = () => p.editor().querySelector('[data-se-body]').innerHTML;
  assert.match(body(), /Graph style<\/span><button type="button" class="se-pick" data-se="style"/);
  assert.match(body(), /<span>Long · \d+ h<\/span>/, 'the screen\'s style, named with its length');
  assert.match(body(), /Edit Long on the Graphs tab ›/);
  // The picker: the page's select sheet over the editor.
  p.tapEditor({ se: 'style', j });
  assert.match(p.modal.innerHTML, /Graph style 1 · 24 h/);
  assert.match(p.modal.innerHTML, /On Default/);
  p.pickOption('screenGraphStyle', '1');
  assert.equal(p.S.viewStyle1, '1', 'Flick 1 draws the first style');
  assert.match(body(), /<span>Graph style 1 · 24 h<\/span>/, 'the editor repaints');
  p.tapEditor({ se: 'style', j });
  p.pickOption('screenGraphStyle', '2');
  assert.equal(p.S.viewStyle1, '2');
  // The link: the Graphs tab, on that style.
  p.tapEditor({ se: 'editstyle', j });
  assert.equal(p.editor(), null, 'the editor closes');
  assert.equal(p.S.graphStylePick, '2');
  assert.equal(p.S.forecastHours, '48', 'Graphs › Forecast shows Long');
  assert.ok(p.scroll.innerHTML.indexOf('data-select="graphStylePick"') !== -1, 'on the Graphs tab');
  // basalt: no Graph style row.
  const b = bootGeneratedPage(TWO, 'basalt');
  b.tapAction('openScreen', 0);
  b.tapEditor({ se: 'expand', j: M.idxOf(M.screensOf(b.S, BASALT)[0], 'fc') });
  assert.equal(b.editor().querySelector('[data-se-body]').innerHTML.indexOf('data-se="style"'), -1);
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

test('a shared row says every graph style shares it, while more than one style exists', () => {
  const p = bootGeneratedPage(TWO, 'emery');
  p.clickTab('graphs');
  p.openAllMore();
  const tail = 'Every graph style shares this.';
  assert.ok(p.scroll.innerHTML.indexOf('Draw the graph axis labels in bigger type. ' + tail) !== -1, 'Larger graph fonts');
  assert.equal(GSP.sharedHint(layout(['1']), EMERY), '', 'one style: no tail');
  assert.equal(GSP.sharedHint(TWO, BASALT), '', 'a watch without styles: none');
  const one = bootGeneratedPage(layout(['1'], { provider: 'dwd' }), 'emery');
  one.clickTab('graphs');
  one.openAllMore();
  assert.equal(one.scroll.innerHTML.indexOf(tail), -1);
});

test('the card\'s hint: where the picked style shows, and what the card is for', () => {
  assert.equal(GSP.cardHint(TWO, EMERY), 'On Default. The settings below are this style\'s.');
  assert.equal(GSP.cardHint(Object.assign({}, TWO, { graphStylePick: '2' }), EMERY),
    'On Flick 1. The settings below are this style\'s.');
  assert.equal(GSP.cardHint(layout(['1', '1']), EMERY), 'On Default and Flick 1. New style gives a screen its own graph.');
});
