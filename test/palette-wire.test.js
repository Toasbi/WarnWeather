const test = require('node:test');
const assert = require('node:assert/strict');
const paletteWire = require('../src/pkjs/weather/palette-wire');

test('buildPaletteTuples returns packed bar + radar blobs from settings', function() {
  const tuples = paletteWire.buildPaletteTuples(
    { platform: 'emery' },
    { rainBarColor: 'white', radarColor: 'multicolor' });
  assert.ok(Array.isArray(tuples.BAR_PALETTE_UINT8));
  assert.ok(Array.isArray(tuples.RADAR_PALETTE_UINT8));
  assert.equal(tuples.BAR_PALETTE_UINT8.length, 3);   // 'white' on color → single stop (3 B)
  assert.equal(tuples.RADAR_PALETTE_UINT8.length, 15); // 'multicolor' → five stops (15 B)
});

test('buildPaletteTuples defaults missing colors to multicolor', function() {
  const tuples = paletteWire.buildPaletteTuples({ platform: 'emery' }, {});
  assert.equal(tuples.BAR_PALETTE_UINT8.length, 15);
  assert.equal(tuples.RADAR_PALETTE_UINT8.length, 15);
});

test('buildPaletteTuples falls back to basalt when watchInfo is null', function() {
  const tuples = paletteWire.buildPaletteTuples(null, { rainBarColor: 'multicolor' });
  assert.equal(tuples.BAR_PALETTE_UINT8.length, 15);  // basalt is a color platform
});

test('buildPaletteTuples: bw theme collapses both channels to a single black stop even on a color platform', () => {
  const t = paletteWire.buildPaletteTuples({ platform: 'emery' }, { rainBarColor: 'multicolor', radarColor: 'multicolor', theme: 'bw' });
  assert.equal(t.BAR_PALETTE_UINT8.length, 3, 'one packed stop = 3 bytes');
  assert.equal(t.RADAR_PALETTE_UINT8.length, 3);
});

test('buildPaletteTuples: theme omitted defaults to dark (unchanged behavior)', () => {
  const t = paletteWire.buildPaletteTuples({ platform: 'emery' }, { rainBarColor: 'multicolor' });
  assert.equal(t.BAR_PALETTE_UINT8.length, 15, 'five multicolor stops = 15 bytes, unchanged');
});
