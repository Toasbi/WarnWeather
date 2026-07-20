// test/config-blocks.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
global.PConf = {
  blocks: (function () { var m = {}; return { register: (id, fn) => { m[id] = fn; }, get: (id) => m[id] }; })(),
  optionsResolvers: (function () { var m = {}; return { register: (id, fn) => { m[id] = fn; }, get: (id) => m[id] }; })(),
  defaultsResolvers: (function () { var m = {}; return { register: (id, fn) => { m[id] = fn; }, get: (id) => m[id] }; })()
};
const B = require('../src/pkjs/settings/blocks.js');

test('forecastPreview returns an SVG with the rain bars rendered', () => {
  const fc = B.forecastPreview({ dayNightShading: true, barSource: 'rain', rainBarColor: 'multicolor', secondaryLine: 'precip_prob', secondaryLineFill: true, windScale: 'mid' }, { color: true });
  assert.ok(/^<svg/.test(fc) && fc.indexOf('</svg>') > 0, 'is an SVG document');
  assert.ok(fc.indexOf('fill="#00FF00"') > -1, 'multicolor rain bars actually render (not an empty frame)');
});
test('radarPreview: off message vs SVG', () => {
  assert.ok(B.radarPreview({ radarProvider: 'disabled', radarColor: 'multicolor' }, { color: true }).indexOf('Radar off') >= 0);
  assert.ok(/^<svg/.test(B.radarPreview({ radarProvider: 'dwd', radarColor: 'white' }, { color: true })));
});
// A multicolor radar band fill (e.g. #00FF00) appears on a color watch but never on B/W,
// where the bars are always solid white regardless of the (hidden) radarColor setting.
const GREEN_BAND = 'fill="#00FF00"';
test('radarPreview forces white bars on B/W even when setting says multicolor', () => {
  const color = B.radarPreview({ radarProvider: 'dwd', radarColor: 'multicolor' }, { color: true });
  const bw    = B.radarPreview({ radarProvider: 'dwd', radarColor: 'multicolor' }, { color: false });
  assert.ok(color.indexOf(GREEN_BAND) >= 0, 'color watch keeps multicolor bands');
  assert.equal(bw.indexOf(GREEN_BAND), -1, 'B/W watch draws no color bands');
  assert.ok(bw.indexOf('fill="#FFFFFF"') >= 0, 'B/W watch draws white bars');
});
test('forecastPreview forces white rain bars on B/W even when setting says multicolor', () => {
  const state = { dayNightShading: true, barSource: 'rain', rainBarColor: 'multicolor', secondaryLine: 'off' };
  const color = B.forecastPreview(state, { color: true });
  const bw    = B.forecastPreview(state, { color: false });
  assert.ok(color.indexOf(GREEN_BAND) >= 0, 'color watch keeps multicolor rain bands');
  assert.equal(bw.indexOf(GREEN_BAND), -1, 'B/W watch draws no color rain bands');
});
test('devStats: table only, no clear button; empty when disabled', () => {
  const ds = B.devStats({ devStatsEnabled: true }, {}, { devStats: JSON.stringify([{ t: Date.now(), k: 'weather', ok: 1, c: { forecast: 1 } }]) });
  assert.ok(ds.indexOf('Daily summary') >= 0);
  assert.equal(ds.indexOf('devStatsClearBtn'), -1, 'no live Clear button (now a toggle)');
  assert.equal(B.devStats({ devStatsEnabled: false }, {}, { devStats: '[]' }), '');
});
test('lastFetch formats success / Never / failed-attempt-with-error', () => {
  const lf = B.lastFetch({}, {}, { lastFetchSuccess: JSON.stringify({ time: Date.now(), name: 'Berlin' }), lastFetchAttempt: null });
  assert.ok(lf.indexOf('Berlin') >= 0);
  assert.ok(B.lastFetch({}, {}, {}).indexOf('Never') >= 0);
  // failed attempt newer than last success -> shows the attempt + error stage:code (inject.js:321-332)
  const failed = B.lastFetch({}, {}, {
    lastFetchSuccess: JSON.stringify({ time: 1000, name: 'Berlin' }),
    lastFetchAttempt: JSON.stringify({ time: Date.now(), name: 'Berlin', error: { stage: 'geocode', code: 401 } })
  });
  assert.ok(failed.indexOf('geocode') >= 0 && failed.indexOf('401') >= 0, 'shows error stage:code');
});
test('forecastPreview draws the secondary line per metric (solid, per-metric color)', () => {
  const base = { dayNightShading: false, barSource: 'off', windScale: 'mid', thirdLine: 'off' };
  assert.ok(B.forecastPreview(Object.assign({}, base, { secondaryLine: 'wind' }), { color: true }).indexOf('stroke="#FFFF00"') > -1, 'wind = yellow');
  assert.ok(B.forecastPreview(Object.assign({}, base, { secondaryLine: 'gust' }), { color: true }).indexOf('stroke="#FFFFFF"') > -1, 'gust = white');
  assert.ok(B.forecastPreview(Object.assign({}, base, { secondaryLine: 'uv' }), { color: true }).indexOf('stroke="#FF00FF"') > -1, 'uv = magenta');
});

test('forecastPreview draws the second metric as bar-aligned squares in its metric color, gated on thirdLine', () => {
  const base = { dayNightShading: false, barSource: 'off', windScale: 'mid', secondaryLine: 'precip_prob' };
  // uv = #FF00FF is unique to the second-metric squares (not used by text/background/bars).
  const withThird = B.forecastPreview(Object.assign({}, base, { thirdLine: 'uv' }), { color: true });
  const noThird   = B.forecastPreview(Object.assign({}, base, { thirdLine: 'off' }), { color: true });
  assert.ok(withThird.indexOf('<rect') > -1 && withThird.indexOf('fill="#FF00FF"') > -1,
    'second metric (uv) renders as filled magenta squares');
  assert.equal(withThird.indexOf('stroke-dasharray'), -1, 'no dotted-line styling anymore');
  assert.equal(noThird.indexOf('fill="#FF00FF"'), -1, 'no second-metric squares when it is off');
});

