// test/weather-tab-charts.test.js — the Weather tab's SVG renderers: view
// preparation, panel output sanity (no NaN coordinates, scrub anchors,
// validated series colors), readouts, icons, and the 5-day strip.
const test = require('node:test');
const assert = require('node:assert/strict');
const charts = require('../src/pkjs/settings/weather-tab-charts.js');
const model = require('../src/pkjs/settings/weather-tab-model.js');

const NOON = new Date(2026, 8, 20, 12, 0, 0).getTime();

/** @returns {{hourly: Object, daily: Array}} a coherent 60-hour synthetic forecast */
function fixtureData() {
  const hourly = { time: [], temp: [], rain: [], prob: [], wind: [], gust: [], dir: [], rh: [], dew: [], pressure: [], icon: [], sunshineMin: [] };
  for (let h = -12; h <= 48; h += 1) {
    hourly.time.push(NOON + h * 3600000);
    hourly.temp.push(14 + 6 * Math.sin(h / 4));
    hourly.rain.push(h > 6 && h < 10 ? 1.2 : 0);
    hourly.prob.push(h > 4 && h < 12 ? 60 : 10);
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
    daily.push({ date: NOON - 12 * 3600000 + d * 86400000, tmin: 10 + d, tmax: 20 + d, icon: 'rain', rainMm: d, probMax: 20 * d, sunshineH: d * 1.5 });
  }
  return { hourly, daily };
}

test('prepareView slices ±(6,48)h and anchors nowIndex', () => {
  const view = charts.prepareView(fixtureData(), NOON);
  assert.ok(view);
  assert.equal(view.times[0], NOON - 6 * 3600000);
  assert.equal(view.times[view.times.length - 1], NOON + 48 * 3600000);
  assert.equal(view.times[view.nowIndex], NOON);
  assert.equal(charts.prepareView({ hourly: { time: [] }, daily: [] }, NOON), null);
});

test('every hourly panel renders without NaN and carries its scrub anchor', () => {
  const view = charts.prepareView(fixtureData(), NOON);
  const pal = charts.palette(false);
  const settings = { temperatureUnits: 'c', windUnits: 'kph' };
  const panels = {
    temp: charts.tempPanelSvg(view, settings, pal),
    wind: charts.windPanelSvg(view, settings, pal),
    hum: charts.humidityPanelSvg(view, settings, pal),
    press: charts.pressurePanelSvg(view, settings, pal)
  };
  Object.keys(panels).forEach((id) => {
    const svg = panels[id];
    assert.ok(svg.indexOf('<svg') === 0, id + ' renders an svg');
    assert.equal(svg.indexOf('NaN'), -1, id + ' has no NaN coordinates');
    assert.ok(svg.indexOf('wx-scrub-' + id) !== -1, id + ' carries its scrub guideline');
    assert.ok(svg.indexOf('data-wxchart="' + id + '"') !== -1, id + ' is scrub-targetable');
  });
  assert.ok(panels.temp.indexOf(pal.temp) !== -1, 'temperature wears its validated series color');
  assert.ok(panels.wind.indexOf(pal.gust) !== -1, 'gusts wear their series color');
  assert.ok(panels.temp.indexOf('%<') !== -1, 'the precip-probability row renders');
});

test('the sun & moon panel renders from the vendored SunCalc', () => {
  const SunCalc = require('../src/pkjs/settings/vendor-suncalc.js');
  const svg = charts.sunMoonPanelSvg({ lat: 52.52, lon: 13.405 }, NOON, charts.palette(false), SunCalc);
  assert.ok(svg.indexOf('<svg') === 0);
  assert.equal(svg.indexOf('NaN'), -1);
  assert.ok(/\d\d:\d\d/.test(svg), 'rise/set times render');
});

test('readout lines carry every series at the index (the crosshair contract)', () => {
  const view = charts.prepareView(fixtureData(), NOON);
  const s = { temperatureUnits: 'c', windUnits: 'kph' };
  assert.match(charts.readout('temp', view, view.nowIndex, s), /12:00 · .*° · .* mm/);
  assert.match(charts.readout('wind', view, view.nowIndex, s), /km\/h/);
  assert.match(charts.readout('hum', view, view.nowIndex, s), /% · .*° · dew/);
  assert.match(charts.readout('press', view, view.nowIndex, s), /hPa/);
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

test('the 5-day strip renders tiles with units honored and text escaped', () => {
  const view = charts.prepareView(fixtureData(), NOON);
  const html = charts.dailyStripHtml(view.daily, { temperatureUnits: 'f' }, charts.palette(false));
  assert.ok(html.indexOf('Today') !== -1);
  assert.ok(html.indexOf('68°') !== -1, 'tmax 20°C renders as 68°F');
  assert.equal((html.match(/wx-day /g) || []).length + (html.match(/wx-day"/g) || []).length +
    (html.match(/wx-day today/g) || []).length >= 5, true, 'five tiles');
  assert.equal(charts.dailyStripHtml([], {}, charts.palette(false)), '');
});

test('the two palettes stay in lockstep (same roles in light and dark)', () => {
  const light = charts.palette(true);
  const dark = charts.palette(false);
  assert.deepEqual(Object.keys(light).sort(), Object.keys(dark).sort());
  ['temp', 'water', 'dew', 'gust', 'pressure', 'sun'].forEach((role) => {
    assert.notEqual(light[role], dark[role], role + ' is stepped per surface, not shared');
  });
});
