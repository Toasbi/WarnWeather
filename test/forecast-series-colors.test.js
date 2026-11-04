// test/forecast-series-colors.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('../src/pkjs/line-style.js');
const C = require('../src/pkjs/pebble-colors.js');

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

test('fillColorFor: light theme brightens every metric fill for contrast against white', () => {
  // Tuned on hardware, metric by metric — a brighter tint of the hue, but not a uniform
  // step off the dark colour, so each is pinned literally.
  assert.equal(fs.fillColorFor('precip_prob', true, 'light'), C.GColorElectricBlue);
  assert.equal(fs.fillColorFor('wind', true, 'light'), C.GColorYellow);
  assert.equal(fs.fillColorFor('uv', true, 'light'), C.GColorShockingPink);
  assert.equal(fs.fillColorFor('gust', true, 'light'), C.GColorLightGray);
  assert.equal(fs.fillColorFor('pressure', true, 'light'), C.GColorRajah);
});

test('fillColorFor: B&W fills ignore theme (always LightGray, even in "light")', () => {
  assert.equal(fs.fillColorFor('precip_prob', false, 'light'), C.GColorLightGray);
  assert.equal(fs.fillColorFor('wind', false, 'light'), C.GColorLightGray);
});

test('fillColorFor: bw-light behaves like light for the brighter tint when effectively color', () => {
  assert.equal(fs.fillColorFor('precip_prob', true, 'bw-light'), C.GColorElectricBlue);
  assert.equal(fs.fillColorFor('wind', true, 'bw-light'), C.GColorYellow);
});

test('lineColorFor: bw-light theme on color hardware routes through the B&W arm, flipped to black (light polarity)', () => {
  assert.equal(fs.lineColorFor('precip_prob', {}, false, 'bw-light'), C.GColorBlack);
});

test('lineColorFor: light theme flips a resolved white line to black', () => {
  assert.equal(fs.lineColorFor('precip_prob', {}, false, 'light'), C.GColorBlack);
  assert.equal(fs.lineColorFor('gust', { rainBarColor: 'multicolor' }, true, 'light'), C.GColorBlack);
});

test('lineColorFor: a hued colour with no light arm passes through untouched in light theme', () => {
  // pressure is the only one left without a light variant — the arm that proves an
  // absent `light` key is not silently substituted for.
  assert.equal(fs.lineColorFor('pressure', {}, true, 'light'), C.GColorOrange);
});

test('lineColorFor: each metric with a light arm uses it when effectively color', () => {
  assert.equal(fs.lineColorFor('precip_prob', {}, true, 'light'), C.GColorDukeBlue);
  assert.equal(fs.lineColorFor('wind', {}, true, 'light'), C.GColorChromeYellow);
  assert.equal(fs.lineColorFor('uv', {}, true, 'light'), C.GColorPurple);
});

test('lineColorFor: precip line keeps the dark-theme PictonBlue in the dark theme', () => {
  assert.equal(fs.lineColorFor('precip_prob', {}, true, 'dark'), C.GColorPictonBlue);
  assert.equal(fs.lineColorFor('precip_prob', {}, true), C.GColorPictonBlue);
});
