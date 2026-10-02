// test/config-temp-axis-pad.test.js — the settings preview's mirror of the forecast plot's
// layout, the temperature-axis margins and the hi/lo labels (src/c/appendix/temp_axis_pad.h;
// owner, 2026-10-02). Only an element with a value above 0 takes part: a stripe with none
// takes no band, a line or the bars with none anchor no edge. On each edge something is drawn
// from (the rain bars, an amount line, its marks or fill) the temperature curve and the lines on
// its axis keep at least an eighth of the plot between the stripe bands; an edge nothing is
// drawn from keeps today's margin. The labels sit level with the curve's extremes when there
// is space, and stay put while the curve reaches today's margins. The watch half is pinned on
// the host by test/c/temp_axis_pad_test.c; this file pins the preview and the constants both
// share.
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
// (where a full-height metric lands) or the foot of a top stripe band (11 under one stripe:
// 5 rows and its 2 gap rows). Today's margins are 12 units at the bottom and at the top (none
// under a top stripe band). An eighth of the 87-unit band is 10, under today's 12, so the
// margins only grow under a top stripe band (0 today) — the watch's default view, whose 55
// rows also keep their 7 px.
const PB = 94;
const BAND = 4 + 5 + 2;
const TEMPS = [24, 24, 22, 20, 18, 16, 15, 14, 14, 15, 17, 19];
// Nothing anchored: the bars off, the Main metric a pressure line (it floats).
const NONE = { secondaryLine: 'pressure', secondaryLineFill: false, thirdLine: 'off', fourthLine: 'off',
  fifthLine: 'off', barSource: 'off', dayNightShading: false, theme: 'dark' };
// A UV line drawn Show: Alert whose warn level the sample (UV 8 at most) never reaches: every
// hour ships as byte 0, so it draws nothing — as a line, marks or a stripe.
const UV_NEVER = { uvLineOnlyAlert: 'alert', threshUvWarn: 10, threshUvDanger: 11 };
// The same line with a warn level the afternoon reaches.
const UV_SOME = { uvLineOnlyAlert: 'alert', threshUvWarn: 3, threshUvDanger: 11 };

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

/**
 * The plot's zero line (the 0.7-wide line across the plot at PB).
 * @param {string} svg Preview markup.
 * @returns {number}
 */
function zeroLine(svg) {
  const m = /<line x1="20" y1="([\d.]+)" x2="197" y2="[\d.]+" stroke="[^"]+" stroke-width="0.7">/.exec(svg);
  assert.ok(m, 'premise: the zero line draws');
  return Number(m[1]);
}

const near = (a, b) => Math.abs(a - b) < 1e-9;
const preview = (over, env) => FC.forecastPreview(Object.assign({}, NONE, over), env || COLOR);
const eighth = (rows) => Math.floor(rows / 8);

