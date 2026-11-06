// test/forecast-sample.test.js — the setup wizard's sample weather (src/pkjs/settings/forecast-sample.js)
// and the forecast preview drawing it (preview-forecast.js forecastPreview's `sample`): every span
// draws its own hours, from the sample's own first hour, with a night band per night it reaches.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

global.PConf = global.PConf || {};
require('../src/pkjs/config-ui/lib/schema-walk.js');
require('../src/pkjs/config-ui/lib/color.js');
const E = require('../src/pkjs/config-ui/lib/engine.js');
require('../src/pkjs/settings/blocks.js');
const schema = require('../src/pkjs/settings/schema.js');
const platform = require('../src/pkjs/config-ui/lib/platform.js');
const FC = require('../src/pkjs/settings/preview-forecast.js');
const FS = require('../src/pkjs/settings/forecast-sample.js');
const spanHours = require('../src/pkjs/forecast-span-hours.js');

const EMERY = platform.computeEnv({ platform: 'emery' });
const S0 = E.hydrate(schema, {}, EMERY);
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
  assert.ok(all.feels.every((v, i) => v <= all.temps[i]), 'a summer wind chill: feels-like never above the air');
  assert.ok(all.dew.every((v, i) => v < all.temps[i]), 'the dew point stays under the air');
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

test('without a sample the preview draws its 12-point noon scenario, as the settings page shows it', () => {
  const svg = FC.forecastPreview(S0, EMERY, {});
  assert.deepEqual(hourLabels(svg), [12, 15, 18, 21]);
  assert.equal(nightBands(svg), 1);
});

test('with a sample the preview draws its hours from its first hour, a night band per night', () => {
  const day = FC.forecastPreview(S0, EMERY, {}, FS.sample(25));
  assert.deepEqual(hourLabels(day), [15, 18, 21, 0, 3, 6, 9, 12], '24 h: a label every third hour');
  assert.equal(nightBands(day), 1);
  const half = FC.forecastPreview(Object.assign({}, S0, { forecastHours: '12' }), EMERY, {}, FS.sample(13));
  assert.deepEqual(hourLabels(half), [15, 17, 19, 21, 23, 1, 3], '12 h: every second hour');
  const long = FC.forecastPreview(Object.assign({}, S0, { forecastHours: '48' }), EMERY, {}, FS.sample(61));
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
    const off = new Set(rects(FC.forecastPreview(Object.assign({}, S, { barSource: 'off' }), EMERY, {}, sample)));
    const bars = rects(FC.forecastPreview(Object.assign({}, S, { barSource: 'rain' }), EMERY, {}, sample))
      .filter((r) => !off.has(r) && !/fill="url/.test(r) && Number(/ y="([\d.-]+)"/.exec(r)[1]) < 94);
    return Array.from(new Set(bars.map((r) => Number(/width="([\d.]+)"/.exec(r)[1]))));
  };
  // Inside the plot: the legend under the hour axis (y 94 on) draws a Rain swatch of its own.
  const base = barWidths(S0);
  assert.deepEqual(base, [9]);
  const long = barWidths(Object.assign({}, S0, { forecastHours: '48' }), FS.sample(61));
  assert.equal(long.length, 1);
  assert.ok(long[0] < 2, 'columns of about three units hold a bar under two');
});
