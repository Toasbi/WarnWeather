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

// --- applyThemeAutoPreset: the themeAuto toggle's first-enable seeding -------
const { applyThemeAutoPreset } = require('../src/pkjs/settings/theme-convert.js');

// The preset writes themeNight and NOTHING ELSE. It used to also flip S.theme to
// 'light' and run applyThemeConvert over the stored colours, on the reasoning that
// the Theme row was hidden behind a "Day theme" row while the switch was on. Now
// that the Theme row is permanently visible and doubles as the day theme, a preset
// that moved it would be the settings page changing the user's theme — and their
// colours with it — behind their back. These tests pin the day side as untouched in
// every branch, because that is the property the redesign turns on.
test('first enable seeds the night pick and leaves the day theme and colours alone', () => {
  const S = { theme: 'light', themeNight: 'light', colorTime: '#000000', rainBarColor: 'white' };
  applyThemeAutoPreset(S, false, true);
  assert.equal(S.themeNight, 'dark');
  assert.equal(S.theme, 'light', 'the Theme row is the user\'s, not the preset\'s');
  assert.equal(S.colorTime, '#000000', 'no polarity conversion: the day polarity did not move');
  assert.equal(S.rainBarColor, 'white');
});

test('enable with an already-differentiated pair changes nothing', () => {
  const S = { theme: 'bw', themeNight: 'dark', colorTime: '#FFFFFF' };
  applyThemeAutoPreset(S, false, true);
  assert.equal(S.theme, 'bw');
  assert.equal(S.themeNight, 'dark');
  assert.equal(S.colorTime, '#FFFFFF');
});

// The accepted cost of never touching the day theme: a fresh install is already
// dark/dark, so the seed lands on the value that is there and the switch does
// nothing visible until the user sets one of the two apart. Pinned so the silence
// is a decision on the record rather than something that looks like a bug later.
test('first enable on a fresh dark install leaves both picks dark', () => {
  const S = { theme: 'dark', themeNight: 'dark', colorTime: '#FFFFFF', rainBarColor: 'multicolor' };
  applyThemeAutoPreset(S, false, true);
  assert.equal(S.theme, 'dark');
  assert.equal(S.themeNight, 'dark');
  assert.equal(S.colorTime, '#FFFFFF', 'no conversion runs: nothing flipped polarity');
  assert.equal(S.rainBarColor, 'multicolor');
});

test('disabling the switch never touches the pair', () => {
  const S = { theme: 'light', themeNight: 'dark' };
  applyThemeAutoPreset(S, true, false);
  assert.equal(S.theme, 'light');
  assert.equal(S.themeNight, 'dark');
});

// --- both encodings: the phone's stored blob holds 0xRRGGBB INTS ---------------------
// config-ui parseResponse runs hexToInt on every colour key at save and seedDefaults
// writes GColorWhite as an int, and the auto theme switch converts THAT blob
// (theme-schedule.js). The string-only rule these tests replace left a light-day
// user's black clock black on the dark night face. strictEqual throughout: the
// converted value must stay a NUMBER, or it would ride the wire as a cstring.

test('int-encoded fg picks convert and stay ints (light -> dark)', () => {
  const S = { colorTime: 0x000000, colorSunday: 0x000000, colorSaturday: 0xFF0055, colorUSFederal: 0x000000 };
  applyThemeConvert(S, 'light', 'dark');
  assert.strictEqual(S.colorTime, 0xFFFFFF);
  assert.strictEqual(S.colorSunday, 0xFFFFFF);
  assert.strictEqual(S.colorSaturday, 0xFF0055, 'a real pick is untouched');
  assert.strictEqual(S.colorUSFederal, 0xFFFFFF);
});

test('int-encoded fg picks convert and stay ints (dark -> light)', () => {
  const S = { colorTime: 0xFFFFFF, colorSunday: 0xFF0055 };
  applyThemeConvert(S, 'dark', 'light');
  assert.strictEqual(S.colorTime, 0x000000);
  assert.strictEqual(S.colorSunday, 0xFF0055);
});

test('int-encoded: a same-polarity flip (dark<->bw, light<->bw-light) converts nothing', () => {
  const S = { colorTime: 0xFFFFFF };
  applyThemeConvert(S, 'dark', 'bw');
  assert.strictEqual(S.colorTime, 0xFFFFFF);
  const L = { colorTime: 0 };
  applyThemeConvert(L, 'light', 'bw-light');
  assert.strictEqual(L.colorTime, 0);
});

test('int-encoded colorToday 0 (the auto sentinel) is exempt in both directions', () => {
  const S = { colorToday: 0 };
  applyThemeConvert(S, 'light', 'dark');
  assert.strictEqual(S.colorToday, 0);
  applyThemeConvert(S, 'dark', 'light');
  assert.strictEqual(S.colorToday, 0);
});

// The threshold highlight colours on "auto" hold the theme fg concretely (onbuild.js
// re-derives them only on the NEXT page open), so they flip with the polarity too —
// the page's own definition of auto (blocks.js: either fg value).
test('auto (fg) threshold colours convert in either encoding; blank and picks do not', () => {
  const S = {
    threshWindDangerColor: '#FFFFFF', threshAqiWarnColor: 0xFFFFFF,
    threshGustWarnColor: '', threshStepsDangerColor: '#55FF00', threshUvDangerColor: 0xFF0000,
    threshAqiWarnOutlineOn: true
  };
  applyThemeConvert(S, 'dark', 'light');
  assert.strictEqual(S.threshWindDangerColor, '#000000');
  assert.strictEqual(S.threshAqiWarnColor, 0x000000);
  assert.strictEqual(S.threshGustWarnColor, '', 'the no-outline sentinel survives');
  assert.strictEqual(S.threshStepsDangerColor, '#55FF00', 'goal green is not a foreground');
  assert.strictEqual(S.threshUvDangerColor, 0xFF0000, 'a real pick is untouched');
  assert.strictEqual(S.threshAqiWarnOutlineOn, true, 'only *Color keys are colours');
});
