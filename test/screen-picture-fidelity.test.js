// test/screen-picture-fidelity.test.js — a picture of a watch screen (preview-watch.js screenSvg)
// drawn as the watch draws it, so it reads like a screenshot: the screen's colours
// (preview-svg.js displayColors, through screen-frame.js), the calendar's cells, the status
// rows' slots and the forecast graph's axis, labels and frame at the watch's own pixels.
const test = require('node:test');
const assert = require('node:assert/strict');

require('../src/pkjs/config-ui/lib/schema-walk.js');
require('../src/pkjs/config-ui/lib/color.js');
require('../src/pkjs/config-ui/lib/show-when.js');
const eng = require('../src/pkjs/config-ui/lib/engine.js');
require('../src/pkjs/settings/blocks.js');
require('../src/pkjs/settings/status-slot-icons.js');
const VC = require('../src/pkjs/view-cycle.js');
const plat = require('../src/pkjs/config-ui/lib/platform.js');
const schema = require('../src/pkjs/settings/schema.js');
const pw = require('../src/pkjs/settings/preview-watch.js');
const svgLib = require('../src/pkjs/settings/preview-svg.js');
const frame = require('../src/pkjs/settings/screen-frame.js');
const WT = require('../src/pkjs/settings/watch-text.js');

const FRIDAY = new Date(2026, 10, 6);

/**
 * A screen picture of a fresh install's Default screen, with overrides.
 * @param {string} platform Platform name.
 * @param {Object} over Settings over the hydrated defaults.
 * @returns {string} The picture's markup.
 */
function picture(platform, over) {
  const env = plat.computeEnv({ platform: platform });
  const S = Object.assign(eng.hydrate(schema, {}), { radarMode: 'off', healthMode: 'off' }, over);
  return pw.screenSvg(VC.resolveViewCycle(S, env)[0], 0, S, env, {}, platform === 'emery' ? 1 : 0, FRIDAY).svg;
}

/**
 * A text element's position, size, weight and string.
 * @param {string} m A <text> element.
 * @returns {{x: number, y: number, size: number, weight: number, fill: string, s: string}}
 */
function text(m) {
  const at = (k) => (new RegExp(' ' + k + '="([^"]*)"').exec(m) || [])[1];
  return { x: Number(at('x')), y: Number(at('y')), size: Number(at('font-size')), weight: Number(at('font-weight')),
    fill: at('fill'), s: />([^<]*)<\/text>$/.exec(m)[1] };
}

/**
 * The forecast graph's band in a picture: its scale (frame units a watch pixel) and markup.
 * @param {string} svg The picture.
 * @returns {{u: number, x: number, w: number, inner: string}}
 */
function forecastBand(svg) {
  const m = /<svg x="([^"]*)" y="[^"]*" width="([^"]*)" height="[^"]*" viewBox="0 0 200 [^"]*" preserveAspectRatio="none">([\s\S]*?)<\/svg>/.exec(svg);
  return { u: 200 / Number(m[2]), x: Number(m[1]), w: Number(m[2]), inner: m[3] };
}

test('a screen picture shows each of the watch\'s colours as its screen does', () => {
  // pebble-tool's screenshot colour correction: 62 of the 64 colours shift, black and white stay.
  const all = [];
  ['00', '55', 'AA', 'FF'].forEach((r) => ['00', '55', 'AA', 'FF'].forEach((g) => ['00', '55', 'AA', 'FF']
    .forEach((b) => all.push('#' + r + g + b))));
  const shifted = all.filter((c) => svgLib.displayColors(c) !== c);
  assert.equal(shifted.length, 62);
  assert.deepEqual(all.filter((c) => shifted.indexOf(c) === -1), ['#000000', '#FFFFFF']);
  assert.equal(svgLib.displayColors('<rect fill="#FF0055"></rect>'), '<rect fill="#E25874"></rect>');
  assert.equal(svgLib.displayColors('stroke="#ff5500"'), 'stroke="#E66E6B"', 'whatever its case');
  assert.equal(svgLib.displayColors('fill="url(#AA0000)"'), 'fill="url(#AA0000)"', 'a reference stays');
  assert.equal(svgLib.displayColors('fill="#FF00551"'), 'fill="#FF00551"', 'a longer word stays');
  // Through the frame every screen picture draws in: its drawing mapped, its black or white ground kept.
  assert.equal(frame.svg(144, 168, '#000000', '<rect fill="#00AAFF"></rect>'),
    '<svg viewBox="-9 -9 162 186" aria-hidden="true" focusable="false"><rect x="-9" y="-9" width="162" height="186"'
    + ' fill="#000000"></rect><rect fill="#4CB4DB"></rect></svg>');
  // A preview that is not a picture of the screen (a graph card, a swatch) keeps the colours
  // its pickers show.
  assert.match(svgLib.svgFrame('<rect fill="#00AAFF"></rect>', 50), /<rect fill="#00AAFF">/);
});

