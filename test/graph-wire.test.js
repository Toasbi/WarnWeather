// test/graph-wire.test.js — the graph's three Clay tuples (src/pkjs/weather/graph-wire.js):
// the forecast's and the radar's bar palettes, each with its Bars from flag, and the
// sixteen bytes of line styling: colours, fill and night flags, the style bytes and their
// Draw from and float bits. The readings they encode are pinned in line-style.test.js and
// draw-from.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');

// clay-payload.js and fixture-weather.js reach modules that read localStorage: install
// the mock BEFORE the watch modules load (AGENTS.md).
global.localStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {}
};

const graphWire = require('../src/pkjs/weather/graph-wire.js');
const lineStyle = require('../src/pkjs/line-style.js');
const drawFrom = require('../src/pkjs/draw-from.js');
const platform = require('../src/pkjs/config-ui/lib/platform.js');
const rainTier = require('../src/pkjs/weather/rain-tier.js');
const COLORS = require('../src/pkjs/pebble-colors.js');
const { resolveInk } = require('../src/pkjs/resolve-ink.js');

const emery = { platform: 'emery' };
// The graph colours one watch resolves to, the answer buildLineStyleBytes packs.
const resolve = (settings, watchInfo) => lineStyle.resolveGraphColors(settings, platform.computeEnv(watchInfo));

test('buildPaletteTuples returns packed bar + radar blobs from settings', function() {
  const tuples = graphWire.buildPaletteTuples(
    { rainBarColor: 'white', radarColor: 'multicolor' }, { platform: 'emery' });
  assert.ok(Array.isArray(tuples.BAR_PALETTE_UINT8));
  assert.ok(Array.isArray(tuples.RADAR_PALETTE_UINT8));
  assert.equal(tuples.BAR_PALETTE_UINT8.length, 3);   // 'white' on color → single stop (3 B)
  assert.equal(tuples.RADAR_PALETTE_UINT8.length, 15); // 'multicolor' → five stops (15 B)
});

test('buildPaletteTuples defaults missing colors to multicolor', function() {
  const tuples = graphWire.buildPaletteTuples({}, { platform: 'emery' });
  assert.equal(tuples.BAR_PALETTE_UINT8.length, 15);
  assert.equal(tuples.RADAR_PALETTE_UINT8.length, 15);
});

test('buildPaletteTuples falls back to basalt when watchInfo is null', function() {
  const tuples = graphWire.buildPaletteTuples({ rainBarColor: 'multicolor' }, null);
  assert.equal(tuples.BAR_PALETTE_UINT8.length, 15);  // basalt is a color platform
});

test('buildPaletteTuples: bw theme collapses both channels to a single black stop even on a color platform', () => {
  const t = graphWire.buildPaletteTuples({ rainBarColor: 'multicolor', radarColor: 'multicolor', theme: 'bw' }, { platform: 'emery' });
  assert.equal(t.BAR_PALETTE_UINT8.length, 3, 'one packed stop = 3 bytes');
  assert.equal(t.RADAR_PALETTE_UINT8.length, 3);
});

test('buildPaletteTuples: theme omitted defaults to dark (unchanged behavior)', () => {
  const t = graphWire.buildPaletteTuples({ rainBarColor: 'multicolor' }, { platform: 'emery' });
  assert.equal(t.BAR_PALETTE_UINT8.length, 15, 'five multicolor stops = 15 bytes, unchanged');
});

test('an absent bar colour resolves to the polarity default, not always multicolor', function() {
  // Defensive: seedDefaults writes both keys on first boot (they carry static schema
  // defaults) and the light theme is only reachable through a save that writes them
  // concretely, so this path is unreachable today. It is pinned so the fallback stays
  // correct if the seeding ever changes — under the old hardcoded `|| 'multicolor'`
  // the light case below packed five washed-out tiers onto a white background.
  const dark = graphWire.buildPaletteTuples({ theme: 'dark' }, { platform: 'emery' });
  assert.equal(dark.BAR_PALETTE_UINT8.length, 15, 'dark keeps the five multicolor stops');
  assert.equal(dark.RADAR_PALETTE_UINT8.length, 15);

  const light = graphWire.buildPaletteTuples({ theme: 'light' }, { platform: 'emery' });
  assert.equal(light.BAR_PALETTE_UINT8.length, 3, 'light collapses to the single Solid stop');
  assert.equal(light.RADAR_PALETTE_UINT8.length, 3);

  // And an explicit pick still wins over the fallback in both directions.
  const picked = graphWire.buildPaletteTuples({ theme: 'light', rainBarColor: 'multicolor' }, { platform: 'emery' });
  assert.equal(picked.BAR_PALETTE_UINT8.length, 15,
    'a light install that chose Multicolor keeps it');
});

test('the Draw from bits: bits 5 and 6 of a style byte, bit 7 of a palette\'s byte [1]', () => {
  assert.equal(graphWire.LINE_BIT, 0x20);
  assert.equal(graphWire.FLOAT_BIT, 0x40);
  assert.equal(graphWire.PALETTE_BIT, 0x80);
  // The byte carries draw-from.js lineEdge: Top in bit 5, a float in bit 6.
  [0x04, 0x0C, 0x01, 0x02].forEach((b) => {
    assert.equal(graphWire.styleByte(b, drawFrom.BOTTOM), b);
    assert.equal(graphWire.styleByte(b, null), b, 'a line not drawn, a stripe, aplite');
    assert.equal(graphWire.styleByte(b, drawFrom.TOP), b | 0x20);
    assert.equal(graphWire.styleByte(b, drawFrom.TOP) & 0x1F, b, 'kind and width untouched');
    assert.equal(graphWire.styleByte(b, drawFrom.FLOAT), b | 0x40);
    assert.equal(graphWire.styleByte(b, drawFrom.FLOAT) & 0x1F, b, 'kind and width untouched');
  });
  const blob = [0, 0, 234, 140, 0, 223];
  assert.equal(graphWire.markPalette(blob, false), blob, 'Bottom: the blob itself');
  const marked = graphWire.markPalette(blob, true);
  assert.deepEqual(marked, [0, 0x80, 234, 140, 0, 223]);
  assert.deepEqual(blob, [0, 0, 234, 140, 0, 223], 'the input is not mutated');
  assert.deepEqual(graphWire.markPalette([0, 0, 192], true), [0, 0x80, 192], 'a single stop');
  assert.deepEqual(graphWire.markPalette([], true), [], 'nothing to mark');
  // The watch reads the flag as a negative stop-0 threshold (int16 LE).
  const from = (b) => { const v = b[0] | (b[1] << 8); return v >= 0x8000 ? v - 0x10000 : v; };
  assert.ok(from(marked) < 0);
  assert.equal(from(blob), 0);
});

