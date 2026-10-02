'use strict';
// test/stripe-levels.test.js — a stripe cell's level on its metric's own scale
// (src/pkjs/stripe-levels.js): the table itself and its edges, the bytes the forecast
// bake sends for a line drawn as a stripe (forecast-series.js stripeBytes) and nowhere
// else, the forecast preview shading exactly those levels, and the stripe hints naming
// where the bake's colour steps sit. The radar sky rows' side lives in
// test/radar-sky.test.js and test/radar-sky-preview.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');

// applyForecastSeries reaches phone-battery.js, which reads localStorage: AGENTS.md,
// install the mock BEFORE the watch modules load.
const store = {};
global.localStorage = {
  getItem(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
  setItem(k, v) { store[k] = String(v); },
  removeItem(k) { delete store[k]; }
};

require('../src/pkjs/config-ui/lib/schema-walk.js');
require('../src/pkjs/config-ui/lib/color.js');
require('../src/pkjs/config-ui/lib/show-when.js');
require('../src/pkjs/config-ui/lib/engine.js');
const SL = require('../src/pkjs/stripe-levels.js');
const lineStyle = require('../src/pkjs/line-style.js');
const lineAlert = require('../src/pkjs/line-alert.js');
const { buildForecastSeries, applyForecastSeries } = require('../src/pkjs/forecast-series.js');
const FC = require('../src/pkjs/settings/preview-forecast.js');
const B = require('../src/pkjs/settings/blocks.js');

const [NONE, L1, L2, L3, FULL] = [0, 62, 125, 187, 250];

/**
 * chart_stripe_level(v, 0, 250) (src/c/appendix/chart_stripe.h) ported: the level the
 * watch draws for a received byte. It rounds UP, ceil(v * 4 / 250).
 * @param {number} v Byte 0..250.
 * @returns {number} Level 0..4.
 */
function chartStripeLevel(v) {
  if (v <= 0) { return 0; }
  return Math.min(4, Math.ceil(v * 4 / 250));
}

// ---- The table -------------------------------------------------------------------

test('LEVEL_BYTES: each byte draws exactly its level on the watch, and is the largest that does', () => {
  assert.deepEqual(SL.LEVEL_BYTES, [0, 62, 125, 187, 250]);
  assert.equal(SL.LEVELS, 4);
  SL.LEVEL_BYTES.forEach((b, level) => {
    assert.equal(chartStripeLevel(b), level, b + ' draws level ' + level);
    if (level < 4) { assert.equal(chartStripeLevel(b + 1), level + 1, (b + 1) + ' is already the next level'); }
  });
  // Rounded rather than floored, the odd levels' bytes would draw a level too high.
  assert.equal(chartStripeLevel(Math.round(250 / 4)), 2);
  assert.equal(chartStripeLevel(Math.round(3 * 250 / 4)), 4);
});

test('the scales, as the owner set them: rain, cloud and sun each their own, wind/gusts/UV one band', () => {
  assert.deepEqual(SL.SCALES, {
    rain: [1, 11, 31, 61],
    cloud: [10, 30, 60, 90],
    sun: [10, 30, 60, 90],
    band: [1, 30, 60, 90]
  });
  // Every metric a stripe can show has a scale, and no other metric does.
  assert.deepEqual(Object.keys(SL.METRIC_SCALES).sort(), lineStyle.STRIPE_METRIC_IDS.slice().sort());
  assert.deepEqual(SL.METRIC_SCALES, { precip_prob: 'rain', cloud: 'cloud', wind: 'band', gust: 'band', uv: 'band' });
  ['pressure', 'feels', 'dew', 'rain', 'off', '', null, undefined, 'constructor', 'toString'].forEach((m) => {
    assert.equal(SL.scaleOf(m), null, String(m));
  });
});

// Every band edge of every scale: the percentage counts as the whole percent it rounds
// to, half up (9.5 % is 10 %, 9.4 % is 9 %).
const EDGES = {
  rain: [[0, 0], [0.4, 0], [0.5, 1], [1, 1], [10, 1], [10.4, 1], [10.5, 2], [11, 2], [30, 2], [30.4, 2],
    [30.5, 3], [31, 3], [60, 3], [60.4, 3], [60.5, 4], [61, 4], [100, 4]],
  cloud: [[0, 0], [9, 0], [9.4, 0], [9.5, 1], [9.6, 1], [10, 1], [29, 1], [29.4, 1], [29.5, 2], [30, 2],
    [59, 2], [59.4, 2], [59.5, 3], [60, 3], [89, 3], [89.4, 3], [89.5, 4], [90, 4], [100, 4]],
  sun: [[0, 0], [9.4, 0], [9.5, 1], [29.4, 1], [29.5, 2], [59.4, 2], [59.5, 3], [89.4, 3], [89.5, 4], [100, 4]],
  band: [[0, 0], [0.4, 0], [0.5, 1], [1, 1], [29, 1], [29.4, 1], [29.5, 2], [30, 2], [59, 2], [59.4, 2],
    [59.5, 3], [60, 3], [89, 3], [89.4, 3], [89.5, 4], [90, 4], [100, 4]]
};

test('levelOf: every band edge of every scale, rounded half up to a whole percent', () => {
  Object.keys(EDGES).forEach((scale) => {
    EDGES[scale].forEach(([pct, level]) => {
      assert.equal(SL.levelOf(scale, pct), level, scale + ' ' + pct + ' %');
      assert.equal(SL.byteOf(scale, pct), SL.LEVEL_BYTES[level], scale + ' ' + pct + ' % byte');
    });
    // Missing, non-numeric or negative is empty; above 100 is full.
    [null, undefined, NaN, 'x', Infinity, -Infinity, -0.4, -1, -50].forEach((v) => {
      assert.equal(SL.levelOf(scale, v), 0, scale + ' ' + String(v));
    });
    [100.4, 101, 250].forEach((v) => assert.equal(SL.levelOf(scale, v), 4, scale + ' ' + v));
    assert.equal(SL.levelOf(scale, String(EDGES[scale][3][0])), EDGES[scale][3][1], 'a numeric string reads');
    // Monotone, and every level reached from 0 to 100 in 0.1 % steps.
    let last = 0;
    const seen = {};
    for (let t = 0; t <= 1000; t += 1) {
      const level = SL.levelOf(scale, t / 10);
      assert.ok(level >= last, scale + ' never steps down at ' + t / 10);
      last = level;
      seen[level] = true;
    }
    assert.deepEqual(Object.keys(seen).map(Number), [0, 1, 2, 3, 4], scale + ' reaches every level');
  });
  ['nope', 'constructor', undefined].forEach((s) => assert.equal(SL.levelOf(s, 50), 0, 'no scale ' + s));
});

test('percentFrom: the lowest percentage of each level, the one the hints name', () => {
  Object.keys(SL.SCALES).forEach((scale) => {
    for (let level = 1; level <= 4; level += 1) {
      const from = SL.percentFrom(scale, level);
      assert.equal(SL.levelOf(scale, from), level, scale + ' level ' + level + ' from ' + from);
      assert.equal(SL.levelOf(scale, from - 0.01), level - 1, scale + ' just under ' + from);
    }
  });
});

test('metricLevel: a metric on its scale; null is nothing; a Show: Alert sample at its warn level draws', () => {
  assert.equal(SL.metricLevel('precip_prob', 10), 1);
  assert.equal(SL.metricLevel('precip_prob', 11), 2);
  assert.equal(SL.metricLevel('cloud', 9.4), 0);
  assert.equal(SL.metricLevel('cloud', 9.6), 1);
  assert.equal(SL.metricLevel('uv', 29.5), 2);
  assert.equal(SL.metricLevel('wind', 0), 0, 'no wind on a line drawn All is empty');
  assert.equal(SL.metricLevel('wind', 0, true), 1, 'on Alert, 0 % of the band is the warn level itself');
  assert.equal(SL.metricLevel('gust', 0.3, true), 1);
  assert.equal(SL.metricLevel('gust', 95, true), 4);
  [null, undefined].forEach((v) => {
    assert.equal(SL.metricLevel('wind', v, true), 0, 'below the warn level is a gap');
    assert.equal(SL.metricLevel('cloud', v), 0);
  });
  assert.equal(SL.metricByte('uv', 0, true), L1);
  assert.equal(SL.metricByte('uv', null, true), NONE);
  assert.equal(SL.metricByte('precip_prob', 61), FULL);
});

// ---- The bake --------------------------------------------------------------------

// Series as getPayload hands them over: rain chance %, cloud cover % (weighted, so
// fractional), wind and gusts km/h, UV x 10.
const RAW = {
  precips: [0, 1, 10, 11, 30, 31, 60, 61, 100],
  clouds: [0, 9.4, 9.6, 29.4, 29.5, 59.6, 89.4, 89.5, 100],
  // Mid Wind graph scale (50 km/h): 1 %, 28 / 30 %, 58 / 60 %, 88 / 90 %, above the top.
  winds: [0, 1, 14, 15, 29, 30, 44, 45, 60],
  gusts: [0, 1, 14, 15, 29, 30, 44, 45, 60],
  // UV 11 scale: 0.1, 3.2 / 3.3, 6.5 / 6.6, 9.8 / 9.9, 11.
  uvs: [0, 1, 32, 33, 65, 66, 98, 99, 110],
  rains: []
};
const LEVELS_OF = {
  precip_prob: [NONE, L1, L1, L2, L2, L3, L3, FULL, FULL],
  cloud: [NONE, NONE, L1, L1, L2, L3, L3, FULL, FULL],
  wind: [NONE, L1, L1, L2, L2, L3, L3, FULL, FULL],
  gust: [NONE, L1, L1, L2, L2, L3, L3, FULL, FULL],
  uv: [NONE, L1, L1, L2, L2, L3, L3, FULL, FULL]
};
const LINE_KEYS = { secondaryLine: 'SECONDARY_LINE_TREND_UINT8', thirdLine: 'THIRD_LINE_TREND_UINT8',
  fourthLine: 'FOURTH_LINE_TREND_UINT8', fifthLine: 'FIFTH_LINE_TREND_UINT8' };

test('a line drawn as a stripe sends level bytes on its metric\'s own scale, on every line slot', () => {
  Object.keys(LINE_KEYS).forEach((key) => {
    lineStyle.STRIPE_METRIC_IDS.forEach((m) => {
      ['stripeTop', 'stripeBottom'].forEach((st) => {
        // The line under test carries the metric; every other line is off.
        const settings = { secondaryLine: 'off', thirdLine: 'off', fourthLine: 'off', fifthLine: 'off',
          windScale: 'mid', barSource: 'off' };
        settings[key] = m;
        settings[key + 'Style'] = st;
        const out = buildForecastSeries(RAW, settings);
        assert.deepEqual(out[LINE_KEYS[key]], LEVELS_OF[m], key + ' ' + m + ' ' + st);
      });
    });
  });
});

test('a line, thick line, dots or x marks keep their exact bytes', () => {
  const exact = {
    precip_prob: [0, 3, 25, 28, 75, 78, 150, 153, 250],
    cloud: [0, 24, 24, 74, 74, 149, 224, 224, 250],
    wind: [0, 5, 70, 75, 145, 150, 220, 225, 250],
    uv: [0, 2, 73, 75, 148, 150, 223, 225, 250]
  };
  Object.keys(exact).forEach((m) => {
    ['line', 'bold', 'dots', 'x', undefined].forEach((st) => {
      const settings = { secondaryLine: m, thirdLine: 'off', windScale: 'mid', barSource: 'off' };
      if (st) { settings.secondaryLineStyle = st; }
      assert.deepEqual(buildForecastSeries(RAW, settings).SECONDARY_LINE_TREND_UINT8, exact[m], m + ' ' + st);
    });
    // The stripe sends the same number of bytes: the weather bundle's size is unchanged.
    const striped = buildForecastSeries(RAW, { secondaryLine: m, thirdLine: 'off', windScale: 'mid',
      barSource: 'off', secondaryLineStyle: 'stripeTop' }).SECONDARY_LINE_TREND_UINT8;
    assert.equal(striped.length, exact[m].length, m + ': same tuple length');
  });
  // A stored stripe on a metric that cannot be one is drawn, and baked, as its line.
  ['pressure', 'feels', 'dew'].forEach((m) => {
    const settings = { secondaryLine: 'precip_prob', thirdLine: m, barSource: 'off' };
    const raw = Object.assign({}, RAW, { pressures: [1000, 1010, 1020, 1030, 1000, 1010, 1020, 1030, 1000],
      feels: [1, 2, 3, 4, 5, 6, 7, 8, 9], dews: [1, 2, 3, 4, 5, 6, 7, 8, 9] });
    assert.deepEqual(buildForecastSeries(raw, Object.assign({ thirdLineStyle: 'stripeTop' }, settings)),
      buildForecastSeries(raw, Object.assign({ thirdLineStyle: 'dots' }, settings)), m);
  });
});

test('Show: Alert as a stripe: nothing below the warn level, level 1 from it, full from 90 % up the band', () => {
  // Gusts 65/90 kph (the seed) over the mid scale: the band is 65..90, full from 87.375.
  const settings = { secondaryLine: 'gust', secondaryLineStyle: 'stripeTop', thirdLine: 'off',
    windScale: 'mid', barSource: 'off', gustLineOnlyAlert: 'alert' };
  const band = lineAlert.alertBand(settings, 'gust', ['gust']);
  assert.deepEqual([band.bottom, band.top], [65, 90], 'premise: the seed band');
  const out = buildForecastSeries(Object.assign({}, RAW, { gusts: [0, 64, 65, 66, 72, 73, 79, 80, 87, 88, 120] }),
    settings).SECONDARY_LINE_TREND_UINT8;
  // 64: below warn; 65: 0 % (still level 1); 72 / 73: 28 / 32 %; 79 / 80: 56 / 60 %;
  // 87 / 88: 88 / 92 %; 120: above the top.
  assert.deepEqual(out, [NONE, NONE, L1, L1, L1, L2, L2, L3, L3, FULL, FULL]);
  // UV on Alert: warn 6, the band UV 6..11 (the scale's top over danger 8). UV 5.9
  // shows as UV 6, the alert's own whole-index reading, so it reaches warn and draws
  // level 1 from under the band's bottom; 7.4 / 7.5 are 28 / 30 %, 10.4 / 10.5 88 / 90 %.
  const uv = buildForecastSeries(Object.assign({}, RAW, { uvs: [0, 59, 60, 74, 75, 104, 105] }),
    { secondaryLine: 'uv', secondaryLineStyle: 'stripeBottom', thirdLine: 'off', barSource: 'off',
      uvLineOnlyAlert: 'alert' }).SECONDARY_LINE_TREND_UINT8;
  assert.deepEqual(uv, [NONE, L1, L1, L1, L2, L3, FULL]);
});

test('the watch draws the stripe: aplite keeps its exact bytes, a watch with styles (or unknown) takes levels', () => {
  const payload = () => ({ TEMP_RAW_TREND: [10, 20, 30], TEMP_MIN: 10, TEMP_MAX: 30,
    PRECIP_TREND_UINT8: [0, 5, 45], RAIN_TREND_UINT8: [0, 0, 0], CLOUD_TREND: [0, 9.6, 95],
    UV_TREND_UINT8: [0, 1, 33], CURRENT_TEMP: 10, CITY: 'X', SUN_EVENTS: [1] });
  const striped = { secondaryLine: 'precip_prob', secondaryLineStyle: 'stripeBottom',
    thirdLine: 'uv', thirdLineStyle: 'stripeTop', fourthLine: 'cloud', fourthLineStyle: 'stripeTop',
    barSource: 'off' };
  const plain = Object.assign({}, striped,
    { secondaryLineStyle: 'line', thirdLineStyle: 'dots', fourthLineStyle: 'x' });
  ['basalt', 'emery', 'diorite', null].forEach((platform) => {
    const info = platform ? { platform } : null;
    const out = applyForecastSeries(payload(), striped, info);
    assert.deepEqual(out.SECONDARY_LINE_TREND_UINT8, [NONE, L1, L3], String(platform));
    assert.deepEqual(out.THIRD_LINE_TREND_UINT8, [NONE, L1, L2], String(platform));
    assert.deepEqual(out.FOURTH_LINE_TREND_UINT8, [NONE, L1, FULL], String(platform));
  });
  // aplite draws its frozen line and dots whatever is stored: the exact bytes.
  const aplite = applyForecastSeries(payload(), striped, { platform: 'aplite' });
  const apliteLine = applyForecastSeries(payload(), plain, { platform: 'aplite' });
  assert.deepEqual(aplite.SECONDARY_LINE_TREND_UINT8, [0, 13, 113]);
  assert.deepEqual(aplite.THIRD_LINE_TREND_UINT8, [0, 2, 75]);
  assert.deepEqual(aplite.SECONDARY_LINE_TREND_UINT8, apliteLine.SECONDARY_LINE_TREND_UINT8);
  assert.deepEqual(aplite.THIRD_LINE_TREND_UINT8, apliteLine.THIRD_LINE_TREND_UINT8);
  assert.equal(aplite.FOURTH_LINE_TREND_UINT8, undefined, 'aplite never gets the Third metric line');
});

// ---- The forecast preview shades the bake's levels ---------------------------------

// preview-forecast.js' 12-hour sample (its forecastPreview locals): a change there
// breaks this pin on purpose, so the parity below keeps covering the levels drawn.
const SAMPLE = {
  precips: [20, 55, 80, 85, 60, 35, 20, 15, 12, 10, 14, 22],
  clouds: [35, 60, 90, 100, 95, 75, 45, 20, 10, 15, 40, 65],
  winds: [14, 16, 20, 24, 22, 19, 17, 16, 18, 22, 26, 24],
  gusts: [22, 25, 30, 34, 32, 28, 25, 24, 27, 31, 36, 33],
  uvs: [8, 6, 4, 2, 1, 0, 0, 0, 0, 0, 1, 3].map((v) => v * 10),
  rains: []
};
const PREVIEW_PITCH = (197 - 20) / 11;

/**
 * The sample a forecast preview draws for a settings state: SAMPLE, with a wind, gust or UV
 * line drawn Visible values: Alert redrawn against its levels (preview-forecast.js
 * alertSamples), in the bake's units.
 * @param {Object} state Live settings.
 * @returns {Object} buildForecastSeries' raw input.
 */
function previewSample(state) {
  const shown = FC.alertSamples(state, lineAlert.alertBands(state, true, true),
    { wind: SAMPLE.winds, gust: SAMPLE.gusts, uv: SAMPLE.uvs.map((v) => v / 10) });
  return Object.assign({}, SAMPLE, { winds: shown.wind, gusts: shown.gust, uvs: shown.uv.map((v) => v * 10) });
}

/**
 * The levels a B&W forecast preview draws on its main line's top stripe, one per hour
 * column: the dither pattern a cell is filled with is its level (`sd1`..`sd4`), and an
 * hour without a cell is level 0.
 * @param {Object} state Live settings.
 * @returns {number[]} Eleven levels.
 */
function previewLevels(state) {
  const svg = FC.forecastPreview(Object.assign({ theme: 'dark', dayNightShading: false }, state),
    { color: false, platform: 'diorite', lineStyles: true });
  const out = Array(11).fill(0);
  [...svg.matchAll(/<rect x="([-0-9.e]+)" y="4" width="[-0-9.e]+" height="5" fill="url\(#sd(\d)\)"><\/rect>/g)]
    .forEach((m) => { out[Math.round((Number(m[1]) - 20) / PREVIEW_PITCH)] = Number(m[2]); });
  return out;
}

test('the forecast preview shades each stripe cell at the level the bake sends', () => {
  const cases = [];
  lineStyle.STRIPE_METRIC_IDS.forEach((m) => {
    ['low', 'mid', 'high'].forEach((windScale) => {
      cases.push({ secondaryLine: m, windScale });
      if (lineAlert.settingKey(m)) {
        cases.push({ secondaryLine: m, windScale, [lineAlert.settingKey(m)]: 'alert' });
        // Lowered levels: another Alert band.
        cases.push({ secondaryLine: m, windScale, [lineAlert.settingKey(m)]: 'alert',
          threshWindWarn: '15', threshWindDanger: '25', threshGustWarn: '25', threshGustDanger: '35',
          threshUvWarn: '2', threshUvDanger: '7' });
      }
    });
  });
  // Wind and gusts both drawn on Alert share one band.
  cases.push({ secondaryLine: 'gust', thirdLine: 'wind', windScale: 'mid', windLineOnlyAlert: 'alert',
    gustLineOnlyAlert: 'alert', threshWindWarn: '15', threshGustWarn: '30', threshGustDanger: '40' });
  let drawn = 0;
  cases.forEach((c) => {
    const state = Object.assign({ thirdLine: 'off', barSource: 'off', secondaryLineStyle: 'stripeTop' }, c);
    if (c.thirdLine) { state.thirdLineStyle = 'line'; }
    const bake = buildForecastSeries(previewSample(state), state).SECONDARY_LINE_TREND_UINT8.slice(0, 11)
      .map(chartStripeLevel);
    assert.deepEqual(previewLevels(state), bake, JSON.stringify(c));
    drawn += bake.filter((l) => l > 0).length;
  });
  assert.ok(drawn > 100, 'premise: the cases draw cells');
});

// ---- The stripe hints name the bake's steps ----------------------------------------

test('the stripe hints name where the bake\'s colour steps start', () => {
  const env = { lineStyles: true };
  const hint = (metric, S) => B.lineStyleHint(metric, 'stripeTop', S, env);
  // Rain chance and cloud: the scale's ranges, as the bake steps.
  assert.equal(hint('precip_prob', { secondaryLine: 'precip_prob' }),
    'Four colour steps: 1–10%, 11–30%, 31–60% and 61–100% chance of rain. One cell per hour.');
  assert.equal(hint('cloud', { secondaryLine: 'cloud' }),
    'Four colour steps: 10–29%, 30–59%, 60–89% and 90–100% of the sky covered. One cell per hour.');
  // UV drawn All: 3.3, 6.6 and 9.9 are where the bake's level 2, 3 and 4 start.
  assert.equal(hint('uv', { secondaryLine: 'uv' }),
    'Colour steps up at UV 3.3 and 6.6, full colour from UV 9.9. One cell per hour.');
  const uvAll = buildForecastSeries(Object.assign({}, RAW, { uvs: [32, 33, 65, 66, 98, 99] }),
    { secondaryLine: 'uv', secondaryLineStyle: 'stripeTop', thirdLine: 'off', barSource: 'off' });
  assert.deepEqual(uvAll.SECONDARY_LINE_TREND_UINT8, [L1, L2, L2, L3, L3, FULL]);
  // Show: Alert in kph: the named full-colour value is the bake's first full one.
  [{ gustLineOnlyAlert: 'alert' }, { windLineOnlyAlert: 'alert' },
    { windLineOnlyAlert: 'alert', gustLineOnlyAlert: 'alert' },
    { gustLineOnlyAlert: 'alert', threshGustWarn: '50', threshGustDanger: '120', windScale: 'high' }]
    .forEach((over) => {
      ['wind', 'gust'].forEach((m) => {
        if (!lineAlert.onlyAlertOn(over, m)) { return; }
        const S = Object.assign({ secondaryLine: 'wind', thirdLine: 'gust', windScale: 'mid' }, over);
        const full = Number(/full colour from (\d+) kph/.exec(hint(m, S))[1]);
        const settings = Object.assign({ barSource: 'off', secondaryLineStyle: m === 'wind' ? 'stripeTop' : 'line',
          thirdLineStyle: m === 'gust' ? 'stripeTop' : 'line' }, S);
        const key = m === 'wind' ? 'SECONDARY_LINE_TREND_UINT8' : 'THIRD_LINE_TREND_UINT8';
        const bytes = buildForecastSeries(Object.assign({}, RAW, { winds: [full - 1, full], gusts: [full - 1, full] }),
          settings)[key];
        assert.deepEqual(bytes, [L3, FULL], m + ' ' + JSON.stringify(over) + ' full from ' + full);
      });
    });
  // Show: Alert in mph and knots: the named number is the first one from which EVERY
  // reading shown as that number or more is full, and a reading shown one below is not
  // (the step's first km/h converts to a number that a reading just below it can show
  // too, so the hint names the next one: the seed gust band in mph is full from 86 km/h,
  // and 85 km/h shows as 53 mph like 86 does, so "from 54 mph").
  assert.equal(hint('gust', { secondaryLine: 'gust', thirdLine: 'off', windUnits: 'mph',
    gustLineOnlyAlert: 'alert' }), 'Faintest colour = 40 mph, full colour from 54 mph. One cell per hour.');
  let checked = 0;
  ['mph', 'knots'].forEach((windUnits) => {
    [{ gustLineOnlyAlert: 'alert' }, { windLineOnlyAlert: 'alert' },
      { windLineOnlyAlert: 'alert', gustLineOnlyAlert: 'alert' },
      { gustLineOnlyAlert: 'alert', threshGustWarn: '30', threshGustDanger: '70', windScale: 'high' },
      { windLineOnlyAlert: 'alert', threshWindWarn: '12', threshWindDanger: '21', windScale: 'low' }]
      .forEach((over) => {
        ['wind', 'gust'].forEach((m) => {
          if (!lineAlert.onlyAlertOn(over, m)) { return; }
          const S = Object.assign({ secondaryLine: 'wind', thirdLine: 'gust', windScale: 'mid', windUnits }, over);
          const label = windUnits === 'mph' ? 'mph' : 'kn';
          const full = Number(new RegExp('full colour from (\\d+) ' + label).exec(hint(m, S))[1]);
          const settings = Object.assign({ barSource: 'off', secondaryLineStyle: m === 'wind' ? 'stripeTop' : 'line',
            thirdLineStyle: m === 'gust' ? 'stripeTop' : 'line' }, S);
          const key = m === 'wind' ? 'SECONDARY_LINE_TREND_UINT8' : 'THIRD_LINE_TREND_UINT8';
          const kmh = [];
          for (let v = 1; v <= 200; v += 1) { kmh.push(v); }
          const bytes = buildForecastSeries(Object.assign({}, RAW, { winds: kmh, gusts: kmh }), settings)[key];
          const what = m + ' ' + windUnits + ' ' + JSON.stringify(over) + ' full from ' + full;
          kmh.forEach((v, i) => {
            const shown = lineAlert.shownNumber(S, m, v);
            if (shown >= full) { assert.equal(bytes[i], FULL, what + ': ' + v + ' km/h shows ' + shown); }
          });
          assert.ok(kmh.some((v, i) => lineAlert.shownNumber(S, m, v) === full - 1 && bytes[i] !== FULL),
            what + ': a reading shown one below is not full');
          checked += 1;
        });
      });
  });
  assert.equal(checked, 12, 'premise: every unit and line was checked');
  // UV on Alert: the band UV 6..11, full from UV 10.5.
  assert.equal(hint('uv', { secondaryLine: 'uv', uvLineOnlyAlert: 'alert' }),
    'Faintest colour = UV 6, full colour from UV 10.5. One cell per hour.');
  assert.deepEqual(buildForecastSeries(Object.assign({}, RAW, { uvs: [104, 105] }),
    { secondaryLine: 'uv', secondaryLineStyle: 'stripeTop', thirdLine: 'off', barSource: 'off',
      uvLineOnlyAlert: 'alert' }).SECONDARY_LINE_TREND_UINT8, [L3, FULL]);
});
