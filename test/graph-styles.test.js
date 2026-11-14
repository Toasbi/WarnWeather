'use strict';
// test/graph-styles.test.js — the graph styles' model (src/pkjs/forecast-graphs/domain/graph-styles.js): the stored
// item, a style's settings, which styles the screens show, and how the shown styles' series
// share the weather message's four rows. Its wire (the records, the bake) is
// test/graph-style-wire.test.js'.
const test = require('node:test');
const assert = require('node:assert/strict');

const GS = require('../src/pkjs/forecast-graphs/domain/graph-styles.js');
const VC = require('../src/pkjs/layout/domain/view-cycle.js');
const screens = require('../src/pkjs/layout/domain/screens.js');
const lineStyle = require('../src/pkjs/forecast-graphs/domain/line-style.js');
const wizardForecast = require('../src/pkjs/page/settings/wizard/wizard-forecast.js');
const platform = require('../src/pkjs/config-ui/lib/platform.js');

const EMERY = platform.computeEnv({ platform: 'emery' });
const BASALT = platform.computeEnv({ platform: 'basalt' });
const UNKNOWN = platform.computeEnv(null);

/**
 * The graphStyles item for styles 2 and 3.
 * @param {?Object} two Style 2's values, or null.
 * @param {?Object} [three] Style 3's values, or null.
 * @param {string[]} [names] The three names.
 * @returns {string}
 */
function stylesItem(two, three, names) {
  return JSON.stringify({ names: names || ['', '', ''], styles: [null, two || null, three || null] });
}

/**
 * Custom-layout settings: one screen per entry, each a forecast-graph screen on that style
 * ('1' | '2' | '3'), or 'radar' for a screen without the forecast.
 * @param {string[]} views One entry per screen.
 * @param {Object} [over] More settings.
 * @returns {Object}
 */
function layout(views, over) {
  const S = { layoutPreset: 'custom', radarMode: 'graph', healthMode: 'off', viewCount: String(views.length) };
  views.forEach((v, i) => {
    S['viewTop' + i] = i === 0 ? 'cal' : 'none';
    S['viewBody' + i] = v === 'radar' ? 'radar' : 'forecast';
    if (v !== 'radar') { S['viewStyle' + i] = v; }
  });
  return Object.assign(S, over || {});
}

test('the governed keys: setup\'s look keys, the shading, the length, Visible values and every graph colour', () => {
  wizardForecast.KEYS.forEach((k) => assert.ok(GS.GOVERNED.includes(k), k));
  ['dayNightShading', 'forecastHours', 'windLineShow', 'gustLineShow', 'uvLineShow'].forEach((k) => assert.ok(GS.GOVERNED.includes(k), k));
  lineStyle.graphColorKeys().forEach((k) => assert.ok(GS.GOVERNED.includes(k), k));
  // Setup's looks set every governed key but the length (its own picker), the lines' Visible
  // values (each graph its own, the owner's, 2026-11-10) and the colours: a look leaves them.
  const shows = ['windLineShow', 'gustLineShow', 'uvLineShow'];
  assert.deepEqual(GS.GOVERNED.filter((k) => !wizardForecast.KEYS.includes(k)),
    ['forecastHours'].concat(shows, lineStyle.graphColorKeys()));
  assert.ok(wizardForecast.KEYS.includes('dayNightShading'), 'the looks set the night shading');
  assert.equal(new Set(GS.GOVERNED).size, GS.GOVERNED.length, 'each once');
  GS.SHARED.forEach((k) => assert.equal(GS.GOVERNED.includes(k), false, k + ' is shared, not governed'));
  assert.deepEqual(GS.SHARED, ['windScale', 'pressureScale', 'forecastAxisScale', 'largeGraphFont']);
});

/**
 * @param {Array} head The first entries.
 * @param {*} fill What the rest hold.
 * @returns {Array} head, filled up to GS.MAX_STYLES entries
 */
