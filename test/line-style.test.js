const test = require('node:test');
const assert = require('node:assert');
const lineStyle = require('../src/pkjs/line-style.js');
const rainTier = require('../src/pkjs/weather/rain-tier.js');

const emery = { platform: 'emery' };

test('packs four bytes: three GColor8 colours plus a flag byte', () => {
  const bytes = lineStyle.buildLineStyleBytes(
    { secondaryLine: 'wind', thirdLine: 'gust', secondaryLineFill: false, theme: 'dark' }, emery);
  assert.equal(bytes.length, 4);
  bytes.slice(0, 3).forEach((b) => assert.ok(b >= 0xC0 && b <= 0xFF, `${b} is not a GColor8`));
  assert.equal(bytes[3], 0, 'fill off');
});

test('the fill flag follows secondaryLineFill', () => {
  const on = lineStyle.buildLineStyleBytes(
    { secondaryLine: 'wind', thirdLine: 'off', secondaryLineFill: true, theme: 'dark' }, emery);
  assert.equal(on[3] & 0x01, 1);
});

test('feels-like never fills, whatever the setting says', () => {
  const bytes = lineStyle.buildLineStyleBytes(
    { secondaryLine: 'feels', thirdLine: 'off', secondaryLineFill: true, theme: 'dark' }, emery);
  assert.equal(bytes[3] & 0x01, 0);
});

test('the packed colour equals the quantized resolved colour', () => {
  const settings = { secondaryLine: 'wind', thirdLine: 'gust', secondaryLineFill: false, theme: 'dark' };
  const resolved = lineStyle.resolveLineStyle(settings, emery);
  const bytes = lineStyle.buildLineStyleBytes(settings, emery);
  assert.equal(bytes[0], rainTier.rgbToGColor8(resolved.secondary));
  assert.equal(bytes[2], rainTier.rgbToGColor8(resolved.third));
});

test('aplite folds a light theme back to dark polarity (no black-on-black)', () => {
  const light = lineStyle.resolveLineStyle(
    { secondaryLine: 'wind', thirdLine: 'off', theme: 'light' }, { platform: 'aplite' });
  const dark = lineStyle.resolveLineStyle(
    { secondaryLine: 'wind', thirdLine: 'off', theme: 'dark' }, { platform: 'aplite' });
  assert.equal(light.secondary, dark.secondary);
});

test('a third colour is always resolved, even when the third line is off', () => {
  const off = lineStyle.resolveLineStyle(
    { secondaryLine: 'wind', thirdLine: 'off', theme: 'dark' }, emery);
  assert.equal(typeof off.third, 'number');
});
