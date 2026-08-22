// test/config-blocks.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
require('../src/pkjs/config-ui/lib/schema-walk.js');
require('../src/pkjs/config-ui/lib/color.js');
require('../src/pkjs/config-ui/lib/show-when.js');
require('../src/pkjs/config-ui/lib/engine.js');
const B = require('../src/pkjs/settings/blocks.js');
// The block renderers moved to preview-blocks.js; blocks.js keeps the
// threshold machinery + small resolvers (and still registers everything).
const PB = require('../src/pkjs/settings/preview-blocks.js');
const budgetLib = require('../src/pkjs/settings/tomorrowio-budget.js');

function budgetState(over) {
  return Object.assign({
    provider: 'tomorrowio', radarProvider: 'tomorrowio', fetchIntervalMin: '5',
    sleepNightEnabled: true, sleepStartHour: '0', sleepEndHour: '7',
    tomorrowioFitBudget: true
  }, over || {});
}

test('forecastPreview returns an SVG with the rain bars rendered', () => {
  const fc = PB.forecastPreview({ dayNightShading: true, barSource: 'rain', rainBarColor: 'multicolor', secondaryLine: 'precip_prob', secondaryLineFill: true, windScale: 'mid' }, { color: true });
  assert.ok(/^<svg/.test(fc) && fc.indexOf('</svg>') > 0, 'is an SVG document');
  assert.ok(fc.indexOf('fill="#00FF00"') > -1, 'multicolor rain bars actually render (not an empty frame)');
});
test('radarPreview: off message vs SVG', () => {
  assert.ok(PB.radarPreview({ radarMode: 'off', radarColor: 'multicolor' }, { color: true }).indexOf('Radar off') >= 0);
  assert.ok(/^<svg/.test(PB.radarPreview({ radarProvider: 'dwd', radarColor: 'white' }, { color: true })));
});
// A multicolor radar band fill (e.g. #00FF00) appears on a color watch but never on B/W,
// where the bars are always solid white regardless of the (hidden) radarColor setting.
const GREEN_BAND = 'fill="#00FF00"';
test('radarPreview forces white bars on B/W even when setting says multicolor', () => {
  const color = PB.radarPreview({ radarProvider: 'dwd', radarColor: 'multicolor' }, { color: true });
  const bw    = PB.radarPreview({ radarProvider: 'dwd', radarColor: 'multicolor' }, { color: false });
  assert.ok(color.indexOf(GREEN_BAND) >= 0, 'color watch keeps multicolor bands');
  assert.equal(bw.indexOf(GREEN_BAND), -1, 'B/W watch draws no color bands');
  assert.ok(bw.indexOf('fill="#FFFFFF"') >= 0, 'B/W watch draws white bars');
});
test('forecastPreview forces white rain bars on B/W even when setting says multicolor', () => {
  const state = { dayNightShading: true, barSource: 'rain', rainBarColor: 'multicolor', secondaryLine: 'off' };
  const color = PB.forecastPreview(state, { color: true });
  const bw    = PB.forecastPreview(state, { color: false });
  assert.ok(color.indexOf(GREEN_BAND) >= 0, 'color watch keeps multicolor rain bands');
  assert.equal(bw.indexOf(GREEN_BAND), -1, 'B/W watch draws no color rain bands');
});
test('devStats: table only, no clear button; empty when disabled', () => {
  const ds = PB.devStats({ devStatsEnabled: true }, {}, { devStats: JSON.stringify([{ t: Date.now(), k: 'weather', ok: 1, c: { forecast: 1 } }]) });
  assert.ok(ds.indexOf('Daily summary') >= 0);
  assert.equal(ds.indexOf('devStatsClearBtn'), -1, 'no live Clear button (now a toggle)');
  assert.equal(PB.devStats({ devStatsEnabled: false }, {}, { devStats: '[]' }), '');
});
test('lastFetch formats success / Never / failed-attempt-with-error', () => {
  const lf = PB.lastFetch({}, {}, { lastFetchSuccess: JSON.stringify({ time: Date.now(), name: 'Berlin' }), lastFetchAttempt: null });
  assert.ok(lf.indexOf('Berlin') >= 0);
  assert.ok(PB.lastFetch({}, {}, {}).indexOf('Never') >= 0);
  // failed attempt newer than last success -> shows the attempt + error stage:code (inject.js:321-332)
  const failed = PB.lastFetch({}, {}, {
    lastFetchSuccess: JSON.stringify({ time: 1000, name: 'Berlin' }),
    lastFetchAttempt: JSON.stringify({ time: Date.now(), name: 'Berlin', error: { stage: 'geocode', code: 401 } })
  });
  assert.ok(failed.indexOf('geocode') >= 0 && failed.indexOf('401') >= 0, 'shows error stage:code');
});
test('forecastPreview draws the secondary line per metric (solid, per-metric color)', () => {
  const base = { dayNightShading: false, barSource: 'off', windScale: 'mid', thirdLine: 'off' };
  assert.ok(PB.forecastPreview(Object.assign({}, base, { secondaryLine: 'wind' }), { color: true }).indexOf('stroke="#FFFF00"') > -1, 'wind = yellow');
  assert.ok(PB.forecastPreview(Object.assign({}, base, { secondaryLine: 'gust' }), { color: true }).indexOf('stroke="#FFFFFF"') > -1, 'gust = white');
  assert.ok(PB.forecastPreview(Object.assign({}, base, { secondaryLine: 'uv' }), { color: true }).indexOf('stroke="#FF00FF"') > -1, 'uv = magenta');
});

test('forecastPreview draws feels-like grey, and the hi/lo labels stay the ACTUAL temps', () => {
  const base = { dayNightShading: false, barSource: 'off', windScale: 'mid', thirdLine: 'off', secondaryLineFill: false };
  const svg = PB.forecastPreview(Object.assign({}, base, { secondaryLine: 'feels' }), { color: true });
  assert.ok(svg.indexOf('stroke="#AAAAAA"') > -1, 'feels = light grey line (dark theme)');
  // The feels sample dips to 11° under the 14° temp min. The SCALING band widens (and
  // pads) to fit it, but the labels name the air temperature — the watch prints
  // TEMP_MIN/TEMP_MAX as text, so a low the air never reached would be a lie.
  assert.ok(svg.indexOf('>14°<') > -1, 'lo label stays the actual temperature low');
  assert.equal(svg.indexOf('>11°<'), -1, 'the feels minimum is never labelled');
  assert.ok(svg.indexOf('>Feels<') > -1, 'legend lists the feels series');
  const plain = PB.forecastPreview(Object.assign({}, base, { secondaryLine: 'precip_prob' }), { color: true });
  assert.ok(plain.indexOf('>14°<') > -1, 'and they are the same labels without feels');
  // Light theme darkens the grey (LightGray is illegible on white); B&W goes white.
  const light = PB.forecastPreview(Object.assign({}, base, { secondaryLine: 'feels', theme: 'light' }), { color: true });
  assert.ok(light.indexOf('stroke="#000000"') > -1,
    'light theme: black stroke — a grey is invisible at 1px on white, and DarkGray is '
    + 'what the white-bar mode paints its bars in a light theme');
  const bw = PB.forecastPreview(Object.assign({}, base, { secondaryLine: 'feels' }), { color: false });
  assert.ok(bw.indexOf('stroke="#FFFFFF"') > -1, 'B&W: white stroke');
});

test('feels-like as the second metric draws grey squares, labels still the actual temps', () => {
  const svg = PB.forecastPreview({ dayNightShading: false, barSource: 'off', windScale: 'mid', secondaryLine: 'precip_prob', thirdLine: 'feels', secondaryLineFill: false }, { color: true });
  assert.ok(svg.indexOf('<rect') > -1 && svg.indexOf('fill="#AAAAAA"') > -1,
    'feels renders as filled grey squares');
  assert.ok(svg.indexOf('>14°<') > -1, 'lo label unchanged by the second line too');
  assert.equal(svg.indexOf('>11°<'), -1);
});

test('the preview keeps the feels curve clear of the plot floor (band padding)', () => {
  // Mirrors forecast-series.padJointBandForFeels. The sample feels series dips to 11°
  // under a 14° temp low, so the joint band [11, 24] is padded below by
  // max(1, ceil(13 * 40/960)) = 1 -> [10, 24]. That leaves the grey curve's lowest
  // point one band-degree above ybot instead of sitting flat on it.
  //
  // ybot = 89.0 in preview units, so an UNPADDED band would put the feels minimum at
  // exactly 89.0; the padded band puts it at 83.9. The assertion is tight on purpose:
  // a loose "is it on the plot" bound would pass either way and pin nothing.
  const svg = PB.forecastPreview({ dayNightShading: false, barSource: 'off', windScale: 'mid',
    secondaryLine: 'feels', thirdLine: 'off', secondaryLineFill: false }, { color: true });
  const m = /<path d="([^"]+)" fill="none" stroke="#AAAAAA"/.exec(svg);
  assert.ok(m, 'feels curve path found');
  const ys = m[1].match(/[\d.]+(?=[,\s]|$)/g).filter((_, i) => i % 2 === 1).map(Number);
  const lowest = Math.max.apply(null, ys);   // SVG y grows downward
  assert.ok(Math.abs(lowest - 83.9) < 0.5,
    'feels bottom should sit at ~83.9 (padded); 89.0 would mean the padding was lost. Got ' + lowest);
});

