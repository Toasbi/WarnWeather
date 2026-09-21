// test/weather-tab-charts.test.js — the Weather tab's SVG renderers: the
// day-aligned multi-day view, panel specs (no NaN coordinates, scrub anchors,
// in-plot dual axes, validated series colors), the panning viewport wrapper,
// the hour strip, readouts, icons, and the tappable 5-day strip.
const test = require('node:test');
const assert = require('node:assert/strict');
const charts = require('../src/pkjs/settings/weather-tab-charts.js');
const model = require('../src/pkjs/settings/weather-tab-model.js');
const icons = require('../src/pkjs/settings/weather-tab-icons.js');

// UTC fixtures + an explicit utcOffsetSec pin the location clock, so the
// suite is deterministic in any container timezone.
const DAY0_DEFAULT = Date.UTC(2026, 8, 20);  // a Sunday
const DAY0 = DAY0_DEFAULT;
const NOON = DAY0 + 12 * 3600000;

/**
 * @param {number} [day0] Location-midnight the fixture starts at (default DAY0).
 * @returns {{hourly: Object, daily: Array, utcOffsetSec: number}} 3 days of data (+ pre-day spill)
 */
function fixtureData(day0) {
  const DAY0 = (day0 === undefined) ? DAY0_DEFAULT : day0;
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
    const scrub = (spec.main.match(new RegExp('<line id="wx-scrub-' + id + '"[^>]*>')) || [])[0];
    assert.ok(scrub, id + ' carries its crosshair guideline');
    assert.ok(scrub.indexOf('stroke="' + pal.ink + '"') !== -1 && scrub.indexOf('opacity') === -1,
      id + ' crosshair runs full-strength ink with NO opacity — dimmed it '
      + 'read as just another gridline instead of THE selected hour');
    assert.equal(spec.main.indexOf(pal.grid), -1, id + ' panning layer draws no gridlines');
    assert.equal((spec.main.match(/<line /g) || []).length, 3 + view.days + 1,
      id + ' lines: the now line, the tap crosshair, the visible bottom axis '
      + 'and one rule per day boundary — nothing else (still no hour gridlines)');
    assert.ok(spec.main.indexOf('y1="' + spec.marks.bottom + '"') !== -1,
      id + ' draws its bottom axis at the plot baseline');
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
  assert.match(specs.temp.overlay,
    new RegExp('<text x="4" y="[0-9.]+" font-size="10" fill="' + pal.ink + '">'),
    'left axis numbers carry full-contrast ink — the faint step washed '
    + 'out against the panel surface');
  assert.ok(specs.temp.overlay.indexOf('moderate') !== -1 && specs.temp.overlay.indexOf('extreme') !== -1,
    'the right axis is the watch rain-tier scale');
  assert.ok(specs.hum.overlay.indexOf('%') !== -1, 'humidity carries its right %-axis');
  assert.ok(specs.hum.overlay.indexOf('font-size="9.5" fill="' + pal.ink + '">50%') !== -1,
    'and its %-labels run full-contrast ink too');
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
  // The dim value must BE the rendered resting opacity — paintScrub
  // restores a bar to marks.bar.dim, so a drifting literal pair would
  // leave un-highlighted bars at the wrong opacity.
  assert.match(temp.main, new RegExp('id="wx-bar-temp-19"[^>]*opacity="' + temp.marks.bar.dim + '"'),
    'rain bars rest at exactly marks.bar.dim');
  assert.match(hum.main, new RegExp('id="wx-bar-hum-0"[^>]*opacity="' + hum.marks.bar.dim + '"'),
    'humidity bars rest at exactly marks.bar.dim');
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
  // The tip anchors above the topmost point: marks carry the panel height
  // and each bar's top y per hour (null on dry hours).
  assert.equal(temp.marks.H, temp.H, 'marks carry the panel height for px conversion');
  assert.equal(temp.marks.bar.tops.length, view.times.length, 'one bar-top slot per hour');
  assert.equal(temp.marks.bar.tops[0], null, 'dry hour → no bar top');
  assert.ok(temp.marks.bar.tops[19] > temp.marks.top && temp.marks.bar.tops[19] < temp.marks.bottom,
    'wet hour → its column top, inside the plot band');
  assert.ok(Math.abs(hum.marks.bar.tops[i]
    - (hum.marks.bottom - view.rh[i] / 100 * (hum.marks.bottom - hum.marks.top))) < 0.6,
    'humidity bar top mirrors the 0-100% scale');
  // The viewport ships the floating tip mount for panels that declare it —
  // in the BLEED box, after the clipped viewport closes, so the tip can
  // hang above the plot (inside the vp, overflow:hidden would cut it).
  const html = charts.viewportHtml('temp', temp, view, 0);
  assert.ok(html.indexOf('</div><div class="wx-tip" id="wx-tip-temp"></div></div>') !== -1,
    'tip div rides the bleed, outside the clipping viewport');
  const strip = charts.timeStripSvg(view, LOC, pal, SunCalc);
  assert.equal(charts.viewportHtml('strip', strip, view, 0).indexOf('wx-tip'), -1,
    'the strip declares no tip');
});

test('the precip-probability row carries its title and steps its ink with the chance', () => {
  const view = charts.prepareView(fixtureData(), NOON);
  const pal = charts.palette(false);
  const temp = charts.tempPanelSvg(view, { temperatureUnits: 'c' }, pal);
  assert.ok(temp.overlay.indexOf('Precipitation probability') !== -1,
    'the row is titled, on the fixed overlay');
  // Fixture: 60% inside 17-23h (a future 3h step lands on 18/21), 10% elsewhere.
  const probSize = Number(/font-size="([\d.]+)"[^>]*>60%</.exec(temp.main)[1]);
  // The row is meant to be read at a glance, so it prints at least as large
  // as the hour ruler above it and never falls back to the axis-ink size.
  const strip = charts.timeStripSvg(charts.prepareView(fixtureData(), NOON), LOC, pal, SunCalc);
  const hourSize = Number(/font-size="([\d.]+)"[^>]*>03:00</.exec(strip.main)[1]);
  assert.ok(probSize >= hourSize,
    'the probability numbers are at least as large as the hour labels (' + probSize + ' vs ' + hourSize + ')');
  assert.match(temp.main, new RegExp('font-size="' + probSize + '" font-weight="700" fill="' + pal.probHi + '">60%<'),
    'a wet hour (>=60%) wears the AA text step of the water hue, bold');
  assert.match(temp.main, new RegExp('font-size="' + probSize + '" font-weight="600" fill="' + pal.faint + '">10%<'),
    'a dry hour stays faint — but still semibold, not hairline');
  assert.match(temp.main, new RegExp('font-size="' + probSize + '" font-weight="600" fill="' + pal.faint + '">–<'),
    'the past-hour dash keeps the row on one size');
  // The middle tier (30-59%): muted ink, semibold. The fixture never lands
  // there, so plant one on a future 3h step.
  const mid = charts.prepareView(fixtureData(), NOON);
  const step = mid.nowIndex + ((3 - (mid.nowIndex % 3)) % 3);
  mid.prob[step] = 45;
  const midPanel = charts.tempPanelSvg(mid, { temperatureUnits: 'c' }, pal);
  assert.match(midPanel.main, new RegExp('font-size="' + probSize + '" font-weight="600" fill="' + pal.muted + '">45%<'),
    'a maybe hour (30-59%) wears muted ink, semibold');
  // The light surface must wear ITS OWN AA step, not the dark one —
  // both palettes' probHi values are load-bearing for contrast.
  const palL = charts.palette(true);
  const tempL = charts.tempPanelSvg(view, { temperatureUnits: 'c' }, palL);
  assert.match(tempL.main, new RegExp('font-size="' + probSize + '" font-weight="700" fill="' + palL.probHi + '">60%<'),
    'the light palette applies its own probHi');
});

