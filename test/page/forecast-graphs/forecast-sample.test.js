// test/page/forecast-graphs/forecast-sample.test.js — the sample weather (src/pkjs/page/forecast-graphs/forecast-sample.js) and the
// forecast preview drawing it (preview-forecast.js forecastPreview's `sample`, and on a watch with a
// Forecast length its pinned preview): every span draws its own hours, from the sample's own first
// hour, with a night band per night it reaches.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

global.PConf = global.PConf || {};
require('../../../src/pkjs/config-ui/lib/schema-walk.js');
require('../../../src/pkjs/config-ui/lib/color.js');
const E = require('../../../src/pkjs/config-ui/lib/engine.js');
require('../../../src/pkjs/page/settings/blocks.js');
const schema = require('../../../src/pkjs/page/settings/schema.js');
const platform = require('../../../src/pkjs/config-ui/lib/platform.js');
const FC = require('../../../src/pkjs/page/forecast-graphs/preview-forecast.js');
const FS = require('../../../src/pkjs/page/forecast-graphs/forecast-sample.js');
const spanHours = require('../../../src/pkjs/weather/domain/forecast-span-hours.js');

const EMERY = platform.computeEnv({ platform: 'emery' });
// 24 hours under emery's left axis, as an upgraded install keeps them (a new install's graph
// draws the high and low on the graph instead, which drops slot 0's label, over the long span).
const S0 = Object.assign(E.hydrate(schema, {}, EMERY), { forecastAxisNumbers: 'axis', forecastHours: '24' });
/** The hour labels an SVG draws on its axis, in order. */
const hourLabels = (svg) => (svg.match(/font-size="7\.5"[^>]*>(\d+)<\/text>/g) || [])
  .map((t) => Number(/>(\d+)</.exec(t)[1]));
/** How many night bands an SVG hatches. */
const nightBands = (svg) => (svg.match(/fill="url\(#nh\)"/g) || []).length;

test('every series is 68 hours, enough for the long span\'s full feed', () => {
  assert.equal(FS.MAX_POINTS, 68);
  assert.equal(FS.MAX_POINTS, spanHours.FULL_HOURS, 'the long span\'s full feed (hourly-window.js MAX_FORECAST_HOURS)');
  const all = FS.sample(68);
  FS.SERIES.forEach((k) => assert.equal(all[k].length, 68, k));
  assert.ok(all.precip.every((v) => v >= 0 && v <= 100) && all.cloud.every((v) => v >= 0 && v <= 100));
  assert.ok(all.feels.every((v, i) => v < all.temps[i]),
    'a summer wind chill, a degree or more under the air: its line never hides under the curve');
  assert.ok(all.dew.every((v, i) => v < all.temps[i]), 'the dew point stays under the air');
});

test('the fixture\'s seven series are its own, the temperatures in °C, the nights its sun events', () => {
  const fixture = require('../../../fixtures/forecast-long.json').weather;
  const all = FS.sample(68);
  assert.deepEqual(all.temps, fixture.temps.map((f) => Math.round((f - 32) * 5 / 9)));
  [['precip', 'precipPct'], ['rain', 'rainMm'], ['uv', 'uvIndex'], ['wind', 'windKmh'], ['gust', 'gustKmh'],
    ['pressure', 'pressureHpa']].forEach(([ours, theirs]) => assert.deepEqual(all[ours], fixture[theirs], ours));
  assert.equal(all.startHour, fixture.startHour);
  const at = (e) => e.hour + e.minute / 60;
  const set = at(fixture.sunEvents.find((e) => e.type === 'sunset'));
  const rise = at(fixture.sunEvents.find((e) => e.type === 'sunrise'));
  assert.deepEqual(all.nights, [0, 1, 2].map((d) => [set - fixture.startHour + 24 * d, rise + 24 - fixture.startHour + 24 * d]
    .map((x) => Math.round(x * 100) / 100)));
});

test('sample(n) slices every series to n points and clips the nights to them', () => {
  const s = FS.sample(13);
  assert.equal(s.startHour, 15);
  FS.SERIES.forEach((k) => assert.equal(s[k].length, 13, k));
  assert.deepEqual(s.nights, [[6.48, 12]], 'the first night, cut at the last point');
  assert.equal(FS.sample(25).nights.length, 1);
  assert.equal(FS.sample(61).nights.length, 3);
  assert.equal(FS.sample(1).temps.length, 2, 'at least two points');
  assert.equal(FS.sample(500).temps.length, 68);
});

test('a Fahrenheit sample converts the three temperature-axis series, nothing else', () => {
  const c = FS.sample(25, 'c'), f = FS.sample(25, 'f');
  ['temps', 'feels', 'dew'].forEach((k) => {
    assert.deepEqual(f[k], c[k].map((v) => Math.round(v * 9 / 5 + 32)), k);
  });
  ['precip', 'cloud', 'rain', 'uv', 'wind', 'gust', 'pressure'].forEach((k) => assert.deepEqual(f[k], c[k], k));
  assert.equal(f.temps[0], 75);
});

