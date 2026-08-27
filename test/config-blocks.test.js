// test/config-blocks.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
require('../src/pkjs/config-ui/lib/schema-walk.js');
require('../src/pkjs/config-ui/lib/color.js');
require('../src/pkjs/config-ui/lib/show-when.js');
require('../src/pkjs/config-ui/lib/engine.js');
const B = require('../src/pkjs/settings/blocks.js');
// The block renderers live one file per concern; blocks.js keeps the threshold
// machinery + small resolvers, and requiring it registers every block.
// The layout-preview block has its own file — test/preview-layout.test.js.
const FC = require('../src/pkjs/settings/preview-forecast.js');
const RD = require('../src/pkjs/settings/preview-radar.js');
const DG = require('../src/pkjs/settings/preview-diagnostics.js');
const RAIN = require('../src/pkjs/settings/preview-rain.js');
const budgetLib = require('../src/pkjs/settings/tomorrowio-budget.js');
// The graph-colour key vocabulary and its built-in table — the preview resolves through
// it, so the graph-colour cases below derive their keys and defaults from it too.
const lineStyle = require('../src/pkjs/line-style.js');

function budgetState(over) {
  return Object.assign({
    provider: 'tomorrowio', radarProvider: 'tomorrowio', fetchIntervalMin: '5',
    sleepNightEnabled: true, sleepStartHour: '0', sleepEndHour: '7',
    tomorrowioFitBudget: true
  }, over || {});
}

test('forecastPreview returns an SVG with the rain bars rendered', () => {
  const fc = FC.forecastPreview({ dayNightShading: true, barSource: 'rain', rainBarColor: 'multicolor', secondaryLine: 'precip_prob', secondaryLineFill: true, windScale: 'mid' }, { color: true });
  assert.ok(/^<svg/.test(fc) && fc.indexOf('</svg>') > 0, 'is an SVG document');
  assert.ok(fc.indexOf('fill="#00FF00"') > -1, 'multicolor rain bars actually render (not an empty frame)');
});
test('radarPreview: off message vs SVG', () => {
  assert.ok(RD.radarPreview({ radarMode: 'off', radarColor: 'multicolor' }, { color: true }).indexOf('Radar off') >= 0);
  assert.ok(/^<svg/.test(RD.radarPreview({ radarProvider: 'dwd', radarColor: 'white' }, { color: true })));
});
// A multicolor radar band fill (e.g. #00FF00) appears on a color watch but never on B/W,
// where the bars are always solid white regardless of the (hidden) radarColor setting.
const GREEN_BAND = 'fill="#00FF00"';
test('radarPreview forces white bars on B/W even when setting says multicolor', () => {
  const color = RD.radarPreview({ radarProvider: 'dwd', radarColor: 'multicolor' }, { color: true });
  const bw    = RD.radarPreview({ radarProvider: 'dwd', radarColor: 'multicolor' }, { color: false });
  assert.ok(color.indexOf(GREEN_BAND) >= 0, 'color watch keeps multicolor bands');
  assert.equal(bw.indexOf(GREEN_BAND), -1, 'B/W watch draws no color bands');
  assert.ok(bw.indexOf('fill="#FFFFFF"') >= 0, 'B/W watch draws white bars');
});
test('forecastPreview forces white rain bars on B/W even when setting says multicolor', () => {
  const state = { dayNightShading: true, barSource: 'rain', rainBarColor: 'multicolor', secondaryLine: 'off' };
  const color = FC.forecastPreview(state, { color: true });
  const bw    = FC.forecastPreview(state, { color: false });
  assert.ok(color.indexOf(GREEN_BAND) >= 0, 'color watch keeps multicolor rain bands');
  assert.equal(bw.indexOf(GREEN_BAND), -1, 'B/W watch draws no color rain bands');
});
test('devStats: table only, no clear button; empty when disabled', () => {
  const ds = DG.devStats({ devStatsEnabled: true }, {}, { devStats: JSON.stringify([{ t: Date.now(), k: 'weather', ok: 1, c: { forecast: 1 } }]) });
  assert.ok(ds.indexOf('Daily summary') >= 0);
  assert.equal(ds.indexOf('devStatsClearBtn'), -1, 'no live Clear button (now a toggle)');
  assert.equal(DG.devStats({ devStatsEnabled: false }, {}, { devStats: '[]' }), '');
});
test('lastFetch formats success / Never / failed-attempt-with-error', () => {
  const lf = DG.lastFetch({}, {}, { lastFetchSuccess: JSON.stringify({ time: Date.now(), name: 'Berlin' }), lastFetchAttempt: null });
  assert.ok(lf.indexOf('Berlin') >= 0);
  assert.ok(DG.lastFetch({}, {}, {}).indexOf('Never') >= 0);
  // failed attempt newer than last success -> shows the attempt + error stage:code (inject.js:321-332)
  const failed = DG.lastFetch({}, {}, {
    lastFetchSuccess: JSON.stringify({ time: 1000, name: 'Berlin' }),
    lastFetchAttempt: JSON.stringify({ time: Date.now(), name: 'Berlin', error: { stage: 'geocode', code: 401 } })
  });
  assert.ok(failed.indexOf('geocode') >= 0 && failed.indexOf('401') >= 0, 'shows error stage:code');
});
test('forecastPreview draws the secondary line per metric (solid, per-metric color)', () => {
  const base = { dayNightShading: false, barSource: 'off', windScale: 'mid', thirdLine: 'off' };
  assert.ok(FC.forecastPreview(Object.assign({}, base, { secondaryLine: 'wind' }), { color: true }).indexOf('stroke="#FFFF00"') > -1, 'wind = yellow');
  assert.ok(FC.forecastPreview(Object.assign({}, base, { secondaryLine: 'gust' }), { color: true }).indexOf('stroke="#FFFFFF"') > -1, 'gust = white');
  assert.ok(FC.forecastPreview(Object.assign({}, base, { secondaryLine: 'uv' }), { color: true }).indexOf('stroke="#FF00FF"') > -1, 'uv = magenta');
});

