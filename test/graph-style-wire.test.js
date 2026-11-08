'use strict';
// test/graph-style-wire.test.js — the graph styles on the wire (src/pkjs/weather/
// graph-style-wire.js): the records the Clay message carries for the shown styles, in
// lockstep with src/c/appendix/graph_style.h, and the settings the weather bake, the fetch
// and the render signature read while several styles are shown. The model is
// test/graph-styles.test.js'.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// clay-payload.js and the bake reach modules that read localStorage: install the mock BEFORE
// the watch modules load (AGENTS.md).
global.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };

const wire = require('../src/pkjs/weather/graph-style-wire.js');
const graphWire = require('../src/pkjs/weather/graph-wire.js');
const forecastAxis = require('../src/pkjs/forecast-axis.js');
const { buildClayPayload } = require('../src/pkjs/clay-payload.js');
const { applyForecastSeries } = require('../src/pkjs/forecast-series.js');
const { renderSignature } = require('../src/pkjs/render-signature.js');
const fetchOptions = require('../src/pkjs/weather/fetch-options.js');
const stripeLevels = require('../src/pkjs/stripe-levels.js');

const HEADER = fs.readFileSync(path.join(__dirname, '..', 'src', 'c', 'appendix', 'graph_style.h'), 'utf8');
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
  PALETTE: cDefine('GS_PALETTE'), MAX: 41
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

test('the scale rows: every feels-like and dew point row, while the scale option is on', () => {
  const two = Object.assign({}, LONG, { fourthLine: 'feels' });
  const on = styled(['1', '2'], two, null, { forecastAxisScale: true, fifthLine: 'dew' });
  const recs = wire.buildStyleTuples(on, EMERY);
  // Rows: precip line 0, uv 1, cloud stripe 2 (style 2's second line, on the first free row),
  // dew 3 (the first style's fifth line); feels, style 2's third line, finds none (a fifth
  // series, dropped).
  assert.equal(recs.CLAY_GRAPH_STYLE_1_UINT8[GS.SCALE], 1 << 4, 'dew on row 3');
  assert.equal(recs.CLAY_GRAPH_STYLE_2_UINT8[GS.SCALE], 1 << 4, 'the same byte in every record');
  assert.deepEqual(recs.CLAY_GRAPH_STYLE_2_UINT8.slice(GS.MAP, GS.INSETS), [1, 3, 0, 0]);
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
  assert.deepEqual(W.graphStyleSlots[2], { metric: 'cloud', stripe: true });
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
