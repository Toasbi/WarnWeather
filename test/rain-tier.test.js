const test = require('node:test');
const assert = require('node:assert/strict');
const rainTier = require('../src/pkjs/weather/rain-tier');

// Vectors computed from C rain_tier_permille (rain_tier.c): below_h + slab_top
// at h=1000, integer-truncating division throughout.
test('rainPermille matches the C rain_tier_permille outputs', () => {
  const cases = { 0: 0, 1: 140, 2: 140, 3: 206, 5: 340, 20: 560, 100: 780, 101: 780, 255: 1000 };
  for (const tenths of Object.keys(cases)) {
    assert.equal(rainTier.rainPermille(Number(tenths)), cases[tenths], 'tenths=' + tenths);
  }
});

test('rainPermille clamps non-positive to 0', () => {
  assert.equal(rainTier.rainPermille(0), 0);
  assert.equal(rainTier.rainPermille(-5), 0);
});

test('buildPalette: color platform → 5 tier stops in permille order', () => {
  const p = rainTier.buildPalette('basalt');
  assert.deepEqual(p.from, [0, 140, 340, 560, 780]);
  assert.deepEqual(p.rgb, [0xAAAAAA, 0x55FFFF, 0x00FF00, 0xFFFF00, 0xFF5555]);
});

test('buildPalette: b&w platform → single black stop', () => {
  const p = rainTier.buildPalette('aplite');
  assert.deepEqual(p.from, [0]);
  assert.deepEqual(p.rgb, [0x000000]);
});

test('buildPalette: color + white → single white stop', () => {
  const p = rainTier.buildPalette('basalt', 'white');
  assert.deepEqual(p.from, [0]);
  assert.deepEqual(p.rgb, [0xFFFFFF]);
});

test('buildPalette: color defaults to multicolor when rainBarColor omitted', () => {
  assert.deepEqual(rainTier.buildPalette('basalt').rgb.length, 5);
});

test('buildPalette: b&w ignores white (stays a single black stop)', () => {
  const p = rainTier.buildPalette('aplite', 'white');
  assert.deepEqual(p.rgb, [0x000000]);
});

test('buildPalette: flint is b&w (black stop, not white) — must match C PBL_COLOR', () => {
  // flint is a 1-bit display; sending a white stop made the watch's white
  // outline render an invisible solid-white bar. It must get the black stop.
  assert.deepEqual(rainTier.buildPalette('flint', 'white').rgb, [0x000000]);
  assert.deepEqual(rainTier.buildPalette('flint', 'multicolor').rgb, [0x000000]);
});

test('rgbToGColor8 maps 0xRRGGBB to the GColorFromHEX byte', () => {
  assert.equal(rainTier.rgbToGColor8(0xFFFFFF), 0xFF); // white: a=3 r=3 g=3 b=3
  assert.equal(rainTier.rgbToGColor8(0x000000), 0xC0); // black: opaque alpha only
  assert.equal(rainTier.rgbToGColor8(0xAAAAAA), 0xEA); // LightGray: 11_10_10_10
  assert.equal(rainTier.rgbToGColor8(0x55FFFF), 0xDF); // ElectricBlue: 11_01_11_11
});

test('packPalette emits 3 bytes/stop: int16 LE from + GColor8 color', () => {
  const packed = rainTier.packPalette(rainTier.buildPalette('basalt')); // 5 stops
  assert.equal(packed.length, 5 * 3);
  packed.forEach((b) => assert.ok(b >= 0 && b <= 255, 'byte out of range: ' + b));

  // Decode back and compare to the logical palette.
  const logical = rainTier.buildPalette('basalt');
  for (let i = 0; i < logical.from.length; i += 1) {
    const lo = packed[i * 3];
    const hi = packed[i * 3 + 1];
    const color = packed[i * 3 + 2];
    assert.equal(lo | (hi << 8), logical.from[i], 'from[' + i + ']');
    assert.equal(color, rainTier.rgbToGColor8(logical.rgb[i]), 'color[' + i + ']');
  }
});

test('packPalette handles the single-stop white/b&w palettes', () => {
  assert.deepEqual(rainTier.packPalette(rainTier.buildPalette('basalt', 'white')), [0, 0, 0xFF]);
  assert.deepEqual(rainTier.packPalette(rainTier.buildPalette('aplite')), [0, 0, 0xC0]);
});

test('buildPackedPalette: bar vs radar color modes yield different blobs (independence)', () => {
  const multi = rainTier.buildPackedPalette('basalt', 'multicolor');
  const white = rainTier.buildPackedPalette('basalt', 'white');
  assert.notDeepEqual(multi, white);
  assert.equal(white.length, 3);     // single white stop
  assert.equal(multi.length, 15);    // five tier stops
});