// The temp curve is the only #FF0000 stroke in the color preview; its path starts at
// the first tick (x=20) with temps[0]=24=tmax, i.e. exactly at the temp band's top —
// so this y IS ytop = PT+3 + the scaled curve inset (12/7 preview units per watch px).
function tempCurveTopY(svg) {
  const m = /<path d="M20,([\d.]+)[^"]*" fill="none" stroke="#FF0000"/.exec(svg);
  assert.ok(m, 'temp curve path found');
  return Number(m[1]);
}
const CURVE_BASE = { dayNightShading: false, barSource: 'off', windScale: 'mid', thirdLine: 'off', secondaryLine: 'precip_prob', secondaryLineFill: false };

test('forecastPreview: the temp curve keeps the fixed 7 px margin (12 preview units)', () => {
  const svg = PB.forecastPreview(Object.assign({}, CURVE_BASE), { color: true });
  // The inset is not configurable: temp always draws with the watch's fixed
  // 7 px inset, which the preview scales to 12 units (PT+3+12 = 19).
  assert.equal(tempCurveTopY(svg), 19, 'the fixed 7 px look');
});

test('forecastPreview: the feels curve rides the temp axis (same fixed margin)', () => {
  const svg = PB.forecastPreview(Object.assign({}, CURVE_BASE, { secondaryLine: 'feels' }), { color: true });
  const m = /<path d="([^"]+)" fill="none" stroke="#AAAAAA"/.exec(svg);
  assert.ok(m, 'feels curve path found');
  // Same band and same inset as the temp curve: temp's top stays at the fixed
  // margin with feels selected.
  assert.equal(tempCurveTopY(svg), 19);
});

// Feels-like has no meaningful zero to fill down to (it rides the temp∪feels band),
// so the fill toggle is hidden for it, the 'forecastMetricFill' hook clears the stored
// value, and both the bake (forecast-series) and this preview force it off regardless.
test('forecastPreview: feels-like draws no area fill even with secondaryLineFill true', () => {
  const feels = PB.forecastPreview(
    Object.assign({}, CURVE_BASE, { secondaryLine: 'feels', secondaryLineFill: true }), { color: true });
  assert.ok(/stroke="#AAAAAA"/.test(feels), 'the feels curve itself still renders');
  assert.equal(/fill-opacity="0.25"/.test(feels), false, 'no filled area under the feels curve');
  // Control: the same settings with a normal metric DO produce the fill, so the
  // assertion above is about feels and not about the fixture being fill-less.
  const precip = PB.forecastPreview(
    Object.assign({}, CURVE_BASE, { secondaryLine: 'precip_prob', secondaryLineFill: true }), { color: true });
  assert.ok(/fill-opacity="0.25"/.test(precip), 'precip still fills');
});

test('forecastMetricFill hook clears the stored fill when feels-like is picked', () => {
  const fn = PConf.onChange.get('forecastMetricFill');
  assert.equal(typeof fn, 'function', 'hook registered');
  const S = { secondaryLine: 'feels', secondaryLineFill: true };
  fn(S, 'precip_prob', 'feels', {}, 'secondaryLine');
  assert.equal(S.secondaryLineFill, false, 'picking feels clears the fill');
  // Switching to another metric leaves the toggle where the user left it.
  const T = { secondaryLine: 'wind', secondaryLineFill: true };
  fn(T, 'feels', 'wind', {}, 'secondaryLine');
  assert.equal(T.secondaryLineFill, true, 'other metrics keep the stored preference');
});

test('forecastPreview draws the second metric as bar-aligned squares in its metric color, gated on thirdLine', () => {
  const base = { dayNightShading: false, barSource: 'off', windScale: 'mid', secondaryLine: 'precip_prob' };
  // uv = #FF00FF is unique to the second-metric squares (not used by text/background/bars).
  const withThird = PB.forecastPreview(Object.assign({}, base, { thirdLine: 'uv' }), { color: true });
  const noThird   = PB.forecastPreview(Object.assign({}, base, { thirdLine: 'off' }), { color: true });
  assert.ok(withThird.indexOf('<rect') > -1 && withThird.indexOf('fill="#FF00FF"') > -1,
    'second metric (uv) renders as filled magenta squares');
  assert.equal(withThird.indexOf('stroke-dasharray'), -1, 'no dotted-line styling anymore');
  assert.equal(noThird.indexOf('fill="#FF00FF"'), -1, 'no second-metric squares when it is off');
});

test('forecastPreview gust dots take a color distinct from the rain bars', () => {
  // barSource off isolates the dot color (#AAAAAA is also a multicolor bar band when bars are on).
  const base = { dayNightShading: false, barSource: 'off', windScale: 'mid', secondaryLine: 'precip_prob', thirdLine: 'gust' };
  const whiteBars = PB.forecastPreview(Object.assign({}, base, { rainBarColor: 'white' }), { color: true });
  const multiBars = PB.forecastPreview(Object.assign({}, base, { rainBarColor: 'multicolor' }), { color: true });
  assert.ok(whiteBars.indexOf('fill="#AAAAAA"') > -1, 'white bars → light gray gust dots');
  assert.equal(multiBars.indexOf('fill="#AAAAAA"'), -1, 'multicolor bars → white gust dots (not gray)');
});

test('forecastPreview never draws the second metric as the same metric as the main', () => {
  // duplicate metric → no second-metric squares; wind = #FFFF00 is only a fill for those squares.
  const svg = PB.forecastPreview({ dayNightShading: false, barSource: 'off', windScale: 'mid', secondaryLine: 'wind', thirdLine: 'wind' }, { color: true });
  assert.equal(svg.indexOf('fill="#FFFF00"'), -1, 'duplicate metric → no second-metric squares');
});
test('registers all preview/util blocks into PConf.blocks', () => {
  ['forecastPreview','radarPreview','layoutPreviewCombined','devStats','lastFetch'].forEach((id) => assert.equal(typeof PConf.blocks.get(id), 'function'));
});

test('registers the statusSlot options resolver into PConf.optionsResolvers', () => {
  assert.equal(typeof PConf.optionsResolvers.get('statusSlot'), 'function');
});

test('layoutPresetOptions resolver: compactDense offered once health OR radar shows a status row', () => {
  const resolver = global.PConf.optionsResolvers.get('layoutPresetOptions');
  assert.equal(typeof resolver, 'function', 'resolver registered');
  const codes = (S) => resolver(S).map((o) => o[1]);
  assert.deepEqual(codes({ healthMode: 'off', radarMode: 'off' }), ['fullCal', 'compactCal', 'noCal'],
    'compactDense hidden when neither health nor radar shows a status row');
  assert.ok(codes({ healthMode: 'status', radarMode: 'off' }).indexOf('compactDense') >= 0, 'health=status offers compactDense');
  assert.ok(codes({ healthMode: 'all', radarMode: 'off' }).indexOf('compactDense') >= 0, 'health=all offers compactDense');
  assert.ok(codes({ healthMode: 'off', radarMode: 'status' }).indexOf('compactDense') >= 0, 'radar=status offers compactDense');
  // radar=graph builds dense radar cycles too (CAL2_RF_D default + CAL2_HR_D flick),
  // so the option must be reachable from it — it was not, and that hid the preset
  // for health-off + radar="Status + Graph" users (reported on-watch).
  assert.ok(codes({ healthMode: 'off', radarMode: 'graph' }).indexOf('compactDense') >= 0, 'radar=graph offers compactDense');
});

test('blocks fallback palette equals buildPreviewPalette (no color drift)', () => {
  const { buildPreviewPalette } = require('../src/pkjs/settings/preview-palette.js');
  assert.deepEqual(PB.previewPaletteFallback, buildPreviewPalette());
});

test('blocks barPermille matches rain-tier.rainPermille byte-for-byte', () => {
  const rt = require('../src/pkjs/weather/rain-tier.js');
  [0, 1, 2, 3, 5, 6, 20, 21, 50, 100, 101, 200, 255, 500, 1000].forEach((t) =>
    assert.equal(PB.barPermille(t), rt.rainPermille(t), 'tenths=' + t));
});

test('the second metric (dots) spans the full plot width (no early stop)', () => {
  const svg = PB.forecastPreview(
    { barSource: 'off', secondaryLine: 'precip_prob', thirdLine: 'gust', windScale: 'mid', dayNightShading: false },
    { color: true });
  const xs = (svg.match(/<rect x="([\d.]+)"/g) || []).map((m) => parseFloat(m.replace(/[^\d.]/g, '')));
  assert.ok(Math.max.apply(null, xs) > 180, 'a dot reaches the right edge (>180); got ' + Math.max.apply(null, xs));
});

