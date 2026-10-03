// test/preview-alert-samples.test.js — the forecast preview's samples for a wind, gust or UV
// line drawn Visible values: Alert (src/pkjs/settings/preview-forecast.js alertSamples).
// Owner, 2026-10-02: "when enabling alert values only for a gust line, nothing shows in the
// preview anymore.. can you fix that for all metrics with alert". The preview's fixed sample
// is a mild day that never reaches the seed warn levels, so on Alert each metric keeps its
// sample's shape, redrawn against the user's own levels: the same hours draw at any level,
// in any unit and Wind graph scale, with the gaps between them, from the faintest stripe
// step to full colour. A line drawn All, and every watch without Alert settings (aplite),
// keeps the plain sample.
const test = require('node:test');
const assert = require('node:assert/strict');
const platform = require('../src/pkjs/config-ui/lib/platform.js');
require('../src/pkjs/config-ui/lib/schema-walk.js');
const color = require('../src/pkjs/config-ui/lib/color.js');
require('../src/pkjs/config-ui/lib/engine.js');
const FC = require('../src/pkjs/settings/preview-forecast.js');
const lineAlert = require('../src/pkjs/line-alert.js');
const lineStyle = require('../src/pkjs/line-style.js');

const BASALT = platform.computeEnv({ platform: 'basalt' });
const EMERY = platform.computeEnv({ platform: 'emery' });
const DIORITE = platform.computeEnv({ platform: 'diorite' });
const APLITE = platform.computeEnv({ platform: 'aplite' });

// The preview's plain samples (its forecastPreview locals): wind and gusts in km/h, UV as
// the index. A change there breaks this pin on purpose.
const SAMPLES = {
  wind: [14, 16, 20, 24, 22, 19, 17, 16, 18, 22, 26, 24],
  gust: [22, 25, 30, 34, 32, 28, 25, 24, 27, 31, 36, 33],
  uv: [8, 6, 4, 2, 1, 0, 0, 0, 0, 0, 1, 3]
};
// The hours each one draws on Alert: where its plain sample is in the upper half of its
// range — the afternoon and the evening breeze, the UV morning.
const DRAWN = { wind: [2, 3, 4, 9, 10, 11], gust: [2, 3, 4, 9, 10, 11], uv: [0, 1, 2] };
// The hours next to those, where the line comes down to the zero row (chart_runs.h JOIN):
// the evening's 8 and the 1 and 5 around the afternoon, UV's 3.
const JOINED = { wind: [1, 5, 8], gust: [1, 5, 8], uv: [3] };
const STEM = { wind: 'Wind', gust: 'Gust', uv: 'Uv' };
const PITCH = (197 - 20) / 11;
// The hour axis: the zero row a standing line comes down to next to a reading. A reading on
// Alert sits at least the bake's 2 ‰ floor above it (preview-forecast.js metricYRaw).
const ZERO_ROW = 94;

/**
 * Alert level pairs to sweep for a metric in a unit: slider pairs (5-steps for wind and
 * gusts up to past their sliders' tops, whole UV indices to 12, danger at warn, a step
 * above it, or the top), the seed (blank), and the decimals and equal pairs the old text
 * fields could store.
 * @param {string} metric 'wind' | 'gust' | 'uv'.
 * @returns {Array.<{warn: string, danger: string, slider: boolean}>}
 */
function levelPairs(metric) {
  const out = [{ warn: '', danger: '', slider: true }];
  const step = metric === 'uv' ? 1 : 5;
  const max = metric === 'uv' ? 12 : 160;
  const warnStep = metric === 'uv' ? 1 : 15;
  for (let w = 0; w <= max; w += warnStep) {
    [w, w + step, max, Math.max(w, max / 2)].forEach((d) => {
      if (d >= w && d <= max) { out.push({ warn: String(w), danger: String(d), slider: true }); }
    });
  }
  [['12.5', '12.5'], ['25,3', '30.7'], ['0.4', '0.6'], ['6.01', '6.01'], ['99.9', '100.3']].forEach((p) => {
    out.push({ warn: p[0], danger: p[1], slider: false });
  });
  return out;
}

