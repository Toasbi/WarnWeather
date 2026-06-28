// test/config-blocks.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
global.PConf = { blocks: (function () { var m = {}; return { register: (id, fn) => { m[id] = fn; }, get: (id) => m[id] }; })() };
const B = require('../src/pkjs/settings/blocks.js');

test('forecastPreview returns an SVG', () => {
  const fc = B.forecastPreview({ dayNightShading: true, barSource: 'rain', rainBarColor: 'multicolor', secondaryLine: 'precip_prob', secondaryLineFill: true, windScale: 'mid' }, { color: true });
  assert.ok(/^<svg/.test(fc) && fc.indexOf('</svg>') > 0);
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
  assert.ok(B.forecastPreview(Object.assign({}, base, { secondaryLine: 'wind' }), { color: true }).indexOf('stroke="#FFFF55"') > -1, 'wind = yellow');
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
  // duplicate metric → no second-metric squares; wind = #FFFF55 is only a fill for those squares.
  const svg = B.forecastPreview({ dayNightShading: false, barSource: 'off', windScale: 'mid', secondaryLine: 'wind', thirdLine: 'wind' }, { color: true });
  assert.equal(svg.indexOf('fill="#FFFF55"'), -1, 'duplicate metric → no second-metric squares');
});
test('registers all four into PConf.blocks', () => {
  ['forecastPreview','radarPreview','devStats','lastFetch'].forEach((id) => assert.equal(typeof PConf.blocks.get(id), 'function'));
});