test('UV line is continuous through zeros (single path that reaches the baseline)', () => {
  const svg = PB.forecastPreview(
    { barSource: 'off', secondaryLine: 'uv', windScale: 'mid', dayNightShading: false },
    { color: true });
  const segs = svg.match(/fill="none" stroke="#FF00FF"/g) || [];
  assert.equal(segs.length, 1, 'UV renders as one continuous path (no break at zero); got ' + segs.length);
  const m = svg.match(/d="(M[^"]+)" fill="none" stroke="#FF00FF"/);
  assert.ok(m, 'UV path present');
  assert.ok(m[1].indexOf(',100 ') >= 0, 'UV path touches the baseline (y=100) across its zero stretch');
});

test('forecastPreview honors rainBarColor=white in color mode (solid white bars, no tier bands)', () => {
  const base = { dayNightShading: false, barSource: 'rain', secondaryLine: 'off', windScale: 'mid' };
  const white = PB.forecastPreview(Object.assign({}, base, { rainBarColor: 'white' }), { color: true });
  const multi = PB.forecastPreview(Object.assign({}, base, { rainBarColor: 'multicolor' }), { color: true });
  // Rain-bar bands are width-9 rects; the legend gradient uses width-2.4, so scope to width="9".
  assert.ok(/width="9"[^>]*fill="#00FF00"/.test(multi), 'multicolor: a green tier band on a bar');
  assert.ok(!/width="9"[^>]*fill="#00FF00"/.test(white), 'white: no green tier band on a bar');
  assert.ok(/width="9"[^>]*fill="#FFFFFF"/.test(white), 'white: a solid white bar');
});

test('forecast grid: temp line spans the first tick to the last tick (edge to edge)', () => {
  const svg = PB.forecastPreview(
    { dayNightShading: false, barSource: 'off', secondaryLine: 'off', windScale: 'mid' },
    { color: true });
  const m = svg.match(/d="(M[^"]+)" fill="none" stroke="#FF0000"/);
  assert.ok(m, 'temp curve present');
  const d = m[1];
  assert.equal(d.indexOf('M20,'), 0, 'temp line starts on the first tick (PX0=20); got ' + d.slice(0, 14));
  const tokens = d.replace(/[MC]/g, ' ').trim().split(/\s+/);
  const lastX = parseFloat(tokens[tokens.length - 1].split(',')[0]);
  assert.equal(lastX, 197, 'temp line ends on the last tick (PX1=197); got ' + lastX);
});

test('forecast grid: rain bars sit centered in the hour gaps between ticks', () => {
  const svg = PB.forecastPreview(
    { dayNightShading: false, barSource: 'rain', rainBarColor: 'multicolor', secondaryLine: 'off', windScale: 'mid' },
    { color: true });
  const PX0 = 20, PX1 = 197, N = 12, pitch = (PX1 - PX0) / (N - 1), bw = 9;
  const lefts = (svg.match(/<rect x="[\d.]+" y="[\d.]+" width="9"/g) || [])
    .map((s) => parseFloat(s.match(/x="([\d.]+)"/)[1]));
  const xs = [...new Set(lefts)];
  assert.ok(xs.length >= 3, 'several rain bars present; got ' + xs.length);
  xs.forEach((x) => {
    const k = (x + bw / 2 - PX0) / pitch - 0.5;   // bar centre, expressed as a gap index
    assert.ok(Math.abs(k - Math.round(k)) < 1e-6, 'bar centred in an hour gap (gap index=' + k + ')');
  });
});

test('legend rain glyph follows white bars (white swatch, no tier gradient) when rainBarColor=white', () => {
  const svg = PB.forecastPreview(
    { barSource: 'rain', rainBarColor: 'white', secondaryLine: 'off', windScale: 'mid', dayNightShading: false },
    { color: true });
  assert.ok(svg.indexOf('>Rain<') >= 0, 'Rain legend present');
  assert.equal(svg.indexOf('width="2.4"'), -1, 'no tier-gradient swatches in the legend when bars are white');
  assert.ok(/width="12"[^>]*fill="#FFFFFF"/.test(svg), 'a solid white Rain swatch instead');
});

test('forecastPreview has no status bar (no location, sunset, or current-temp pill)', () => {
  const svg = PB.forecastPreview(
    { dayNightShading: false, barSource: 'off', secondaryLine: 'off', windScale: 'mid' },
    { color: true });
  assert.equal(svg.indexOf('Berlin'), -1, 'no location label');
  assert.equal(svg.indexOf('21:29'), -1, 'no sunset time');
  assert.equal(svg.indexOf('>22°<'), -1, 'no current-temp pill');
});

test('B&W: series are white, temp thick (3) vs main thin (1), no hues', () => {
  const bw = PB.forecastPreview(
    { barSource: 'rain', rainBarColor: 'multicolor', secondaryLine: 'wind', windScale: 'mid', dayNightShading: false },
    { color: false });
  assert.equal(bw.indexOf('fill="#00FF00"'), -1, 'no color rain bands on B&W');
  assert.equal(bw.indexOf('#FFFF00'), -1, 'wind hue not used on B&W (white instead)');
  assert.ok(bw.indexOf('stroke-width="3"') >= 0, 'temp curve thick (3)');
  assert.ok(bw.indexOf('stroke-width="1"') >= 0, 'main line thin (1)');
});

test('legend lists the shown series with palette colors (color watch)', () => {
  const svg = PB.forecastPreview(
    { barSource: 'rain', rainBarColor: 'multicolor', secondaryLine: 'precip_prob', thirdLine: 'wind', windScale: 'mid', dayNightShading: false },
    { color: true });
  assert.ok(svg.indexOf('viewBox="0 0 200 124"') >= 0, 'compact frame');
  assert.ok(svg.indexOf('>Temp<') >= 0, 'Temp entry');
  assert.ok(svg.indexOf('>Precip %<') >= 0, 'main metric entry (Precip %)');
  assert.ok(svg.indexOf('>Wind<') >= 0, 'second metric entry (Wind)');
  assert.ok(svg.indexOf('>Rain<') >= 0, 'Rain entry (bars on)');
});

test('legend omits the second metric when thirdLine is off, and Rain when bars are off', () => {
  const svg = PB.forecastPreview(
    { barSource: 'off', secondaryLine: 'uv', thirdLine: 'off', windScale: 'mid', dayNightShading: false },
    { color: true });
  assert.ok(svg.indexOf('>UV<') >= 0, 'main metric entry (UV)');
  assert.equal(svg.indexOf('>Rain<'), -1, 'no Rain entry when bars are off');
});

test('legend uses white style glyphs on B&W (no hues)', () => {
  const svg = PB.forecastPreview(
    { barSource: 'rain', rainBarColor: 'multicolor', secondaryLine: 'wind', thirdLine: 'off', windScale: 'mid', dayNightShading: false },
    { color: false });
  assert.ok(svg.indexOf('>Temp<') >= 0 && svg.indexOf('>Wind<') >= 0 && svg.indexOf('>Rain<') >= 0);
  assert.equal(svg.indexOf('#FFFF00'), -1, 'no wind hue in the B&W legend');
});

test('legend shows the second metric as white dots on B&W (no hue)', () => {
  const svg = PB.forecastPreview(
    { barSource: 'off', secondaryLine: 'wind', thirdLine: 'gust', windScale: 'mid', dayNightShading: false },
    { color: false });
  assert.ok(svg.indexOf('>Gust<') >= 0, 'second-metric legend entry (Gust) present');
  assert.ok(svg.indexOf('fill="#FFFFFF"') >= 0, 'second metric renders as white squares on B&W');
  assert.equal(svg.indexOf('#AAAAAA'), -1, 'no gust gray hue on B&W (white instead)');
});

test('radarPreview legend distinguishes exact-spot rain from nearby rain', () => {
  const color = PB.radarPreview({ radarProvider: 'dwd', radarColor: 'multicolor' }, { color: true });
  const bw = PB.radarPreview({ radarProvider: 'dwd', radarColor: 'multicolor' }, { color: false });
  assert.ok(color.indexOf('viewBox="0 0 200 138"') >= 0, 'frame includes the countdown band, which now always accompanies a non-off, non-aplite preview');
  assert.ok(color.indexOf('>Rain at your exact spot<') >= 0, 'exact-spot label present');
  assert.ok(color.indexOf('>Nearby (2 km)<') >= 0, 'nearby label present');
  assert.ok(color.indexOf('fill="#00FF00"') >= 0, 'tier gradient (green) present on color');
  assert.ok(/<rect[^>]*fill="none"[^>]*stroke="#8A8F98"/.test(color), 'hollow grey nearby box present');
  assert.ok(bw.indexOf('>Rain at your exact spot<') >= 0 && bw.indexOf('>Nearby (2 km)<') >= 0, 'both labels on B&W too');
  assert.ok(/<rect[^>]*fill="none"[^>]*stroke="#8A8F98"/.test(bw), 'hollow grey nearby box on B&W too');
});

