// test/forecast-series-colors.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('../src/pkjs/line-style.js');
const C = require('../src/pkjs/pebble-colors.js');

test('line-style exposes the platform-aware line/fill color maps', () => {
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

// Every hued line has its own light arm, tuned on hardware in the light (alpha) theme —
// they are not a formula applied to the dark colour, so each is pinned literally.
// pressure is the one metric with NO light arm: Orange reads on white as-is.
test('LINE_COLORS carries a hardware-tuned light variant for every metric but pressure', () => {
  assert.equal(fs.LINE_COLORS.precip_prob.light, C.GColorDukeBlue);
  assert.equal(fs.LINE_COLORS.wind.light, C.GColorChromeYellow);
  assert.equal(fs.LINE_COLORS.uv.light, C.GColorImperialPurple);
  assert.equal(fs.LINE_COLORS.feels.light, C.GColorBlack);
  assert.ok(!Object.prototype.hasOwnProperty.call(fs.LINE_COLORS.pressure, 'light'),
    'pressure keeps Orange in both polarities');
});

test('FILL_COLORS.precip_prob.light is one palette step darker than the pre-fix Celeste tint', () => {
  // Celeste (0xAAFFFF) -> ElectricBlue (0x55FFFF): R channel steps down one notch,
  // matching the line's darkening above. (0x55FFFF has no "Cyan" name in
  // pebble-colors.js — real GColorCyan is 0x00FFFF — ElectricBlue is the correct name
  // for this hex.)
  assert.equal(fs.FILL_COLORS.precip_prob.light, C.GColorElectricBlue);
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

test('fillColorFor: light theme brightens every metric fill for contrast against white', () => {
  // Tuned on hardware, metric by metric — a brighter tint of the hue, but not a uniform
  // step off the dark colour, so each is pinned literally.
  assert.equal(fs.fillColorFor('precip_prob', true, 'light'), C.GColorElectricBlue);
  assert.equal(fs.fillColorFor('wind', true, 'light'), C.GColorYellow);
  assert.equal(fs.fillColorFor('uv', true, 'light'), C.GColorShockingPink);
  assert.equal(fs.fillColorFor('gust', true, 'light'), C.GColorLightGray);
  assert.equal(fs.fillColorFor('pressure', true, 'light'), C.GColorRajah);
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
  assert.equal(fs.fillColorFor('precip_prob', true, 'bw-light'), C.GColorElectricBlue);
  assert.equal(fs.fillColorFor('wind', true, 'bw-light'), C.GColorYellow);
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

test('lineColorFor: a hued colour with no light arm passes through untouched in light theme', () => {
  // pressure is the only one left without a light variant — the arm that proves an
  // absent `light` key is not silently substituted for.
  assert.equal(fs.lineColorFor('pressure', {}, true, 'light'), C.GColorOrange);
});

test('lineColorFor: each metric with a light arm uses it when effectively color', () => {
  assert.equal(fs.lineColorFor('precip_prob', {}, true, 'light'), C.GColorDukeBlue);
  assert.equal(fs.lineColorFor('wind', {}, true, 'light'), C.GColorChromeYellow);
  assert.equal(fs.lineColorFor('uv', {}, true, 'light'), C.GColorImperialPurple);
});

test('lineColorFor: precip line keeps the dark-theme PictonBlue in the dark theme', () => {
  assert.equal(fs.lineColorFor('precip_prob', {}, true, 'dark'), C.GColorPictonBlue);
  assert.equal(fs.lineColorFor('precip_prob', {}, true), C.GColorPictonBlue);
});

test('lineColorFor: theme omitted defaults to dark (no flip) — backward compatible', () => {
  assert.equal(fs.lineColorFor('precip_prob', {}, false), C.GColorWhite);
});
