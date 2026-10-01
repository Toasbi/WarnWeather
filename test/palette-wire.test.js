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

// --- Bars from: Top in bit 7 of each blob's byte [1] (draw-from.js markPalette) ----
// Byte [1] is stop 0's from_hi, which every palette starts at 0, so the flag reads as a
// negative stop-0 threshold on the watch. Each chart has its own key and its own blob.
const MULTI = [0, 0, 234, 140, 0, 223, 84, 1, 204, 48, 2, 252, 12, 3, 245];

test('Bars from on Bottom, absent or junk: the blobs the build before it sent', () => {
  [{}, { rainBarFrom: 'bottom', radarBarFrom: 'bottom' }, { rainBarFrom: 'TOP', radarBarFrom: true }]
    .forEach((over) => {
      const color = paletteWire.buildPaletteTuples({ platform: 'basalt' },
        Object.assign({ rainBarColor: 'multicolor', radarColor: 'multicolor' }, over));
      assert.deepEqual(color.BAR_PALETTE_UINT8, MULTI, JSON.stringify(over));
      assert.deepEqual(color.RADAR_PALETTE_UINT8, MULTI, JSON.stringify(over));
      const bw = paletteWire.buildPaletteTuples({ platform: 'diorite' }, over);
      assert.deepEqual(bw.BAR_PALETTE_UINT8, [0, 0, 192]);
      assert.deepEqual(bw.RADAR_PALETTE_UINT8, [0, 0, 192]);
    });
});

test('Bars from: Top marks byte [1] of its own chart\'s blob only, on every palette shape', () => {
  const cases = [
    ['emery multicolor', { platform: 'emery' }, { rainBarColor: 'multicolor', radarColor: 'multicolor' }],
    ['emery Solid', { platform: 'emery' }, { rainBarColor: 'white', radarColor: 'white' }],
    ['emery light Solid', { platform: 'emery' }, { rainBarColor: 'white', radarColor: 'white', theme: 'light' }],
    ['basalt bw theme', { platform: 'basalt' }, { theme: 'bw' }],
    ['diorite', { platform: 'diorite' }, {}],
    ['flint bw-light', { platform: 'flint' }, { theme: 'bw-light' }]
  ];
  cases.forEach(([name, watch, settings]) => {
    const base = paletteWire.buildPaletteTuples(watch, settings);
    const flag = (blob) => { const out = blob.slice(); out[1] |= 0x80; return out; };
    const rain = paletteWire.buildPaletteTuples(watch, Object.assign({ rainBarFrom: 'top' }, settings));
    assert.deepEqual(rain.BAR_PALETTE_UINT8, flag(base.BAR_PALETTE_UINT8), name + ': forecast bars');
    assert.deepEqual(rain.RADAR_PALETTE_UINT8, base.RADAR_PALETTE_UINT8, name + ': the radar untouched');
    const radar = paletteWire.buildPaletteTuples(watch, Object.assign({ radarBarFrom: 'top' }, settings));
    assert.deepEqual(radar.BAR_PALETTE_UINT8, base.BAR_PALETTE_UINT8, name + ': the forecast untouched');
    assert.deepEqual(radar.RADAR_PALETTE_UINT8, flag(base.RADAR_PALETTE_UINT8), name + ': radar bars');
    assert.equal(base.BAR_PALETTE_UINT8[1], 0, name + ': premise, stop 0 starts at 0');
  });
  // An unknown watch reads basalt: it hangs too.
  assert.equal(paletteWire.buildPaletteTuples(null, { rainBarFrom: 'top' }).BAR_PALETTE_UINT8[1], 0x80);
});

test('Bars from: never on aplite, which ignores incoming palettes anyway', () => {
  const plain = paletteWire.buildPaletteTuples({ platform: 'aplite' }, {});
  const top = paletteWire.buildPaletteTuples({ platform: 'aplite' }, { rainBarFrom: 'top', radarBarFrom: 'top' });
  assert.deepEqual(top, plain);
});
