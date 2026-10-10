// test/line-style.test.js — the graph colours' and line styles' reading (src/pkjs/
// line-style.js): the built-ins, the picks, the night area, the cascade, the stripe rules
// and the style-byte encoding. The sixteen wire bytes it resolves into are pinned in
// graph-wire.test.js (src/pkjs/weather/graph-wire.js packs them).
const test = require('node:test');
const assert = require('node:assert');
const lineStyle = require('../src/pkjs/line-style.js');
const graphWire = require('../src/pkjs/weather/graph-wire.js');
const platform = require('../src/pkjs/config-ui/lib/platform.js');
const COLORS = require('../src/pkjs/pebble-colors.js');
const { resolveInk } = require('../src/pkjs/resolve-ink.js');
const rainTier = require('../src/pkjs/weather/rain-tier.js');

const emery = { platform: 'emery' };
// The graph colours one watch resolves to: resolveGraphColors over that watch's
// config-ui env, the call weather/graph-wire.js packs the wire from.
const resolve = (settings, watchInfo) => lineStyle.resolveGraphColors(settings, platform.computeEnv(watchInfo));

test('aplite folds a light theme back to dark polarity (no black-on-black)', () => {
  const light = resolve(
    { secondaryLine: 'wind', thirdLine: 'off', theme: 'light' }, { platform: 'aplite' });
  const dark = resolve(
    { secondaryLine: 'wind', thirdLine: 'off', theme: 'dark' }, { platform: 'aplite' });
  assert.equal(light.secondary, dark.secondary);
});

test('a third colour is always resolved, even when the third line is off', () => {
  const off = resolve(
    { secondaryLine: 'wind', thirdLine: 'off', theme: 'dark' }, emery);
  assert.equal(typeof off.third, 'number');
});

// --- renderContextFor: the one answer to "what is this watch rendering?" ------
//
// The wire packer and the telemetry snapshot each derived this themselves once, and
// diverged: telemetry copied the theme fold but not the colour-platform check, so a
// diorite install reported picks the wire had already resolved away to white. Both now
// open with this call over the watch's computeEnv, so the divergence cannot come back.
const renderContext = (settings, watchInfo) => lineStyle.renderContextFor(settings, platform.computeEnv(watchInfo));

test('renderContextFor folds the theme, tests the display, and names the polarity', () => {
  assert.deepEqual(renderContext({ theme: 'dark' }, { platform: 'basalt' }),
    { theme: 'dark', isColor: true, suffix: 'Dark' });
  assert.deepEqual(renderContext({ theme: 'light' }, { platform: 'basalt' }),
    { theme: 'light', isColor: true, suffix: 'Light' });
  // B&W hardware: colour-capable theme, no colour display.
  assert.deepEqual(renderContext({ theme: 'dark' }, { platform: 'diorite' }),
    { theme: 'dark', isColor: false, suffix: 'Dark' });
  // aplite also has the light polarity compiled out, so a light install folds to dark.
  assert.deepEqual(renderContext({ theme: 'light' }, { platform: 'aplite' }),
    { theme: 'dark', isColor: false, suffix: 'Dark' });
  // A bw theme on colour hardware renders the B&W model.
  assert.deepEqual(renderContext({ theme: 'bw-light' }, { platform: 'basalt' }),
    { theme: 'bw-light', isColor: false, suffix: 'Light' });
  // No watchInfo, no theme: an unknown watch reads colour, on the dark default.
  assert.deepEqual(renderContext({}, null),
    { theme: 'dark', isColor: true, suffix: 'Dark' });
});

