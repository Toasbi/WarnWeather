// test/preview-palette.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildPreviewPalette } = require('../src/pkjs/settings/preview-palette.js');
const fs = require('../src/pkjs/forecast-series.js');
const rt = require('../src/pkjs/weather/rain-tier.js');

const hex = (n) => '#' + (n & 0xFFFFFF).toString(16).toUpperCase().padStart(6, '0');

test('palette line/fill colors come from forecast-series (cannot diverge)', () => {
  const P = buildPreviewPalette();
  assert.equal(P.precip, hex(fs.LINE_COLORS.precip_prob)); // #55AAFF
  assert.equal(P.wind, hex(fs.LINE_COLORS.wind));          // #FFFF00
  assert.equal(P.uv, hex(fs.LINE_COLORS.uv));              // #FF00FF
  assert.equal(P.fillPrecip, hex(fs.FILL_COLORS.precip_prob)); // #0055AA
  assert.equal(P.gustOnWhite, hex(fs.lineColorFor('gust', { rainBarColor: 'white' })));      // #AAAAAA
  assert.equal(P.gustOnColor, hex(fs.lineColorFor('gust', { rainBarColor: 'multicolor' }))); // #FFFFFF
});

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

test('temp curve mirrors the C constant GColorRed; white is white', () => {
  const P = buildPreviewPalette();
  assert.equal(P.temp, '#FF0000');
  assert.equal(P.white, '#FFFFFF');
});
