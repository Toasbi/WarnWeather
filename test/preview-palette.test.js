// test/preview-palette.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildPreviewPalette } = require('../src/pkjs/settings/preview-palette.js');
const fs = require('../src/pkjs/forecast-series.js');
const lineStyle = require('../src/pkjs/line-style.js');
const rt = require('../src/pkjs/weather/rain-tier.js');

const hex = (n) => '#' + (n & 0xFFFFFF).toString(16).toUpperCase().padStart(6, '0');

test('palette line colors come from line-style.lineColorFor (cannot diverge)', () => {
  const P = buildPreviewPalette();
  assert.equal(P.line.precip_prob.color, hex(lineStyle.lineColorFor('precip_prob', {}, true))); // #55AAFF
  assert.equal(P.line.precip_prob.bw, hex(lineStyle.lineColorFor('precip_prob', {}, false)));    // #FFFFFF
  assert.equal(P.line.wind.color, hex(lineStyle.lineColorFor('wind', {}, true)));                // #FFFF00
  assert.equal(P.line.uv.color, hex(lineStyle.lineColorFor('uv', {}, true)));                    // #FF00FF
  assert.equal(P.line.gust.colorWhiteBars, hex(lineStyle.lineColorFor('gust', { rainBarColor: 'white' }, true)));      // #AAAAAA
  assert.equal(P.line.gust.colorMulti, hex(lineStyle.lineColorFor('gust', { rainBarColor: 'multicolor' }, true)));     // #FFFFFF
  assert.equal(P.line.gust.bw, hex(lineStyle.lineColorFor('gust', {}, false)));                  // #FFFFFF
});

test('palette line colors carry a light-theme variant for every hued metric', () => {
  const P = buildPreviewPalette();
  ['precip_prob', 'wind', 'uv'].forEach((m) => {
    assert.equal(P.line[m].light, hex(lineStyle.lineColorFor(m, {}, true, 'light')), m + ' line light');
  });
  assert.equal(P.line.precip_prob.light, '#00AAFF'); // VividCerulean — darker than the dark-theme PictonBlue
  assert.equal(P.line.wind.light, '#FFFF00');         // no light variant defined -> unchanged
  assert.equal(P.line.uv.light, '#FF00FF');           // no light variant defined -> unchanged
});

test('palette fill colors come from line-style.fillColorFor for every metric', () => {
  const P = buildPreviewPalette();
  ['precip_prob', 'wind', 'uv', 'gust'].forEach((m) => {
    assert.equal(P.fill[m].color, hex(lineStyle.fillColorFor(m, true)), m + ' fill color');
    assert.equal(P.fill[m].bw, hex(lineStyle.fillColorFor(m, false)), m + ' fill bw');
  });
  assert.equal(P.fill.wind.color, '#555500');  // ArmyGreen
  assert.equal(P.fill.precip_prob.color, '#0055AA'); // CobaltBlue
});

test('palette fill colors carry a light-theme variant for every metric', () => {
  const P = buildPreviewPalette();
  ['precip_prob', 'wind', 'uv', 'gust'].forEach((m) => {
    assert.equal(P.fill[m].light, hex(lineStyle.fillColorFor(m, true, 'light')), m + ' fill light');
  });
  assert.equal(P.fill.precip_prob.light, '#55FFFF'); // ElectricBlue (one step darker than Celeste)
  assert.equal(P.fill.wind.light, '#AAFF55');         // Inchworm
  assert.equal(P.fill.uv.light, '#FF55FF');           // ShockingPink
  assert.equal(P.fill.gust.light, '#AAAAAA');         // LightGray
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