// --- Bars from: Top in bit 7 of each blob's byte [1] (markPalette) -----------------
// Byte [1] is stop 0's from_hi, which every palette starts at 0, so the flag reads as a
// negative stop-0 threshold on the watch. Each chart has its own key and its own blob.
const MULTI = [0, 0, 234, 140, 0, 223, 84, 1, 204, 48, 2, 252, 12, 3, 245];

test('Bars from on Bottom, absent or junk: the blobs the build before it sent', () => {
  [{}, { rainBarFrom: 'bottom', radarBarFrom: 'bottom' }, { rainBarFrom: 'TOP', radarBarFrom: true }]
    .forEach((over) => {
      const color = graphWire.buildPaletteTuples(
        Object.assign({ rainBarColor: 'multicolor', radarColor: 'multicolor' }, over), { platform: 'basalt' });
      assert.deepEqual(color.BAR_PALETTE_UINT8, MULTI, JSON.stringify(over));
      assert.deepEqual(color.RADAR_PALETTE_UINT8, MULTI, JSON.stringify(over));
      const bw = graphWire.buildPaletteTuples(over, { platform: 'diorite' });
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
    const base = graphWire.buildPaletteTuples(settings, watch);
    const flag = (blob) => { const out = blob.slice(); out[1] |= 0x80; return out; };
    const rain = graphWire.buildPaletteTuples(Object.assign({ rainBarFrom: 'top' }, settings), watch);
    assert.deepEqual(rain.BAR_PALETTE_UINT8, flag(base.BAR_PALETTE_UINT8), name + ': forecast bars');
    assert.deepEqual(rain.RADAR_PALETTE_UINT8, base.RADAR_PALETTE_UINT8, name + ': the radar untouched');
    const radar = graphWire.buildPaletteTuples(Object.assign({ radarBarFrom: 'top' }, settings), watch);
    assert.deepEqual(radar.BAR_PALETTE_UINT8, base.BAR_PALETTE_UINT8, name + ': the forecast untouched');
    assert.deepEqual(radar.RADAR_PALETTE_UINT8, flag(base.RADAR_PALETTE_UINT8), name + ': radar bars');
    assert.equal(base.BAR_PALETTE_UINT8[1], 0, name + ': premise, stop 0 starts at 0');
  });
  // An unknown watch reads basalt: it hangs too.
  assert.equal(graphWire.buildPaletteTuples({ rainBarFrom: 'top' }, null).BAR_PALETTE_UINT8[1], 0x80);
});

test('Bars from: never on aplite, which ignores incoming palettes anyway', () => {
  const plain = graphWire.buildPaletteTuples({}, { platform: 'aplite' });
  const top = graphWire.buildPaletteTuples({ rainBarFrom: 'top', radarBarFrom: 'top' }, { platform: 'aplite' });
  assert.deepEqual(top, plain);
});

// --- The line styling: CLAY_LINE_STYLE_UINT8, sixteen bytes ----------------------------

test('packs sixteen bytes: five line colours, a line flag byte, five night colours, a night flag byte, four style bytes', () => {
  const bytes = graphWire.buildLineStyleBytes(
    { secondaryLine: 'wind', thirdLine: 'gust', fifthLine: 'cloud', secondaryLineFill: false, theme: 'dark' }, emery);
  assert.equal(bytes.length, 16);
  assert.equal(bytes[15], 0x02, 'the fourth metric debuts as x marks');
  [0, 1, 2, 4, 5, 6, 7, 8, 10, 14].forEach(
    (i) => assert.ok(bytes[i] >= 0xC0 && bytes[i] <= 0xFF, `byte ${i} (${bytes[i]}) is not a GColor8`));
  assert.equal(bytes[3], 0, 'fill off');
  assert.equal(bytes[9], 0, 'night fill still on its built-in tint');
});

// Bytes 4..9 are the watch's NIGHT_COLORS persist blob verbatim (persist.h's
// NIGHT_COLOR_BYTES = 6), which is the whole reason the night-fill bit lives in byte
// [9] instead of byte [3]: app_message.c stores the tail straight through, so the two
// ends cannot pick different bits or offsets for it. The bytes appended since ([10]
// third-metric colour, [11..13] the LINE_STYLES blob, also stored straight through)
// sit BEHIND the night block, so its offsets never moved.
test('the night block is a contiguous six-byte block at [4..9], flag included', () => {
  const bytes = graphWire.buildLineStyleBytes({
    secondaryLine: 'wind', thirdLine: 'off', secondaryLineFill: true, theme: 'dark',
    gcWindNightDark: '#550055'
  }, emery);
  assert.equal(bytes.length, 16, 'night block [4..9] + ext block [10..13] + fifth block [14..15]');
  assert.equal(bytes[9] & graphWire.FLAG_NIGHT_FILL_EXPLICIT, graphWire.FLAG_NIGHT_FILL_EXPLICIT);
  assert.equal(bytes[3] & 0x01, 1, 'the line flag byte still carries only the fill bit');
  assert.equal(bytes[3], 0x01, 'and nothing else — the night flag left byte [3] entirely');
});

// Bytes [11..13] are the watch's LINE_STYLES persist blob verbatim (persist.h's
// LINE_STYLE_STYLE_BYTES = 3): kind | (stroke_width << 2), kind bits shared with
// chart.h's ChartLineStyle (0 solid, 1 dots, 2 x).
test('the style bytes pack kind and width, defaults reproducing the pre-feature look', () => {
  const bytes = graphWire.buildLineStyleBytes(
    { secondaryLine: 'wind', thirdLine: 'gust', secondaryLineFill: false, theme: 'dark' }, emery);
  assert.equal(bytes[11], 0 | (1 << 2), 'main line: solid, 1 px');
  assert.equal(bytes[12], 1, 'second line: dots');
  assert.equal(bytes[13], 2, 'third-metric line: x');
});

