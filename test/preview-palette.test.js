// test/preview-palette.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildPreviewPalette } = require('../src/pkjs/settings/preview-palette.js');
const fs = require('../src/pkjs/forecast-series.js');
const rt = require('../src/pkjs/weather/rain-tier.js');

const hex = (n) => '#' + (n & 0xFFFFFF).toString(16).toUpperCase().padStart(6, '0');

test('palette line colors come from forecast-series.lineColorFor (cannot diverge)', () => {
  const P = buildPreviewPalette();
  assert.equal(P.line.precip_prob.color, hex(fs.lineColorFor('precip_prob', {}, true))); // #55AAFF
  assert.equal(P.line.precip_prob.bw, hex(fs.lineColorFor('precip_prob', {}, false)));    // #FFFFFF
  assert.equal(P.line.wind.color, hex(fs.lineColorFor('wind', {}, true)));                // #FFFF00
  assert.equal(P.line.uv.color, hex(fs.lineColorFor('uv', {}, true)));                    // #FF00FF
  assert.equal(P.line.gust.colorWhiteBars, hex(fs.lineColorFor('gust', { rainBarColor: 'white' }, true)));      // #AAAAAA
  assert.equal(P.line.gust.colorMulti, hex(fs.lineColorFor('gust', { rainBarColor: 'multicolor' }, true)));     // #FFFFFF
  assert.equal(P.line.gust.bw, hex(fs.lineColorFor('gust', {}, false)));                  // #FFFFFF
});

test('palette fill colors come from forecast-series.fillColorFor for every metric', () => {
  const P = buildPreviewPalette();
  ['precip_prob', 'wind', 'uv', 'gust'].forEach((m) => {
    assert.equal(P.fill[m].color, hex(fs.fillColorFor(m, true)), m + ' fill color');
    assert.equal(P.fill[m].bw, hex(fs.fillColorFor(m, false)), m + ' fill bw');
  });
  assert.equal(P.fill.wind.color, '#555500');  // ArmyGreen
  assert.equal(P.fill.precip_prob.color, '#0055AA'); // CobaltBlue
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