test('radarPreview shows the countdown band ("Rain in 15\'") when the countdown is on', () => {
  const svg = PB.radarPreview({ radarProvider: 'dwd', radarColor: 'multicolor', rainCountdownHorizon: '60' }, { color: true });
  assert.ok(svg.indexOf("Rain in 15'") >= 0, 'countdown text present');
  assert.ok(svg.indexOf('viewBox="0 0 200 138"') >= 0, 'frame grew by the 20px band height');
});

// rainCountdownHorizon no longer has an Off option — a stray/legacy '0' value must not
// suppress the band (the only remaining gates are radarMode==='off' and aplite).
test('radarPreview always shows the countdown band once radar is on, regardless of rainCountdownHorizon', () => {
  const svg = PB.radarPreview({ radarProvider: 'dwd', radarColor: 'multicolor', rainCountdownHorizon: '0' }, { color: true });
  assert.ok(svg.indexOf("Rain in 15'") >= 0, 'countdown text present despite a legacy rainCountdownHorizon of 0');
  assert.ok(svg.indexOf('viewBox="0 0 200 138"') >= 0, 'frame grew by the band height');
});

test('radarPreview never shows the countdown band on aplite', () => {
  const svg = PB.radarPreview({ radarProvider: 'dwd', radarColor: 'multicolor', rainCountdownHorizon: '60' }, { color: false, platform: 'aplite' });
  assert.equal(svg.indexOf("Rain in 15'"), -1, 'no band on aplite even with a horizon set');
  assert.ok(svg.indexOf('viewBox="0 0 200 118"') >= 0, 'aplite frame stays at the no-band height');
});

test('countdown glyph is tier-coloured on color, white on B&W; text stays white', () => {
  const color = PB.radarPreview({ radarProvider: 'dwd', radarColor: 'multicolor', rainCountdownHorizon: '60' }, { color: true });
  const bw = PB.radarPreview({ radarProvider: 'dwd', radarColor: 'multicolor', rainCountdownHorizon: '60' }, { color: false });
  assert.ok(/stroke="#00FF00"/.test(color), 'glyph uses the green tier stroke on color');
  assert.equal(/stroke="#00FF00"/.test(bw), false, 'no green glyph stroke on B&W');
  assert.ok(color.indexOf('fill="#FFFFFF"') >= 0, 'white band text present on color');
});

test('precip secondary line draws the cobalt fill on color and a dither on B&W', () => {
  const base = { barSource: 'off', secondaryLine: 'precip_prob', secondaryLineFill: true, windScale: 'mid', dayNightShading: false };
  const color = PB.forecastPreview(base, { color: true });
  assert.ok(color.indexOf('fill="#0055AA"') >= 0 && color.indexOf('fill-opacity="0.25"') >= 0,
    'color: translucent cobalt precip fill present');
  const bw = PB.forecastPreview(base, { color: false });
  assert.ok(bw.indexOf('fill="url(#fillhatch)"') >= 0, 'B&W: precip fill uses the dither stipple pattern');
  assert.equal(bw.indexOf('fill="#0055AA"'), -1, 'B&W: no solid cobalt fill');
});

test('area fill works for every main metric, in its palette fill color', () => {
  // Fill colors are sourced from forecast-series.FILL_COLORS: wind=ArmyGreen, gust=DarkGray, uv=Purple.
  const base = { barSource: 'off', windScale: 'mid', dayNightShading: false };
  const wind = PB.forecastPreview(Object.assign({}, base, { secondaryLine: 'wind', secondaryLineFill: true }), { color: true });
  const gust = PB.forecastPreview(Object.assign({}, base, { secondaryLine: 'gust', secondaryLineFill: true }), { color: true });
  const uv = PB.forecastPreview(Object.assign({}, base, { secondaryLine: 'uv', secondaryLineFill: true }), { color: true });
  assert.ok(wind.indexOf('fill="#555500"') >= 0, 'wind fill = ArmyGreen');
  assert.ok(gust.indexOf('fill="#555555"') >= 0, 'gust fill = DarkGray');
  assert.ok(uv.indexOf('fill="#AA00AA"') >= 0, 'uv fill = Purple');
  const off = PB.forecastPreview(Object.assign({}, base, { secondaryLine: 'wind', secondaryLineFill: false }), { color: true });
  assert.equal(off.indexOf('fill="#555500"'), -1, 'no fill when the toggle is off');
});

test('area fill uses the brighter light-theme variant when theme is light', () => {
  const base = { barSource: 'off', windScale: 'mid', dayNightShading: false, theme: 'light' };
  const wind = PB.forecastPreview(Object.assign({}, base, { secondaryLine: 'wind', secondaryLineFill: true }), { color: true });
  const uv = PB.forecastPreview(Object.assign({}, base, { secondaryLine: 'uv', secondaryLineFill: true }), { color: true });
  assert.ok(wind.indexOf('fill="#AAFF55"') >= 0, 'wind light fill = Inchworm');
  assert.equal(wind.indexOf('fill="#555500"'), -1, 'not the dark-theme ArmyGreen fill');
  assert.ok(uv.indexOf('fill="#FF55FF"') >= 0, 'uv light fill = ShockingPink');
});

test('precip line + fill go one step darker in the light theme (readability round)', () => {
  const base = { barSource: 'off', windScale: 'mid', dayNightShading: false, secondaryLine: 'precip_prob', theme: 'light' };
  const line = PB.forecastPreview(base, { color: true });
  assert.ok(line.indexOf('stroke="#00AAFF"') >= 0, 'precip light line = VividCerulean');
  assert.equal(line.indexOf('stroke="#55AAFF"'), -1, 'not the dark-theme PictonBlue line');
  const filled = PB.forecastPreview(Object.assign({}, base, { secondaryLineFill: true }), { color: true });
  assert.ok(filled.indexOf('fill="#55FFFF"') >= 0, 'precip light fill = ElectricBlue (one step darker than Celeste)');
  assert.equal(filled.indexOf('fill="#AAFFFF"'), -1, 'not the pre-fix Celeste fill');
});

test('presetContents resolves each named preset directly (layoutPreset set)', () => {
    const vc = require('../src/pkjs/view-cycle.js');
    assert.deepEqual(PB.presetContents({ layoutPreset: 'fullCal', healthMode: 'off', radarMode: 'off' }),
        [vc.spec(vc.TIER_FULL, vc.TOP_CAL, vc.BODY_FC, vc.STATUS_SRC_FORECAST, vc.STATUS_SRC_NONE)]);
    assert.deepEqual(PB.presetContents({ layoutPreset: 'compactCal', healthMode: 'off', radarMode: 'off' }),
        [vc.spec(vc.TIER_COMPACT, vc.TOP_CAL, vc.BODY_FC, vc.STATUS_SRC_FORECAST, vc.STATUS_SRC_NONE)]);
    assert.deepEqual(PB.presetContents({ layoutPreset: 'compactDense', healthMode: 'off', radarMode: 'off' }),
        [vc.spec(vc.TIER_COMPACT, vc.TOP_CAL, vc.BODY_FC, vc.STATUS_SRC_FORECAST, vc.STATUS_SRC_NONE)]);
    assert.deepEqual(PB.presetContents({ layoutPreset: 'noCal', healthMode: 'off', radarMode: 'off' }),
        [vc.spec(vc.TIER_NONE, vc.TOP_EMPTY, vc.BODY_FC, vc.STATUS_SRC_FORECAST, vc.STATUS_SRC_NONE)]);
});

test('presetContents falls back to compactCal for an unrecognised preset key', () => {
    assert.deepEqual(PB.presetContents({ layoutPreset: 'bogus', healthMode: 'off', radarMode: 'off' }),
        PB.presetContents({ layoutPreset: 'compactCal', healthMode: 'off', radarMode: 'off' }));
});

test('presetContents migrates legacy layoutPreset/topViewMode settings via view-cycle.js', () => {
    // classic/radarLast/healthFirst -> compactCal; forecast -> noCal; fullCal unchanged.
    const compactCal = PB.presetContents({ layoutPreset: 'compactCal', healthMode: 'off', radarMode: 'off' });
    assert.deepEqual(PB.presetContents({ layoutPreset: 'classic', healthMode: 'off', radarMode: 'off' }), compactCal);
    assert.deepEqual(PB.presetContents({ layoutPreset: 'radarLast', healthMode: 'off', radarMode: 'off' }), compactCal);
    assert.deepEqual(PB.presetContents({ layoutPreset: 'healthFirst', healthMode: 'off', radarMode: 'off' }), compactCal);
    assert.deepEqual(PB.presetContents({ layoutPreset: 'forecast', healthMode: 'off', radarMode: 'off' }),
        PB.presetContents({ layoutPreset: 'noCal', healthMode: 'off', radarMode: 'off' }));
    assert.deepEqual(PB.presetContents({ topViewMode: 'full', healthMode: 'off', radarMode: 'off' }),
        PB.presetContents({ layoutPreset: 'fullCal', healthMode: 'off', radarMode: 'off' }), 'topViewMode full -> fullCal');
    assert.deepEqual(PB.presetContents({ topViewMode: 'none', healthMode: 'off', radarMode: 'off' }),
        PB.presetContents({ layoutPreset: 'noCal', healthMode: 'off', radarMode: 'off' }), 'topViewMode none -> noCal');
    assert.deepEqual(PB.presetContents({ healthMode: 'off', radarMode: 'off' }), compactCal, 'nothing set -> compactCal');
});