/**
 * The settings for a metric's line on the Main metric picker, alone on the graph.
 * @param {string} metric 'wind' | 'gust' | 'uv'.
 * @param {Object} over Further settings.
 * @returns {Object}
 */
function lineState(metric, over) {
  return Object.assign({ secondaryLine: metric, thirdLine: 'off', barSource: 'off', theme: 'dark',
    dayNightShading: false, secondaryLineFill: false }, over);
}

/**
 * A pair as stored settings for a metric.
 * @param {string} metric 'wind' | 'gust' | 'uv'.
 * @param {{warn: string, danger: string}} pair The levels.
 * @returns {Object}
 */
function levels(metric, pair) {
  return { ['thresh' + STEM[metric] + 'Warn']: pair.warn, ['thresh' + STEM[metric] + 'Danger']: pair.danger };
}

/**
 * Where a colour preview draws a line: its strokes' vertices and lone squares, in the
 * line's resolved colour, at the 'line' style's width. A vertex on the zero row is the
 * zero next to a reading the line comes down to (chart_runs.h JOIN), not a reading: it
 * counts only when `zeros` asks for those hours instead.
 * @param {string} svg Preview markup.
 * @param {Object} state The settings it was drawn for.
 * @param {string} lineKey The line's picker key.
 * @param {boolean} [zeros] The hours the line comes down to the zero row in instead.
 * @returns {Map<number, number>} Hour index -> the y the line draws it at.
 */
function drawnPoints(svg, state, lineKey, zeros) {
  const caps = { color: true, themePolarity: true, lineStyles: true };
  const gc = lineStyle.resolveGraphColors(state, caps);
  const hex = color.intToHex(gc[{ secondaryLine: 'secondary', thirdLine: 'third' }[lineKey]]);
  const points = new Map();
  const slot = (x) => Math.round((Number(x) - 20) / PITCH);
  const paths = new RegExp('<path d="(M[^"]+)" fill="none" stroke="' + hex + '" stroke-width="1.6">', 'g');
  [...svg.matchAll(paths)].forEach((m) => {
    const pts = [...m[1].matchAll(/(-?[\d.e-]+),(-?[\d.e-]+)/g)];
    pts.filter((p, i) => (i === 0 || i % 3 === 0) && (Number(p[2]) === ZERO_ROW) === Boolean(zeros))
      .forEach((p) => points.set(slot(p[1]), Number(p[2])));
  });
  if (!zeros) {
    const squares = new RegExp('<rect x="([-\\d.e]+)" y="([-\\d.e]+)" width="1.6" height="1.6" fill="' + hex + '">', 'g');
    [...svg.matchAll(squares)].forEach((m) => points.set(slot(Number(m[1]) + 0.8), Number(m[2]) + 0.8));
  }
  return points;
}

/**
 * The hours a colour preview draws a line in (drawnPoints).
 * @param {string} svg Preview markup.
 * @param {Object} state The settings it was drawn for.
 * @param {string} lineKey The line's picker key.
 * @param {boolean} [zeros] The hours the line comes down to the zero row in instead.
 * @returns {number[]} Hour indices, ascending.
 */
function drawnHours(svg, state, lineKey, zeros) {
  return [...drawnPoints(svg, state, lineKey, zeros).keys()].sort((a, b) => a - b);
}

/**
 * The levels a B&W preview shades its Main metric's top stripe at, one per hour column (the
 * dither pattern of a cell is its level, an hour without one is level 0).
 * @param {Object} state Settings.
 * @returns {number[]} Eleven levels.
 */
function stripeLevels(state) {
  const svg = FC.forecastPreview(Object.assign({}, state, { secondaryLineStyle: 'stripeTop' }), DIORITE);
  const out = Array(11).fill(0);
  [...svg.matchAll(/<rect x="([-0-9.e]+)" y="4" width="[-0-9.e]+" height="5" fill="url\(#sd(\d)\)"><\/rect>/g)]
    .forEach((m) => { out[Math.round((Number(m[1]) - 20) / PITCH)] = Number(m[2]); });
  return out;
}