test('forecastPreview draws feels-like grey, and the hi/lo labels stay the ACTUAL temps', () => {
  const base = { dayNightShading: false, barSource: 'off', windScale: 'mid', thirdLine: 'off', secondaryLineFill: false };
  const svg = FC.forecastPreview(Object.assign({}, base, { secondaryLine: 'feels' }), { color: true });
  assert.ok(svg.indexOf('stroke="#AAAAAA"') > -1, 'feels = light grey line (dark theme)');
  // The feels sample dips to 11° under the 14° temp min. The SCALING band widens (and
  // pads) to fit it, but the labels name the air temperature — the watch prints
  // TEMP_MIN/TEMP_MAX as text, so a low the air never reached would be a lie.
  assert.ok(svg.indexOf('>14°<') > -1, 'lo label stays the actual temperature low');
  assert.equal(svg.indexOf('>11°<'), -1, 'the feels minimum is never labelled');
  assert.ok(svg.indexOf('>Feels<') > -1, 'legend lists the feels series');
  const plain = FC.forecastPreview(Object.assign({}, base, { secondaryLine: 'precip_prob' }), { color: true });
  assert.ok(plain.indexOf('>14°<') > -1, 'and they are the same labels without feels');
  // Light theme darkens the grey (LightGray is illegible on white); B&W goes white.
  const light = FC.forecastPreview(Object.assign({}, base, { secondaryLine: 'feels', theme: 'light' }), { color: true });
  assert.ok(light.indexOf('stroke="#000000"') > -1,
    'light theme: black stroke — a grey is invisible at 1px on white, and DarkGray is '
    + 'what the white-bar mode paints its bars in a light theme');
  const bw = FC.forecastPreview(Object.assign({}, base, { secondaryLine: 'feels' }), { color: false });
  assert.ok(bw.indexOf('stroke="#FFFFFF"') > -1, 'B&W: white stroke');
});

