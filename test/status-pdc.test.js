'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const DATA = path.join(__dirname, '..', 'resources', 'data');
const FILES = ['STATUS_TEMP.pdc', 'STATUS_UV.pdc', 'STATUS_WIND.pdc',
               'STATUS_GUST.pdc', 'STATUS_PRECIP.pdc', 'STATUS_DISTANCE.pdc'];

for (const file of FILES) {
  test(`${file} is a valid outline PDCI`, () => {
    const buf = fs.readFileSync(path.join(DATA, file));
    assert.strictEqual(buf.toString('ascii', 0, 4), 'PDCI', 'magic');
    assert.strictEqual(buf.readUInt32LE(4), buf.length - 8, 'payload size field');
    assert.strictEqual(buf.readUInt8(8), 1, 'version');
    assert.strictEqual(buf.readInt16LE(10), 24, 'viewbox width');
    assert.strictEqual(buf.readInt16LE(12), 24, 'viewbox height');
    const nCmds = buf.readUInt16LE(14);
    assert.ok(nCmds >= 1 && nCmds <= 6, 'command count sane');

    let off = 16;
    for (let c = 0; c < nCmds; c++) {
      assert.strictEqual(buf.readUInt8(off), 3, 'precise path');
      assert.strictEqual(buf.readUInt8(off + 2), 0xFF, 'stroke color set');
      assert.strictEqual(buf.readUInt8(off + 3), 2, 'stroke width');
      assert.strictEqual(buf.readUInt8(off + 4), 0x00, 'fill clear');
      const nPts = buf.readUInt16LE(off + 7);
      off += 9;
      for (let p = 0; p < nPts; p++) {
        const x = buf.readInt16LE(off) / 8;
        const y = buf.readInt16LE(off + 2) / 8;
        assert.ok(x >= 0 && x <= 24 && y >= 0 && y <= 24,
                  `point in viewbox (${x},${y})`);
        off += 4;
      }
    }
    assert.strictEqual(off, buf.length, 'no trailing bytes');
  });
}
