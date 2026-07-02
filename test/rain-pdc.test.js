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