test('the value tip renders title-over-value columns (tipHtml)', () => {
  const view = charts.prepareView(fixtureData(), NOON);
  const s = { temperatureUnits: 'c', windUnits: 'kph' };
  const i = view.nowIndex;
  const wind = charts.tipHtml('wind', view, i, s);
  assert.equal((wind.match(/wx-tip-c/g) || []).length, 3, 'wind: three columns');
  assert.ok(wind.indexOf('<b>Wind</b>') !== -1 && wind.indexOf('<b>Gusts</b>') !== -1
    && wind.indexOf('<b>Direction</b>') !== -1, 'titles above values');
  assert.match(wind, /<b>Wind<\/b><i>\d+ km\/h<\/i>/, 'value carries its unit');
  assert.match(wind, /<b>Direction<\/b><i>[a-z ]+<\/i>/, 'direction as spoken words');
  assert.equal(charts.compassWord(315), 'north west');
  const temp = charts.tipHtml('temp', view, i, s);
  assert.ok(temp.indexOf('<b>Temp</b>') !== -1 && temp.indexOf('<b>Rain</b>') !== -1
    && temp.indexOf('<b>Chance</b>') !== -1);
  const hum = charts.tipHtml('hum', view, i, s);
  assert.equal((hum.match(/wx-tip-c/g) || []).length, 3, 'hum: three columns');
  assert.ok(hum.indexOf('<b>Humidity</b>') !== -1 && hum.indexOf('<b>Temp</b>') !== -1
    && hum.indexOf('<b>Dew point</b>') !== -1);
  assert.match(charts.tipHtml('press', view, i, s), /<b>Pressure<\/b><i>\d+ hPa<\/i>/);
  assert.equal(charts.tipHtml('temp', view, 9999, s), '');
  // A null series value drops its whole column (title included) rather
  // than rendering a dash under a title.
  const noDir = charts.prepareView(fixtureData(), NOON);
  noDir.dir[i] = null;
  assert.equal((charts.tipHtml('wind', noDir, i, s).match(/wx-tip-c/g) || []).length, 2,
    'a null direction drops the Direction column');
  const noProb = charts.prepareView(fixtureData(), NOON);
  noProb.prob[i] = null;
  assert.equal((charts.tipHtml('temp', noProb, i, s).match(/wx-tip-c/g) || []).length, 2,
    'a null chance drops the Chance column');
});

test('tipText carries bare values: no weekday, no timestamp (the floating tip contract)', () => {
  const view = charts.prepareView(fixtureData(), NOON);
  const s = { temperatureUnits: 'c', windUnits: 'kph' };
  const i = view.nowIndex;
  assert.match(charts.tipText('temp', view, i, s), /^.*° · .* mm/);
  assert.doesNotMatch(charts.tipText('temp', view, i, s), /Sun|Mon/, 'no weekday in the tip');
  assert.doesNotMatch(charts.tipText('temp', view, i, s), /\d\d:\d\d/, 'no hour timestamp in the tip');
  assert.equal(charts.tipText('temp', view, 9999, s), '');
});

test('agoText climbs the ladder: just now → minutes → hours → a stamp', () => {
  const NOW = Date.UTC(2026, 8, 21, 16, 45);
  const ago = (sec) => charts.agoText(NOW - sec * 1000, NOW);
  assert.equal(ago(0), 'just now');
  assert.equal(ago(59), 'just now', 'under a minute is still now');
  assert.equal(ago(60), '1 min ago');
  assert.equal(ago(119), '1 min ago', 'minutes floor — never round up to a minute that has not passed');
  assert.equal(ago(120), '2 min ago');
  assert.equal(ago(3599), '59 min ago');
  assert.equal(ago(3600), '1 h ago');
  assert.equal(ago(86399), '23 h ago');
  // Past a day the relative form stops paying: the stamp already did the
  // arithmetic "27 h ago" would ask the reader to do.
  // A whole clock's worth of hours and a whole hour's worth of minutes, so
  // single-digit ones are always among them whatever timezone the suite
  // runs in — the stamp pads both to two digits.
  for (let h = 0; h < 24; h += 1) {
    assert.match(charts.agoText(NOW - 86400000 - h * 3600000, NOW),
      /^\d{1,2} [A-Z][a-z]{2} \d\d:\d\d$/, `hour ${h} stamps zero-padded`);
  }
  for (let m = 0; m < 60; m += 1) {
    assert.match(charts.agoText(NOW - 86400000 - m * 60000, NOW),
      /^\d{1,2} [A-Z][a-z]{2} \d\d:\d\d$/, `minute ${m} stamps zero-padded`);
  }
  const d = new Date(NOW - 86400000);
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const pad = (v) => (v < 10 ? '0' + v : String(v));
  assert.equal(ago(86400),
    `${d.getDate()} ${MON[d.getMonth()]} ${pad(d.getHours())}:${pad(d.getMinutes())}`,
    'the stamp reads on the PHONE\'s clock, day-month-time, zero-padded');
  // A phone that resyncs its clock backwards mid-session must not print a
  // negative age: the reading is current, so it says so.
  assert.equal(charts.agoText(NOW + 5 * 60000, NOW), 'just now');
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

test('the hour strip ENDS at the tick ruler — that is what gets pinned', () => {
  const view = charts.prepareView(fixtureData(), NOON);
  const pal = charts.palette(false);
  const spec = charts.timeStripSvg(view, LOC, pal, SunCalc);
  assert.equal(spec.main.indexOf('NaN'), -1);
  assert.ok(spec.main.indexOf('03:00') !== -1, 'hour labels every 3 h');
  assert.match(spec.main, new RegExp('y="' + (spec.bandH - 6) + '"[^>]*>03:00'),
    'hour labels sit INSIDE the band, along its lower edge');
  // The strip is the pinned block, so it may not carry anything below the
  // ruler: the longest tick reaches bandH + 5 and the box closes right there.
  const tickEnds = (spec.main.match(new RegExp('y2="(\\d+)" stroke="'
    + pal.axis.replace(/[()]/g, '\\$&') + '"', 'g')) || [])
    .map((m) => Number(/y2="(\d+)"/.exec(m)[1]));
  assert.ok(tickEnds.length > 20, 'the ruler is there to measure (' + tickEnds.length + ' ticks)');
  const deepestTick = Math.max.apply(null, tickEnds);
  assert.ok(spec.H >= deepestTick, 'the strip still contains its ticks (' + spec.H + ' >= ' + deepestTick + ')');
  assert.ok(spec.H - deepestTick <= 6,
    'and stops within a hair of them — anything roomier pins dead space (' + (spec.H - deepestTick) + ')');
  // The selected hour's tick reaches deeper than the 3-hourly ones; the box
  // has to hold that too, or a scrub clips it against .wx-vp's overflow.
  const hiTick = Number(/id="wx-strip-hi-tick"[^>]*y2="(\d+)"/.exec(spec.main)[1]);
  assert.ok(hiTick > deepestTick, 'the highlight tick is the deepest mark (' + hiTick + ')');
  assert.ok(spec.H >= hiTick, 'and the strip still contains it (' + spec.H + ')');
  assert.equal(spec.main.indexOf('Measured'), -1, 'the caption has left the pinned strip');
  assert.equal(spec.main.indexOf('Forecast'), -1, 'both halves of it');
  assert.ok(spec.main.indexOf('>Sun<') !== -1 && spec.main.indexOf('>Mon<') !== -1,
    'each midnight is marked with its weekday');
  const noShade = charts.timeStripSvg(view, LOC, charts.palette(false), null);
  assert.ok(noShade.main.indexOf('03:00') !== -1, 'no SunCalc → still a time axis, just unshaded');
});

test('the Measured|Forecast caption is its own scrolling row, still on the now line', () => {
  const view = charts.prepareView(fixtureData(), NOON);
  const pal = charts.palette(false);
  const foot = charts.timeFootSvg(view, pal);
  assert.equal(foot.main.indexOf('NaN'), -1);
  assert.ok(foot.H > 0 && foot.H < 20, 'a caption-sized row, not a panel');
  assert.ok(foot.main.indexOf('>Measured<') !== -1 && foot.main.indexOf('>Forecast<') !== -1,
    'both halves of the split moved here');
  // Measured sits left of the now line, Forecast right of it, and the line
  // carries on through the row.
  // The now line by its own weight, not by being the first line in the
  // string — the day-boundary rules share this box and one of them opens it.
  const nowX = Number(/<line x1="([\d.]+)"[^>]*stroke-width="1\.2"/.exec(foot.main)[1]);
  const mx = Number(/<text x="([\d.]+)"[^>]*>Measured</.exec(foot.main)[1]);
  const fx = Number(/<text x="([\d.]+)"[^>]*>Forecast</.exec(foot.main)[1]);
  assert.ok(mx < nowX && nowX < fx, 'the split straddles the now line (' + mx + ' < ' + nowX + ' < ' + fx + ')');
  assert.match(/<text x="[\d.]+"[^>]*>Measured</.exec(foot.main)[0], /text-anchor="end"/,
    'Measured runs back from the line');
  // At the very start of the timeline there is no room for the left half.
  const early = charts.prepareView(fixtureData(), NOON);
  early.nowMs = early.dayStartMs;
  const earlyFoot = charts.timeFootSvg(early, pal);
  assert.equal(earlyFoot.main.indexOf('Measured'), -1, 'no room at the left edge → no Measured');
  assert.ok(earlyFoot.main.indexOf('>Forecast<') !== -1, 'Forecast still labels the whole row');

  // Splitting one svg into two left the now line able to break at the seam.
  // The strip's line must reach ITS box's floor and the caption's must span
  // its own, top to bottom, so that with no margin between the two boxes
  // (pinned by test/weather-tab.test.js) the line reads as one.
  const strip = charts.timeStripSvg(view, LOC, pal, SunCalc);
  const stripLine = /<line x1="[\d.]+" y1="0" x2="[\d.]+" y2="([\d.]+)" stroke="[^"]*" stroke-width="1.2"/
    .exec(strip.main);
  assert.ok(stripLine, 'the strip carries a now line');
  assert.equal(Number(stripLine[1]), strip.H, 'it runs to the strip box\u2019s very floor');
  const footLine = /<line x1="[\d.]+" y1="([\d.]+)" x2="[\d.]+" y2="([\d.]+)" stroke="[^"]*" stroke-width="1.2"/
    .exec(foot.main);
  assert.ok(footLine, 'and the caption picks it up');
  assert.equal(Number(footLine[1]), 0, 'from its own ceiling');
  assert.equal(Number(footLine[2]), foot.H, 'to its own floor — no stub');
});

