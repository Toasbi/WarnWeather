'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const DATA = path.join(__dirname, '..', 'resources', 'data');

// Walk the PDCI container and every command, delegating per-command checks to the
// caller. Returns nothing; asserts structural validity (magic, size field,
// version, viewbox, precise-path type, points inside the viewbox, no trailing).
function walkPdc(file, viewbox, checkCmd) {
  const buf = fs.readFileSync(path.join(DATA, file));
  assert.strictEqual(buf.toString('ascii', 0, 4), 'PDCI', 'magic');
  assert.strictEqual(buf.readUInt32LE(4), buf.length - 8, 'payload size field');
  assert.strictEqual(buf.readUInt8(8), 1, 'version');
  assert.strictEqual(buf.readInt16LE(10), viewbox, 'viewbox width');
  assert.strictEqual(buf.readInt16LE(12), viewbox, 'viewbox height');
  const nCmds = buf.readUInt16LE(14);
  assert.ok(nCmds >= 1 && nCmds <= 12, 'command count sane');

  let off = 16;
  for (let c = 0; c < nCmds; c++) {
    assert.strictEqual(buf.readUInt8(off), 3, 'precise path');
    if (checkCmd) { checkCmd(buf, off); }
    const nPts = buf.readUInt16LE(off + 7);
    off += 9;
    for (let p = 0; p < nPts; p++) {
      const x = buf.readInt16LE(off) / 8;
      const y = buf.readInt16LE(off + 2) / 8;
      assert.ok(x >= 0 && x <= viewbox && y >= 0 && y <= viewbox,
                `point in viewbox (${x},${y})`);
      off += 4;
    }
  }
  assert.strictEqual(off, buf.length, 'no trailing bytes');
}

// 24x24 outline family: all converted from docs/superpowers/svg/*.svg via
// scripts/svg2pdc.py. Stroke-only line-art — status_row_icons.c recolors the stroke to
// theme_fg() and clears the fill, so the authored stroke *colour* is irrelevant; each
// just needs a non-clear stroke and a clear fill. STATUS_POLLEN is wired as a status-row
// resource and is validated here with the rest of the outline family.
const OUTLINE_24 = ['STATUS_TEMP.pdc', 'STATUS_UV.pdc', 'STATUS_WIND.pdc',
                    'STATUS_GUST.pdc', 'STATUS_POLLEN.pdc', 'STATUS_PRECIP.pdc',
                    'STATUS_DISTANCE.pdc', 'STATUS_AQI.pdc'];

for (const file of OUTLINE_24) {
  test(`${file} is a valid 24x24 outline PDCI`, () => {
    walkPdc(file, 24, (buf, off) => {
      assert.notStrictEqual(buf.readUInt8(off + 2), 0x00, 'stroke color set');
      assert.ok(buf.readUInt8(off + 3) >= 1, 'stroke width >= 1');
      assert.strictEqual(buf.readUInt8(off + 4), 0x00, 'fill clear');
    });
  });
}

// 25x25 health family: hand-authored glyphs (heart/sleep/steps). Unlike the outline
// family these mix fill and stroke commands (the render path clears the fill and recolors
// the stroke, so they still read as outlines on the watch). HEALTH_HEART is the plain
// heart glyph, deliberately without the ECG pulse line. Validate the container +
// geometry only — do not assert stroke/fill specifics.
const HEALTH_25 = ['HEALTH_HEART.pdc', 'HEALTH_SLEEP.pdc', 'HEALTH_STEPS.pdc'];

for (const file of HEALTH_25) {
  test(`${file} is a valid 25x25 health PDCI`, () => {
    walkPdc(file, 25, null);
  });
}
