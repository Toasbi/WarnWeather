'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const DATA = path.join(__dirname, '..', 'resources', 'data');
const EXPECT = { 'RAIN_DRIZZLE.pdc': 1, 'RAIN_RAIN.pdc': 2, 'RAIN_DOWNPOUR.pdc': 3 };

for (const [file, drops] of Object.entries(EXPECT)) {
  test(`${file} is a valid PDCI image with ${drops} drop command(s)`, () => {
    const buf = fs.readFileSync(path.join(DATA, file));
    assert.strictEqual(buf.toString('ascii', 0, 4), 'PDCI', 'magic');
    assert.strictEqual(buf.readUInt32LE(4), buf.length - 8, 'payload size field');
    assert.strictEqual(buf.readUInt8(8), 1, 'version');
    assert.strictEqual(buf.readInt16LE(10), 25, 'viewbox width');
    assert.strictEqual(buf.readInt16LE(12), 25, 'viewbox height');
    assert.strictEqual(buf.readUInt16LE(14), drops, 'command (drop) count');
  });
}

function commands(buf) {
  const out = [];
  let off = 16;
  const n = buf.readUInt16LE(14);
  for (let c = 0; c < n; c++) {
    const strokeColor = buf.readUInt8(off + 2);
    const strokeWidth = buf.readUInt8(off + 3);
    const fillColor = buf.readUInt8(off + 4);
    const nPts = buf.readUInt16LE(off + 7);
    off += 9;
    const pts = [];
    for (let p = 0; p < nPts; p++) {
      pts.push([buf.readInt16LE(off), buf.readInt16LE(off + 2)]);
      off += 4;
    }
    out.push({ strokeColor, strokeWidth, fillColor, pts });
  }
  return out;
}

function dropSize(cmd) {
  const xs = cmd.pts.map(p => p[0]), ys = cmd.pts.map(p => p[1]);
  return [Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
}

test('all drops share one geometry unit, filled-styled', () => {
  const all = [];
  for (const [file, drops] of Object.entries(EXPECT)) {
    const cmds = commands(fs.readFileSync(path.join(DATA, file)));
    assert.equal(cmds.length, drops, file);
    all.push(...cmds);
  }
  const ref = all[0];
  for (const cmd of all) {
    assert.equal(cmd.strokeColor, 0x00, 'stroke clear (filled)');
    assert.equal(cmd.strokeWidth, ref.strokeWidth, 'uniform stroke width');
    assert.notEqual(cmd.fillColor, 0x00, 'fill set (filled)');
    assert.equal(cmd.pts.length, ref.pts.length, 'same point count per drop');
    assert.deepEqual(dropSize(cmd), dropSize(ref), 'same per-drop bounds');
  }
});

test('rain glyph normalization preserves filled styling when tinting', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'c', 'layers', 'top_status_layer.c'), 'utf8');
  const callback = source.slice(
    source.indexOf('static bool rain_norm_cb'),
    source.indexOf('static uint32_t rain_glyph_resource'));

  assert.match(callback, /gdraw_command_set_fill_color\(command, b->tint\);/,
               'runtime applies the tier tint to the drop fill');
  assert.match(callback, /if \(b->outline\)[\s\S]*gdraw_command_set_stroke_color\(command, GColorBlack\);[\s\S]*gdraw_command_set_stroke_width\(command, 1\);/,
               'light theme may add contrast without replacing the fill');
});