test('the hour strip highlights the selected hour with the app\'s chip (own icon + label)', () => {
  const view = charts.prepareView(fixtureData(), NOON);
  const pal = charts.palette(false);
  // Icons live in <defs> as reusable glyphs (a normal + a chip-ink twin per
  // id), so the chip can swap to ANY hour's icon by href while scrubbing.
  const spec = charts.timeStripSvg(view, LOC, pal, SunCalc);
  assert.ok(spec.main.indexOf('<defs>') !== -1);
  assert.equal((spec.main.match(/<g id="wxi-partly">/g) || []).length, 1,
    'the icon glyph is defined exactly once (duplicate SVG ids break <use> resolution)');
  assert.equal((spec.main.match(/<g id="wxi-hpartly">/g) || []).length, 1,
    'and its chip-ink twin exactly once');
  assert.match(spec.main, /<use xlink:href="#wxi-partly" href="#wxi-partly"/,
    'the 3-hourly row references the defs (both href flavors for old WebViews)');
  // No idx → the chip rests on the current hour, with its ruler tick.
  assert.ok(spec.main.indexOf('id="wx-strip-hi"') !== -1, 'the chip renders');
  assert.match(spec.main, new RegExp('id="wx-strip-hi-tick" x1="' + (view.nowIndex * charts.HOUR_W) + '"'),
    'the highlighted hour gets its own ruler tick, at the TRUE hour x');
  assert.match(charts.timeStripSvg(view, LOC, pal, SunCalc, 0).main, /id="wx-strip-hi-tick" x1="1"/,
    'the tick keeps (near) the true hour x where the chip box nudges 22 in — '
    + 'just 1 unit off the seam so its 2-wide stroke survives the clip');
  assert.ok(spec.main.indexOf('translate(' + (view.nowIndex * charts.HOUR_W) + ' 0)') !== -1,
    'the chip sits at the now hour');
  assert.match(spec.main, /id="wx-strip-hi-text"[^>]*>12:00</, 'the chip labels its hour');
  assert.match(spec.main, /id="wx-strip-hi-icon"[^>]*#wxi-hpartly/,
    'the chip wears the hour\'s OWN icon in chip ink');
  assert.ok(spec.main.indexOf(pal.hiBox) !== -1, 'the chip box wears the highlight fill');
  assert.match(spec.main, new RegExp('<rect x="-20"[^>]*stroke="' + pal.hiText + '"'),
    'and a white border, so the selected hour stands out from the band');
  // An explicit idx (a scrub) moves the chip to that hour.
  const at15 = charts.timeStripSvg(view, LOC, pal, SunCalc, 15);
  assert.ok(at15.main.indexOf('translate(' + (15 * charts.HOUR_W) + ' 0)') !== -1);
  assert.match(at15.main, /id="wx-strip-hi-text"[^>]*>15:00</);
  const chipless = charts.timeStripSvg(view, LOC, pal, SunCalc, 9999);
  assert.ok(chipless.main.indexOf('translate(' + (view.nowIndex * charts.HOUR_W) + ' 0)') !== -1,
    'an out-of-range idx falls back to the now hour');
  // Day-seam hours nudge the box inward instead of clipping half of it
  // (the pan viewport is overflow:hidden). One clamp, shared with the
  // scrub path via charts.stripChipX.
  assert.equal(charts.stripChipX(view, 0), 22, 'hour 0 clamps off the left seam');
  assert.equal(charts.stripChipX(view, 23), charts.DAY_W - 22, 'hour 23 clamps off its day\'s right seam');
  assert.equal(charts.stripChipX(view, 24), charts.DAY_W + 22, 'day 2 clamps against ITS OWN seam');
  assert.equal(charts.stripChipX(view, 15), 15 * charts.HOUR_W, 'mid-day hours sit at their own x');
  // The tick's clamp is its own, tighter one: 1 unit, so the 2-wide stroke
  // isn't halved at a seam but the tick still reads as the true hour x.
  assert.equal(charts.stripTickX(view, 0), 1, 'the tick nudges 1 unit off the left seam');
  assert.equal(charts.stripTickX(view, 24), charts.DAY_W + 1, 'day 2\'s first hour nudges off ITS seam');
  assert.equal(charts.stripTickX(view, 15), 15 * charts.HOUR_W, 'mid-day ticks sit at their true x');
  const at0 = charts.timeStripSvg(view, LOC, pal, SunCalc, 0);
  assert.ok(at0.main.indexOf('id="wx-strip-hi" transform="translate(22 0)"') !== -1,
    'the renderer places the chip through the same clamp');
});

test('the strip wears moons at night: sun-bearing glyphs swap below the horizon', () => {
  const view = charts.prepareView(fixtureData(), NOON);
  const pal = charts.palette(false);
  const ids = charts.stripIconIds(view, LOC, SunCalc);
  assert.equal(ids[3], 'npartly', '03:00 UTC in Berlin is night — the moon twin');
  assert.equal(ids[12], 'partly', 'noon keeps the day glyph');
  // The WHOLE sun-bearing vocabulary is mapped, each id to its own twin —
  // a dropped or mispointed entry brings the sun-at-2am bug back for just
  // that condition, invisible to the partly/clear checks around it.
  assert.deepEqual(icons.NIGHT, { clear: 'nclear', partly: 'npartly', showers: 'nshowers' });
  view.icon[3] = 'showers';
  assert.equal(charts.stripIconIds(view, LOC, SunCalc)[3], 'nshowers',
    'a showery night hour resolves through the map too');
  view.icon[3] = 'partly';
  const spec = charts.timeStripSvg(view, LOC, pal, SunCalc);
  assert.match(spec.main, /<use xlink:href="#wxi-npartly" href="#wxi-npartly"/,
    'night hours render the moon variant in the 3-hourly row');
  assert.equal((spec.main.match(/<g id="wxi-npartly">/g) || []).length, 1,
    'the night glyph is defined exactly once');
  assert.equal((spec.main.match(/<g id="wxi-hnpartly">/g) || []).length, 1,
    'with its chip-ink twin');
  const night = charts.timeStripSvg(view, LOC, pal, SunCalc, 3);
  assert.match(night.main, /id="wx-strip-hi-icon"[^>]*#wxi-hnpartly/,
    'a chip on a night hour wears the moon in chip ink');
  const raw = charts.stripIconIds(view, LOC, null);
  assert.equal(raw[3], 'partly', 'no SunCalc → raw day ids, like the unshaded strip');
  ['nclear', 'npartly', 'nshowers'].forEach((id) => {
    assert.ok(charts.iconSvg(id, 24, pal).length > 60, id + ' draws (dark)');
    assert.ok(charts.iconSvg(id, 24, charts.palette(true)).length > 60, id + ' draws (light)');
  });
});

