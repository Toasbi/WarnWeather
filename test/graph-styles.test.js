'use strict';
// test/graph-styles.test.js — the graph styles' model (src/pkjs/graph-styles.js): the stored
// item, a style's settings, which styles the screens show, and how the shown styles' series
// share the weather message's four rows. Its wire (the records, the bake) is
// test/graph-style-wire.test.js'.
const test = require('node:test');
const assert = require('node:assert/strict');

const GS = require('../src/pkjs/graph-styles.js');
const VC = require('../src/pkjs/view-cycle.js');
const screens = require('../src/pkjs/screens.js');
const lineStyle = require('../src/pkjs/line-style.js');
const wizardForecast = require('../src/pkjs/settings/wizard-forecast.js');
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

test('the governed keys: setup\'s look keys, the shading, the length and every graph colour', () => {
  wizardForecast.KEYS.forEach((k) => assert.ok(GS.GOVERNED.includes(k), k));
  ['dayNightShading', 'forecastHours'].forEach((k) => assert.ok(GS.GOVERNED.includes(k), k));
  lineStyle.graphColorKeys().forEach((k) => assert.ok(GS.GOVERNED.includes(k), k));
  // Setup's looks set every governed key but the length (its own picker) and the colours.
  assert.deepEqual(GS.GOVERNED.filter((k) => !wizardForecast.KEYS.includes(k)),
    ['forecastHours'].concat(lineStyle.graphColorKeys()));
  assert.ok(wizardForecast.KEYS.includes('dayNightShading'), 'the looks set the night shading');
  assert.equal(new Set(GS.GOVERNED).size, GS.GOVERNED.length, 'each once');
  GS.SHARED.forEach((k) => assert.equal(GS.GOVERNED.includes(k), false, k + ' is shared, not governed'));
  assert.deepEqual(GS.SHARED, ['windScale', 'pressureScale', 'windLineShow', 'gustLineShow', 'uvLineShow',
    'forecastAxisScale', 'largeGraphFont']);
});