test('without a sample a span watch draws the hours its graph shows, any other watch the noon scenario', () => {
  // Owner, 2026-11-09: the graph cards showed 66 h, the pinned preview did not follow. Emery's
  // pinned preview draws its span's hours of the cards' sample (wizard-forecast.js previewSvg).
  const drawn = {};
  ['12', '24', '48'].forEach((h) => ['c', 'f'].forEach((units) => {
    const S = Object.assign({}, S0, { forecastHours: h, temperatureUnits: units });
    const hours = spanHours.shownHours(S, EMERY);
    const svg = FC.forecastPreview(S, EMERY, {});
    assert.equal(svg, FC.forecastPreview(S, EMERY, {}, { sample: FS.sample(hours + 1, units) }), h + ' ' + units);
    if (units === 'c') { drawn[h] = { hours, labels: hourLabels(svg), nights: nightBands(svg) }; }
  }));
  assert.deepEqual(drawn['12'], { hours: 12, labels: [15, 17, 19, 21, 23, 1, 3], nights: 1 });
  assert.deepEqual(drawn['24'], { hours: 22, labels: [15, 18, 21, 0, 3, 6, 9, 12], nights: 1 },
    '22 whole hours beside the left axis');
  assert.deepEqual(drawn['48'], { hours: 48, labels: [18, 0, 6, 12, 18, 0, 6, 12], nights: 2 },
    'Weather Underground\'s 49-hour feed');
  // The owner's 66 h: a full feed with no left axis, its three nights.
  const full = Object.assign({}, S0, { forecastHours: '48', provider: 'openmeteo', forecastAxisNumbers: 'graph' });
  assert.equal(spanHours.shownHours(full, EMERY), 66);
  assert.equal(nightBands(FC.forecastPreview(full, EMERY, {})), 3);
  // Every other watch has one span: the 12-point noon scenario, as before.
  const BASALT = platform.computeEnv({ platform: 'basalt' });
  const basalt = FC.forecastPreview(Object.assign(E.hydrate(schema, {}, BASALT), { forecastHours: '48' }), BASALT, {});
  assert.deepEqual(hourLabels(basalt), [12, 15, 18, 21]);
  assert.equal(nightBands(basalt), 1);
});

test('with a sample the preview draws its hours from its first hour, a night band per night', () => {
  const day = FC.forecastPreview(S0, EMERY, {}, { sample: FS.sample(25) });
  assert.deepEqual(hourLabels(day), [15, 18, 21, 0, 3, 6, 9, 12], '24 h: a label every third hour');
  assert.equal(nightBands(day), 1);
  const half = FC.forecastPreview(Object.assign({}, S0, { forecastHours: '12' }), EMERY, {}, { sample: FS.sample(13) });
  assert.deepEqual(hourLabels(half), [15, 17, 19, 21, 23, 1, 3], '12 h: every second hour');
  const long = FC.forecastPreview(Object.assign({}, S0, { forecastHours: '48' }), EMERY, {}, { sample: FS.sample(61) });
  assert.equal(nightBands(long), 3);
  assert.ok(hourLabels(long).every((h) => h % 6 === 0), 'the long span: the clock\'s six-hour marks');
  // A day line on each midnight's tick (there are two in 60 hours from 15:00).
  assert.equal((long.match(/stroke-width="0\.7"><\/line>/g) || []).length >= 2, true);
});

test('a longer sample draws narrower bars, never wider than the 12-point scenario\'s', () => {
  /**
   * The widths of the rain bars a render draws: its rects in the plot that a render with the bars
   * off lacks.
   * @param {Object} S Settings.
   * @param {Object} [sample] The sample.
   * @returns {number[]} Distinct widths.
   */
  const barWidths = (S, sample) => {
    const rects = (svg) => svg.match(/<rect [^>]*><\/rect>/g) || [];
    const off = new Set(rects(FC.forecastPreview(Object.assign({}, S, { barSource: 'off' }), EMERY, {}, sample && { sample })));
    const bars = rects(FC.forecastPreview(Object.assign({}, S, { barSource: 'rain' }), EMERY, {}, sample && { sample }))
      .filter((r) => !off.has(r) && !/fill="url/.test(r) && Number(/ y="([\d.-]+)"/.exec(r)[1]) < 94);
    return Array.from(new Set(bars.map((r) => Number(/width="([\d.]+)"/.exec(r)[1]))));
  };
  // Inside the plot: the legend under the hour axis (y 94 on) draws a Rain swatch of its own.
  const base = barWidths(S0, FC.noonSample());
  assert.deepEqual(base, [9]);
  const long = barWidths(Object.assign({}, S0, { forecastHours: '48' }), FS.sample(61));
  assert.equal(long.length, 1);
  assert.ok(long[0] < 2, 'columns of about three units hold a bar under two');
});

test('minHeight keeps one frame height whatever the legend; bleed: false fills the box', () => {
  const two = { secondaryLine: 'uv', secondaryLineStyle: 'dots', thirdLine: 'cloud', thirdLineStyle: 'stripeTop',
    fourthLine: 'precip_prob', fourthLineStyle: 'stripeTop', fifthLine: 'feels', fifthLineStyle: 'line' };
  const frame = (S, opts) => /viewBox="0 0 200 ([\d.]+)"/.exec(FC.forecastPreview(S, EMERY, {}, opts))[1];
  assert.notEqual(frame(S0), frame(Object.assign({}, S0, two)), 'a second legend row grows the frame');
  const opts = { sample: FS.sample(23), minHeight: 128 };
  assert.equal(frame(S0, opts), '128');
  assert.equal(frame(Object.assign({}, S0, two), opts), '128');
  const fitted = FC.forecastPreview(S0, EMERY, {}, Object.assign({ bleed: false }, opts));
  assert.match(fitted, /^<svg viewBox="0 0 200 128" style="aspect-ratio:200\/128;display:block;width:100%">/);
  assert.match(fitted, /<rect x="0" y="0" width="200" height="128" fill="#000000">/, 'the screen runs on under the legend');
  assert.match(FC.forecastPreview(S0, EMERY, {}), /margin:-12px -16px -14px/, 'the settings card still bleeds');
});