test('the sun & moon panel marks every rise and set ON the horizon, labelled at arm\'s length', () => {
  const view = charts.prepareView(fixtureData(), NOON);
  const pal = charts.palette(false);
  const spec = charts.sunMoonPanelSvg(view, LOC, pal, SunCalc);
  assert.equal(spec.main.indexOf('NaN'), -1);

  // Everything hangs off the horizon hairline, which spans the timeline.
  const horizon = Number(/<line x1="0" y1="(\d+)" x2="\d+" y2="\1"/.exec(spec.main)[1]);
  assert.ok(horizon > 0 && horizon < spec.H, 'the horizon sits inside the panel');

  // A rise and a set per day per body, each carrying its direction arrow.
  ['\u2600\u2191', '\u2600\u2193', '\u263D\u2191'].forEach((glyph) => {
    const n = (spec.main.match(new RegExp(glyph, 'g')) || []).length;
    assert.ok(n >= view.days - 1, glyph + ' marked on (nearly) every day: ' + n);
  });

  // The labels are the panel's headline type, not the axis ink they used to
  // match: at least as large as the hour ruler, and semibold.
  const strip = charts.timeStripSvg(view, LOC, pal, SunCalc);
  const hourSize = Number(/font-size="([\d.]+)"[^>]*>03:00/.exec(strip.main)[1]);
  const labelSize = Number(/font-size="([\d.]+)" font-weight="600"[^>]*>\d\d:\d\d /.exec(spec.main)[1]);
  assert.ok(labelSize >= hourSize, 'rise/set labels read at ruler size or bigger (' + labelSize + ')');

  // Each event puts a filled dot exactly ON the horizon and a dotted leader
  // out to its label — the crossing is the point, per the reference.
  const onHorizon = (spec.main.match(new RegExp('<circle cx="[\\d.]+" cy="' + horizon + '"', 'g')) || []).length;
  assert.ok(onHorizon >= 2 * view.days, 'a dot per crossing: ' + onHorizon);
  const leaders = (spec.main.match(/stroke-dasharray="1.5 3"/g) || []).length;
  assert.equal(leaders, onHorizon, 'every dot gets exactly one dotted leader');
  assert.ok(spec.main.indexOf('<circle cx="') !== -1 && spec.main.indexOf('fill="' + pal.sun + '"') !== -1,
    'the sun crossings wear the sun ink');

  // Daylight band behind the arcs, one per day, above the horizon only.
  const bands = spec.main.match(new RegExp('<rect x="[\\d.]+" y="\\d+" width="[\\d.]+" height="\\d+" fill="'
    + pal.daylight.replace(/[()]/g, '\\$&') + '"', 'g')) || [];
  assert.ok(bands.length >= view.days - 1, 'a daylight band per day: ' + bands.length);
  const bandHeight = Number(/height="(\d+)"/.exec(bands[0])[1]);
  const bandTop = Number(/y="(\d+)"/.exec(bands[0])[1]);
  assert.equal(bandTop + bandHeight, horizon, 'the band stops at the horizon, it does not cross it');

  // Each arc runs twice through complementary clips: lit while the body is
  // up, dimmed once it sets.
  assert.ok(spec.main.indexOf('<clipPath id="wx-sun-up">') !== -1
    && spec.main.indexOf('<clipPath id="wx-sun-dn">') !== -1, 'both half-planes are clipped');
  const up = spec.main.split('clip-path="url(#wx-sun-up)"')[1].split('</g>')[0];
  const dn = spec.main.split('clip-path="url(#wx-sun-dn)"')[1].split('</g>')[0];
  assert.ok(up.indexOf(pal.sun) !== -1 && up.indexOf(pal.moon) !== -1, 'above the horizon: full inks');
  assert.ok(dn.indexOf(pal.sunNight) !== -1 && dn.indexOf(pal.moonNight) !== -1, 'below it: the dimmed twins');
  assert.equal(dn.indexOf(pal.moon + '"'), -1, 'the night half never uses the bright moon ink');

  // Now: a rayed sun on its curve, a phase-bearing disc on the moon's.
  assert.match(spec.main, new RegExp('<g stroke="' + pal.sun + '" stroke-width="1.6" stroke-linecap="round">'
    + '(<line [^>]*>){8}</g>'), 'the sun glyph wears eight rays');
  assert.match(spec.main, new RegExp('<circle cx="[\\d.]+" cy="[\\d.]+" r="5.5" fill="' + pal.moonDisc + '"'),
    'the moon disc stands at now, on its own night ground');
  assert.match(spec.main, new RegExp('<path d="M[^"]+Z" fill="' + pal.moonLit + '"'), 'with its lit limb filled');
  const pct = /font-size="(\d+)"[^>]*>(\d+)%</.exec(spec.main);
  assert.ok(Number(pct[1]) >= 9, 'the phase percentage is legible, not a footnote (' + pct[1] + ')');
});

test('the arcs plant their horizon crossings, and no label leaves its day', () => {
  const view = charts.prepareView(fixtureData(), NOON);
  const pal = charts.palette(false);
  const spec = charts.sunMoonPanelSvg(view, LOC, pal, SunCalc);
  const horizon = Number(/<line x1="0" y1="(\d+)" x2="\d+" y2="\1"/.exec(spec.main)[1]);
  // A 30-minute polyline would pass BESIDE the rise/set dot; the crossing
  // instant is interpolated in as its own vertex so the dot sits on the line.
  const sunPath = /<path d="(M[^"]+)" fill="none" stroke="([^"]+)" stroke-width="2"/.exec(spec.main)[1];
  const onHorizonVertices = (sunPath.match(new RegExp('L[\\d.]+ ' + horizon + '(?![\\d.])', 'g')) || []).length;
  assert.ok(onHorizonVertices >= 2 * (view.days - 1),
    'every crossing is a vertex of the arc itself (' + onHorizonVertices + ')');

  // Rise/set labels are clipped by the viewport at a day seam, so each one
  // must fit inside the day it belongs to — at high latitude too, where the
  // events crowd the edges and the placement has to flip and clamp.
  [[52.5, 13.4], [69.6, 18.9], [-33.9, 151.2]].forEach((where) => {
    const s2 = charts.sunMoonPanelSvg(view, { lat: where[0], lon: where[1] }, pal, SunCalc);
    const labels = s2.main.match(/<text x="([\d.]+)" y="\d+" text-anchor="(start|end)" font-size="(\d+)"[^>]*>([^<]*)<tspan[^>]*>([^<]*)<\/tspan>([^<]*)</g) || [];
    assert.ok(labels.length > 0, 'lat ' + where[0] + ' renders labels');
    labels.forEach((tag) => {
      const m = /x="([\d.]+)" y="\d+" text-anchor="(start|end)" font-size="(\d+)"[^>]*>([^<]*)<tspan[^>]*>([^<]*)<\/tspan>([^<]*)</.exec(tag);
      const x = Number(m[1]);
      const size = Number(m[3]);
      const width = (m[4] + m[5] + m[6]).length * size * 0.7;
      const left = m[2] === 'end' ? x - width : x;
      const day = Math.floor((left + width / 2) / charts.DAY_W);
      assert.ok(left >= day * charts.DAY_W - 0.01 && left + width <= (day + 1) * charts.DAY_W + 0.01,
        'label ' + JSON.stringify(m[4] + m[5] + m[6]) + ' at lat ' + where[0]
        + ' stays inside day ' + day + ' (' + left.toFixed(1) + '–' + (left + width).toFixed(1) + ')');
    });
  });
});

