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
    assert.equal(spec.main.indexOf(pal.grid), -1, id + ' panning layer draws no gridlines');
    assert.equal((spec.main.match(/<line /g) || []).length, 2,
      id + ' verticals: only the now line and the tap crosshair');
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

test('panel specs carry the crosshair-highlight plumbing (marks, dots, bar ids, tip)', () => {
  const view = charts.prepareView(fixtureData(), NOON);
  const pal = charts.palette(false);
  const settings = { temperatureUnits: 'c', windUnits: 'kph' };
  const temp = charts.tempPanelSvg(view, settings, pal);
  const wind = charts.windPanelSvg(view, settings, pal);
  const hum = charts.humidityPanelSvg(view, settings, pal);
  const press = charts.pressurePanelSvg(view, settings, pal);
  // marks: per-line display-unit values + y-domain, and the bar-id prefix,
  // so weather-tab.js places dots / lights bars without re-deriving scales.
  assert.deepEqual(temp.marks.lines.map((l) => l.key), ['temp']);
  assert.equal(temp.marks.bar.prefix, 'wx-bar-temp');
  assert.ok(temp.marks.bar.dim > 0 && temp.marks.bar.dim < 1, 'resting bar opacity is the dim value');
  assert.deepEqual(wind.marks.lines.map((l) => l.key), ['gust', 'wind']);
  assert.equal(wind.marks.bar, null);
  assert.deepEqual(hum.marks.lines.map((l) => l.key), ['temp', 'dew'],
    'humidity itself is bars — the lines are temp + dew');
  assert.equal(hum.marks.bar.prefix, 'wx-bar-hum');
  assert.deepEqual(press.marks.lines.map((l) => l.key), ['press']);
  assert.ok(temp.marks.bottom > temp.marks.top, 'marks carry the plot band');
  const i = view.nowIndex;
  assert.equal(temp.marks.lines[0].vals[i],
    model.displayTemp(view.temp[i], settings), 'line vals are DISPLAY units');
  // Every line series ships a parked highlight dot; every bar is addressable.
  assert.ok(temp.main.indexOf('id="wx-dot-temp-temp"') !== -1, 'temp dot');
  assert.ok(wind.main.indexOf('id="wx-dot-wind-gust"') !== -1 && wind.main.indexOf('id="wx-dot-wind-wind"') !== -1);
  assert.ok(hum.main.indexOf('id="wx-bar-hum-' + i + '"') !== -1, 'humidity bars carry per-hour ids');
  assert.ok(temp.main.indexOf('id="wx-bar-temp-19"') !== -1, 'rain bars carry per-hour ids (a wet hour)');
  // The viewport ships the floating tip mount for panels that declare it.
  const html = charts.viewportHtml('temp', temp, view, 0);
  assert.ok(html.indexOf('id="wx-tip-temp"') !== -1, 'tip div rides the viewport');
  const strip = charts.timeStripSvg(view, LOC, pal, SunCalc);
  assert.equal(charts.viewportHtml('strip', strip, view, 0).indexOf('wx-tip'), -1,
    'the strip declares no tip');
});

test('tipText is the readout without the timestamp (the floating tip contract)', () => {
  const view = charts.prepareView(fixtureData(), NOON);
  const s = { temperatureUnits: 'c', windUnits: 'kph' };
  const i = view.nowIndex;
  assert.match(charts.tipText('temp', view, i, s), /^.*° · .* mm/);
  assert.doesNotMatch(charts.tipText('temp', view, i, s), /Sun|Mon/, 'no weekday in the tip');
  assert.equal(charts.readout('temp', view, i, s), 'Sun 12:00 · ' + charts.tipText('temp', view, i, s));
  assert.equal(charts.tipText('temp', view, 9999, s), '');
});

test('viewportHtml pans by whole viewports (translateX percent of the wide element)', () => {
  const view = charts.prepareView(fixtureData(), NOON);
  const spec = charts.tempPanelSvg(view, { }, charts.palette(false));
  const day1 = charts.viewportHtml('temp', spec, view, 1);
  // 3 days → one viewport = 100/3 % of the wide element.
  assert.ok(day1.indexOf('transform:translateX(' + -(100 / 3) + '%)') !== -1);
  assert.ok(day1.indexOf('width:300%') !== -1, 'the wide element spans all days');
  assert.ok(day1.indexOf('<div class="wx-bleed">') === 0,
    'the full-bleed margin rides an OUTER wrapper — sharing it with the aspect box stretches the charts');
});

