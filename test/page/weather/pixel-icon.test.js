// test/page/weather/pixel-icon.test.js — the watch's pixel drawings as the settings page's pictures
// of the watch draw them (src/pkjs/page/weather/pixel-icon.js): each lit pixel, and nothing else,
// filled; the drawing the watch picks for a box.
const test = require('node:test');
const assert = require('node:assert/strict');
const PixelIcon = require('../../../src/pkjs/page/weather/pixel-icon.js');
const STATUS = require('../../../src/pkjs/settings/status-pixels.generated.js');

/**
 * The pixels a path() draws, read back from its rectangles.
 * @param {string} d The path.
 * @returns {!Set<string>} 'x,y' of each pixel.
 */
function drawn(d) {
  const out = new Set();
  d.replace(/M(\d+) (\d+)h(\d+)v1h-\3z/g, (m, x, y, n) => {
    for (let i = 0; i < Number(n); i++) { out.add((Number(x) + i) + ',' + y); }
    return m;
  });
  return out;
}

test('a pixel drawing draws exactly its lit pixels, a rectangle per run', () => {
  assert.equal(PixelIcon.path({ w: 4, rows: [6, 9] }), 'M1 0h2v1h-2zM0 1h1v1h-1zM3 1h1v1h-1z');
  Object.keys(STATUS.icons).forEach((key) => Object.keys(STATUS.icons[key]).forEach((size) => {
    const p = STATUS.icons[key][size], lit = new Set();
    p.rows.forEach((bits, y) => { for (let x = 0; x < p.w; x++) { if (bits & (1 << x)) { lit.add(x + ',' + y); } } });
    assert.deepEqual(drawn(PixelIcon.path(p)), lit, key + ' ' + size);
  }));
});

test('a watch family draws a box\'s own drawing, else the one for the tallest smaller box', () => {
  const sizes = STATUS.icons.SUN;
  assert.equal(PixelIcon.forBox('SUN', 'emery', 15), sizes['emery-15'], 'its own');
  assert.equal(PixelIcon.forBox('SUN', 'emery', 16), sizes['emery-15'], 'the tallest below');
  assert.equal(PixelIcon.forBox('SUN', 'basalt', 13), sizes['basalt-13'], 'per family: not emery\'s 13');
  assert.equal(PixelIcon.forBox('SUN', 'basalt', 99), sizes['basalt-13']);
  assert.equal(PixelIcon.forBox('SUN', 'basalt', 9), null, 'none below the smallest box');
  assert.equal(PixelIcon.forBox('NO_SUCH_ICON', 'basalt', 13), null);
});

test('the page draws the very drawings the watch is built with', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const gen = require('../../../scripts/pixel-icons/gen_watch_icons.js');
  const drawings = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'resources', 'pixel-icons.json'), 'utf8')).icons;
  Object.keys(drawings).forEach((key) => Object.keys(drawings[key].sizes).filter((s) => s !== 'A').forEach((size) => {
    const p = STATUS.icons[key] && STATUS.icons[key][size];
    assert.ok(p, key + ' ' + size + ' is on the page');
    const box = Number(size.split('-')[1]);
    assert.ok(p.rows.length >= box && (p.rows.length - box) % 2 === 0,
      key + ' ' + size + ': its whole box, seat rows kept (grown two rows at a time where a seat needs it)');
  }));
  Object.keys(gen.ICON_IDS).forEach((key) => gen.ICON_IDS[key].forEach((id) => {
    assert.equal(STATUS.ids[id], key, id + ' takes ' + key + '\'s drawings');
  }));
});
