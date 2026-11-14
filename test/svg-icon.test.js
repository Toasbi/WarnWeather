// test/svg-icon.test.js — an SVG made into a status icon the old way, for the icon picker's Add SVG
// (scripts/pixel-icons/svg-icon.js): scripts/svg2pdc.py's conversion (curves cut into chords,
// circles into flat-top octagons, the ink fitted into the 24-unit box) and the watch's old scaling
// (scripts/pixel-icons/watch_icons.py icon_load and old_version), ported to JavaScript.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const SI = require('../scripts/pixel-icons/svg-icon.js');
const PD = require('../scripts/pixel-icons/pebble-draw.js');

const ROOT = path.join(__dirname, '..');
const FIX = JSON.parse(fs.readFileSync(path.join(__dirname, 'svg-icon.fixtures.json'), 'utf8'));

/** A committed PDC's paths, svg-icon.js's way: {pts in 1/8 units, closed}. */
function pdcPaths(name) {
  const buf = new Uint8Array(fs.readFileSync(path.join(ROOT, 'resources', 'data', name + '.pdc')));
  return PD.readPdc(buf).paths.map((p) => ({ pts: p.pts, closed: !p.open }));
}

const svg = (body) => '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">' + body + '</svg>';
const paths = (...ds) => svg(ds.map((d) => '<path d="' + d + '"/>').join(''));

/**
 * A Tabler shape as scripts/gen-condition-glyphs.py has it: the strings of its `NAME = ...` block.
 * @param {string} name @returns {!Array<string>}
 */
function tabler(name) {
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'gen-condition-glyphs.py'), 'utf8');
  const block = new RegExp('^' + name + ' = [\\s\\S]*?(?=^\\S)', 'm').exec(src)[0];
  return block.match(/"[^"]*"/g).map((s) => s.slice(1, -1));
}

// gen-condition-glyphs.py made these glyphs from Tabler's shapes with svg2pdc.py's own functions,
// untransformed: the same shapes as an SVG must give the very same PDC.
test('Tabler\'s cloud, moon, fog and haze as SVGs make the very PDCs svg2pdc.py made of them', () => {
  const shapes = { CLOUD: [tabler('CLOUD').join('')], MOON: [tabler('MOON').join('')], FOG: tabler('FOG'), HAZE: tabler('HAZE') };
  for (const [name, ds] of Object.entries(shapes)) {
    assert.deepEqual(SI.toPdcPaths(paths(...ds)), pdcPaths('STATUS_COND_' + name), name);
  }
});

test('scales a drawing to a size the way the watch scaled the old icons (watch_icons.py)', () => {
  assert.ok(FIX.cases.length >= 8);
  for (const c of FIX.cases) {
    assert.deepEqual(SI.scaled(pdcPaths(c.res), c.h), { lines: c.lines, w: c.w, h: c.rows }, c.res + ' at ' + c.h);
  }
});

test('an SVG at a size is its PDC scaled; it paints h + 1 rows for an even height and h + 2 for an odd one', () => {
  const cloud = paths(tabler('CLOUD').join(''));
  for (let h = 6; h <= 20; h++) {
    const v = SI.atSize(cloud, h);
    assert.deepEqual(v, SI.scaled(SI.toPdcPaths(cloud), h));
    assert.equal(v.h, h % 2 ? h + 2 : h + 1, 'height ' + h);
    for (const line of v.lines) for (const [x, y] of line) assert.ok(x >= 0 && y >= 0 && x < v.w && y < v.h, 'inside its box');
  }
  // The old icon at the same height: the SVG version is the old version.
  assert.deepEqual(SI.atSize(cloud, 12), SI.scaled(pdcPaths('STATUS_COND_CLOUD'), 12));
});