function upToMax(head, fill) {
  return head.concat(Array(GS.MAX_STYLES - head.length).fill(fill));
}

/**
 * A parsed style or look list: the six, then the template graphs (graph-styles.js TEMPLATE
 * GRAPHS).
 * @param {Array} head The first entries.
 * @param {*} fill The rest's value.
 * @returns {Array}
 */
function upToAll(head, fill) {
  return head.concat(Array(GS.ALL_STYLES - head.length).fill(fill));
}

test('parse: the names and the styles, the first always the flat keys; a bad item is none', () => {
  assert.equal(GS.MAX_STYLES, 6, 'six graphs to switch between');
  const none = { names: upToMax([], ''), styles: upToAll([], null), looks: upToAll([], '') };
  assert.deepEqual(GS.parse({}), none);
  assert.deepEqual(GS.parse({ graphStyles: '{not json' }), none);
  assert.deepEqual(GS.parse({ graphStyles: '[1,2]' }).styles, none.styles, 'an array is no item');
  const S = { graphStyles: stylesItem({ forecastHours: '48' }, null, ['Mine', 'Long', 7]) };
  assert.deepEqual(GS.parse(S), { names: upToMax(['Mine', 'Long'], ''),
    styles: upToAll([null, { forecastHours: '48' }], null), looks: upToAll([], '') }, 'an item stored with three slots reads');
  assert.deepEqual(GS.parse({ graphStyles: { styles: [{ x: 1 }, 'no', { y: 2 }] } }).styles,
    upToAll([null, null, { y: 2 }], null), 'an object item reads too; the first slot is never a style of its own');
  const six = { graphStyles: JSON.stringify({ names: upToMax([], ''),
    styles: [null, {}, {}, {}, {}, { forecastHours: '12' }, { forecastHours: '24' }] }) };
  assert.equal(GS.count(six), 6, 'six styles');
  assert.equal(GS.exists(six, 5), true);
  assert.equal(GS.exists(six, 6), false, 'none past the sixth: a template graph names its template');
  assert.equal(GS.name(six, 5), 'Graph 6');
  assert.equal(GS.count({}), 1);
  assert.equal(GS.count(S), 2);
  assert.equal(GS.count({ graphStyles: stylesItem(null, {}) }), 2, 'style 3 without style 2');
  assert.deepEqual([GS.exists(S, 0), GS.exists(S, 1), GS.exists(S, 2), GS.exists(S, 3)], [true, true, false, false]);
  assert.deepEqual([GS.name(S, 0), GS.name(S, 1), GS.name(S, 2)], ['Mine', 'Long', 'Graph 3']);
});

test('settingsFor: the style\'s governed values over the flat keys; the first style is S itself', () => {
  const S = { secondaryLine: 'precip_prob', forecastHours: '24', windScale: 'low', theme: 'dark',
    graphStyles: stylesItem({ forecastHours: '48', thirdLine: 'cloud', windScale: 'high', theme: 'light' }) };
  assert.equal(GS.settingsFor(S, 0), S);
  assert.equal(GS.settingsFor(S, 2), S, 'a style that does not exist reads as the first');
  const two = GS.settingsFor(S, 1);
  assert.notEqual(two, S);
  assert.equal(two.forecastHours, '48');
  assert.equal(two.thirdLine, 'cloud');
  assert.equal(two.secondaryLine, 'precip_prob', 'a key the style holds no value of: the first style\'s');
  assert.equal(two.windScale, 'low', 'a shared key stays one setting');
  assert.equal(two.theme, 'dark', 'and so does everything off the graph');
  assert.equal(S.forecastHours, '24', 'S is not touched');
});

