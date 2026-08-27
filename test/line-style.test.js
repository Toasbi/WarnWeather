const test = require('node:test');
const assert = require('node:assert');
const lineStyle = require('../src/pkjs/line-style.js');
const rainTier = require('../src/pkjs/weather/rain-tier.js');
const COLORS = require('../src/pkjs/pebble-colors.js');
const { resolveInk } = require('../src/pkjs/resolve-ink.js');

const emery = { platform: 'emery' };

test('packs ten bytes: three line colours, a line flag byte, five night colours, a night flag byte', () => {
  const bytes = lineStyle.buildLineStyleBytes(
    { secondaryLine: 'wind', thirdLine: 'gust', secondaryLineFill: false, theme: 'dark' }, emery);
  assert.equal(bytes.length, 10);
  [0, 1, 2, 4, 5, 6, 7, 8].forEach(
    (i) => assert.ok(bytes[i] >= 0xC0 && bytes[i] <= 0xFF, `byte ${i} (${bytes[i]}) is not a GColor8`));
  assert.equal(bytes[3], 0, 'fill off');
  assert.equal(bytes[9], 0, 'night fill still on its built-in tint');
});

// Bytes 4..9 are the watch's NIGHT_COLORS persist blob verbatim (persist.h's
// NIGHT_COLOR_BYTES = 6), which is the whole reason the night-fill bit lives in byte
// [9] instead of byte [3]: app_message.c stores the tail straight through, so the two
// ends cannot pick different bits or offsets for it.
test('the night block is a contiguous six-byte tail, flag included', () => {
  const bytes = lineStyle.buildLineStyleBytes({
    secondaryLine: 'wind', thirdLine: 'off', secondaryLineFill: true, theme: 'dark',
    gcWindNightDark: '#550055'
  }, emery);
  assert.equal(bytes.length - 4, 6, 'NIGHT_COLOR_BYTES worth of tail after the four line bytes');
  assert.equal(bytes[9] & lineStyle.FLAG_NIGHT_FILL_EXPLICIT, lineStyle.FLAG_NIGHT_FILL_EXPLICIT);
  assert.equal(bytes[3] & 0x01, 1, 'the line flag byte still carries only the fill bit');
  assert.equal(bytes[3], 0x01, 'and nothing else — the night flag left byte [3] entirely');
});

test('the fill flag follows secondaryLineFill', () => {
  const on = lineStyle.buildLineStyleBytes(
    { secondaryLine: 'wind', thirdLine: 'off', secondaryLineFill: true, theme: 'dark' }, emery);
  assert.equal(on[3] & 0x01, 1);
});

test('feels-like never fills, whatever the setting says', () => {
  const bytes = lineStyle.buildLineStyleBytes(
    { secondaryLine: 'feels', thirdLine: 'off', secondaryLineFill: true, theme: 'dark' }, emery);
  assert.equal(bytes[3] & 0x01, 0);
});

test('the packed colour equals the quantized resolved colour', () => {
  const settings = { secondaryLine: 'wind', thirdLine: 'gust', secondaryLineFill: false, theme: 'dark' };
  const resolved = lineStyle.resolveLineStyle(settings, emery);
  const bytes = lineStyle.buildLineStyleBytes(settings, emery);
  assert.equal(bytes[0], rainTier.rgbToGColor8(resolved.secondary));
  assert.equal(bytes[2], rainTier.rgbToGColor8(resolved.third));
});

test('aplite folds a light theme back to dark polarity (no black-on-black)', () => {
  const light = lineStyle.resolveLineStyle(
    { secondaryLine: 'wind', thirdLine: 'off', theme: 'light' }, { platform: 'aplite' });
  const dark = lineStyle.resolveLineStyle(
    { secondaryLine: 'wind', thirdLine: 'off', theme: 'dark' }, { platform: 'aplite' });
  assert.equal(light.secondary, dark.secondary);
});

test('a third colour is always resolved, even when the third line is off', () => {
  const off = lineStyle.resolveLineStyle(
    { secondaryLine: 'wind', thirdLine: 'off', theme: 'dark' }, emery);
  assert.equal(typeof off.third, 'number');
});

