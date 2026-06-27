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
  assert.ok(B.forecastPreview(Object.assign({}, base, { secondaryLine: 'gust' }), { color: true }).indexOf('stroke="#FF5500"') > -1, 'gust = orange');
  assert.ok(B.forecastPreview(Object.assign({}, base, { secondaryLine: 'uv' }), { color: true }).indexOf('stroke="#FF00FF"') > -1, 'uv = magenta');
});

test('forecastPreview draws the second metric as round dots in its metric color, gated on thirdLine', () => {
  const base = { dayNightShading: false, barSource: 'off', windScale: 'mid', secondaryLine: 'precip_prob' };
  const withThird = B.forecastPreview(Object.assign({}, base, { thirdLine: 'gust' }), { color: true });
  const noThird   = B.forecastPreview(Object.assign({}, base, { thirdLine: 'off' }), { color: true });
  // round dots are a near-zero dash + round cap; the dash value is unique to the second metric
  assert.ok(withThird.indexOf('stroke-dasharray="0.01 6"') > -1, 'second metric renders as round dots');
  assert.ok(withThird.indexOf('stroke="#FF5500"') > -1, 'second metric uses the gust color');
  assert.equal(noThird.indexOf('stroke-dasharray'), -1, 'no dots when the second metric is off');
});

test('forecastPreview never draws the third line as the same metric as the secondary', () => {
  const svg = B.forecastPreview({ dayNightShading: false, barSource: 'off', windScale: 'mid', secondaryLine: 'wind', thirdLine: 'wind' }, { color: true });
  assert.equal(svg.indexOf('stroke-dasharray'), -1, 'duplicate metric → no third line');
});
test('registers all four into PConf.blocks', () => {
  ['forecastPreview','radarPreview','devStats','lastFetch'].forEach((id) => assert.equal(typeof PConf.blocks.get(id), 'function'));
});
