// test/forecast-series-colors.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('../src/pkjs/forecast-series.js');
const C = require('../src/pkjs/pebble-colors.js');

test('forecast-series exposes the watch line/fill color maps', () => {
  assert.equal(fs.LINE_COLORS.precip_prob, C.GColorPictonBlue);
  assert.equal(fs.LINE_COLORS.wind, C.GColorYellow);
  assert.equal(fs.LINE_COLORS.uv, C.GColorMagenta);
  assert.equal(fs.FILL_COLORS.precip_prob, C.GColorCobaltBlue);
});

test('forecast-series exposes lineColorFor with the gust rule', () => {
  assert.equal(fs.lineColorFor('gust', { rainBarColor: 'white' }), C.GColorLightGray);
  assert.equal(fs.lineColorFor('gust', { rainBarColor: 'multicolor' }), C.GColorWhite);
  assert.equal(fs.lineColorFor('wind', {}), C.GColorYellow);
});
