// test/pixel-variants.test.js — the versions the watch can draw a status icon's size in
// (scripts/pixel-icons/variants.js; scripts/pixel-icons/README.md, "Versions"): a drawing's 1 px
// strokes traced into lines, bent halfway (half) or all the way (slant) onto the straight line
// through each stroke, never further than half a pixel from the drawing, and written as a PDC.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const V = require('../scripts/pixel-icons/variants.js');
const gen = require('../scripts/pixel-icons/gen_watch_icons.js');

const PIXELS = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'resources', 'pixel-icons.json'), 'utf8'));

/**
 * The lit pixels of a drawing given as a predicate.
 * @param {number} w Columns. @param {number} h Rows.
 * @param {function(number, number): boolean} on Whether pixel (x, y) is lit.
 * @returns {!Array<!Array<number>>} [x, y] each.
 */
function pixels(w, h, on) {
  const out = [];
  for (let y = 0; y < h; y++) { for (let x = 0; x < w; x++) { if (on(x, y)) { out.push([x, y]); } } }
  return out;
}

/** @param {!Array<number>} a @param {!Array<number>} b @returns {boolean} 8-neighbours */
const touching = (a, b) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1])) === 1;

/**
 * Every saved drawing's lit pixels, the ink at (0, 0).
 * @returns {!Array<{what: string, px: !Array<!Array<number>>}>}
 */
function saved() {
  const out = [];
  for (const [key, icon] of Object.entries(PIXELS.icons)) {
    for (const [size, s] of Object.entries(icon.sizes)) {
      if (size !== 'A' && s.pixels.some((r) => r.includes('#'))) { out.push({ what: key + ' ' + size, px: gen.inkPixels(s.pixels) }); }
    }
  }
  return out;
}

test('tracing walks every lit pixel, each step to a touching pixel', () => {
  const drawings = saved().concat([
    { what: 'ring', px: pixels(13, 13, (x, y) => { const d = (x - 6) ** 2 + (y - 6) ** 2; return d >= 20 && d <= 36; }) },
    { what: 'X', px: pixels(11, 11, (x, y) => x === y || x === 10 - y) },
    { what: 'dots', px: pixels(9, 9, (x, y) => x % 3 === 0 && y % 3 === 0) },
  ]);
  assert.ok(drawings.length > 100, 'the saved drawings are in');
  for (const { what, px } of drawings) {
    const paths = V.trace(px);
    const seen = new Set();
    for (const p of paths) {
      p.forEach((q) => seen.add(q[0] + ',' + q[1]));
      for (let k = 1; k < p.length; k++) { assert.ok(touching(p[k - 1], p[k]), what + ': a step to a touching pixel'); }
    }
    assert.deepEqual([...seen].sort(), px.map(([x, y]) => x + ',' + y).sort(), what + ': every lit pixel, nothing else');
  }
});

test('a straight stroke becomes one line; a corner stays a corner; a dot stays a dot', () => {
  const line = (pts) => V.bentLines(pts, 1);
  assert.deepEqual(line(pixels(7, 1, () => true)), [[[0, 0], [6, 0]]], 'level');
  assert.deepEqual(line(pixels(5, 5, (x, y) => x === y)), [[[0, 0], [4, 4]]], '45 degrees');
  // A staircase two across, one down: one slanted line from end to end.
  const stairs = [[0, 0], [1, 0], [2, 1], [3, 1], [4, 2], [5, 2]];
  assert.deepEqual(line(stairs), [[[0, 0], [5, 2]]], 'a staircase is one slanted line');
  const ell = pixels(5, 5, (x, y) => x === 0 || y === 4);
  assert.deepEqual(line(ell), [[[0, 0], [0, 4], [4, 4]]], 'an L keeps its corner');
  assert.deepEqual(line([[3, 2]]), [[[3, 2], [3, 2]]], 'a dot is a line of length 0');
  const ring = line(pixels(9, 9, (x, y) => (x === 0 || x === 8 || y === 0 || y === 8)));
  assert.equal(ring.length, 1, 'a square outline is one path');
  assert.deepEqual(ring[0][0], ring[0][ring[0].length - 1], 'that closes on itself');
  assert.equal(ring[0].length, 5, 'through its four corners');
});

