// test/config-temp-axis-pad.test.js — the settings preview's mirror of the temperature-axis
// margins and the hi/lo labels (src/c/appendix/temp_axis_pad.h; owner, 2026-10-02). On each
// edge of the forecast graph something is drawn from (the rain bars, an amount line, its
// marks or fill) the temperature curve and the lines on its axis keep at least a quarter of
// the plot; an edge nothing is drawn from keeps today's margin. The labels sit level with
// the curve's extremes when there is space. The watch half is pinned on the host by
// test/c/temp_axis_pad_test.c; this file pins the preview and the constants both share.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const platform = require('../src/pkjs/config-ui/lib/platform.js');
require('../src/pkjs/config-ui/lib/schema-walk.js');
require('../src/pkjs/config-ui/lib/color.js');
require('../src/pkjs/config-ui/lib/engine.js');
const FC = require('../src/pkjs/settings/preview-forecast.js');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const BASALT = platform.computeEnv({ platform: 'basalt' });
const APLITE = platform.computeEnv({ platform: 'aplite' });
const COLOR = { color: true };

// The preview's plot (preview-forecast.js): PT 4, PB 94 without a bottom stripe, MT = PT + 3
// (where a full-height metric lands) or the foot of a top stripe band (11 under one stripe).
// Today's margins are 12 units at the bottom and at the top (none under a top stripe).
const PB = 94;
const TEMPS = [24, 24, 22, 20, 18, 16, 15, 14, 14, 15, 17, 19];
// Nothing anchored: the bars off, the Main metric a pressure line (it floats).
const NONE = { secondaryLine: 'pressure', secondaryLineFill: false, thirdLine: 'off', fourthLine: 'off',
  fifthLine: 'off', barSource: 'off', dayNightShading: false, theme: 'dark' };

/**
 * The temperature curve's vertices (the M point and each cubic's end point), in order.
 * @param {string} svg Preview markup.
 * @returns {number[][]} [x, y] per hour.
 */
function tempVertices(svg) {
  // The one path with a round cap: red 2.2 on colour, the foreground 3 wide on B&W.
  const m = /<path d="([^"]+)" fill="none" stroke="[^"]+" stroke-width="[\d.]+" stroke-linecap="round">/.exec(svg);
  assert.ok(m, 'premise: the temperature curve draws');
  const pairs = [...m[1].matchAll(/(-?[\d.]+),(-?[\d.]+)/g)].map((p) => [Number(p[1]), Number(p[2])]);
  return pairs.filter((p, i) => i === 0 || i % 3 === 0);
}

/**
 * The curve's highest and lowest y.
 * @param {string} svg Preview markup.
 * @returns {{top: number, bottom: number}}
 */
function curveRows(svg) {
  const ys = tempVertices(svg).map((p) => p[1]);
  assert.equal(ys.length, TEMPS.length);
  return { top: Math.min.apply(null, ys), bottom: Math.max.apply(null, ys) };
}

/**
 * The hi and lo labels' baselines.
 * @param {string} svg Preview markup.
 * @returns {{hi: number, lo: number}}
 */
function labelBases(svg) {
  const at = (t) => {
    const m = new RegExp('<text x="3" y="([\\d.-]+)"[^>]*>' + t + '°</text>').exec(svg);
    assert.ok(m, 'premise: the ' + t + '° label draws');
    return Number(m[1]);
  };
  return { hi: at(Math.max.apply(null, TEMPS)), lo: at(Math.min.apply(null, TEMPS)) };
}

const near = (a, b) => Math.abs(a - b) < 1e-9;
const preview = (over, env) => FC.forecastPreview(Object.assign({}, NONE, over), env || COLOR);