test('wireCycle: a view keeps its style only on a watch with styles, where the style exists', () => {
  const S = layout(['1', '2', '3'], { graphStyles: stylesItem({}) });
  const cycle = VC.resolveViewCycle(S, EMERY);
  assert.deepEqual(cycle.map((v) => v.graphStyle || 0), [0, 1, 2], 'the compiler carries viewStyle');
  assert.deepEqual(GS.wireCycle(S, EMERY, cycle).map((v) => v.graphStyle || 0), [0, 1, 0],
    'style 3 does not exist');
  [BASALT, UNKNOWN].forEach((env) =>
    assert.deepEqual(GS.wireCycle(S, env, cycle).map((v) => v.graphStyle || 0), [0, 0, 0], env.platform));
  assert.equal(cycle[1].graphStyle, 1, 'the cycle itself is left as it was');
});

test('slotsFor: a shown style 1 to 3 keeps its slot, a style 4 to 6 takes a free one', () => {
  assert.deepEqual(GS.slotsFor([0, 1, 2]), { 0: 0, 1: 1, 2: 2 }, 'three graphs or fewer: as before');
  assert.deepEqual(GS.slotsFor([1]), { 1: 1 });
  assert.deepEqual(GS.slotsFor([0, 4, 5]), { 0: 0, 4: 1, 5: 2 });
  assert.deepEqual(GS.slotsFor([1, 3]), { 1: 1, 3: 0 }, 'the first slot is free');
  assert.deepEqual(GS.slotsFor([2, 4, 5]), { 2: 2, 4: 0, 5: 1 });
  assert.deepEqual(GS.slotsFor([3, 4, 5]), { 3: 0, 4: 1, 5: 2 });
  assert.deepEqual(GS.slotsFor([0, 1, 2, 3]), { 0: 0, 1: 1, 2: 2 }, 'never more than the watch keeps');
  assert.deepEqual(GS.slotsFor([]), {});
});

test('wireCycle: graphs 4 to 6 reach the watch in the slots the shown graphs leave free', () => {
  const six = JSON.stringify({ names: ['', '', '', '', '', ''], styles: [null, {}, {}, {}, {}, {}] });
  const S = layout(['1', '5', '6'], { graphStyles: six });
  const cycle = VC.resolveViewCycle(S, EMERY);
  assert.deepEqual(cycle.map((v) => v.graphStyle || 0), [0, 4, 5], 'the compiler carries the graph');
  assert.deepEqual(GS.stylesShown(S, EMERY), [0, 4, 5], 'shown, by graph');
  const wired = GS.wireCycle(S, EMERY, cycle);
  assert.deepEqual(wired.map((v) => v.graphStyle || 0), [0, 1, 2], 'sent, by slot');
  assert.deepEqual(wired.map((v) => VC.packExt(v) >> 9), [0, 1, 2], 'the view words name the slots');
  assert.equal(cycle[1].graphStyle, 4, 'the cycle itself is left as it was');
  const two = layout(['2', '4'], { graphStyles: six });
  assert.deepEqual(GS.wireCycle(two, EMERY, VC.resolveViewCycle(two, EMERY)).map((v) => v.graphStyle || 0),
    [1, 0], 'graph 4 takes the first slot, which no shown graph needs');
  assert.deepEqual(GS.wireCycle(S, BASALT, VC.resolveViewCycle(S, BASALT)).map((v) => v.graphStyle || 0),
    [0, 0, 0], 'no styles off emery');
  assert.equal(VC.packExt(cycle[2]) >> 9, 0, 'a spec still naming graph 6 packs the first slot, never another');
});

test('the view word carries the style on emery only, and only on a view with the forecast', () => {
  const S = layout(['2', 'radar'], { graphStyles: stylesItem({}), viewStyle1: '2' });
  const cycle = VC.resolveViewCycle(S, EMERY);
  assert.equal(cycle[0].graphStyle, 1);
  assert.equal(cycle[1].graphStyle, undefined, 'a radar screen draws no forecast style');
  assert.equal(VC.packExt(GS.wireCycle(S, EMERY, cycle)[0]) >> 9, 1);
  assert.equal(VC.packExt(GS.wireCycle(S, BASALT, VC.resolveViewCycle(S, BASALT))[0]), 0,
    'basalt\'s word is today\'s');
  // A forecast graph on top carries it too.
  const top = layout(['1'], { viewTop0: 'forecast', viewBody0: 'radar', viewStyle0: '3',
    graphStyles: stylesItem({}, {}) });
  assert.equal(VC.resolveViewCycle(top, EMERY)[0].graphStyle, 2);
});