test('the hour strip carries the shared time axis, weekday markers and the Measured|Forecast split', () => {
  const view = charts.prepareView(fixtureData(), NOON);
  const spec = charts.timeStripSvg(view, LOC, charts.palette(false), SunCalc);
  assert.equal(spec.main.indexOf('NaN'), -1);
  assert.ok(spec.main.indexOf('03:00') !== -1, 'hour labels every 3 h');
  assert.ok(spec.bandH > 0 && spec.H > spec.bandH, 'the caption zone lives below the band');
  assert.match(spec.main, new RegExp('y="' + (spec.bandH - 6) + '"[^>]*>03:00'),
    'hour labels sit INSIDE the band, along its lower edge');
  assert.match(spec.main, /y="56"[^>]*>Measured</, 'Measured caption below the band');
  assert.match(spec.main, /y="56"[^>]*>Forecast</, 'Forecast caption below the band');
  assert.ok(spec.main.indexOf('>Sun<') !== -1 && spec.main.indexOf('>Mon<') !== -1,
    'each midnight is marked with its weekday');
  const noShade = charts.timeStripSvg(view, LOC, charts.palette(false), null);
  assert.ok(noShade.main.indexOf('03:00') !== -1, 'no SunCalc → still a time axis, just unshaded');
});

test('the hour strip highlights the selected hour with the app\'s chip (own icon + label)', () => {
  const view = charts.prepareView(fixtureData(), NOON);
  const pal = charts.palette(false);
  // Icons live in <defs> as reusable glyphs (a normal + a chip-ink twin per
  // id), so the chip can swap to ANY hour's icon by href while scrubbing.
  const spec = charts.timeStripSvg(view, LOC, pal, SunCalc);
  assert.ok(spec.main.indexOf('<defs>') !== -1);
  assert.ok(spec.main.indexOf('<g id="wxi-partly">') !== -1, 'the icon glyph is defined once');
  assert.ok(spec.main.indexOf('<g id="wxi-hpartly">') !== -1, 'with its chip-ink twin');
  assert.match(spec.main, /<use xlink:href="#wxi-partly" href="#wxi-partly"/,
    'the 3-hourly row references the defs (both href flavors for old WebViews)');
  // No idx → the chip rests on the current hour.
  assert.ok(spec.main.indexOf('id="wx-strip-hi"') !== -1, 'the chip renders');
  assert.ok(spec.main.indexOf('translate(' + (view.nowIndex * charts.HOUR_W) + ' 0)') !== -1,
    'the chip sits at the now hour');
  assert.match(spec.main, /id="wx-strip-hi-text"[^>]*>12:00</, 'the chip labels its hour');
  assert.match(spec.main, /id="wx-strip-hi-icon"[^>]*#wxi-hpartly/,
    'the chip wears the hour\'s OWN icon in chip ink');
  assert.ok(spec.main.indexOf(pal.hiBox) !== -1, 'the chip box wears the highlight fill');
  // An explicit idx (a scrub) moves the chip to that hour.
  const at15 = charts.timeStripSvg(view, LOC, pal, SunCalc, 15);
  assert.ok(at15.main.indexOf('translate(' + (15 * charts.HOUR_W) + ' 0)') !== -1);
  assert.match(at15.main, /id="wx-strip-hi-text"[^>]*>15:00</);
  const chipless = charts.timeStripSvg(view, LOC, pal, SunCalc, 9999);
  assert.ok(chipless.main.indexOf('translate(' + (view.nowIndex * charts.HOUR_W) + ' 0)') !== -1,
    'an out-of-range idx falls back to the now hour');
});

test('the sun & moon panel spans the timeline with per-day rise/set labels', () => {
  const view = charts.prepareView(fixtureData(), NOON);
  const pal = charts.palette(false);
  const spec = charts.sunMoonPanelSvg(view, LOC, pal, SunCalc);
  assert.equal(spec.main.indexOf('NaN'), -1);
  assert.ok(/\d\d:\d\d/.test(spec.main), 'rise/set times render');
  assert.ok((spec.main.match(/☀ \d\d:\d\d/g) || []).length >= view.days,
    'every day gets its sunrise label');
  assert.equal(spec.main.indexOf(pal.grid), -1, 'no dropped guide lines — labels only');
  assert.equal((spec.main.match(/<line /g) || []).length, 2,
    'the horizon hairline and the now line are the only lines');
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
  assert.ok(html.indexOf('50°') < html.indexOf('68°'), 'low renders before high');
  assert.equal((html.match(/wx-day-meta/g) || []).length, 5,
    'ONE meta row per tile: mm and probability share it, sun hours on its right');
  assert.ok(html.indexOf('1 mm · 20%') !== -1, 'precip amount and probability share one line');
  assert.ok(html.indexOf('☀ 1.5h') !== -1, 'sun hours ride the same row');
  assert.ok(html.indexOf('21 Sep') !== -1, 'tiles carry their date beside the weekday');
  assert.equal(html.indexOf('20 Sep'), -1, 'Today stands alone, like the app');
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
