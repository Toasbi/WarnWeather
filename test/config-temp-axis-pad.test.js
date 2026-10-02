// test/config-temp-axis-pad.test.js — the settings preview's mirror of the forecast plot's
// layout, the temperature-axis margins and the hi/lo labels (src/c/appendix/temp_axis_pad.h;
// owner, 2026-10-02). Only an element with a value above 0 takes part: a stripe with none
// takes no band, a line or the bars with none anchor no edge. On each edge something is drawn
// from (the rain bars, an amount line, its marks or fill) the temperature curve and the lines on
// its axis keep at least an eighth of the plot between the stripe bands, or from 64 watch rows
// on its square over 512 (a share that grows with the plot, taken in watch rows); an edge
// nothing is drawn from keeps today's margin. The labels sit level with the curve's extremes
// when there is space, and stay put while the curve reaches today's margins on an edge without
// a stripe band; under a top stripe band the hi label follows the watch's plain rule. The
// watch half is pinned on the host by test/c/temp_axis_pad_test.c; this file pins the preview
// and the constants both share.
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
// under a top stripe band). An eighth of the 87-unit band is 10, under today's 12, and the
// curve, taken in watch rows (12 units to the watch's 7 px), gives less there (50 rows: 4 px,
// 6.9 units): it passes the eighth only from 64 rows, so every preview plot keeps the flat
// eighth's margins and they only grow under a top stripe band (0 today) — as in the watch's
// default view, whose 55 rows also keep their 7 px.
const PB = 94;
const BAND = 4 + 5 + 2;
const TEMPS = [24, 24, 22, 20, 18, 16, 15, 14, 14, 15, 17, 19];
// Nothing anchored: the bars off, the Main metric a pressure line (it floats).
const NONE = { secondaryLine: 'pressure', secondaryLineFill: false, thirdLine: 'off', fourthLine: 'off',
  fifthLine: 'off', barSource: 'off', dayNightShading: false, theme: 'dark' };
// A UV line drawn Show: Alert whose warn level the plain sample (UV 8 at most) never reaches.
// On Alert the preview redraws the sample against the levels (preview-forecast.js
// alertSamples), so it still draws, as a line, marks or a stripe: the preview never meets an
// element with nothing above 0, whose rule test/c/temp_axis_pad_test.c pins on the watch.
const UV_HIGH = { uvLineShow: 'alert', threshUvWarn: 10, threshUvDanger: 11 };
// The same line with a warn level the afternoon reaches.
const UV_SOME = { uvLineShow: 'alert', threshUvWarn: 3, threshUvDanger: 11 };

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
const HEADER = read('src/c/appendix/temp_axis_pad.h');
const define = (name) => Number(new RegExp('#define ' + name + ' (\\d+)').exec(HEADER)[1]);
/**
 * The flat eighth of a plot `units` preview units tall (the floor), in units.
 * @param {number} units Plot height in preview units (an integer, as PB - MT always is).
 * @returns {number} Preview units.
 */
const eighth = (units) => Math.floor(units / 8);
/**
 * The curve's share of a plot `units` preview units tall, worked out apart from the preview:
 * the plot in whole watch rows (7 px to 12 units), the header's integer square over its
 * divisor, and those px back in units.
 * @param {number} units Plot height in preview units (an integer, as PB - MT always is).
 * @returns {number} Preview units.
 */
const curve = (units) => {
  const rows = Math.floor(units * 7 / 12);
  return Math.floor(rows * rows / define('TEMP_AXIS_PAD_SQ_DIV')) * 12 / 7;
};
/**
 * An anchored edge's share: the larger of the eighth and the curve.
 * @param {number} units Plot height in preview units.
 * @returns {number} Preview units.
 */
const share = (units) => Math.max(eighth(units), curve(units));

