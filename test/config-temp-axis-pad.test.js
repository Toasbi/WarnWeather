// test/config-temp-axis-pad.test.js — the settings preview's mirror of the forecast plot's
// layout, the temperature-axis margins and the hi/lo labels (src/c/appendix/temp_axis_pad.h;
// owner, 2026-10-02). Only an element with a value above 0 takes part: a stripe with none
// takes no band, a line or the bars with none anchor no edge. On each edge something is drawn
// from (the rain bars, an amount line, its marks or fill) the temperature curve keeps at least
// an eighth of the plot between the stripe bands, or from 64 watch rows
// on its square over 512 (a share that grows with the plot, taken in watch rows); an edge
// nothing is drawn from keeps the inset, the top under a top stripe band too (owner,
// 2026-10-02: "minimum how it is at the bottom.. it's too cramped otherwise"). The labels sit
// level with the curve's extremes when there is space, and stay put while the curve reaches
// today's margins on an edge without a stripe band; under a top stripe band the hi label
// follows the watch's plain rule. The lowest and highest value of the temperature and of
// every feels-like or dew point line drawn fill the margins, all three on one scale, so no
// curve runs past a margin (temp_axis_pad.h THE SCALE; owner, 2026-10-04: "always fit all
// lines"). The watch half is pinned on the host by test/c/temp_axis_pad_test.c; this file
// pins the preview and the constants both share.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const platform = require('../src/pkjs/config-ui/lib/platform.js');
require('../src/pkjs/config-ui/lib/schema-walk.js');
require('../src/pkjs/config-ui/lib/color.js');
require('../src/pkjs/config-ui/lib/engine.js');
const FC = require('../src/pkjs/settings/preview-forecast.js');
const PA = require('../src/pkjs/settings/preview-axis.js');
const { cDefine } = require('./helpers/c-source.js');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const BASALT = platform.computeEnv({ platform: 'basalt' });
const APLITE = platform.computeEnv({ platform: 'aplite' });
const COLOR = { color: true };

// The preview's plot (preview-forecast.js): PT 4, PB 94 without a bottom stripe, MT = PT + 3
// (where a full-height metric lands) or the foot of a top stripe band (11 under one stripe:
// 5 rows and its 2 gap rows). The inset is 12 units at the bottom and at the top, under a top
// stripe band too. An eighth of the 87-unit band is 10, under the 12, and the curve, taken in
// watch rows (12 units to the watch's 7 px), gives less there (50 rows: 4 px, 6.9 units): it
// passes the eighth only from 64 rows, so every preview plot keeps the flat eighth's share,
// which never passes the inset: an anchored edge keeps its 12 units, as the watch's default
// view, whose 55 rows (49 under one top stripe) keep their 7 px.
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
  return Math.floor(rows * rows / cDefine(HEADER, 'TEMP_AXIS_PAD_SQ_DIV')) * 12 / 7;
};
/**
 * An anchored edge's share: the larger of the eighth and the curve.
 * @param {number} units Plot height in preview units.
 * @returns {number} Preview units.
 */
const share = (units) => Math.max(eighth(units), curve(units));

test('the curve, the label gap and the inset: one number each, the watch\'s', () => {
  assert.equal(PA.TEMP_AXIS_PAD_SQ_DIV, cDefine(HEADER, 'TEMP_AXIS_PAD_SQ_DIV'));
  assert.equal(PA.TEMP_AXIS_PAD_SQ_DIV, 512,
    'owner, 2026-10-02: "with more space in larger graphs, the padding to top and bottom can be larger than the 1/8"');
  assert.equal(PA.TEMP_LABEL_MIN_INK_GAP, cDefine(HEADER, 'TEMP_LABEL_MIN_INK_GAP'));
  assert.equal(PA.CURVE_INSET_PREV, 12, 'the scale the curve is taken at: 12 units to the inset');
  assert.equal(PA.WATCH_INSET_PX,
    cDefine(read('src/c/appendix/bottom_view.h'), 'BOTTOM_VIEW_PRIMARY_LINE_INSET_Y'));
  assert.equal(PA.WATCH_INSET_PX, Number(/var CURVE_INSET_PX = (\d+);/.exec(read('src/pkjs/clay-payload.js'))[1]));
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
    assert.ok(near(PA.anchorShare(units), share(units)), String(units));
    assert.ok(PA.anchorShare(units) >= eighth(units), String(units));
    if (units > 0) { assert.ok(PA.anchorShare(units) >= PA.anchorShare(units - 1), String(units)); }
  }
  // Every plot the preview can lay out (at most the unbanded 87 units, 50 watch rows) keeps
  // the flat eighth exactly: the curve passes it only from 64 watch rows.
  for (let units = 0; units <= PB - 7; units += 1) {
    assert.equal(PA.anchorShare(units), eighth(units), String(units));
  }
  // The preview's own plots: unbanded 87 units, under a bottom stripe band 81, under one top
  // stripe band 83: 10 each; under two 77: 9 — where the curve alone gives 4, 4, 4 and 3 px
  // (6.9 and 5.1 units), as the watch's default view's would (55 rows 5 px, 49 under one top
  // stripe 4, 44 under two 3) against its eighth's 6, 6 and 5.
  [[87, 10, 4], [81, 10, 4], [83, 10, 4], [77, 9, 3]].forEach((c) => {
    assert.equal(PA.anchorShare(c[0]), c[1], String(c));
    assert.ok(near(curve(c[0]), c[2] * 12 / 7), String(c));
  });
  // The watch's no-calendar views at the preview's scale: basalt's 77 rows (132 units) 11 px,
  // emery's 91 (156 units) 16 px — the curve, past their eighths (16 and 19 units).
  assert.ok(near(PA.anchorShare(77 * 12 / 7), 11 * 12 / 7));
  assert.ok(near(PA.anchorShare(91 * 12 / 7), 16 * 12 / 7));
});