// --- renderContext: the one answer to "what is this watch rendering?" ---------
//
// The wire packer and the telemetry snapshot each derived this themselves once, and
// diverged: telemetry copied the theme fold but not the colour-platform check, so a
// diorite install reported picks the wire had already resolved away to white. Both now
// open with this call, so the divergence cannot come back.

test('renderContext folds the theme, tests the display, and names the polarity', () => {
  assert.deepEqual(lineStyle.renderContext({ theme: 'dark' }, { platform: 'basalt' }),
    { theme: 'dark', isColor: true, suffix: 'Dark' });
  assert.deepEqual(lineStyle.renderContext({ theme: 'light' }, { platform: 'basalt' }),
    { theme: 'light', isColor: true, suffix: 'Light' });
  // B&W hardware: colour-capable theme, no colour display.
  assert.deepEqual(lineStyle.renderContext({ theme: 'dark' }, { platform: 'diorite' }),
    { theme: 'dark', isColor: false, suffix: 'Dark' });
  // aplite also has the light polarity compiled out, so a light install folds to dark.
  assert.deepEqual(lineStyle.renderContext({ theme: 'light' }, { platform: 'aplite' }),
    { theme: 'dark', isColor: false, suffix: 'Dark' });
  // A bw theme on colour hardware renders the B&W model.
  assert.deepEqual(lineStyle.renderContext({ theme: 'bw-light' }, { platform: 'basalt' }),
    { theme: 'bw-light', isColor: false, suffix: 'Light' });
  // No watchInfo, no theme: colour basalt on the dark default.
  assert.deepEqual(lineStyle.renderContext({}, null),
    { theme: 'dark', isColor: true, suffix: 'Dark' });
});

test('a B&W display resolves every line pick away, whatever the theme says', () => {
  const settings = { secondaryLine: 'wind', thirdLine: 'off', theme: 'dark',
                     gcWindLineDark: '#FF0000' };
  assert.equal(lineStyle.resolveLineStyle(settings, { platform: 'basalt' }).secondary, 0xFF0000);
  ['diorite', 'aplite'].forEach((platform) => {
    assert.equal(lineStyle.resolveLineStyle(settings, { platform }).secondary, COLORS.GColorWhite,
      `${platform} has no colour display, so the pick cannot reach the wire`);
  });
});

// --- The night colours (wire bytes 4..9) -------------------------------------
//
// The watch used to hold these itself, so the built-in has to reproduce
// forecast_layer.c's hand-tuned table byte for byte — otherwise every existing
// install's night shading changes hue on upgrade.

test('the night-area triples are the six the watch hand-tuned', () => {
  const expected = {
    precip_prob: { base: 0x0000AA, hatch: 0x0000FF, boundary: 0x00AAFF },  // DukeBlue/Blue/VividCerulean
    wind:        { base: 0x555500, hatch: 0xAAAA00, boundary: 0xAAAA00 },  // ArmyGreen/Limerick/Limerick
    uv:          { base: 0x550055, hatch: 0xAA00AA, boundary: 0xAA00FF },  // ImperialPurple/Purple/VividViolet
    gust:        { base: 0x555555, hatch: 0xAAAAAA, boundary: 0xAAAAAA },  // DarkGray/LightGray/LightGray
    pressure:    { base: 0xAA5500, hatch: 0xFF5500, boundary: 0xFF5500 },  // WindsorTan/Orange/Orange
    feels:       { base: 0xAAAAAA, hatch: 0xFFFFFF, boundary: 0xFFFFFF }   // LightGray/White/White
  };
  Object.keys(expected).forEach((metric) => {
    assert.deepEqual(lineStyle.nightAreaColorsFor(metric, null), expected[metric], metric);
  });
});

test('an unknown metric falls through to the precip triple (the C default arm)', () => {
  assert.deepEqual(lineStyle.nightAreaColorsFor('off', null),
                   lineStyle.nightAreaColorsFor('precip_prob', null));
});