test('the curve, the label gap and the inset: one number each, the watch\'s', () => {
  assert.equal(FC.TEMP_AXIS_PAD_SQ_DIV, define('TEMP_AXIS_PAD_SQ_DIV'));
  assert.equal(FC.TEMP_AXIS_PAD_SQ_DIV, 512,
    'owner, 2026-10-02: "with more space in larger graphs, the padding to top and bottom can be larger than the 1/8"');
  assert.equal(FC.TEMP_LABEL_MIN_INK_GAP, define('TEMP_LABEL_MIN_INK_GAP'));
  assert.equal(FC.CURVE_INSET_PREV, 12, 'the scale the curve is taken at: 12 units to the inset');
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

test('the share: the eighth, or the curve in watch rows past it; the preview\'s plots, the watch\'s views', () => {
  // Every integer plot height, against the share worked out apart from the preview; never
  // below the flat eighth (the curve only ever adds room), never smaller for a taller plot.
  for (let units = 0; units <= 400; units += 1) {
    assert.ok(near(FC.anchorShare(units), share(units)), String(units));
    assert.ok(FC.anchorShare(units) >= eighth(units), String(units));
    if (units > 0) { assert.ok(FC.anchorShare(units) >= FC.anchorShare(units - 1), String(units)); }
  }
  // Every plot the preview can lay out (at most the unbanded 87 units, 50 watch rows) keeps
  // the flat eighth exactly: the curve passes it only from 64 watch rows.
  for (let units = 0; units <= PB - 7; units += 1) {
    assert.equal(FC.anchorShare(units), eighth(units), String(units));
  }
  // The preview's own plots: unbanded 87 units, under a bottom stripe band 81, under one top
  // stripe band 83: 10 each; under two 77: 9 — where the curve alone gives 4, 4, 4 and 3 px
  // (6.9 and 5.1 units), as the watch's default view's would (55 rows 5 px, 49 under one top
  // stripe 4, 44 under two 3) against its eighth's 6, 6 and 5.
  [[87, 10, 4], [81, 10, 4], [83, 10, 4], [77, 9, 3]].forEach((c) => {
    assert.equal(FC.anchorShare(c[0]), c[1], String(c));
    assert.ok(near(curve(c[0]), c[2] * 12 / 7), String(c));
  });
  // The watch's no-calendar views at the preview's scale: basalt's 77 rows (132 units) 11 px,
  // emery's 91 (156 units) 16 px — the curve, past their eighths (16 and 19 units).
  assert.ok(near(FC.anchorShare(77 * 12 / 7), 11 * 12 / 7));
  assert.ok(near(FC.anchorShare(91 * 12 / 7), 16 * 12 / 7));
});

test('the share of the unbanded plot is under today\'s 12: the anchored edges keep it', () => {
  assert.equal(FC.anchorShare(PB - 7), 10);
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

test('under a top stripe band the top margin becomes the share of the plot below it while something hangs', () => {
  const S = { thirdLine: 'uv', thirdLineStyle: 'stripeTop' };
  const hung = share(PB - BAND);
  assert.equal(hung, 10, '83 units: an eighth, 10 (the curve alone: 48 watch rows, 4 px)');
  assert.ok(near(curveRows(preview(S)).top, BAND), 'nothing hangs: right under the band');
  const hang = curveRows(preview(Object.assign({ secondaryLine: 'cloud', cloudLineFrom: 'top' }, S)));
  assert.ok(near(hang.top, BAND + hung));
  const bars = curveRows(preview(Object.assign({ barSource: 'rain', rainBarFrom: 'top' }, S)));
  assert.ok(near(bars.top, BAND + hung), 'hanging bars too');
  ['dots', 'x'].forEach((style) => {
    const marks = curveRows(preview(Object.assign({ secondaryLine: 'uv', secondaryLineStyle: style, uvLineFrom: 'top',
      thirdLine: 'cloud', thirdLineStyle: 'stripeTop' })));
    assert.ok(near(marks.top, BAND + hung), style);
  });
  // A pressure line floats: it anchors nothing, as feels-like and dew point do
  // (draw-from.test.js lineAnchor).
  assert.ok(near(curveRows(preview(Object.assign({ fourthLine: 'feels' }, S))).top, BAND));
  // Under two top stripe bands (17 units) a hanging line keeps an eighth of the 77 under them,
  // 9 (the curve alone: 44 watch rows, 3 px, 5.1 units).
  const BAND2 = 4 + 5 + 1 + 5 + 2;
  const two = curveRows(preview(Object.assign({ secondaryLine: 'precip_prob', precipLineFrom: 'top',
    fourthLine: 'cloud', fourthLineStyle: 'stripeTop' }, S, UV_SOME)));
  assert.equal(share(PB - BAND2), 9);
  assert.ok(near(two.top, BAND2 + 9));
});

test('a stripe on Alert holds its band at any warn level: the preview\'s sample reaches it', () => {
  // A top UV stripe whose warn level the plain sample never reaches draws its cells all the
  // same, so it holds its band, as with a warn level the sample reaches and on All.
  const off = preview({ thirdLine: 'uv', thirdLineStyle: 'stripeTop' }), offRows = curveRows(off);
  assert.ok(near(offRows.top, BAND), 'premise: a drawn stripe holds its band');
  [UV_HIGH, UV_SOME].forEach((levels) => {
    const label = JSON.stringify(levels);
    assert.deepEqual(curveRows(preview(Object.assign({ thirdLine: 'uv', thirdLineStyle: 'stripeTop' }, levels))),
      offRows, label);
    // A hanging line under it: the share (an eighth) of the plot below the band.
    const hang = curveRows(preview(Object.assign({ secondaryLine: 'cloud', cloudLineFrom: 'top', thirdLine: 'uv',
      thirdLineStyle: 'stripeTop' }, levels)));
    assert.ok(near(hang.top, BAND + share(PB - BAND)), label);
    // A bottom stripe lifts the zero line off the axis.
    assert.equal(zeroLine(preview(Object.assign({ thirdLine: 'uv', thirdLineStyle: 'stripeBottom' }, levels))),
      PB - 6, label);
  });
});

test('two top stripes, one on Alert: both keep their slots', () => {
  const two = { thirdLine: 'uv', thirdLineStyle: 'stripeTop', fourthLine: 'cloud', fourthLineStyle: 'stripeTop' };
  [UV_HIGH, UV_SOME].forEach((levels) => assert.ok(
    near(curveRows(preview(Object.assign({}, two, levels))).top, 4 + 5 + 1 + 5 + 2), JSON.stringify(levels)));
});

test('a line on Alert anchors its edge at any warn level', () => {
  // A UV line hanging under a top cloud stripe, Show: Alert: the share (an eighth) of the plot
  // below the band, whether the plain sample reaches its warn level or not.
  const S = { thirdLine: 'cloud', thirdLineStyle: 'stripeTop', secondaryLine: 'uv', uvLineFrom: 'top' };
  [UV_HIGH, UV_SOME].forEach((levels) => assert.ok(
    near(curveRows(preview(Object.assign({}, S, levels))).top, BAND + share(PB - BAND)), JSON.stringify(levels)));
});

test('a feels-like line rides the same margins as the temperature curve', () => {
  const FEELS = [21, 21, 19, 17, 15, 13, 12, 11, 11, 12, 15, 17];
  // The Main metric off, so the feels-like line is the one thin path; rain-chance dots hang
  // under a top cloud stripe, so the top margin is the share (an eighth) of the plot under the
  // band.
  const svg = preview({ secondaryLine: 'off', thirdLine: 'feels', thirdLineStyle: 'line', fourthLine: 'cloud',
    fourthLineStyle: 'stripeTop', fifthLine: 'precip_prob', fifthLineStyle: 'dots', precipLineFrom: 'top' });
  const temp = tempVertices(svg).map((p) => p[1]);
  const m = /<path d="([^"]+)" fill="none" stroke="[^"]+" stroke-width="1.6"><\/path>/.exec(svg);
  assert.ok(m, 'premise: the feels-like line draws');
  const feels = [...m[1].matchAll(/(-?[\d.]+),(-?[\d.]+)/g)].map((p) => Number(p[2]))
    .filter((p, i) => i === 0 || i % 3 === 0);
  assert.equal(feels.length, FEELS.length);
  // The joint band's top is the air's high (no padding under a top stripe): the share down.
  assert.ok(near(Math.min.apply(null, temp), BAND + share(PB - BAND)));
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

test('under a top stripe band the hi label follows the curve\'s top with nothing anchored, as the watch\'s does', () => {
  // The watch's hi label is fixed to the top of the graph, not to the band: one stripe leaves
  // the curve's top above the label's ink, so it stays; two or three push the curve's top below
  // it (basalt's default view: band 11 or 16 rows against the ink's centre row 9) and the label
  // moves down with it (temp_axis_pad.h temp_labels_align, no reach gate there).
  const top = (over) => Object.assign({ thirdLine: 'uv', thirdLineStyle: 'stripeTop' }, UV_SOME, over);
  const one = preview(top({}), BASALT);
  assert.ok(near(curveRows(one).top, BAND), 'premise: nothing anchored, right under the band');
  assert.ok(near(labelBases(one).hi, 4 + 11), 'one stripe: the hi label keeps its corner');
  const cases = [
    { over: { fourthLine: 'cloud', fourthLineStyle: 'stripeTop' }, band: 4 + 5 + 1 + 5 + 2 },
    { over: { fourthLine: 'cloud', fourthLineStyle: 'stripeTop', fifthLine: 'precip_prob',
      fifthLineStyle: 'stripeTop' }, band: 4 + 3 * 5 + 2 * 1 + 2 }
  ];
  cases.forEach((c) => {
    const svg = preview(top(c.over), BASALT);
    const rows = curveRows(svg);
    const labels = labelBases(svg);
    assert.ok(near(rows.top, c.band), 'premise: nothing anchored, the curve right under the band');
    // The ink (the cap above the baseline) is centred on the curve's top; the lo label stays.
    assert.ok(near(labels.hi - FC.LABEL_CAP / 2, rows.top), JSON.stringify(c.over));
    assert.ok(near(labels.lo, PB - 1));
  });
  // 19.8 and 25.8: where 7e6cc716's preview put them, in step with the watch.
  assert.ok(near(labelBases(preview(top(cases[0].over), BASALT)).hi, 19.8));
  assert.ok(near(labelBases(preview(top(cases[1].over), BASALT)).hi, 25.8));
});

test('the hi label sits level with the curve\'s top once a hanging element pushes it down', () => {
  const svg = preview({ thirdLine: 'cloud', thirdLineStyle: 'stripeTop', secondaryLine: 'precip_prob',
    precipLineFrom: 'top' }, BASALT);
  const rows = curveRows(svg);
  const labels = labelBases(svg);
  assert.ok(near(rows.top, BAND + share(PB - BAND)), 'premise: the top margin grew');
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
  // No gate (under a top stripe band): the hi label follows any curve top inward of its own
  // ink, and keeps its place above that.
  assert.deepEqual(FC.alignLabels(15, 93, 17, 82, -Infinity, 82), { hi: 17 + cap / 2, lo: 93 });
  assert.deepEqual(FC.alignLabels(15, 93, 11, 82, -Infinity, 82), { hi: 15, lo: 93 });
});
