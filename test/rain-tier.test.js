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