test('the share of the unbanded plot is under today\'s 12: the anchored edges keep it', () => {
  assert.equal(PA.anchorShare(PB - 7), 10);
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

test('under a top stripe band the top keeps the inset, the same 12 units as the bottom', () => {
  // The owner's rule (2026-10-02): at least the inset under the band, max(inset, share) when
  // something hangs. The share of the plot under one band (83 units) is an eighth, 10 (the
  // curve alone: 48 watch rows, 4 px), under the 12, so hanging or not the top keeps 12 —
  // as the watch's default view does (49 rows under one stripe: 7 px either way).
  const S = { thirdLine: 'uv', thirdLineStyle: 'stripeTop' };
  const hung = share(PB - BAND);
  assert.equal(hung, 10, '83 units: an eighth, 10 (the curve alone: 48 watch rows, 4 px)');
  const plain = curveRows(preview(S));
  assert.ok(near(plain.top, BAND + 12), 'nothing hangs: the inset under the band');
  assert.ok(near(plain.bottom, PB - 12), 'as at the bottom');
  const hang = curveRows(preview(Object.assign({ secondaryLine: 'cloud', cloudLineFrom: 'top' }, S)));
  assert.ok(near(hang.top, BAND + Math.max(12, hung)));
  const bars = curveRows(preview(Object.assign({ barSource: 'rain', rainBarFrom: 'top' }, S)));
  assert.ok(near(bars.top, BAND + Math.max(12, hung)), 'hanging bars too');
  ['dots', 'x'].forEach((style) => {
    const marks = curveRows(preview(Object.assign({ secondaryLine: 'uv', secondaryLineStyle: style, uvLineFrom: 'top',
      thirdLine: 'cloud', thirdLineStyle: 'stripeTop' })));
    assert.ok(near(marks.top, BAND + Math.max(12, hung)), style);
  });
  // A floating line (pressure, feels-like, dew point) anchors nothing (draw-from.test.js
  // lineEdge): the inset.
  assert.ok(near(curveRows(preview(Object.assign({ fourthLine: 'feels' }, S))).top, BAND + 12));
  // Under two top stripe bands (17 units) a hanging line's share is an eighth of the 77 under
  // them, 9 (the curve alone: 44 watch rows, 3 px, 5.1 units): the inset again.
  const BAND2 = 4 + 5 + 1 + 5 + 2;
  const two = curveRows(preview(Object.assign({ secondaryLine: 'precip_prob', precipLineFrom: 'top',
    fourthLine: 'cloud', fourthLineStyle: 'stripeTop' }, S, UV_SOME)));
  assert.equal(share(PB - BAND2), 9);
  assert.ok(near(two.top, BAND2 + 12));
  // The curve spans the plot under the band less the inset at each edge: as much less than
  // without a band as the band's foot (11) lies below the plain plot's top (7).
  const none = curveRows(preview({}));
  assert.ok(near(plain.bottom - plain.top, none.bottom - none.top - (BAND - (4 + 3))));
});

test('a stripe on Alert holds its band at any warn level: the preview\'s sample reaches it', () => {
  // A top UV stripe whose warn level the plain sample never reaches draws its cells all the
  // same, so it holds its band, as with a warn level the sample reaches and on All.
  const off = preview({ thirdLine: 'uv', thirdLineStyle: 'stripeTop' }), offRows = curveRows(off);
  assert.ok(near(offRows.top, BAND + 12), 'premise: a drawn stripe holds its band');
  [UV_HIGH, UV_SOME].forEach((levels) => {
    const label = JSON.stringify(levels);
    assert.deepEqual(curveRows(preview(Object.assign({ thirdLine: 'uv', thirdLineStyle: 'stripeTop' }, levels))),
      offRows, label);
    // A hanging line under it: the inset, which the share (an eighth) of the plot below the
    // band does not reach.
    const hang = curveRows(preview(Object.assign({ secondaryLine: 'cloud', cloudLineFrom: 'top', thirdLine: 'uv',
      thirdLineStyle: 'stripeTop' }, levels)));
    assert.ok(near(hang.top, BAND + Math.max(12, share(PB - BAND))), label);
    // A bottom stripe lifts the zero line off the axis.
    assert.equal(zeroLine(preview(Object.assign({ thirdLine: 'uv', thirdLineStyle: 'stripeBottom' }, levels))),
      PB - 6, label);
  });
});

test('two top stripes, one on Alert: both keep their slots', () => {
  const two = { thirdLine: 'uv', thirdLineStyle: 'stripeTop', fourthLine: 'cloud', fourthLineStyle: 'stripeTop' };
  [UV_HIGH, UV_SOME].forEach((levels) => assert.ok(
    near(curveRows(preview(Object.assign({}, two, levels))).top, 4 + 5 + 1 + 5 + 2 + 12), JSON.stringify(levels)));
});

test('a line on Alert hanging under a top stripe: the top keeps its inset at any warn level', () => {
  // A UV line hanging under a top cloud stripe, Show: Alert: max(the inset, the share of the
  // plot below the band), the inset in the preview's plot, whether the plain sample reaches
  // its warn level or not.
  const S = { thirdLine: 'cloud', thirdLineStyle: 'stripeTop', secondaryLine: 'uv', uvLineFrom: 'top' };
  [UV_HIGH, UV_SOME].forEach((levels) => assert.ok(
    near(curveRows(preview(Object.assign({}, S, levels))).top, BAND + Math.max(12, share(PB - BAND))),
    JSON.stringify(levels)));
});

test('a feels-like line rides the temperature curve\'s scale, its margins and all', () => {
  const FEELS = [21, 21, 19, 17, 15, 14, 13, 13, 13, 14, 15, 17];
  // The Main metric off, so the feels-like line is the one thin path; rain-chance dots hang
  // under a top cloud stripe, so the top margin is max(the inset, the share of the plot under
  // the band): the inset.
  const svg = preview({ secondaryLine: 'off', thirdLine: 'feels', thirdLineStyle: 'line', fourthLine: 'cloud',
    fourthLineStyle: 'stripeTop', fifthLine: 'precip_prob', fifthLineStyle: 'dots', precipLineFrom: 'top' });
  const temp = tempVertices(svg).map((p) => p[1]);
  const m = /<path d="([^"]+)" fill="none" stroke="[^"]+" stroke-width="1.6"><\/path>/.exec(svg);
  assert.ok(m, 'premise: the feels-like line draws');
  const feels = [...m[1].matchAll(/(-?[\d.]+),(-?[\d.]+)/g)].map((p) => Number(p[2]))
    .filter((p, i) => i === 0 || i % 3 === 0);
  assert.equal(feels.length, FEELS.length);
  // The joint range 13..24 fills the margins (temp_axis_pad.h THE SCALE): the air's high, the
  // joint high, the inset under the band; the feels-like low (13), a degree under the air's
  // (14), the inset over the floor.
  const top = BAND + Math.max(12, share(PB - BAND));
  assert.ok(near(Math.min.apply(null, temp), top));
  assert.ok(near(Math.max.apply(null, feels), PB - 12), 'the feels-like low takes the bottom margin row');
  // One linear map for both: y = ybot - (t - 13) * k, so the air's low sits a degree, k, over
  // that row, never on it.
  const k = (PB - 12 - top) / (24 - 13);
  assert.ok(near(Math.max.apply(null, temp), PB - 12 - k), 'the air\'s low a degree over the floor row');
  FEELS.forEach((f, i) => assert.ok(near(feels[i], temp[i] + (TEMPS[i] - f) * k), 'hour ' + i));
  TEMPS.forEach((t, i) => assert.ok(near(temp[i], PB - 12 - (t - 13) * k), 'hour ' + i));
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
  // The watch's hi label is fixed to the top of the graph, not to the band: the curve's top
  // keeps its inset under the band, below the label's ink from one stripe on (basalt's default
  // view: row 6 + 7 = 13 against the ink's centre row 9), and the label moves down with it
  // (temp_axis_pad.h temp_labels_align, no reach gate there).
  const top = (over) => Object.assign({ thirdLine: 'uv', thirdLineStyle: 'stripeTop' }, UV_SOME, over);
  const cases = [
    { over: {}, band: BAND },
    { over: { fourthLine: 'cloud', fourthLineStyle: 'stripeTop' }, band: 4 + 5 + 1 + 5 + 2 },
    { over: { fourthLine: 'cloud', fourthLineStyle: 'stripeTop', fifthLine: 'precip_prob',
      fifthLineStyle: 'stripeTop' }, band: 4 + 3 * 5 + 2 * 1 + 2 }
  ];
  cases.forEach((c) => {
    const svg = preview(top(c.over), BASALT);
    const rows = curveRows(svg);
    const labels = labelBases(svg);
    assert.ok(near(rows.top, c.band + 12), 'premise: nothing anchored, the inset under the band');
    // The ink (the cap above the baseline) is centred on the curve's top; the lo label stays.
    assert.ok(near(labels.hi - PA.LABEL_CAP / 2, rows.top), JSON.stringify(c.over));
    assert.ok(near(labels.lo, PB - 1));
  });
  // 25.8, 31.8 and 37.8: 12 units below where the curve's top and the label stood before the
  // inset came back (one stripe's label kept its corner then, at 15).
  assert.ok(near(labelBases(preview(top(cases[0].over), BASALT)).hi, 25.8));
  assert.ok(near(labelBases(preview(top(cases[1].over), BASALT)).hi, 31.8));
  assert.ok(near(labelBases(preview(top(cases[2].over), BASALT)).hi, 37.8));
});

test('under a top stripe band a hanging element moves neither the curve\'s top nor the hi label', () => {
  // The share of the plot under the band (10) stays under the 12-unit inset, so the curve's
  // top and the hi label level with it are where they are with nothing hanging.
  const S = { thirdLine: 'cloud', thirdLineStyle: 'stripeTop' };
  const svg = preview(Object.assign({ secondaryLine: 'precip_prob', precipLineFrom: 'top' }, S), BASALT);
  const rows = curveRows(svg);
  const labels = labelBases(svg);
  assert.ok(near(rows.top, BAND + 12), 'premise: the inset under the band');
  assert.deepEqual(rows, curveRows(preview(S, BASALT)));
  assert.deepEqual(labels, labelBases(preview(S, BASALT)));
  // The ink (the cap above the baseline) is centred on the row; the lo label stays.
  assert.ok(near(labels.hi - PA.LABEL_CAP / 2, rows.top));
  assert.ok(near(labels.lo, PB - 1));
  // Never further out than before.
  assert.ok(labels.hi >= 4 + 11);
});

test('with a feels-like or dew line under the air\'s low, that low lifts off the floor row and the lo label follows it', () => {
  // The joint range fills the margins (temp_axis_pad.h THE SCALE; owner, 2026-10-04: "always
  // fit all lines"): the feels-like low (13) or the dew low (12) takes the bottom margin row,
  // and the air's low (14) sits a degree or two over it, as the watch's does. The air's high
  // is the joint high in every case, so its top and the hi label stay; the lo label's ink
  // centres on the lifted low (there is room: the curve's span is the plot less 1-2 degrees).
  // Until then (2026-10-02) only the temperature was fitted: its low kept the floor row and
  // the label its corner, and the lines ran on past it.
  [{ over: { thirdLine: 'feels', barSource: 'rain' }, low: 13 },
    { over: { thirdLine: 'dew', thirdLineStyle: 'line' }, low: 12 },
    { over: { secondaryLine: 'feels', fourthLine: 'dew' }, low: 12 }].forEach((c) => {
    const svg = preview(c.over, BASALT);
    const label = JSON.stringify(c.over);
    const top = 4 + 3 + 12, k = (PB - 12 - top) / (24 - c.low);
    const bottom = PB - 12 - (14 - c.low) * k;
    const rows = curveRows(svg);
    assert.ok(near(rows.top, top) && near(rows.bottom, bottom), label);
    const labels = labelBases(svg);
    assert.ok(near(labels.hi, 4 + 11) && near(labels.lo, bottom + PA.LABEL_CAP / 2), label);
  });
});

test('the scale\'s range is the temperature\'s and every drawn line\'s, the C host cases mirrored', () => {
  // test/c/temp_axis_pad_test.c test_scale_all_lines, on the preview's own helper.
  const T = [14, 18, 24, 20];
  // (1) A feels-like peak over the air's high is the range's top.
  assert.deepEqual(PA.tempAxisRange(T, [[14, 20, 30, 22]]), { min: 14, max: 30 });
  // (2) A dew trough under the air's low is its bottom.
  assert.deepEqual(PA.tempAxisRange(T, [[9, 12, 16, 14]]), { min: 9, max: 24 });
  // (3) Lines inside the temperature's range leave it the temperature's own.
  assert.deepEqual(PA.tempAxisRange(T, [[15, 20, 23, 19], [14, 16, 18, 17]]), { min: 14, max: 24 });
  // (4) An hour with no reading widens nothing.
  assert.deepEqual(PA.tempAxisRange(T, [[null, 16, null, 17]]), { min: 14, max: 24 });
  assert.deepEqual(PA.tempAxisRange(T, [[null, null, null, null]]), { min: 14, max: 24 });
  // (5) No line drawn: the temperature's own; a flat temperature stays flat (mid-plot).
  assert.deepEqual(PA.tempAxisRange(T, []), { min: 14, max: 24 });
  assert.deepEqual(PA.tempAxisRange([17, 17], []), { min: 17, max: 17 });
  // Both ways at once.
  assert.deepEqual(PA.tempAxisRange(T, [[20, 30, 26, 22], [9, 12, 16, 14]]), { min: 9, max: 30 });
  // (5) end to end: a line the watch does not draw widens nothing. Previewing aplite (no
  // WW_LINE_STYLE) the fourth and fifth lines are off, so a dew line stored there leaves
  // the temperature on its own range, today's 12-unit margins at both edges.
  const aplite = curveRows(preview({ fourthLine: 'dew', fourthLineStyle: 'line', fifthLine: 'feels' }, APLITE));
  assert.ok(near(aplite.top, 4 + 3 + 12) && near(aplite.bottom, PB - 12));
  // Nor a feels or dew pick stored on the Main or Second metric line (picked on a colour
  // watch paired to the same phone): the aplite bake drops it (forecast-series.js
  // tempAxisLineDrawn) and the frozen fork has no fit, so the air's low keeps the floor row.
  [{ secondaryLine: 'feels' }, { thirdLine: 'dew', thirdLineStyle: 'line' },
    { secondaryLine: 'feels', thirdLine: 'dew' }].forEach((over) => {
    const rows = curveRows(preview(over, APLITE));
    assert.ok(near(rows.top, 4 + 3 + 12) && near(rows.bottom, PB - 12), 'aplite ' + JSON.stringify(over));
  });
  // And the one drawn: the same line on a basalt preview lifts the air's low (2).
  assert.ok(curveRows(preview({ fourthLine: 'dew', fourthLineStyle: 'line' }, BASALT)).bottom < PB - 12);
});

test('alignLabels: off today\'s reach only, inward only, the minimum gap, else today\'s place for both', () => {
  const cap = PA.LABEL_CAP;
  const gap = PA.TEMP_LABEL_MIN_INK_GAP * PA.CURVE_INSET_PREV / PA.WATCH_INSET_PX;
  // Room: both centred on their rows, each inside today's reach (19 .. 82).
  assert.deepEqual(PA.alignLabels(15, 93, 30, 70, 19, 82), { hi: 30 + cap / 2, lo: 70 + cap / 2 });
  // A row at today's reach stays where it is: the curve reaches its edge, the label stays.
  assert.deepEqual(PA.alignLabels(15, 93, 19, 82, 19, 82), { hi: 15, lo: 93 });
  assert.deepEqual(PA.alignLabels(15, 93, 19, 70, 19, 82), { hi: 15, lo: 70 + cap / 2 });
  // A row beyond today's label clamps to today's (the hi row above it, the lo row below it).
  assert.deepEqual(PA.alignLabels(15, 93, 12, 95, 11, 96), { hi: 15, lo: 93 });
  // Exactly the gap fits; a hair less falls back to today's place for both.
  const hi = 30 + cap / 2;
  const fits = hi + gap + cap - cap / 2;
  assert.deepEqual(PA.alignLabels(15, 93, 30, fits, 19, 82), { hi: hi, lo: fits + cap / 2 });
  assert.deepEqual(PA.alignLabels(15, 93, 30, fits - 0.01, 19, 82), { hi: 15, lo: 93 });
  // A flat curve: today's place.
  assert.deepEqual(PA.alignLabels(15, 93, 50, 50, 19, 82), { hi: 15, lo: 93 });
  // No gate (under a top stripe band): the hi label follows any curve top inward of its own
  // ink, and keeps its place above that.
  assert.deepEqual(PA.alignLabels(15, 93, 17, 82, -Infinity, 82), { hi: 17 + cap / 2, lo: 93 });
  assert.deepEqual(PA.alignLabels(15, 93, 11, 82, -Infinity, 82), { hi: 15, lo: 93 });
});

// --- THE NUMBERS ON THE GRAPH (left axis BETA, emery only) -------------------------------
// The forecast preview mirrors the watch's left axis options (forecast-axis.js resolved):
// on the axis (today), on the graph (each number beside the point it names), or off; On graph
// and Off draw no left axis, so the graph starts at the frame's left edge. temp_axis_pad.h pins
// the watch's half on the host.
const EMERY = platform.computeEnv({ platform: 'emery' });
const NUMBER_TEXT = /<text x="([\d.-]+)" y="([\d.-]+)" font-size="8" fill="#AEB4BD"[^>]*>(-?\d+)°<\/text>/g;
const UNDERLAY = /<text x="([\d.-]+)" y="([\d.-]+)" font-size="8" fill="([^"]+)" stroke="([^"]+)" stroke-width="2"[^>]*>(-?\d+)°<\/text>/g;
const numbersIn = (svg) => [...svg.matchAll(NUMBER_TEXT)].map((m) => ({ x: Number(m[1]), base: Number(m[2]), t: m[3] }));
const underlaysIn = (svg) => [...svg.matchAll(UNDERLAY)].map((m) => ({ x: Number(m[1]), base: Number(m[2]),
  fill: m[3], stroke: m[4], t: m[5] }));
const ALL_AXIS = { forecastAxisNumbers: 'graph', forecastAxisScale: true };

test('the numbers\' gaps: one number each, the watch\'s', () => {
  assert.equal(PA.TEMP_LABEL_POINT_GAP, cDefine(HEADER, 'TEMP_LABEL_POINT_GAP'));
  assert.equal(PA.TEMP_LABEL_PART_GAP, cDefine(HEADER, 'TEMP_LABEL_PART_GAP'));
  assert.equal(FC.PX0_AXIS, 20, 'On axis: the label strip\'s 20 units');
  assert.equal(FC.PX0_NO_AXIS, 0, 'no left axis: the frame\'s left edge');
});

test('the left axis options change no preview off a known emery, nor emery\'s at the defaults', () => {
  ['aplite', 'basalt', 'chalk', 'diorite', 'flint', null].forEach((p) => {
    const env = platform.computeEnv(p ? { platform: p } : null);
    [{}, { secondaryLine: 'dew' }, { thirdLine: 'feels', barSource: 'rain' }].forEach((over) => {
      assert.equal(preview(Object.assign({}, over, ALL_AXIS), env), preview(over, env),
        p + ' ' + JSON.stringify(over));
    });
  });
  const defaults = { forecastAxisNumbers: 'axis', forecastAxisScale: false };
  [{}, { secondaryLine: 'dew' }].forEach((over) => {
    assert.equal(preview(Object.assign({}, over, defaults), EMERY), preview(over, EMERY), JSON.stringify(over));
    // Nor do a beta's stored 'beside' and its retired Axis line / Number outline keys.
    assert.equal(preview(Object.assign({}, over, { forecastAxisNumbers: 'beside', forecastAxisLine: false,
      forecastAxisOutline: false }), EMERY), preview(over, EMERY));
  });
  assert.equal(preview({ forecastAxisScale: true }, EMERY), preview({}, EMERY), 'no feels-like / dew point line');
});

test('On graph: no left axis, the graph from the left edge; each number beside the point it names', () => {
  const svg = preview({ forecastAxisNumbers: 'graph' }, EMERY);
  assert.ok(svg.indexOf('<text x="3"') === -1, 'no number in the strip');
  assert.match(svg, /<line x1="0" y1="94" x2="197" y2="94"/, 'the zero line starts at the left edge');
  const v = tempVertices(svg);
  assert.equal(v[0][0], FC.PX0_NO_AXIS, 'the curve starts at the left edge');
  const nums = numbersIn(svg);
  assert.deepEqual(nums.map((n) => n.t), ['24', '14']);
  const U = PA.CURVE_INSET_PREV / PA.WATCH_INSET_PX;
  const gap = PA.TEMP_LABEL_POINT_GAP * U;
  // The hi number: hour 0 (the first of two 24s), right of its vertex (the first hour
  // prefers right), its ink centred on the vertex's row.
  const hi = nums[0];
  assert.ok(near(hi.x, v[0][0] + 1.1 + gap), 'right of the curve\'s ink (2.2 wide) by the gap');
  assert.ok(near(hi.base - PA.LABEL_CAP / 2, v[0][1]), 'ink centred on the vertex');
  // The lo number: hour 7 (the first 14), left of it (its right neighbour is level, its left
  // one falls away: the side away from the nearer neighbour).
  const lo = nums[1];
  assert.equal(PA.numberSide(v.map((p) => p[1]), 7), -1);
  assert.ok(near(lo.x + 3 * PA.NUMBER_CHAR_W, v[7][0] - 1.1 - gap), 'left of its vertex by the gap');
  assert.ok(near(lo.base - PA.LABEL_CAP / 2, v[7][1]), 'ink centred on the vertex');
  // The outline: an underlay in the background colour, just before each number.
  const under = underlaysIn(svg);
  assert.equal(under.length, 2);
  under.forEach((u, i) => {
    assert.equal(u.fill, '#000000');
    assert.equal(u.stroke, '#000000');
    assert.equal(u.t, nums[i].t);
    assert.ok(near(u.x, nums[i].x) && near(u.base, nums[i].base));
  });
  assert.ok(svg.indexOf('paint-order') === -1, 'no paint-order: an old WebView ignores it');
  // The light theme's background.
  underlaysIn(preview({ forecastAxisNumbers: 'graph', theme: 'light' }, EMERY))
    .forEach((u) => assert.equal(u.stroke, '#FFFFFF'));
  // The outline is no option: a beta's stored outline-off changes nothing.
  assert.equal(preview({ forecastAxisNumbers: 'graph', forecastAxisOutline: false }, EMERY), svg);
});

test('Off: no numbers and no left axis, the graph from the left edge', () => {
  const svg = preview({ forecastAxisNumbers: 'off' }, EMERY);
  assert.equal(numbersIn(svg).length, 0);
  assert.equal(underlaysIn(svg).length, 0);
  assert.match(svg, /<line x1="0" y1="94" x2="197" y2="94"/);
  assert.equal(tempVertices(svg)[0][0], FC.PX0_NO_AXIS);
});

test('Include feels-like & dew point: the numbers name the scale\'s ends, beside or on the graph', () => {
  const dew = [13, 14, 17, 18, 16, 14, 13, 12, 12, 12, 13, 13];   // preview-forecast.js' sample
  const beside = preview({ secondaryLine: 'dew', forecastAxisScale: true }, EMERY);
  const strip = [...beside.matchAll(/<text x="3" y="([\d.]+)"[^>]*>(-?\d+)°<\/text>/g)].map((m) => m[2]);
  assert.deepEqual(strip, ['24', String(Math.round(Math.min.apply(null, dew)))]);
  const graph = preview({ secondaryLine: 'dew', forecastAxisScale: true, forecastAxisNumbers: 'graph' }, EMERY);
  assert.deepEqual(numbersIn(graph).map((n) => n.t), ['24', '12']);
  // The lo number sits at the dew trough's first hour (7), on the bottom margin row.
  const lo = numbersIn(graph)[1];
  assert.ok(near(lo.base - PA.LABEL_CAP / 2, PB - 12), 'ink centred on the bottom margin row');
  // Off a known emery the option changes nothing: the strip names the air.
  const basalt = preview({ secondaryLine: 'dew', forecastAxisScale: true }, BASALT);
  assert.equal(basalt, preview({ secondaryLine: 'dew' }, BASALT));
  // A feels-like low under the air's names that low (the feels-like sample dips to 13).
  assert.deepEqual(numbersIn(preview({ secondaryLine: 'feels', forecastAxisScale: true,
    forecastAxisNumbers: 'graph' }, EMERY)).map((n) => n.t), ['24', '13']);
});

test('numberSide / numberBeside / numbersPart: the header\'s rules, in preview units', () => {
  // Side: away from the nearer neighbour; a missing reading is open space; ends and ties.
  assert.equal(PA.numberSide([20, 28, 30, 25, 26].map((v) => -v), 2), 1);
  assert.equal(PA.numberSide([20, 22, 30, 29, 26].map((v) => -v), 2), -1);
  assert.equal(PA.numberSide([20, 22, 30], 0), 1);
  assert.equal(PA.numberSide([20, 22, 30], 2), -1);
  assert.equal(PA.numberSide([null, 30, 29], 1), -1);
  assert.equal(PA.numberSide([26, 30, 26], 1), 1);
  const U = PA.CURVE_INSET_PREV / PA.WATCH_INSET_PX;
  const gap = PA.TEMP_LABEL_POINT_GAP * U, cap = PA.LABEL_CAP;
  const area = { left: 9, right: 197, top: 4, bottom: 93 };
  // Beside: the preferred side, else the other, else held; the ink centred, else held.
  let b = PA.numberBeside(100, 102, 50, 1, 10, area);
  assert.ok(near(b.x, 102 + gap) && near(b.base, 50 + cap / 2));
  b = PA.numberBeside(100, 102, 50, -1, 10, area);
  assert.ok(near(b.x, 100 - gap - 10));
  b = PA.numberBeside(190, 192, 50, 1, 10, area);
  assert.ok(near(b.x, 190 - gap - 10), 'right does not fit: left');
  b = PA.numberBeside(9, 11, 50, -1, 10, area);
  assert.ok(near(b.x, 11 + gap), 'left does not fit: right');
  b = PA.numberBeside(90, 92, 50, 1, 200, area);
  assert.ok(near(b.x, area.left), 'fits nowhere: held inside');
  b = PA.numberBeside(50, 52, 2, 1, 10, area);
  assert.ok(near(b.base - cap, area.top), 'held under the top');
  b = PA.numberBeside(50, 52, 95, 1, 10, area);
  assert.ok(near(b.base, area.bottom), 'held over the bottom');
  // Part: apart untouched; overlapping, lo under hi; at the floor, hi lifted; no room: false.
  const pg = PA.TEMP_LABEL_PART_GAP * U;
  let hi = { x: 20, base: 50 }, lo = { x: 150, base: 50 };
  assert.equal(PA.numbersPart(hi, 10, lo, 10, area), true);
  assert.deepEqual([hi, lo], [{ x: 20, base: 50 }, { x: 150, base: 50 }]);
  hi = { x: 50, base: 50 }; lo = { x: 52, base: 51 };
  assert.equal(PA.numbersPart(hi, 10, lo, 10, area), true);
  assert.ok(near(lo.base, 50 + cap + pg) && hi.base === 50);
  hi = { x: 50, base: 90 }; lo = { x: 52, base: 92 };
  assert.equal(PA.numbersPart(hi, 10, lo, 10, area), true);
  assert.ok(near(lo.base, area.bottom) && near(hi.base, area.bottom - cap - pg));
  // No room for both: the lo number is left out, and the hi number keeps numberBeside's
  // place, inside the area (never lifted over its top).
  const tiny = { left: 9, right: 197, top: 4, bottom: 14 };
  hi = { x: 50, base: 12 }; lo = { x: 50, base: 12 };
  assert.equal(PA.numbersPart(hi, 10, lo, 10, tiny), false);
  assert.deepEqual(hi, { x: 50, base: 12 }, 'the hi number stays put');
  assert.ok(hi.base - cap >= tiny.top && hi.base <= tiny.bottom, 'inside the area');
});

test('numbersArea: the plot\'s edges, between the bands, shrunk by the outline\'s ring', () => {
  const U = PA.CURVE_INSET_PREV / PA.WATCH_INSET_PX;
  // On graph always outlines: the ring (one watch px round the ink) stays off the left
  // edge, the top band, the plot's right edge and the zero line.
  const o = PA.numbersArea(0, 197, 4, 94);
  assert.ok(near(o.left, U) && near(o.right, 197 - U) && near(o.top, 4 + U) && near(o.bottom, 93 - U));
  // A number held at the area's corners (a 120-unit number fits on neither side of its
  // point) sits in by the ring.
  let held = PA.numberBeside(100, 102, 0, -1, 120, o);
  assert.ok(near(held.x, U) && near(held.base - PA.LABEL_CAP, 4 + U), 'held top-left, in by the ring');
  held = PA.numberBeside(100, 102, 200, 1, 120, o);
  assert.ok(near(held.x + 120, 197 - U) && near(held.base, 93 - U), 'held bottom-right, in by the ring');
});

test('bothNumbers: a flat range draws one number; else both, apart', () => {
  const area = PA.numbersArea(0, 197, 4, 94);
  // Equal texts: the hi number alone, neither box moved, even where the two would collide.
  let hi = { x: 50, base: 50 }, lo = { x: 50, base: 50 };
  assert.equal(PA.bothNumbers('20°', '20°', hi, 10, lo, 10, area), false);
  assert.deepEqual([hi, lo], [{ x: 50, base: 50 }, { x: 50, base: 50 }]);
  // Two texts: both, kept apart (the lo one under the hi one).
  assert.equal(PA.bothNumbers('21°', '20°', hi, 10, lo, 10, area), true);
  assert.ok(lo.base > hi.base + PA.LABEL_CAP);
  // Two texts with no room: numbersPart's verdict.
  hi = { x: 50, base: 12 }; lo = { x: 50, base: 12 };
  assert.equal(PA.bothNumbers('21°', '20°', hi, 10, lo, 10, { left: 9, right: 197, top: 4, bottom: 14 }), false);
});

// --- THE HOUR AXIS (emery's spans and left axis, mirrored) -------------------------------
// preview-forecast.js drawAxis mirrors forecast_grid.c forecast_grid_fill_axis_span over its
// own 12-hour noon window: the span's cadence (forecast_span.h forecast_span), each slot's
// mark (forecast_span_mark), no label on slot 0 with no left axis, and no label an edge would
// cut (forecast_span_label_fits). test/c/forecast_span_test.c pins the watch's half.
const HOUR_TEXT = /<text x="([\d.]+)" y="105"[^>]*>(\d+)<\/text>/g;
const hourLabels = (svg) => [...svg.matchAll(HOUR_TEXT)].map((m) => m[2]);
const TICK = /<line x1="([\d.]+)" y1="94" x2="[\d.]+" y2="(98|96)"/g;
const ticks = (svg) => [...svg.matchAll(TICK)].map((m) => (m[2] === '98' ? 'big' : 'small'));
const SPAN_HEADER = read('src/c/appendix/forecast_span.h');

test('hour axis: the marks are forecast_span.h\'s, the long span\'s clock marks at its 3 px pitch', () => {
  assert.equal(PA.MARK_NONE, cDefine(SPAN_HEADER, 'FORECAST_MARK_NONE'));
  assert.equal(PA.MARK_TICK, cDefine(SPAN_HEADER, 'FORECAST_MARK_TICK'));
  assert.equal(PA.MARK_LABEL, cDefine(SPAN_HEADER, 'FORECAST_MARK_LABEL'));
  const span = (h, env) => PA.axisCadence({ forecastHours: h }, env || EMERY);
  assert.deepEqual(span('12'), { labelEvery: 2, tickEvery: 1, byClock: false });
  assert.deepEqual(span('24'), { labelEvery: 3, tickEvery: 1, byClock: false });
  assert.deepEqual(span(undefined), { labelEvery: 3, tickEvery: 1, byClock: false });
  // The long span at the default plot's 3 px pitch: 3 hours are 9 px, under the 18 px a
  // 3-hourly label needs, so a label every 6 clock hours and a small tick between.
  assert.ok(cDefine(SPAN_HEADER, 'FORECAST_SPAN_CLOCK_TICK_H') * 3
    < cDefine(SPAN_HEADER, 'FORECAST_SPAN_LABEL_MIN_PX'));
  assert.deepEqual(span('48'), { labelEvery: cDefine(SPAN_HEADER, 'FORECAST_SPAN_CLOCK_LABEL_H'),
    tickEvery: cDefine(SPAN_HEADER, 'FORECAST_SPAN_CLOCK_TICK_H'), byClock: true });
  // Every watch but emery draws 24 h, whatever is stored.
  assert.deepEqual(span('48', BASALT), span('24'));
  assert.deepEqual(span('12', platform.computeEnv(null)), span('24'));
  // The clock's marks: 12 / 18 / 0 labelled, 15 / 21 / 3 ticked, the rest bare; a repeated
  // (fall-back) hour marked once.
  const long = span('48');
  assert.deepEqual([12, 13, 15, 18, 21, 0, 3, 6].map((h, i) => PA.axisMark(long, i + 1, h, h - 1)),
    [2, 0, 1, 2, 1, 2, 1, 2]);
  assert.equal(PA.axisMark(long, 5, 3, 3), PA.MARK_NONE, 'the repeated 3 o\'clock: once');
  // 12 h and 24 h count from slot 0, whatever the hour.
  assert.deepEqual([0, 1, 2, 3].map((i) => PA.axisMark(span('24'), i, 7 + i, 6 + i)), [2, 1, 1, 2]);
  assert.deepEqual([0, 1, 2].map((i) => PA.axisMark(span('12'), i, 7 + i, 6 + i)), [2, 1, 2]);
  // A label either edge would cut is not drawn.
  assert.equal(PA.axisLabelFits(0, '15', 0, 200), false);
  assert.equal(PA.axisLabelFits(4.5, '15', 0, 200), true);
  assert.equal(PA.axisLabelFits(197, '21', 0, 200), false);
  assert.equal(PA.axisLabelFits(197, '9', 0, 200), true);
});

test('hour axis: every stored span value gives the cadence of the option the watch draws', () => {
  const TWELVE = { labelEvery: 2, tickEvery: 1, byClock: false };
  const DAY = { labelEvery: 3, tickEvery: 1, byClock: false };
  const LONG = { labelEvery: 6, tickEvery: 3, byClock: true };
  // [stored value, its cadence on emery]; every other watch draws 24 h whatever is stored.
  [['12', TWELVE], [12, TWELVE], ['24', DAY], [24, DAY], ['48', LONG], [48, LONG], ['36', DAY], ['junk', DAY],
    [undefined, DAY]].forEach(([stored, onEmery]) => {
    assert.deepEqual(PA.axisCadence({ forecastHours: stored }, EMERY), onEmery, 'emery ' + stored);
    [BASALT, platform.computeEnv(null), null].forEach((env) =>
      assert.deepEqual(PA.axisCadence({ forecastHours: stored }, env), DAY, 'off emery ' + stored));
  });
  assert.deepEqual(PA.axisCadence(null, EMERY), DAY, 'no settings');
});

test('hour axis: On axis keeps today\'s labels; On graph and Off drop slot 0\'s label, keep its tick', () => {
  assert.deepEqual(hourLabels(preview({}, EMERY)), ['12', '15', '18', '21'], 'On axis: today');
  ['graph', 'off'].forEach((nums) => {
    const svg = preview({ forecastAxisNumbers: nums }, EMERY);
    assert.deepEqual(hourLabels(svg), ['15', '18', '21'], nums + ': the first label is the next one');
    assert.equal(ticks(svg)[0], 'big', nums + ': slot 0 keeps its big tick');
    assert.equal(ticks(svg).length, 12, nums + ': a tick per hour');
  });
  // Off a known emery the option changes nothing.
  assert.deepEqual(hourLabels(preview({ forecastAxisNumbers: 'off' }, BASALT)), ['12', '15', '18', '21']);
});

test('hour axis: the long span marks the clock (12 / 15 / 18 / 21), the 12 h span every 2nd hour', () => {
  const long = preview({ forecastHours: '48' }, EMERY);
  assert.deepEqual(hourLabels(long), ['12', '18'], 'labels every 6 clock hours');
  assert.deepEqual(ticks(long), ['big', 'small', 'big', 'small'], 'a tick on every 3-hour mark only');
  assert.deepEqual(hourLabels(preview({ forecastHours: '48', forecastAxisNumbers: 'off' }, EMERY)), ['18'],
    'no left axis: slot 0 unlabelled');
  assert.deepEqual(hourLabels(preview({ forecastHours: '12' }, EMERY)), ['12', '14', '16', '18', '20', '22']);
  assert.deepEqual(hourLabels(preview({ forecastHours: '12', forecastAxisNumbers: 'graph' }, EMERY)),
    ['14', '16', '18', '20', '22']);
  assert.deepEqual(hourLabels(preview({ forecastHours: '48', axisTimeFormat: '12h' }, EMERY)), ['12', '6'],
    'folded like config_axis_hour');
});