test('reads path data as svg.path does: implicit lines, relative moves after Z, H, V, S, T and run-together arc flags', () => {
  const same = (a, b, what) => assert.deepEqual(SI.flattenPath(a), SI.flattenPath(b), what);
  same('M0 0 10 0 10 10', 'M0 0L10 0L10 10', 'pairs after M are lines');
  same('m1 1 9 0', 'M1 1L10 1', 'relative pairs after m too');
  same('M0 0h10v10', 'M0 0L10 0L10 10', 'H and V');
  same('M2 2L8 2Zm1 1l2 0', 'M2 2L8 2ZM3 3L5 3', 'after Z, m is from the start of the subpath');
  same('M0 0C0 5 5 10 10 10S20 5 20 0', 'M0 0C0 5 5 10 10 10C15 10 20 5 20 0', 'S mirrors the last control');
  same('M0 0Q5 10 10 0T20 0', 'M0 0Q5 10 10 0Q15 -10 20 0', 'T mirrors the last control');
  same('M9 17a5 5 0 016.001 0', 'M9 17a5 5 0 0 1 6.001 0', 'arc flags may run into what follows');
  same('M11 3a.25.25 0 00.407.195', 'M11 3a0.25 0.25 0 0 0 0.407 0.195', 'numbers may run together');
  const sub = SI.flattenPath('M2 2L8 2Z');
  assert.deepEqual(sub, [{ pts: [[2, 2], [8, 2]], closed: true }], 'Z closes; the start is not repeated');
  // A curve: about one chord per 2.5 units, never fewer than 2 (svg2pdc.py CURVE_SPACING).
  assert.equal(SI.flattenPath('M0 0Q0 0 1 0')[0].pts.length, 3, 'a short curve: 2 chords');
  assert.equal(SI.flattenPath('M0 0C0 0 20 0 20 0')[0].pts.length, 9, 'a curve 20 long: 8 chords');
  assert.equal(SI.flattenPath('M0 0A0 0 0 0 1 10 0')[0].pts.length, 5, 'an arc of radius 0 is cut along its chord');
  assert.deepEqual(SI.flattenPath(''), []);
  same('L4 4', 'M0 0L4 4', 'no M first: from the origin, as svg.path reads it');
  // What svg.path refuses is refused; an unknown command too (svg.path stops there without a word).
  for (const bad of ['M1', 'M0 0Z 4 4', 'M0 0 X 1 1', 'M0 0A1 1 0 2 1 4 4']) {
    assert.throws(() => SI.flattenPath(bad), Error, bad + ' is refused');
  }
});

test('draws strokes as svg2pdc.py does: shapes and their open or closed ends, nothing drawn with stroke none', () => {
  const s = SI.strokes(svg('<rect width="24" height="24" stroke="none"/><circle cx="12" cy="12" r="4"/>'
    + '<rect x="1" y="2" width="3" height="4"/><line x1="0" y1="0" x2="5" y2="5"/>'
    + '<polyline points="0,0 1,1 2,0"/><polygon points="0 0 4 0 2 3"/><path d="M5 5"/><!-- <line x1="9"/> -->'));
  assert.deepEqual(s.map((p) => [p.pts.length, p.closed]), [[8, true], [4, true], [2, false], [3, false], [3, true]],
    'circle, rect, line, polyline, polygon; the stroke="none" box, the one-point path and the comment left out');
  const ring = s[0].pts;
  assert.ok(Math.abs(ring[0][1] - ring[1][1]) > 1 && Math.abs(ring[1][1] - ring[2][1]) < 1e-9, 'a flat-top octagon');
  assert.throws(() => SI.toPdcPaths(svg('')), /no strokes/);
  assert.throws(() => SI.toPdcPaths(svg('<path d="M5 5L5 5"/>')), /no size/);
});

test('fits the ink into the 24-unit box with a 2-unit margin, on the 1/8 grid', () => {
  const p = SI.toPdcPaths(svg('<line x1="100" y1="50" x2="300" y2="50"/><line x1="200" y1="0" x2="200" y2="100"/>'));
  assert.deepEqual(p, [{ closed: false, pts: [[16, 96], [176, 96]] }, { closed: false, pts: [[96, 56], [96, 136]] }],
    'the long side 20 units, centred; points in eighths');
  assert.equal(SI.roundEven(2.5), 2);
  assert.equal(SI.roundEven(3.5), 4);
  assert.equal(SI.roundEven(-2.5), -2);
});

test('bake prints a size of an SVG file as JSON, for import_pixels.py', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'svg-icon-'));
  try {
    const file = path.join(dir, 'cloud.svg');
    fs.writeFileSync(file, paths(tabler('CLOUD').join('')));
    const out = execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'pixel-icons', 'svg-icon.js'), 'bake', file, '13']);
    assert.deepEqual(JSON.parse(out.toString()), SI.atSize(fs.readFileSync(file, 'utf8'), 13));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