test('forecastPreview gust dots take a color distinct from the rain bars', () => {
  // barSource off isolates the dot color (#AAAAAA is also a multicolor bar band when bars are on).
  const base = { dayNightShading: false, barSource: 'off', windScale: 'mid', secondaryLine: 'precip_prob', thirdLine: 'gust' };
  const whiteBars = B.forecastPreview(Object.assign({}, base, { rainBarColor: 'white' }), { color: true });
  const multiBars = B.forecastPreview(Object.assign({}, base, { rainBarColor: 'multicolor' }), { color: true });
  assert.ok(whiteBars.indexOf('fill="#AAAAAA"') > -1, 'white bars → light gray gust dots');
  assert.equal(multiBars.indexOf('fill="#AAAAAA"'), -1, 'multicolor bars → white gust dots (not gray)');
});

test('forecastPreview never draws the second metric as the same metric as the main', () => {
  // duplicate metric → no second-metric squares; wind = #FFFF00 is only a fill for those squares.
  const svg = B.forecastPreview({ dayNightShading: false, barSource: 'off', windScale: 'mid', secondaryLine: 'wind', thirdLine: 'wind' }, { color: true });
  assert.equal(svg.indexOf('fill="#FFFF00"'), -1, 'duplicate metric → no second-metric squares');
});
test('registers all preview/util blocks into PConf.blocks', () => {
  ['forecastPreview','radarPreview','layoutPreview','layoutPreviewFlick','layoutPreviewCombined','devStats','lastFetch'].forEach((id) => assert.equal(typeof PConf.blocks.get(id), 'function'));
});

test('registers the statusSlot options resolver into PConf.optionsResolvers', () => {
  assert.equal(typeof PConf.optionsResolvers.get('statusSlot'), 'function');
});

test('blocks fallback palette equals buildPreviewPalette (no color drift)', () => {
  const { buildPreviewPalette } = require('../src/pkjs/settings/preview-palette.js');
  assert.deepEqual(B.previewPaletteFallback, buildPreviewPalette());
});

test('blocks barPermille matches rain-tier.rainPermille byte-for-byte', () => {
  const rt = require('../src/pkjs/weather/rain-tier.js');
  [0, 1, 2, 3, 5, 6, 20, 21, 50, 100, 101, 200, 255, 500, 1000].forEach((t) =>
    assert.equal(B.barPermille(t), rt.rainPermille(t), 'tenths=' + t));
});

test('the second metric (dots) spans the full plot width (no early stop)', () => {
  const svg = B.forecastPreview(
    { barSource: 'off', secondaryLine: 'precip_prob', thirdLine: 'gust', windScale: 'mid', dayNightShading: false },
    { color: true });
  const xs = (svg.match(/<rect x="([\d.]+)"/g) || []).map((m) => parseFloat(m.replace(/[^\d.]/g, '')));
  assert.ok(Math.max.apply(null, xs) > 180, 'a dot reaches the right edge (>180); got ' + Math.max.apply(null, xs));
});

