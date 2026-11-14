'use strict';
// test/forecast-graphs/domain/graph-style-wire.test.js — the graph styles on the wire (src/pkjs/weather/
// graph-style-wire.js): the records the Clay message carries for the shown styles, in
// lockstep with src/c/appendix/graph_style.h, and the settings the weather bake, the fetch
// and the render signature read while several styles are shown. The model is
// test/forecast-graphs/domain/graph-styles.test.js'.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// clay-payload.js and the bake reach modules that read localStorage: install the mock BEFORE
// the watch modules load (AGENTS.md).
global.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };

const wire = require('../../../src/pkjs/forecast-graphs/domain/graph-style-wire.js');
const graphWire = require('../../../src/pkjs/forecast-graphs/domain/graph-wire.js');
const forecastAxis = require('../../../src/pkjs/forecast-graphs/domain/forecast-axis.js');
const { buildClayPayload } = require('../../../src/pkjs/settings/domain/clay-payload.js');
const { applyForecastSeries } = require('../../../src/pkjs/weather/domain/forecast-series.js');
const { renderSignature } = require('../../../src/pkjs/settings/domain/render-signature.js');
const fetchOptions = require('../../../src/pkjs/weather/domain/fetch-options.js');
const stripeLevels = require('../../../src/pkjs/forecast-graphs/domain/stripe-levels.js');
const lineAlert = require('../../../src/pkjs/alerts/domain/line-alert.js');
// Nothing placed on the bars: the default On demand ticks place the UV alert, which would
// fetch UV whatever the lines draw.
const { NOTHING_PLACED } = require('../../helpers/on-demand.js');

const HEADER = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'src', 'c', 'appendix', 'graph_style.h'), 'utf8');
const EMERY = { platform: 'emery' };
const NOW = new Date('2026-06-26T00:00:00Z');

/**
 * A #define of graph_style.h.
 * @param {string} name The macro.
 * @returns {number}
 */
function cDefine(name) {
  const m = HEADER.match(new RegExp('#define\\s+' + name + '\\s+(0x[0-9a-fA-F]+|\\d+)'));
  assert.ok(m, name + ' missing from graph_style.h');
  return Number(m[1]);
}

const GS = {
  HOURS: cDefine('GS_HOURS'), FLAGS: cDefine('GS_FLAGS'), SCALE: cDefine('GS_SCALE'),
  MAP: cDefine('GS_MAP'), INSETS: cDefine('GS_INSETS'), LINE_STYLE: cDefine('GS_LINE_STYLE'),
  PALETTE: cDefine('GS_PALETTE'), SPARE: cDefine('GS_TREND_SPARE'), MAX: 41
};

/**
 * Custom-layout settings with one forecast screen per style named, and graph styles 2 and 3.
 * @param {string[]} views Each screen's viewStyle.
 * @param {?Object} two Style 2's values.
 * @param {?Object} [three] Style 3's values.
 * @param {Object} [over] More settings (the first style's flat keys).
 * @returns {Object}
 */
function styled(views, two, three, over) {
  const S = { layoutPreset: 'custom', radarMode: 'graph', healthMode: 'off', viewCount: String(views.length),
    secondaryLine: 'precip_prob', secondaryLineFill: true, thirdLine: 'uv', thirdLineStyle: 'dots',
    fourthLine: 'off', fifthLine: 'off', barSource: 'rain', rainBarColor: 'multicolor', theme: 'dark',
    forecastHours: '24', forecastAxisNumbers: 'axis', dayNightShading: true,
    graphStyles: JSON.stringify({ names: ['', 'Long', 'Short'], styles: [null, two || null, three || null] }) };
  views.forEach((v, i) => {
    S['viewTop' + i] = i === 0 ? 'cal' : 'none';
    S['viewBody' + i] = 'forecast';
    S['viewStyle' + i] = v;
  });
  return Object.assign(S, over || {});
}

const LONG = { forecastHours: '48', forecastAxisNumbers: 'graph', secondaryLine: 'precip_prob',
  thirdLine: 'cloud', thirdLineStyle: 'stripeTop', fourthLine: 'off', fifthLine: 'off',
  barSource: 'off', dayNightShading: false };

