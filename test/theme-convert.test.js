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

test('light <-> bw-light is not a polarity change: no conversion', () => {
  const S = { colorTime: '#000000' };
  applyThemeConvert(S, 'light', 'bw-light');
  assert.equal(S.colorTime, '#000000');
  applyThemeConvert(S, 'bw-light', 'light');
  assert.equal(S.colorTime, '#000000');
});

test('dark -> bw-light IS a polarity change: white picks convert to black', () => {
  const S = { colorTime: '#FFFFFF', colorSunday: '#FFFFFF' };
  applyThemeConvert(S, 'dark', 'bw-light');
  assert.equal(S.colorTime, '#000000');
  assert.equal(S.colorSunday, '#000000');
});

test('bw -> bw-light IS a polarity change: white picks convert to black', () => {
  const S = { colorTime: '#FFFFFF' };
  applyThemeConvert(S, 'bw', 'bw-light');
  assert.equal(S.colorTime, '#000000');
});

test('bw-light -> dark IS a polarity change: black picks convert to white', () => {
  const S = { colorTime: '#000000' };
  applyThemeConvert(S, 'bw-light', 'dark');
  assert.equal(S.colorTime, '#FFFFFF');
});

test('bw-light -> bw IS a polarity change: black picks convert to white', () => {
  const S = { colorTime: '#000000' };
  applyThemeConvert(S, 'bw-light', 'bw');
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

// barColorDefault itself is pinned in test/resolve-ink.test.js, which owns it. What
// belongs here is the hook: which values it converts, and when.

test('dark -> light: the bar color modes convert to Solid', () => {
  const S = { rainBarColor: 'multicolor', radarColor: 'multicolor' };
  applyThemeConvert(S, 'dark', 'light');
  assert.equal(S.rainBarColor, 'white');
  assert.equal(S.radarColor, 'white');
});

test('light -> dark: the bar color modes convert back to multicolor', () => {
  const S = { rainBarColor: 'white', radarColor: 'white' };
  applyThemeConvert(S, 'light', 'dark');
  assert.equal(S.rainBarColor, 'multicolor');
  assert.equal(S.radarColor, 'multicolor');
});

test('a bar mode holding the NEW polarity default is left where it is', () => {
  // Solid picked by hand on dark: the flip to light wants Solid anyway, so there is
  // nothing to convert — and the flip back must not read it as a light-seeded value.
  const S = { rainBarColor: 'white', radarColor: 'multicolor' };
  applyThemeConvert(S, 'dark', 'light');
  assert.equal(S.rainBarColor, 'white');
  assert.equal(S.radarColor, 'white', 'the other key still converts independently');
});

test('the bar modes do not convert without a polarity change', () => {
  const S = { rainBarColor: 'multicolor', radarColor: 'multicolor' };
  applyThemeConvert(S, 'dark', 'bw');
  assert.equal(S.rainBarColor, 'multicolor');
  applyThemeConvert(S, 'light', 'bw-light');
  assert.equal(S.rainBarColor, 'multicolor');
});

test('bw -> bw-light converts the bar modes even though B&W never paints them', () => {
  // The picker is hidden on a B&W theme, but the stored value is what a later
  // bw-light -> light pick inherits, and THAT is not a polarity flip.
  const S = { rainBarColor: 'multicolor', radarColor: 'multicolor' };
  applyThemeConvert(S, 'bw', 'bw-light');
  assert.equal(S.rainBarColor, 'white');
  assert.equal(S.radarColor, 'white');
  applyThemeConvert(S, 'bw-light', 'light');
  assert.equal(S.rainBarColor, 'white', 'and it survives the non-flip into Light');
});

test('an absent bar mode is not invented by a polarity flip', () => {
  const S = { colorTime: '#FFFFFF' };
  applyThemeConvert(S, 'dark', 'light');
  assert.equal('rainBarColor' in S, false);
  assert.equal('radarColor' in S, false);
});