test('a stored style pick moves its byte; an unknown value falls back to the default', () => {
  const bytes = graphWire.buildLineStyleBytes({
    secondaryLine: 'wind', thirdLine: 'gust', theme: 'dark',
    secondaryLineStyle: 'bold', thirdLineStyle: 'x', fourthLineStyle: 'nonsense'
  }, emery);
  assert.equal(bytes[11], 0 | (3 << 2), 'main line: solid, 3 px');
  assert.equal(bytes[12], 2, 'second line: x');
  assert.equal(bytes[13], 2, 'unknown value → the line\'s built-in (x)');
});

test('byte [10] is the third-metric line colour, resolved like the others', () => {
  const settings = { secondaryLine: 'wind', thirdLine: 'gust', fourthLine: 'uv', theme: 'dark' };
  const resolved = resolve(settings, emery);
  const bytes = graphWire.buildLineStyleBytes(settings, emery);
  assert.equal(bytes[10], rainTier.rgbToGColor8(resolved.fourth));
});

test('the fill flag follows secondaryLineFill', () => {
  const on = graphWire.buildLineStyleBytes(
    { secondaryLine: 'wind', thirdLine: 'off', secondaryLineFill: true, theme: 'dark' }, emery);
  assert.equal(on[3] & 0x01, 1);
});

test('feels-like never fills, whatever the setting says', () => {
  const bytes = graphWire.buildLineStyleBytes(
    { secondaryLine: 'feels', thirdLine: 'off', secondaryLineFill: true, theme: 'dark' }, emery);
  assert.equal(bytes[3] & 0x01, 0);
});

test('the packed colour equals the quantized resolved colour', () => {
  const settings = { secondaryLine: 'wind', thirdLine: 'gust', secondaryLineFill: false, theme: 'dark' };
  const resolved = resolve(settings, emery);
  const bytes = graphWire.buildLineStyleBytes(settings, emery);
  assert.equal(bytes[0], rainTier.rgbToGColor8(resolved.secondary));
  assert.equal(bytes[2], rainTier.rgbToGColor8(resolved.third));
});

test('an off-grid pick reaches the wire as the colour the watch would paint anyway', () => {
  const base = { secondaryLine: 'wind', thirdLine: 'off', theme: 'dark' };
  assert.deepEqual(
    graphWire.buildLineStyleBytes(Object.assign({ gcWindLineDark: '#123456' }, base), emery),
    graphWire.buildLineStyleBytes(Object.assign({ gcWindLineDark: '#000055' }, base), emery));
});

test('the full-height night hatch and boundary default to DarkGray in both polarities', () => {
  const darkGray = rainTier.rgbToGColor8(COLORS.GColorDarkGray);
  ['dark', 'light'].forEach((theme) => {
    const bytes = graphWire.buildLineStyleBytes({ secondaryLine: 'wind', thirdLine: 'off', theme }, emery);
    assert.equal(bytes[4], darkGray, `${theme} hatch`);
    assert.equal(bytes[5], darkGray, `${theme} boundary`);
  });
});

test('the seeded default sends the metric triple on bytes 6..8', () => {
  const bytes = graphWire.buildLineStyleBytes(
    { secondaryLine: 'uv', thirdLine: 'off', secondaryLineFill: true, theme: 'dark' }, emery);
  const uv = lineStyle.nightAreaColorsFor('uv', null);
  assert.equal(bytes[6], rainTier.rgbToGColor8(uv.base));
  assert.equal(bytes[7], rainTier.rgbToGColor8(uv.hatch));
  assert.equal(bytes[8], rainTier.rgbToGColor8(uv.boundary));
});

// --- The user's picks --------------------------------------------------------

test('a pick replaces the built-in line, fill and dot colours', () => {
  const bytes = graphWire.buildLineStyleBytes({
    secondaryLine: 'wind', thirdLine: 'gust', secondaryLineFill: true, theme: 'dark',
    gcWindLineDark: '#FFAA00', gcWindFillDark: '#AA0000', gcGustLineDark: '#00FFFF'
  }, emery);
  assert.equal(bytes[0], rainTier.rgbToGColor8(0xFFAA00));
  assert.equal(bytes[1], rainTier.rgbToGColor8(0xAA0000));
  assert.equal(bytes[2], rainTier.rgbToGColor8(0x00FFFF));
});

// Each metric owns its OWN keys, so recolouring the wind line cannot reach the graph
// while a different metric is selected — the whole point of the per-metric split.
test('a pick is keyed by the metric, not by the line slot it happens to occupy', () => {
  const base = { secondaryLine: 'uv', thirdLine: 'off', theme: 'dark' };
  assert.deepEqual(
    graphWire.buildLineStyleBytes(Object.assign({ gcWindLineDark: '#FFAA00' }, base), emery),
    graphWire.buildLineStyleBytes(base, emery), 'the wind pick is dormant while uv is the main line');
  assert.equal(
    graphWire.buildLineStyleBytes(
      Object.assign({ gcUvLineDark: '#FFAA00' }, base), emery)[0],
    rainTier.rgbToGColor8(0xFFAA00), 'the uv pick is the one that paints');
});

test('a pick stored as an int reads the same as the hex string the page writes', () => {
  const base = { secondaryLine: 'wind', thirdLine: 'off', theme: 'dark' };
  const asInt = graphWire.buildLineStyleBytes(Object.assign({ gcWindLineDark: 0xFFAA00 }, base), emery);
  const asHex = graphWire.buildLineStyleBytes(Object.assign({ gcWindLineDark: '#FFAA00' }, base), emery);
  assert.deepEqual(asInt, asHex);
});