// Guards the comment on nightAreaColorsFor: the derivation is NOT the recipe the six
// triples were built with, so the table can never be "simplified" into a call to it.
// Run each hand-tuned base through the formula by hand and only `feels` comes out
// matching. This is also why nightAreaColorsFor short-circuits on a tint EQUAL to the
// base: the stored night tint now DEFAULTS to that base, so re-deriving would hand five
// of the six metrics a new hatch and boundary on a blob nobody has touched.
test('the hand-tuned triples are not formula-derived — five of the six differ', () => {
  const metrics = ['precip_prob', 'wind', 'uv', 'gust', 'pressure', 'feels'];
  const same = metrics.filter((metric) => {
    const hand = lineStyle.nightAreaColorsFor(metric, null);
    const hatch = lineStyle.lighten(hand.base);
    return hatch === hand.hatch && lineStyle.lighten(hatch) === hand.boundary;
  });
  assert.deepEqual(same, ['feels'],
    'only feels happens to sit on the formula; the other five are hand-tuned per hue');
  // …so storing the base must return the hand-tuned triple, not the formula's.
  metrics.forEach((metric) => {
    const hand = lineStyle.nightAreaColorsFor(metric, null);
    assert.deepEqual(lineStyle.nightAreaColorsFor(metric, hand.base), hand, metric);
  });
});

test('lighten steps exactly one Pebble level per channel and clamps at white', () => {
  assert.equal(lineStyle.lighten(0x555500), 0xAAAA55);
  assert.equal(lineStyle.lighten(0xAAAAAA), 0xFFFFFF);
  assert.equal(lineStyle.lighten(0xFFFFFF), 0xFFFFFF);
});

// The snap lives at the parse boundary now, so "a resolved colour is on the Pebble-64
// grid" is an invariant of colorPick's output rather than something six call sites each
// remember to apply. It is invisible on the wire (rgbToGColor8 reduces both forms to the
// same level) — what it buys is exact level arithmetic for lighten().
test('colorPick snaps a pick onto the Pebble-64 grid and leaves palette values alone', () => {
  assert.equal(lineStyle.colorPick('#AA5500'), 0xAA5500);
  assert.equal(lineStyle.colorPick('#123456'), 0x000055);
  assert.equal(lineStyle.colorPick(0x123456), 0x000055, 'ints snap too, not just hex strings');
  [' ', '', null, undefined, 'not a colour', NaN].forEach(
    (v) => assert.equal(lineStyle.colorPick(v), null, `${String(v)} stores no colour`));
});

test('an off-grid pick reaches the wire as the colour the watch would paint anyway', () => {
  const base = { secondaryLine: 'wind', thirdLine: 'off', theme: 'dark' };
  assert.deepEqual(
    lineStyle.buildLineStyleBytes(Object.assign({ gcWindLineDark: '#123456' }, base), emery),
    lineStyle.buildLineStyleBytes(Object.assign({ gcWindLineDark: '#000055' }, base), emery));
});

test('a night-fill tint moved off the built-in derives hatch and boundary one Pebble step apart', () => {
  const derived = lineStyle.nightAreaColorsFor('wind', 0x550055);
  assert.equal(derived.base, 0x550055);
  assert.equal(derived.hatch, lineStyle.lighten(0x550055));
  assert.equal(derived.boundary, lineStyle.lighten(lineStyle.lighten(0x550055)));
});

test('a LightGray night-fill pick collapses boundary onto hatch, like four of the hand triples', () => {
  const derived = lineStyle.nightAreaColorsFor('gust', 0xAAAAAA);
  assert.equal(derived.hatch, 0xFFFFFF);
  assert.equal(derived.boundary, derived.hatch);
});

test('the full-height night hatch and boundary default to DarkGray in both polarities', () => {
  const darkGray = rainTier.rgbToGColor8(COLORS.GColorDarkGray);
  ['dark', 'light'].forEach((theme) => {
    const bytes = lineStyle.buildLineStyleBytes({ secondaryLine: 'wind', thirdLine: 'off', theme }, emery);
    assert.equal(bytes[4], darkGray, `${theme} hatch`);
    assert.equal(bytes[5], darkGray, `${theme} boundary`);
  });
});

