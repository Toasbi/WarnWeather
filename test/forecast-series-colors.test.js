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
