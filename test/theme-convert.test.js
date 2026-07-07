const test = require('node:test');
const assert = require('node:assert/strict');
const { applyThemeConvert } = require('../src/pkjs/settings/theme-convert.js');

test('dark -> light: white picks convert to black', () => {
  const S = { colorTime: '#FFFFFF', colorSunday: '#FFFFFF', colorSaturday: '#FF0055', colorUSFederal: '#FFFFFF' };
  applyThemeConvert(S, 'dark', 'light');
  assert.equal(S.colorTime, '#000000');
  assert.equal(S.colorSunday, '#000000');
  assert.equal(S.colorSaturday, '#FF0055', 'a non-default custom pick is left alone');
  assert.equal(S.colorUSFederal, '#000000');
});

test('light -> dark: black picks convert back to white', () => {
  const S = { colorTime: '#000000', colorSunday: '#FF0055' };
  applyThemeConvert(S, 'light', 'dark');
  assert.equal(S.colorTime, '#FFFFFF');
  assert.equal(S.colorSunday, '#FF0055');
});

test('dark <-> bw is not a polarity change: no conversion', () => {
  const S = { colorTime: '#FFFFFF' };
  applyThemeConvert(S, 'dark', 'bw');
  assert.equal(S.colorTime, '#FFFFFF');
  applyThemeConvert(S, 'bw', 'dark');
  assert.equal(S.colorTime, '#FFFFFF');
});

test('colorToday is exempt from conversion (black is the "auto" sentinel, not a color)', () => {
  const S = { colorToday: '#000000' };
  applyThemeConvert(S, 'dark', 'light');
  assert.equal(S.colorToday, '#000000', 'colorToday never converts');
});

test('lowercase hex still matches (case-insensitive)', () => {
  const S = { colorTime: '#ffffff' };
  applyThemeConvert(S, 'dark', 'light');
  assert.equal(S.colorTime, '#000000');
});

test('a non-default custom color is never touched by a polarity flip', () => {
  const S = { colorTime: '#00AAFF' };
  applyThemeConvert(S, 'dark', 'light');
  assert.equal(S.colorTime, '#00AAFF');
});