test('a rise/set label is clamped into the day its own dot stands in', () => {
  // A provider that under-reports the UTC offset pushes a crossing out of the
  // day the panel's loop is drawing — Sydney's sunrise lands near 20:00 when
  // the clock is left on UTC. The label must follow its dot into that day
  // rather than be clamped into the day being iterated, where it would sit at
  // the seam pointing at nothing.
  const view = charts.prepareView(fixtureData(), NOON);
  const pal = charts.palette(false);
  const spec = charts.sunMoonPanelSvg(view, { lat: -33.9, lon: 151.2 }, pal, SunCalc);
  const EV = /<line x1="[\d.]+"[^>]*stroke-dasharray="1.5 3"[^>]*\/><circle cx="([\d.]+)"[^>]*\/><text x="([\d.]+)" y="\d+" text-anchor="(start|end)" font-size="(\d+)"[^>]*>([^<]*)<tspan[^>]*>([^<]*)<\/tspan>([^<]*)</g;
  let m, seen = 0;
  while ((m = EV.exec(spec.main)) !== null) {
    const dotX = Number(m[1]);
    const x = Number(m[2]);
    const size = Number(m[4]);
    const width = (m[5] + m[6] + m[7]).length * size * 0.7;
    const left = m[3] === 'end' ? x - width : x;
    const dotDay = Math.floor(dotX / charts.DAY_W);
    assert.ok(left >= dotDay * charts.DAY_W - 0.01
      && left + width <= (dotDay + 1) * charts.DAY_W + 0.01,
      'label ' + JSON.stringify(m[5] + m[6] + m[7]) + ' shares day ' + dotDay + ' with its dot at '
      + dotX.toFixed(1) + ' (label ' + left.toFixed(1) + '–' + (left + width).toFixed(1) + ')');
    seen += 1;
  }
  assert.ok(seen >= 4, 'the skewed clock still yields rise/set events: ' + seen);
  const days = [];
  (spec.main.match(/<circle cx="([\d.]+)" cy="\d+" r="(?:4|3.4)"/g) || []).forEach((c) => {
    days.push(Math.floor(Number(/cx="([\d.]+)"/.exec(c)[1]) / charts.DAY_W));
  });
  assert.ok(Math.max.apply(null, days) > Math.min.apply(null, days),
    'the crossings spread over more than one day, so the day a label picks matters');
});

// Every rise/set mark the panel draws, as {dot, baseline, label box, text}.
// The three tags an event emits are adjacent and in a fixed order, so one
// regex reads a dot and its own label together.
const EVENT_RE = /<circle cx="([\d.]+)" cy="\d+" r="(?:4|3\.4)"[^>]*\/><text x="([\d.]+)" y="(\d+)" text-anchor="(start|end)" font-size="(\d+)"[^>]*>([^<]*)<tspan[^>]*>([^<]*)<\/tspan>([^<]*)</g;
function marksOf(svg) {
  const out = [];
  let m;
  EVENT_RE.lastIndex = 0;
  while ((m = EVENT_RE.exec(svg)) !== null) {
    const x = Number(m[2]);
    const text = m[6] + m[7] + m[8];
    const w = text.length * Number(m[5]) * 0.7;
    out.push({
      dot: Number(m[1]),
      baseline: Number(m[3]),
      left: m[4] === 'end' ? x - w : x,
      right: m[4] === 'end' ? x : x + w,
      text: text.trim(),
    });
  }
  return out;
}

test('the rise/set glyph is AA-legible: it is text, not a line', () => {
  // The glyph is the only part of a label that says WHICH body it is and
  // which way it went, so it needs text contrast. `sun` is tuned for the arc
  // — 1.98:1 on the light surface — which is the same carve-out probHi
  // already exists for. `moon` clears AA on both surfaces as it is.
  const chan = (h, i) => {
    const v = parseInt(h.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  const lum = (h) => 0.2126 * chan(h, 1) + 0.7152 * chan(h, 3) + 0.0722 * chan(h, 5);
  const ratio = (a, b) => {
    const x = lum(a), y = lum(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  };
  [true, false].forEach((isLight) => {
    const pal = charts.palette(isLight);
    const where = isLight ? 'light' : 'dark';
    assert.ok(ratio(pal.sunText, pal.surface) >= 4.5,
      'sunText on the ' + where + ' surface: ' + ratio(pal.sunText, pal.surface).toFixed(2) + ':1');
    assert.ok(ratio(pal.moon, pal.surface) >= 4.5,
      'moon on the ' + where + ' surface: ' + ratio(pal.moon, pal.surface).toFixed(2) + ':1');
    // Guard the guard: sunText is a stepped twin of sun, not sun itself, and
    // the arc keeps the untouched ink.
    assert.notEqual(pal.sunText, pal.sun, 'sunText is stepped away from the arc ink on ' + where);
    const view = charts.prepareView(fixtureData(), NOON);
    const spec = charts.sunMoonPanelSvg(view, LOC, pal, SunCalc);
    assert.ok(spec.main.indexOf('<tspan fill="' + pal.sunText + '">') !== -1,
      'the sun glyph wears the stepped ink on ' + where);
    assert.equal(spec.main.indexOf('<tspan fill="' + pal.sun + '">'), -1,
      'and never the raw arc ink on ' + where);
    assert.ok(spec.main.indexOf('stroke="' + pal.sun + '"') !== -1,
      'while the arc itself keeps it on ' + where);
  });
});

test('two events of the same body never print their labels on top of each other', () => {
  // Two labels can share a row in two ways, and only a sweep finds both:
  // a moonset just after midnight and a moonrise the same morning (65 of
  // Berlin's 340 two-event days collided, up to 40 units deep on a 62-unit
  // label), and — the one that survived a first fix — an Arctic sunset at
  // 21:48 with the 23:22 sunrise SunCalc attributes to the NEXT day, which
  // still lands in this day's viewport. Which labels share a row is which
  // day their DOTS fall in, not which day the render loop was on.
  const WHERE = [[52.52, 13.405, 'Berlin'], [69.6, 18.9, 'Tromsø'],
    [64.13, -21.9, 'Reykjavík'], [-33.9, 151.2, 'Sydney'], [0, 0, 'the equator']];
  let renders = 0, collisions = 0, worst = 0, pairs = 0, worstAt = '';
  WHERE.forEach((where) => {
    for (let d = 0; d < 365; d += 11) {
      const day0 = Date.UTC(2026, 0, 1) + d * 86400000;
      const view = charts.prepareView(fixtureData(day0), day0 + 12 * 3600000);
      const spec = charts.sunMoonPanelSvg(view, { lat: where[0], lon: where[1] },
        charts.palette(false), SunCalc);
      const rows = {};
      marksOf(spec.main).forEach((mk) => {
        // One row per baseline per viewport: labels in different days are
        // never on screen together, so they cannot collide.
        const key = mk.baseline + '#' + Math.floor(mk.dot / charts.DAY_W);
        (rows[key] = rows[key] || []).push(mk);
      });
      Object.keys(rows).forEach((k) => {
        const row = rows[k].slice().sort((a, b) => a.left - b.left);
        for (let i = 1; i < row.length; i += 1) {
          pairs += 1;
          const over = row[i - 1].right - row[i].left;
          if (over > 0.01 && over > worst) {
            worst = over;
            worstAt = where[2] + ' ' + new Date(day0).toISOString().slice(0, 10)
              + ' ' + JSON.stringify(row[i - 1].text) + ' / ' + JSON.stringify(row[i].text);
          }
          if (over > 0.01) { collisions += 1; }
        }
      });
      renders += 1;
    }
  });
  assert.ok(pairs >= 200, 'the sweep really does put labels together on a row: ' + pairs + ' pairs');
  assert.equal(collisions, 0, renders + ' renders, ' + pairs + ' same-row pairs — worst '
    + worst.toFixed(1) + ' units at ' + worstAt);
});

test('the moon marks are read off the LOCATION’s day, not the phone’s', () => {
  // getMoonTimes snaps its 24-hour search to midnight, and to the HOST's
  // midnight unless it is asked for UTC. Everything else in the panel runs on
  // the location's clock, so a phone in another zone used to lose one end of
  // the moon marks and push the other off the canvas. The panel must render
  // the same bytes wherever the phone happens to be.
  const day0 = Date.UTC(2026, 0, 1) - 7200000;              // Berlin midnight
  const data = fixtureData(day0);
  data.utcOffsetSec = 7200;
  const view = charts.prepareView(data, day0 + 12 * 3600000);
  const draw = () => charts.sunMoonPanelSvg(view, { lat: 52.52, lon: 13.405 },
    charts.palette(false), SunCalc).main;
  const was = process.env.TZ;
  try {
    process.env.TZ = 'Europe/Berlin';
    const home = draw();
    process.env.TZ = 'Australia/Sydney';
    const away = draw();
    process.env.TZ = 'America/Los_Angeles';
    const far = draw();
    assert.equal(away, home, 'a phone in Sydney draws Berlin’s moon exactly as a phone in Berlin does');
    assert.equal(far, home, 'and so does one in Los Angeles');
    // Guard the guard: the marks are really there to be got wrong, and all of
    // them land on the canvas rather than beyond a seam.
    const moon = marksOf(home).filter((mk) => mk.text.indexOf('☽') !== -1);
    assert.ok(moon.length >= view.days, 'moon marks drawn: ' + moon.length);
    moon.forEach((mk) => {
      assert.ok(mk.dot >= 0 && mk.dot <= view.days * charts.DAY_W,
        'moon mark ' + JSON.stringify(mk.text) + ' at x=' + mk.dot.toFixed(1) + ' is on the canvas');
    });
  } finally {
    if (was === undefined) { delete process.env.TZ; } else { process.env.TZ = was; }
  }
});

test('each rise/set dot sits ON a vertex of its own arc', () => {
  // The dot marks the instant getTimes/getMoonTimes reports, which is defined
  // at a refracted horizon (-0.833 degrees for the sun, +0.133 for the moon)
  // while the sampled altitude is geometric — so interpolating the arc's own
  // zero put the dot up to 5 units beside the curve at Reykjavik in June,
  // more than the dot's own radius. The arc is seeded with the event instants
  // instead, at every latitude.
  [[52.52, 13.405, 'Berlin'], [64.13, -21.9, 'Reykjavik'], [-33.9, 151.2, 'Sydney']].forEach((where) => {
    const day0 = Date.UTC(2026, 5, 18);
    const view = charts.prepareView(fixtureData(day0), day0 + 12 * 3600000);
    const spec = charts.sunMoonPanelSvg(view, { lat: where[0], lon: where[1] },
      charts.palette(false), SunCalc);
    const horizon = Number(/<line x1="0" y1="(\d+)" x2="\d+" y2="\1"/.exec(spec.main)[1]);
    const vertices = new Set();
    (spec.main.match(/<path d="(M[^"]+)" fill="none"/g) || []).forEach((tag) => {
      const d = /d="(M[^"]+)"/.exec(tag)[1];
      (d.match(new RegExp('L([\\d.]+) ' + horizon + '(?![\\d.])', 'g')) || [])
        .forEach((v) => vertices.add(/L([\d.]+) /.exec(v)[1]));
    });
    const dots = marksOf(spec.main);
    assert.ok(dots.length >= 2, where[2] + ' has crossings to check: ' + dots.length);
    dots.forEach((mk) => {
      assert.ok(vertices.has(mk.dot.toFixed(1)),
        where[2] + ': the dot for ' + JSON.stringify(mk.text) + ' at x=' + mk.dot.toFixed(1)
        + ' is a vertex of the arc it marks');
    });
  });
});