test('screens: the forecast block names its style, a moved screen keeps it', () => {
  const S = layout(['1', '2'], { graphStyles: stylesItem({}) });
  const lists = screens.screensOf(S, EMERY);
  assert.equal(lists[0].find((b) => b.k === 'fc').style, undefined, 'the first style is no field');
  assert.equal(lists[1].find((b) => b.k === 'fc').style, '2');
  // The second screen compiled into the first slot keeps its style.
  const keys = screens.compileKeys(lists[1], 0);
  assert.equal(keys.viewStyle0, '2');
  assert.equal(screens.compileKeys(lists[0], 1).viewStyle1, '1', 'a screen without one writes the first');
  assert.equal(screens.compileKeys([{ k: 'strip' }, { k: 'clock' }], 2).viewStyle2, '1', 'no forecast: the first');
  // specToKeys inverts it.
  assert.equal(VC.specToKeys(VC.resolveViewCycle(S, EMERY)).viewStyle1, '2');
});

test('stylesShown / stylesSent: the forecast graphs\' styles; nothing is sent while only the first shows', () => {
  const two = { graphStyles: stylesItem({ forecastHours: '48' }, { forecastHours: '12' }) };
  assert.deepEqual(GS.stylesShown(layout(['1', '1'], two), EMERY), [0]);
  assert.deepEqual(GS.stylesSent(layout(['1', '1'], two), EMERY), []);
  assert.deepEqual(GS.stylesShown(layout(['3', '1', '3'], two), EMERY), [0, 2]);
  assert.deepEqual(GS.stylesSent(layout(['3', '1', '3'], two), EMERY), [0, 2]);
  assert.deepEqual(GS.stylesSent(layout(['2'], two), EMERY), [1], 'the first style need not be shown');
  assert.deepEqual(GS.stylesShown(layout(['radar'], two), EMERY), [], 'no forecast graph: no style');
  assert.deepEqual(GS.stylesSent(layout(['2', '3'], two), BASALT), [], 'basalt: one look');
  assert.deepEqual(GS.stylesSent(layout(['2', '3'], two), UNKNOWN), [], 'an unknown watch: one look');
  assert.deepEqual(GS.stylesSent(layout(['2', '3'], {}), EMERY), [], 'styles that do not exist are the first');
  assert.deepEqual(GS.stylesSent(Object.assign(layout(['2']), two, { layoutPreset: 'compactCal' }), EMERY), [],
    'a preset layout has no styles');
});