test('every Alert line draws its sample\'s upper half, with its gaps, at any level, unit and scale', () => {
  let cases = 0;
  ['wind', 'gust', 'uv'].forEach((metric) => {
    const units = metric === 'uv' ? ['kph'] : ['kph', 'mph', 'knots'];
    const scales = metric === 'uv' ? ['mid'] : ['low', 'mid', 'high'];
    units.forEach((windUnits) => scales.forEach((windScale) => levelPairs(metric).forEach((pair) => {
      const S = lineState(metric, Object.assign({ windUnits, windScale,
        [lineAlert.settingKey(metric)]: 'alert' }, levels(metric, pair)));
      const label = JSON.stringify(S);
      [BASALT, EMERY].forEach((env) => {
        const svg = FC.forecastPreview(S, env);
        assert.deepEqual(drawnHours(svg, S, 'secondaryLine'), DRAWN[metric], label);
        assert.deepEqual(drawnHours(svg, S, 'secondaryLine', true), JOINED[metric], label);
      });
      // The stripe: a cell in each of those hours (the eleven columns), the rest empty, and
      // full colour at the peak; from the faintest step up wherever a slider can set the pair.
      const shades = stripeLevels(S);
      assert.deepEqual(shades.map((l, i) => (l > 0 ? i : -1)).filter((i) => i >= 0),
        DRAWN[metric].filter((i) => i < 11), label);
      assert.equal(Math.max.apply(null, shades), 4, label);
      if (pair.slider) {
        assert.equal(Math.min.apply(null, shades.filter((l) => l > 0)), 1, label);
      }
      cases += 1;
    })));
  });
  assert.ok(cases > 500, 'premise: the sweep covers ' + cases + ' cases');
});

// The height a Visible values: Alert line spans from its band's bottom to its top, in
// preview units (the hour axis at 94, less the plot's top 4 and inset 3; no stripe).
const PLOT_H = 94 - 7;
// Two lines' points this far apart read as two lines: past a stroke's 1.6, a dot's 4.
const VISIBLE = 4;
// The y a preview's alertPermille rounding (1 permille a line) can move a point by.
const ROUNDING = 2 * PLOT_H / 1000;

/**
 * The wind on the Main metric picker and gusts on the Third, both Visible values: Alert.
 * @param {Object} over Further settings (the units, the scale, the levels).
 * @returns {Object}
 */
function sharedState(over) {
  return lineState('wind', Object.assign({ thirdLine: 'gust', thirdLineStyle: 'line',
    windLineShow: 'alert', gustLineShow: 'alert' }, over));
}

/**
 * Checks one shared-band preview: both lines draw their sample's upper half, the gusts
 * never dip under the wind, and wherever the lines draw the gust sits at least a fifth of
 * the room the band leaves above the wind's warn level higher: visibly apart once that
 * room is a quarter of the band. (A wind warn level at the band's top leaves none: the
 * wind can only draw at the top there, and the gusts with it, on the watch as here.)
 * @param {Object} S Settings (sharedState).
 * @returns {number} The room above the wind's warn level, as a share of the band.
 */