test('the altitude band is symmetric about the horizon, so no arc leaves the frame', () => {
  const view = charts.prepareView(fixtureData(), NOON);
  const pal = charts.palette(false);
  // The frame's own now-line reports the plot box, so this reads the geometry
  // the panel actually drew rather than a copy of its constants.
  const boxOf = (svg) => {
    const m = /<line x1="[\d.]+" y1="(\d+)" x2="[\d.]+" y2="(\d+)" stroke="[^"]*" stroke-width="1.2" opacity="0.55"/.exec(svg);
    return { top: Number(m[1]), bottom: Number(m[2]) };
  };
  const horizonOf = (svg) => Number(/<line x1="0" y1="(\d+)" x2="\d+" y2="\1"/.exec(svg)[1]);
  const arcYs = (svg) => {
    const ys = [];
    (svg.match(/<path d="(M[^"]+)" fill="none" stroke="[^"]+" stroke-width="2"/g) || []).forEach((tag) => {
      const d = /d="(M[^"]+)"/.exec(tag)[1];
      (d.match(/[ML]([\d.]+) ([\d.]+)/g) || []).forEach((v) => { ys.push(Number(/ ([\d.]+)$/.exec(v)[1])); });
    });
    return ys;
  };

  // Low latitudes are the demanding case, not the poles: the sun passes close
  // to the nadir there (about -88 degrees at the equator), so a band that is
  // not symmetric about the horizon pushes the night arc through the box.
  [[0, 0, 'the equator'], [-33.9, 151.2, 'Sydney'], [52.5, 13.4, 'Berlin'], [69.6, 18.9, 'Tromso']]
    .forEach((where) => {
      const spec = charts.sunMoonPanelSvg(view, { lat: where[0], lon: where[1] }, pal, SunCalc);
      const box = boxOf(spec.main);
      const horizon = horizonOf(spec.main);
      assert.equal(horizon - box.top, box.bottom - horizon,
        'the horizon halves the plot box at ' + where[2] + ' — that symmetry IS the containment');
      const ys = arcYs(spec.main);
      assert.ok(ys.length > 4 * 24, where[2] + ' draws sampled arcs: ' + ys.length);
      const deepest = Math.max.apply(null, ys);
      const highest = Math.min.apply(null, ys);
      assert.ok(deepest <= box.bottom + 0.05,
        'at ' + where[2] + ' the night arc stays in the box (' + deepest + ' vs bottom ' + box.bottom + ')');
      assert.ok(highest >= box.top - 0.05,
        'at ' + where[2] + ' the day arc stays in the box (' + highest + ' vs top ' + box.top + ')');
      assert.ok(spec.H > box.bottom, where[2] + ' leaves the moon labels room below the box');
    });

  // Guard the guard: at the equator the arc really does reach for the floor,
  // so the containment assertions above are load-bearing rather than slack.
  const eq = charts.sunMoonPanelSvg(view, { lat: 0, lon: 0 }, pal, SunCalc);
  const eqBox = boxOf(eq.main);
  assert.ok(Math.max.apply(null, arcYs(eq.main)) > eqBox.bottom - 3,
    'the equatorial night arc comes within 3px of the box floor');
});

test('moonPhasePath: the terminator tracks the fraction and the lit limb the direction', () => {
  // d = M(top) A(outer limb) A(terminator) Z — the two arc flags say it all.
  const arcs = (d) => (d.match(/A([\d.]+) [\d.]+ 0 0 (\d)/g) || []).map((a) => {
    const m = /A([\d.]+) [\d.]+ 0 0 (\d)/.exec(a);
    return { r: Number(m[1]), sweep: Number(m[2]) };
  });
  assert.equal(charts.moonPhasePath(50, 50, 10, 0, true), '', 'a new moon draws nothing');
  const full = arcs(charts.moonPhasePath(50, 50, 10, 1, true));
  assert.equal(full[1].r, 10, 'at full the terminator is the far limb itself');
  const half = arcs(charts.moonPhasePath(50, 50, 10, 0.5, true));
  assert.equal(half[1].r, 0, 'at the quarter it flattens to a straight edge');
  const crescent = arcs(charts.moonPhasePath(50, 50, 10, 0.25, true));
  assert.equal(crescent[1].r, 5, 'a quarter-lit disc: rx = r|1-2f|');

  const waxing = arcs(charts.moonPhasePath(50, 50, 10, 0.3, true));
  const waning = arcs(charts.moonPhasePath(50, 50, 10, 0.3, false));
  assert.equal(waxing[0].sweep, 1, 'waxing lights the right limb');
  assert.equal(waning[0].sweep, 0, 'waning lights the left one');
  assert.notEqual(waxing[0].sweep, waxing[1].sweep, 'below half the terminator bulges INTO the lit side');
  const gibbous = arcs(charts.moonPhasePath(50, 50, 10, 0.8, true));
  assert.equal(gibbous[0].sweep, gibbous[1].sweep, 'past half it bulges away, over the dark side');
});