test('seriesOf: each line\'s effective metric, whether it is a stripe and whether it shows alerts only', () => {
  const S = { secondaryLine: 'precip_prob', secondaryLineStyle: 'stripeBottom', thirdLine: 'precip_prob',
    fourthLine: 'feels', fourthLineStyle: 'stripeTop', fifthLine: 'off' };
  assert.deepEqual(GS.seriesOf(S, EMERY), [{ metric: 'precip_prob', stripe: true, alert: false }, null,
    { metric: 'feels', stripe: false, alert: false }, null], 'a repeat draws nothing; feels-like is never a stripe');
  assert.deepEqual(GS.seriesOf(S, platform.computeEnv({ platform: 'aplite' }))[0],
    { metric: 'precip_prob', stripe: false, alert: false }, 'no stripes where the watch draws no styles');
  // Visible values: Alert marks the series (each graph's own, the owner's, 2026-11-10); a watch
  // without Alert settings draws every line with all its values.
  const W = { secondaryLine: 'wind', thirdLine: 'uv', thirdLineStyle: 'stripeTop', fourthLine: 'off', fifthLine: 'off',
    windLineShow: 'alert', uvLineShow: 'alert' };
  assert.deepEqual(GS.seriesOf(W, EMERY).slice(0, 2), [{ metric: 'wind', stripe: false, alert: true },
    { metric: 'uv', stripe: true, alert: true }]);
  assert.equal(GS.seriesOf(W, platform.computeEnv({ platform: 'aplite' }))[0].alert, false, 'aplite: always All');
  assert.equal(GS.sameSeries({ metric: 'wind', stripe: false, alert: true }, { metric: 'wind', stripe: false, alert: false }),
    false, 'All and Alert of one metric: two series');
  assert.equal(GS.sameSeries({ metric: 'wind', stripe: false, alert: false }, { metric: 'wind', stripe: false }), true,
    'a series without the flag reads All');
});

test('assign: the first style keeps its rows, a shared series one row, a line and a stripe two', () => {
  const S = {
    secondaryLine: 'precip_prob', thirdLine: 'uv', fourthLine: 'off', fifthLine: 'off',
    graphStyles: stylesItem(
      { secondaryLine: 'cloud', secondaryLineStyle: 'stripeTop', thirdLine: 'precip_prob', thirdLineStyle: 'stripeTop',
        fourthLine: 'uv', fifthLine: 'off' },
      { secondaryLine: 'uv', thirdLine: 'off', fourthLine: 'off', fifthLine: 'precip_prob' })
  };
  const u = GS.assign(S, EMERY, [0, 1, 2]);
  assert.deepEqual(u.rows, [{ metric: 'precip_prob', stripe: false, alert: false }, { metric: 'uv', stripe: false, alert: false },
    { metric: 'cloud', stripe: true, alert: false }, { metric: 'precip_prob', stripe: true, alert: false }, null],
  'four series: no spare');
  assert.deepEqual(u.maps[0], [1, 2, 0, 0], 'the first style: its own rows');
  assert.deepEqual(u.maps[1], [3, 4, 2, 0], 'the rain chance as a stripe takes a row of its own');
  assert.deepEqual(u.maps[2], [2, 0, 0, 1], 'uv and the rain-chance line read the first style\'s rows');
  // Without the first style, style 2 keeps its own rows where they are free.
  const alone = GS.assign(S, EMERY, [1]);
  assert.deepEqual(alone.maps[1], [1, 2, 3, 0]);
  // A fifth series takes the spare row, no line's own; a sixth is dropped: its line reads no row.
  const five = Object.assign({}, S, { fourthLine: 'wind', fifthLine: 'gust' });
  const over = GS.assign(five, EMERY, [0, 1]);
  assert.deepEqual(over.maps[0], [1, 2, 3, 4]);
  assert.deepEqual(over.maps[1], [5, 0, 2, 0], 'the cloud stripe takes the spare, the rain-chance stripe finds no row');
  assert.deepEqual(over.rows[4], { metric: 'cloud', stripe: true, alert: false });
  assert.equal(over.rows.length, GS.ROWS);
  assert.equal(GS.ROWS, GS.TRENDS + 1, 'a row per line, and the spare');
  // The spare is the last free row: a style keeps its own line's row while it is free.
  assert.deepEqual(GS.assign(five, EMERY, [1]).maps[1], [1, 2, 3, 0], 'alone, style 2 needs no spare');
  // UV with all its values in one style and alerts only in another: two rows (the owner's,
  // 2026-11-10: "count it as an additional metric"); alerts only in both: one.
  const mixed = Object.assign({}, S, { graphStyles: stylesItem({ secondaryLine: 'uv', thirdLine: 'off', fourthLine: 'off',
    fifthLine: 'off', uvLineShow: 'alert' }) });
  const m = GS.assign(mixed, EMERY, [0, 1]);
  assert.deepEqual(m.maps[1], [3, 0, 0, 0], 'the Alert UV takes a row of its own');
  assert.deepEqual(m.rows[2], { metric: 'uv', stripe: false, alert: true });
  assert.deepEqual(GS.assign(Object.assign({}, mixed, { uvLineShow: 'alert' }), EMERY, [0, 1]).maps[1], [2, 0, 0, 0],
    'both Alert: one row');
});