test('presetContents reads healthMode/radarMode off state to grow/shrink the cycle', () => {
    assert.equal(PB.presetContents({ layoutPreset: 'compactCal', healthMode: 'off', radarMode: 'off' }).length, 1);
    assert.equal(PB.presetContents({ layoutPreset: 'compactCal', healthMode: 'off', radarMode: 'graph' }).length, 2, 'radar adds a slot');
    assert.equal(PB.presetContents({ layoutPreset: 'compactCal', healthMode: 'status', radarMode: 'off' }).length, 2, 'health status adds a slot');
    assert.equal(PB.presetContents({ layoutPreset: 'compactCal', healthMode: 'status', radarMode: 'graph' }).length, 3, 'both add up to three');
    // radarMode unset (not explicitly 'off') is treated as enabled (defaults to 'graph').
    assert.equal(PB.presetContents({ layoutPreset: 'compactCal', healthMode: 'off' }).length, 2, 'unset radarMode counts as enabled');
});

test('contentBands renders each tier\'s band ordering', () => {
    const vc = require('../src/pkjs/view-cycle.js');
    assert.deepEqual(PB.contentBands(vc.spec(vc.TIER_FULL, vc.TOP_CAL, vc.BODY_FC, vc.STATUS_SRC_FORECAST, vc.STATUS_SRC_NONE)).map((b) => b.label),
        ['Watch Status', 'Calendar (3 rows)', 'Clock', 'Forecast Status', 'Forecast'], 'full tier: clock before status');
    assert.deepEqual(PB.contentBands(vc.spec(vc.TIER_COMPACT, vc.TOP_CAL, vc.BODY_FC, vc.STATUS_SRC_HEALTH, vc.STATUS_SRC_NONE)).map((b) => b.label),
        ['Watch Status', 'Calendar (2 rows)', 'Health Status', 'Clock', 'Forecast'], 'compact tier: upper status before clock');
    assert.deepEqual(PB.contentBands(vc.spec(vc.TIER_COMPACT, vc.TOP_CAL, vc.BODY_FC, vc.STATUS_SRC_FORECAST, vc.STATUS_SRC_NONE)).map((b) => b.label),
        ['Watch Status', 'Calendar (2 rows)', 'Forecast Status', 'Clock', 'Forecast'], 'compact tier: forecast status before clock (single upper row)');
    assert.deepEqual(PB.contentBands(vc.spec(vc.TIER_NONE, vc.TOP_EMPTY, vc.BODY_RADAR, vc.STATUS_SRC_RADAR, vc.STATUS_SRC_NONE)).map((b) => b.label),
        ['Watch Status', 'Clock', 'Radar Status', 'Radar'], 'none tier: no top band, big body; radar view uses the Radar status bar');
    assert.deepEqual(PB.contentBands(vc.spec(vc.TIER_FULL, vc.TOP_RADAR, vc.BODY_FC, vc.STATUS_SRC_NONE, vc.STATUS_SRC_NONE)).map((b) => b.label),
        ['Watch Status', 'Radar', 'Clock', 'Forecast'], 'radar rides the top band; NONE/NONE hides both status rows');
    assert.strictEqual(PB.contentBands(null), null, 'a null/disabled slot has no bands');
});

// The configurable bar reads "Radar Status" whenever the RADAR source occupies that slot —
// a direct data-driven mapping (statusUpper/statusLower), not inferred from spec.top/spec.body
// (mirrors main_window.c's per-source layer assignment). A top-radar view with an explicit
// FORECAST status row is NOT auto-relabeled — that inference is gone from the new model.
test('contentBands labels the configurable bar "Radar Status" for a radar view', () => {
    const vc = require('../src/pkjs/view-cycle.js');
    const label = (spec) => PB.contentBands(spec).map((b) => b.label);
    // radar as the body (the radar-graph flick stop)
    assert.ok(label(vc.spec(vc.TIER_COMPACT, vc.TOP_CAL, vc.BODY_RADAR, vc.STATUS_SRC_RADAR, vc.STATUS_SRC_NONE)).indexOf('Radar Status') >= 0,
        'radar-body view reads Radar Status');
    assert.ok(label(vc.spec(vc.TIER_COMPACT, vc.TOP_CAL, vc.BODY_RADAR, vc.STATUS_SRC_RADAR, vc.STATUS_SRC_NONE)).indexOf('Forecast Status') < 0,
        'radar-body view has no Forecast Status label');
    // radar riding the top band with an explicit RADAR status row present
    assert.ok(label(vc.spec(vc.TIER_FULL, vc.TOP_RADAR, vc.BODY_FC, vc.STATUS_SRC_RADAR, vc.STATUS_SRC_NONE)).indexOf('Radar Status') >= 0,
        'top-radar view with a RADAR status row reads Radar Status');
    // top-radar with a FORECAST (not RADAR) status row is NOT relabeled — no top/body inference
    const topRadarForecastStatus = label(vc.spec(vc.TIER_FULL, vc.TOP_RADAR, vc.BODY_FC, vc.STATUS_SRC_FORECAST, vc.STATUS_SRC_NONE));
    assert.ok(topRadarForecastStatus.indexOf('Forecast Status') >= 0 && topRadarForecastStatus.indexOf('Radar Status') < 0,
        'top-radar view with an explicit FORECAST status row keeps Forecast Status (no inference from top)');
    // two rows on a radar view: RADAR upper + HEALTH lower — each label comes from its own slot
    const dual = label(vc.spec(vc.TIER_COMPACT, vc.TOP_CAL, vc.BODY_RADAR, vc.STATUS_SRC_HEALTH, vc.STATUS_SRC_RADAR));
    assert.ok(dual.indexOf('Radar Status') >= 0 && dual.indexOf('Health Status') >= 0,
        'two-row radar view: Radar Status + Health Status');
    // a plain forecast view still reads Forecast Status
    assert.ok(label(vc.spec(vc.TIER_COMPACT, vc.TOP_CAL, vc.BODY_FC, vc.STATUS_SRC_FORECAST, vc.STATUS_SRC_NONE)).indexOf('Forecast Status') >= 0,
        'forecast-body view keeps Forecast Status');
});

test('contentBands renders the health-dense pairing (upper=HEALTH, lower=FORECAST) as two status rows', () => {
    const vc = require('../src/pkjs/view-cycle.js');
    const bands = PB.contentBands(vc.spec(vc.TIER_COMPACT, vc.TOP_CAL, vc.BODY_FC, vc.STATUS_SRC_HEALTH, vc.STATUS_SRC_FORECAST));
    const labels = bands.map((b) => b.label);
    assert.ok(labels.indexOf('Health Status') >= 0 && labels.indexOf('Forecast Status') >= 0);
    assert.ok(labels.indexOf('Health Status') < labels.indexOf('Clock'), 'upper row (Health) rides above the clock');
    assert.ok(labels.indexOf('Clock') < labels.indexOf('Forecast Status'), 'lower row (Forecast) sits below the clock');
});

// A status bar occupies exactly the space freed by dropping the 3rd calendar row, so
// the compact calendar + its status band read as tall as the full 3-row calendar.
test('contentBands: Cal2 + gap + status = Cal3 (status = the freed calendar row)', () => {
    const vc = require('../src/pkjs/view-cycle.js');
    const GAP = 2; // renderers stack bands with a 2px gap
    const full = PB.contentBands(vc.spec(vc.TIER_FULL, vc.TOP_CAL, vc.BODY_FC, vc.STATUS_SRC_FORECAST, vc.STATUS_SRC_NONE));
    const compact = PB.contentBands(vc.spec(vc.TIER_COMPACT, vc.TOP_CAL, vc.BODY_FC, vc.STATUS_SRC_FORECAST, vc.STATUS_SRC_NONE));
    const cal3 = full.find((b) => b.label === 'Calendar (3 rows)').h;
    const cal2 = compact.find((b) => b.label === 'Calendar (2 rows)').h;
    const status = compact.find((b) => b.label === 'Forecast Status').h;
    assert.equal(cal2 + GAP + status, cal3, 'dropping the 3rd calendar row buys exactly one status line');
});