// THE appearance contract. seedDefaults writes every one of the 42 keys into a fresh
// blob, so "a blob carrying all the defaults" is what a real install looks like — and it
// has to pack exactly what a blob with no graph keys at all (a 1.14.1 install) packs.
test('a blob seeded with every default packs the same ten bytes as a blob with no graph keys', () => {
  const keys = lineStyle.graphColorKeys();
  ['dark', 'light'].forEach((theme) => {
    ['precip_prob', 'cloud', 'wind', 'uv', 'gust', 'pressure', 'feels'].forEach((metric) => {
      const base = { secondaryLine: metric, thirdLine: 'uv', secondaryLineFill: true, theme };
      const seeded = Object.assign({}, base);
      keys.forEach((key) => {
        const m = /^gc([A-Z][a-z]+)([A-Z][a-z]+)(Dark|Light)$/.exec(key);
        const scope = { Precip: 'precip_prob', Cloud: 'cloud', Wind: 'wind', Uv: 'uv', Gust: 'gust',
          Pressure: 'pressure', Feels: 'feels', Dew: 'dew', Night: 'night' }[m[1]];
        seeded[key] = lineStyle.graphColorDefault(scope, m[2], m[3], base);
      });
      assert.deepEqual(graphWire.buildLineStyleBytes(seeded, emery),
        graphWire.buildLineStyleBytes(base, emery), `${metric} / ${theme}`);
    });
  });
});

test('an absent or unparseable value falls back to the built-in colour', () => {
  const base = { secondaryLine: 'wind', thirdLine: 'gust', secondaryLineFill: true, theme: 'dark' };
  const builtin = graphWire.buildLineStyleBytes(base, emery);
  ['', null, undefined, 'not a colour'].forEach((junk) => {
    const blanked = Object.assign({}, base, {
      gcWindLineDark: junk, gcWindFillDark: junk, gcGustLineDark: junk,
      gcNightHatchDark: junk, gcNightBoundaryDark: junk, gcWindNightDark: junk
    });
    assert.deepEqual(graphWire.buildLineStyleBytes(blanked, emery), builtin, String(junk));
  });
});

test('picks are per polarity: the Light set is ignored on a dark theme and vice versa', () => {
  const base = { secondaryLine: 'wind', thirdLine: 'off', theme: 'dark' };
  assert.deepEqual(
    graphWire.buildLineStyleBytes(Object.assign({ gcWindLineLight: '#FF0000' }, base), emery),
    graphWire.buildLineStyleBytes(base, emery));
  const light = graphWire.buildLineStyleBytes(
    { secondaryLine: 'wind', thirdLine: 'off', theme: 'light', gcWindLineLight: '#FF0000' }, emery);
  assert.equal(light[0], rainTier.rgbToGColor8(0xFF0000));
});

test('aplite ignores the line picks and folds a light theme back to dark polarity', () => {
  // aplite has no colour display AND no light polarity. The fold is the load-bearing
  // half: resolving off settings.theme instead would send black line colours to a black
  // background, and would read the Light night picks a light install can never paint.
  const settings = {
    secondaryLine: 'wind', thirdLine: 'off', secondaryLineFill: true, theme: 'light',
    gcWindLineDark: '#FFAA00', gcWindLineLight: '#FF0000',
    gcNightHatchLight: '#FF0000', gcWindNightLight: '#FF0000'
  };
  const bytes = graphWire.buildLineStyleBytes(settings, { platform: 'aplite' });
  assert.equal(bytes[0], rainTier.rgbToGColor8(COLORS.GColorWhite),
    'the main line takes the B&W arm, not the Dark pick');
  // Every Light pick was folded away, so the night tail is what the Dark polarity says —
  // here all built-in, since only Light night picks were set.
  assert.deepEqual(bytes.slice(4), graphWire.buildLineStyleBytes(
    { secondaryLine: 'wind', thirdLine: 'off', secondaryLineFill: true, theme: 'dark' },
    { platform: 'aplite' }).slice(4));
  assert.equal(bytes[9] & graphWire.FLAG_NIGHT_FILL_EXPLICIT, 0);
});

test('the night picks reach bytes 4..8', () => {
  const bytes = graphWire.buildLineStyleBytes({
    secondaryLine: 'wind', thirdLine: 'off', secondaryLineFill: true, theme: 'dark',
    gcNightHatchDark: '#00AA00', gcNightBoundaryDark: '#FFFF00', gcWindNightDark: '#550055'
  }, emery);
  const derived = lineStyle.nightAreaColorsFor('wind', 0x550055);
  assert.equal(bytes[4], rainTier.rgbToGColor8(0x00AA00));
  assert.equal(bytes[5], rainTier.rgbToGColor8(0xFFFF00));
  assert.equal(bytes[6], rainTier.rgbToGColor8(derived.base));
  assert.equal(bytes[7], rainTier.rgbToGColor8(derived.hatch));
  assert.equal(bytes[8], rainTier.rgbToGColor8(derived.boundary));
});

// No watch reads the flag any more (both polarities re-shade unconditionally), but it is
// still the wire's answer to "did the user pick this?", and telemetry reports the same
// answer — so it must stay clear while the tint sits on its built-in, including when that
// built-in is STORED, which is what every seeded install looks like. Each polarity has its
// OWN built-in base now, so the seeded value differs between the two arms.
test('the night-fill flag is set only when the tint differs from the built-in, in either polarity', () => {
  const flag = graphWire.FLAG_NIGHT_FILL_EXPLICIT;
  const dark = { secondaryLine: 'wind', thirdLine: 'off', secondaryLineFill: true, theme: 'dark' };
  const light = Object.assign({}, dark, { theme: 'light' });
  const darkBase = lineStyle.nightAreaColorsFor('wind', null, 'dark').base;
  const lightBase = lineStyle.nightAreaColorsFor('wind', null, 'light').base;
  assert.notEqual(darkBase, lightBase, 'the two polarities are tuned apart — else this proves nothing');
  assert.equal(graphWire.buildLineStyleBytes(dark, emery)[9] & flag, 0, 'dark, key absent');
  assert.equal(graphWire.buildLineStyleBytes(light, emery)[9] & flag, 0, 'light, key absent');
  assert.equal(
    graphWire.buildLineStyleBytes(Object.assign({ gcWindNightDark: darkBase }, dark), emery)[9] & flag,
    0, 'dark, the built-in stored explicitly');
  assert.equal(
    graphWire.buildLineStyleBytes(Object.assign({ gcWindNightLight: lightBase }, light), emery)[9] & flag,
    0, 'light, the built-in stored explicitly');
  assert.equal(
    graphWire.buildLineStyleBytes(Object.assign({ gcWindNightDark: '#550055' }, dark), emery)[9] & flag,
    flag, 'dark pick');
  assert.equal(
    graphWire.buildLineStyleBytes(Object.assign({ gcWindNightLight: '#550055' }, light), emery)[9] & flag,
    flag, 'light pick');
});