test('the calendar draws in the watch\'s cells: its Gothic dates centred on them, today\'s cell filled', () => {
  // The calendar's layer spans the content width: the screen's on the 144 px watches, emery's
  // inside its 2 px side pads (LAYOUT_PAD_X).
  [['basalt', 0, 0, 144, 18], ['emery', 1, 2, 196, 24]].forEach((p) => {
    const f = p[1], x0 = p[2], W = p[3], size = p[4];
    const S = { layoutPreset: 'compactCal', weekStartDay: 'mon', statusTopLeft: 'empty', statusTopMid: 'empty',
      statusTopRight: 'empty' };
    const svg = picture(p[0], S);
    const env = plat.computeEnv({ platform: p[0] });
    const full = Object.assign(eng.hydrate(schema, {}), { radarMode: 'off', healthMode: 'off' }, S);
    const cal = pw.layoutView(VC.resolveViewCycle(full, env)[0], f).bands.find((b) => b.band === 'T');
    // calendar_layer.c calendar_cell_rect: integer columns and rows of the band.
    const cell = (i) => ({ x: x0 + Math.trunc((i % 7) * W / 7), y: cal.y + Math.trunc(Math.floor(i / 7) * cal.h / 2),
      w: Math.trunc(W / 7), h: Math.trunc(cal.h / 2) });
    // The top strip emptied, the first numbers drawn are the calendar's two weeks.
    const dates = (svg.match(/<text [^>]*>\d+<\/text>/g) || []).slice(0, 14).map(text);
    assert.equal(dates.length, 14, p[0] + ': two weeks');
    dates.forEach((d) => assert.ok(d.y > cal.y && d.y <= cal.y + cal.h, p[0] + ' ' + d.s + ': in the calendar\'s band'));
    dates.forEach((d, i) => {
      const c = cell(i);
      // calendar_metrics.h calendar_text_top: 5 rows over the cell on the 144 px watches; on emery
      // the line box centred in the cell, then 5 up; a two-digit date starting with 1 a pixel left.
      const top = f ? c.y + Math.trunc((c.h - size) / 2) - 5 : c.y - 5;
      const shift = f && d.s.length === 2 && d.s.charAt(0) === '1' ? 1 : 0;
      assert.equal(d.size, size, p[0] + ' ' + d.s + ': Gothic ' + size);
      assert.equal(d.y, top + size, p[0] + ' ' + d.s + ': its baseline');
      assert.equal(d.x, c.x - shift + Math.floor((c.w - WT.width(size, d.weight === 700, d.s)) / 2), p[0] + ' ' + d.s + ': centred');
    });
    // Friday the 6th, the fifth of a Monday week: its cell filled with corner radius 1.
    const c = cell(4);
    assert.ok(svg.indexOf('<rect x="' + c.x + '" y="' + c.y + '" width="' + c.w + '" height="' + c.h + '" rx="1" ') > 0,
      p[0] + ': today\'s cell');
    assert.equal(dates[4].weight, 700, 'today in bold');
  });
});

test('a status row seats its slots as the watch does: the edge slots from the margin, the middle centred', () => {
  // The city without its weather icon (citySlotIcon), so its text starts at the margin.
  const svg = picture('basalt', { layoutPreset: 'compactCal', statusTopLeft: 'city', statusTopMid: 'empty',
    statusTopRight: 'battery', citySlotIcon: false });
  // The top strip (status_metrics.h status_seat_y, 2 rows higher): Gothic 18 in its 17-row band.
  const city = text(/<text [^>]*>Berlin<\/text>/.exec(svg)[0]);
  assert.deepEqual([city.x, city.y, city.size, city.weight], [2, 12, 18, 400], 'the city from the 2 px margin, regular');
  // The battery glyph (battery_glyph.h, 29 wide: a 10 px bolt lane, a 17 px body, a 2 px nub)
  // against the right margin: its body outlined from x 123, its nub at 140.
  assert.match(svg, /<rect x="123\.5" y="[^"]*" width="16" height="9" fill="none" stroke="#FFFFFF" stroke-width="1"><\/rect><rect x="140" y="[^"]*" width="2" height="4"/);
  // A middle slot centred on the row.
  const mid = picture('basalt', { layoutPreset: 'compactCal', statusTopLeft: 'empty', statusTopMid: 'city',
    statusTopRight: 'empty', citySlotIcon: false });
  const m = text(/<text [^>]*>Berlin<\/text>/.exec(mid)[0]);
  assert.equal(m.x, 2 + Math.trunc((140 - WT.width(18, false, 'Berlin')) / 2), 'the middle slot centred in the margins');
});

