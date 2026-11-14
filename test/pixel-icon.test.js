// test/pixel-icon.test.js — the settings page's pictures of the watch's pixel drawings
// (src/pkjs/settings/pixel-icon.js): each lit pixel, and nothing else, filled.
const test = require('node:test');
const assert = require('node:assert/strict');
const PixelIcon = require('../src/pkjs/settings/pixel-icon.js');
const pixels = require('../src/pkjs/settings/condition-pixels.generated.js');

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
  Object.keys(pixels).forEach((key) => {
    const p = pixels[key], lit = new Set();
    p.rows.forEach((bits, y) => { for (let x = 0; x < p.w; x++) { if (bits & (1 << x)) { lit.add(x + ',' + y); } } });
    assert.deepEqual(drawn(PixelIcon.path(p)), lit, key);
  });
});

test('a drawing\'s svg fills the box it is given, in the current colour', () => {
  assert.equal(PixelIcon.svg({ w: 4, rows: [6, 9] }), '<svg viewBox="0 0 4 2" shape-rendering="crispEdges" aria-hidden="true">'
    + '<path fill="currentColor" d="M1 0h2v1h-2zM0 1h1v1h-1zM3 1h1v1h-1z"/></svg>');
  assert.equal(PixelIcon.svg(null), '', 'nothing for no drawing');
});