test('the write helpers: a style\'s values, the item written back, a free slot, delete with its screens', () => {
  const S = layout(['1', '2', '3'], { forecastHours: '24', thirdLine: 'uv',
    graphStyles: stylesItem({ forecastHours: '48' }, { thirdLine: 'cloud' }, ['', 'Long', 'Cloudy']) });
  const two = GS.valuesOf(S, 1);
  assert.equal(two.forecastHours, '48');
  assert.equal(two.thirdLine, 'uv', 'a key the style holds no value of: the first style\'s');
  assert.deepEqual(Object.keys(two).filter((k) => !GS.GOVERNED.includes(k)), [], 'governed keys only');
  assert.equal(GS.freeSlot(S), 3, 'three styles: the fourth is free');
  const full = { graphStyles: JSON.stringify({ names: upToMax([], ''), styles: [null, {}, {}, {}, {}, {}] }) };
  assert.equal(GS.freeSlot(full), -1, 'six styles: no slot');
  const moved = Object.assign({}, S);
  assert.deepEqual(GS.deleteStyle(moved, 1), [1], 'the screen that drew it');
  assert.equal(moved.viewStyle1, '1', 'draws the first style');
  assert.equal(moved.viewStyle2, '3', 'style 3 keeps its slot');
  assert.deepEqual(GS.parse(moved).names, upToMax(['', '', 'Cloudy'], ''), 'the name goes with it');
  assert.equal(GS.freeSlot(moved), 1);
  assert.equal(GS.name(moved, 2), 'Cloudy');
  assert.deepEqual(GS.deleteStyle(moved, 0), [], 'never the first style');
  // The item written back: '' once it holds nothing, so an install that makes a style and
  // deletes it again stores what it had.
  GS.deleteStyle(moved, 2);
  assert.equal(moved.graphStyles, '');
  assert.equal(GS.withName({}, 0, 'Mine'), JSON.stringify({ names: upToMax(['Mine'], ''), styles: upToMax([], null) }),
    'a name alone is kept');
  const w = GS.withStyle({}, 2, { forecastHours: '12' });
  assert.deepEqual(GS.parse({ graphStyles: w }).styles, upToAll([null, null, { forecastHours: '12' }], null));
  const w6 = GS.withStyle({}, 5, { forecastHours: '24' });
  assert.deepEqual(GS.parse({ graphStyles: w6 }).styles[5], { forecastHours: '24' }, 'the sixth style is stored');
  assert.equal(GS.withStyle({ graphStyles: w }, 0, { x: 1 }), w, 'the first style has no stored values');
});

