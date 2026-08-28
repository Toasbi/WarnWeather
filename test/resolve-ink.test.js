const test = require('node:test');
const assert = require('node:assert/strict');
const COLORS = require('../src/pkjs/pebble-colors.js');
const { resolveInk, isLightPolarity, isBwTheme, effectiveTheme, barColorDefault,
  BAR_COLOR_KEYS } = require('../src/pkjs/resolve-ink.js');

test('light theme: exact white flips to black', () => {
  assert.equal(resolveInk(COLORS.GColorWhite, 'light'), COLORS.GColorBlack);
});

test('bw-light theme: exact white flips to black (light polarity)', () => {
  assert.equal(resolveInk(COLORS.GColorWhite, 'bw-light'), COLORS.GColorBlack);
});

test('dark/bw theme: white passes through unchanged', () => {
  assert.equal(resolveInk(COLORS.GColorWhite, 'dark'), COLORS.GColorWhite);
  assert.equal(resolveInk(COLORS.GColorWhite, 'bw'), COLORS.GColorWhite);
});

test('non-white colors pass through unchanged in every theme (hues and grays untouched)', () => {
  assert.equal(resolveInk(COLORS.GColorLightGray, 'light'), COLORS.GColorLightGray);
  assert.equal(resolveInk(COLORS.GColorRed, 'light'), COLORS.GColorRed);
  assert.equal(resolveInk(COLORS.GColorBlack, 'light'), COLORS.GColorBlack);
});

test('isLightPolarity: true for light and bw-light, false for dark and bw', () => {
  assert.equal(isLightPolarity('light'), true);
  assert.equal(isLightPolarity('bw-light'), true);
  assert.equal(isLightPolarity('dark'), false);
  assert.equal(isLightPolarity('bw'), false);
});

test('isBwTheme: true for bw and bw-light, false for dark and light', () => {
  assert.equal(isBwTheme('bw'), true);
  assert.equal(isBwTheme('bw-light'), true);
  assert.equal(isBwTheme('dark'), false);
  assert.equal(isBwTheme('light'), false);
});

test('effectiveTheme: polarity-capable platform leaves every theme unchanged', () => {
  assert.equal(effectiveTheme('light', true), 'light');
  assert.equal(effectiveTheme('bw-light', true), 'bw-light');
  assert.equal(effectiveTheme('dark', true), 'dark');
  assert.equal(effectiveTheme('bw', true), 'bw');
});

test('effectiveTheme: no-polarity platform (aplite) folds light-polarity themes to their dark twins', () => {
  assert.equal(effectiveTheme('light', false), 'dark');
  assert.equal(effectiveTheme('bw-light', false), 'bw');
  // Dark-polarity themes already render as-is on aplite — untouched.
  assert.equal(effectiveTheme('dark', false), 'dark');
  assert.equal(effectiveTheme('bw', false), 'bw');
});

test('barColorDefault answers per polarity, not per theme', () => {
  assert.equal(barColorDefault('dark'), 'multicolor');
  assert.equal(barColorDefault('bw'), 'multicolor');
  assert.equal(barColorDefault('light'), 'white');
  assert.equal(barColorDefault('bw-light'), 'white');
  assert.equal(barColorDefault(undefined), 'multicolor', 'an unset theme reads as dark');
});

test('BAR_COLOR_KEYS names both bar-mode settings', () => {
  assert.deepEqual(BAR_COLOR_KEYS, ['rainBarColor', 'radarColor']);
});

test('requiring resolve-ink registers nothing — that is why both sides can share it', () => {
  // The property that makes this module the home for barColorDefault rather than
  // settings/theme-convert.js, which registers a config-UI onChange hook at import
  // time. A phone-side consumer (clay-settings.js, weather/palette-wire.js) must be
  // able to require it without dragging a page registry into the runtime.
  const before = global.PConf;
  delete require.cache[require.resolve('../src/pkjs/resolve-ink.js')];
  require('../src/pkjs/resolve-ink.js');
  assert.equal(global.PConf, before, 'resolve-ink must not touch global.PConf');
});
