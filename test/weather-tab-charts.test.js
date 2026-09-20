// test/weather-tab-charts.test.js — the Weather tab's SVG renderers: the
// day-aligned multi-day view, panel specs (no NaN coordinates, scrub anchors,
// in-plot dual axes, validated series colors), the panning viewport wrapper,
// the hour strip, readouts, icons, and the tappable 5-day strip.
const test = require('node:test');
const assert = require('node:assert/strict');
const charts = require('../src/pkjs/settings/weather-tab-charts.js');
const model = require('../src/pkjs/settings/weather-tab-model.js');

// UTC fixtures + an explicit utcOffsetSec pin the location clock, so the
// suite is deterministic in any container timezone.
const DAY0 = Date.UTC(2026, 8, 20);          // a Sunday
const NOON = DAY0 + 12 * 3600000;

/** @returns {{hourly: Object, daily: Array, utcOffsetSec: number}} 3 days of data (+ pre-day spill) */
function fixtureData() {
  const hourly = { time: [], temp: [], rain: [], prob: [], wind: [], gust: [], dir: [], rh: [], dew: [], pressure: [], icon: [], sunshineMin: [] };
  for (let h = -12; h < 72; h += 1) {
    hourly.time.push(DAY0 + h * 3600000);
    hourly.temp.push(14 + 6 * Math.sin(h / 4));
    hourly.rain.push(h > 18 && h < 22 ? 1.2 : 0);
    hourly.prob.push(h > 16 && h < 24 ? 60 : 10);
    hourly.wind.push(10 + 5 * Math.sin(h / 6));
    hourly.gust.push(20 + 8 * Math.sin(h / 6));
    hourly.dir.push((180 + h * 5) % 360);
    hourly.rh.push(55 + 20 * Math.sin(h / 8));
    hourly.dew.push(8 + 2 * Math.sin(h / 5));
    hourly.pressure.push(1012 + 2 * Math.sin(h / 10));
    hourly.icon.push('partly');
  }
  const daily = [];
  for (let d = 0; d < 5; d += 1) {
    daily.push({ date: DAY0 + d * 86400000, tmin: 10 + d, tmax: 20 + d, icon: 'rain', rainMm: d, probMax: 20 * d, sunshineH: d * 1.5 });
  }
  return { hourly, daily, utcOffsetSec: 0 };
}

const LOC = { lat: 52.52, lon: 13.405 };
const SunCalc = require('../src/pkjs/settings/vendor-suncalc.js');

test('prepareView day-aligns the timeline and trims trailing dataless days', () => {
  const view = charts.prepareView(fixtureData(), NOON);
  assert.ok(view);
  assert.equal(view.times[0], DAY0, 'the timeline starts at the location midnight, not at now');
  assert.equal(view.days, 3, '72 h of data → 3 days; empty days 4-5 trimmed');
  assert.equal(view.times.length, view.days * 24);
  assert.equal(view.nowIndex, 12);
  assert.equal(view.offsetSec, 0);
  assert.equal(charts.nowX(view), 12 * charts.HOUR_W);
  assert.equal(charts.prepareView({ hourly: { time: [] }, daily: [] }, NOON), null);
});

test('every hourly panel spec renders without NaN and carries its scrub anchor', () => {
  const view = charts.prepareView(fixtureData(), NOON);
  const pal = charts.palette(false);
  const settings = { temperatureUnits: 'c', windUnits: 'kph' };
  const specs = {
    temp: charts.tempPanelSvg(view, settings, pal),
    wind: charts.windPanelSvg(view, settings, pal),
    hum: charts.humidityPanelSvg(view, settings, pal),
    press: charts.pressurePanelSvg(view, settings, pal)
  };
  Object.keys(specs).forEach((id) => {
    const spec = specs[id];
    assert.ok(spec.main.length > 100, id + ' has a canvas');
    assert.ok(spec.H > 0, id + ' declares its height');
    assert.equal(spec.main.indexOf('NaN'), -1, id + ' has no NaN coordinates');
    assert.ok(spec.main.indexOf('wx-scrub-' + id) !== -1, id + ' carries its crosshair guideline');
    const html = charts.viewportHtml(id, spec, view, 0);
    assert.ok(html.indexOf('data-wxvp="' + id + '"') !== -1, id + ' viewport is pan-targetable');
    assert.ok(html.indexOf('data-wxchart="' + id + '"') !== -1, id + ' canvas is scrub-targetable');
    assert.ok(html.indexOf('viewBox="0 0 ' + (view.days * charts.DAY_W) + ' ' + spec.H + '"') !== -1,
      id + ' canvas spans all days');
  });
  assert.ok(specs.temp.main.indexOf(pal.temp) !== -1, 'temperature wears its validated series color');
  assert.ok(specs.wind.main.indexOf(pal.gust) !== -1, 'gusts wear their series color');
  assert.ok(specs.temp.main.indexOf('%<') !== -1, 'the precip-probability row renders');
  assert.ok(specs.temp.overlay.indexOf('°') !== -1, 'left temp axis lives on the fixed overlay');
  assert.ok(specs.temp.overlay.indexOf('moderate') !== -1 && specs.temp.overlay.indexOf('extreme') !== -1,
    'the right axis is the watch rain-tier scale');
  assert.ok(specs.hum.overlay.indexOf('%') !== -1, 'humidity carries its right %-axis');
});