// The body (Forecast / Health graph / Radar) is the flex element: it absorbs whatever
// vertical space the fixed bands leave, so it always reaches the bottom of the frame.
test('contentBands: the body band is the flex element, all others fixed', () => {
    const vc = require('../src/pkjs/view-cycle.js');
    [vc.BODY_FC, vc.BODY_GRAPH, vc.BODY_RADAR].forEach((body) => {
        const bands = PB.contentBands(vc.spec(vc.TIER_COMPACT, vc.TOP_CAL, body, vc.STATUS_SRC_FORECAST, vc.STATUS_SRC_NONE));
        const last = bands[bands.length - 1];
        assert.equal(last.flex, true, 'the last (body) band is marked flex');
        bands.slice(0, -1).forEach((b) => assert.ok(!b.flex, b.label + ' is fixed-height'));
    });
});

test('presetContents: compactDense + radar=status folds radar into the single default (no flick)', () => {
    const c = PB.presetContents({ layoutPreset: 'compactDense', healthMode: 'off', radarMode: 'status' });
    assert.equal(c.length, 1);
    const labels = PB.contentBands(c[0]).map((b) => b.label);
    assert.ok(labels.indexOf('Radar Status') >= 0);
    assert.ok(labels.indexOf('Forecast Status') >= 0);
});

test('contentBands orders radar-upper above the clock and forecast-lower below', () => {
    const c = PB.presetContents({ layoutPreset: 'compactDense', healthMode: 'off', radarMode: 'status' });
    const labels = PB.contentBands(c[0]).map((b) => b.label);
    assert.ok(labels.indexOf('Radar Status') < labels.indexOf('Clock'));
    assert.ok(labels.indexOf('Clock') < labels.indexOf('Forecast Status'));
});

test('resolveBandHeights: the flex band absorbs the slack so bands + gaps fill availH', () => {
    const bands = [{ h: 12 }, { h: 20 }, { h: 20, flex: true }];
    const heights = PB.resolveBandHeights(bands, 100, 2);
    const total = heights.reduce((s, h) => s + h, 0) + (bands.length - 1) * 2;
    assert.equal(total, 100, 'bands + gaps exactly fill the available height');
    assert.equal(heights[2], 100 - 12 - 20 - 2 * 2, 'flex band = remaining space after fixed bands + gaps');
});

test('resolveBandHeights: the flex band never collapses below a visible minimum', () => {
    const heights = PB.resolveBandHeights([{ h: 90 }, { h: 20, flex: true }], 50, 2);
    assert.ok(heights[1] >= 12, 'flex band clamped to a visible minimum instead of going negative');
});

// radarMode 'status' packs the flick stop as BODY_RADAR_STATUS — the forecast body
// (chart suppressed) with the status line turned to radar, mirroring the watch.
// (The band labeling itself is pinned by the contentBands tests above.)
test('layoutPreviewCombined: radarMode "status" renders the flick column as Forecast + Radar Status', () => {
    const svg = PB.layoutPreviewCombined({ layoutPreset: 'compactCal', healthMode: 'off', radarMode: 'status' }, {}, {});
    assert.ok(svg.indexOf('>Forecast<') >= 0, 'radar-status flick body renders as Forecast');
    assert.ok(svg.indexOf('>Radar Status<') >= 0, 'status band reads Radar Status');
});

test('layoutPreviewCombined: one column per cycle slot, headers Default/Flick 1/Flick 2', () => {
    const one = PB.layoutPreviewCombined({ layoutPreset: 'compactCal', radarMode: 'off', healthMode: 'off' }, {}, {});
    assert.ok(one.indexOf('Default') >= 0, 'Default header present');
    assert.strictEqual(one.indexOf('Flick 1'), -1, 'no flick column for a single-slot cycle');

    const two = PB.layoutPreviewCombined({ layoutPreset: 'compactCal', radarMode: 'graph', healthMode: 'off' }, {}, {});
    assert.ok(two.indexOf('Default') >= 0 && two.indexOf('Flick 1') >= 0, 'Default + Flick 1 present');
    assert.ok(two.indexOf('Radar') >= 0, 'flick 1 column shows the Radar band');
    assert.strictEqual(two.indexOf('Flick 2'), -1, 'no third column for a two-slot cycle');

    const three = PB.layoutPreviewCombined({ layoutPreset: 'compactDense', radarMode: 'graph', healthMode: 'all' }, {}, {});
    assert.ok(three.indexOf('Default') >= 0 && three.indexOf('Flick 1') >= 0 && three.indexOf('Flick 2') >= 0,
        'all three column headers present for a three-slot cycle');
});

test('layoutPreviewCombined: toggling radar/health grows or shrinks the columns (no dimming, no notes)', () => {
    const radarOff = PB.layoutPreviewCombined({ layoutPreset: 'compactCal', radarMode: 'off', healthMode: 'off' }, {}, {});
    const radarOn = PB.layoutPreviewCombined({ layoutPreset: 'compactCal', radarMode: 'graph', healthMode: 'off' }, {}, {});
    assert.strictEqual(radarOff.indexOf('Radar'), -1, 'radar column absent when radar is disabled');
    assert.ok(radarOn.indexOf('Radar') >= 0, 'radar column present once radar is enabled');
    assert.strictEqual(radarOn.indexOf('needs radar'), -1, 'no availability note anywhere');

    const healthOff = PB.layoutPreviewCombined({ layoutPreset: 'compactCal', radarMode: 'off', healthMode: 'off' }, {}, {});
    const healthOn = PB.layoutPreviewCombined({ layoutPreset: 'compactCal', radarMode: 'off', healthMode: 'status' }, {}, {});
    assert.strictEqual(healthOff.indexOf('Health Status'), -1, 'health column absent when health is off');
    assert.ok(healthOn.indexOf('Health Status') >= 0, 'health column present once health is on');
    assert.strictEqual(healthOn.indexOf('needs health'), -1, 'no availability note anywhere');
});

test('layoutPreviewCombined: columns span the full window width, flush left (no side padding)', () => {
    const svg = PB.layoutPreviewCombined({ layoutPreset: 'compactCal', radarMode: 'graph', healthMode: 'off' }, {}, {});
    // Left (Default) column starts flush at x=0 (no black side padding inset).
    assert.ok(svg.indexOf('<rect x="0" y="16"') >= 0, 'left column band starts at x=0');
});

test('radarPreview (rainbow): no nearby outline bars and no "Nearby (2 km)" legend', () => {
  const dwd = PB.radarPreview({ radarProvider: 'dwd', radarColor: 'multicolor', rainCountdownHorizon: '0' }, { color: true });
  const rainbow = PB.radarPreview({ radarProvider: 'rainbow', radarColor: 'multicolor', rainCountdownHorizon: '0' }, { color: true });
  assert.ok(dwd.indexOf('>Nearby (2 km)<') >= 0, 'dwd keeps the nearby legend');
  assert.equal(rainbow.indexOf('>Nearby (2 km)<'), -1, 'rainbow drops the nearby legend');
  assert.ok(rainbow.indexOf('>Rain at your exact spot<') >= 0, 'exact-spot legend stays');
  assert.ok(dwd.indexOf('fill="none" stroke="rgba(255,255,255,0.30)"') >= 0, 'dwd draws hollow nearby bars');
  assert.equal(rainbow.indexOf('fill="none" stroke="rgba(255,255,255,0.30)"'), -1, 'rainbow draws no hollow nearby bars');
});

test('radarPreview (rainbow) still renders exact bars and the countdown band', () => {
  const svg = PB.radarPreview({ radarProvider: 'rainbow', radarColor: 'multicolor', rainCountdownHorizon: '60' }, { color: true });
  assert.ok(/^<svg/.test(svg), 'renders an SVG, not the off message');
  assert.ok(svg.indexOf("Rain in 15'") >= 0, 'countdown band applies to rainbow too');
});

test('forecastPreview: light theme flips the canvas background to white', () => {
  const state = { dayNightShading: true, barSource: 'rain', rainBarColor: 'multicolor', secondaryLine: 'off', theme: 'light' };
  const svg = PB.forecastPreview(state, { color: true });
  assert.ok(svg.indexOf('fill="#FFFFFF"') >= 0, 'canvas background is now white');
});

test('forecastPreview: bw theme on a color env renders the B&W path, not multicolor', () => {
  const state = { dayNightShading: true, barSource: 'rain', rainBarColor: 'multicolor', secondaryLine: 'off', theme: 'bw' };
  const color = PB.forecastPreview({ ...state, theme: 'dark' }, { color: true });
  const bw = PB.forecastPreview(state, { color: true });
  assert.ok(color.indexOf('fill="#00FF00"') >= 0, 'sanity: dark theme on a color env keeps multicolor bands');
  assert.equal(bw.indexOf('fill="#00FF00"'), -1, 'bw theme drops multicolor rain bands even though env.color is true');
});

test('forecastPreview: bw-light theme on a color env renders the B&W path with a white canvas (light polarity)', () => {
  const state = { dayNightShading: true, barSource: 'rain', rainBarColor: 'multicolor', secondaryLine: 'off', theme: 'bw-light' };
  const svg = PB.forecastPreview(state, { color: true });
  assert.equal(svg.indexOf('fill="#00FF00"'), -1, 'bw-light theme drops multicolor rain bands even though env.color is true');
  assert.ok(svg.indexOf('fill="#FFFFFF"') >= 0, 'canvas background is white (light polarity)');
});

