'use strict';
// The setup wizard frames each screenshot in the screen pictures' frame (screen-frame.js): a
// margin of the screen's own ground all round, the ground the wizard picks per shot
// (wizard.js shotGround). A shot captured on another background would show a seam where the
// margin meets it, so this reads every committed shot's four corner pixels against that rule.
const test = require('node:test');
const assert = require('node:assert');
const zlib = require('zlib');

global.PConf = global.PConf || {};
const SHOTS = require('../src/pkjs/settings/wizard-screenshots.generated.js');
const { shotGround } = require('../src/pkjs/settings/wizard.js');

/**
 * The four corner pixels of an 8-bit RGBA, non-interlaced PNG (what the emulator captures).
 * @param {Buffer} png The file.
 * @returns {string[]} '#RRGGBB' at top-left, top-right, bottom-left, bottom-right.
 */
function corners(png) {
  const w = png.readUInt32BE(16);
  const h = png.readUInt32BE(20);
  assert.deepEqual([png[24], png[25], png[28]], [8, 6, 0], 'an 8-bit RGBA, non-interlaced PNG');
  const idat = [];
  for (let at = 8; at < png.length;) {
    const len = png.readUInt32BE(at);
    if (png.toString('ascii', at + 4, at + 8) === 'IDAT') { idat.push(png.subarray(at + 8, at + 8 + len)); }
    at += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * 4;
  const rows = [];
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y += 1) {
    const type = raw[y * (stride + 1)];
    const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i += 1) {
      const a = i >= 4 ? line[i - 4] : 0;
      const b = prev[i];
      const c = i >= 4 ? prev[i - 4] : 0;
      let add = 0;
      if (type === 1) { add = a; } else if (type === 2) { add = b; } else if (type === 3) { add = (a + b) >> 1; } else if (type === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        add = (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      line[i] = (line[i] + add) & 255;
    }
    rows.push(line);
    prev = line;
  }
  const px = (x, y) => '#' + [0, 1, 2].map((k) => rows[y][x * 4 + k].toString(16).padStart(2, '0')).join('').toUpperCase();
  return [px(0, 0), px(w - 1, 0), px(0, h - 1), px(w - 1, h - 1)];
}

test('every wizard screenshot sits on the ground its frame is drawn in', () => {
  let n = 0;
  Object.keys(SHOTS).forEach((platform) => {
    Object.keys(SHOTS[platform]).forEach((group) => {
      const vals = SHOTS[platform][group];
      Object.keys(vals).forEach((val) => {
        const png = Buffer.from(vals[val].split(',')[1], 'base64');
        const want = shotGround(group, val);
        assert.deepEqual(corners(png), [want, want, want, want], platform + ' ' + group + ' ' + val);
        n += 1;
      });
    });
  });
  // The Layout and Theme pickers' shots (gen-wizard-fixtures.js SHOTS): 3 layouts on 4 watches,
  // dark and light on 3, B&W and B&W inverted on 2.
  assert.equal(n, 22, 'read ' + n + ' shots');
});