test('the forecast band draws the watch\'s axis: its labels in Gothic, its ticks, its frame lines', () => {
  const svg = picture('basalt', { layoutPreset: 'compactCal', dayNightShading: false });
  const band = forecastBand(svg), u = band.u;
  // The hi and lo labels (forecast_layer.c draw_left_axis): bare numbers in Gothic 18, right
  // against the label strip's edge; the strip their widths and 2 more, 15 at least.
  const labels = (/<g transform="scale\([^)]*\)">((?:<text [^>]*>-?\d+<\/text>)+)<\/g>/.exec(band.inner) || [])[1];
  const hl = labels.match(/<text [^>]*>-?\d+<\/text>/g).map(text);
  assert.equal(hl.length, 2, 'the hi and the lo');
  hl.forEach((t) => assert.equal(t.size, 18));
  assert.ok(hl[0].y < hl[1].y, 'the hi over the lo');
  const strip = Math.max(15, Math.max.apply(null, hl.map((t) => WT.width(18, false, t.s))) + 2);
  hl.forEach((t) => assert.equal(t.x + WT.width(18, false, t.s), strip, t.s + ': right against the strip'));
  assert.doesNotMatch(band.inner, /°/, 'no degree sign, as the watch prints them');
  // The frame (CHART_LAYER_FRAME): the plot's left edge 2 px past the strip and its zero row,
  // in Orange without the night shading, as the screen shows it.
  const left = new RegExp('<rect x="' + ((strip + 2) * u).toString().replace('.', '\\.') + '" y="0" width="' + u.toString().replace('.', '\\.')
    + '" height="[^"]*" fill="#E66E6B"></rect>');
  assert.match(band.inner, left, 'the left edge');
  // The hour axis: a pixel-wide tick from the axis row, 7 rows on a label and 5 between, in
  // LightGray; each label in Gothic 14 centred in its 40 px box, 4 rows over the axis row and 3 px left.
  const ticks = (band.inner.match(/<rect x="[^"]*" y="[^"]*" width="[^"]*" height="[^"]*" fill="#ABABAB"><\/rect>/g) || [])
    .map((r) => ({ x: Number(/x="([^"]*)"/.exec(r)[1]), y: Number(/y="([^"]*)"/.exec(r)[1]),
      w: Number(/width="([^"]*)"/.exec(r)[1]), h: Number(/height="([^"]*)"/.exec(r)[1]) }))
    .filter((t) => Math.abs(t.w - u) < 1e-9);   // a pixel wide (the rain bars share the grey)
  assert.equal(new Set(ticks.map((t) => t.y)).size, 1, 'all from the axis row');
  assert.ok(ticks.length > 5, 'ticks');
  ticks.forEach((t) => assert.ok(Math.abs(t.h - 7 * u) < 1e-9 || Math.abs(t.h - 5 * u) < 1e-9, 'a 7 or 5 row tick'));
  const big = ticks.filter((t) => Math.abs(t.h - 7 * u) < 1e-9);
  const hours = band.inner.match(/<text [^>]*font-size="14"[^>]*>\d+<\/text>/g).map(text);
  assert.equal(hours.length, big.length, 'a label on every long tick');
  hours.forEach((h, k) => {
    const x = Math.round(big[k].x / u), row = Math.round(big[k].y / u);
    assert.equal(h.x, x - 20 - 3 + Math.floor((40 - WT.width(14, false, h.s)) / 2), h.s + ': centred under its tick');
    assert.equal(h.y, row - 4 + 14, h.s + ': 4 rows over the axis row');
  });
  // With the night shading the frame's lines are DarkGray; emery's short ticks are too.
  assert.match(forecastBand(picture('basalt', { layoutPreset: 'compactCal', dayNightShading: true })).inner,
    /fill="#545454"><\/rect>/);
  assert.match(forecastBand(picture('emery', { layoutPreset: 'compactCal' })).inner, /fill="#545454"><\/rect>/);
  // A light theme draws them black; a black-and-white watch in its ink.
  const furniture = (b) => {
    // The ticks and the frame's lines: the rects a watch pixel wide or high.
    const px = b.u.toString().replace('.', '\\.');
    return Array.from(new Set((b.inner.match(new RegExp('<rect [^>]*(width|height)="' + px + '"[^>]*>', 'g')) || [])
      .map((r) => /fill="([^"]*)"/.exec(r)[1])));
  };
  assert.deepEqual(furniture(band).sort(), ['#ABABAB', '#E66E6B'], 'dark: LightGray ticks, the Orange frame');
  assert.deepEqual(furniture(forecastBand(picture('basalt', { layoutPreset: 'compactCal', theme: 'light' }))), ['#000000']);
  assert.deepEqual(furniture(forecastBand(picture('diorite', { layoutPreset: 'compactCal' }))), ['#FFFFFF']);
});

test('emery\'s forecast band: its labels in Gothic 24 and 18 with Larger graph fonts, 14 and 18 without', () => {
  const sizes = (over) => {
    const inner = forecastBand(picture('emery', Object.assign({ layoutPreset: 'compactCal' }, over))).inner;
    return Array.from(new Set((inner.match(/font-size="(\d+)"/g) || []).map((s) => Number(/\d+/.exec(s)[0])))).sort((a, b) => a - b);
  };
  assert.deepEqual(sizes({}), [18, 24], 'the default: larger');
  assert.deepEqual(sizes({ largeGraphFont: false }), [14, 18]);
});