test('tipText carries every series at the index, per panel (the crosshair contract)', () => {
  const view = charts.prepareView(fixtureData(), NOON);
  const s = { temperatureUnits: 'c', windUnits: 'kph' };
  assert.match(charts.tipText('temp', view, view.nowIndex, s), /° · .* mm/);
  assert.match(charts.tipText('wind', view, view.nowIndex, s), /km\/h/);
  assert.match(charts.tipText('hum', view, view.nowIndex, s), /% · .*° · dew/);
  assert.match(charts.tipText('press', view, view.nowIndex, s), /hPa/);
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

test('prepareView settles past hours: a chance is only ever about hours to come', () => {
  const view = charts.prepareView(fixtureData(), NOON);
  const s = { temperatureUnits: 'c', windUnits: 'kph' };
  assert.equal(view.nowIndex, 12, 'the fixture puts now at midday');
  // The provider DOES hand over a chance for every past hour (the fixture
  // mirrors Open-Meteo's past_days) — the view is what drops them.
  assert.equal(fixtureData().hourly.prob[12], 10, 'the source carries past chances');
  for (let i = 0; i < view.nowIndex; i += 1) {
    assert.equal(view.prob[i], null, `hour ${i} is over: no chance survives it`);
  }
  assert.equal(view.prob[view.nowIndex], 10, 'the hour in progress keeps its chance');
  assert.equal(view.prob[20], 60, 'later hours are untouched');
  // Every readout inherits it, because they all read view.prob.
  assert.equal((charts.tipHtml('temp', view, 5, s).match(/wx-tip-c/g) || []).length, 2,
    'the tip of a settled hour shows what happened, not what was promised');
  assert.equal(charts.tipHtml('temp', view, 5, s).indexOf('Chance'), -1);
  assert.ok(charts.tipHtml('temp', view, view.nowIndex, s).indexOf('<b>Chance</b>') !== -1,
    'the running hour still carries its Chance column');
  assert.equal(charts.tipText('temp', view, 5, s).indexOf('%'), -1,
    'the plain-text tip drops it too');
  // The % row keeps printing the app's dash for them — the row is a ruler,
  // so its 3-hourly cadence must not go blank.
  const svg = charts.tempPanelSvg(view, s, charts.palette(false)).main;
  const marks = svg.match(/>(–|\d+%)<\/text>/g) || [];
  assert.ok(marks.length >= 4 && marks.slice(0, 4).every((m) => m.indexOf('–') !== -1),
    'the first four 3-hourly marks of a midday view are dashes');
});

test("today's tile promises only the hours it still owns", () => {
  const raw = fixtureData();
  assert.equal(raw.daily[0].probMax, 0, 'the provider called today 0%');
  // The fixture rains 60% from 17:00, so a midday view must surface that
  // and a late-evening view must not (20:00 onward is 60%, 23:00 is the
  // last hour of the day).
  assert.equal(charts.prepareView(fixtureData(), NOON).daily[0].probMax, 60);
  assert.equal(charts.prepareView(fixtureData(), DAY0 + 6 * 3600000).daily[0].probMax, 60);
  // Tomorrow's tile passes through untouched, whatever the hours say.
  assert.equal(charts.prepareView(fixtureData(), NOON).daily[1].probMax, 20);
  // The provider's own object is never mutated — the view copies today.
  const data = fixtureData();
  charts.prepareView(data, NOON);
  assert.equal(data.daily[0].probMax, 0, 'the fetched data is left alone');
  // A strip that does not start on today is passed straight through: the
  // tile labelled Today is exactly the tile settled here.
  const shifted = fixtureData();
  shifted.daily = shifted.daily.slice(1);
  assert.equal(charts.prepareView(shifted, NOON).daily[0].probMax, 20);
  // And it reads TODAY's hours only: a wetter tomorrow stays tomorrow's.
  const wetTomorrow = fixtureData();
  for (let i = 0; i < wetTomorrow.hourly.time.length; i += 1) {
    if (wetTomorrow.hourly.time[i] >= DAY0 + 86400000) { wetTomorrow.hourly.prob[i] = 95; }
  }
  const wv = charts.prepareView(wetTomorrow, NOON);
  assert.equal(wv.daily[0].probMax, 60, "tomorrow's 95% never lands on today's tile");
  assert.equal(wv.prob[30], 95, 'while tomorrow itself still carries it');
});

test('the 5-day strip renders tappable day tiles with units honored and selection marked', () => {
  const view = charts.prepareView(fixtureData(), NOON);
  const pal = charts.palette(false);
  const html = charts.dailyStripHtml(view.daily, { temperatureUnits: 'f' }, pal, 0, NOON, 1, view.days);
  assert.ok(html.indexOf('Today') !== -1);
  assert.ok(html.indexOf('68°') !== -1, 'tmax 20°C renders as 68°F');
  assert.ok(html.indexOf('50°') < html.indexOf('68°'), 'low renders before high');
  assert.equal((html.match(/wx-day-meta/g) || []).length, 10,
    'TWO fixed meta rows per tile: every value in its own cell, so the sun '
    + 'column never jumps with the text length');
  assert.match(html, /1 mm<\/span><span class="wx-day-sun">☀<\/span>/,
    'row one: rain amount left, the sun ICON alone on the right');
  assert.match(html, /20%<\/span><span class="wx-day-sun">1\.5h<\/span>/,
    'row two: probability left, sun hours right');
  assert.equal(html.indexOf('☀ 1.5h'), -1, 'icon and hours no longer share a cell');
  assert.equal(html.indexOf('mm ·'), -1,
    'the amount carries no trailing separator dot — it dragged the value '
    + 'off-center and could overflow the half. (Scoped to "mm ·": the '
    + 'strip may legitimately grow a " · " joiner elsewhere, and the '
    + 'adjacency pins above already catch a no-space "·" regression.)');
  assert.ok(html.indexOf('1 mm<') < html.indexOf('20%</span>'),
    'row ORDER pinned: the amount/icon row renders before the probability/hours row');
  assert.equal((html.match(/wx-day-sun/g) || []).length, 10,
    'a sun cell per row on every tile');
  // Null-data tiles: a column with NO data for the day is omitted, so the
  // surviving column's cells span and center across the whole row; the
  // rows themselves still render (min-height holds the tile's grid).
  const sparse = charts.dailyStripHtml([
    { date: view.daily[0].date, tmin: 10, tmax: 20, icon: 'clear', rainMm: 2, probMax: null, sunshineH: null },
    { date: view.daily[0].date + 86400000, tmin: null, tmax: null, icon: null, rainMm: null, probMax: null, sunshineH: null }
  ], {}, pal, 0, NOON, 0, 5);
  assert.equal((sparse.match(/wx-day-meta/g) || []).length, 4,
    'both meta rows render on sparse tiles');
  assert.equal((sparse.match(/wx-day-sun/g) || []).length, 0,
    'no sun data → NO sun cells: the rain column owns the whole row');
  assert.ok(sparse.indexOf('<span class="wx-day-meta"><span class="wx-day-wet">2 mm</span></span>') !== -1,
    'a lone amount is the row\'s single cell — centered across the tile');
  assert.match(sparse, /<span class="wx-day-meta"><\/span>/,
    'an all-null tile keeps its empty rows — the grid holds');
  assert.equal(sparse.indexOf('mm ·'), -1, 'the amount renders bare, probability or not');
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
  ['temp', 'water', 'dew', 'gust', 'pressure', 'sun', 'probHi',
    // The sun & moon panel's own roles: the daylight band and each body's
    // below-horizon twin have to be stepped for their surface too.
    'daylight', 'sunNight', 'moon', 'moonNight'].forEach((role) => {
    assert.notEqual(light[role], dark[role], role + ' is stepped per surface, not shared');
  });
  // The phase disc is the exception, and deliberately so: it paints the sky,
  // not the page, so a lit limb stays the bright ink on either surface.
  const lum = (hex) => [1, 3, 5].reduce((a, i) => a + parseInt(hex.slice(i, i + 2), 16), 0);
  ['moonDisc', 'moonLit'].forEach((role) => {
    assert.equal(light[role], dark[role], role + ' does NOT step per surface — the sky is the sky');
  });
  assert.ok(lum(light.moonLit) > lum(light.moonDisc),
    'the lit limb is the brighter of the two, or the phase reads inverted');

  // A body's night ink must actually differ from its day ink, or the split
  // above/below the horizon says nothing.
  [['sun', 'sunNight'], ['moon', 'moonNight']].forEach((pair) => {
    assert.notEqual(light[pair[0]], light[pair[1]], pair.join('/') + ' differ on the light surface');
    assert.notEqual(dark[pair[0]], dark[pair[1]], pair.join('/') + ' differ on the dark surface');
  });
});

/**
 * Every vertical line in an SVG string, as parsed geometry.
 * @param {string} svg Rendered fragment.
 * @returns {Array<{x: number, y1: number, y2: number, tag: string}>} Verticals.
 */
function verticals(svg) {
  const out = [];
  (svg.match(/<line [^>]*\/>/g) || []).forEach((tag) => {
    const a = /x1="(-?[\d.]+)" y1="(-?[\d.]+)" x2="(-?[\d.]+)" y2="(-?[\d.]+)"/.exec(tag);
    if (a && a[1] === a[3]) { out.push({ x: Number(a[1]), y1: Number(a[2]), y2: Number(a[4]), tag }); }
  });
  return out;
}

test('every canvas rules its day boundaries, so a swipe shows where the day ends', () => {
  const view = charts.prepareView(fixtureData(), NOON);
  const pal = charts.palette(false);
  const settings = { temperatureUnits: 'c', windUnits: 'kph' };
  const surfaces = {
    temp: charts.tempPanelSvg(view, settings, pal),
    wind: charts.windPanelSvg(view, settings, pal),
    hum: charts.humidityPanelSvg(view, settings, pal),
    press: charts.pressurePanelSvg(view, settings, pal),
    sun: charts.sunMoonPanelSvg(view, LOC, pal, SunCalc),
    strip: charts.timeStripSvg(view, LOC, pal, SunCalc, 0),
    foot: charts.timeFootSvg(view, pal)
  };
  // The now line, for the hierarchy check below: a day boundary is the
  // structure the swipe navigates by, so it may not read fainter than the
  // marker that sits inside it.
  const nowOpacity = Number(/<line [^>]*stroke-width="1\.2"[^>]*opacity="([\d.]+)"/.exec(surfaces.press.main)[1]);

  Object.keys(surfaces).forEach((id) => {
    const svg = surfaces[id].main;
    // By the page ink: the strip's hour ticks stand at every midnight too,
    // but they are axis-coloured stubs hanging off the ruler.
    const edges = verticals(svg).filter((v) =>
      v.x >= 0 && v.x % charts.DAY_W === 0 && v.tag.indexOf('stroke="' + pal.ink + '"') !== -1);
    assert.equal(edges.length, view.days + 1,
      id + ': one rule per local midnight, both ends of the timeline included '
      + '(got ' + edges.map((e) => e.x).join(',') + ')');
    for (let d = 0; d <= view.days; d += 1) {
      assert.ok(edges.some((e) => e.x === d * charts.DAY_W),
        id + ': day ' + d + ' starts at x=' + (d * charts.DAY_W));
    }
    edges.forEach((e) => {
      assert.ok(e.tag.indexOf('stroke="' + pal.ink + '"') !== -1,
        id + ': the boundary runs the page ink (white on the dark theme)');
      const op = Number(/opacity="([\d.]+)"/.exec(e.tag)[1]);
      assert.ok(op > nowOpacity,
        id + ': the day boundary reads at least as strongly as the now line '
        + '(' + op + ' vs ' + nowOpacity + ')');
      assert.ok(e.y2 > e.y1, id + ': the rule has height');
    });
  });

  // On the panels the rule spans exactly the plot band — bottom axis to
  // top — so it cannot stop short of the series it is separating.
  ['temp', 'wind', 'hum', 'press'].forEach((id) => {
    const spec = surfaces[id];
    const edge = verticals(spec.main).filter((v) => v.x === charts.DAY_W)[0];
    assert.equal(edge.y1, spec.marks.top, id + ': the rule starts at the plot top');
    assert.equal(edge.y2, spec.marks.bottom, id + ': and ends on the baseline');
  });

  // The sun panel rules its arc band edge to edge, like the others.
  const sunEdge = verticals(surfaces.sun.main)
    .filter((v) => v.x === charts.DAY_W && v.tag.indexOf('stroke="' + pal.ink + '"') !== -1)[0];
  assert.ok(sunEdge.y1 < 30 && sunEdge.y2 > 110,
    'the sun panel\'s rule spans its altitude band (' + sunEdge.y1 + '…' + sunEdge.y2 + ')');

  // The strip and the caption below it are one boundary, not two marks:
  // each rules its own full height, and the stylesheet leaves no gap
  // between the boxes (pinned in test/weather-tab.test.js).
  [['strip', surfaces.strip], ['foot', surfaces.foot]].forEach((pair) => {
    const edge = verticals(pair[1].main).filter((v) => v.x === charts.DAY_W)[0];
    assert.equal(edge.y1, 0, pair[0] + ': the rule starts at the box top');
    assert.equal(edge.y2, pair[1].H, pair[0] + ': and runs to its bottom');
  });
});

test('the accent the day tiles fade to IS the page accent, per theme', () => {
  // The tile highlight is interpolated in JS, so the accent has to exist as
  // a value here as well as a CSS var in the shell. Two copies of a colour
  // drift; this reads the shell's own declarations and compares.
  const shell = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '..', 'src/pkjs/config-ui/lib/shell.html'), 'utf8');
  const links = (shell.match(/--link:\s*(#[0-9A-Fa-f]{6})/g) || [])
    .map((m) => /(#[0-9A-Fa-f]{6})/.exec(m)[1]);
  assert.equal(links.length, 2, 'the shell declares an accent for each theme');
  // Dark is declared first (body), light second (body.light).
  assert.equal(charts.palette(false).link, links[0], 'the dark palette carries the dark --link');
  assert.equal(charts.palette(true).link, links[1], 'the light palette carries the light --link');
});

test('fadeInk and mixInk: the fraction a swipe hands over, as colour', () => {
  const OPAQUE = '#FF6A52';
  assert.equal(charts.fadeInk(OPAQUE, 0), 'rgba(255,106,82,0)', 'nothing at all at zero');
  assert.equal(charts.fadeInk(OPAQUE, 1), 'rgba(255,106,82,1)');
  assert.equal(charts.fadeInk(OPAQUE, 0.5), 'rgba(255,106,82,0.5)');
  // Damped drags past the timeline's ends hand out weights outside 0..1;
  // an alpha of -0.3 is not a colour any engine will accept.
  assert.equal(charts.fadeInk(OPAQUE, -0.3), 'rgba(255,106,82,0)', 'clamped below');
  assert.equal(charts.fadeInk(OPAQUE, 1.4), 'rgba(255,106,82,1)', 'clamped above');

  assert.equal(charts.mixInk('#000000', '#FFFFFF', 0), 'rgb(0,0,0)');
  assert.equal(charts.mixInk('#000000', '#FFFFFF', 1), 'rgb(255,255,255)');
  assert.equal(charts.mixInk('#000000', '#FFFFFF', 0.5), 'rgb(128,128,128)');
  assert.equal(charts.mixInk('#000000', '#FFFFFF', 2), 'rgb(255,255,255)', 'clamped');
  // A mix at t is t of the way there on every channel, not just in sum.
  const mid = charts.mixInk('#204060', '#80A0C0', 0.25);
  assert.equal(mid, 'rgb(56,88,120)');
});