// --- The fill -> night-tint cascade on the wire ------------------------------------
// The rule (an unclaimed night tint is carried from the fill at resolve time, and a carry
// is no pick) and why it is resolved rather than written: line-style.test.js, beside
// graphNightTint. Here: the bytes it lands on.

test('an untouched night tint cascades from the fill and claims no explicit pick', () => {
  const flag = graphWire.FLAG_NIGHT_FILL_EXPLICIT;
  const pick = 0x00AA55;
  const bytes = graphWire.buildLineStyleBytes({
    secondaryLine: 'wind', thirdLine: 'off', secondaryLineFill: true, theme: 'dark',
    gcWindFillDark: '#00AA55'
  }, emery);
  const derived = lineStyle.nightAreaColorsFor('wind', pick);
  assert.equal(bytes[1], rainTier.rgbToGColor8(pick), 'the day fill is the pick');
  assert.equal(bytes[6], rainTier.rgbToGColor8(derived.base),
    'and the night band re-shades in that same colour instead of the built-in triple');
  assert.equal(bytes[7], rainTier.rgbToGColor8(derived.hatch));
  assert.equal(bytes[8], rainTier.rgbToGColor8(derived.boundary));
  assert.equal(bytes[9] & flag, 0,
    'a carried tint is not a night choice — the light polarity keeps skipping the re-shade');
});

// Nothing latches: the tint key is never written, so every later fill pick is carried by
// the same derivation. (Under the page-side write this was the fragile part — the carry
// only happened on the onChange, so any path that set a fill without firing it stranded
// the tint on the previous colour.)
test('the cascade tracks a second and a third fill pick, on both polarities', () => {
  const flag = graphWire.FLAG_NIGHT_FILL_EXPLICIT;
  const base = { secondaryLine: 'wind', thirdLine: 'off', secondaryLineFill: true };
  ['#00AA55', '#FF0000', '#0000AA'].forEach((pick) => {
    [['dark', 'gcWindFillDark'], ['light', 'gcWindFillLight']].forEach(([theme, key]) => {
      const blob = Object.assign({ theme }, base);
      blob[key] = pick;
      const bytes = graphWire.buildLineStyleBytes(blob, emery);
      const derived = lineStyle.nightAreaColorsFor('wind', parseInt(pick.slice(1), 16));
      assert.equal(bytes[6], rainTier.rgbToGColor8(derived.base), `${theme} ${pick} base`);
      assert.equal(bytes[9] & flag, 0, `${theme} ${pick} claims no pick`);
    });
  });
});

test('a night tint deliberately picked EQUAL to its fill is a real pick, not a hand-me-down', () => {
  const flag = graphWire.FLAG_NIGHT_FILL_EXPLICIT;
  const pick = 0x00AA55;
  ['dark', 'light'].forEach((theme) => {
    const sfx = theme === 'light' ? 'Light' : 'Dark';
    const blob = { secondaryLine: 'wind', thirdLine: 'off', secondaryLineFill: true, theme };
    blob[`gcWindFill${sfx}`] = '#00AA55';
    blob[`gcWindNight${sfx}`] = '#00AA55';
    const bytes = graphWire.buildLineStyleBytes(blob, emery);
    // The five night bytes are identical to the carried case above — only the intent differs.
    assert.equal(bytes[6], rainTier.rgbToGColor8(lineStyle.nightAreaColorsFor('wind', pick).base),
      `${theme}: the same colour paints either way`);
    assert.equal(bytes[9] & flag, flag,
      `${theme}: but a chosen tint opts the light-polarity re-shade in`);
    assert.equal(lineStyle.graphColorIsPicked(blob, 'wind', 'Night', sfx), true,
      `${theme}: and telemetry reports it as a pick, not 'default'`);
  });
});

// resolveGraphColors is TOTAL over secondaryLine: 'off', absent, and an unknown id all
// have to answer something. They land on the metric-less arm of nightAreaColorsFor — the
// precip triple for the polarity in hand, verbatim — rather than running the lighten
// recipe over the theme foreground. Nothing renders it (forecast_layer.c gates the
// underlay on a present, filled second line), but the bytes have to be stable, so they are
// pinned here. bw/bw-light follow their polarity like any other theme: the watch discards
// all five night bytes in B&W, so the only requirement is that they stay deterministic.
test('an off, absent or unknown secondary metric packs the metric-less night triple', () => {
  ['off', undefined, 'foo'].forEach((secondaryLine) => {
    ['dark', 'light', 'bw', 'bw-light'].forEach((theme) => {
      const triple = lineStyle.nightAreaColorsFor('nope', null, theme);
      const bytes = graphWire.buildLineStyleBytes(
        { secondaryLine, thirdLine: 'off', secondaryLineFill: true, theme }, emery);
      const where = `${secondaryLine} / ${theme}`;
      assert.equal(bytes[6], rainTier.rgbToGColor8(triple.base), `${where} base`);
      assert.equal(bytes[7], rainTier.rgbToGColor8(triple.hatch), `${where} hatch`);
      assert.equal(bytes[8], rainTier.rgbToGColor8(triple.boundary), `${where} boundary`);
      assert.equal(bytes[9] & graphWire.FLAG_NIGHT_FILL_EXPLICIT, 0, `${where} flag`);
    });
  });
});

test('a night tint off BOTH its built-in and the fill still opts the light polarity in', () => {
  const flag = graphWire.FLAG_NIGHT_FILL_EXPLICIT;
  const bytes = graphWire.buildLineStyleBytes({
    secondaryLine: 'wind', thirdLine: 'off', secondaryLineFill: true, theme: 'light',
    gcWindFillLight: '#00AA55', gcWindNightLight: '#550055'
  }, emery);
  assert.equal(bytes[6], rainTier.rgbToGColor8(0x550055), 'the deliberate tint paints');
  assert.equal(bytes[9] & flag, flag, 'and opts the light re-shade in');
});