test('a B&W display resolves every line pick away, whatever the theme says', () => {
  const settings = { secondaryLine: 'wind', thirdLine: 'off', theme: 'dark',
                     gcWindLineDark: '#FF0000' };
  assert.equal(resolve(settings, { platform: 'basalt' }).secondary, 0xFF0000);
  ['diorite', 'aplite'].forEach((platform) => {
    assert.equal(resolve(settings, { platform }).secondary, COLORS.GColorWhite,
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

// --- The fill -> night-tint cascade ------------------------------------------
//
// The night band is painted OPAQUELY (chart.c's has_underlay loop strokes the underlay
// from the curve down to the axis), so the night tint REPLACES the day fill inside the
// night hours rather than tinting it. A tint left on the metric's built-in while the fill
// has been moved would therefore paint over a colour the user chose with one they never
// did. So an unclaimed tint CASCADES from the fill — and the cascade is derived HERE, at
// resolve time (graphNightTint), never written into the tint key by the settings page.
//
// That is the whole point. A page-side write makes a claimed tint and a hand-me-down one
// the same bytes, and then nothing downstream can tell them apart: v1.15.0 guessed by
// comparing the two, so a tint deliberately picked EQUAL to its fill read as untouched —
// the light-polarity re-shade was silently skipped and telemetry reported 'default'.

test('graphNightTint answers claimed, then carried, then the built-in', () => {
  const blob = (extra) => Object.assign({ secondaryLine: 'wind' }, extra);
  assert.equal(lineStyle.graphNightTint(blob({ gcWindNightDark: '#550055', gcWindFillDark: '#00AA55' }),
    'wind', 'Dark'), 0x550055, 'claimed: the tint the user picked for itself');
  assert.equal(lineStyle.graphNightTint(blob({ gcWindFillDark: '#00AA55' }), 'wind', 'Dark'),
    0x00AA55, 'carried: no tint of its own, so the fill they did pick');
  assert.equal(lineStyle.graphNightTint(blob({}), 'wind', 'Dark'), null,
    'built-in: null, so nightAreaColorsFor keeps the hand-tuned triple verbatim');
  // A tint STORED on its built-in is the same answer as an absent one — that is what every
  // seeded and every freshly reset install looks like (engine.js seedDefaults writes the
  // concrete built-in into each colour key at page open).
  assert.equal(lineStyle.graphNightTint(
    blob({ gcWindNightDark: lineStyle.graphColorDefault('wind', 'Night', 'Dark', {}),
      gcWindFillDark: '#00AA55' }), 'wind', 'Dark'), 0x00AA55, 'a stored built-in still carries');
  // Symmetrically: a FILL sitting on its own built-in has nothing to carry, so the night
  // band keeps its hand-tuned triple. Picking the built-in colour off the palette is
  // indistinguishable from never having touched the row, by design — that value-comparison
  // model is what makes "did the user choose this?" answerable at all.
  assert.equal(lineStyle.graphNightTint(
    blob({ gcWindFillDark: lineStyle.graphColorDefault('wind', 'Fill', 'Dark', {}) }), 'wind', 'Dark'),
  null, 'a fill on its built-in carries nothing');
});

// resolveInk's exactly-white -> black flip now lives only in the !isColor arm. On a
// colour render there is nothing left for it to do: the light-polarity built-ins are
// concrete per-polarity values (gust and feels are Black there, straight out of
// LINE_COLORS.light), and a colour the user picked for the light polarity is the colour
// they want on the light polarity.
test('the light-polarity built-in is black; on B&W the flip still does that work', () => {
  const light = { secondaryLine: 'gust', thirdLine: 'off', theme: 'light' };
  assert.equal(resolve(light, emery).secondary, COLORS.GColorBlack,
    "gust's light built-in IS black — no flip involved");
  assert.equal(resolve(light, { platform: 'diorite' }).secondary,
    resolveInk(COLORS.GColorWhite, 'light'),
    'B&W resolves white through the flip instead of reading a key');
  const picked = resolve(
    Object.assign({ gcGustLineLight: '#FFFFFF' }, light), emery);
  assert.equal(picked.secondary, COLORS.GColorWhite, 'a deliberate white pick is not flipped');
});

// --- The concrete defaults ---------------------------------------------------
//
// THE appearance contract of this feature. The DARK column is the colour 1.14.1 rendered
// for that metric, so seeding those keys changes no pixel. The LIGHT column is no longer
// 1.14.1's: it was tuned metric-by-metric on hardware in the light (alpha) theme, so it
// intentionally repaints. Each Light cell is a colour that was eyeballed on a watch — do
// NOT "fix" one to restore symmetry with its Dark neighbour or to follow a recipe.
//
// graphColorDefault DERIVES each cell from LINE_COLORS / FILL_COLORS / NIGHT_AREA_COLORS
// (+ NIGHT_AREA_LIGHT_BASE) rather than transcribing them, so asserting it against those
// same resolvers would be a tautology. These are therefore LITERAL 0xRRGGBB values: a
// tweak to any of the tables repaints somebody's graph and has to break the build here
// first. A literal table belongs in a test — not in a second copy in production.
const EXPECTED_DEFAULTS = {
  precip_prob: {
    Line:     { Dark: 0x55AAFF, Light: 0x0000AA },  // PictonBlue / DukeBlue
    Fill:     { Dark: 0x0055AA, Light: 0x55FFFF },  // CobaltBlue / ElectricBlue
    Night:    { Dark: 0x0000AA, Light: 0x00FFFF }   // DukeBlue / Cyan
  },
  // Cloud cover postdates 1.14.1: these are its debut built-ins, pinned the same way.
  cloud: {
    Line:     { Dark: 0xAAAAFF, Light: 0x5555AA },  // BabyBlueEyes / Liberty
    Fill:     { Dark: 0x5555AA, Light: 0xAAAAFF },  // Liberty / BabyBlueEyes
    Night:    { Dark: 0x000055, Light: 0xAAAAFF }   // OxfordBlue / BabyBlueEyes
  },
  wind: {
    Line:     { Dark: 0xFFFF00, Light: 0xFFAA00 },  // Yellow / ChromeYellow
    Fill:     { Dark: 0x555500, Light: 0xFFFF00 },  // ArmyGreen / Yellow
    Night:    { Dark: 0x555500, Light: 0xFFAA55 }   // ArmyGreen / Rajah
  },
  uv: {
    Line:     { Dark: 0xFF00FF, Light: 0xAA00AA },  // Magenta / Purple
    Fill:     { Dark: 0xAA00AA, Light: 0xFF55FF },  // Purple / ShockingPink
    Night:    { Dark: 0x550055, Light: 0xFF55FF }   // ImperialPurple / ShockingPink
  },
  gust: {
    Line:     { Dark: 0xFFFFFF, Light: 0x000000 },  // White (multi bars) / Black
    Fill:     { Dark: 0x555555, Light: 0xAAAAAA },  // DarkGray / LightGray
    Night:    { Dark: 0x555555, Light: 0xAAAAAA }   // DarkGray / LightGray
  },
  pressure: {
    Line:     { Dark: 0xFF5500, Light: 0xFF5500 },  // Orange
    Fill:     { Dark: 0xAA5500, Light: 0xFFAA55 },  // WindsorTan / Rajah
    Night:    { Dark: 0xAA5500, Light: 0xFFAA55 }   // WindsorTan / Rajah
  },
  feels: {
    Line:     { Dark: 0xAAAAAA, Light: 0x000000 },  // LightGray / Black
    Fill:     { Dark: 0xAAAAAA, Light: 0xAAAAAA },  // LightGray — keyless, still resolved
    Night:    { Dark: 0xAAAAAA, Light: 0xAAAAAA }   // LightGray — keyless, still resolved
  },
  dew: {
    Line:     { Dark: 0x55AAAA, Light: 0x005555 },  // CadetBlue / MidnightGreen
    Fill:     { Dark: 0x55AAAA, Light: 0x55AAAA },  // CadetBlue — keyless, still resolved
    Night:    { Dark: 0x005555, Light: 0x005555 }   // MidnightGreen — keyless, still resolved
  },
  night: {
    Hatch:    { Dark: 0x555555, Light: 0x555555 },  // DarkGray — forecast_layer.c NIGHT_HATCH_COLOR
    Boundary: { Dark: 0x555555, Light: 0x555555 }   // DarkGray — forecast_layer.c NIGHT_BOUNDARY_COLOR
  }
};

test('every built-in default is the exact colour 1.14.1 painted for that metric and polarity', () => {
  Object.keys(EXPECTED_DEFAULTS).forEach((scope) => {
    Object.keys(EXPECTED_DEFAULTS[scope]).forEach((role) => {
      ['Dark', 'Light'].forEach((suffix) => {
        assert.equal(lineStyle.graphColorDefault(scope, role, suffix, {}),
          EXPECTED_DEFAULTS[scope][role][suffix], `${scope} ${role} ${suffix}`);
      });
    });
  });
  // Every key the schema builds a row for has an expectation above, so a new metric or
  // role cannot slip in unpinned. feels' Fill/Night carry no key but are still resolved
  // (resolveGraphColors asks for them), which is why the table is wider than the key list.
  lineStyle.graphColorKeys().forEach((key) => {
    const m = /^gc([A-Z][a-z]+)([A-Z][a-z]+)(Dark|Light)$/.exec(key);
    const scope = { Precip: 'precip_prob', Cloud: 'cloud', Wind: 'wind', Uv: 'uv', Gust: 'gust',
      Pressure: 'pressure', Feels: 'feels', Dew: 'dew', Night: 'night' }[m[1]];
    assert.ok(EXPECTED_DEFAULTS[scope] && EXPECTED_DEFAULTS[scope][m[2]],
      `${key} has no pinned expectation`);
  });
});

// gust's dark line is the ONE built-in that reads another live setting: it takes the
// achromatic slot, so it has to dodge whichever grey the rain bars use. graphColorDefault
// reaches that through lineColorFor, which owns the rainBarColor rule, and
// graphColorIsDefault accepts EITHER value as untouched. These two assertions are the only
// place the coupling is pinned to concrete colours — the EXPECTED_DEFAULTS row above
// covers the multicolour half only.
test("gust's dark line default follows rainBarColor, in both bar modes", () => {
  assert.equal(lineStyle.graphColorDefault('gust', 'Line', 'Dark', { rainBarColor: 'multi' }),
    COLORS.GColorWhite);
  assert.equal(lineStyle.graphColorDefault('gust', 'Line', 'Dark', { rainBarColor: 'white' }),
    COLORS.GColorLightGray);
});

test('gust/Line/Dark counts as untouched on either built-in, so white bars never get a white line', () => {
  ['#FFFFFF', '#AAAAAA'].forEach((seeded) => {
    ['multi', 'white'].forEach((rainBarColor) => {
      const settings = { rainBarColor, gcGustLineDark: seeded };
      assert.equal(lineStyle.graphColorIsDefault(settings, 'gust', 'Line', 'Dark'), true,
        `${seeded} on ${rainBarColor} bars`);
      const bytes = graphWire.buildLineStyleBytes(Object.assign(
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

test('graphColorKeys lists 44 unique, well-formed keys and covers every role each scope owns', () => {
  const keys = lineStyle.graphColorKeys();
  assert.equal(keys.length, 44);
  assert.equal(new Set(keys).size, 44, 'no duplicates');
  keys.forEach((key) => assert.match(key, /^gc[A-Z][A-Za-z]+(Dark|Light)$/, key));
  // feels never fills, so it has no Fill or night-tint row; the night band has only its
  // own two. Both are the graphColorRoles exception the schema builds its rows from.
  assert.deepEqual(lineStyle.graphColorRoles('feels'), ['Line']);
  assert.deepEqual(lineStyle.graphColorRoles('dew'), ['Line']);
  assert.deepEqual(lineStyle.graphColorRoles('wind'), ['Line', 'Fill', 'Night']);
  assert.deepEqual(lineStyle.graphColorRoles('night'), ['Hatch', 'Boundary']);
  assert.equal(keys.indexOf('gcFeelsFillDark'), -1);
  assert.equal(keys.indexOf('gcFeelsNightDark'), -1);
  assert.deepEqual(keys.slice(-4),
    ['gcNightHatchDark', 'gcNightHatchLight', 'gcNightBoundaryDark', 'gcNightBoundaryLight']);
});

// feels gets no Fill/Night KEY but resolveGraphColors still resolves a fill byte and a
// night tint for it, so graphColorDefault has to answer for those roles anyway.
test('graphColorDefault is total over the roles feels has no key for', () => {
  ['Dark', 'Light'].forEach((suffix) => {
    assert.equal(typeof lineStyle.graphColorDefault('feels', 'Fill', suffix, {}), 'number');
    assert.equal(typeof lineStyle.graphColorDefault('feels', 'Night', suffix, {}), 'number');
  });
  // …and for a scope it knows nothing about — thirdLine's 'off' falls through to
  // lineColorFor like any other unknown metric, and GColorBlack being falsy means an
  // `undefined` here would not be caught by a `||`.
  assert.equal(lineStyle.graphColorDefault('off', 'Line', 'Dark', {}), COLORS.GColorWhite);
  assert.equal(lineStyle.graphColorDefault('off', 'Fill', 'Light', {}), COLORS.GColorBlack);
});

// --- The C-header contract for the per-line style bytes ---------------------
// The kind bits and width field of wire bytes [11..13] are decoded on the
// watch by persist.h's line_style_kind / line_style_solid_width against
// chart.h's ChartLineStyle values. Parse both headers (the
// date-format-contract.test.js idiom) and drive the JS packer through the
// SAME arithmetic, so a unilateral renumber or field move on either end fails
// here mechanically instead of leaning on comment-mirrored literals.
const fs = require('node:fs');
const path = require('node:path');
const chartHeader = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'c', 'appendix', 'chart.h'), 'utf8');
const persistHeader = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'c', 'appendix', 'persist.h'), 'utf8');

function cEnum(header, name, file) {
  const m = header.match(new RegExp(name + '\\s*=\\s*(\\d+)'));
  assert.ok(m, name + ' missing from ' + file);
  return Number(m[1]);
}
function cDefine(header, name, file) {   // hex-tolerant (LINE_STYLE_KIND_MASK is 0x03)
  const m = header.match(new RegExp('#define\\s+' + name + '\\s+(0x[0-9a-fA-F]+|\\d+)'));
  assert.ok(m, name + ' missing from ' + file);
  return Number(m[1]);
}

test('the style-byte encoding matches the C headers, decoded with their own constants', () => {
  const KIND = {
    solid: cEnum(chartHeader, 'CHART_LINE_SOLID', 'chart.h'),
    dots: cEnum(chartHeader, 'CHART_LINE_DOTS', 'chart.h'),
    x: cEnum(chartHeader, 'CHART_LINE_X', 'chart.h'),
    stripe: cEnum(chartHeader, 'CHART_LINE_STRIPE', 'chart.h')
  };
  const KIND_MASK = cDefine(persistHeader, 'LINE_STYLE_KIND_MASK', 'persist.h');
  const WIDTH_SHIFT = cDefine(persistHeader, 'LINE_STYLE_WIDTH_SHIFT', 'persist.h');
  const WIDTH_MAX = cDefine(persistHeader, 'LINE_STYLE_WIDTH_MAX', 'persist.h');
  const STYLE_BYTES = cDefine(persistHeader, 'LINE_STYLE_STYLE_BYTES', 'persist.h');
  // persist.h's decode inlines, replicated from the parsed constants.
  const decodeKind = (b) => b & KIND_MASK;
  const decodeStripeTop = (b) => ((b >> WIDTH_SHIFT) & 0x01) !== 0;
  const decodeWidth = (b, fallback) => {
    const w = (b >> WIDTH_SHIFT) & WIDTH_MAX;
    return w > 0 ? w : fallback;
  };
  // Each style value decodes on the C side to the rendering it names.
  const byteFor = (v) => lineStyle.lineStyleByte({ secondaryLine: 'uv', secondaryLineStyle: v }, 'secondaryLineStyle');
  assert.equal(decodeKind(byteFor('line')), KIND.solid);
  assert.equal(decodeWidth(byteFor('line'), 0), 1, "'line' carries a 1 px stroke");
  assert.equal(decodeKind(byteFor('bold')), KIND.solid);
  assert.equal(decodeWidth(byteFor('bold'), 0), 3, "'bold' carries a 3 px stroke");
  assert.equal(decodeKind(byteFor('dots')), KIND.dots);
  assert.equal(decodeKind(byteFor('x')), KIND.x);
  assert.equal(decodeKind(byteFor('stripeTop')), KIND.stripe);
  assert.equal(decodeStripeTop(byteFor('stripeTop')), true, "'stripeTop' sits on the top edge");
  assert.equal(decodeKind(byteFor('stripeBottom')), KIND.stripe);
  assert.equal(decodeStripeTop(byteFor('stripeBottom')), false, "'stripeBottom' on the bottom edge");
  // The literal bytes test/c/line_style_decode_test.c pins on the C side.
  assert.equal(byteFor('stripeBottom'), 0x03);
  assert.equal(byteFor('stripeTop'), 0x07);
  // The wire's style block is exactly the persist blob the watch stores.
  const bytes = graphWire.buildLineStyleBytes({ secondaryLine: 'wind', thirdLine: 'gust', fifthLine: 'cloud', theme: 'dark' }, { platform: 'emery' });
  assert.equal(bytes.length - 11 - 2, STYLE_BYTES, 'bytes [11..13] are LINE_STYLE_STYLE_BYTES');
  // The fourth metric's style byte ([15]) rides its own persist slot, same layout —
  // x marks by default, the kind persist.c's unset-slot default returns too.
  assert.equal(decodeKind(bytes[15]), KIND.x);
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'src', 'c', 'appendix', 'persist.c'), 'utf8'),
    /FIFTH_LINE_STYLE\)\) \{[^}]*return \(uint8_t\) CHART_LINE_X;/,
    "persist.c's unset fourth-line style mirrors LINE_STYLE_DEFAULTS.fifthLineStyle ('x')");
  assert.equal(byteFor('x'), KIND.x, "and 'x' packs to exactly that byte");
});

test('a stripe-styled main line never fills, unless the watch ignores the styles', () => {
  const base = { secondaryLine: 'cloud', secondaryLineFill: true, thirdLine: 'off', theme: 'dark' };
  ['stripeTop', 'stripeBottom'].forEach((st) => {
    const s = Object.assign({ secondaryLineStyle: st }, base);
    assert.equal(resolve(s, { platform: 'basalt' }).fillOn, false, st + ' on basalt');
    assert.equal(graphWire.buildLineStyleBytes(s, { platform: 'basalt' })[3] & 0x01, 0,
      st + ': the wire fill flag is clear');
    // aplite has no selectable styles (WW_LINE_STYLE): a stripe picked on a colour
    // watch paired to the same phone must not switch its fill off.
    assert.equal(resolve(s, { platform: 'aplite' }).fillOn, true, st + ' on aplite');
    assert.equal(lineStyle.resolveGraphColors(s, { color: true, themePolarity: true, lineStyles: false }).fillOn,
      true, st + ' with lineStyles: false');
  });
  // A stripe on another line leaves the main line's fill alone.
  assert.equal(resolve(Object.assign({ thirdLineStyle: 'stripeTop' }, base),
    { platform: 'basalt' }).fillOn, true);
  assert.equal(lineStyle.isStripeStyle({ fourthLine: 'uv', fourthLineStyle: 'stripeBottom' }, 'fourthLineStyle'), true);
  assert.equal(lineStyle.isStripeStyle({}, 'fourthLineStyle'), false, 'the default x is not a stripe');
  // Pressure cannot be a stripe: a stored one draws as a line, which fills.
  const pressure = Object.assign({}, base, { secondaryLine: 'pressure', secondaryLineStyle: 'stripeTop' });
  assert.equal(resolve(pressure, { platform: 'basalt' }).fillOn, true, 'pressure fills');
});

// Stripes read as intensity (how MUCH rain chance, cloud, UV, wind), so only those
// metrics can be one: feels-like and dew point sit on the temperature band (no zero)
// and pressure is band-scaled, its trend the story. ONE rule in line-style.js; the
// settings page's options, the bake, the preview and telemetry all resolve through it.
const STYLE_KEYS = ['secondaryLineStyle', 'thirdLineStyle', 'fourthLineStyle', 'fifthLineStyle'];
test('stripes are for intensity metrics only: precip, cloud, wind, gusts and UV', () => {
  assert.deepEqual(lineStyle.STRIPE_METRIC_IDS, ['precip_prob', 'cloud', 'wind', 'gust', 'uv']);
  lineStyle.GRAPH_METRICS.forEach((m) => {
    assert.equal(lineStyle.metricAllowsStripe(m), ['feels', 'dew', 'pressure'].indexOf(m) === -1, m);
  });
  [undefined, null, 'off', '', 'constructor', 'toString', 42].forEach((m) => {
    assert.equal(lineStyle.metricAllowsStripe(m), false, String(m) + ' is no stripe metric');
  });
  assert.equal(lineStyle.isStripeValue('stripeTop'), true);
  assert.equal(lineStyle.isStripeValue('stripeBottom'), true);
  ['line', 'bold', 'dots', 'x', 'constructor', undefined].forEach((v) => {
    assert.equal(lineStyle.isStripeValue(v), false, String(v));
  });
});

test('no built-in line style is a stripe: the fourth metric debuts as x marks', () => {
  assert.deepEqual(lineStyle.LINE_STYLE_DEFAULTS, { secondaryLineStyle: 'line', thirdLineStyle: 'dots',
    fourthLineStyle: 'x', fifthLineStyle: 'x' });
  // So every default suits every metric, and a stripe a metric cannot show falls back
  // to the line's own default.
  STYLE_KEYS.forEach((key) => assert.ok(!lineStyle.isStripeValue(lineStyle.LINE_STYLE_DEFAULTS[key]), key));
  assert.equal(lineStyle.lineStyleValue({ fifthLine: 'feels', fifthLineStyle: 'stripeTop' }, 'fifthLineStyle'), 'x');
  assert.equal(lineStyle.lineStyleValue({ fifthLine: 'cloud' }, 'fifthLineStyle'), 'x', 'unset: x marks');
});

test('a stored stripe on a metric that cannot be one resolves to the line\'s non-stripe style', () => {
  STYLE_KEYS.forEach((key, i) => {
    const lineKey = lineStyle.FORECAST_LINES[i].key;
    assert.equal(lineStyle.FORECAST_LINES[i].styleKey, key, 'FORECAST_LINES names each line\'s style key');
    const d = lineStyle.LINE_STYLE_DEFAULTS[key];
    // The line's built-in when that is no stripe, else a thin line — what the settings
    // page's display-snap shows (item default when still offered, else the first option).
    const fallback = lineStyle.isStripeValue(d) ? 'line' : d;
    ['stripeTop', 'stripeBottom'].forEach((st) => {
      lineStyle.GRAPH_METRICS.forEach((m) => {
        const s = { [lineKey]: m, [key]: st };
        const want = lineStyle.metricAllowsStripe(m) ? st : fallback;
        assert.equal(lineStyle.lineStyleValue(s, key), want, key + ' ' + m + ' ' + st);
        assert.equal(lineStyle.isStripeStyle(s, key), lineStyle.metricAllowsStripe(m), key + ' ' + m + ' ' + st);
        // The wire byte never carries the stripe kind (3) for a disallowed metric.
        assert.equal((lineStyle.lineStyleByte(s, key) & 0x03) === 3, lineStyle.metricAllowsStripe(m),
          key + ' ' + m + ' ' + st + ' byte');
      });
    });
    // Non-stripe styles pass through for every metric.
    ['line', 'bold', 'dots', 'x'].forEach((st) => {
      lineStyle.GRAPH_METRICS.forEach((m) => {
        assert.equal(lineStyle.lineStyleValue({ [lineKey]: m, [key]: st }, key), st, key + ' ' + m + ' ' + st);
      });
    });
  });
  // The packed tuple: feels, dew and pressure stripes on every line reach the watch as
  // no stripe at all, so the watch can never draw one.
  const bytes = graphWire.buildLineStyleBytes({ secondaryLine: 'pressure', thirdLine: 'feels', fourthLine: 'dew',
    fifthLine: 'off', secondaryLineStyle: 'stripeTop', thirdLineStyle: 'stripeBottom',
    fourthLineStyle: 'stripeTop', fifthLineStyle: 'stripeBottom', theme: 'dark' }, emery);
  [11, 12, 13, 15].forEach((i) => assert.notEqual(bytes[i] & 0x03, 3, 'byte ' + i + ' is no stripe'));
  // Drawn as lines then, all three float (bit 6: no zero to stand on, graph-wire.js FLOAT_BIT).
  assert.deepEqual([bytes[11], bytes[12], bytes[13]], [
    lineStyle.lineStyleByte({ secondaryLineStyle: 'line' }, 'secondaryLineStyle') | 0x40,
    lineStyle.lineStyleByte({ thirdLineStyle: 'dots' }, 'thirdLineStyle') | 0x40,
    lineStyle.lineStyleByte({ fourthLineStyle: 'x' }, 'fourthLineStyle') | 0x40
  ], 'each line falls back to its own built-in');
});

test('cloud cover resolves its own line and fill colours, like every graph metric', () => {
  const s = { secondaryLine: 'cloud', thirdLine: 'off', theme: 'dark' };
  const dark = resolve(s, { platform: 'basalt' });
  assert.equal(dark.secondary, COLORS.GColorBabyBlueEyes);
  assert.equal(dark.fill, COLORS.GColorLiberty);
  const light = resolve(Object.assign({}, s, { theme: 'light' }), { platform: 'basalt' });
  assert.equal(light.secondary, COLORS.GColorLiberty);
  assert.deepEqual(lineStyle.nightAreaColorsFor('cloud', null, 'dark'),
    { base: COLORS.GColorOxfordBlue, hatch: COLORS.GColorLiberty, boundary: COLORS.GColorBabyBlueEyes });
});

test('effectiveLineMetric: every forecast line may carry a temperature-axis metric; off and repeats draw nothing', () => {
  // Each line has its own curve-inset byte, so no line bans feels or dew.
  for (const key of ['secondaryLine', 'thirdLine', 'fourthLine', 'fifthLine']) {
    for (const metric of lineStyle.TEMP_AXIS_METRIC_IDS) {
      const s = { secondaryLine: 'precip_prob', thirdLine: 'off', fourthLine: 'off', fifthLine: 'off' };
      s[key] = metric;
      assert.equal(lineStyle.effectiveLineMetric(s, key), metric, `${metric} on ${key}`);
    }
  }
  const s = { secondaryLine: 'wind', thirdLine: 'feels', fourthLine: 'feels', fifthLine: 'dew' };
  assert.equal(lineStyle.effectiveLineMetric(s, 'fourthLine'), null, 'a repeat of an earlier pick is off');
  assert.equal(lineStyle.effectiveLineMetric(s, 'fifthLine'), 'dew');
  assert.equal(lineStyle.effectiveLineMetric({ fourthLine: 'off' }, 'fourthLine'), null, 'off is off');
  assert.equal(lineStyle.effectiveLineMetric({}, 'fifthLine'), null, 'unset is off');
});

// THE one walk for "which forecast line draws metric X": forecast-axis.js' feels-like /
// dew point gate, forecast-series.js' bake gate and the settings page's hostLine ask it.
test('firstDrawnLine: the first line drawing a metric that passes, lines 3-4 only with allLines', () => {
  const temp = lineStyle.isTempAxisMetric;
  const is = (metric) => (m) => m === metric;
  // [settings, allLines, test, the line it names]
  const cases = [
    [{}, true, () => true, null],
    [{ secondaryLine: 'off', thirdLine: 'off', fourthLine: 'off', fifthLine: 'off' }, true, () => true, null],
    [{ secondaryLine: 'wind', thirdLine: 'feels', fourthLine: 'dew' }, true, temp, 'thirdLine'],
    [{ secondaryLine: 'wind', thirdLine: 'uv', fourthLine: 'dew' }, true, temp, 'fourthLine'],
    [{ secondaryLine: 'wind', thirdLine: 'uv', fourthLine: 'dew' }, false, temp, null],
    [{ secondaryLine: 'dew', thirdLine: 'dew' }, true, is('dew'), 'secondaryLine'],
    [{ secondaryLine: 'off', fourthLine: 'uv', fifthLine: 'uv' }, true, is('uv'), 'fourthLine'],
    [{ secondaryLine: 'off', fifthLine: 'gust' }, true, is('gust'), 'fifthLine'],
    [{ secondaryLine: 'off', fifthLine: 'gust' }, false, is('gust'), null],
    [{ secondaryLine: 'cloud', thirdLine: 'wind' }, true, (m) => ['wind', 'gust'].indexOf(m) >= 0, 'thirdLine']
  ];
  cases.forEach(([s, allLines, t, want]) => {
    assert.equal(lineStyle.firstDrawnLine(s, allLines, t), want, JSON.stringify([s, allLines]));
  });
  lineStyle.FORECAST_LINES.forEach((line, i) => {
    const s = {};
    s[line.key] = 'cloud';
    assert.equal(lineStyle.firstDrawnLine(s, true, is('cloud')), line.key, line.key);
    assert.equal(lineStyle.firstDrawnLine(s, false, is('cloud')), i < 2 ? line.key : null, line.key + ' frozen');
  });
  // The test sees only what a line draws: never off, an unset line or a repeat of an
  // earlier pick, and nothing of lines 3-4 without allLines.
  const seen = (allLines) => {
    const asked = [];
    lineStyle.firstDrawnLine({ secondaryLine: 'off', thirdLine: 'cloud', fourthLine: 'cloud', fifthLine: 'uv' },
      allLines, (m) => { asked.push(m); return false; });
    return asked;
  };
  assert.deepEqual(seen(true), ['cloud', 'uv']);
  assert.deepEqual(seen(false), ['cloud']);
});