test('UV line is continuous through zeros (single path that reaches the baseline)', () => {
  const svg = B.forecastPreview(
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
  const white = B.forecastPreview(Object.assign({}, base, { rainBarColor: 'white' }), { color: true });
  const multi = B.forecastPreview(Object.assign({}, base, { rainBarColor: 'multicolor' }), { color: true });
  // Rain-bar bands are width-9 rects; the legend gradient uses width-2.4, so scope to width="9".
  assert.ok(/width="9"[^>]*fill="#00FF00"/.test(multi), 'multicolor: a green tier band on a bar');
  assert.ok(!/width="9"[^>]*fill="#00FF00"/.test(white), 'white: no green tier band on a bar');
  assert.ok(/width="9"[^>]*fill="#FFFFFF"/.test(white), 'white: a solid white bar');
});

test('forecast grid: temp line spans the first tick to the last tick (edge to edge)', () => {
  const svg = B.forecastPreview(
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
  const svg = B.forecastPreview(
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
  const svg = B.forecastPreview(
    { barSource: 'rain', rainBarColor: 'white', secondaryLine: 'off', windScale: 'mid', dayNightShading: false },
    { color: true });
  assert.ok(svg.indexOf('>Rain<') >= 0, 'Rain legend present');
  assert.equal(svg.indexOf('width="2.4"'), -1, 'no tier-gradient swatches in the legend when bars are white');
  assert.ok(/width="12"[^>]*fill="#FFFFFF"/.test(svg), 'a solid white Rain swatch instead');
});

test('forecastPreview has no status bar (no location, sunset, or current-temp pill)', () => {
  const svg = B.forecastPreview(
    { dayNightShading: false, barSource: 'off', secondaryLine: 'off', windScale: 'mid' },
    { color: true });
  assert.equal(svg.indexOf('Berlin'), -1, 'no location label');
  assert.equal(svg.indexOf('21:29'), -1, 'no sunset time');
  assert.equal(svg.indexOf('>22°<'), -1, 'no current-temp pill');
});

test('B&W: series are white, temp thick (3) vs main thin (1), no hues', () => {
  const bw = B.forecastPreview(
    { barSource: 'rain', rainBarColor: 'multicolor', secondaryLine: 'wind', windScale: 'mid', dayNightShading: false },
    { color: false });
  assert.equal(bw.indexOf('fill="#00FF00"'), -1, 'no color rain bands on B&W');
  assert.equal(bw.indexOf('#FFFF00'), -1, 'wind hue not used on B&W (white instead)');
  assert.ok(bw.indexOf('stroke-width="3"') >= 0, 'temp curve thick (3)');
  assert.ok(bw.indexOf('stroke-width="1"') >= 0, 'main line thin (1)');
});

test('legend lists the shown series with palette colors (color watch)', () => {
  const svg = B.forecastPreview(
    { barSource: 'rain', rainBarColor: 'multicolor', secondaryLine: 'precip_prob', thirdLine: 'wind', windScale: 'mid', dayNightShading: false },
    { color: true });
  assert.ok(svg.indexOf('viewBox="0 0 200 124"') >= 0, 'compact frame');
  assert.ok(svg.indexOf('>Temp<') >= 0, 'Temp entry');
  assert.ok(svg.indexOf('>Precip %<') >= 0, 'main metric entry (Precip %)');
  assert.ok(svg.indexOf('>Wind<') >= 0, 'second metric entry (Wind)');
  assert.ok(svg.indexOf('>Rain<') >= 0, 'Rain entry (bars on)');
});

test('legend omits the second metric when thirdLine is off, and Rain when bars are off', () => {
  const svg = B.forecastPreview(
    { barSource: 'off', secondaryLine: 'uv', thirdLine: 'off', windScale: 'mid', dayNightShading: false },
    { color: true });
  assert.ok(svg.indexOf('>UV<') >= 0, 'main metric entry (UV)');
  assert.equal(svg.indexOf('>Rain<'), -1, 'no Rain entry when bars are off');
});

test('legend uses white style glyphs on B&W (no hues)', () => {
  const svg = B.forecastPreview(
    { barSource: 'rain', rainBarColor: 'multicolor', secondaryLine: 'wind', thirdLine: 'off', windScale: 'mid', dayNightShading: false },
    { color: false });
  assert.ok(svg.indexOf('>Temp<') >= 0 && svg.indexOf('>Wind<') >= 0 && svg.indexOf('>Rain<') >= 0);
  assert.equal(svg.indexOf('#FFFF00'), -1, 'no wind hue in the B&W legend');
});

test('legend shows the second metric as white dots on B&W (no hue)', () => {
  const svg = B.forecastPreview(
    { barSource: 'off', secondaryLine: 'wind', thirdLine: 'gust', windScale: 'mid', dayNightShading: false },
    { color: false });
  assert.ok(svg.indexOf('>Gust<') >= 0, 'second-metric legend entry (Gust) present');
  assert.ok(svg.indexOf('fill="#FFFFFF"') >= 0, 'second metric renders as white squares on B&W');
  assert.equal(svg.indexOf('#AAAAAA'), -1, 'no gust gray hue on B&W (white instead)');
});

test('radarPreview legend distinguishes exact-spot rain from nearby rain', () => {
  const color = B.radarPreview({ radarProvider: 'dwd', radarColor: 'multicolor', rainCountdownHorizon: '0' }, { color: true });
  const bw = B.radarPreview({ radarProvider: 'dwd', radarColor: 'multicolor', rainCountdownHorizon: '0' }, { color: false });
  assert.ok(color.indexOf('viewBox="0 0 200 118"') >= 0, 'frame sized to fit the legend snug under the chart');
  assert.ok(color.indexOf('>Rain at your exact spot<') >= 0, 'exact-spot label present');
  assert.ok(color.indexOf('>Nearby (2 km)<') >= 0, 'nearby label present');
  assert.ok(color.indexOf('fill="#00FF00"') >= 0, 'tier gradient (green) present on color');
  assert.ok(/<rect[^>]*fill="none"[^>]*stroke="#8A8F98"/.test(color), 'hollow grey nearby box present');
  assert.ok(bw.indexOf('>Rain at your exact spot<') >= 0 && bw.indexOf('>Nearby (2 km)<') >= 0, 'both labels on B&W too');
  assert.ok(/<rect[^>]*fill="none"[^>]*stroke="#8A8F98"/.test(bw), 'hollow grey nearby box on B&W too');
});

test('radarPreview shows the countdown band ("Rain in 15\'") when the countdown is on', () => {
  const svg = B.radarPreview({ radarProvider: 'dwd', radarColor: 'multicolor', rainCountdownHorizon: '60' }, { color: true });
  assert.ok(svg.indexOf("Rain in 15'") >= 0, 'countdown text present');
  assert.ok(svg.indexOf('viewBox="0 0 200 138"') >= 0, 'frame grew by the 20px band height');
});

test('radarPreview hides the countdown band when the countdown is Off', () => {
  const svg = B.radarPreview({ radarProvider: 'dwd', radarColor: 'multicolor', rainCountdownHorizon: '0' }, { color: true });
  assert.equal(svg.indexOf("Rain in 15'"), -1, 'no countdown text when Off');
  assert.ok(svg.indexOf('viewBox="0 0 200 118"') >= 0, 'frame back to the no-band height');
});

test('radarPreview never shows the countdown band on aplite', () => {
  const svg = B.radarPreview({ radarProvider: 'dwd', radarColor: 'multicolor', rainCountdownHorizon: '60' }, { color: false, platform: 'aplite' });
  assert.equal(svg.indexOf("Rain in 15'"), -1, 'no band on aplite even with a horizon set');
  assert.ok(svg.indexOf('viewBox="0 0 200 118"') >= 0, 'aplite frame stays at the no-band height');
});

test('countdown glyph is tier-coloured on color, white on B&W; text stays white', () => {
  const color = B.radarPreview({ radarProvider: 'dwd', radarColor: 'multicolor', rainCountdownHorizon: '60' }, { color: true });
  const bw = B.radarPreview({ radarProvider: 'dwd', radarColor: 'multicolor', rainCountdownHorizon: '60' }, { color: false });
  assert.ok(/stroke="#00FF00"/.test(color), 'glyph uses the green tier stroke on color');
  assert.equal(/stroke="#00FF00"/.test(bw), false, 'no green glyph stroke on B&W');
  assert.ok(color.indexOf('fill="#FFFFFF"') >= 0, 'white band text present on color');
});

test('precip secondary line draws the cobalt fill on color and a dither on B&W', () => {
  const base = { barSource: 'off', secondaryLine: 'precip_prob', secondaryLineFill: true, windScale: 'mid', dayNightShading: false };
  const color = B.forecastPreview(base, { color: true });
  assert.ok(color.indexOf('fill="#0055AA"') >= 0 && color.indexOf('fill-opacity="0.25"') >= 0,
    'color: translucent cobalt precip fill present');
  const bw = B.forecastPreview(base, { color: false });
  assert.ok(bw.indexOf('fill="url(#fillhatch)"') >= 0, 'B&W: precip fill uses the dither stipple pattern');
  assert.equal(bw.indexOf('fill="#0055AA"'), -1, 'B&W: no solid cobalt fill');
});

test('area fill works for every main metric, in its palette fill color', () => {
  // Fill colors are sourced from forecast-series.FILL_COLORS: wind=ArmyGreen, gust=DarkGray, uv=Purple.
  const base = { barSource: 'off', windScale: 'mid', dayNightShading: false };
  const wind = B.forecastPreview(Object.assign({}, base, { secondaryLine: 'wind', secondaryLineFill: true }), { color: true });
  const gust = B.forecastPreview(Object.assign({}, base, { secondaryLine: 'gust', secondaryLineFill: true }), { color: true });
  const uv = B.forecastPreview(Object.assign({}, base, { secondaryLine: 'uv', secondaryLineFill: true }), { color: true });
  assert.ok(wind.indexOf('fill="#555500"') >= 0, 'wind fill = ArmyGreen');
  assert.ok(gust.indexOf('fill="#555555"') >= 0, 'gust fill = DarkGray');
  assert.ok(uv.indexOf('fill="#AA00AA"') >= 0, 'uv fill = Purple');
  const off = B.forecastPreview(Object.assign({}, base, { secondaryLine: 'wind', secondaryLineFill: false }), { color: true });
  assert.equal(off.indexOf('fill="#555500"'), -1, 'no fill when the toggle is off');
});

test('area fill uses the brighter light-theme variant when theme is light', () => {
  const base = { barSource: 'off', windScale: 'mid', dayNightShading: false, theme: 'light' };
  const wind = B.forecastPreview(Object.assign({}, base, { secondaryLine: 'wind', secondaryLineFill: true }), { color: true });
  const uv = B.forecastPreview(Object.assign({}, base, { secondaryLine: 'uv', secondaryLineFill: true }), { color: true });
  assert.ok(wind.indexOf('fill="#AAFF55"') >= 0, 'wind light fill = Inchworm');
  assert.equal(wind.indexOf('fill="#555500"'), -1, 'not the dark-theme ArmyGreen fill');
  assert.ok(uv.indexOf('fill="#FF55FF"') >= 0, 'uv light fill = ShockingPink');
});

test('precip line + fill go one step darker in the light theme (readability round)', () => {
  const base = { barSource: 'off', windScale: 'mid', dayNightShading: false, secondaryLine: 'precip_prob', theme: 'light' };
  const line = B.forecastPreview(base, { color: true });
  assert.ok(line.indexOf('stroke="#00AAFF"') >= 0, 'precip light line = VividCerulean');
  assert.equal(line.indexOf('stroke="#55AAFF"'), -1, 'not the dark-theme PictonBlue line');
  const filled = B.forecastPreview(Object.assign({}, base, { secondaryLineFill: true }), { color: true });
  assert.ok(filled.indexOf('fill="#55FFFF"') >= 0, 'precip light fill = ElectricBlue (one step darker than Celeste)');
  assert.equal(filled.indexOf('fill="#AAFFFF"'), -1, 'not the pre-fix Celeste fill');
});

test('presetContents resolves each named preset directly (layoutPreset set)', () => {
    const vc = require('../src/pkjs/view-cycle.js');
    assert.deepEqual(B.presetContents({ layoutPreset: 'fullCal', healthMode: 'off', radarProvider: 'disabled' }),
        [vc.spec(vc.TIER_FULL, vc.TOP_CAL, vc.BODY_FC, vc.ST_W)]);
    assert.deepEqual(B.presetContents({ layoutPreset: 'compactCal', healthMode: 'off', radarProvider: 'disabled' }),
        [vc.spec(vc.TIER_COMPACT, vc.TOP_CAL, vc.BODY_FC, vc.ST_W)]);
    assert.deepEqual(B.presetContents({ layoutPreset: 'compactDense', healthMode: 'off', radarProvider: 'disabled' }),
        [vc.spec(vc.TIER_COMPACT, vc.TOP_CAL, vc.BODY_FC, vc.ST_W)]);
    assert.deepEqual(B.presetContents({ layoutPreset: 'noCal', healthMode: 'off', radarProvider: 'disabled' }),
        [vc.spec(vc.TIER_NONE, vc.TOP_EMPTY, vc.BODY_FC, vc.ST_W)]);
});

test('presetContents falls back to compactCal for an unrecognised preset key', () => {
    assert.deepEqual(B.presetContents({ layoutPreset: 'bogus', healthMode: 'off', radarProvider: 'disabled' }),
        B.presetContents({ layoutPreset: 'compactCal', healthMode: 'off', radarProvider: 'disabled' }));
});

test('presetContents migrates legacy layoutPreset/topViewMode settings via view-cycle.js', () => {
    // classic/radarLast/healthFirst -> compactCal; forecast -> noCal; fullCal unchanged.
    const compactCal = B.presetContents({ layoutPreset: 'compactCal', healthMode: 'off', radarProvider: 'disabled' });
    assert.deepEqual(B.presetContents({ layoutPreset: 'classic', healthMode: 'off', radarProvider: 'disabled' }), compactCal);
    assert.deepEqual(B.presetContents({ layoutPreset: 'radarLast', healthMode: 'off', radarProvider: 'disabled' }), compactCal);
    assert.deepEqual(B.presetContents({ layoutPreset: 'healthFirst', healthMode: 'off', radarProvider: 'disabled' }), compactCal);
    assert.deepEqual(B.presetContents({ layoutPreset: 'forecast', healthMode: 'off', radarProvider: 'disabled' }),
        B.presetContents({ layoutPreset: 'noCal', healthMode: 'off', radarProvider: 'disabled' }));
    assert.deepEqual(B.presetContents({ topViewMode: 'full', healthMode: 'off', radarProvider: 'disabled' }),
        B.presetContents({ layoutPreset: 'fullCal', healthMode: 'off', radarProvider: 'disabled' }), 'topViewMode full -> fullCal');
    assert.deepEqual(B.presetContents({ topViewMode: 'none', healthMode: 'off', radarProvider: 'disabled' }),
        B.presetContents({ layoutPreset: 'noCal', healthMode: 'off', radarProvider: 'disabled' }), 'topViewMode none -> noCal');
    assert.deepEqual(B.presetContents({ healthMode: 'off', radarProvider: 'disabled' }), compactCal, 'nothing set -> compactCal');
});

test('presetContents reads healthMode/radarProvider off state to grow/shrink the cycle', () => {
    assert.equal(B.presetContents({ layoutPreset: 'compactCal', healthMode: 'off', radarProvider: 'disabled' }).length, 1);
    assert.equal(B.presetContents({ layoutPreset: 'compactCal', healthMode: 'off', radarProvider: 'dwd' }).length, 2, 'radar adds a slot');
    assert.equal(B.presetContents({ layoutPreset: 'compactCal', healthMode: 'status', radarProvider: 'disabled' }).length, 2, 'health status adds a slot');
    assert.equal(B.presetContents({ layoutPreset: 'compactCal', healthMode: 'status', radarProvider: 'dwd' }).length, 3, 'both add up to three');
    // radarProvider unset (not explicitly 'disabled') is treated as enabled.
    assert.equal(B.presetContents({ layoutPreset: 'compactCal', healthMode: 'off' }).length, 2, 'unset radarProvider counts as enabled');
});

test('contentBands renders each tier\'s band ordering', () => {
    const vc = require('../src/pkjs/view-cycle.js');
    assert.deepEqual(B.contentBands(vc.spec(vc.TIER_FULL, vc.TOP_CAL, vc.BODY_FC, vc.ST_W)).map((b) => b.label),
        ['Watch Status', 'Calendar (3 rows)', 'Clock', 'Forecast Status', 'Forecast'], 'full tier: clock before status');
    assert.deepEqual(B.contentBands(vc.spec(vc.TIER_COMPACT, vc.TOP_CAL, vc.BODY_FC, vc.ST_H)).map((b) => b.label),
        ['Watch Status', 'Calendar (2 rows)', 'Health Status', 'Clock', 'Forecast'], 'compact tier: status before clock');
    assert.deepEqual(B.contentBands(vc.spec(vc.TIER_COMPACT, vc.TOP_CAL, vc.BODY_FC, vc.ST_W)).map((b) => b.label),
        ['Watch Status', 'Calendar (2 rows)', 'Forecast Status', 'Clock', 'Forecast'], 'compact tier: forecast status before clock (non-dual)');
    assert.deepEqual(B.contentBands(vc.spec(vc.TIER_NONE, vc.TOP_EMPTY, vc.BODY_RADAR, vc.ST_W)).map((b) => b.label),
        ['Watch Status', 'Clock', 'Radar Status', 'Radar'], 'none tier: no top band, big body; radar view uses the Radar status bar');
    assert.deepEqual(B.contentBands(vc.spec(vc.TIER_FULL, vc.TOP_RADAR, vc.BODY_FC, vc.ST_NONE)).map((b) => b.label),
        ['Watch Status', 'Radar', 'Clock', 'Forecast'], 'radar rides the top band; ST_NONE hides both status bars');
    assert.strictEqual(B.contentBands(null), null, 'a null/disabled slot has no bands');
});

// The Forecast status bar becomes the Radar status bar whenever the view shows radar (top band
// or body) — mirrors main_window.c's (top == TOP_RADAR || body == BODY_RADAR) ?
// STATUS_LINE_RADAR : STATUS_LINE_FORECAST. A forecast-body view keeps "Forecast Status".
test('contentBands labels the configurable bar "Radar Status" for a radar view', () => {
    const vc = require('../src/pkjs/view-cycle.js');
    const label = (spec) => B.contentBands(spec).map((b) => b.label);
    // radar as the body (the radar flick stop)
    assert.ok(label(vc.spec(vc.TIER_COMPACT, vc.TOP_CAL, vc.BODY_RADAR, vc.ST_W)).indexOf('Radar Status') >= 0,
        'radar-body view reads Radar Status');
    assert.ok(label(vc.spec(vc.TIER_COMPACT, vc.TOP_CAL, vc.BODY_RADAR, vc.ST_W)).indexOf('Forecast Status') < 0,
        'radar-body view has no Forecast Status label');
    // radar riding the top band with the configurable status bar present
    assert.ok(label(vc.spec(vc.TIER_FULL, vc.TOP_RADAR, vc.BODY_FC, vc.ST_W)).indexOf('Radar Status') >= 0,
        'top-radar view with a status bar reads Radar Status');
    // dual status on a radar view: the forecast half becomes Radar Status, health unchanged
    const dual = label(vc.spec(vc.TIER_COMPACT, vc.TOP_CAL, vc.BODY_RADAR, vc.ST_D));
    assert.ok(dual.indexOf('Radar Status') >= 0 && dual.indexOf('Health Status') >= 0,
        'dual radar view: Radar Status + Health Status');
    // a plain forecast view still reads Forecast Status
    assert.ok(label(vc.spec(vc.TIER_COMPACT, vc.TOP_CAL, vc.BODY_FC, vc.ST_W)).indexOf('Forecast Status') >= 0,
        'forecast-body view keeps Forecast Status');
});

test('contentBands renders dual as two status rows', () => {
    const vc = require('../src/pkjs/view-cycle.js');
    const bands = B.contentBands(vc.spec(vc.TIER_COMPACT, vc.TOP_CAL, vc.BODY_FC, vc.ST_D));
    const labels = bands.map((b) => b.label);
    assert.ok(labels.indexOf('Health Status') >= 0 && labels.indexOf('Forecast Status') >= 0);
});

// A status bar occupies exactly the space freed by dropping the 3rd calendar row, so
// the compact calendar + its status band read as tall as the full 3-row calendar.
test('contentBands: Cal2 + gap + status = Cal3 (status = the freed calendar row)', () => {
    const vc = require('../src/pkjs/view-cycle.js');
    const GAP = 2; // renderers stack bands with a 2px gap
    const full = B.contentBands(vc.spec(vc.TIER_FULL, vc.TOP_CAL, vc.BODY_FC, vc.ST_W));
    const compact = B.contentBands(vc.spec(vc.TIER_COMPACT, vc.TOP_CAL, vc.BODY_FC, vc.ST_W));
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
        const bands = B.contentBands(vc.spec(vc.TIER_COMPACT, vc.TOP_CAL, body, vc.ST_W));
        const last = bands[bands.length - 1];
        assert.equal(last.flex, true, 'the last (body) band is marked flex');
        bands.slice(0, -1).forEach((b) => assert.ok(!b.flex, b.label + ' is fixed-height'));
    });
});

test('resolveBandHeights: the flex band absorbs the slack so bands + gaps fill availH', () => {
    const bands = [{ h: 12 }, { h: 20 }, { h: 20, flex: true }];
    const heights = B.resolveBandHeights(bands, 100, 2);
    const total = heights.reduce((s, h) => s + h, 0) + (bands.length - 1) * 2;
    assert.equal(total, 100, 'bands + gaps exactly fill the available height');
    assert.equal(heights[2], 100 - 12 - 20 - 2 * 2, 'flex band = remaining space after fixed bands + gaps');
});

test('resolveBandHeights: the flex band never collapses below a visible minimum', () => {
    const heights = B.resolveBandHeights([{ h: 90 }, { h: 20, flex: true }], 50, 2);
    assert.ok(heights[1] >= 12, 'flex band clamped to a visible minimum instead of going negative');
});

test('layoutPreview renders the resolved preset\'s default (slot 0) content', () => {
    assert.ok(B.layoutPreview({ layoutPreset: 'fullCal' }, {}, {}).indexOf('Calendar (3 rows)') >= 0,
        'fullCal default is the 3-row calendar view');
    assert.ok(B.layoutPreview({ layoutPreset: 'noCal' }, {}, {}).indexOf('Calendar') === -1,
        'noCal preset default has no calendar');
});

test('layoutPreviewFlick renders the first flick slot, or nothing when the cycle has none', () => {
    assert.ok(B.layoutPreviewFlick({ layoutPreset: 'compactCal', radarProvider: 'dwd', healthMode: 'off' }, {}, {}).indexOf('Radar') >= 0,
        'compactCal + radar flick 1 is radar');
    assert.ok(B.layoutPreviewFlick({ layoutPreset: 'compactCal', radarProvider: 'dwd', healthMode: 'status' }, {}, {}).indexOf('Health Status') >= 0,
        'compactCal + health status flick 1 shows health status');
    assert.strictEqual(B.layoutPreviewFlick({ layoutPreset: 'compactCal', radarProvider: 'disabled', healthMode: 'off' }, {}, {}), '',
        'a single-slot cycle (no radar, no health) has no flick');
});

test('layoutPreviewCombined: one column per cycle slot, headers Default/Flick 1/Flick 2', () => {
    const one = B.layoutPreviewCombined({ layoutPreset: 'compactCal', radarProvider: 'disabled', healthMode: 'off' }, {}, {});
    assert.ok(one.indexOf('Default') >= 0, 'Default header present');
    assert.strictEqual(one.indexOf('Flick 1'), -1, 'no flick column for a single-slot cycle');

    const two = B.layoutPreviewCombined({ layoutPreset: 'compactCal', radarProvider: 'dwd', healthMode: 'off' }, {}, {});
    assert.ok(two.indexOf('Default') >= 0 && two.indexOf('Flick 1') >= 0, 'Default + Flick 1 present');
    assert.ok(two.indexOf('Radar') >= 0, 'flick 1 column shows the Radar band');
    assert.strictEqual(two.indexOf('Flick 2'), -1, 'no third column for a two-slot cycle');

    const three = B.layoutPreviewCombined({ layoutPreset: 'compactDense', radarProvider: 'dwd', healthMode: 'all' }, {}, {});
    assert.ok(three.indexOf('Default') >= 0 && three.indexOf('Flick 1') >= 0 && three.indexOf('Flick 2') >= 0,
        'all three column headers present for a three-slot cycle');
});

test('layoutPreviewCombined: toggling radar/health grows or shrinks the columns (no dimming, no notes)', () => {
    const radarOff = B.layoutPreviewCombined({ layoutPreset: 'compactCal', radarProvider: 'disabled', healthMode: 'off' }, {}, {});
    const radarOn = B.layoutPreviewCombined({ layoutPreset: 'compactCal', radarProvider: 'dwd', healthMode: 'off' }, {}, {});
    assert.strictEqual(radarOff.indexOf('Radar'), -1, 'radar column absent when radar is disabled');
    assert.ok(radarOn.indexOf('Radar') >= 0, 'radar column present once radar is enabled');
    assert.strictEqual(radarOn.indexOf('needs radar'), -1, 'no availability note anywhere');

    const healthOff = B.layoutPreviewCombined({ layoutPreset: 'compactCal', radarProvider: 'disabled', healthMode: 'off' }, {}, {});
    const healthOn = B.layoutPreviewCombined({ layoutPreset: 'compactCal', radarProvider: 'disabled', healthMode: 'status' }, {}, {});
    assert.strictEqual(healthOff.indexOf('Health Status'), -1, 'health column absent when health is off');
    assert.ok(healthOn.indexOf('Health Status') >= 0, 'health column present once health is on');
    assert.strictEqual(healthOn.indexOf('needs health'), -1, 'no availability note anywhere');
});

test('layoutPreviewCombined: columns span the full window width, flush left (no side padding)', () => {
    const svg = B.layoutPreviewCombined({ layoutPreset: 'compactCal', radarProvider: 'dwd', healthMode: 'off' }, {}, {});
    // Left (Default) column starts flush at x=0 (no black side padding inset).
    assert.ok(svg.indexOf('<rect x="0" y="16"') >= 0, 'left column band starts at x=0');
});

test('radarPreview (rainbow): no nearby outline bars and no "Nearby (2 km)" legend', () => {
  const dwd = B.radarPreview({ radarProvider: 'dwd', radarColor: 'multicolor', rainCountdownHorizon: '0' }, { color: true });
  const rainbow = B.radarPreview({ radarProvider: 'rainbow', radarColor: 'multicolor', rainCountdownHorizon: '0' }, { color: true });
  assert.ok(dwd.indexOf('>Nearby (2 km)<') >= 0, 'dwd keeps the nearby legend');
  assert.equal(rainbow.indexOf('>Nearby (2 km)<'), -1, 'rainbow drops the nearby legend');
  assert.ok(rainbow.indexOf('>Rain at your exact spot<') >= 0, 'exact-spot legend stays');
  assert.ok(dwd.indexOf('fill="none" stroke="rgba(255,255,255,0.30)"') >= 0, 'dwd draws hollow nearby bars');
  assert.equal(rainbow.indexOf('fill="none" stroke="rgba(255,255,255,0.30)"'), -1, 'rainbow draws no hollow nearby bars');
});

test('radarPreview (rainbow) still renders exact bars and the countdown band', () => {
  const svg = B.radarPreview({ radarProvider: 'rainbow', radarColor: 'multicolor', rainCountdownHorizon: '60' }, { color: true });
  assert.ok(/^<svg/.test(svg), 'renders an SVG, not the off message');
  assert.ok(svg.indexOf("Rain in 15'") >= 0, 'countdown band applies to rainbow too');
});

test('forecastPreview: light theme flips the canvas background to white', () => {
  const state = { dayNightShading: true, barSource: 'rain', rainBarColor: 'multicolor', secondaryLine: 'off', theme: 'light' };
  const svg = B.forecastPreview(state, { color: true });
  assert.ok(svg.indexOf('fill="#FFFFFF"') >= 0, 'canvas background is now white');
});

test('forecastPreview: bw theme on a color env renders the B&W path, not multicolor', () => {
  const state = { dayNightShading: true, barSource: 'rain', rainBarColor: 'multicolor', secondaryLine: 'off', theme: 'bw' };
  const color = B.forecastPreview({ ...state, theme: 'dark' }, { color: true });
  const bw = B.forecastPreview(state, { color: true });
  assert.ok(color.indexOf('fill="#00FF00"') >= 0, 'sanity: dark theme on a color env keeps multicolor bands');
  assert.equal(bw.indexOf('fill="#00FF00"'), -1, 'bw theme drops multicolor rain bands even though env.color is true');
});

test('forecastPreview: bw-light theme on a color env renders the B&W path with a white canvas (light polarity)', () => {
  const state = { dayNightShading: true, barSource: 'rain', rainBarColor: 'multicolor', secondaryLine: 'off', theme: 'bw-light' };
  const svg = B.forecastPreview(state, { color: true });
  assert.equal(svg.indexOf('fill="#00FF00"'), -1, 'bw-light theme drops multicolor rain bands even though env.color is true');
  assert.ok(svg.indexOf('fill="#FFFFFF"') >= 0, 'canvas background is white (light polarity)');
});

test('radarPreview: light theme flips the canvas background to white', () => {
  const svg = B.radarPreview({ radarProvider: 'dwd', radarColor: 'multicolor', theme: 'light' }, { color: true });
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
  const svg = B.radarPreview({ radarProvider: 'dwd', radarColor: 'multicolor', theme: 'bw' }, { color: true });
  assert.equal(svg.indexOf('fill="#00FF00"'), -1, 'no multicolor bands');
  assert.ok(svg.indexOf('fill="#000000" stroke="#FFFFFF" stroke-width="1"') >= 0,
    'exact bars are opaque black-filled with a white outline (mirrors the watch\'s theme_bg()-filled + theme_fg()-outlined bar)');
});

test('radarPreview: bw-light theme on a color env outlines the exact bars in black, filled opaque white (light polarity)', () => {
  const svg = B.radarPreview({ radarProvider: 'dwd', radarColor: 'multicolor', theme: 'bw-light' }, { color: true });
  assert.equal(svg.indexOf('fill="#00FF00"'), -1, 'no multicolor bands');
  assert.ok(svg.indexOf('width="200" height="118" fill="#FFFFFF"') >= 0, 'canvas background is white');
  assert.ok(svg.indexOf(OUTLINE_MARK) >= 0,
    'exact bars are opaque white-filled with a black outline — the polarity mirror of bw, not a hollow box');
});

test('forecastPreview: bw/bw-light rain bars are opaque (filled with the polarity background), not hollow outlines', () => {
  const base = { barSource: 'rain', rainBarColor: 'multicolor', secondaryLine: 'off', windScale: 'mid', dayNightShading: false };
  const bw = B.forecastPreview(Object.assign({}, base, { theme: 'bw' }), { color: true });
  assert.ok(bw.indexOf('fill="#000000" stroke="#FFFFFF" stroke-width="1"') >= 0,
    'bw rain bars are opaque black-filled with a white outline');
  const bwLight = B.forecastPreview(Object.assign({}, base, { theme: 'bw-light' }), { color: true });
  assert.ok(bwLight.indexOf(OUTLINE_MARK) >= 0,
    'bw-light rain bars are opaque white-filled with a black outline');
});

test('forecastPreview: bw rain bars draw above (after) the dithered metric-area fill, matching the watch\'s z-order', () => {
  const state = {
    barSource: 'rain', rainBarColor: 'multicolor', windScale: 'mid', dayNightShading: false, theme: 'bw',
    secondaryLine: 'precip_prob', secondaryLineFill: true
  };
  const svg = B.forecastPreview(state, { color: true });
  const fillIdx = svg.indexOf('fill="url(#fillhatch)"');
  const barIdx = svg.indexOf('fill="#000000" stroke="#FFFFFF" stroke-width="1"');
  assert.ok(fillIdx >= 0, 'the dithered metric-area fill is present');
  assert.ok(barIdx >= 0, 'an outlined rain bar is present');
  assert.ok(fillIdx < barIdx, 'the dithered area fill is drawn before the bars, so bars paint over it (watch z-order: AREA then BARS)');
});

test('radarPreview: radarColor=Solid in the light theme uses DarkGray, not black', () => {
  // rainCountdownHorizon: '0' — the countdown band's own text is theme_fg() (black in
  // light polarity), unrelated to bar/legend fill; excluded here to isolate the bars.
  const svg = B.radarPreview({ radarProvider: 'dwd', radarColor: 'white', theme: 'light', rainCountdownHorizon: '0' }, { color: true });
  assert.ok(svg.indexOf('width="200" height="118" fill="#FFFFFF"') >= 0, 'canvas background is white');
  assert.ok(svg.indexOf('fill="#555555"') >= 0, 'solid bars/legend render DarkGray');
  assert.equal(svg.indexOf('fill="#000000"'), -1, 'never a plain black bar/legend fill in the light theme');
});

test('forecastPreview: rainBarColor=Solid in the light theme uses DarkGray, not black', () => {
  const state = { barSource: 'rain', rainBarColor: 'white', secondaryLine: 'off', windScale: 'mid', dayNightShading: false, theme: 'light' };
  const svg = B.forecastPreview(state, { color: true });
  assert.ok(/width="9"[^>]*fill="#555555"/.test(svg), 'a DarkGray solid rain bar');
  assert.ok(/width="12"[^>]*fill="#555555"/.test(svg), 'the Rain legend swatch is DarkGray too');
  assert.equal(svg.indexOf('fill="#000000"'), -1, 'never a plain black fill in the light theme');
});

test('layoutPreview / layoutPreviewCombined: light theme flips the canvas background to white', () => {
  const state = { layoutPreset: 'compactCal', healthMode: 'off', radarProvider: 'disabled', theme: 'light' };
  assert.ok(B.layoutPreview(state, {}).indexOf('fill="#FFFFFF"') >= 0);
  assert.ok(B.layoutPreviewCombined(state, {}).indexOf('fill="#FFFFFF"') >= 0);
});

test('layoutPreview / layoutPreviewCombined: bw-light theme also flips the canvas background to white', () => {
  const state = { layoutPreset: 'compactCal', healthMode: 'off', radarProvider: 'disabled', theme: 'bw-light' };
  assert.ok(B.layoutPreview(state, {}).indexOf('fill="#FFFFFF"') >= 0);
  assert.ok(B.layoutPreviewCombined(state, {}).indexOf('fill="#FFFFFF"') >= 0);
});

// The band-stack chrome (renderBandStack's band fill, renderBandColumn's band fill +
// empty-column placeholder) used to be a fixed dark hex regardless of theme, so a light
// canvas still showed dark "cards" floating on it. Both now wash previewInk's rgba
// helper — the same theme-relative mechanism the other previews use for dividers/
// gridlines — instead of a hardcoded color.
test('layoutPreview / layoutPreviewFlick / layoutPreviewCombined: light theme themes the band chrome too, not just the canvas', () => {
  const state = { layoutPreset: 'compactCal', healthMode: 'status', radarProvider: 'dwd', theme: 'light' };
  const preview = B.layoutPreview(state, {});
  const flick = B.layoutPreviewFlick(state, {});
  const combined = B.layoutPreviewCombined(state, {});
  assert.equal(preview.indexOf('#1B1F27'), -1, 'layoutPreview band fill is no longer hardcoded dark');
  assert.ok(preview.indexOf('rgba(0,0,0,0.12)') >= 0, 'layoutPreview band fill washes black-on-white in light theme');
  assert.equal(flick.indexOf('#1B1F27'), -1, 'layoutPreviewFlick band fill is no longer hardcoded dark');
  assert.ok(flick.indexOf('rgba(0,0,0,0.12)') >= 0, 'layoutPreviewFlick band fill washes black-on-white in light theme');
  assert.equal(combined.indexOf('#1B1F27'), -1, 'layoutPreviewCombined band fill is no longer hardcoded dark');
  assert.equal(combined.indexOf('#12151C'), -1, 'layoutPreviewCombined placeholder fill is no longer hardcoded dark');
  assert.ok(combined.indexOf('rgba(0,0,0,0.12)') >= 0, 'layoutPreviewCombined band fill washes black-on-white in light theme');
});

test('layoutPreview / layoutPreviewFlick / layoutPreviewCombined: dark theme keeps the light-on-black band wash', () => {
  const state = { layoutPreset: 'compactCal', healthMode: 'status', radarProvider: 'dwd', theme: 'dark' };
  assert.ok(B.layoutPreview(state, {}).indexOf('rgba(255,255,255,0.12)') >= 0);
  assert.ok(B.layoutPreviewFlick(state, {}).indexOf('rgba(255,255,255,0.12)') >= 0);
  assert.ok(B.layoutPreviewCombined(state, {}).indexOf('rgba(255,255,255,0.12)') >= 0);
});

test('radarPreview (metno): point provider renders like rainbow — no nearby bars or legend', () => {
  const metno = B.radarPreview({ radarProvider: 'metno', radarColor: 'multicolor', rainCountdownHorizon: '0' }, { color: true });
  const rainbow = B.radarPreview({ radarProvider: 'rainbow', radarColor: 'multicolor', rainCountdownHorizon: '0' }, { color: true });
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
