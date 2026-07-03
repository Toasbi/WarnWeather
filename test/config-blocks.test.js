// test/config-blocks.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
global.PConf = { blocks: (function () { var m = {}; return { register: (id, fn) => { m[id] = fn; }, get: (id) => m[id] }; })() };
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

test('layoutPreview: Calendar band shows for full/compact, not none', () => {
    assert.ok(B.layoutPreview({ topViewMode: 'full' }, {}, {}).indexOf('Calendar') >= 0);
    assert.ok(B.layoutPreview({ topViewMode: 'compact' }, {}, {}).indexOf('Calendar') >= 0);
    assert.strictEqual(B.layoutPreview({ topViewMode: 'none' }, {}, {}).indexOf('Calendar'), -1);
});

test('layoutPreview: every mode returns an svg with Date/Clock/Weather status/Forecast bands', () => {
    ['full', 'compact', 'none'].forEach(function (m) {
        const svg = B.layoutPreview({ topViewMode: m }, {}, {});
        assert.strictEqual(svg.indexOf('<svg'), 0, m + ' returns an svg');
        ['Date', 'Clock', 'Weather status', 'Forecast'].forEach(function (label) {
            assert.ok(svg.indexOf(label) >= 0, m + ' has a ' + label + ' band');
        });
    });
});

test('layoutPreview: dualStatus shows Health status + Weather status in both status and all modes (compact/none, not full)', () => {
    ['status', 'all'].forEach((hm) => {
        const on = { dualStatus: true, healthMode: hm };
        const c = B.layoutPreview(Object.assign({ topViewMode: 'compact' }, on), {}, {});
        assert.ok(c.indexOf('Health status') >= 0 && c.indexOf('Weather status') >= 0, hm + ' compact shows both status lines');
        const n = B.layoutPreview(Object.assign({ topViewMode: 'none' }, on), {}, {});
        assert.ok(n.indexOf('Health status') >= 0 && n.indexOf('Weather status') >= 0, hm + ' none shows both status lines');
    });
    // Not applicable: full mode, or health off → single Weather status band, no Health status.
    assert.strictEqual(B.layoutPreview({ topViewMode: 'full', dualStatus: true, healthMode: 'status' }, {}, {}).indexOf('Health status'), -1);
    assert.strictEqual(B.layoutPreview({ topViewMode: 'compact', dualStatus: true, healthMode: 'off' }, {}, {}).indexOf('Health status'), -1);
    assert.ok(B.layoutPreview({ topViewMode: 'compact' }, {}, {}).indexOf('Weather status') >= 0);
});

test('layoutBandsFlick: all + dual keeps both status bands pinned and reveals the health graph on flick', () => {
    const labels = B.layoutBandsFlick({ topViewMode: 'compact', dualStatus: true, healthMode: 'all', radarProvider: 'disabled' }).map((x) => x.label);
    assert.ok(labels.indexOf('Health graph') >= 0, 'compact: forecast → health graph on flick');
    assert.ok(labels.indexOf('Health status') >= 0 && labels.indexOf('Weather status') >= 0, 'compact: both status bands remain');
    const none = B.layoutBandsFlick({ topViewMode: 'none', dualStatus: true, healthMode: 'all', radarProvider: 'disabled' }).map((x) => x.label);
    assert.ok(none.indexOf('Health') >= 0, 'none: big band cycles to Health (graph)');
    assert.ok(none.indexOf('Health status') >= 0 && none.indexOf('Weather status') >= 0, 'none: both status bands remain');
});

test('layoutBandsFlick: nothing to reveal (radar off + health off) returns null / empty preview', () => {
    const s = { topViewMode: 'compact', radarProvider: 'disabled', healthMode: 'off' };
    assert.strictEqual(B.layoutBandsFlick(s), null);
    assert.strictEqual(B.layoutPreviewFlick(s, {}, {}), '');
});

test('layoutPreviewFlick: full/compact with radar swaps Calendar → Radar', () => {
    const svg = B.layoutPreviewFlick({ topViewMode: 'compact', radarProvider: 'dwd', healthMode: 'off' }, {}, {});
    assert.ok(svg.indexOf('Radar') >= 0, 'shows Radar');
    assert.strictEqual(svg.indexOf('Calendar'), -1, 'calendar replaced');
});