test('feels-like as the second metric draws grey squares, labels still the actual temps', () => {
  const svg = FC.forecastPreview({ dayNightShading: false, barSource: 'off', windScale: 'mid', secondaryLine: 'precip_prob', thirdLine: 'feels', secondaryLineFill: false }, { color: true });
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
  const svg = FC.forecastPreview({ dayNightShading: false, barSource: 'off', windScale: 'mid',
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
  const svg = FC.forecastPreview(Object.assign({}, CURVE_BASE), { color: true });
  // The inset is not configurable: temp always draws with the watch's fixed
  // 7 px inset, which the preview scales to 12 units (PT+3+12 = 19).
  assert.equal(tempCurveTopY(svg), 19, 'the fixed 7 px look');
});

test('forecastPreview: the feels curve rides the temp axis (same fixed margin)', () => {
  const svg = FC.forecastPreview(Object.assign({}, CURVE_BASE, { secondaryLine: 'feels' }), { color: true });
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
  const feels = FC.forecastPreview(
    Object.assign({}, CURVE_BASE, { secondaryLine: 'feels', secondaryLineFill: true }), { color: true });
  assert.ok(/stroke="#AAAAAA"/.test(feels), 'the feels curve itself still renders');
  assert.equal(/fill-opacity="0.25"/.test(feels), false, 'no filled area under the feels curve');
  // Control: the same settings with a normal metric DO produce the fill, so the
  // assertion above is about feels and not about the fixture being fill-less.
  const precip = FC.forecastPreview(
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
  const withThird = FC.forecastPreview(Object.assign({}, base, { thirdLine: 'uv' }), { color: true });
  const noThird   = FC.forecastPreview(Object.assign({}, base, { thirdLine: 'off' }), { color: true });
  assert.ok(withThird.indexOf('<rect') > -1 && withThird.indexOf('fill="#FF00FF"') > -1,
    'second metric (uv) renders as filled magenta squares');
  assert.equal(withThird.indexOf('stroke-dasharray'), -1, 'no dotted-line styling anymore');
  assert.equal(noThird.indexOf('fill="#FF00FF"'), -1, 'no second-metric squares when it is off');
});

test('forecastPreview gust dots take a color distinct from the rain bars', () => {
  // barSource off isolates the dot color (#AAAAAA is also a multicolor bar band when bars are on).
  const base = { dayNightShading: false, barSource: 'off', windScale: 'mid', secondaryLine: 'precip_prob', thirdLine: 'gust' };
  const whiteBars = FC.forecastPreview(Object.assign({}, base, { rainBarColor: 'white' }), { color: true });
  const multiBars = FC.forecastPreview(Object.assign({}, base, { rainBarColor: 'multicolor' }), { color: true });
  assert.ok(whiteBars.indexOf('fill="#AAAAAA"') > -1, 'white bars → light gray gust dots');
  assert.equal(multiBars.indexOf('fill="#AAAAAA"'), -1, 'multicolor bars → white gust dots (not gray)');
});

test('forecastPreview never draws the second metric as the same metric as the main', () => {
  // duplicate metric → no second-metric squares; wind = #FFFF00 is only a fill for those squares.
  const svg = FC.forecastPreview({ dayNightShading: false, barSource: 'off', windScale: 'mid', secondaryLine: 'wind', thirdLine: 'wind' }, { color: true });
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

test('preview-rain barPermille matches rain-tier.rainPermille byte-for-byte', () => {
  const rt = require('../src/pkjs/weather/rain-tier.js');
  [0, 1, 2, 3, 5, 6, 20, 21, 50, 100, 101, 200, 255, 500, 1000].forEach((t) =>
    assert.equal(RAIN.barPermille(t), rt.rainPermille(t), 'tenths=' + t));
});

test('the second metric (dots) spans the full plot width (no early stop)', () => {
  const svg = FC.forecastPreview(
    { barSource: 'off', secondaryLine: 'precip_prob', thirdLine: 'gust', windScale: 'mid', dayNightShading: false },
    { color: true });
  const xs = (svg.match(/<rect x="([\d.]+)"/g) || []).map((m) => parseFloat(m.replace(/[^\d.]/g, '')));
  assert.ok(Math.max.apply(null, xs) > 180, 'a dot reaches the right edge (>180); got ' + Math.max.apply(null, xs));
});

test('UV line is continuous through zeros (single path that reaches the baseline)', () => {
  const svg = FC.forecastPreview(
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
  const white = FC.forecastPreview(Object.assign({}, base, { rainBarColor: 'white' }), { color: true });
  const multi = FC.forecastPreview(Object.assign({}, base, { rainBarColor: 'multicolor' }), { color: true });
  // Rain-bar bands are width-9 rects; the legend gradient uses width-2.4, so scope to width="9".
  assert.ok(/width="9"[^>]*fill="#00FF00"/.test(multi), 'multicolor: a green tier band on a bar');
  assert.ok(!/width="9"[^>]*fill="#00FF00"/.test(white), 'white: no green tier band on a bar');
  assert.ok(/width="9"[^>]*fill="#FFFFFF"/.test(white), 'white: a solid white bar');
});

test('forecast grid: temp line spans the first tick to the last tick (edge to edge)', () => {
  const svg = FC.forecastPreview(
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
  const svg = FC.forecastPreview(
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
  const svg = FC.forecastPreview(
    { barSource: 'rain', rainBarColor: 'white', secondaryLine: 'off', windScale: 'mid', dayNightShading: false },
    { color: true });
  assert.ok(svg.indexOf('>Rain<') >= 0, 'Rain legend present');
  assert.equal(svg.indexOf('width="2.4"'), -1, 'no tier-gradient swatches in the legend when bars are white');
  assert.ok(/width="12"[^>]*fill="#FFFFFF"/.test(svg), 'a solid white Rain swatch instead');
});

test('forecastPreview has no status bar (no location, sunset, or current-temp pill)', () => {
  const svg = FC.forecastPreview(
    { dayNightShading: false, barSource: 'off', secondaryLine: 'off', windScale: 'mid' },
    { color: true });
  assert.equal(svg.indexOf('Berlin'), -1, 'no location label');
  assert.equal(svg.indexOf('21:29'), -1, 'no sunset time');
  assert.equal(svg.indexOf('>22°<'), -1, 'no current-temp pill');
});

test('B&W: series are white, temp thick (3) vs main thin (1), no hues', () => {
  const bw = FC.forecastPreview(
    { barSource: 'rain', rainBarColor: 'multicolor', secondaryLine: 'wind', windScale: 'mid', dayNightShading: false },
    { color: false });
  assert.equal(bw.indexOf('fill="#00FF00"'), -1, 'no color rain bands on B&W');
  assert.equal(bw.indexOf('#FFFF00'), -1, 'wind hue not used on B&W (white instead)');
  assert.ok(bw.indexOf('stroke-width="3"') >= 0, 'temp curve thick (3)');
  assert.ok(bw.indexOf('stroke-width="1"') >= 0, 'main line thin (1)');
});

test('legend lists the shown series with palette colors (color watch)', () => {
  const svg = FC.forecastPreview(
    { barSource: 'rain', rainBarColor: 'multicolor', secondaryLine: 'precip_prob', thirdLine: 'wind', windScale: 'mid', dayNightShading: false },
    { color: true });
  assert.ok(svg.indexOf('viewBox="0 0 200 124"') >= 0, 'compact frame');
  assert.ok(svg.indexOf('>Temp<') >= 0, 'Temp entry');
  assert.ok(svg.indexOf('>Precip %<') >= 0, 'main metric entry (Precip %)');
  assert.ok(svg.indexOf('>Wind<') >= 0, 'second metric entry (Wind)');
  assert.ok(svg.indexOf('>Rain<') >= 0, 'Rain entry (bars on)');
});

test('legend omits the second metric when thirdLine is off, and Rain when bars are off', () => {
  const svg = FC.forecastPreview(
    { barSource: 'off', secondaryLine: 'uv', thirdLine: 'off', windScale: 'mid', dayNightShading: false },
    { color: true });
  assert.ok(svg.indexOf('>UV<') >= 0, 'main metric entry (UV)');
  assert.equal(svg.indexOf('>Rain<'), -1, 'no Rain entry when bars are off');
});

test('legend uses white style glyphs on B&W (no hues)', () => {
  const svg = FC.forecastPreview(
    { barSource: 'rain', rainBarColor: 'multicolor', secondaryLine: 'wind', thirdLine: 'off', windScale: 'mid', dayNightShading: false },
    { color: false });
  assert.ok(svg.indexOf('>Temp<') >= 0 && svg.indexOf('>Wind<') >= 0 && svg.indexOf('>Rain<') >= 0);
  assert.equal(svg.indexOf('#FFFF00'), -1, 'no wind hue in the B&W legend');
});

test('legend shows the second metric as white dots on B&W (no hue)', () => {
  const svg = FC.forecastPreview(
    { barSource: 'off', secondaryLine: 'wind', thirdLine: 'gust', windScale: 'mid', dayNightShading: false },
    { color: false });
  assert.ok(svg.indexOf('>Gust<') >= 0, 'second-metric legend entry (Gust) present');
  assert.ok(svg.indexOf('fill="#FFFFFF"') >= 0, 'second metric renders as white squares on B&W');
  assert.equal(svg.indexOf('#AAAAAA'), -1, 'no gust gray hue on B&W (white instead)');
});

test('radarPreview legend distinguishes exact-spot rain from nearby rain', () => {
  const color = RD.radarPreview({ radarProvider: 'dwd', radarColor: 'multicolor' }, { color: true });
  const bw = RD.radarPreview({ radarProvider: 'dwd', radarColor: 'multicolor' }, { color: false });
  assert.ok(color.indexOf('viewBox="0 0 200 138"') >= 0, 'frame includes the countdown band, which now always accompanies a non-off, non-aplite preview');
  assert.ok(color.indexOf('>Rain at your exact spot<') >= 0, 'exact-spot label present');
  assert.ok(color.indexOf('>Nearby (2 km)<') >= 0, 'nearby label present');
  assert.ok(color.indexOf('fill="#00FF00"') >= 0, 'tier gradient (green) present on color');
  assert.ok(/<rect[^>]*fill="none"[^>]*stroke="#8A8F98"/.test(color), 'hollow grey nearby box present');
  assert.ok(bw.indexOf('>Rain at your exact spot<') >= 0 && bw.indexOf('>Nearby (2 km)<') >= 0, 'both labels on B&W too');
  assert.ok(/<rect[^>]*fill="none"[^>]*stroke="#8A8F98"/.test(bw), 'hollow grey nearby box on B&W too');
});

test('radarPreview shows the countdown band ("Rain in 15\'") when the countdown is on', () => {
  const svg = RD.radarPreview({ radarProvider: 'dwd', radarColor: 'multicolor', rainCountdownHorizon: '60' }, { color: true });
  assert.ok(svg.indexOf("Rain in 15'") >= 0, 'countdown text present');
  assert.ok(svg.indexOf('viewBox="0 0 200 138"') >= 0, 'frame grew by the 20px band height');
});

// rainCountdownHorizon no longer has an Off option — a stray/legacy '0' value must not
// suppress the band (the only remaining gates are radarMode==='off' and aplite).
test('radarPreview always shows the countdown band once radar is on, regardless of rainCountdownHorizon', () => {
  const svg = RD.radarPreview({ radarProvider: 'dwd', radarColor: 'multicolor', rainCountdownHorizon: '0' }, { color: true });
  assert.ok(svg.indexOf("Rain in 15'") >= 0, 'countdown text present despite a legacy rainCountdownHorizon of 0');
  assert.ok(svg.indexOf('viewBox="0 0 200 138"') >= 0, 'frame grew by the band height');
});

test('radarPreview never shows the countdown band on aplite', () => {
  const svg = RD.radarPreview({ radarProvider: 'dwd', radarColor: 'multicolor', rainCountdownHorizon: '60' }, { color: false, platform: 'aplite' });
  assert.equal(svg.indexOf("Rain in 15'"), -1, 'no band on aplite even with a horizon set');
  assert.ok(svg.indexOf('viewBox="0 0 200 118"') >= 0, 'aplite frame stays at the no-band height');
});

test('countdown glyph is tier-coloured on color, white on B&W; text stays white', () => {
  const color = RD.radarPreview({ radarProvider: 'dwd', radarColor: 'multicolor', rainCountdownHorizon: '60' }, { color: true });
  const bw = RD.radarPreview({ radarProvider: 'dwd', radarColor: 'multicolor', rainCountdownHorizon: '60' }, { color: false });
  assert.ok(/stroke="#00FF00"/.test(color), 'glyph uses the green tier stroke on color');
  assert.equal(/stroke="#00FF00"/.test(bw), false, 'no green glyph stroke on B&W');
  assert.ok(color.indexOf('fill="#FFFFFF"') >= 0, 'white band text present on color');
});

test('precip secondary line draws the cobalt fill on color and a dither on B&W', () => {
  const base = { barSource: 'off', secondaryLine: 'precip_prob', secondaryLineFill: true, windScale: 'mid', dayNightShading: false };
  const color = FC.forecastPreview(base, { color: true });
  assert.ok(color.indexOf('fill="#0055AA"') >= 0 && color.indexOf('fill-opacity="0.25"') >= 0,
    'color: translucent cobalt precip fill present');
  const bw = FC.forecastPreview(base, { color: false });
  assert.ok(bw.indexOf('fill="url(#fillhatch)"') >= 0, 'B&W: precip fill uses the dither stipple pattern');
  assert.equal(bw.indexOf('fill="#0055AA"'), -1, 'B&W: no solid cobalt fill');
});

test('area fill works for every main metric, in its palette fill color', () => {
  // Fill colors are sourced from forecast-series.FILL_COLORS: wind=ArmyGreen, gust=DarkGray, uv=Purple.
  const base = { barSource: 'off', windScale: 'mid', dayNightShading: false };
  const wind = FC.forecastPreview(Object.assign({}, base, { secondaryLine: 'wind', secondaryLineFill: true }), { color: true });
  const gust = FC.forecastPreview(Object.assign({}, base, { secondaryLine: 'gust', secondaryLineFill: true }), { color: true });
  const uv = FC.forecastPreview(Object.assign({}, base, { secondaryLine: 'uv', secondaryLineFill: true }), { color: true });
  assert.ok(wind.indexOf('fill="#555500"') >= 0, 'wind fill = ArmyGreen');
  assert.ok(gust.indexOf('fill="#555555"') >= 0, 'gust fill = DarkGray');
  assert.ok(uv.indexOf('fill="#AA00AA"') >= 0, 'uv fill = Purple');
  const off = FC.forecastPreview(Object.assign({}, base, { secondaryLine: 'wind', secondaryLineFill: false }), { color: true });
  assert.equal(off.indexOf('fill="#555500"'), -1, 'no fill when the toggle is off');
});

test('area fill uses the brighter light-theme variant when theme is light', () => {
  const base = { barSource: 'off', windScale: 'mid', dayNightShading: false, theme: 'light' };
  const wind = FC.forecastPreview(Object.assign({}, base, { secondaryLine: 'wind', secondaryLineFill: true }), { color: true });
  const uv = FC.forecastPreview(Object.assign({}, base, { secondaryLine: 'uv', secondaryLineFill: true }), { color: true });
  assert.ok(wind.indexOf('fill="#FFFF00"') >= 0, 'wind light fill = Yellow');
  assert.equal(wind.indexOf('fill="#555500"'), -1, 'not the dark-theme ArmyGreen fill');
  assert.ok(uv.indexOf('fill="#FF55FF"') >= 0, 'uv light fill = ShockingPink');
});

test('precip line + fill take their light-theme variants', () => {
  const base = { barSource: 'off', windScale: 'mid', dayNightShading: false, secondaryLine: 'precip_prob', theme: 'light' };
  const line = FC.forecastPreview(base, { color: true });
  assert.ok(line.indexOf('stroke="#0000AA"') >= 0, 'precip light line = DukeBlue');
  assert.equal(line.indexOf('stroke="#55AAFF"'), -1, 'not the dark-theme PictonBlue line');
  const filled = FC.forecastPreview(Object.assign({}, base, { secondaryLineFill: true }), { color: true });
  assert.ok(filled.indexOf('fill="#55FFFF"') >= 0, 'precip light fill = ElectricBlue');
  assert.equal(filled.indexOf('fill="#AAFFFF"'), -1, 'not the pre-fix Celeste fill');
});

// --- the Graph-colors rows in the preview -----------------------------------
// Every graph colour is stored CONCRETE, one key per element per theme polarity
// (gc<Metric><Role><Dark|Light>, plus gcNightHatch* / gcNightBoundary*), seeded from
// line-style.js' built-in table. There is no Auto sentinel any more, so these cases
// pin two things: a blob still sitting on its built-ins renders exactly like a blob
// that has no graph keys at all, and a colour the user moved shows up at once.
const GC_KEYS = lineStyle.graphColorKeys();
const gcAll = (value) => GC_KEYS.reduce((acc, k) => { acc[k] = value; return acc; }, {});
// What seedDefaults writes into a fresh install: every key holding its built-in, read
// from the same table the resolver falls back to, so this can never drift from it.
const gcSeededDefaults = (state) => {
  const blob = {};
  ['precip_prob', 'wind', 'uv', 'gust', 'pressure', 'feels', 'night'].forEach((scope) => {
    lineStyle.graphColorRoles(scope).forEach((role) => {
      ['Dark', 'Light'].forEach((suffix) => {
        blob[lineStyle.graphColorKey(scope, role, suffix)] = '#'
          + (lineStyle.graphColorDefault(scope, role, suffix, state) & 0xFFFFFF)
            .toString(16).toUpperCase().padStart(6, '0');
      });
    });
  });
  return blob;
};
// Every element is exercised at once: the wind line (Yellow #FFFF00) over its ArmyGreen
// fill (#555500), uv dots (Magenta #FF00FF), the DarkGray night band, and — on dark
// polarity — the ArmyGreen night tint under the filled area.
const GC_BASE = { barSource: 'off', windScale: 'mid', dayNightShading: true,
  secondaryLine: 'wind', thirdLine: 'uv', secondaryLineFill: true };

test('forecastPreview: an untouched blob draws the built-in colours', () => {
  const svg = FC.forecastPreview(GC_BASE, { color: true });
  assert.ok(svg.indexOf('stroke="#FFFF00"') >= 0, 'the wind line is Yellow');
  assert.ok(/fill="#555500" fill-opacity="0\.25"><\/path>/.test(svg), 'the area fill is ArmyGreen');
  assert.ok(svg.indexOf('fill="#FF00FF"') >= 0, 'the uv dots are Magenta');
  assert.ok(/<pattern id="nh"[^>]*>[\s\S]*?stroke="#555555"/.test(svg),
    'the night hatch is DarkGray — the colour the watch paints, not a translucent stand-in');
  assert.ok(/y1="4"[^>]*stroke="#555555" stroke-width="0\.7"/.test(svg), 'and so is the dusk/dawn line');
});

test('forecastPreview: a tuned colour overrides the built-in line, fill and dot colours', () => {
  const tuned = FC.forecastPreview(Object.assign({}, GC_BASE, {
    gcWindLineDark: '#00FFFF', gcWindFillDark: '#AA00AA', gcUvLineDark: '#00FF00'
  }), { color: true });
  assert.ok(tuned.indexOf('stroke="#00FFFF"') >= 0, 'the main line takes its colour');
  assert.equal(tuned.indexOf('stroke="#FFFF00"'), -1, 'and the built-in wind yellow is gone');
  assert.ok(/fill="#AA00AA" fill-opacity="0\.25"/.test(tuned), 'the area fill takes its colour');
  assert.equal(tuned.search(/fill="#555500" fill-opacity="0\.25"><\/path>/), -1,
    'and the built-in ArmyGreen day fill is gone');
  assert.ok(tuned.indexOf('fill="#00FF00"') >= 0, 'the second-metric dots take theirs');
  assert.equal(tuned.indexOf('fill="#FF00FF"'), -1, 'and the built-in uv magenta is gone');
});

test('forecastPreview: the seeded defaults, absent and unparseable all render identically', () => {
  const untouched = FC.forecastPreview(GC_BASE, { color: true });
  assert.equal(FC.forecastPreview(Object.assign({}, GC_BASE, gcSeededDefaults(GC_BASE)), { color: true }),
    untouched, 'a blob seeded with every built-in is the fresh-install case');
  assert.equal(FC.forecastPreview(Object.assign({}, GC_BASE, gcAll('')), { color: true }),
    untouched, 'an empty value falls back to the built-in');
  assert.equal(FC.forecastPreview(Object.assign({}, GC_BASE, gcAll(null)), { color: true }),
    untouched, 'so does a null');
  assert.equal(FC.forecastPreview(Object.assign({}, GC_BASE, gcAll('teal')), { color: true }),
    untouched, 'and so does anything unparseable');
});

test('forecastPreview: the colours are per theme polarity', () => {
  const both = { gcWindLineDark: '#00FFFF', gcWindLineLight: '#00FF00' };
  const dark = FC.forecastPreview(Object.assign({}, GC_BASE, both), { color: true });
  assert.ok(dark.indexOf('stroke="#00FFFF"') >= 0, 'the dark theme paints the Dark colour');
  assert.equal(dark.indexOf('stroke="#00FF00"'), -1, 'the Light one is inert there');
  const light = FC.forecastPreview(Object.assign({}, GC_BASE, both, { theme: 'light' }), { color: true });
  assert.ok(light.indexOf('stroke="#00FF00"') >= 0, 'the light theme paints the Light colour');
  assert.equal(light.indexOf('stroke="#00FFFF"'), -1, 'the Dark one is inert there');
});

test('forecastPreview: bw / bw-light and B&W displays ignore every graph colour', () => {
  const tuned = Object.assign({}, GC_BASE, gcAll('#00FF00'));
  ['bw', 'bw-light'].forEach((theme) => {
    assert.equal(FC.forecastPreview(Object.assign({}, tuned, { theme }), { color: true }),
      FC.forecastPreview(Object.assign({}, GC_BASE, { theme }), { color: true }),
      theme + ' renders exactly as it does with none of them set');
  });
  assert.equal(FC.forecastPreview(tuned, { color: false }), FC.forecastPreview(GC_BASE, { color: false }),
    'a B&W display ignores them too');
});

test('forecastPreview: the exactly-white→black flip survives in the B&W arm only', () => {
  // On colour the built-ins are concrete per polarity (gust's Light line IS Black), and a
  // colour the user tuned FOR the light polarity is what they want there — nothing flips.
  // The flip lives on in line-style's B&W arm, whose constant really is white.
  const base = Object.assign({}, GC_BASE, { theme: 'light', secondaryLine: 'gust',
    thirdLine: 'off', rainBarColor: 'multicolor' });
  const builtIn = FC.forecastPreview(base, { color: true });
  assert.ok(builtIn.indexOf('stroke="#000000"') >= 0, 'the built-in gust line is Black on the light theme');
  const white = FC.forecastPreview(Object.assign({}, base, { gcGustLineLight: '#FFFFFF' }), { color: true });
  assert.ok(white.indexOf('stroke="#FFFFFF"') >= 0, 'a tuned white paints as picked');
  assert.equal(white.indexOf('stroke="#000000"'), -1, 'it is not flipped');
  const bw = FC.forecastPreview(Object.assign({}, base, { theme: 'bw-light', gcGustLineLight: '#FFFFFF' }), { color: true });
  assert.equal(bw.indexOf('stroke="#FFFFFF"'), -1, 'but the B&W arm still flips its white on light polarity');
});

test('forecastPreview: the fill colour paints the area only, the second-line colour the dots only', () => {
  const fill = FC.forecastPreview(Object.assign({}, GC_BASE, { gcWindFillDark: '#AA00AA' }), { color: true });
  assert.ok(/fill="#AA00AA" fill-opacity="0\.25"/.test(fill), 'the area takes it');
  assert.ok(fill.indexOf('stroke="#FFFF00"') >= 0, 'the wind line keeps its own colour');
  assert.ok(fill.indexOf('fill="#FF00FF"') >= 0, 'and the uv dots keep theirs');
  const dots = FC.forecastPreview(Object.assign({}, GC_BASE, { gcUvLineDark: '#00FF00' }), { color: true });
  assert.ok(dots.indexOf('fill="#00FF00"') >= 0, 'the dots take it');
  assert.ok(/fill="#555500" fill-opacity="0\.25"><\/path>/.test(dots), 'the area fill is untouched');
  assert.ok(dots.indexOf('stroke="#FFFF00"') >= 0, 'and so is the main line');
});

test('forecastPreview: the night hatch and dusk/dawn colours reach the night shading', () => {
  const svg = FC.forecastPreview(Object.assign({}, GC_BASE, {
    gcNightHatchDark: '#00AAFF', gcNightBoundaryDark: '#FF5500' }), { color: true });
  assert.ok(/<pattern id="nh"[^>]*>[\s\S]*?stroke="#00AAFF"/.test(svg),
    'the one hatch pattern carries the hatch colour');
  assert.equal(svg.indexOf('nhp'), -1, 'there is no second pattern to switch to any more');
  assert.ok(svg.indexOf('fill="url(#nh)"') >= 0, 'the night band paints with it');
  assert.ok(/y1="4"[^>]*stroke="#FF5500"/.test(svg), 'the dusk/dawn verticals take theirs');
  assert.equal(svg.indexOf('rgba(255,255,255,0.45)'), -1, 'the translucent ink is not used on colour');
  // B&W keeps the translucent ink: the watch discards all five night bytes there and
  // hatches in its own theme foreground, which this stands in for.
  const bw = FC.forecastPreview(Object.assign({}, GC_BASE, { gcNightHatchDark: '#00AAFF' }), { color: false });
  assert.ok(bw.indexOf('rgba(255,255,255,0.30)') >= 0, 'B&W hatches in translucent ink');
  assert.equal(bw.indexOf('#00AAFF'), -1, 'and never in the stored colour');
});

test('forecastPreview: the night tint re-shades the filled area in both polarities', () => {
  // The gate mirrors forecast_layer.c's night_under layer: a night band and a filled area
  // to re-shade, colour only. Light used to be skipped unless the tint was an explicit
  // pick; it now re-shades off NIGHT_AREA_LIGHT_BASE like dark does.
  const dark = FC.forecastPreview(GC_BASE, { color: true });
  assert.ok(dark.indexOf('<clipPath id="nightclip">') >= 0, 'the night band becomes a clip');
  assert.ok(/<path d="[^"]+" fill="#555500" fill-opacity="0\.25" clip-path="url\(#nightclip\)"><\/path>/.test(dark),
    "the area is re-drawn in wind's built-in night base, clipped to the night hours");
  assert.ok(/fill="#555500" fill-opacity="0\.25"><\/path>/.test(dark), 'the day fill is still there underneath');
  const darkTuned = FC.forecastPreview(Object.assign({}, GC_BASE, { gcWindNightDark: '#0000AA' }), { color: true });
  assert.ok(/fill="#0000AA" fill-opacity="0\.25" clip-path="url\(#nightclip\)"/.test(darkTuned),
    'a tuned tint paints verbatim');
  const light = FC.forecastPreview(Object.assign({}, GC_BASE, { theme: 'light' }), { color: true });
  assert.ok(/fill="#FFAA55" fill-opacity="0\.25" clip-path="url\(#nightclip\)"/.test(light),
    "the light theme re-shades in wind's light night base (Rajah), no pick needed");
  const lightTuned = FC.forecastPreview(Object.assign({}, GC_BASE,
    { theme: 'light', gcWindNightLight: '#0000AA' }), { color: true });
  assert.ok(/fill="#0000AA" fill-opacity="0\.25" clip-path="url\(#nightclip\)"/.test(lightTuned),
    'and a Light pick still overrides that built-in');
  assert.equal(FC.forecastPreview(Object.assign({}, GC_BASE,
    { secondaryLineFill: false }), { color: true }).indexOf('nightclip'), -1,
    'nothing to re-shade with the fill off');
  assert.equal(FC.forecastPreview(Object.assign({}, GC_BASE,
    { dayNightShading: false }), { color: true }).indexOf('nightclip'), -1,
    'and nothing with the night band off');
  assert.equal(FC.forecastPreview(Object.assign({}, GC_BASE,
    { secondaryLine: 'feels' }), { color: true }).indexOf('nightclip'), -1,
    'feels-like never fills, so it never tints');
  assert.equal(FC.forecastPreview(GC_BASE, { color: false }).indexOf('nightclip'), -1,
    'and a B&W preview paints no night bytes at all');
});

// The night tint cascades from the fill at RESOLVE time (line-style.js' graphNightTint),
// so nothing is written into the tint key when a fill is picked. Both display surfaces
// therefore have to derive what they paint rather than read the key: the row badge's
// Night dot, and the tint picker's own swatch inside the sheet (through the engine's
// displayFrom hook). Show the stored value and the user sees a stale swatch while the
// graph draws the fill colour.
const gcBuiltIn = (scope, role, suffix) => '#'
  + (lineStyle.graphColorDefault(scope, role, suffix, {}) & 0xFFFFFF).toString(16).toUpperCase().padStart(6, '0');

test('the Night badge dot shows the tint the graph actually paints, not the stored key', () => {
  const badge = PConf.badgeResolvers.get('graphColorSwatch');
  assert.equal(typeof badge, 'function', 'badge resolver registered');
  const nightDot = (S) => {
    const out = badge(S, { color: true }, { scope: 'wind' });
    assert.deepEqual(lineStyle.graphColorRoles('wind'), ['Line', 'Fill', 'Night'],
      'the Night dot is the last of the three');
    return out.dots[2].color;
  };
  const fillKey = lineStyle.graphColorKey('wind', 'Fill', 'Dark');
  const nightKey = lineStyle.graphColorKey('wind', 'Night', 'Dark');

  assert.equal(nightDot({}), gcBuiltIn('wind', 'Night', 'Dark'),
    'an untouched blob shows the hand-tuned built-in');
  assert.equal(nightDot(gcSeededDefaults({})), gcBuiltIn('wind', 'Night', 'Dark'),
    'so does a seeded install holding that built-in concretely');
  assert.equal(nightDot({ [fillKey]: '#AA00AA' }), '#AA00AA',
    'a fill pick cascades into the dot, with the tint key never written');
  assert.equal(nightDot({ [fillKey]: '#AA00AA', [nightKey]: gcBuiltIn('wind', 'Night', 'Dark') }),
    '#AA00AA', 'a tint left on its built-in cascades just the same');
  assert.equal(nightDot({ [fillKey]: '#AA00AA', [nightKey]: '#550055' }), '#550055',
    'a tint picked in its own right wins over the fill');

  // The Line and Fill dots keep reading their own stored key — only the tint cascades.
  const dots = badge({ [fillKey]: '#AA00AA' }, { color: true }, { scope: 'wind' }).dots;
  assert.equal(dots[0].color, gcBuiltIn('wind', 'Line', 'Dark'), 'the line dot is untouched');
  assert.equal(dots[1].color, '#AA00AA', 'the fill dot is the pick itself');
});

test('the sheet swatch derives the same cascaded tint through the display hook', () => {
  const fn = PConf.displayResolvers.get('graphNightTint');
  assert.equal(typeof fn, 'function', 'display resolver registered');
  const fillKey = lineStyle.graphColorKey('uv', 'Fill', 'Light');
  const nightKey = lineStyle.graphColorKey('uv', 'Night', 'Light');
  const args = { scope: 'uv', suffix: 'Light', messageKey: nightKey };

  assert.equal(fn({}, {}, args), gcBuiltIn('uv', 'Night', 'Light'), 'built-in with nothing stored');
  assert.equal(fn({ [fillKey]: '#00FF00' }, {}, args), '#00FF00', 'the fill pick cascades');
  // #0000AA, not uv's own built-in tint: a value equal to the built-in is by definition
  // not a claim (the page seeds every key with its built-in), so it would cascade.
  assert.equal(fn({ [fillKey]: '#00FF00', [nightKey]: '#0000AA' }, {}, args), '#0000AA',
    'a claimed tint paints itself');
  // The row's own polarity is passed in, not the live theme: the Dark and Light rows of
  // a pair are edited independently and only one of them is ever visible.
  assert.equal(fn({ [lineStyle.graphColorKey('uv', 'Fill', 'Dark')]: '#00FF00' }, {}, args),
    gcBuiltIn('uv', 'Night', 'Light'), 'the Dark fill does not reach the Light row');
  // It must hand back a '#RRGGBB' STRING — renderColor compares it against the palette's
  // uppercase hexes to mark the current swatch, so an int would highlight nothing.
  assert.match(fn({ [fillKey]: 0x00FF00 }, {}, args), /^#[0-9A-F]{6}$/,
    'a stored int is normalised to hex');
  assert.equal(fn(null, {}, args), null, 'and no settings blob resolves to nothing to paint');
});

test('radarPreview (rainbow): no nearby outline bars and no "Nearby (2 km)" legend', () => {
  const dwd = RD.radarPreview({ radarProvider: 'dwd', radarColor: 'multicolor', rainCountdownHorizon: '0' }, { color: true });
  const rainbow = RD.radarPreview({ radarProvider: 'rainbow', radarColor: 'multicolor', rainCountdownHorizon: '0' }, { color: true });
  assert.ok(dwd.indexOf('>Nearby (2 km)<') >= 0, 'dwd keeps the nearby legend');
  assert.equal(rainbow.indexOf('>Nearby (2 km)<'), -1, 'rainbow drops the nearby legend');
  assert.ok(rainbow.indexOf('>Rain at your exact spot<') >= 0, 'exact-spot legend stays');
  assert.ok(dwd.indexOf('fill="none" stroke="rgba(255,255,255,0.30)"') >= 0, 'dwd draws hollow nearby bars');
  assert.equal(rainbow.indexOf('fill="none" stroke="rgba(255,255,255,0.30)"'), -1, 'rainbow draws no hollow nearby bars');
});

test('radarPreview (rainbow) still renders exact bars and the countdown band', () => {
  const svg = RD.radarPreview({ radarProvider: 'rainbow', radarColor: 'multicolor', rainCountdownHorizon: '60' }, { color: true });
  assert.ok(/^<svg/.test(svg), 'renders an SVG, not the off message');
  assert.ok(svg.indexOf("Rain in 15'") >= 0, 'countdown band applies to rainbow too');
});

test('forecastPreview: light theme flips the canvas background to white', () => {
  const state = { dayNightShading: true, barSource: 'rain', rainBarColor: 'multicolor', secondaryLine: 'off', theme: 'light' };
  const svg = FC.forecastPreview(state, { color: true });
  assert.ok(svg.indexOf('fill="#FFFFFF"') >= 0, 'canvas background is now white');
});

test('forecastPreview: bw theme on a color env renders the B&W path, not multicolor', () => {
  const state = { dayNightShading: true, barSource: 'rain', rainBarColor: 'multicolor', secondaryLine: 'off', theme: 'bw' };
  const color = FC.forecastPreview({ ...state, theme: 'dark' }, { color: true });
  const bw = FC.forecastPreview(state, { color: true });
  assert.ok(color.indexOf('fill="#00FF00"') >= 0, 'sanity: dark theme on a color env keeps multicolor bands');
  assert.equal(bw.indexOf('fill="#00FF00"'), -1, 'bw theme drops multicolor rain bands even though env.color is true');
});

test('forecastPreview: bw-light theme on a color env renders the B&W path with a white canvas (light polarity)', () => {
  const state = { dayNightShading: true, barSource: 'rain', rainBarColor: 'multicolor', secondaryLine: 'off', theme: 'bw-light' };
  const svg = FC.forecastPreview(state, { color: true });
  assert.equal(svg.indexOf('fill="#00FF00"'), -1, 'bw-light theme drops multicolor rain bands even though env.color is true');
  assert.ok(svg.indexOf('fill="#FFFFFF"') >= 0, 'canvas background is white (light polarity)');
});

test('radarPreview: light theme flips the canvas background to white', () => {
  const svg = RD.radarPreview({ radarProvider: 'dwd', radarColor: 'multicolor', theme: 'light' }, { color: true });
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
  const svg = RD.radarPreview({ radarProvider: 'dwd', radarColor: 'multicolor', theme: 'bw' }, { color: true });
  assert.equal(svg.indexOf('fill="#00FF00"'), -1, 'no multicolor bands');
  assert.ok(svg.indexOf('fill="#000000" stroke="#FFFFFF" stroke-width="1"') >= 0,
    'exact bars are opaque black-filled with a white outline (mirrors the watch\'s theme_bg()-filled + theme_fg()-outlined bar)');
});

test('radarPreview: bw-light theme on a color env outlines the exact bars in black, filled opaque white (light polarity)', () => {
  const svg = RD.radarPreview({ radarProvider: 'dwd', radarColor: 'multicolor', theme: 'bw-light' }, { color: true });
  assert.equal(svg.indexOf('fill="#00FF00"'), -1, 'no multicolor bands');
  assert.ok(svg.indexOf('width="200" height="118" fill="#FFFFFF"') >= 0, 'canvas background is white');
  assert.ok(svg.indexOf(OUTLINE_MARK) >= 0,
    'exact bars are opaque white-filled with a black outline — the polarity mirror of bw, not a hollow box');
});

test('forecastPreview: bw/bw-light rain bars are opaque (filled with the polarity background), not hollow outlines', () => {
  const base = { barSource: 'rain', rainBarColor: 'multicolor', secondaryLine: 'off', windScale: 'mid', dayNightShading: false };
  const bw = FC.forecastPreview(Object.assign({}, base, { theme: 'bw' }), { color: true });
  assert.ok(bw.indexOf('fill="#000000" stroke="#FFFFFF" stroke-width="1"') >= 0,
    'bw rain bars are opaque black-filled with a white outline');
  const bwLight = FC.forecastPreview(Object.assign({}, base, { theme: 'bw-light' }), { color: true });
  assert.ok(bwLight.indexOf(OUTLINE_MARK) >= 0,
    'bw-light rain bars are opaque white-filled with a black outline');
});

test('forecastPreview: bw rain bars draw above (after) the dithered metric-area fill, matching the watch\'s z-order', () => {
  const state = {
    barSource: 'rain', rainBarColor: 'multicolor', windScale: 'mid', dayNightShading: false, theme: 'bw',
    secondaryLine: 'precip_prob', secondaryLineFill: true
  };
  const svg = FC.forecastPreview(state, { color: true });
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
  const svg = RD.radarPreview({ radarProvider: 'dwd', radarColor: 'white', theme: 'light' }, { color: true, platform: 'aplite' });
  assert.ok(svg.indexOf('width="200" height="118" fill="#FFFFFF"') >= 0, 'canvas background is white');
  assert.ok(svg.indexOf('fill="#555555"') >= 0, 'solid bars/legend render DarkGray');
  assert.equal(svg.indexOf('fill="#000000"'), -1, 'never a plain black bar/legend fill in the light theme');
});

test('forecastPreview: rainBarColor=Solid in the light theme uses DarkGray, not black', () => {
  const state = { barSource: 'rain', rainBarColor: 'white', secondaryLine: 'off', windScale: 'mid', dayNightShading: false, theme: 'light' };
  const svg = FC.forecastPreview(state, { color: true });
  assert.ok(/width="9"[^>]*fill="#555555"/.test(svg), 'a DarkGray solid rain bar');
  assert.ok(/width="12"[^>]*fill="#555555"/.test(svg), 'the Rain legend swatch is DarkGray too');
  assert.equal(svg.indexOf('fill="#000000"'), -1, 'never a plain black fill in the light theme');
});


test('radarPreview (metno): point provider renders like rainbow — no nearby bars or legend', () => {
  const metno = RD.radarPreview({ radarProvider: 'metno', radarColor: 'multicolor', rainCountdownHorizon: '0' }, { color: true });
  const rainbow = RD.radarPreview({ radarProvider: 'rainbow', radarColor: 'multicolor', rainCountdownHorizon: '0' }, { color: true });
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
  assert.deepEqual(FC.pressureCurves, PRESSURE_SCALE_CURVE_HPA);
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
  const svg = FC.forecastPreview(
    { dayNightShading: false, barSource: 'off', secondaryLine: 'precip_prob',
      secondaryLineFill: false, thirdLine: 'uv' },
    { color: true });
  const dots = (svg.match(/width="9"[^>]*fill="#FF00FF"/g) || []).length;
  assert.equal(dots, 6, '11 hour columns minus 5 genuine-zero hours (indices 5-9)');
});

test('pressure dots: a below-floor reading still draws (real data, not skipped like a zero)', () => {
  const svg = FC.forecastPreview(
    { dayNightShading: false, barSource: 'off', secondaryLine: 'precip_prob',
      secondaryLineFill: false, thirdLine: 'pressure', pressureScale: 'low' },
    { color: true });
  // Scope to width="9" (the dot's bar-aligned width, bw) so the count isn't polluted by
  // the legend's width="3.2" color swatch, which also uses the pressure hue.
  const dots = (svg.match(/width="9"[^>]*fill="#FF5500"/g) || []).length;
  assert.equal(dots, 11, 'all 11 hour-column dots render, including the below-floor one');
});

test('pressure main metric renders a line inside the plot, not pinned to the top', () => {
  const svg = FC.forecastPreview(
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
    const svg = FC.forecastPreview(
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

// --- the Graph-colors sheet reset (blocks.js resetGraphColors) ---------------
// The key list arrives from the SCHEMA through the button's data-action-arg, so
// blocks.js holds no copy of it and cannot drift; the test hands it the same comma
// list schema.js builds (its order is pinned in test/config-schema.test.js).
const GRAPH_COLOR_KEYS = ['graphMainColor', 'graphFillColor', 'graphSecondColor',
  'nightHatchColor', 'nightBoundaryColor', 'nightFillColor']
  .reduce((acc, stem) => acc.concat([stem + 'Dark', stem + 'Light']), []);
// The engine's stored-shape resolver: '' is every picker's schema default (Auto).
const graphDefaultOf = (key) => (GRAPH_COLOR_KEYS.indexOf(key) >= 0 ? '' : 'NOT-A-GRAPH-KEY');

test('resetGraphColors returns every listed key to Auto and touches nothing else', () => {
  const S = { secondaryLine: 'wind', colorTime: 0xFFFFFF };
  GRAPH_COLOR_KEYS.forEach((key) => { S[key] = '#FF00FF'; });
  assert.equal(global.PConf.actions.resetGraphColors(GRAPH_COLOR_KEYS.join(','), S, { color: true }, graphDefaultOf),
    true, 'returns true so the engine re-renders the sheet');
  GRAPH_COLOR_KEYS.forEach((key) => assert.equal(S[key], '', key + ' is back on Auto'));
  assert.equal(S.secondaryLine, 'wind', 'a neighbouring setting is untouched');
  assert.equal(S.colorTime, 0xFFFFFF, 'another color picker is untouched');
});

test('resetGraphColors lands each key on its SCHEMA default, never a mirrored literal', () => {
  const S = { graphMainColorDark: '#FF0000' };
  global.PConf.actions.resetGraphColors('graphMainColorDark', S, {}, () => '#123456');
  assert.equal(S.graphMainColorDark, '#123456', 'the value came from the resolver');
});

test('resetGraphColors is a no-op without a key list, a state or a resolver', () => {
  const S = { graphMainColorDark: '#FF0000' };
  assert.equal(global.PConf.actions.resetGraphColors('', S, {}, graphDefaultOf), false, 'no key list');
  assert.equal(global.PConf.actions.resetGraphColors('graphMainColorDark', null, {}, graphDefaultOf), false, 'no state');
  assert.equal(global.PConf.actions.resetGraphColors('graphMainColorDark', S, {}, null), false, 'no resolver');
  assert.equal(S.graphMainColorDark, '#FF0000', 'nothing was written');
});