test('template graphs: after the six, a screen names one by its template; never one of the six', () => {
  assert.deepEqual([GS.TEMPLATES, GS.ALL_STYLES], [3, 9], 'one per screen, after the six');
  assert.deepEqual([5, 6, 8, 9].map(GS.isTemplate), [false, true, true, false]);
  // Written: its values and the template they were made from; an item without one stores as before.
  const plain = stylesItem({ forecastHours: '48' });
  const S = layout(['2', '1'], { secondaryLine: 'precip_prob', graphStyles: plain });
  assert.equal(GS.withStyle(S, 1, { forecastHours: '48' }), JSON.stringify({ names: upToMax([], ''),
    styles: upToMax([null, { forecastHours: '48' }], null) }), 'no template graph: the item as before');
  S.graphStyles = GS.withTemplate(S, 6, 'outdoor', { secondaryLine: 'uv', forecastHours: '24' });
  assert.deepEqual(JSON.parse(S.graphStyles).looks, upToAll(['', '', '', '', '', '', 'outdoor'], ''));
  assert.deepEqual([GS.exists(S, 6), GS.lookOf(S, 6), GS.lookOf(S, 1), GS.exists(S, 7)], [true, 'outdoor', '', false]);
  assert.equal(GS.settingsFor(S, 6).secondaryLine, 'uv', 'read as a style is');
  assert.deepEqual([GS.count(S), GS.freeSlot(S)], [2, 2], 'never one of the six');
  // A screen names it 't1': the compiler, the screens' list and the keys carry it.
  assert.equal(GS.freeTemplate(S), 6, 'no screen names it yet');
  S.viewStyle1 = 't1';
  assert.equal(GS.freeTemplate(S), 7);
  const cycle = VC.resolveViewCycle(S, EMERY);
  assert.deepEqual(cycle.map((v) => v.graphStyle || 0), [1, 6]);
  assert.equal(screens.screensOf(S, EMERY)[1].find((b) => b.k === 'fc').style, 't1');
  assert.equal(VC.specToKeys(cycle).viewStyle1, 't1');
  assert.equal(screens.compileKeys(screens.screensOf(S, EMERY)[1], 0).viewStyle0, 't1', 'a moved screen keeps it');
  // Shown and sent as a style is, in a slot the shown styles leave free.
  assert.deepEqual(GS.stylesShown(S, EMERY), [1, 6]);
  assert.deepEqual(GS.stylesSent(S, EMERY), [1, 6]);
  assert.deepEqual(GS.wireCycle(S, EMERY, cycle).map((v) => VC.packExt(v) >> 9), [1, 0]);
  assert.deepEqual([1, 6].map((k) => GS.assign(S, EMERY, [1, 6]).maps[k]), [[1, 0, 0, 0], [2, 0, 0, 0]],
    'its UV takes a row of its own, in the union as a style\'s would');
  // No screen names it: it is dropped, and a deleted screen leaves nothing behind.
  assert.equal(GS.pruneTemplates(S), S.graphStyles, 'named: kept');
  S.viewCount = '1';
  assert.equal(GS.pruneTemplates(S), GS.stringify(GS.parse({ graphStyles: plain })),
    'the screen gone: the item as it was before');
  assert.equal(GS.pruneTemplates(layout(['1'])), '', 'nothing to drop');
  // A template graph without its template is none.
  const bare = JSON.stringify({ names: [], styles: upToAll([], null).map((v, k) => (k === 6 ? {} : v)) });
  assert.equal(GS.exists({ graphStyles: bare }, 6), false);
});

test('rowsNeeded: the distinct series the styles draw between them', () => {
  const a = { secondaryLine: 'precip_prob', thirdLine: 'uv', fourthLine: 'off', fifthLine: 'off' };
  const b = { secondaryLine: 'precip_prob', thirdLine: 'cloud', fourthLine: 'off', fifthLine: 'off' };
  assert.equal(GS.rowsNeeded([a], EMERY), 2);
  assert.equal(GS.rowsNeeded([a, b], EMERY), 3, 'the shared rain chance once');
  assert.equal(GS.rowsNeeded([a, Object.assign({}, b, { secondaryLineStyle: 'stripeTop' })], EMERY), 4,
    'a line and a stripe of one metric: two');
  const full = { secondaryLine: 'precip_prob', thirdLine: 'uv', fourthLine: 'wind', fifthLine: 'gust' };
  assert.equal(GS.rowsNeeded([full, b], EMERY), GS.ROWS, 'four lines and another graph\'s cloud: the spare row\'s fifth');
  assert.equal(GS.rowsNeeded([a, Object.assign({}, a, { uvLineShow: 'alert' })], EMERY), 3,
    'UV with all values and with alerts only: two');
});