test('layoutBandsFlick: healthMode status swaps Weather status → Health status, forecast unchanged', () => {
    const labels = B.layoutBandsFlick({ topViewMode: 'compact', radarProvider: 'disabled', healthMode: 'status' }).map((x) => x.label);
    assert.ok(labels.indexOf('Health status') >= 0, 'weather status → health status');
    assert.ok(labels.indexOf('Forecast') >= 0, 'forecast stays');
    assert.strictEqual(labels.indexOf('Health graph'), -1, 'no graph in status mode');
});

test('layoutBandsFlick: healthMode all swaps Forecast → Health graph too', () => {
    const labels = B.layoutBandsFlick({ topViewMode: 'compact', radarProvider: 'disabled', healthMode: 'all' }).map((x) => x.label);
    assert.ok(labels.indexOf('Health graph') >= 0, 'forecast → health graph');
    assert.ok(labels.indexOf('Health status') >= 0, 'weather status → health status');
});

test('layoutBandsFlick: none bottom takes the graph only in "all"; status line follows any health view', () => {
    const radarOnly = B.layoutBandsFlick({ topViewMode: 'none', radarProvider: 'dwd', healthMode: 'off' }).map((x) => x.label);
    assert.ok(radarOnly.indexOf('Radar') >= 0 && radarOnly.indexOf('Weather status') >= 0, 'radar-only: Radar + weather status');
    assert.strictEqual(radarOnly.indexOf('Forecast'), -1, 'forecast replaced by radar');
    // Graph mode: the health graph takes the big band too → Radar/Health, plus the health status line.
    const radarAll = B.layoutBandsFlick({ topViewMode: 'none', radarProvider: 'dwd', healthMode: 'all' }).map((x) => x.label);
    assert.ok(radarAll.indexOf('Radar/Health') >= 0, 'radar + graph → Radar/Health in the bottom band');
    assert.ok(radarAll.indexOf('Health status') >= 0, 'radar + graph → health status line');
    // Status-bar mode: health stays in the status line only; the big band stays on Radar.
    const radarStatus = B.layoutBandsFlick({ topViewMode: 'none', radarProvider: 'dwd', healthMode: 'status' }).map((x) => x.label);
    assert.ok(radarStatus.indexOf('Radar') >= 0, 'radar + status-bar → Radar in the bottom band');
    assert.strictEqual(radarStatus.indexOf('Radar/Health'), -1, 'status-bar health does NOT take the bottom band');
    assert.ok(radarStatus.indexOf('Health status') >= 0, 'radar + status-bar → health status line');
    // Status-bar only: big band stays Forecast, status line shows health.
    const statusOnly = B.layoutBandsFlick({ topViewMode: 'none', radarProvider: 'disabled', healthMode: 'status' }).map((x) => x.label);
    assert.ok(statusOnly.indexOf('Forecast') >= 0 && statusOnly.indexOf('Health status') >= 0, 'status-bar only: Forecast + health status line');
});

test('layoutBandsFlick: dual + no radar reveals nothing (health already pinned)', () => {
    assert.strictEqual(B.layoutBandsFlick({ topViewMode: 'compact', dualStatus: true, healthMode: 'status', radarProvider: 'disabled' }), null);
});

test('layoutPreviewCombined: Default + After flick columns side by side; placeholder when nothing to reveal', () => {
    const on = B.layoutPreviewCombined({ topViewMode: 'compact', radarProvider: 'dwd', healthMode: 'off' }, {}, {});
    assert.ok(on.indexOf('Default') >= 0 && on.indexOf('After flick') >= 0, 'both column headers present');
    assert.ok(on.indexOf('Radar') >= 0, 'flick column shows the radar swap');
    const off = B.layoutPreviewCombined({ topViewMode: 'compact', radarProvider: 'disabled', healthMode: 'off' }, {}, {});
    assert.ok(off.indexOf('Nothing to flick') >= 0, 'flick column shows the placeholder when nothing to reveal');
    assert.ok(off.indexOf('Default') >= 0, 'default column still present when nothing to flick');
});

test('layoutPreviewCombined: bands span the full column width (no side padding)', () => {
    const svg = B.layoutPreviewCombined({ topViewMode: 'compact', radarProvider: 'dwd', healthMode: 'off' }, {}, {});
    // Left column starts flush at x=0 (no black side padding inset).
    assert.ok(svg.indexOf('<rect x="0" y="16"') >= 0, 'left column band starts at x=0');
});