test('the record layout is graph_style.h\'s', () => {
  assert.deepEqual([GS.HOURS, GS.FLAGS, GS.SCALE, GS.MAP, GS.INSETS, GS.LINE_STYLE, GS.PALETTE],
    [0, 1, 2, 3, 7, 12, 26]);
  assert.equal(cDefine('GS_MAP_BYTES'), 4);
  assert.equal(cDefine('GS_LINE_STYLE_BYTES'), graphWire.buildLineStyleBytes({}, EMERY).length);
  assert.equal(cDefine('GS_INSETS') + graphWire.buildCurveInsetBytes({}).length, GS.LINE_STYLE);
  assert.equal(cDefine('GS_FLAG_NIGHT'), wire.FLAG_NIGHT);
  assert.equal(cDefine('GS_PALETTE') + cDefine('GS_STOP_BYTES') * cDefine('GS_MAX_STOPS'), GS.MAX);
  assert.match(HEADER, /#define\s+GRAPH_STYLE_MIN_BYTES\s+GS_PALETTE\b/, 'a style without rain bars has no palette');
  // The axis bits fit the flags byte above the night bit, as the watch masks them.
  assert.equal(forecastAxis.BIT.NUMS_GRAPH & wire.FLAG_NIGHT, 0);
  assert.equal(forecastAxis.BIT.SCALE & ~cDefine('GS_FLAG_AXIS_MASK'), 0);
});

test('no records off emery; three empty tuples while only the first style shows', () => {
  const S = styled(['1', '2'], LONG);
  [{ platform: 'basalt' }, { platform: 'aplite' }, null].forEach((w) =>
    assert.deepEqual(wire.buildStyleTuples(S, w), {}, JSON.stringify(w)));
  const one = styled(['1', '1'], LONG);
  assert.deepEqual(wire.buildStyleTuples(one, EMERY),
    { CLAY_GRAPH_STYLE_1_UINT8: [], CLAY_GRAPH_STYLE_2_UINT8: [], CLAY_GRAPH_STYLE_3_UINT8: [] });
  assert.deepEqual(wire.buildStyleTuples({}, EMERY),
    { CLAY_GRAPH_STYLE_1_UINT8: [], CLAY_GRAPH_STYLE_2_UINT8: [], CLAY_GRAPH_STYLE_3_UINT8: [] },
    'a fresh install: the first style alone');
});

test('the first style\'s record is the look the flat tuples carry', () => {
  const S = styled(['1', '2'], LONG, null, { forecastAxisNumbers: 'graph' });
  const payload = buildClayPayload(S, EMERY, NOW);
  const rec = payload.CLAY_GRAPH_STYLE_1_UINT8;
  assert.equal(rec[GS.HOURS], 26, '24 h with no left axis: 26 hours');
  assert.equal(rec[GS.FLAGS], (payload.CLAY_DAY_NIGHT_SHADING ? wire.FLAG_NIGHT : 0)
    | (payload.CLAY_LARGE_GRAPH_FONT & 0xFE));
  assert.deepEqual(rec.slice(GS.MAP, GS.INSETS), [1, 2, 0, 0], 'its own rows');
  assert.deepEqual(rec.slice(GS.INSETS, GS.LINE_STYLE), payload.CLAY_CURVE_INSET_UINT8);
  assert.deepEqual(rec.slice(GS.LINE_STYLE, GS.PALETTE), payload.CLAY_LINE_STYLE_UINT8);
  assert.deepEqual(rec.slice(GS.PALETTE), payload.BAR_PALETTE_UINT8);
  assert.equal(rec.length, GS.MAX, 'multicolor: five stops');
  assert.deepEqual(payload.CLAY_GRAPH_STYLE_3_UINT8, [], 'no screen shows style 3');
});

test('another style\'s record: its own hours, look and rows, no palette without rain bars', () => {
  const S = styled(['1', '2'], LONG);
  const rec = buildClayPayload(S, EMERY, NOW).CLAY_GRAPH_STYLE_2_UINT8;
  const S2 = Object.assign({}, S, LONG);
  assert.equal(rec[GS.HOURS], 68);
  assert.equal(rec[GS.FLAGS], forecastAxis.BIT.NUMS_GRAPH, 'no shading; the numbers on the graph');
  assert.equal(rec[GS.SCALE], 0);
  assert.deepEqual(rec.slice(GS.MAP, GS.INSETS), [1, 3, 0, 0], 'the rain chance shared, cloud on a free row');
  assert.deepEqual(rec.slice(GS.INSETS, GS.LINE_STYLE), graphWire.buildCurveInsetBytes(S2));
  assert.deepEqual(rec.slice(GS.LINE_STYLE, GS.PALETTE), graphWire.buildLineStyleBytes(S2, EMERY));
  assert.equal(rec.length, GS.PALETTE, 'no rain bars: no palette');
});

test('graphs 4 to 6: each shown graph\'s record rides in its view words\' slot', () => {
  const S = styled(['1', '5', '6'], null, null, {
    graphStyles: JSON.stringify({ names: ['', '', '', '', '', ''],
      styles: [null, { forecastHours: '12' }, { forecastHours: '12' }, null, LONG, { forecastHours: '12' }] }) });
  const payload = buildClayPayload(S, EMERY, NOW);
  assert.deepEqual([payload.CLAY_VIEW_0, payload.CLAY_VIEW_1, payload.CLAY_VIEW_2]
    .map((w) => (Math.floor(w / 65536) >> 9) & 3), [0, 1, 2], 'graphs 1, 5 and 6 in slots 1 to 3');
  assert.equal(payload.CLAY_GRAPH_STYLE_1_UINT8[GS.HOURS], 24, 'the first graph: 24 h');
  assert.equal(payload.CLAY_GRAPH_STYLE_2_UINT8[GS.HOURS], 68, 'graph 5 (LONG): the long span');
  assert.equal(payload.CLAY_GRAPH_STYLE_3_UINT8[GS.HOURS], 14, 'graph 6: the 12 h option');
  assert.deepEqual(payload.CLAY_GRAPH_STYLE_2_UINT8.slice(GS.MAP, GS.INSETS), [1, 3, 0, 0],
    'graph 5\'s rows: the rain chance shared, cloud on a free row');
  // Graphs 2 and 3 exist but no screen shows them: graph 4 alone beside the first.
  const four = styled(['4', '1'], null, null, {
    graphStyles: JSON.stringify({ names: [], styles: [null, {}, {}, LONG] }) });
  const p4 = buildClayPayload(four, EMERY, NOW);
  assert.equal((Math.floor(p4.CLAY_VIEW_0 / 65536) >> 9) & 3, 1, 'graph 4 in the slot the first graph leaves');
  assert.equal(p4.CLAY_GRAPH_STYLE_2_UINT8[GS.HOURS], 68);
  assert.equal(p4.CLAY_GRAPH_STYLE_1_UINT8[GS.HOURS], 24, 'the first graph in its own');
  assert.deepEqual(p4.CLAY_GRAPH_STYLE_3_UINT8, [], 'a slot no shown graph takes is cleared');
});

test('the scale rows: every feels-like and dew point row, while the scale option is on', () => {
  const two = Object.assign({}, LONG, { fourthLine: 'feels' });
  const on = styled(['1', '2'], two, null, { forecastAxisScale: true, fifthLine: 'dew' });
  const recs = wire.buildStyleTuples(on, EMERY);
  // Rows: precip line 0, uv 1, cloud stripe 2 (style 2's second line, on the first free row),
  // dew 3 (the first style's fifth line), feels 4 (style 2's third line: the spare row).
  const both = (1 << 4) | (1 << 5);
  assert.equal(recs.CLAY_GRAPH_STYLE_1_UINT8[GS.SCALE], both, 'dew on row 3, feels on the spare');
  assert.equal(recs.CLAY_GRAPH_STYLE_2_UINT8[GS.SCALE], both, 'the same byte in every record');
  assert.deepEqual(recs.CLAY_GRAPH_STYLE_2_UINT8.slice(GS.MAP, GS.INSETS), [1, 3, GS.SPARE, 0]);
  const off = styled(['1', '2'], two, null, { fifthLine: 'dew' });
  assert.equal(wire.buildStyleTuples(off, EMERY).CLAY_GRAPH_STYLE_1_UINT8[GS.SCALE], 0);
});

test('the bake\'s settings: the union\'s rows, the bars while one style draws them, the longest length', () => {
  const S = styled(['1', '2'], LONG);
  assert.equal(wire.weatherSettings(styled(['1', '1'], LONG), EMERY).graphStyleSlots, undefined);
  assert.equal(wire.weatherSettings(S, { platform: 'basalt' }), S, 'basalt: the settings themselves');
  const W = wire.weatherSettings(S, EMERY);
  assert.deepEqual([W.secondaryLine, W.thirdLine, W.fourthLine, W.fifthLine], ['precip_prob', 'uv', 'cloud', 'off']);
  assert.deepEqual([W.secondaryLineStyle, W.thirdLineStyle, W.fourthLineStyle], ['line', 'line', 'stripeTop']);
  assert.deepEqual(W.graphStyleSlots[2], { metric: 'cloud', stripe: true, alert: false });
  assert.equal(W.barSource, 'rain', 'the first style draws them');
  assert.equal(W.forecastHours, '48');
  assert.equal(wire.hoursSent(S, EMERY), 68);
  assert.equal(wire.hoursSent(styled(['1', '2'], Object.assign({}, LONG, { forecastHours: '12' })), EMERY), 24,
    'the first style\'s 24 h is the longest');
  const noBars = wire.weatherSettings(styled(['2'], LONG), EMERY);
  assert.equal(noBars.barSource, 'off', 'style 2 alone: no rain bars');
  assert.equal(S.thirdLine, 'uv', 'the settings are not touched');
});

test('the bake sends one metric twice when one style draws it as a line and another as a stripe', () => {
  const two = Object.assign({}, LONG, { thirdLine: 'precip_prob', secondaryLine: 'cloud',
    secondaryLineStyle: 'stripeTop', thirdLineStyle: 'stripeTop' });
  const S = styled(['1', '2'], two);
  const precips = [0, 10, 40, 80, 100, 55];
  const payload = applyForecastSeries({
    TEMP_RAW_TREND: [10, 11, 12, 13, 14, 15], TEMP_MIN: 10, TEMP_MAX: 15,
    PRECIP_TREND_UINT8: precips, CLOUD_TREND: [0, 20, 40, 60, 80, 100], RAIN_TREND_UINT8: [0, 0, 1, 2, 3, 0],
    WIND_TREND_UINT8: [], GUST_TREND_UINT8: [], UV_TREND_UINT8: [0, 10, 20, 30, 40, 50]
  }, S, EMERY);
  // Rows: precip line, uv, cloud stripe, precip stripe.
  assert.deepEqual(payload.SECONDARY_LINE_TREND_UINT8, precips.map((p) => Math.round(p * 10 / 4)));
  assert.equal(payload.THIRD_LINE_TREND_UINT8.length, precips.length, 'uv');
  assert.ok(payload.FOURTH_LINE_TREND_UINT8.every((b) => stripeLevels.LEVEL_BYTES.includes(b)), 'cloud: levels');
  assert.ok(payload.FIFTH_LINE_TREND_UINT8.every((b) => stripeLevels.LEVEL_BYTES.includes(b)), 'precip: levels');
  assert.notDeepEqual(payload.FIFTH_LINE_TREND_UINT8, payload.SECONDARY_LINE_TREND_UINT8);
  assert.equal(payload.BAR_TREND_UINT8.length, precips.length);
});

test('the bake sends one metric twice when one style shows all its values and another alerts only', () => {
  // The owner's, 2026-11-10: each graph its own Visible values, and a metric shown both ways
  // counts as another metric. Style 1 draws UV with all its values, style 2 with alerts only.
  const two = Object.assign({}, LONG, { secondaryLine: 'uv', thirdLine: 'off', fourthLine: 'off', uvLineShow: 'alert' });
  const S = styled(['1', '2'], two, null, { uvLineShow: 'all' });
  const W = wire.weatherSettings(S, EMERY);
  assert.deepEqual(W.graphStyleSlots.slice(0, 3).map((r) => r && [r.metric, r.alert]),
    [['precip_prob', false], ['uv', false], ['uv', true]]);
  assert.equal(W.uvLineShow, 'alert', 'the bake\'s settings carry the band of the Alert row');
  assert.deepEqual(wire.buildStyleTuples(S, EMERY).CLAY_GRAPH_STYLE_2_UINT8.slice(GS.MAP, GS.INSETS), [3, 0, 0, 0],
    'style 2 reads the Alert row');
  const payload = bake(S, EMERY);
  const allOnly = bake(styled(['1'], null, null, { uvLineShow: 'all' }), EMERY);
  const alertOnly = bake(styled(['1'], null, null, { uvLineShow: 'alert' }), EMERY);
  assert.deepEqual(payload.THIRD_LINE_TREND_UINT8, allOnly.THIRD_LINE_TREND_UINT8, 'style 1\'s UV: all its values');
  assert.deepEqual(payload.FOURTH_LINE_TREND_UINT8, alertOnly.THIRD_LINE_TREND_UINT8, 'style 2\'s UV: alerts only');
  assert.notDeepEqual(payload.FOURTH_LINE_TREND_UINT8, payload.THIRD_LINE_TREND_UINT8);
  // Both alerts only: one row, as before each graph had its own.
  const both = styled(['1', '2'], two, null, { uvLineShow: 'alert' });
  assert.deepEqual(wire.weatherSettings(both, EMERY).graphStyleSlots.slice(0, 3).map((r) => r && r.metric),
    ['precip_prob', 'uv', null]);
  // Which row draws alerts only signs: flipping both styles trades the rows' bytes.
  const flipped = styled(['1', '2'], Object.assign({}, two, { uvLineShow: 'all' }), null, { uvLineShow: 'alert' });
  assert.notEqual(renderSignature(flipped, EMERY), renderSignature(S, EMERY));
  assert.equal(renderSignature(styled(['1', '2'], LONG), EMERY).split('|').length,
    renderSignature(styled(['1', '1'], LONG), EMERY).split('|').length, 'no Alert row: no extra part');
});

test('the fetch and the render signature read the shown styles\' union', () => {
  const S = styled(['1', '2'], Object.assign({}, LONG, { fourthLine: 'feels' }));
  const opts = fetchOptions.build(S, EMERY);
  assert.equal(opts.forecastHours, 68, 'the longest style');
  assert.equal(opts.fetchFeels, true, 'style 2 draws feels-like');
  assert.equal(fetchOptions.build(S, { platform: 'basalt' }).forecastHours, 24);
  const base = renderSignature(S, EMERY);
  assert.notEqual(base, renderSignature(S), 'the union signs');
  const recolored = styled(['1', '2'], Object.assign({}, LONG, { fourthLine: 'feels', gcCloudLineDark: 0xFF0000 }));
  assert.equal(renderSignature(recolored, EMERY), base, 'a colour rides the Clay message');
  const relined = styled(['1', '2'], Object.assign({}, LONG, { fourthLine: 'dew' }));
  assert.notEqual(renderSignature(relined, EMERY), base, 'another style\'s metric re-bakes');
  const shorter = styled(['1', '2'], Object.assign({}, LONG, { fourthLine: 'feels', forecastHours: '12' }));
  assert.notEqual(renderSignature(shorter, EMERY), base, 'and its length');
  const unshown = styled(['1', '1'], Object.assign({}, LONG, { fourthLine: 'dew' }));
  assert.equal(renderSignature(unshown, EMERY), renderSignature(styled(['1', '1'], LONG), EMERY),
    'a style no screen shows signs nothing');
});

// The spare row (graph-styles.js ROWS): the fifth series of a union, which no line of either
// style is, rides SPARE_LINE_TREND_UINT8 and joins what reads the bake's settings.
const FIFTH = Object.assign({}, LONG, { thirdLine: 'gust', thirdLineStyle: 'line', fourthLine: 'cloud' });
const FOUR_LINES = { fourthLine: 'wind', fifthLine: 'off' };
const RAW = {
  TEMP_RAW_TREND: [10, 11, 12, 13, 14, 15], TEMP_MIN: 10, TEMP_MAX: 15,
  PRECIP_TREND_UINT8: [0, 10, 40, 80, 100, 55], CLOUD_TREND: [0, 20, 40, 60, 80, 100],
  RAIN_TREND_UINT8: [0, 0, 1, 2, 3, 0], WIND_TREND_UINT8: [10, 20, 30, 40, 50, 60],
  GUST_TREND_UINT8: [20, 30, 40, 50, 60, 70], UV_TREND_UINT8: [0, 10, 20, 30, 40, 50]
};

/**
 * The weather payload a fresh copy of RAW bakes to.
 * @param {Object} S Settings.
 * @param {?Object} watchInfo The watch.
 * @returns {Object}
 */
function bake(S, watchInfo) {
  return applyForecastSeries(JSON.parse(JSON.stringify(RAW)), S, watchInfo);
}

test('the spare row: a fifth series bakes into SPARE_LINE_TREND_UINT8, a union of four sends none', () => {
  // The first style's precip, uv and wind take rows 0-2 (wind on its own fourth-line row);
  // style 2's gust finds its own row taken and takes row 3, its cloud the spare.
  const S = styled(['1', '2'], FIFTH, null, { fourthLine: 'wind' });
  const W = wire.weatherSettings(S, EMERY);
  assert.deepEqual(W.graphStyleSlots.map((r) => r && r.metric), ['precip_prob', 'uv', 'wind', 'gust', 'cloud']);
  assert.equal(W.spareLine, 'cloud', 'the bake\'s settings name the spare');
  assert.equal(S.spareLine, undefined, 'the settings themselves never do');
  assert.deepEqual(wire.buildStyleTuples(S, EMERY).CLAY_GRAPH_STYLE_2_UINT8.slice(GS.MAP, GS.INSETS), [1, 4, GS.SPARE, 0]);
  const payload = bake(S, EMERY);
  assert.deepEqual(payload.SPARE_LINE_TREND_UINT8, RAW.CLOUD_TREND.map((c) => Math.round(c * 10 / 4)), 'cloud %');
  assert.equal(payload.FIFTH_LINE_TREND_UINT8.length, RAW.GUST_TREND_UINT8.length, 'gusts on row 3');
  // A stripe on the spare bakes level bytes, as a stripe line does.
  const striped = bake(styled(['1', '2'], Object.assign({}, FIFTH, { fourthLineStyle: 'stripeTop' }), null,
    { fourthLine: 'wind' }), EMERY);
  assert.ok(striped.SPARE_LINE_TREND_UINT8.every((b) => stripeLevels.LEVEL_BYTES.includes(b)), 'levels');
  assert.notDeepEqual(striped.SPARE_LINE_TREND_UINT8, payload.SPARE_LINE_TREND_UINT8);
  // Four series between the styles: no spare, so the key is left out (the watch deletes its
  // spare trend), as it is with one style shown and on every other watch.
  const four = styled(['1', '2'], Object.assign({}, FIFTH, { fourthLine: 'off' }), null, FOUR_LINES);
  assert.equal(wire.weatherSettings(four, EMERY).spareLine, undefined);
  [[four, EMERY], [styled(['1', '1'], FIFTH, null, FOUR_LINES), EMERY], [S, { platform: 'basalt' }], [S, null]]
    .forEach(([settings, watch], i) => assert.equal(
      Object.prototype.hasOwnProperty.call(bake(settings, watch), 'SPARE_LINE_TREND_UINT8'), false, 'case ' + i));
});

test('the spare row joins the fetch, the left axis, the Show: Alert bands and the render signature', () => {
  // UV on the spare alone still fetches UV: the first style draws precip, wind and cloud, style
  // 2's gust takes row 3 and its uv the spare. No slot shows UV and no alert is placed, so
  // the spare is what asks for it.
  const uvSpare = styled(['1', '2'], Object.assign({}, FIFTH, { fourthLine: 'uv' }), null,
    Object.assign({ thirdLine: 'wind', thirdLineStyle: 'line', fourthLine: 'cloud', statusRadarLeft: 'empty' },
      NOTHING_PLACED));
  assert.equal(wire.weatherSettings(uvSpare, EMERY).spareLine, 'uv');
  assert.equal(fetchOptions.build(uvSpare, EMERY).fetchUv, true);
  const noUv = styled(['1', '2'], Object.assign({}, FIFTH, { fourthLine: 'pressure' }), null,
    Object.assign({ thirdLine: 'wind', thirdLineStyle: 'line', fourthLine: 'cloud', statusRadarLeft: 'empty' },
      NOTHING_PLACED));
  assert.equal(fetchOptions.build(noUv, EMERY).fetchUv, false, 'the control: nothing else asks for UV');
  // Feels-like on the spare alone is fetched and, with the left axis naming the scale, widens
  // its ends as a feels-like line does.
  const feelsSpare = styled(['1', '2'], Object.assign({}, FIFTH, { fourthLine: 'feels' }), null,
    { fourthLine: 'wind', forecastAxisScale: true });
  assert.equal(wire.weatherSettings(feelsSpare, EMERY).spareLine, 'feels');
  assert.equal(fetchOptions.build(feelsSpare, EMERY).fetchFeels, true);
  const feels = applyForecastSeries(Object.assign(JSON.parse(JSON.stringify(RAW)),
    { FEELS_TREND: [8, 9, 10, 11, 12, 20] }), feelsSpare, EMERY);
  assert.equal(feels.SPARE_LINE_TREND_UINT8.length, 6);
  assert.deepEqual([feels.TEMP_MIN, feels.TEMP_MAX], [8, 20], 'the scale\'s ends cover the spare\'s feels-like');
  // A gust line on the spare drawn Show: Alert shares the wind line's band, so it bakes the
  // bytes it would on a line of a graph that draws both.
  const alert = {};
  alert[lineAlert.settingKey('wind')] = 'alert';
  alert[lineAlert.settingKey('gust')] = 'alert';
  const lines = { thirdLine: 'uv', thirdLineStyle: 'line', fourthLine: 'wind' };
  const gustSpare = styled(['1', '2'], Object.assign({}, LONG, { thirdLine: 'cloud', thirdLineStyle: 'line',
    fourthLine: 'gust' }), null, Object.assign({}, lines, alert));
  assert.equal(wire.weatherSettings(gustSpare, EMERY).spareLine, 'gust');
  const own = styled(['1'], null, null, Object.assign({}, lines, { fifthLine: 'gust' }, alert));
  assert.deepEqual(bake(gustSpare, EMERY).SPARE_LINE_TREND_UINT8, bake(own, EMERY).FIFTH_LINE_TREND_UINT8);
  assert.ok(bake(gustSpare, EMERY).SPARE_LINE_TREND_UINT8.includes(0), 'gaps below the warn level');
  // The render signature: the spare signs while there is one, its stripe too, and a union of
  // four signs as it did before the spare.
  const sig = renderSignature(uvSpare, EMERY);
  assert.notEqual(renderSignature(noUv, EMERY), sig, 'another metric on the spare re-bakes');
  const cloudLine = styled(['1', '2'], FIFTH, null, { fourthLine: 'wind' });
  const cloudStripe = styled(['1', '2'], Object.assign({}, FIFTH, { fourthLineStyle: 'stripeTop' }), null,
    { fourthLine: 'wind' });
  assert.notEqual(renderSignature(cloudStripe, EMERY), renderSignature(cloudLine, EMERY), 'the spare as a stripe');
  const four = styled(['1', '2'], Object.assign({}, FIFTH, { fourthLine: 'off' }), null, FOUR_LINES);
  assert.equal(renderSignature(four, EMERY).split('|').length,
    renderSignature(styled(['1', '1'], FIFTH, null, FOUR_LINES), EMERY).split('|').length, 'no spare: no extra part');
  assert.equal(sig.split('|').length, renderSignature(four, EMERY).split('|').length + 1, 'the spare: one part');
});
