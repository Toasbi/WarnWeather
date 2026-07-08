// test/forecast-series-colors.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('../src/pkjs/forecast-series.js');
const C = require('../src/pkjs/pebble-colors.js');

test('forecast-series exposes the platform-aware line/fill color maps', () => {
  // Nested {color, bw} per metric (color display vs B&W).
  assert.equal(fs.LINE_COLORS.precip_prob.color, C.GColorPictonBlue);
  assert.equal(fs.LINE_COLORS.precip_prob.bw, C.GColorWhite);
  assert.equal(fs.LINE_COLORS.wind.color, C.GColorYellow);
  assert.equal(fs.LINE_COLORS.uv.color, C.GColorMagenta);
  assert.equal(fs.FILL_COLORS.precip_prob.color, C.GColorCobaltBlue);
  assert.equal(fs.FILL_COLORS.wind.color, C.GColorArmyGreen);
  assert.equal(fs.FILL_COLORS.uv.color, C.GColorPurple);
  assert.equal(fs.FILL_COLORS.gust.color, C.GColorDarkGray);
  assert.equal(fs.FILL_COLORS.precip_prob.bw, C.GColorLightGray);
});

test('lineColorFor resolves per platform, with the gust rule on color', () => {
  // Color display:
  assert.equal(fs.lineColorFor('wind', {}, true), C.GColorYellow);
  assert.equal(fs.lineColorFor('gust', { rainBarColor: 'white' }, true), C.GColorLightGray);
  assert.equal(fs.lineColorFor('gust', { rainBarColor: 'multicolor' }, true), C.GColorWhite);
  // B&W: every line is white.
  assert.equal(fs.lineColorFor('wind', {}, false), C.GColorWhite);
  assert.equal(fs.lineColorFor('gust', { rainBarColor: 'white' }, false), C.GColorWhite);
});

test('fillColorFor resolves per platform for every metric', () => {
  assert.equal(fs.fillColorFor('wind', true), C.GColorArmyGreen);
  assert.equal(fs.fillColorFor('gust', true), C.GColorDarkGray);
  assert.equal(fs.fillColorFor('wind', false), C.GColorLightGray);
  assert.equal(fs.fillColorFor('nope', true), undefined);
});

test('fillColorFor: light theme brightens every metric fill for contrast against white (first pass, to be tuned)', () => {
  assert.equal(fs.fillColorFor('precip_prob', true, 'light'), C.GColorCeleste);
  assert.equal(fs.fillColorFor('wind', true, 'light'), C.GColorInchworm);
  assert.equal(fs.fillColorFor('uv', true, 'light'), C.GColorShockingPink);
  assert.equal(fs.fillColorFor('gust', true, 'light'), C.GColorLightGray);
});

test('fillColorFor: dark theme fills are unchanged from the pre-light-theme colors', () => {
  assert.equal(fs.fillColorFor('precip_prob', true, 'dark'), C.GColorCobaltBlue);
  assert.equal(fs.fillColorFor('wind', true, 'dark'), C.GColorArmyGreen);
  assert.equal(fs.fillColorFor('uv', true, 'dark'), C.GColorPurple);
  assert.equal(fs.fillColorFor('gust', true, 'dark'), C.GColorDarkGray);
});

test('fillColorFor: B&W fills ignore theme (always LightGray, even in "light")', () => {
  assert.equal(fs.fillColorFor('precip_prob', false, 'light'), C.GColorLightGray);
  assert.equal(fs.fillColorFor('wind', false, 'light'), C.GColorLightGray);
});

test('fillColorFor: bw-light behaves like light for the brighter tint when effectively color', () => {
  assert.equal(fs.fillColorFor('precip_prob', true, 'bw-light'), C.GColorCeleste);
  assert.equal(fs.fillColorFor('wind', true, 'bw-light'), C.GColorInchworm);
});

test('fillColorFor: bw-light fills ignore theme when not effectively color (always LightGray)', () => {
  assert.equal(fs.fillColorFor('precip_prob', false, 'bw-light'), C.GColorLightGray);
});

test('fillColorFor: theme omitted defaults to dark (no light variant) — backward compatible', () => {
  assert.equal(fs.fillColorFor('precip_prob', true), C.GColorCobaltBlue);
});

test('lineColorFor: bw theme on color hardware routes through the B&W (isColor=false) arm', () => {
  assert.equal(fs.lineColorFor('precip_prob', {}, false, 'bw'), C.GColorWhite);
});

test('lineColorFor: bw-light theme on color hardware routes through the B&W arm, flipped to black (light polarity)', () => {
  assert.equal(fs.lineColorFor('precip_prob', {}, false, 'bw-light'), C.GColorBlack);
});

test('lineColorFor: light theme flips a resolved white line to black', () => {
  assert.equal(fs.lineColorFor('precip_prob', {}, false, 'light'), C.GColorBlack);
  assert.equal(fs.lineColorFor('gust', { rainBarColor: 'multicolor' }, true, 'light'), C.GColorBlack);
});

test('lineColorFor: hued colors pass through untouched in light theme', () => {
  assert.equal(fs.lineColorFor('wind', {}, true, 'light'), C.GColorYellow);
});

test('lineColorFor: theme omitted defaults to dark (no flip) — backward compatible', () => {
  assert.equal(fs.lineColorFor('precip_prob', {}, false), C.GColorWhite);
});