test('a Light night-fill pick paints on the light polarity too', () => {
  const bytes = graphWire.buildLineStyleBytes({
    secondaryLine: 'wind', thirdLine: 'off', secondaryLineFill: true, theme: 'light',
    gcWindNightLight: '#0055AA'
  }, emery);
  assert.equal(bytes[6], rainTier.rgbToGColor8(0x0055AA));
});

// The three LINE bytes are painted on every render mode, so a B&W render must resolve
// them through the B&W arms. The five NIGHT bytes are not: every night colour reaches
// the render through theme_pick(colour_arm, bw_arm) and the underlay through
// has_underlay = !theme_is_bw() (forecast_layer.c), so a bw theme discards all of them
// and paints theme_fg() over LightGray from its own constants. They are therefore left
// unpinned here — deliberately, since pinning them was five bytes of ceremony no watch
// ever read — and simply carry the polarity's picks.
test('a B&W theme takes the B&W line arms; its night tail is discarded, not special-cased', () => {
  const picks = {
    gcWindLineDark: '#FF0000', gcWindLineLight: '#FF0000',
    gcWindFillDark: '#FF0000', gcWindFillLight: '#FF0000',
    gcGustLineDark: '#FF0000', gcGustLineLight: '#FF0000',
    gcNightHatchDark: '#FF0000', gcNightHatchLight: '#FF0000',
    gcNightBoundaryDark: '#FF0000', gcNightBoundaryLight: '#FF0000',
    gcWindNightDark: '#FF0000', gcWindNightLight: '#FF0000'
  };
  const base = { secondaryLine: 'wind', thirdLine: 'gust', secondaryLineFill: true };
  [['bw', 'dark'], ['bw-light', 'light']].forEach(([theme, polarityTwin]) => {
    const bytes = graphWire.buildLineStyleBytes(
      Object.assign({ theme }, base, picks), emery);
    const fg = rainTier.rgbToGColor8(resolveInk(COLORS.GColorWhite, theme));
    assert.equal(bytes[0], fg, `${theme} main line ignores the pick`);
    assert.equal(bytes[1], rainTier.rgbToGColor8(COLORS.GColorLightGray), `${theme} fill`);
    assert.equal(bytes[2], fg, `${theme} second line ignores the pick`);
    assert.deepEqual(bytes.slice(4), graphWire.buildLineStyleBytes(
      Object.assign({ theme: polarityTwin }, base, picks), emery).slice(4),
      `${theme} night tail is just the ${polarityTwin}-polarity tail`);
  });
});

// --- Draw from: Top in bit 5 of each line's style byte (LINE_BIT) ---------------
// Bytes [11], [12], [13], [15] carry their line's flag (persist.h LINE_STYLE_FROM_TOP,
// 0x20). Every other byte is untouched, and with every key on Bottom (or absent, or
// junk) the sixteen bytes are the ones the build before Draw from sent: pinned per
// platform below, captured from that build.
const DRAW_FROM_PLATFORMS = ['aplite', 'basalt', 'chalk', 'diorite', 'emery', 'flint'];
const DRAW_FROM_KEYS = ['precipLineFrom', 'cloudLineFrom', 'windLineFrom', 'uvLineFrom', 'rainBarFrom', 'radarBarFrom'];
const STYLE_BYTE_OF = { secondaryLine: 11, thirdLine: 12, fourthLine: 13, fifthLine: 15 };
// The shipped look (rain chance filled, UV dots) and four amount lines in four styles.
const PRE_DRAW_FROM = {
  look: {
    settings: { secondaryLine: 'precip_prob', thirdLine: 'uv', fourthLine: 'off', fifthLine: 'off',
      secondaryLineFill: true, theme: 'dark', rainBarColor: 'multicolor' },
    bytes: {
      aplite: [255, 234, 255, 1, 213, 213, 194, 195, 203, 0, 255, 4, 1, 2, 255, 2],
      basalt: [219, 198, 243, 1, 213, 213, 194, 195, 203, 0, 255, 4, 1, 2, 255, 2],
      chalk: [219, 198, 243, 1, 213, 213, 194, 195, 203, 0, 255, 4, 1, 2, 255, 2],
      diorite: [255, 234, 255, 1, 213, 213, 194, 195, 203, 0, 255, 4, 1, 2, 255, 2],
      emery: [219, 198, 243, 1, 213, 213, 194, 195, 203, 0, 255, 4, 1, 2, 255, 2],
      flint: [255, 234, 255, 1, 213, 213, 194, 195, 203, 0, 255, 4, 1, 2, 255, 2]
    }
  },
  amounts: {
    settings: { secondaryLine: 'wind', thirdLine: 'gust', fourthLine: 'cloud', fifthLine: 'uv',
      secondaryLineStyle: 'bold', thirdLineStyle: 'dots', fourthLineStyle: 'x', fifthLineStyle: 'line',
      secondaryLineFill: true, theme: 'light', rainBarColor: 'white' },
    bytes: {
      aplite: [255, 234, 255, 1, 213, 213, 212, 232, 232, 0, 255, 12, 1, 2, 255, 4],
      basalt: [248, 252, 192, 1, 213, 213, 249, 254, 255, 0, 214, 12, 1, 2, 226, 4],
      chalk: [248, 252, 192, 1, 213, 213, 249, 254, 255, 0, 214, 12, 1, 2, 226, 4],
      diorite: [192, 234, 192, 1, 213, 213, 249, 254, 255, 0, 192, 12, 1, 2, 192, 4],
      emery: [248, 252, 192, 1, 213, 213, 249, 254, 255, 0, 214, 12, 1, 2, 226, 4],
      flint: [192, 234, 192, 1, 213, 213, 249, 254, 255, 0, 192, 12, 1, 2, 192, 4]
    }
  }
};

test('Draw from on Bottom, absent or junk: the sixteen bytes the build before it sent', () => {
  Object.keys(PRE_DRAW_FROM).forEach((name) => {
    const { settings, bytes } = PRE_DRAW_FROM[name];
    DRAW_FROM_PLATFORMS.forEach((platform) => {
      const at = { platform };
      assert.deepEqual(graphWire.buildLineStyleBytes(settings, at), bytes[platform], name + ' ' + platform);
      const bottom = Object.assign({}, settings);
      const junk = Object.assign({}, settings);
      DRAW_FROM_KEYS.forEach((k) => { bottom[k] = 'bottom'; junk[k] = 'TOP'; });
      assert.deepEqual(graphWire.buildLineStyleBytes(bottom, at), bytes[platform], name + ' bottom ' + platform);
      assert.deepEqual(graphWire.buildLineStyleBytes(junk, at), bytes[platform], name + ' junk ' + platform);
    });
  });
});