test('the eighth, the label gap and the inset: one number each, the watch\'s', () => {
  const header = read('src/c/appendix/temp_axis_pad.h');
  const define = (name) => Number(new RegExp('#define ' + name + ' (\\d+)').exec(header)[1]);
  assert.equal(FC.TEMP_AXIS_ANCHOR_DIV, define('TEMP_AXIS_ANCHOR_DIV'));
  assert.equal(FC.TEMP_AXIS_ANCHOR_DIV, 8, 'owner, 2026-10-02: a quarter is too much, "much less"');
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

test('an eighth of the unbanded plot is under today\'s 12: the anchored edges keep it', () => {
  assert.equal(eighth(PB - 7), 10);
  const plain = curveRows(preview({}));
  [{ barSource: 'rain' }, { barSource: 'rain', rainBarFrom: 'top' },
    { secondaryLine: 'uv', uvLineFrom: 'top', barSource: 'rain' },
    { secondaryLine: 'precip_prob', secondaryLineFill: true, precipLineFrom: 'top', barSource: 'rain' }].forEach((over) => {
    assert.deepEqual(curveRows(preview(over)), plain, JSON.stringify(over));
  });
  // Under a bottom stripe band and standing bars the plot is shorter still.
  const lifted = curveRows(preview({ thirdLine: 'uv', thirdLineStyle: 'stripeBottom', barSource: 'rain' }));
  assert.ok(near(lifted.bottom, PB - 6 - 12));
});

test('under a top stripe band the top margin becomes an eighth of the plot below it while something hangs', () => {
  const S = { thirdLine: 'uv', thirdLineStyle: 'stripeTop' };
  const share = eighth(PB - BAND);
  assert.equal(share, 10);
  assert.ok(near(curveRows(preview(S)).top, BAND), 'nothing hangs: right under the band');
  const hang = curveRows(preview(Object.assign({ secondaryLine: 'cloud', cloudLineFrom: 'top' }, S)));
  assert.ok(near(hang.top, BAND + share));
  const bars = curveRows(preview(Object.assign({ barSource: 'rain', rainBarFrom: 'top' }, S)));
  assert.ok(near(bars.top, BAND + share), 'hanging bars too');
  ['dots', 'x'].forEach((style) => {
    const marks = curveRows(preview(Object.assign({ secondaryLine: 'uv', secondaryLineStyle: style, uvLineFrom: 'top',
      thirdLine: 'cloud', thirdLineStyle: 'stripeTop' })));
    assert.ok(near(marks.top, BAND + share), style);
  });
  // A pressure line floats: it anchors nothing, as feels-like and dew point do
  // (draw-from.test.js lineAnchor).
  assert.ok(near(curveRows(preview(Object.assign({ fourthLine: 'feels' }, S))).top, BAND));
});

test('a stripe with nothing above 0 takes no band: the plot grows into it', () => {
  // A top UV stripe that never reaches its warn level: no cells, no band; the graph is the
  // one with no stripe configured at all, the legend aside.
  const off = preview({ thirdLine: 'uv', thirdLineStyle: 'stripeTop' }), offRows = curveRows(off);
  const zero = preview(Object.assign({ thirdLine: 'uv', thirdLineStyle: 'stripeTop' }, UV_NEVER));
  assert.ok(near(offRows.top, BAND), 'premise: a drawn stripe holds its band');
  assert.deepEqual(curveRows(zero), curveRows(preview({})));
  // ...with a warn level the sample reaches, the band is back.
  assert.ok(near(curveRows(preview(Object.assign({ thirdLine: 'uv', thirdLineStyle: 'stripeTop' }, UV_SOME))).top, BAND));
  // A hanging line with that all-zero stripe: the top of the whole graph is anchored, and an
  // eighth of it (10) is under today's 12.
  const hang = curveRows(preview(Object.assign({ secondaryLine: 'cloud', cloudLineFrom: 'top', thirdLine: 'uv',
    thirdLineStyle: 'stripeTop' }, UV_NEVER)));
  assert.ok(near(hang.top, 4 + 3 + 12));
  // A bottom stripe with nothing above 0: the zero line stays on the axis.
  assert.equal(zeroLine(preview(Object.assign({ thirdLine: 'uv', thirdLineStyle: 'stripeBottom' }, UV_NEVER))), PB);
  assert.equal(zeroLine(preview(Object.assign({ thirdLine: 'uv', thirdLineStyle: 'stripeBottom' }, UV_SOME))), PB - 6);
});

test('two top stripes, one with nothing above 0: only that one drops', () => {
  const two = { thirdLine: 'uv', thirdLineStyle: 'stripeTop', fourthLine: 'cloud', fourthLineStyle: 'stripeTop' };
  // Both drawn: two stripes and their gap.
  assert.ok(near(curveRows(preview(Object.assign({}, two, UV_SOME))).top, 4 + 5 + 1 + 5 + 2));
  // The UV stripe all zero: the cloud stripe closes up into the first slot.
  const svg = preview(Object.assign({}, two, UV_NEVER));
  assert.ok(near(curveRows(svg).top, BAND));
  const one = preview({ fourthLine: 'cloud', fourthLineStyle: 'stripeTop', thirdLine: 'off' });
  const cells = (s) => s.match(/<rect x="[\d.]+" y="4" width="[\d.]+" height="5"/g) || [];
  assert.ok(cells(svg).length > 0, 'the cloud cells draw in the first slot');
  assert.deepEqual(cells(svg), cells(one));
});

test('a line with nothing above 0 anchors nothing', () => {
  // A UV line hanging under a top cloud stripe, Show: Alert: nothing above its warn level,
  // nothing anchored, the curve right under the band; with a warn level it reaches, an eighth.
  const S = { thirdLine: 'cloud', thirdLineStyle: 'stripeTop', secondaryLine: 'uv', uvLineFrom: 'top' };
  assert.ok(near(curveRows(preview(Object.assign({}, S, UV_NEVER))).top, BAND));
  assert.ok(near(curveRows(preview(Object.assign({}, S, UV_SOME))).top, BAND + eighth(PB - BAND)));
});

test('a feels-like line rides the same margins as the temperature curve', () => {
  const FEELS = [21, 21, 19, 17, 15, 13, 12, 11, 11, 12, 15, 17];
  // The Main metric off, so the feels-like line is the one thin path; rain-chance dots hang
  // under a top cloud stripe, so the top margin is an eighth of the plot under the band.
  const svg = preview({ secondaryLine: 'off', thirdLine: 'feels', thirdLineStyle: 'line', fourthLine: 'cloud',
    fourthLineStyle: 'stripeTop', fifthLine: 'precip_prob', fifthLineStyle: 'dots', precipLineFrom: 'top' });
  const temp = tempVertices(svg).map((p) => p[1]);
  const m = /<path d="([^"]+)" fill="none" stroke="[^"]+" stroke-width="1.6"><\/path>/.exec(svg);
  assert.ok(m, 'premise: the feels-like line draws');
  const feels = [...m[1].matchAll(/(-?[\d.]+),(-?[\d.]+)/g)].map((p) => Number(p[2]))
    .filter((p, i) => i === 0 || i % 3 === 0);
  assert.equal(feels.length, FEELS.length);
  // The joint band's top is the air's high (no padding under a top stripe): an eighth down.
  assert.ok(near(Math.min.apply(null, temp), BAND + eighth(PB - BAND)));
  // One linear map for both: y = ybot - (t - tmin) * k.
  const k = (temp[7] - temp[0]) / (24 - 14);
  FEELS.forEach((f, i) => assert.ok(near(feels[i], temp[i] + (TEMPS[i] - f) * k), 'hour ' + i));
});

test('aplite previews keep the frozen margins and labels, whatever is drawn', () => {
  const S = { secondaryLine: 'precip_prob', secondaryLineFill: true, barSource: 'rain' };
  const rows = curveRows(preview(S, APLITE));
  assert.ok(near(rows.top, 19) && near(rows.bottom, PB - 12));
  const labels = labelBases(preview(S, APLITE));
  assert.ok(near(labels.hi, 4 + 11) && near(labels.lo, PB - 1));
});

test('nothing anchored, or nothing moved: the labels keep today\'s corners, as the watch\'s do', () => {
  [{}, { rainBarFrom: 'top' }, { barSource: 'rain' }, { barSource: 'rain', rainBarFrom: 'top' },
    { secondaryLine: 'uv', uvLineFrom: 'top', barSource: 'rain' }].forEach((over) => {
    const labels = labelBases(preview(over, BASALT));
    assert.ok(near(labels.hi, 4 + 11) && near(labels.lo, PB - 1), JSON.stringify(over));
  });
  // A bottom stripe band: the lo label stays on the lifted plot's floor.
  const lifted = labelBases(preview({ thirdLine: 'uv', thirdLineStyle: 'stripeBottom' }, BASALT));
  assert.ok(near(lifted.hi, 4 + 11) && near(lifted.lo, PB - 6 - 1));
});

test('the hi label sits level with the curve\'s top once a hanging element pushes it down', () => {
  const svg = preview({ thirdLine: 'cloud', thirdLineStyle: 'stripeTop', secondaryLine: 'precip_prob',
    precipLineFrom: 'top' }, BASALT);
  const rows = curveRows(svg);
  const labels = labelBases(svg);
  assert.ok(near(rows.top, BAND + eighth(PB - BAND)), 'premise: the top margin grew');
  // The ink (the cap above the baseline) is centred on the row; the lo label stays.
  assert.ok(near(labels.hi - FC.LABEL_CAP / 2, rows.top));
  assert.ok(near(labels.lo, PB - 1));
  // Never further out than before.
  assert.ok(labels.hi >= 4 + 11);
});

test('with a feels-like line the labels follow the temperature\'s own extremes, not the joint band', () => {
  const svg = preview({ thirdLine: 'feels', barSource: 'rain' }, BASALT);
  const rows = curveRows(svg);
  const labels = labelBases(svg);
  // Premise: the feels-like low widens the band, so the air's low sits above its floor; the
  // air's high is the band's top, today's reach.
  assert.ok(rows.bottom < PB - 12 - 1);
  assert.ok(near(rows.top, 4 + 3 + 12));
  assert.ok(near(labels.lo - FC.LABEL_CAP / 2, rows.bottom));
  assert.ok(near(labels.hi, 4 + 11), 'the hi label keeps its corner');
});

test('alignLabels: off today\'s reach only, inward only, the minimum gap, else today\'s place for both', () => {
  const cap = FC.LABEL_CAP;
  const gap = FC.TEMP_LABEL_MIN_INK_GAP * FC.CURVE_INSET_PREV / FC.WATCH_INSET_PX;
  // Room: both centred on their rows, each inside today's reach (19 .. 82).
  assert.deepEqual(FC.alignLabels(15, 93, 30, 70, 19, 82), { hi: 30 + cap / 2, lo: 70 + cap / 2 });
  // A row at today's reach stays where it is: the curve reaches its edge, the label stays.
  assert.deepEqual(FC.alignLabels(15, 93, 19, 82, 19, 82), { hi: 15, lo: 93 });
  assert.deepEqual(FC.alignLabels(15, 93, 19, 70, 19, 82), { hi: 15, lo: 70 + cap / 2 });
  // A row beyond today's label clamps to today's (the hi row above it, the lo row below it).
  assert.deepEqual(FC.alignLabels(15, 93, 12, 95, 11, 96), { hi: 15, lo: 93 });
  // Exactly the gap fits; a hair less falls back to today's place for both.
  const hi = 30 + cap / 2;
  const fits = hi + gap + cap - cap / 2;
  assert.deepEqual(FC.alignLabels(15, 93, 30, fits, 19, 82), { hi: hi, lo: fits + cap / 2 });
  assert.deepEqual(FC.alignLabels(15, 93, 30, fits - 0.01, 19, 82), { hi: 15, lo: 93 });
  // A flat curve: today's place.
  assert.deepEqual(FC.alignLabels(15, 93, 50, 50, 19, 82), { hi: 15, lo: 93 });
});