test('the seeded default sends the metric triple on bytes 6..8', () => {
  const bytes = lineStyle.buildLineStyleBytes(
    { secondaryLine: 'uv', thirdLine: 'off', secondaryLineFill: true, theme: 'dark' }, emery);
  const uv = lineStyle.nightAreaColorsFor('uv', null);
  assert.equal(bytes[6], rainTier.rgbToGColor8(uv.base));
  assert.equal(bytes[7], rainTier.rgbToGColor8(uv.hatch));
  assert.equal(bytes[8], rainTier.rgbToGColor8(uv.boundary));
});

// --- The user's picks --------------------------------------------------------

test('a pick replaces the built-in line, fill and dot colours', () => {
  const bytes = lineStyle.buildLineStyleBytes({
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
    lineStyle.buildLineStyleBytes(Object.assign({ gcWindLineDark: '#FFAA00' }, base), emery),
    lineStyle.buildLineStyleBytes(base, emery), 'the wind pick is dormant while uv is the main line');
  assert.equal(
    lineStyle.buildLineStyleBytes(
      Object.assign({ gcUvLineDark: '#FFAA00' }, base), emery)[0],
    rainTier.rgbToGColor8(0xFFAA00), 'the uv pick is the one that paints');
});

test('a pick stored as an int reads the same as the hex string the page writes', () => {
  const base = { secondaryLine: 'wind', thirdLine: 'off', theme: 'dark' };
  const asInt = lineStyle.buildLineStyleBytes(Object.assign({ gcWindLineDark: 0xFFAA00 }, base), emery);
  const asHex = lineStyle.buildLineStyleBytes(Object.assign({ gcWindLineDark: '#FFAA00' }, base), emery);
  assert.deepEqual(asInt, asHex);
});

// THE appearance contract. seedDefaults writes every one of the 36 keys into a fresh
// blob, so "a blob carrying all the defaults" is what a real install looks like — and it
// has to pack exactly what a blob with no graph keys at all (a 1.14.1 install) packs.
test('a blob seeded with every default packs the same ten bytes as a blob with no graph keys', () => {
  const keys = lineStyle.graphColorKeys();
  ['dark', 'light'].forEach((theme) => {
    ['precip_prob', 'wind', 'uv', 'gust', 'pressure', 'feels'].forEach((metric) => {
      const base = { secondaryLine: metric, thirdLine: 'uv', secondaryLineFill: true, theme };
      const seeded = Object.assign({}, base);
      keys.forEach((key) => {
        const m = /^gc([A-Z][a-z]+)([A-Z][a-z]+)(Dark|Light)$/.exec(key);
        const scope = { Precip: 'precip_prob', Wind: 'wind', Uv: 'uv', Gust: 'gust',
          Pressure: 'pressure', Feels: 'feels', Night: 'night' }[m[1]];
        seeded[key] = lineStyle.graphColorDefault(scope, m[2], m[3], base);
      });
      assert.deepEqual(lineStyle.buildLineStyleBytes(seeded, emery),
        lineStyle.buildLineStyleBytes(base, emery), `${metric} / ${theme}`);
    });
  });
});

test('an absent or unparseable value falls back to the built-in colour', () => {
  const base = { secondaryLine: 'wind', thirdLine: 'gust', secondaryLineFill: true, theme: 'dark' };
  const builtin = lineStyle.buildLineStyleBytes(base, emery);
  ['', null, undefined, 'not a colour'].forEach((junk) => {
    const blanked = Object.assign({}, base, {
      gcWindLineDark: junk, gcWindFillDark: junk, gcGustLineDark: junk,
      gcNightHatchDark: junk, gcNightBoundaryDark: junk, gcWindNightDark: junk
    });
    assert.deepEqual(lineStyle.buildLineStyleBytes(blanked, emery), builtin, String(junk));
  });
});

test('picks are per polarity: the Light set is ignored on a dark theme and vice versa', () => {
  const base = { secondaryLine: 'wind', thirdLine: 'off', theme: 'dark' };
  assert.deepEqual(
    lineStyle.buildLineStyleBytes(Object.assign({ gcWindLineLight: '#FF0000' }, base), emery),
    lineStyle.buildLineStyleBytes(base, emery));
  const light = lineStyle.buildLineStyleBytes(
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
  const bytes = lineStyle.buildLineStyleBytes(settings, { platform: 'aplite' });
  assert.equal(bytes[0], rainTier.rgbToGColor8(COLORS.GColorWhite),
    'the main line takes the B&W arm, not the Dark pick');
  // Every Light pick was folded away, so the night tail is what the Dark polarity says —
  // here all built-in, since only Light night picks were set.
  assert.deepEqual(bytes.slice(4), lineStyle.buildLineStyleBytes(
    { secondaryLine: 'wind', thirdLine: 'off', secondaryLineFill: true, theme: 'dark' },
    { platform: 'aplite' }).slice(4));
  assert.equal(bytes[9] & lineStyle.FLAG_NIGHT_FILL_EXPLICIT, 0);
});

test('the night picks reach bytes 4..8', () => {
  const bytes = lineStyle.buildLineStyleBytes({
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

// The flag is the light-polarity opt-in the watch reads (forecast_layer.c:493-494), so
// it must stay clear while the tint sits on its built-in — including when that built-in
// is STORED, which is what every seeded install looks like.
test('the night-fill flag is set only when the tint differs from the built-in, in either polarity', () => {
  const flag = lineStyle.FLAG_NIGHT_FILL_EXPLICIT;
  const dark = { secondaryLine: 'wind', thirdLine: 'off', secondaryLineFill: true, theme: 'dark' };
  const light = Object.assign({}, dark, { theme: 'light' });
  const windBase = lineStyle.nightAreaColorsFor('wind', null).base;
  assert.equal(lineStyle.buildLineStyleBytes(dark, emery)[9] & flag, 0, 'dark, key absent');
  assert.equal(lineStyle.buildLineStyleBytes(light, emery)[9] & flag, 0, 'light, key absent');
  assert.equal(
    lineStyle.buildLineStyleBytes(Object.assign({ gcWindNightDark: windBase }, dark), emery)[9] & flag,
    0, 'dark, the built-in stored explicitly');
  assert.equal(
    lineStyle.buildLineStyleBytes(Object.assign({ gcWindNightLight: windBase }, light), emery)[9] & flag,
    0, 'light, the built-in stored explicitly');
  assert.equal(
    lineStyle.buildLineStyleBytes(Object.assign({ gcWindNightDark: '#550055' }, dark), emery)[9] & flag,
    flag, 'dark pick');
  assert.equal(
    lineStyle.buildLineStyleBytes(Object.assign({ gcWindNightLight: '#550055' }, light), emery)[9] & flag,
    flag, 'light pick');
});

// The night band is painted OPAQUELY (chart.c's has_underlay loop strokes the underlay
// from the curve down to the axis), so the night tint REPLACES the day fill inside the
// night hours rather than tinting it. A tint left on the metric's built-in while the
// fill has been moved therefore paints over a colour the user chose with one they never
// did — the bug this pair pins the fix for. The settings page carries an unclaimed tint
// along with the fill (blocks.js' graphFillTint), and a tint that merely FOLLOWS the
// fill is not a night CHOICE: it must leave the flag clear, or every light-polarity fill
// pick would opt into the re-shade that light deliberately skips.
test('a night tint following the fill re-shades in the fill colour and claims no explicit pick', () => {
  const flag = lineStyle.FLAG_NIGHT_FILL_EXPLICIT;
  const pick = 0x00AA55;
  const bytes = lineStyle.buildLineStyleBytes({
    secondaryLine: 'wind', thirdLine: 'off', secondaryLineFill: true, theme: 'dark',
    gcWindFillDark: '#00AA55', gcWindNightDark: '#00AA55'
  }, emery);
  assert.equal(bytes[1], rainTier.rgbToGColor8(pick), 'the day fill is the pick');
  assert.equal(bytes[6], rainTier.rgbToGColor8(pick),
    'and the night band re-shades in that same colour instead of the built-in triple');
  assert.equal(bytes[9] & flag, 0,
    'a followed tint is not a night choice — the light polarity keeps skipping the re-shade');
});

test('a night tint off BOTH its built-in and the fill still opts the light polarity in', () => {
  const flag = lineStyle.FLAG_NIGHT_FILL_EXPLICIT;
  const bytes = lineStyle.buildLineStyleBytes({
    secondaryLine: 'wind', thirdLine: 'off', secondaryLineFill: true, theme: 'light',
    gcWindFillLight: '#00AA55', gcWindNightLight: '#550055'
  }, emery);
  assert.equal(bytes[6], rainTier.rgbToGColor8(0x550055), 'the deliberate tint paints');
  assert.equal(bytes[9] & flag, flag, 'and opts the light re-shade in');
});

test('a Light night-fill pick paints on the light polarity too', () => {
  const bytes = lineStyle.buildLineStyleBytes({
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
    const bytes = lineStyle.buildLineStyleBytes(
      Object.assign({ theme }, base, picks), emery);
    const fg = rainTier.rgbToGColor8(resolveInk(COLORS.GColorWhite, theme));
    assert.equal(bytes[0], fg, `${theme} main line ignores the pick`);
    assert.equal(bytes[1], rainTier.rgbToGColor8(COLORS.GColorLightGray), `${theme} fill`);
    assert.equal(bytes[2], fg, `${theme} second line ignores the pick`);
    assert.deepEqual(bytes.slice(4), lineStyle.buildLineStyleBytes(
      Object.assign({ theme: polarityTwin }, base, picks), emery).slice(4),
      `${theme} night tail is just the ${polarityTwin}-polarity tail`);
  });
});

// resolveInk's exactly-white -> black flip now lives only in the !isColor arm. On a
// colour render there is nothing left for it to do: the light-polarity built-ins are
// concrete per-polarity values (gust and feels are Black there, straight out of
// LINE_COLORS.light), and a colour the user picked for the light polarity is the colour
// they want on the light polarity.
test('the light-polarity built-in is black; on B&W the flip still does that work', () => {
  const light = { secondaryLine: 'gust', thirdLine: 'off', theme: 'light' };
  assert.equal(lineStyle.resolveLineStyle(light, emery).secondary, COLORS.GColorBlack,
    "gust's light built-in IS black — no flip involved");
  assert.equal(lineStyle.resolveLineStyle(light, { platform: 'diorite' }).secondary,
    resolveInk(COLORS.GColorWhite, 'light'),
    'B&W resolves white through the flip instead of reading a key');
  const picked = lineStyle.resolveLineStyle(
    Object.assign({ gcGustLineLight: '#FFFFFF' }, light), emery);
  assert.equal(picked.secondary, COLORS.GColorWhite, 'a deliberate white pick is not flipped');
});

// --- The concrete defaults ---------------------------------------------------
//
// THE appearance contract of this feature. Every key defaults to the colour 1.14.1
// rendered for that metric and polarity, so seeding all 36 of them changes no pixel. The
// table in line-style.js is a transcription; this pins it against the three functions it
// transcribes, so editing either side breaks the build instead of quietly repainting
// somebody's graph.

test('every default equals what the built-in resolvers render for that metric and polarity', () => {
  lineStyle.GRAPH_METRICS.forEach((metric) => {
    ['Dark', 'Light'].forEach((suffix) => {
      const theme = suffix === 'Light' ? 'light' : 'dark';
      assert.equal(lineStyle.graphColorDefault(metric, 'Line', suffix, {}),
        lineStyle.lineColorFor(metric, {}, true, theme), `${metric} Line ${suffix}`);
      assert.equal(lineStyle.graphColorDefault(metric, 'Fill', suffix, {}),
        lineStyle.fillColorFor(metric, true, theme), `${metric} Fill ${suffix}`);
      assert.equal(lineStyle.graphColorDefault(metric, 'Night', suffix, {}),
        lineStyle.nightAreaColorsFor(metric, null).base, `${metric} Night ${suffix}`);
    });
  });
  ['Dark', 'Light'].forEach((suffix) => {
    ['Hatch', 'Boundary'].forEach((role) => {
      assert.equal(lineStyle.graphColorDefault('night', role, suffix, {}), COLORS.GColorDarkGray,
        `night ${role} ${suffix} — forecast_layer.c's NIGHT_HATCH/BOUNDARY_COLOR colour arm`);
    });
  });
});

// gust's dark line is the ONE built-in that reads another live setting: it takes the
// achromatic slot, so it has to dodge whichever grey the rain bars use. A static
// defaultValue cannot say that, so graphColorDefault resolves it and graphColorIsDefault
// accepts EITHER value as untouched.
test("gust's dark line default follows rainBarColor, in both bar modes", () => {
  assert.equal(lineStyle.graphColorDefault('gust', 'Line', 'Dark', { rainBarColor: 'multi' }),
    lineStyle.lineColorFor('gust', { rainBarColor: 'multi' }, true, 'dark'));
  assert.equal(lineStyle.graphColorDefault('gust', 'Line', 'Dark', { rainBarColor: 'multi' }),
    COLORS.GColorWhite);
  assert.equal(lineStyle.graphColorDefault('gust', 'Line', 'Dark', { rainBarColor: 'white' }),
    lineStyle.lineColorFor('gust', { rainBarColor: 'white' }, true, 'dark'));
  assert.equal(lineStyle.graphColorDefault('gust', 'Line', 'Dark', { rainBarColor: 'white' }),
    COLORS.GColorLightGray);
});

test('gust/Line/Dark counts as untouched on either built-in, so white bars never get a white line', () => {
  ['#FFFFFF', '#AAAAAA'].forEach((seeded) => {
    ['multi', 'white'].forEach((rainBarColor) => {
      const settings = { rainBarColor, gcGustLineDark: seeded };
      assert.equal(lineStyle.graphColorIsDefault(settings, 'gust', 'Line', 'Dark'), true,
        `${seeded} on ${rainBarColor} bars`);
      const bytes = lineStyle.buildLineStyleBytes(Object.assign(
        { secondaryLine: 'gust', thirdLine: 'off', theme: 'dark' }, settings), emery);
      assert.equal(bytes[0], rainTier.rgbToGColor8(
        rainBarColor === 'white' ? COLORS.GColorLightGray : COLORS.GColorWhite),
        `${seeded} on ${rainBarColor} bars resolves through rainBarColor`);
    });
  });
  // Every other row honours a pick of exactly those two greys.
  assert.equal(lineStyle.graphColorIsDefault({ gcWindLineDark: '#FFFFFF' }, 'wind', 'Line', 'Dark'),
    false, 'the exemption is gust/Line/Dark alone');
});

test('graphColorKeys lists 36 unique, well-formed keys and covers every role each scope owns', () => {
  const keys = lineStyle.graphColorKeys();
  assert.equal(keys.length, 36);
  assert.equal(new Set(keys).size, 36, 'no duplicates');
  keys.forEach((key) => assert.match(key, /^gc[A-Z][A-Za-z]+(Dark|Light)$/, key));
  // feels never fills, so it has no Fill or night-tint row; the night band has only its
  // own two. Both are the graphColorRoles exception the schema builds its rows from.
  assert.deepEqual(lineStyle.graphColorRoles('feels'), ['Line']);
  assert.deepEqual(lineStyle.graphColorRoles('wind'), ['Line', 'Fill', 'Night']);
  assert.deepEqual(lineStyle.graphColorRoles('night'), ['Hatch', 'Boundary']);
  assert.equal(keys.indexOf('gcFeelsFillDark'), -1);
  assert.equal(keys.indexOf('gcFeelsNightDark'), -1);
  assert.deepEqual(keys.slice(-4),
    ['gcNightHatchDark', 'gcNightHatchLight', 'gcNightBoundaryDark', 'gcNightBoundaryLight']);
});

// feels gets no Fill/Night KEY but resolveGraphColors still resolves a fill byte and a
// night tint for it, so the defaults table has to answer for those roles anyway.
test('the defaults table is total over the roles feels has no key for', () => {
  ['Dark', 'Light'].forEach((suffix) => {
    assert.equal(typeof lineStyle.graphColorDefault('feels', 'Fill', suffix, {}), 'number');
    assert.equal(typeof lineStyle.graphColorDefault('feels', 'Night', suffix, {}), 'number');
  });
  // …and for a scope with no table row at all — thirdLine's 'off' is resolved like any
  // other metric, and GColorBlack being falsy means an `undefined` here would not be
  // caught by a `||`.
  assert.equal(lineStyle.graphColorDefault('off', 'Line', 'Dark', {}), COLORS.GColorWhite);
  assert.equal(lineStyle.graphColorDefault('off', 'Fill', 'Light', {}), COLORS.GColorBlack);
});