test('the quarter, the label gap and the inset: one number each, the watch\'s', () => {
  const header = read('src/c/appendix/temp_axis_pad.h');
  const define = (name) => Number(new RegExp('#define ' + name + ' (\\d+)').exec(header)[1]);
  assert.equal(FC.TEMP_AXIS_ANCHOR_DIV, define('TEMP_AXIS_ANCHOR_DIV'));
  assert.equal(FC.TEMP_AXIS_ANCHOR_DIV, 4, 'owner, 2026-10-02: "lets start with quarter"');
  assert.equal(FC.TEMP_LABEL_MIN_INK_GAP, define('TEMP_LABEL_MIN_INK_GAP'));
  assert.equal(FC.WATCH_INSET_PX,
    Number(/#define BOTTOM_VIEW_PRIMARY_LINE_INSET_Y (\d+)/.exec(read('src/c/appendix/bottom_view.h'))[1]));
  assert.equal(FC.WATCH_INSET_PX, Number(/var CURVE_INSET_PX = (\d+);/.exec(read('src/pkjs/clay-payload.js'))[1]));
});

test('nothing anchored: today\'s margins, 12 units at both edges', () => {
  const rows = curveRows(preview({}));
  assert.ok(near(rows.top, 4 + 3 + 12));
  assert.ok(near(rows.bottom, PB - 12));
  // The bars' Top flag alone, with the bars off, anchors nothing.
  assert.equal(preview({ rainBarFrom: 'top' }), preview({}));
  // A stripe has a band of its own: a bottom UV stripe lifts the plot, it anchors nothing.
  const striped = curveRows(preview({ thirdLine: 'uv', thirdLineStyle: 'stripeBottom' }));
  assert.ok(near(PB - 6 - striped.bottom, 12), 'the plot lifts by the 6-unit band, the margin stays');
});

test('the rain bars anchor the edge they are drawn from', () => {
  const quarter = Math.floor((PB - 7) / 4);   // 21 of the 87-unit band
  const stand = curveRows(preview({ barSource: 'rain' }));
  assert.ok(near(stand.bottom, PB - quarter), 'standing: a quarter at the bottom');
  assert.ok(near(stand.top, 19), 'the top keeps its 12');
  const hang = curveRows(preview({ barSource: 'rain', rainBarFrom: 'top' }));
  assert.ok(near(hang.top, 7 + quarter), 'hanging: a quarter at the top');
  assert.ok(near(hang.bottom, PB - 12), 'the bottom keeps its 12');
});

test('a drawn amount line, its marks or fill anchor the edge they are drawn from', () => {
  const quarter = Math.floor((PB - 7) / 4);
  ['line', 'dots', 'x'].forEach((style) => {
    const stand = curveRows(preview({ secondaryLine: 'uv', secondaryLineStyle: style }));
    assert.ok(near(stand.bottom, PB - quarter) && near(stand.top, 19), style);
    const hang = curveRows(preview({ secondaryLine: 'uv', secondaryLineStyle: style, uvLineFrom: 'top' }));
    assert.ok(near(hang.top, 7 + quarter) && near(hang.bottom, PB - 12), style + ' hanging');
  });
  const fill = curveRows(preview({ secondaryLine: 'precip_prob', secondaryLineFill: true, precipLineFrom: 'top',
    barSource: 'rain' }));
  assert.ok(near(fill.top, 7 + quarter) && near(fill.bottom, PB - quarter), 'both edges');
  // A pressure line floats (NONE draws one as its Main metric): it anchors nothing, as
  // feels-like and dew point do (draw-from.test.js lineAnchor).
  assert.deepEqual(curveRows(preview({ thirdLine: 'pressure', fourthLine: 'feels' })).top, 19);
});

test('top stripes + hanging: the top margin becomes a quarter below the band, else stays 0', () => {
  const S = { thirdLine: 'uv', thirdLineStyle: 'stripeTop' };
  const band = 4 + 5 + 2;                     // one stripe and its 2 gap rows: PTL = MT = 11
  const quarter = Math.floor((PB - band) / 4);
  assert.ok(near(curveRows(preview(S)).top, band), 'nothing hangs: right under the band');
  const hang = curveRows(preview(Object.assign({ secondaryLine: 'cloud', cloudLineFrom: 'top' }, S)));
  assert.ok(near(hang.top, band + quarter));
  const bars = curveRows(preview(Object.assign({ barSource: 'rain', rainBarFrom: 'top' }, S)));
  assert.ok(near(bars.top, band + quarter), 'hanging bars too');
});

test('a feels-like line rides the same margins as the temperature curve', () => {
  const quarter = Math.floor((PB - 7) / 4);
  const FEELS = [21, 21, 19, 17, 15, 13, 12, 11, 11, 12, 15, 17];
  // The Main metric off, so the feels-like line is the one thin path.
  const svg = preview({ secondaryLine: 'off', thirdLine: 'feels', thirdLineStyle: 'line', barSource: 'rain' });
  const temp = tempVertices(svg).map((p) => p[1]);
  const m = /<path d="([^"]+)" fill="none" stroke="[^"]+" stroke-width="1.6"><\/path>/.exec(svg);
  assert.ok(m, 'premise: the feels-like line draws');
  const feels = [...m[1].matchAll(/(-?[\d.]+),(-?[\d.]+)/g)].map((p) => Number(p[2]))
    .filter((p, i) => i === 0 || i % 3 === 0);
  assert.equal(feels.length, FEELS.length);
  // One linear map for both: y = ybot - (t - tmin) * k. The joint band is 10..24 (the
  // feels-like low 11, padded one degree), and its floor is the anchored margin.
  const k = (temp[7] - temp[0]) / (24 - 14);
  const ybot = temp[7] + (14 - 10) * k;
  assert.ok(near(ybot, PB - quarter), 'the band floor sits a quarter up');
  FEELS.forEach((f, i) => assert.ok(near(feels[i], temp[i] + (TEMPS[i] - f) * k), 'hour ' + i));
});

test('aplite previews keep the frozen margins and labels, whatever is drawn', () => {
  const S = { secondaryLine: 'precip_prob', secondaryLineFill: true, barSource: 'rain' };
  const rows = curveRows(preview(S, APLITE));
  assert.ok(near(rows.top, 19) && near(rows.bottom, PB - 12));
  const labels = labelBases(preview(S, APLITE));
  assert.ok(near(labels.hi, 4 + 11) && near(labels.lo, PB - 1));
});

test('the labels sit level with the curve\'s extremes when there is space', () => {
  [{}, { barSource: 'rain' }, { barSource: 'rain', rainBarFrom: 'top' }, { secondaryLine: 'uv', uvLineFrom: 'top',
    barSource: 'rain' }].forEach((over) => {
    const svg = preview(over, BASALT);
    const rows = curveRows(svg);
    const labels = labelBases(svg);
    // The ink (the cap above the baseline) is centred on the row.
    assert.ok(near(labels.hi - FC.LABEL_CAP / 2, rows.top), JSON.stringify(over) + ' hi');
    assert.ok(near(labels.lo - FC.LABEL_CAP / 2, rows.bottom), JSON.stringify(over) + ' lo');
    // Never further out than before.
    assert.ok(labels.hi >= 4 + 11 && labels.lo <= PB - 1);
  });
});

test('with a feels-like line the labels follow the temperature\'s own extremes, not the joint band', () => {
  const svg = preview({ thirdLine: 'feels', barSource: 'rain' }, BASALT);
  const rows = curveRows(svg);
  const labels = labelBases(svg);
  // Premise: the feels-like low widens the band, so the air's low sits above its floor.
  assert.ok(rows.bottom < PB - Math.floor((PB - 7) / 4) - 1);
  assert.ok(near(labels.lo - FC.LABEL_CAP / 2, rows.bottom));
  assert.ok(near(labels.hi - FC.LABEL_CAP / 2, rows.top));
});

test('alignLabels: inward only, the minimum gap, else today\'s place for both', () => {
  const cap = FC.LABEL_CAP;
  const gap = FC.TEMP_LABEL_MIN_INK_GAP * FC.CURVE_INSET_PREV / FC.WATCH_INSET_PX;
  // Room: both centred on their rows.
  assert.deepEqual(FC.alignLabels(15, 93, 30, 70), { hi: 30 + cap / 2, lo: 70 + cap / 2 });
  // A row beyond today's label clamps to today's (the hi row above it, the lo row below it).
  assert.deepEqual(FC.alignLabels(15, 93, 5, 95), { hi: 15, lo: 93 });
  assert.deepEqual(FC.alignLabels(15, 93, 5, 70), { hi: 15, lo: 70 + cap / 2 });
  // Exactly the gap fits; a hair less falls back to today's place for both.
  const hi = 30 + cap / 2;
  const fits = hi + gap + cap - cap / 2;
  assert.deepEqual(FC.alignLabels(15, 93, 30, fits), { hi: hi, lo: fits + cap / 2 });
  assert.deepEqual(FC.alignLabels(15, 93, 30, fits - 0.01), { hi: 15, lo: 93 });
  // A flat curve: today's place.
  assert.deepEqual(FC.alignLabels(15, 93, 50, 50), { hi: 15, lo: 93 });
});