test('radarPreview: light theme flips the canvas background to white', () => {
  const svg = PB.radarPreview({ radarProvider: 'dwd', radarColor: 'multicolor', theme: 'light' }, { color: true });
  assert.ok(svg.indexOf('width="200" height="118" fill="#FFFFFF"') >= 0);
});

// A bar drawn by rainBars() in outline mode is a <path fill="BG" stroke="FG"
// stroke-width="1">; a solid bar is a <rect ... fill="COLOR">. The watch's actual
// bw-theme bar (chart.c BAR_OUTLINED) is a theme_bg()-filled bar with a theme_fg()
// outline on top, opaque against whatever's behind it (e.g. a dithered area fill) —
// so the preview's outline path is filled with the polarity background (bg), not
// left transparent, matching that opacity; see the block comment above rainBars'
// `outline` param.
const OUTLINE_MARK = 'fill="#FFFFFF" stroke="#000000" stroke-width="1"';

test('radarPreview: bw theme on a color env outlines the exact bars in white, filled opaque black (not a solid white fill, not hollow)', () => {
  const svg = PB.radarPreview({ radarProvider: 'dwd', radarColor: 'multicolor', theme: 'bw' }, { color: true });
  assert.equal(svg.indexOf('fill="#00FF00"'), -1, 'no multicolor bands');
  assert.ok(svg.indexOf('fill="#000000" stroke="#FFFFFF" stroke-width="1"') >= 0,
    'exact bars are opaque black-filled with a white outline (mirrors the watch\'s theme_bg()-filled + theme_fg()-outlined bar)');
});

test('radarPreview: bw-light theme on a color env outlines the exact bars in black, filled opaque white (light polarity)', () => {
  const svg = PB.radarPreview({ radarProvider: 'dwd', radarColor: 'multicolor', theme: 'bw-light' }, { color: true });
  assert.equal(svg.indexOf('fill="#00FF00"'), -1, 'no multicolor bands');
  assert.ok(svg.indexOf('width="200" height="118" fill="#FFFFFF"') >= 0, 'canvas background is white');
  assert.ok(svg.indexOf(OUTLINE_MARK) >= 0,
    'exact bars are opaque white-filled with a black outline — the polarity mirror of bw, not a hollow box');
});

test('forecastPreview: bw/bw-light rain bars are opaque (filled with the polarity background), not hollow outlines', () => {
  const base = { barSource: 'rain', rainBarColor: 'multicolor', secondaryLine: 'off', windScale: 'mid', dayNightShading: false };
  const bw = PB.forecastPreview(Object.assign({}, base, { theme: 'bw' }), { color: true });
  assert.ok(bw.indexOf('fill="#000000" stroke="#FFFFFF" stroke-width="1"') >= 0,
    'bw rain bars are opaque black-filled with a white outline');
  const bwLight = PB.forecastPreview(Object.assign({}, base, { theme: 'bw-light' }), { color: true });
  assert.ok(bwLight.indexOf(OUTLINE_MARK) >= 0,
    'bw-light rain bars are opaque white-filled with a black outline');
});

test('forecastPreview: bw rain bars draw above (after) the dithered metric-area fill, matching the watch\'s z-order', () => {
  const state = {
    barSource: 'rain', rainBarColor: 'multicolor', windScale: 'mid', dayNightShading: false, theme: 'bw',
    secondaryLine: 'precip_prob', secondaryLineFill: true
  };
  const svg = PB.forecastPreview(state, { color: true });
  const fillIdx = svg.indexOf('fill="url(#fillhatch)"');
  const barIdx = svg.indexOf('fill="#000000" stroke="#FFFFFF" stroke-width="1"');
  assert.ok(fillIdx >= 0, 'the dithered metric-area fill is present');
  assert.ok(barIdx >= 0, 'an outlined rain bar is present');
  assert.ok(fillIdx < barIdx, 'the dithered area fill is drawn before the bars, so bars paint over it (watch z-order: AREA then BARS)');
});

test('radarPreview: radarColor=Solid in the light theme uses DarkGray, not black', () => {
  // platform: 'aplite' — the countdown band's own text is theme_fg() (black in light
  // polarity), unrelated to bar/legend fill; excluded here to isolate the bars. aplite is
  // the only remaining band gate now that the horizon has no Off option.
  const svg = PB.radarPreview({ radarProvider: 'dwd', radarColor: 'white', theme: 'light' }, { color: true, platform: 'aplite' });
  assert.ok(svg.indexOf('width="200" height="118" fill="#FFFFFF"') >= 0, 'canvas background is white');
  assert.ok(svg.indexOf('fill="#555555"') >= 0, 'solid bars/legend render DarkGray');
  assert.equal(svg.indexOf('fill="#000000"'), -1, 'never a plain black bar/legend fill in the light theme');
});

test('forecastPreview: rainBarColor=Solid in the light theme uses DarkGray, not black', () => {
  const state = { barSource: 'rain', rainBarColor: 'white', secondaryLine: 'off', windScale: 'mid', dayNightShading: false, theme: 'light' };
  const svg = PB.forecastPreview(state, { color: true });
  assert.ok(/width="9"[^>]*fill="#555555"/.test(svg), 'a DarkGray solid rain bar');
  assert.ok(/width="12"[^>]*fill="#555555"/.test(svg), 'the Rain legend swatch is DarkGray too');
  assert.equal(svg.indexOf('fill="#000000"'), -1, 'never a plain black fill in the light theme');
});

test('layoutPreviewCombined: light theme flips the canvas background to white', () => {
  const state = { layoutPreset: 'compactCal', healthMode: 'off', radarMode: 'off', theme: 'light' };
  assert.ok(PB.layoutPreviewCombined(state, {}).indexOf('fill="#FFFFFF"') >= 0);
});

test('layoutPreviewCombined: bw-light theme also flips the canvas background to white', () => {
  const state = { layoutPreset: 'compactCal', healthMode: 'off', radarMode: 'off', theme: 'bw-light' };
  assert.ok(PB.layoutPreviewCombined(state, {}).indexOf('fill="#FFFFFF"') >= 0);
});

// The band-stack chrome (renderBandColumn's band fill + empty-column placeholder)
// used to be a fixed dark hex regardless of theme, so a light canvas still showed
// dark "cards" floating on it. It now washes previewInk's rgba helper — the same
// theme-relative mechanism the other previews use for dividers/gridlines.
test('layoutPreviewCombined: light theme themes the band chrome too, not just the canvas', () => {
  const state = { layoutPreset: 'compactCal', healthMode: 'status', radarMode: 'graph', theme: 'light' };
  const combined = PB.layoutPreviewCombined(state, {});
  assert.equal(combined.indexOf('#1B1F27'), -1, 'band fill is no longer hardcoded dark');
  assert.equal(combined.indexOf('#12151C'), -1, 'placeholder fill is no longer hardcoded dark');
  assert.ok(combined.indexOf('rgba(0,0,0,0.12)') >= 0, 'band fill washes black-on-white in light theme');
});

test('layoutPreviewCombined: dark theme keeps the light-on-black band wash', () => {
  const state = { layoutPreset: 'compactCal', healthMode: 'status', radarMode: 'graph', theme: 'dark' };
  assert.ok(PB.layoutPreviewCombined(state, {}).indexOf('rgba(255,255,255,0.12)') >= 0);
});

test('radarPreview (metno): point provider renders like rainbow — no nearby bars or legend', () => {
  const metno = PB.radarPreview({ radarProvider: 'metno', radarColor: 'multicolor', rainCountdownHorizon: '0' }, { color: true });
  const rainbow = PB.radarPreview({ radarProvider: 'rainbow', radarColor: 'multicolor', rainCountdownHorizon: '0' }, { color: true });
  assert.equal(metno, rainbow, 'metno and rainbow share the point-provider preview');
  assert.equal(metno.indexOf('>Nearby (2 km)<'), -1, 'metno drops the nearby legend');
});

test('statusSlotDefault resolver: HR-aware slot default sourced from the catalog', () => {
  const fn = global.PConf.defaultsResolvers.get('statusSlotDefault');
  assert.equal(typeof fn, 'function', 'resolver registered');
  assert.equal(fn({ hr: true }, { slotKey: 'statusHealthRight' }), 'hr');
  assert.equal(fn({ hr: false }, { slotKey: 'statusHealthRight' }), 'sleep');
  assert.equal(fn({}, { slotKey: 'statusForecastRight' }), 'aqi');
  assert.equal(fn({}, { slotKey: 'statusTopLeft' }), 'week');
});