test('the slant version never strays more than half a pixel from the drawing', () => {
  for (const { what, px } of saved()) {
    for (const p of V.trace(px)) {
      const ks = V.corners(p);
      assert.equal(ks[0], 0, what + ': it starts where the stroke starts');
      assert.equal(ks[ks.length - 1], p.length - 1, what + ': and ends where it ends');
      for (let j = 1; j < ks.length; j++) {
        const a = p[ks[j - 1]], b = p[ks[j]];
        const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
        for (let i = ks[j - 1] + 1; i < ks[j]; i++) {
          const d = len ? Math.abs(dy * p[i][0] - dx * p[i][1] + b[0] * a[1] - b[1] * a[0]) / len
            : Math.hypot(p[i][0] - a[0], p[i][1] - a[1]);
          assert.ok(d <= 0.5 + 1e-9, what + ': pixel ' + p[i] + ' is ' + d.toFixed(2) + ' px from its line');
        }
      }
    }
  }
});

test('the half version moves each pixel centre halfway towards its line, the corners staying', () => {
  for (const { what, px } of saved().slice(0, 40)) {
    for (const p of V.trace(px)) {
      const half = V.bend(p, 0.5), ks = V.corners(p);
      assert.equal(half.length, p.length, what + ': one point per pixel');
      ks.forEach((k) => assert.deepEqual(half[k], p[k], what + ': a corner stays'));
      for (let j = 1; j < ks.length; j++) {
        const a = p[ks[j - 1]], b = p[ks[j]], dx = b[0] - a[0], dy = b[1] - a[1], ll = dx * dx + dy * dy;
        for (let i = ks[j - 1] + 1; i < ks[j]; i++) {
          const u = ((p[i][0] - a[0]) * dx + (p[i][1] - a[1]) * dy) / ll;
          const q = [a[0] + u * dx, a[1] + u * dy];
          assert.ok(Math.abs(half[i][0] - (p[i][0] + q[0]) / 2) < 1e-9 && Math.abs(half[i][1] - (p[i][1] + q[1]) / 2) < 1e-9,
            what + ': halfway');
        }
      }
    }
  }
});

test('every version stays inside the drawing\'s box, and its PDC is precise 1 px lines', () => {
  for (const { what, px } of saved()) {
    const w = Math.max(...px.map((p) => p[0])) + 1, h = Math.max(...px.map((p) => p[1])) + 1;
    for (const version of ['half', 'slant']) {
      const v = V.versionLines(version, px, null);
      assert.deepEqual([v.w, v.h], [w, h], what + ' ' + version + ': the box is the drawing\'s');
      for (const line of v.lines) {
        assert.ok(line.length >= 2, what + ': a line, or a dot as a line of length 0');
        for (const [x, y] of line) { assert.ok(x >= 0 && y >= 0 && x <= w - 1 && y <= h - 1, what + ' ' + version + ': inside'); }
      }
      const buf = V.pdc(v.lines, v.w, v.h);
      assert.equal(buf.toString('ascii', 0, 4), 'PDCI');
      assert.equal(buf.readUInt32LE(4), buf.length - 8);
      assert.deepEqual([buf.readInt16LE(10), buf.readInt16LE(12), buf.readUInt16LE(14)], [w, h, v.lines.length]);
    }
  }
  // A point is written on the 1/8 px grid, a pixel centre at +1/2.
  const buf = V.pdc([[[0, 0], [2.5, 1.26]]], 4, 3);
  assert.deepEqual([buf.readUInt8(16), buf.readUInt16LE(21), buf.readUInt16LE(23)], [3, 1, 2], 'a precise open path of 2');
  assert.deepEqual([buf.readInt16LE(25), buf.readInt16LE(27), buf.readInt16LE(29), buf.readInt16LE(31)], [4, 4, 24, 14]);
});

test('the old version draws its kept lines; a size without them, or an unknown version, is refused', () => {
  const old = { lines: [[[0, 0], [3, 1], [3, 4], [0, 0]], [[1, 2]]], w: 4, h: 5 };
  assert.deepEqual(V.versionLines('old', [], old), { lines: [[[0, 0], [3, 1], [3, 4], [0, 0]], [[1, 2], [1, 2]]], w: 4, h: 5 });
  assert.throws(() => V.versionLines('old', [[0, 0]], null), /no old version/);
  assert.throws(() => V.versionLines('smooth', [[0, 0]], null), /unknown version smooth/);
  assert.deepEqual(V.VERSIONS, ['pixel', 'half', 'slant', 'old']);
});