test('viewportHtml pans by whole viewports (translateX percent of the wide element)', () => {
  const view = charts.prepareView(fixtureData(), NOON);
  const spec = charts.tempPanelSvg(view, { }, charts.palette(false));
  const day1 = charts.viewportHtml('temp', spec, view, 1);
  // 3 days → one viewport = 100/3 % of the wide element.
  assert.ok(day1.indexOf('transform:translateX(' + -(100 / 3) + '%)') !== -1);
  assert.ok(day1.indexOf('width:300%') !== -1, 'the wide element spans all days');
});

test('the hour strip carries the shared time axis, weekday markers and the Measured|Forecast split', () => {
  const view = charts.prepareView(fixtureData(), NOON);
  const spec = charts.timeStripSvg(view, LOC, charts.palette(false), SunCalc);
  assert.equal(spec.main.indexOf('NaN'), -1);
  assert.ok(spec.main.indexOf('03:00') !== -1, 'hour labels every 3 h');
  assert.ok(spec.main.indexOf('Measured') !== -1 && spec.main.indexOf('Forecast') !== -1);
  assert.ok(spec.main.indexOf('>Sun<') !== -1 && spec.main.indexOf('>Mon<') !== -1,
    'each midnight is marked with its weekday');
  const noShade = charts.timeStripSvg(view, LOC, charts.palette(false), null);
  assert.ok(noShade.main.indexOf('03:00') !== -1, 'no SunCalc → still a time axis, just unshaded');
});

test('the sun & moon panel spans the timeline with per-day rise/set labels', () => {
  const view = charts.prepareView(fixtureData(), NOON);
  const spec = charts.sunMoonPanelSvg(view, LOC, charts.palette(false), SunCalc);
  assert.equal(spec.main.indexOf('NaN'), -1);
  assert.ok(/\d\d:\d\d/.test(spec.main), 'rise/set times render');
  assert.ok((spec.main.match(/☀ \d\d:\d\d/g) || []).length >= view.days,
    'every day gets its sunrise label');
});

test('readout lines carry weekday + every series at the index (the crosshair contract)', () => {
  const view = charts.prepareView(fixtureData(), NOON);
  const s = { temperatureUnits: 'c', windUnits: 'kph' };
  assert.match(charts.readout('temp', view, view.nowIndex, s), /^Sun 12:00 · .*° · .* mm/);
  assert.match(charts.readout('wind', view, view.nowIndex, s), /km\/h/);
  assert.match(charts.readout('hum', view, view.nowIndex, s), /% · .*° · dew/);
  assert.match(charts.readout('press', view, view.nowIndex, s), /hPa/);
  assert.match(charts.readout('temp', view, 36, s), /^Mon 12:00/, 'day 2 reads as its own weekday');
  assert.equal(charts.readout('temp', view, 9999, s), '');
});

test('compass and tick helpers', () => {
  assert.equal(charts.compass(0), 'N');
  assert.equal(charts.compass(225), 'SW');
  assert.equal(charts.compass(359), 'N');
  const ticks = charts.niceTicks(3, 27, 4);
  assert.ok(ticks.length >= 3 && ticks.length <= 7);
  ticks.forEach((t) => assert.equal(t % 5, 0, 'clean steps'));
});

test('every icon id in the vocabulary draws a glyph, in both palettes', () => {
  [true, false].forEach((isLight) => {
    const pal = charts.palette(isLight);
    model.ICONS.forEach((id) => {
      const svg = charts.iconSvg(id, 24, pal);
      assert.ok(svg.indexOf('<svg') === 0, id);
      assert.ok(svg.length > 60, id + ' has a body');
    });
  });
});

test('the 5-day strip renders tappable day tiles with units honored and selection marked', () => {
  const view = charts.prepareView(fixtureData(), NOON);
  const pal = charts.palette(false);
  const html = charts.dailyStripHtml(view.daily, { temperatureUnits: 'f' }, pal, 0, NOON, 1, view.days);
  assert.ok(html.indexOf('Today') !== -1);
  assert.ok(html.indexOf('68°') !== -1, 'tmax 20°C renders as 68°F');
  assert.equal((html.match(/data-action="wxShowDay"/g) || []).length, 5, 'five tappable tiles');
  assert.ok(/wx-day[^"]*sel/.test(html), 'the viewed day is marked');
  assert.equal((html.match(/disabled/g) || []).length, 2, 'days past the 3-day timeline are dimmed off');
  assert.equal(charts.dailyStripHtml([], {}, pal, 0, NOON, 0, 5), '');
});

test('the two palettes stay in lockstep (same roles in light and dark)', () => {
  const light = charts.palette(true);
  const dark = charts.palette(false);
  assert.deepEqual(Object.keys(light).sort(), Object.keys(dark).sort());
  ['temp', 'water', 'dew', 'gust', 'pressure', 'sun'].forEach((role) => {
    assert.notEqual(light[role], dark[role], role + ' is stepped per surface, not shared');
  });
});
