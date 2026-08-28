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

test('an absent bar colour resolves to the polarity default, not always multicolor', function() {
  // Defensive: seedDefaults writes both keys on first boot (they carry static schema
  // defaults) and the light theme is only reachable through a save that writes them
  // concretely, so this path is unreachable today. It is pinned so the fallback stays
  // correct if the seeding ever changes — under the old hardcoded `|| 'multicolor'`
  // the light case below packed five washed-out tiers onto a white background.
  const dark = paletteWire.buildPaletteTuples({ platform: 'emery' }, { theme: 'dark' });
  assert.equal(dark.BAR_PALETTE_UINT8.length, 15, 'dark keeps the five multicolor stops');
  assert.equal(dark.RADAR_PALETTE_UINT8.length, 15);

  const light = paletteWire.buildPaletteTuples({ platform: 'emery' }, { theme: 'light' });
  assert.equal(light.BAR_PALETTE_UINT8.length, 3, 'light collapses to the single Solid stop');
  assert.equal(light.RADAR_PALETTE_UINT8.length, 3);

  // And an explicit pick still wins over the fallback in both directions.
  const picked = paletteWire.buildPaletteTuples(
    { platform: 'emery' }, { theme: 'light', rainBarColor: 'multicolor' });
  assert.equal(picked.BAR_PALETTE_UINT8.length, 15,
    'a light install that chose Multicolor keeps it');
});
