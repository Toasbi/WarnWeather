// test/preview-palette.test.js
//
// The palette used to carry the graph's per-metric line and fill colours, and this file
// pinned each of them to line-style.lineColorFor/fillColorFor. Those colours are no
// longer snapshotted at page-open: preview-forecast.js resolves them live through
// line-style.resolveGraphColors, so line-style.test.js is the only place they are
// asserted now. What remains here is what the palette still carries.
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildPreviewPalette } = require('../src/pkjs/settings/preview-palette.js');
const rt = require('../src/pkjs/weather/rain-tier.js');

const hex = (n) => '#' + (n & 0xFFFFFF).toString(16).toUpperCase().padStart(6, '0');

test('palette rain tiers come from rain-tier.buildPalette', () => {
  const P = buildPreviewPalette();
  const tier = rt.buildPalette('basalt', 'multicolor');
  assert.equal(P.rainTiers.length, tier.from.length);
  tier.from.forEach((f, k) => {
    assert.equal(P.rainTiers[k].from, f);
    assert.equal(P.rainTiers[k].color, hex(tier.rgb[k]));
  });
  assert.equal(P.rainTiers[2].color, '#00FF00'); // green
});

test('temp curve mirrors the C constant GColorRed', () => {
  assert.equal(buildPreviewPalette().temp, '#FF0000');
});

test('the palette no longer snapshots the graph line/fill colours', () => {
  const P = buildPreviewPalette();
  assert.equal(P.line, undefined,
    'a page-open snapshot of the line colours would freeze the preview on the colours ' +
    'the page opened with — preview-forecast.js resolves them from `state` instead');
  assert.equal(P.fill, undefined, 'same for the fill colours');
});