test('parse: the names and the styles, the first always the flat keys; a bad item is none', () => {
  assert.deepEqual(GS.parse({}), { names: ['', '', ''], styles: [null, null, null] });
  assert.deepEqual(GS.parse({ graphStyles: '{not json' }), { names: ['', '', ''], styles: [null, null, null] });
  assert.deepEqual(GS.parse({ graphStyles: '[1,2]' }).styles, [null, null, null], 'an array is no item');
  const S = { graphStyles: stylesItem({ forecastHours: '48' }, null, ['Mine', 'Long', 7]) };
  assert.deepEqual(GS.parse(S), { names: ['Mine', 'Long', ''], styles: [null, { forecastHours: '48' }, null] });
  assert.deepEqual(GS.parse({ graphStyles: { styles: [{ x: 1 }, 'no', { y: 2 }] } }).styles, [null, null, { y: 2 }],
    'an object item reads too; the first slot is never a style of its own');
  assert.equal(GS.count({}), 1);
  assert.equal(GS.count(S), 2);
  assert.equal(GS.count({ graphStyles: stylesItem(null, {}) }), 2, 'style 3 without style 2');
  assert.deepEqual([GS.exists(S, 0), GS.exists(S, 1), GS.exists(S, 2), GS.exists(S, 3)], [true, true, false, false]);
  assert.deepEqual([GS.name(S, 0), GS.name(S, 1), GS.name(S, 2)], ['Mine', 'Long', 'Graph style 3']);
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

test('seriesOf: each line\'s effective metric, and whether it is a stripe', () => {
  const S = { secondaryLine: 'precip_prob', secondaryLineStyle: 'stripeBottom', thirdLine: 'precip_prob',
    fourthLine: 'feels', fourthLineStyle: 'stripeTop', fifthLine: 'off' };
  assert.deepEqual(GS.seriesOf(S, EMERY), [{ metric: 'precip_prob', stripe: true }, null,
    { metric: 'feels', stripe: false }, null], 'a repeat draws nothing; feels-like is never a stripe');
  assert.deepEqual(GS.seriesOf(S, platform.computeEnv({ platform: 'aplite' }))[0],
    { metric: 'precip_prob', stripe: false }, 'no stripes where the watch draws no styles');
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
  assert.deepEqual(u.rows, [{ metric: 'precip_prob', stripe: false }, { metric: 'uv', stripe: false },
    { metric: 'cloud', stripe: true }, { metric: 'precip_prob', stripe: true }]);
  assert.deepEqual(u.maps[0], [1, 2, 0, 0], 'the first style: its own rows');
  assert.deepEqual(u.maps[1], [3, 4, 2, 0], 'the rain chance as a stripe takes a row of its own');
  assert.deepEqual(u.maps[2], [2, 0, 0, 1], 'uv and the rain-chance line read the first style\'s rows');
  // Without the first style, style 2 keeps its own rows where they are free.
  const alone = GS.assign(S, EMERY, [1]);
  assert.deepEqual(alone.maps[1], [1, 2, 3, 0]);
  // A fifth series is dropped: its line reads no row.
  const five = Object.assign({}, S, { fourthLine: 'wind', fifthLine: 'gust' });
  const over = GS.assign(five, EMERY, [0, 1]);
  assert.deepEqual(over.maps[0], [1, 2, 3, 4]);
  assert.deepEqual(over.maps[1], [0, 0, 2, 0], 'cloud and the rain-chance stripe find no row');
  assert.equal(over.rows.length, GS.TRENDS);
});

test('the write helpers: a style\'s values, the item written back, a free slot, delete with its screens', () => {
  const S = layout(['1', '2', '3'], { forecastHours: '24', thirdLine: 'uv',
    graphStyles: stylesItem({ forecastHours: '48' }, { thirdLine: 'cloud' }, ['', 'Long', 'Cloudy']) });
  const two = GS.valuesOf(S, 1);
  assert.equal(two.forecastHours, '48');
  assert.equal(two.thirdLine, 'uv', 'a key the style holds no value of: the first style\'s');
  assert.deepEqual(Object.keys(two).filter((k) => !GS.GOVERNED.includes(k)), [], 'governed keys only');
  assert.equal(GS.freeSlot(S), -1, 'three styles: no slot');
  const moved = Object.assign({}, S);
  assert.deepEqual(GS.deleteStyle(moved, 1), [1], 'the screen that drew it');
  assert.equal(moved.viewStyle1, '1', 'draws the first style');
  assert.equal(moved.viewStyle2, '3', 'style 3 keeps its slot');
  assert.deepEqual(GS.parse(moved).names, ['', '', 'Cloudy'], 'the name goes with it');
  assert.equal(GS.freeSlot(moved), 1);
  assert.equal(GS.name(moved, 2), 'Cloudy');
  assert.deepEqual(GS.deleteStyle(moved, 0), [], 'never the first style');
  // The item written back: '' once it holds nothing, so an install that makes a style and
  // deletes it again stores what it had.
  GS.deleteStyle(moved, 2);
  assert.equal(moved.graphStyles, '');
  assert.equal(GS.withName({}, 0, 'Mine'), JSON.stringify({ names: ['Mine', '', ''], styles: [null, null, null] }),
    'a name alone is kept');
  const w = GS.withStyle({}, 2, { forecastHours: '12' });
  assert.deepEqual(GS.parse({ graphStyles: w }).styles, [null, null, { forecastHours: '12' }]);
  assert.equal(GS.withStyle({ graphStyles: w }, 0, { x: 1 }), w, 'the first style has no stored values');
});

test('rowsNeeded: the distinct series the styles draw between them', () => {
  const a = { secondaryLine: 'precip_prob', thirdLine: 'uv', fourthLine: 'off', fifthLine: 'off' };
  const b = { secondaryLine: 'precip_prob', thirdLine: 'cloud', fourthLine: 'off', fifthLine: 'off' };
  assert.equal(GS.rowsNeeded([a], EMERY), 2);
  assert.equal(GS.rowsNeeded([a, b], EMERY), 3, 'the shared rain chance once');
  assert.equal(GS.rowsNeeded([a, Object.assign({}, b, { secondaryLineStyle: 'stripeTop' })], EMERY), 4,
    'a line and a stripe of one metric: two');
});