function assertSharedBand(S) {
  const label = JSON.stringify(S);
  const bands = lineAlert.alertBands(S, BASALT);
  assert.deepEqual(bands.wind, bands.gust, 'premise: one shared band');
  const band = bands.wind;
  const room = (band.top - lineAlert.alertBand(S, 'wind', ['wind']).bottom) / (band.top - band.bottom);
  const shown = FC.alertSamples(S, bands, SAMPLES);
  shown.gust.forEach((g, i) => assert.ok(g >= shown.wind[i], label + ' hour ' + i));
  const svg = FC.forecastPreview(S, BASALT);
  const wind = drawnPoints(svg, S, 'secondaryLine');
  const gust = drawnPoints(svg, S, 'thirdLine');
  assert.deepEqual([...wind.keys()].sort((a, b) => a - b), DRAWN.wind, label);
  assert.deepEqual([...gust.keys()].sort((a, b) => a - b), DRAWN.gust, label);
  assert.deepEqual(drawnHours(svg, S, 'secondaryLine', true), JOINED.wind, label);
  assert.deepEqual(drawnHours(svg, S, 'thirdLine', true), JOINED.gust, label);
  DRAWN.wind.forEach((h) => {
    const gap = wind.get(h) - gust.get(h);
    assert.ok(gap >= 0.2 * room * PLOT_H - ROUNDING, label + ' hour ' + h + ': ' + gap);
    if (room >= 0.25) { assert.ok(gap >= VISIBLE, label + ' hour ' + h + ': ' + gap); }
  });
  return room;
}

test('wind and gusts sharing one Alert band: both draw, the gusts a step above the wind', () => {
  let cases = 0, apart = 0;
  ['kph', 'mph', 'knots'].forEach((windUnits) => ['low', 'mid', 'high'].forEach((windScale) => {
    const windPairs = levelPairs('wind').filter((p, i) => i % 3 === 0);
    windPairs.forEach((wp) => levelPairs('gust').filter((p, i) => i % 7 === 0).forEach((gp) => {
      const S = sharedState(Object.assign({ windUnits, windScale }, levels('wind', wp), levels('gust', gp)));
      if (assertSharedBand(S) >= 0.25) { apart += 1; }
      cases += 1;
    }));
    // Every pair a gust can share with the same pair, or with a pair one step off.
    levelPairs('wind').forEach((wp, i, all) => {
      [wp, all[i + 1]].filter(Boolean).forEach((gp) => {
        [[wp, gp], [gp, wp]].forEach((p) => {
          const S = sharedState(Object.assign({ windUnits, windScale }, levels('wind', p[0]), levels('gust', p[1])));
          if (assertSharedBand(S) >= 0.25) { apart += 1; }
          cases += 1;
        });
      });
    });
  }));
  assert.ok(cases > 1000 && apart > cases / 2, 'premise: the sweep covers ' + cases + ' cases, ' + apart + ' apart');
});

test('wind and gusts on Alert at equal, close or crossed levels draw as two lines, and as two rows of dots', () => {
  // Owner-visible cases from the review: one pair for both, warn levels 5 apart, and the
  // wind's levels above the gusts'. Before, the gust line covered the wind's evening.
  const pairs = [
    [{ warn: '50', danger: '70' }, { warn: '50', danger: '70' }],
    [{ warn: '50', danger: '70' }, { warn: '55', danger: '70' }],
    [{ warn: '55', danger: '70' }, { warn: '50', danger: '70' }],
    [{ warn: '60', danger: '90' }, { warn: '30', danger: '40' }],
    [{ warn: '', danger: '' }, { warn: '', danger: '' }]
  ];
  ['kph', 'mph', 'knots'].forEach((windUnits) => ['low', 'mid', 'high'].forEach((windScale) => {
    pairs.forEach((p) => {
      const S = sharedState(Object.assign({ windUnits, windScale }, levels('wind', p[0]), levels('gust', p[1])));
      const label = JSON.stringify(S);
      assert.ok(assertSharedBand(S) >= 0.25, 'premise: room to draw apart ' + label);
      // As dots (the hour columns, 0..10): each wind dot clear of the gust dot over it.
      const D = Object.assign({}, S, { secondaryLineStyle: 'dots', thirdLineStyle: 'dots' });
      const gc = lineStyle.resolveGraphColors(D, { color: true, themePolarity: true, lineStyles: true });
      const dots = (hex) => {
        const out = new Map();
        const re = new RegExp('<rect x="([-\\d.e]+)" y="([-\\d.e]+)" width="9" height="([34])" fill="' + hex + '">', 'g');
        [...FC.forecastPreview(D, BASALT).matchAll(re)].forEach((m) => {
          out.set(Math.round((Number(m[1]) + 4.5 - 20) / PITCH - 0.5), Number(m[2]) + Number(m[3]) / 2);
        });
        return out;
      };
      const wind = dots(color.intToHex(gc.secondary));
      const gust = dots(color.intToHex(gc.third));
      const columns = DRAWN.wind.filter((h) => h < 11);
      assert.deepEqual([...wind.keys()].sort((a, b) => a - b), columns, label);
      assert.deepEqual([...gust.keys()].sort((a, b) => a - b), columns, label);
      columns.forEach((h) => assert.ok(wind.get(h) - gust.get(h) >= VISIBLE, label + ' column ' + h));
    });
  }));
});

