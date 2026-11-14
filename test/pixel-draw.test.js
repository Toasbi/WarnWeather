// test/pixel-draw.test.js — the watch's own drawing of a status icon, ported from PebbleOS for the
// icon tools (scripts/pixel-icons/pebble-draw.js): checked against how the Pebble Time 2 emulator
// drew the same drawings (test/pixel-draw.fixtures.json, from build_picker.py's renders) and
// against PebbleOS' colour blending.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const PD = require('../scripts/pixel-icons/pebble-draw.js');

const FIX = JSON.parse(fs.readFileSync(path.join(__dirname, 'pixel-draw.fixtures.json'), 'utf8'));

/**
 * A render as rows of grey levels, 0 black to 3 white.
 * @param {{w: number, h: number, rgb: !Uint8Array}} r pebble-draw.js render().
 * @returns {!Array<string>}
 */
function levels(r) {
  const rows = [];
  for (let y = 0; y < r.h; y++) {
    let row = '';
    for (let x = 0; x < r.w; x++) {
      const i = 3 * (y * r.w + x);
      assert.ok(r.rgb[i] === r.rgb[i + 1] && r.rgb[i] === r.rgb[i + 2], 'black ink on white, or white on black: greys only');
      row += PD.LEVEL.indexOf(r.rgb[i]);
    }
    rows.push(row);
  }
  return rows;
}

test('draws each drawing pixel for pixel as the emulator does, in the dark and the light theme', () => {
  assert.ok(FIX.drawings.length >= 5);
  for (const d of FIX.drawings) {
    const pdc = new Uint8Array(Buffer.from(d.pdc, 'base64'));
    assert.deepEqual(levels(PD.render(pdc, { light: false })), d.dark, d.what + ', dark');
    assert.deepEqual(levels(PD.render(pdc, { light: true })), d.light, d.what + ', light');
  }
  // The smoothed ones have greys: the fixture is no plain black and white.
  assert.ok(FIX.drawings.some((d) => d.dark.some((row) => /[12]/.test(row))), 'premise: some pixels are grey');
});

test('blends a third or two thirds of the ink into the pixel, as PebbleOS does', () => {
  assert.equal(PD.blend(PD.WHITE, PD.BLACK, 0), PD.BLACK, 'nothing of it');
  assert.equal(PD.blend(PD.WHITE, PD.BLACK, 3), PD.WHITE, 'all of it');
  assert.equal(PD.blend(PD.WHITE, PD.BLACK, 1), 0xD5, 'a third of white on black: dark grey');
  assert.equal(PD.blend(PD.WHITE, PD.BLACK, 2), 0xEA, 'two thirds: light grey');
  assert.equal(PD.blend(PD.BLACK, PD.WHITE, 1), 0xEA);
  assert.equal(PD.blend(PD.BLACK, PD.WHITE, 2), 0xD5);
  // Ink over a pixel already grey (where two smoothed segments meet), from the firmware's own
  // 33 % table (gtypes.c s_blending_lookup_33_percent; 66 % is the table mirrored).
  const G = [0xC0, 0xD5, 0xEA, 0xFF];
  const THIRD = [[0xC0, 0xD5, 0xD5, 0xEA], [0xC0, 0xD5, 0xEA, 0xEA], [0xD5, 0xD5, 0xEA, 0xFF], [0xD5, 0xEA, 0xEA, 0xFF]];
  const TWO_THIRDS = [[0xC0, 0xC0, 0xD5, 0xD5], [0xD5, 0xD5, 0xD5, 0xEA], [0xD5, 0xEA, 0xEA, 0xEA], [0xEA, 0xEA, 0xFF, 0xFF]];
  G.forEach((src, i) => G.forEach((dst, j) => {
    assert.equal(PD.blend(src, dst, 1), THIRD[i][j], src.toString(16) + ' over ' + dst.toString(16) + ', a third');
    assert.equal(PD.blend(src, dst, 2), TWO_THIRDS[i][j], src.toString(16) + ' over ' + dst.toString(16) + ', two thirds');
  }));
});

test('level, upright and 45-degree segments are solid; points are floored to whole pixels; one point draws nothing', () => {
  const fb = PD.framebuffer(8, 8, PD.BLACK);
  PD.drawPaths(fb, [
    { pts: [[4, 4], [47, 7]], open: true },     // (0, 0) to (5, 0): its eighths only pick the pixel
    { pts: [[4, 12], [4, 52]], open: true },    // (0, 1) to (0, 6)
    { pts: [[12, 12], [52, 52]], open: true },  // (1, 1) to (6, 6)
    { pts: [[60, 60]], open: true },            // (7, 7): one point, nothing
  ], 0, 0, PD.WHITE, true);
  const lit = [];
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const v = fb.px[y * 8 + x];
      assert.ok(v === PD.BLACK || v === PD.WHITE, 'no grey on a level, upright or 45-degree segment');
      if (v === PD.WHITE) lit.push(x + ',' + y);
    }
  }
  assert.deepEqual(lit.sort(), ['0,0', '1,0', '2,0', '3,0', '4,0', '5,0', '0,1', '0,2', '0,3', '0,4', '0,5', '0,6',
    '1,1', '2,2', '3,3', '4,4', '5,5', '6,6'].sort());
});

test('a slanted segment is smoothed with greys on a colour watch and stays black and white without smoothing', () => {
  const draw = (smooth) => {
    const fb = PD.framebuffer(10, 6, PD.BLACK);
    PD.drawPaths(fb, [{ pts: [[4, 4], [68, 28]], open: true }], 0, 0, PD.WHITE, smooth);   // (0, 0) to (8, 3)
    return Array.from(fb.px);
  };
  const greys = (px) => px.filter((v) => v !== PD.BLACK && v !== PD.WHITE).length;
  assert.ok(greys(draw(true)) > 0, 'smoothed: grey pixels beside the line');
  assert.equal(greys(draw(false)), 0, 'the black and white watches: none');
  assert.equal(draw(false).filter((v) => v === PD.WHITE).length, 9, 'Bresenham: one pixel per column');
});
