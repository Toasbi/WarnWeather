// test/preview-svg.test.js — svgFrame and unframe, kept in lockstep: the Watchface tab's
// watch (preview-watch.js) takes each graph preview's frame apart to lay it into a band.
const test = require('node:test');
const assert = require('node:assert/strict');

require('../src/pkjs/config-ui/lib/schema-walk.js');
require('../src/pkjs/config-ui/lib/color.js');
require('../src/pkjs/config-ui/lib/show-when.js');
require('../src/pkjs/config-ui/lib/engine.js');
const svg = require('../src/pkjs/page/settings/preview-svg.js');
const previewForecast = require('../src/pkjs/page/forecast-graphs/preview-forecast.js');
const previewRadar = require('../src/pkjs/page/weather/preview-radar.js');

test('unframe takes back what svgFrame drew, with either fit', () => {
  const inner = '<rect x="0" y="0" width="200" height="40" fill="#000"></rect><text>a</text>';
  assert.deepEqual(svg.unframe(svg.svgFrame(inner, 40)), { h: 40, inner: inner });
  assert.deepEqual(svg.unframe(svg.svgFrame(inner, 83.5, { bleed: false })), { h: 83.5, inner: inner });
  assert.equal(svg.unframe('<div></div>'), null);
  assert.equal(svg.unframe(''), null);
});

test('a bare forecast frame ends under its hour labels at the axis asked for; without opts it is unchanged', () => {
  const S = { theme: 'dark', secondaryLine: 'precip_prob', barSource: 'rain', dayNightShading: true };
  const env = { platform: 'basalt', color: true };
  const bare = svg.unframe(previewForecast.forecastPreview(S, env, {}, { bare: true, axisY: 70, bleed: false }));
  assert.equal(bare.h, 83, 'the axis at 70, the labels under it');
  const full = svg.unframe(previewForecast.forecastPreview(S, env, {}));
  assert.ok(full.h > 94, 'the legend still sets the frame without opts');
  assert.ok(full.inner.indexOf('Temp') !== -1 && bare.inner.indexOf('Temp') === -1, 'no legend when bare');
});

test('a bare radar frame keeps the axis and the plot, and drops the legend and the alert band', () => {
  const S = { theme: 'dark', radarMode: 'graph', statusTopOnDemandLeftItems: 'rain' };
  const env = { platform: 'basalt', color: true };
  const full = svg.unframe(previewRadar.radarPreview(S, env, {}));
  const bare = svg.unframe(previewRadar.radarPreview(S, env, {}, { bare: true }));
  assert.ok(full.inner.indexOf('Rain at your exact spot') !== -1, 'premise: the full frame has the legend');
  assert.equal(bare.inner.indexOf('Rain at your exact spot'), -1);
  assert.ok(bare.h < full.h, 'shorter');
  assert.ok(bare.inner.indexOf('now') !== -1, 'the time axis stays');
});