test('todayDate default resolver returns today in local YYYY-MM-DD form', () => {
  const fn = global.PConf.defaultsResolvers.get('todayDate');
  assert.equal(typeof fn, 'function');
  assert.match(fn(), /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(fn(), global.PConf.engine.formatDateValue(new Date()));
});

test('tomorrowioBudget block: empty without a tomorrow.io selection; states limits, usage and verdict', () => {
  const block = global.PConf.blocks.get('tomorrowioBudget');
  assert.equal(block(budgetState({ provider: 'dwd', radarProvider: 'disabled' }), {}), '');

  const ok = block(budgetState(), {});           // 17 active h * 12 * 2 = 408
  assert.match(ok, /500 calls\/day/);
  assert.match(ok, /25\/hour/);
  assert.match(ok, /408/);
  assert.match(ok, /✓/);

  const over = block(budgetState({ sleepNightEnabled: false }), {});  // 576
  assert.match(over, /576/);
  assert.match(over, /✗/);
});

test('tomorrowioBudget block never claims radar is off when radar runs on another provider', () => {
  const block = global.PConf.blocks.get('tomorrowioBudget');
  // Weather on tomorrow.io, radar on the default Rainbow provider (radar IS on,
  // just not billed to tomorrow.io): the summary must not say "radar off".
  const weatherOnly = block(budgetState({ radarProvider: 'rainbow' }), {});
  assert.doesNotMatch(weatherOnly, /radar off/i);
  assert.doesNotMatch(weatherOnly, /radar\b.*\bon\b/i, 'no blanket "radar on" claim either');
  // When tomorrow.io radar actually adds calls, say so explicitly.
  const withRadar = block(budgetState({ radarProvider: 'tomorrowio' }), {});
  assert.match(withRadar, /incl\. radar/);
});

test('tomorrowioBudget block does not nest a bordered .static row inside the .blockrow', () => {
  const block = global.PConf.blocks.get('tomorrowioBudget');
  // .static carries its own border-bottom + padding; nesting it inside the
  // engine's .blockrow wrapper paints a stray divider line. The block must
  // return bare content and let .blockrow be the sole container.
  assert.doesNotMatch(block(budgetState(), {}), /class="static"/);
});

test('tomorrowioBudget block derives the unlock rule and the hourly heads-up', () => {
  const block = global.PConf.blocks.get('tomorrowioBudget');
  // 5 min is locked at a 2 h pause -> rule names 5 minutes and >= 4 h
  const html = block(budgetState({ sleepEndHour: '2', fetchIntervalMin: '10' }), {});
  assert.match(html, /5-minute/);
  assert.match(html, /≥ 4 h/);
  // at 5 min + radar (24 of 25 calls/hour) the same-hour save note appears
  const busy = block(budgetState(), {});
  assert.match(busy, /may delay one cycle/);
  // at 10 min (12 calls/hour) the same-hour save note must not appear
  const quiet = block(budgetState({ fetchIntervalMin: '10' }), {});
  assert.doesNotMatch(quiet, /may delay one cycle/);
});

test('fetchIntervalBudget resolver: filters when guard on, passes through when off or not tomorrow.io', () => {
  const resolver = global.PConf.optionsResolvers.get('fetchIntervalBudget');
  assert.deepEqual(resolver(budgetState({ sleepNightEnabled: false }), {}, {}).map((o) => o[1]),
    ['10', '15', '30', '60']);
  assert.deepEqual(resolver(budgetState({ sleepNightEnabled: false, tomorrowioFitBudget: false }), {}, {}).map((o) => o[1]),
    ['5', '10', '15', '30', '60']);
  assert.deepEqual(resolver(budgetState({ provider: 'dwd', radarProvider: 'disabled', sleepNightEnabled: false }), {}, {}).map((o) => o[1]),
    ['5', '10', '15', '30', '60']);
});

test('recommend resolvers: country-matched weather + radar providers (DE→dwd, Nordics→metno, else→openmeteo/rainbow)', () => {
  const wx = global.PConf.recommendResolvers.get('recommendedWeatherProvider');
  const rad = global.PConf.recommendResolvers.get('recommendedRadarProvider');
  assert.equal(typeof wx, 'function', 'weather recommend resolver registered');
  assert.equal(typeof rad, 'function', 'radar recommend resolver registered');
  assert.equal(wx({ holidayCountry: 'DE' }), 'dwd');
  assert.equal(rad({ holidayCountry: 'DE' }), 'dwd');
  assert.equal(wx({ holidayCountry: 'NO' }), 'metno');
  assert.equal(rad({ holidayCountry: 'SE' }), 'metno');
  assert.equal(wx({ holidayCountry: 'US' }), 'openmeteo');
  assert.equal(rad({ holidayCountry: 'US' }), 'rainbow');
  // Robust to a missing/none country selection (won't throw).
  assert.equal(wx({}), 'openmeteo');
});

test('preview bands match forecast-series (no drift)', () => {
  const { PRESSURE_SCALE_CURVE_HPA } = require('../src/pkjs/forecast-series');
  assert.deepEqual(PB.pressureCurves, PRESSURE_SCALE_CURVE_HPA);
});

// The sample scenario's slot 4 is 984 hPa, below the 'low' band's 990 floor (a real
// reading, e.g. a deep low) — every other metric's zero floor means "no data" and is
// rightly skipped as a dot, but pressure's band floor is not a genuine zero, so this
// slot must still draw a dot pinned to the baseline rather than vanishing like a
// missing hour would.
// The floor-clamp-not-skip change above is pressure-only (its METRIC entry is the only
// one with a non-zero `min`): a genuine zero-based metric must still skip its dot at 0,
// same as before. UV's sample scenario has 5 zero hours (indices 5-9 of 0-based slots).
test('non-pressure dots still skip a genuine zero (no floor-clamp regression)', () => {
  const svg = PB.forecastPreview(
    { dayNightShading: false, barSource: 'off', secondaryLine: 'precip_prob',
      secondaryLineFill: false, thirdLine: 'uv' },
    { color: true });
  const dots = (svg.match(/width="9"[^>]*fill="#FF00FF"/g) || []).length;
  assert.equal(dots, 6, '11 hour columns minus 5 genuine-zero hours (indices 5-9)');
});

test('pressure dots: a below-floor reading still draws (real data, not skipped like a zero)', () => {
  const svg = PB.forecastPreview(
    { dayNightShading: false, barSource: 'off', secondaryLine: 'precip_prob',
      secondaryLineFill: false, thirdLine: 'pressure', pressureScale: 'low' },
    { color: true });
  // Scope to width="9" (the dot's bar-aligned width, bw) so the count isn't polluted by
  // the legend's width="3.2" color swatch, which also uses the pressure hue.
  const dots = (svg.match(/width="9"[^>]*fill="#FF5500"/g) || []).length;
  assert.equal(dots, 11, 'all 11 hour-column dots render, including the below-floor one');
});

test('pressure main metric renders a line inside the plot, not pinned to the top', () => {
  const svg = PB.forecastPreview(
    { dayNightShading: false, barSource: 'off', secondaryLine: 'pressure',
      secondaryLineFill: false, thirdLine: 'off', pressureScale: 'mid' },
    { color: true });
  assert.ok(svg.includes('#FF5500'), 'pressure line uses the orange stroke');
  assert.ok(svg.includes('Pressure'), 'legend labels the series');
  // The self-centring 20 hPa mid window (sample centre 1000 -> band 990..1010) clamps
  // the stormy sample's extremes at both edges, but the readings in between must land
  // strictly inside the plot: read EVERY coordinate pair of the pressure path (the old
  // M/L-only extraction saw just the path start, which legitimately clamps now).
  const path = [...svg.matchAll(/<path d="([^"]+)"[^>]*stroke="#FF5500"/g)].map((m) => m[1]).join(' ');
  const ys = [...path.matchAll(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g)].map((m) => Number(m[2]));
  assert.ok(ys.length > 0, 'pressure path has vertices');
  assert.ok(ys.some((y) => y > 10 && y < 99), 'at least one vertex sits inside the plot');
});

test('each pressure curve places the same reading at its own pinned height', () => {
  const yFor = (pressureScale) => {
    const svg = PB.forecastPreview(
      { dayNightShading: false, barSource: 'off', secondaryLine: 'pressure',
        secondaryLineFill: false, thirdLine: 'off', pressureScale },
      { color: true });
    return Number([...svg.matchAll(/M(\d+(?:\.\d+)?),(\d+(?:\.\d+)?)/g)][0][2]);
  };
  // Exact y, not just an ordering check, so a wrong formula can't slip through. First
  // sample point is 1016 hPa: inside every curve's span, so nothing clamps — each
  // curve just places it differently. low: past its 1010..1020 core start -> 570pm.
  // mid: 11 hPa into the 1005..1025 core at 35pm/hPa -> 535pm. high: 21 hPa into the
  // 995..1035 core at 17.5pm/hPa -> 567.5 -> 568pm. y = 100 - pm/1000 * 93; PT=4,
  // PB=100. (The narrowest curve reads highest for a core-upper value; the wide
  // curve's y for THIS value happens to land between them — curve geometry, not a bug.)
  assert.equal(yFor('low'), 46.99);
  assert.equal(yFor('mid'), 50.245);
  assert.equal(yFor('high'), 47.176);
});
