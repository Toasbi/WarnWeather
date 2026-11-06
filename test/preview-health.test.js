// test/preview-health.test.js — the health-graph preview (settings/preview-health.js): drawn the
// way health_graph_layer.c draws the real graph, the step bars standing on the axis over last
// night's sleep stripe.
const test = require('node:test');
const assert = require('node:assert/strict');
const health = require('../src/pkjs/settings/preview-health.js');

const AXIS_Y = 94;   // the plot's bottom: the frame's bottom edge (preview-health.js PB)

/**
 * Every rect of a fill, as numbers, in drawing order.
 * @param {string} svg The preview.
 * @param {string} fill '#RRGGBB'.
 * @returns {Array<{x: number, y: number, w: number, h: number, at: number}>}
 */
function rects(svg, fill) {
  const re = new RegExp('<rect x="([^"]*)" y="([^"]*)" width="([^"]*)" height="([^"]*)" fill="' + fill + '">', 'g');
  const out = [];
  let m;
  while ((m = re.exec(svg))) { out.push({ x: +m[1], y: +m[2], w: +m[3], h: +m[4], at: m.index }); }
  return out;
}

test('the step bars stand on the axis, over the sleep stripe', () => {
  // The owner, 2026-11-06: the bars started on top of the stripe, floating above the axis.
  // The watch's BARS layer maps a value from the plot's bottom and draws over the stripe.
  const svg = health.healthPreview({}, { color: true });
  const bars = rects(svg, '#00FF00');
  assert.ok(bars.length > 10, 'premise: the sample day\'s bars');
  bars.forEach((b) => assert.ok(Math.abs(b.y + b.h - AXIS_Y) < 0.11, 'a bar ends on the axis: ' + JSON.stringify(b)));
  const sleep = rects(svg, '#0000FF').concat(rects(svg, '#00AAFF'));
  assert.ok(sleep.length > 0, 'premise: last night\'s sleep');
  sleep.forEach((s) => assert.equal(s.y + s.h, AXIS_Y, 'the stripe along the plot\'s bottom'));
  const lastSleep = Math.max.apply(null, sleep.map((s) => s.at));
  assert.ok(bars.every((b) => b.at > lastSleep), 'the stripe first, the bars over it');
  // The 06:00 hour is both asleep and walking: its bar covers the stripe there.
  assert.ok(bars.some((b) => sleep.some((s) => b.x >= s.x && b.x < s.x + s.w)), 'a bar over the stripe');
});

test('the step gridlines sit on the bars\' scale, from the axis', () => {
  const svg = health.healthPreview({}, { color: true });
  const bars = rects(svg, '#00FF00');
  const tallest = bars.reduce((a, b) => (b.h > a.h ? b : a));
  // The 2600-step hour is the peak: a mark of m steps sits at m / 2600 of its height.
  const lines = [...svg.matchAll(/<line x1="20" y1="([^"]*)" x2="180" y2="[^"]*"[^>]*stroke-dasharray/g)].map((m) => +m[1]);
  assert.deepEqual(health.stepMarks(2600), [2500, 1500]);
  [2500, 1500].forEach((m, i) => {
    assert.ok(Math.abs(lines[i] - (AXIS_Y - tallest.h * m / 2600)) < 0.2, m + ' steps: ' + lines[i]);
  });
});

test('on B&W the bars are the background with an ink outline, still from the axis', () => {
  const svg = health.healthPreview({}, { color: false });
  const outlines = [...svg.matchAll(/<path d="M([\d.]+) ([\d.]+) V([\d.]+) H([\d.]+) V([\d.]+)" fill="none"/g)];
  assert.ok(outlines.length > 10);
  outlines.forEach((o) => {
    assert.equal(+o[2], AXIS_Y, 'the outline rises from the axis');
    assert.equal(+o[5], AXIS_Y, 'and comes back down to it');
  });
});