test('Draw from: Top sets bit 5 on exactly the matching line\'s style byte', () => {
  const { settings, bytes } = PRE_DRAW_FROM.amounts;
  ['basalt', 'chalk', 'diorite', 'emery', 'flint'].forEach((platform) => {
    const base = bytes[platform];
    // wind (Main, bold) and gusts (Second, dots) share windLineFrom.
    [['windLineFrom', ['secondaryLine', 'thirdLine']], ['cloudLineFrom', ['fourthLine']],
      ['uvLineFrom', ['fifthLine']], ['precipLineFrom', []]].forEach(([key, lines]) => {
      const got = graphWire.buildLineStyleBytes(Object.assign({ [key]: 'top' }, settings), { platform });
      const want = base.slice();
      lines.forEach((l) => { want[STYLE_BYTE_OF[l]] = base[STYLE_BYTE_OF[l]] | 0x20; });
      assert.deepEqual(got, want, platform + ' ' + key);
    });
  });
  // An unknown watch reads basalt: it hangs too.
  assert.equal(graphWire.buildLineStyleBytes(Object.assign({ uvLineFrom: 'top' }, settings), null)[15], 0x24);
});

test('Draw from: never on aplite, a stripe, a line not drawn, or a line without the setting', () => {
  const allTop = {};
  DRAW_FROM_KEYS.forEach((k) => { allTop[k] = 'top'; });
  // aplite: byte-identical, every key on Top.
  Object.keys(PRE_DRAW_FROM).forEach((name) => {
    const { settings, bytes } = PRE_DRAW_FROM[name];
    assert.deepEqual(graphWire.buildLineStyleBytes(Object.assign({}, settings, allTop), { platform: 'aplite' }),
      bytes.aplite, name);
  });
  const emeryAt = { platform: 'emery' };
  // A stripe keeps its own edge: 0x07 (stripeTop) and 0x03 (stripeBottom) stay.
  const stripes = graphWire.buildLineStyleBytes(Object.assign({ secondaryLine: 'uv', thirdLine: 'cloud',
    secondaryLineStyle: 'stripeTop', thirdLineStyle: 'stripeBottom', theme: 'dark' }, allTop), emeryAt);
  assert.equal(stripes[11], 0x07);
  assert.equal(stripes[12], 0x03);
  // Feels, dew and pressure never hang.
  const temps = graphWire.buildLineStyleBytes(Object.assign({ secondaryLine: 'feels', thirdLine: 'dew',
    fourthLine: 'pressure', fifthLine: 'off', theme: 'dark' }, allTop), emeryAt);
  [11, 12, 13, 15].forEach((i) => assert.equal(temps[i] & 0x20, 0, 'byte ' + i));
  // A line that is off, or repeats an earlier pick, sends no flag.
  const off = graphWire.buildLineStyleBytes(Object.assign({ secondaryLine: 'precip_prob', thirdLine: 'precip_prob',
    fourthLine: 'off', fifthLine: 'off', theme: 'dark' }, allTop), emeryAt);
  assert.equal(off[11] & 0x20, 0x20, 'the drawn rain-chance line hangs');
  [12, 13, 15].forEach((i) => assert.equal(off[i] & 0x20, 0, 'byte ' + i));
  // Bit 7 stays reserved at 0, every byte above. Bit 6 (the float bit) is set on exactly the
  // drawn feels, dew and pressure lines: never on a stripe, an amount line or a line not drawn.
  [stripes, temps, off].forEach((b) => [11, 12, 13, 15].forEach((i) => assert.equal(b[i] & 0x80, 0)));
  [stripes, off].forEach((b) => [11, 12, 13, 15].forEach((i) => assert.equal(b[i] & 0x40, 0, 'byte ' + i)));
  assert.deepEqual([11, 12, 13, 15].map((i) => temps[i] & 0x40), [0x40, 0x40, 0x40, 0]);
});

// --- The float bit: bit 6 of each line's style byte (FLOAT_BIT) -----------------------
// A drawn line whose metric has no Draw from key (pressure, feels-like, dew point) anchors
// no edge of the graph, so the watch's temperature-axis margins ignore it (persist.h
// LINE_STYLE_FLOATING, temp_axis_pad.h).
test('the float bit: on every drawn pressure, feels and dew line, as a line or marks, on every capable watch', () => {
  ['basalt', 'chalk', 'diorite', 'emery', 'flint'].forEach((platform) => {
    ['pressure', 'feels', 'dew'].forEach((metric) => {
      Object.keys(STYLE_BYTE_OF).forEach((lineKey) => {
        ['line', 'bold', 'dots', 'x'].forEach((st) => {
          const s = { secondaryLine: 'off', thirdLine: 'off', fourthLine: 'off', fifthLine: 'off',
            [lineKey]: metric, [lineKey + 'Style']: st, theme: 'dark' };
          const b = graphWire.buildLineStyleBytes(s, { platform });
          assert.equal(b[STYLE_BYTE_OF[lineKey]],
            lineStyle.lineStyleByte(s, lineKey + 'Style') | 0x40, [platform, metric, lineKey, st].join(' '));
          Object.keys(STYLE_BYTE_OF).filter((k) => k !== lineKey).forEach((k) =>
            assert.equal(b[STYLE_BYTE_OF[k]] & 0x40, 0, [platform, metric, lineKey, k].join(' ')));
        });
      });
    });
  });
});