test('a sample on Alert peaks under its band\'s top and starts at the warn level', () => {
  // Gusts at the seed levels in kph: warn 65, danger 90 tops the Mid scale's 50. The plain
  // sample's middle (29 kph) maps to the warn level, its peak (36) 90 % of the way to the top.
  const S = { secondaryLine: 'gust', gustLineShow: 'alert', windScale: 'mid' };
  const shown = FC.alertSamples(S, lineAlert.alertBands(S, BASALT), SAMPLES).gust;
  assert.equal(shown[10], 65 + 0.9 * (90 - 65), 'the peak');
  assert.ok(shown.every((v) => v <= 90), 'never past the top');
  assert.ok(shown.filter((v) => v >= 65).length === 6 && shown.filter((v) => v < 65 / 2).length === 6,
    'six hours from the warn level up, the other six under half of it');
  // UV at warn 6: the morning's 4 is the warn level itself, the hour drawn at the band's bottom.
  const U = { secondaryLine: 'uv', uvLineShow: 'alert' };
  assert.equal(FC.alertSamples(U, lineAlert.alertBands(U, BASALT), SAMPLES).uv[2], 6);
});

test('All, and a watch without Alert settings, keep the plain samples, the very arrays', () => {
  const plain = [
    { secondaryLine: 'wind' }, { secondaryLine: 'gust', thirdLine: 'uv' },
    // Alert stored on a metric that is not drawn.
    { secondaryLine: 'wind', gustLineShow: 'alert', uvLineShow: 'alert' },
    { secondaryLine: 'precip_prob', thirdLine: 'cloud', windLineShow: 'alert' },
    // On the Fourth metric picker of a watch without it (a hand-built env: no platform
    // has Alert settings without line styles).
    { secondaryLine: 'precip_prob', thirdLine: 'off', fourthLine: 'gust', gustLineShow: 'alert' }
  ];
  plain.forEach((S) => {
    const shown = FC.alertSamples(S, lineAlert.alertBands(S, { lineStyles: false }), SAMPLES);
    Object.keys(SAMPLES).forEach((k) => assert.equal(shown[k], SAMPLES[k], JSON.stringify(S) + ' ' + k));
  });
  // aplite draws every line All, whatever is stored: the same preview.
  ['wind', 'gust', 'uv'].forEach((metric) => {
    const S = lineState(metric, {});
    const alert = Object.assign({ [lineAlert.settingKey(metric)]: 'alert' }, S);
    assert.equal(FC.forecastPreview(alert, APLITE), FC.forecastPreview(S, APLITE), metric);
    assert.deepEqual(FC.alertSamples(alert, lineAlert.alertBands(alert, APLITE), SAMPLES), SAMPLES);
  });
  // Alert stored for a line that is not drawn leaves the preview as it was.
  const S = { secondaryLine: 'precip_prob', thirdLine: 'cloud', fourthLine: 'off' };
  [BASALT, DIORITE, EMERY].forEach((env) => {
    assert.equal(FC.forecastPreview(Object.assign({ windLineShow: 'alert', gustLineShow: 'alert',
      uvLineShow: 'alert' }, S), env), FC.forecastPreview(S, env), env.platform);
  });
});