test('the float bit: never on an amount line, a stripe, a line not drawn, or on aplite', () => {
  const emeryAt = { platform: 'emery' };
  // Every amount metric anchors the edge it is drawn from: no float bit, Bottom or Top.
  ['precip_prob', 'cloud', 'wind', 'gust', 'uv'].forEach((metric) => {
    [{}, { precipLineFrom: 'top', cloudLineFrom: 'top', windLineFrom: 'top', uvLineFrom: 'top' }].forEach((from) => {
      const b = graphWire.buildLineStyleBytes(Object.assign({ secondaryLine: metric, thirdLine: 'off',
        fourthLine: 'off', fifthLine: 'off', theme: 'dark' }, from), emeryAt);
      assert.equal(b[11] & 0x40, 0, metric);
    });
  });
  // A repeat of an earlier pick is not drawn: no bit.
  const repeat = graphWire.buildLineStyleBytes({ secondaryLine: 'pressure', thirdLine: 'pressure',
    fourthLine: 'off', fifthLine: 'off', theme: 'dark' }, emeryAt);
  assert.deepEqual([11, 12, 13, 15].map((i) => repeat[i] & 0x40), [0x40, 0, 0, 0]);
  // aplite: the PRE_DRAW_FROM bytes, a pressure Main line or not.
  const pressure = Object.assign({}, PRE_DRAW_FROM.look.settings, { thirdLine: 'pressure' });
  const ap = graphWire.buildLineStyleBytes(pressure, { platform: 'aplite' });
  [11, 12, 13, 15].forEach((i) => assert.equal(ap[i] & 0x40, 0, 'aplite byte ' + i));
});

// --- One packer: the Clay send and the fixture send ------------------------------------
// Both ship the three graph tuples, so both take them from buildGraphTuples: two call
// sites that each built a palette and a style tuple once drifted apart in their comments,
// and nothing but a shared builder keeps their bytes together.
const WATCHES = [null, {}, { platform: '' }, { platform: 'aplite' }, { platform: 'basalt' },
  { platform: 'chalk' }, { platform: 'diorite' }, { platform: 'emery' }, { platform: 'flint' },
  { platform: 'gabbro' }];
const GRAPH_SETTINGS = [
  { secondaryLine: 'precip_prob', thirdLine: 'uv', secondaryLineFill: true, theme: 'dark', rainBarColor: 'multicolor' },
  { secondaryLine: 'wind', thirdLine: 'gust', fourthLine: 'cloud', fifthLine: 'pressure', secondaryLineStyle: 'bold',
    windLineFrom: 'top', cloudLineFrom: 'top', rainBarFrom: 'top', radarBarFrom: 'top', theme: 'light',
    rainBarColor: 'white', radarColor: 'multicolor', gcWindLineLight: '#FF0000' },
  { secondaryLine: 'uv', secondaryLineStyle: 'stripeTop', thirdLine: 'feels', fourthLine: 'dew', theme: 'bw',
    uvLineFrom: 'top' }
];

test('buildGraphTuples: the three tuples in send order, each its own packer\'s answer', () => {
  WATCHES.forEach((watchInfo) => GRAPH_SETTINGS.forEach((settings, n) => {
    const at = JSON.stringify(watchInfo) + ' #' + n;
    const tuples = graphWire.buildGraphTuples(settings, watchInfo);
    assert.deepEqual(Object.keys(tuples), ['BAR_PALETTE_UINT8', 'RADAR_PALETTE_UINT8', 'CLAY_LINE_STYLE_UINT8'], at);
    const palette = graphWire.buildPaletteTuples(settings, watchInfo);
    assert.deepEqual(tuples.BAR_PALETTE_UINT8, palette.BAR_PALETTE_UINT8, at);
    assert.deepEqual(tuples.RADAR_PALETTE_UINT8, palette.RADAR_PALETTE_UINT8, at);
    assert.deepEqual(tuples.CLAY_LINE_STYLE_UINT8, graphWire.buildLineStyleBytes(settings, watchInfo), at);
  }));
});

// computeEnv is the watch the bytes are packed for: a watch the phone cannot name (no
// watchInfo, no platform, a newer one) packs as a capable colour watch — the basalt bytes,
// Top bits and colour picks included — never as aplite.
test('an unknown watch packs the basalt bytes', () => {
  [null, undefined, {}, { platform: '' }, { platform: 'foo' }].forEach((watchInfo) => GRAPH_SETTINGS.forEach((settings, n) =>
    assert.deepEqual(graphWire.buildGraphTuples(settings, watchInfo),
      graphWire.buildGraphTuples(settings, { platform: 'basalt' }), JSON.stringify(watchInfo) + ' #' + n)));
  // ...which hangs, where aplite would not.
  const hung = graphWire.buildGraphTuples(GRAPH_SETTINGS[1], null);
  assert.equal(hung.CLAY_LINE_STYLE_UINT8[11] & graphWire.LINE_BIT, graphWire.LINE_BIT);
  assert.equal(hung.BAR_PALETTE_UINT8[1] & graphWire.PALETTE_BIT, graphWire.PALETTE_BIT);
});

test('the Clay payload and the fixture send carry the same three graph tuples', () => {
  const { buildClayPayload } = require('../src/pkjs/clay-payload.js');
  const { sendFixtureWeather } = require('../src/pkjs/fixture-weather.js');
  const fixture = {
    name: 'graph-wire',
    weather: { city: 'Testville', currentTemp: 60, startEpoch: 1000, temps: [50, 51, 52], precipPct: [0, 40, 80],
      windKmh: [5, 25, 50], sunEvents: [{ type: 'sunrise', epoch: 1000 }, { type: 'sunset', epoch: 2000 }] }
  };
  const KEYS = ['BAR_PALETTE_UINT8', 'RADAR_PALETTE_UINT8', 'CLAY_LINE_STYLE_UINT8'];
  const pick = (payload) => KEYS.reduce((o, k) => { o[k] = payload[k]; return o; }, {});
  const origPebble = global.Pebble;
  try {
    WATCHES.forEach((watchInfo) => GRAPH_SETTINGS.forEach((settings, n) => {
      const at = JSON.stringify(watchInfo) + ' #' + n;
      const want = graphWire.buildGraphTuples(settings, watchInfo);
      assert.deepEqual(pick(buildClayPayload(Object.assign({}, settings), watchInfo, new Date(2026, 6, 15, 9, 0))),
        want, 'Clay ' + at);
      const sent = [];
      global.Pebble = { sendAppMessage: (payload) => { sent.push(payload); } };
      sendFixtureWeather(fixture, { settings: Object.assign({}, settings), watchInfo });
      assert.equal(sent.length, 1, at);
      assert.deepEqual(pick(sent[0]), want, 'fixture ' + at);
    }));
  } finally {
    global.Pebble = origPebble;
  }
});
