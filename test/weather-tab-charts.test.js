// test/weather-tab-charts.test.js — the Weather tab's SVG renderers: the
// day-aligned multi-day view, panel specs (no NaN coordinates, scrub anchors,
// in-plot dual axes, validated series colors), the panning viewport wrapper,
// the hour strip, readouts, icons, and the tappable 5-day strip.
const test = require('node:test');
const assert = require('node:assert/strict');
const charts = require('../src/pkjs/settings/weather-tab-charts.js');
const model = require('../src/pkjs/settings/weather-tab-model.js');
const icons = require('../src/pkjs/settings/weather-tab-icons.js');
const data = require('../src/pkjs/settings/weather-tab-data.js');

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

// Two tests below need the HOST's clock to be somewhere that is NOT UTC.
// Assigning process.env.TZ mid-run asks the runtime to swap its zone lazily,
// and this one has been caught keeping GMT instead: the stamp assertion then
// failed for a reason that had nothing to do with the code, and — worse — the
// moon comparison passed VACUOUSLY, because three renders that all stayed UTC
// are trivially equal. A zone handed to a fresh process at START is not
// subject to either, so both run their body in a child. Each body also reports
// the zone it actually got, and the caller checks it: a guard that cannot tell
// whether it ran is not a guard.
const { execFileSync } = require('node:child_process');
const CHILD_MODULES = {
  charts: require.resolve('../src/pkjs/settings/weather-tab-charts.js'),
  readouts: require.resolve('../src/pkjs/settings/weather-tab-readouts.js'),
  SunCalc: require.resolve('../src/pkjs/settings/vendor-suncalc.js')
};
/**
 * @param {string} tz IANA zone, set before the child starts.
 * @param {string} body Source run with charts/readouts/SunCalc required and
 *   ARG holding the parsed `arg`; whatever it writes to stdout comes back.
 * @param {*} [arg] JSON-serialisable value handed to the child.
 * @returns {string} The child's stdout.
 */
function inZone(tz, body, arg) {
  const req = Object.keys(CHILD_MODULES)
    .map((k) => `const ${k} = require(${JSON.stringify(CHILD_MODULES[k])});`).join('');
  return execFileSync(process.execPath,
    ['-e', `${req}const ARG = JSON.parse(process.argv[1]);${body}`,
      JSON.stringify(arg === undefined ? null : arg)],
    { env: Object.assign({}, process.env, { TZ: tz }), encoding: 'utf8' });
}

// The Weather tab serves a fetch for the rest of the PHONE's day. For a place in a time
// zone ahead of the phone, the place's midnight can pass first: day tile i must still
// be panel day i, so a leftover yesterday tile is dropped.
test('prepareView starts the day tiles on the view\'s day 0 when the place\'s midnight has passed', () => {
  const data = fixtureData();
  // Shown at 01:00 on the fixture's second day: the hourly grid re-anchors there.
  const view = charts.prepareView(data, DAY0 + 25 * 3600000);
  assert.equal(view.dayStartMs, DAY0 + 86400000);
  assert.equal(view.daily[0].date, DAY0 + 86400000, 'tile 0 is the view\'s day 0, not yesterday');
  assert.equal(view.daily.length, data.daily.length - 1);
  assert.equal(charts.prepareView(data, NOON).daily.length, data.daily.length, 'same day: every tile stays');
});

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
    assert.ok(scrub.indexOf('stroke="' + pal.muted + '"') !== -1,
      id + ' crosshair runs the MUTED grey: it marks a passing choice, not a '
      + 'fixture, and at full ink it shouted over the structure it points into');
    assert.equal(scrub.indexOf('stroke="' + pal.ink + '"'), -1,
      id + ' crosshair is not the page ink — that is what the day rules and '
      + 'the now line wear');
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
  // Hour 0 too: a bar covers the hour STARTING at its tick, so the canvas's
  // first tick opens the first bar.
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
  // A future 3-hour step, so the figure prints in the chance row (the
  // hours before now have theirs settled away).
  const step = mid.nowIndex + 3 - (mid.nowIndex % 3);
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
  // The hour that is RUNNING — the row on the now line, since a row is the
  // hour its tick opens. It is the earliest hour that still has a chance
  // to print, and the Chance column below needs one to drop: on the row
  // before it the chance is already gone, and the assertion would pass
  // without the code doing anything.
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
  // Pinned against a FIXED instant and a fixed expected string, under a
  // timezone that is not the container's: deriving the expectation from
  // the same Date getters the code calls would mirror the implementation,
  // and a UTC-accessor swap would then pass unnoticed in a UTC container
  // (which is what CI is). 14 Mar 2026 03:05 UTC is 13 Mar 23:05 in New
  // York, so day, month, hour and padding are all genuinely at stake.
  const [nyOffset, stamp] = inZone('America/New_York',
    'const at = Date.UTC(2026, 2, 14, 3, 5);'
    + 'process.stdout.write(new Date(at).getTimezoneOffset() + "|"'
    + ' + readouts.agoText(at, at + 86400000));').split('|');
  assert.equal(nyOffset, '240',
    'the child really is on New York time (EDT, UTC\u22124) — otherwise the stamp below proves nothing');
  assert.equal(stamp, '13 Mar 23:05',
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

// The panel draws rain on the watch's tier scale. A trace under 0.05 mm/h rounds to 0
// tenths on the watch's wire (and in rainPermilleFromMm), so the watch draws no bar —
// the panel must not paint a 1-unit sliver the crosshair can then light.
test('trace rain below the watch\'s tier floor draws no bar in the temperature panel', () => {
  const fx = fixtureData();
  const at = (h) => fx.hourly.time.indexOf(DAY0 + h * 3600000);
  fx.hourly.rain = fx.hourly.rain.map(() => 0);
  fx.hourly.rain[at(15)] = 0.03;    // trace: OWM / tomorrow.io resolution
  fx.hourly.rain[at(16)] = 0.049;
  fx.hourly.rain[at(18)] = 0.05;    // the first reading the watch draws
  const view = charts.prepareView(fx, NOON);
  const i15 = view.times.indexOf(DAY0 + 15 * 3600000);
  const i18 = view.times.indexOf(DAY0 + 18 * 3600000);
  assert.ok(i15 > view.nowIndex && i18 > view.nowIndex, 'sanity: future hours keep their rain');
  const spec = charts.tempPanelSvg(view, { temperatureUnits: 'c' }, charts.palette(false));
  assert.equal(spec.main.indexOf('id="wx-bar-temp-' + i15 + '"'), -1, '0.03 mm/h: no bar');
  assert.equal(spec.main.indexOf('id="wx-bar-temp-' + (i15 + 1) + '"'), -1, '0.049 mm/h: no bar');
  const bar = new RegExp('id="wx-bar-temp-' + i18 + '"[^>]*height="([\\d.]+)"').exec(spec.main);
  assert.ok(bar, '0.05 mm/h draws');
  assert.equal(bar[1], (106 * model.rainPermilleFromMm(0.05) / 1000).toFixed(1),
    'at the lowest tier\'s height (' + bar[1] + '), not a floor');
  assert.equal(spec.marks.bar.tops[i15], null, 'nothing for the crosshair to light at the trace hour');
});

// A day with no sunrise and no sunset is polar: SunCalc answers Invalid Date for both,
// so the rise/set edge rects never draw. Polar NIGHT must still read as night — one
// full-width rect per day — while polar DAY stays unshaded.
test('the hour strip shades a polar-night day end to end, and leaves a midnight-sun day clear', () => {
  const pal = charts.palette(false);
  const nightRects = (spec) => {
    const out = [];
    const re = new RegExp('<rect x="([\\d.]+)" y="0" width="([\\d.]+)" height="\\d+" fill="'
      + pal.night.replace(/[().]/g, '\\$&') + '"/>', 'g');
    let m;
    while ((m = re.exec(spec.main)) !== null) { out.push({ x: Number(m[1]), w: Number(m[2]) }); }
    return out;
  };
  const TROMSO = { lat: 69.65, lon: 18.96 };
  const DEC = Date.UTC(2026, 11, 20);
  const dec = charts.prepareView(fixtureData(DEC), DEC + 12 * 3600000);
  const polarNight = nightRects(charts.timeStripSvg(dec, TROMSO, pal, SunCalc));
  assert.equal(polarNight.length, dec.days, 'one night rect per polar-night day (' + dec.days + ' days)');
  polarNight.forEach((r, d) => {
    assert.equal(r.x, d * charts.DAY_W, 'day ' + d + ' starts its night at its midnight');
    assert.equal(r.w, charts.DAY_W, 'and shades the whole day');
  });
  const JUN = Date.UTC(2026, 5, 21);
  const jun = charts.prepareView(fixtureData(JUN), JUN + 12 * 3600000);
  assert.equal(nightRects(charts.timeStripSvg(jun, TROMSO, pal, SunCalc)).length, 0,
    'midnight sun: no night to shade');
  // An ordinary day keeps its two edge rects, never a whole-day one.
  const berlin = nightRects(charts.timeStripSvg(dec, LOC, pal, SunCalc));
  assert.equal(berlin.length, 2 * dec.days, 'Berlin in December: morning + evening per day');
  assert.ok(berlin.every((r) => r.w < charts.DAY_W), 'none of them the whole day');
});

test('the caption names the past by what produced it, and only DWD says Measured', () => {
  const pal = charts.palette(false);
  const words = (spec) => (spec.main.match(/<text[^>]*>[^<]*<\/text>/g) || []).map((t) => ({
    word: /">([^<]*)</.exec(t)[1],
    x: Number(/x="([\d.]+)"/.exec(t)[1]),
    end: /text-anchor="end"/.test(t)
  }));
  // The canvas runs five days; every one of them carries its own caption,
  // because the reader only ever sees ONE of them at a time. The boundary
  // cases below are all about today, so they read today's words alone.
  const today = (spec) => words(spec).filter((w) => w.x < charts.DAY_W);
  // The faint half-height hairline that marks where readings stopped.
  const tick = (spec) => {
    const m = /<line x1="([\d.]+)" y1="([\d.]+)"[^>]*stroke-width="0\.8"/.exec(spec.main);
    return m ? { x: Number(m[1]), y1: Number(m[2]) } : null;
  };
  // The now line, read by its own weight rather than by being the first line
  // in the string — the day-boundary rules share this box and one opens it.
  const nowLineX = (spec) =>
    Number(/<line x1="([\d.]+)"[^>]*stroke-width="1\.2"/.exec(spec.main)[1]);
  const NOW_X = 12 * charts.HOUR_W;

  // The fixture is Open-Meteo-shaped: it serves the whole past day, but
  // with no provenance at all — model output reconstructing what happened.
  // Nothing on it is measured, and the caption must not pretend otherwise.
  const plain = charts.timeFootSvg(charts.prepareView(fixtureData(), NOON), pal);
  assert.equal(plain.main.indexOf('NaN'), -1);
  assert.ok(plain.H > 0 && plain.H < 20, 'a caption-sized row, not a panel');
  assert.deepEqual(today(plain).map((w) => w.word), ['Estimated', 'Forecast'],
    'a reconstructed past is Estimated, never Measured');
  // The two hug the now line from either side: that IS the boundary they
  // describe, one reading back into the past, one forward into the future.
  assert.deepEqual(today(plain), [
    { word: 'Estimated', x: NOW_X - 5, end: true },
    { word: 'Forecast', x: NOW_X + 5, end: false }
  ]);
  // The days after today are wholly ahead, so each one opens with the word
  // at its own left edge — pan a day forward and the caption comes along.
  const view0 = charts.prepareView(fixtureData(), NOON);
  assert.ok(view0.days > 1, 'the canvas runs past today (' + view0.days + ' days)');
  assert.deepEqual(words(plain).slice(2), Array.from(
    { length: view0.days - 1 },
    (_, d) => ({ word: 'Forecast', x: (d + 1) * charts.DAY_W + 5, end: false })
  ), 'every day ahead names itself; none of them is left blank');

  // A DWD-shaped view: hours 0..7 (00:00-08:00) carry station readings, the
  // rest do not (the observation network lags, so the last hours before now
  // are still MOSMIX even mid-Germany). Three regions, three different
  // truths. A row is the hour its tick opens, so measurement ends on the
  // 08:00 tick, where the last measured hour does.
  const view = charts.prepareView(fixtureData(), NOON);
  view.measuredAll = view.times.map((t, i) => i <= 7);
  const foot = charts.timeFootSvg(view, pal);
  const split = 8 * charts.HOUR_W;
  // Guard the guard, off the RENDER: this case only says anything if what
  // was drawn puts measurement's end left of the now line. Comparing the two
  // numbers the test itself computed would be arithmetic about itself —
  // 8 × HOUR_W is below 12 × HOUR_W whatever the renderer did with them.
  assert.ok(tick(foot).x < nowLineX(foot),
    'the drawn tick stands left of the drawn now line ('
    + tick(foot).x + ' < ' + nowLineX(foot) + ')');
  assert.deepEqual(today(foot), [
    // Measured reads back to where measurement began and stops where it ended.
    { word: 'Measured', x: split - 5, end: true },
    // The hours between are over and nobody read them — the model's account.
    { word: 'Estimated', x: NOW_X - 5, end: true },
    { word: 'Forecast', x: NOW_X + 5, end: false }
  ]);
  assert.equal(tick(foot).x, split, 'the tick stands on the tick that closes the last measured hour');

  assert.equal(nowLineX(foot), NOW_X);


  // Measurement running up to the last hour leaves no room to say Estimated
  // for the sliver that is left: a region too small for its word goes
  // UNLABELLED rather than mislabelled, and the bars above already say it.
  const late = charts.prepareView(fixtureData(), NOON);
  late.measuredAll = late.times.map((t, i) => i <= 10);
  assert.deepEqual(today(charts.timeFootSvg(late, pal)).map((w) => w.word),
    ['Measured', 'Forecast']);

  // One measured hour at the very start: too narrow to name, so the word
  // stands down and the past reads as the model's account — the cautious
  // direction, never the other way round.
  const early = charts.prepareView(fixtureData(), NOON);
  early.measuredAll = early.times.map((t, i) => i === 0);
  assert.deepEqual(today(charts.timeFootSvg(early, pal)).map((w) => w.word),
    ['Estimated', 'Forecast']);

  // Measurement that starts PARTWAY through the day (a station coming on
  // line) is measured only from where it starts. A single hour late in the
  // morning is a 15-unit span — far too narrow for the word — and the word
  // must NOT stretch back to the day's start to find room it has not
  // earned: those earlier hours were never read.
  const lone = charts.prepareView(fixtureData(), NOON);
  lone.measuredAll = lone.times.map((t, i) => i === 8);
  assert.deepEqual(today(charts.timeFootSvg(lone, pal)).map((w) => w.word),
    ['Estimated', 'Forecast'],
    'one measured hour at 08:00 does not license a word spanning 00:00-08:00');
  // A span wide enough to earn it does get it, anchored on its own end.
  const span = charts.prepareView(fixtureData(), NOON);
  span.measuredAll = span.times.map((t, i) => i >= 3 && i <= 7);
  assert.deepEqual(today(charts.timeFootSvg(span, pal)).map((w) => w.word),
    ['Measured', 'Estimated', 'Forecast']);

  // A sliver of readings ending just before the now line is the observation
  // network's normal shape late in its cycle, and it used to delete the
  // caption twice over: "Measured" too narrow to print, and "Estimated"
  // shortened to the same sliver and dropped with it — so a morning the
  // model reconstructed went unnamed on a day that would have said
  // "Estimated" outright had the station reported nothing at all. A word
  // that cannot be printed may not carve up the past.
  const sliver = charts.prepareView(fixtureData(), NOON);
  sliver.measuredAll = sliver.times.map((t, i) => i === 10);
  assert.deepEqual(today(charts.timeFootSvg(sliver, pal)).map((w) => w.word),
    ['Estimated', 'Forecast'],
    'one measured hour before now does not silence the eleven before it');
  const nothing = charts.prepareView(fixtureData(), NOON);
  nothing.measuredAll = nothing.times.map(() => false);
  assert.deepEqual(today(charts.timeFootSvg(sliver, pal)),
    today(charts.timeFootSvg(nothing, pal)),
    'and reads exactly as the day nobody measured at all');
  // The reading is not lost with the word: the tick still stands where it
  // stopped, which is the whole reason that mark exists.
  assert.deepEqual(tick(charts.timeFootSvg(sliver, pal)),
    { x: 11 * charts.HOUR_W, y1: 13 / 2 });

  // A region needs room for the word AND the padding either side of it,
  // not merely for the glyphs: at 11:30 the gap between measurement ending
  // at 08:00 and now is 45 units — room for "Estimated" (37.8) and for one
  // margin (42.8), but not for both (47.8). The word stands down rather
  // than crowd the boundary it hangs off.
  const tight = charts.prepareView(fixtureData(), DAY0 + 11 * 3600000 + 30 * 60000);
  tight.measuredAll = tight.times.map((t, i) => i <= 7);
  assert.deepEqual(today(charts.timeFootSvg(tight, pal)).map((w) => w.word),
    ['Measured', 'Forecast']);

  // An OWM-shaped view: no past hours served at all. Naming that stretch
  // anything would be captioning empty canvas.
  const bare = charts.prepareView(fixtureData(), NOON);
  for (let i = 0; i < bare.nowIndex; i += 1) {
    ['temp', 'wind', 'gust', 'rh', 'dew', 'pressure'].forEach((k) => { bare[k][i] = null; });
  }
  assert.deepEqual(today(charts.timeFootSvg(bare, pal)), [
    { word: 'Forecast', x: NOW_X + 5, end: false }
  ], 'a provider with no past says nothing about one');

  // ...and it says nothing because of a RULE, not because "Estimated" is a
  // long word. OWM is asked for no past hours, yet the resampler's 90-min
  // hold back-fills the single index before now from the CURRENT hour, so
  // one past index does carry a number, and that sliver widens with the
  // minute hand.
  const blankPast = (v, upto) => {
    for (let i = 0; i < upto; i += 1) {
      ['temp', 'wind', 'gust', 'rh', 'dew', 'pressure'].forEach((k) => { v[k][i] = null; });
    }
    return v;
  };
  for (let min = 0; min < 60; min += 7) {
    const owm = charts.prepareView(fixtureData(), NOON + min * 60000);
    assert.deepEqual(today(charts.timeFootSvg(blankPast(owm, owm.nowIndex - 1), pal))
      .map((w) => w.word), ['Forecast'],
      'one back-filled hour is never a past, at :' + min);
  }
  // The discriminating case, which width alone cannot reach: ONE served
  // hour early in the morning leaves a region wide enough for the word
  // several times over, and it still must not be named — a single hour of
  // data is not nine hours of past.
  const stale = charts.prepareView(fixtureData(), NOON);
  blankPast(stale, stale.nowIndex);
  ['temp', 'wind', 'gust', 'rh', 'dew', 'pressure'].forEach((k) => { stale[k][3] = 5; });
  const staleFoot = charts.timeFootSvg(stale, pal);
  assert.ok(NOW_X - 3 * charts.HOUR_W > 'Estimated'.length * 4.2 + 10,
    'the region is wide enough that only the served-hour rule can drop it');
  assert.deepEqual(today(staleFoot).map((w) => w.word), ['Forecast']);
  // Two served hours next to each other ARE a past; here it is the width
  // rule that keeps the word off, and the two mechanisms stay distinct.
  const two = charts.prepareView(fixtureData(), NOON);
  assert.deepEqual(today(charts.timeFootSvg(blankPast(two, two.nowIndex - 2), pal))
    .map((w) => w.word), ['Forecast'],
    'two hours is only 30 units — a real past, but too narrow to name');

  // The split itself is marked, not just implied. Usually the gap between
  // measurement ending and now is the observation lag — an hour or two, too
  // narrow to print "Estimated" in — and "Measured ⟩ Forecast" with nothing
  // between them would read as if the station reported right up to now. The
  // bars cannot say it either: a measured DRY hour and an unmeasured hour
  // both draw nothing.
  assert.deepEqual(tick(foot), { x: split, y1: foot.H / 2 },
    'a half-height hairline stands where the readings stop');
  // It is the lightest mark in the row — under the now line and the day rules.
  const tickW = Number(/<line x1="[\d.]+"[^>]*stroke-width="([\d.]+)"[^>]*opacity/.exec(
    /<line x1="[\d.]+" y1="[\d.]+"[^>]*stroke-width="0\.8"[^>]*\/>/.exec(foot.main)[0])[1]);
  assert.ok(tickW < 1.2, 'lighter than the now line');
  // And it marks the split even when the word between the two stands down.
  assert.deepEqual(tick(charts.timeFootSvg(late, pal)),
    { x: 11 * charts.HOUR_W, y1: foot.H / 2 },
    'especially then: nothing else says where measurement stopped');
  // A provider that measured nothing has no split to mark.
  assert.equal(tick(plain), null);
  assert.equal(tick(charts.timeFootSvg(bare, pal)), null);

  // Splitting one svg into two left the now line able to break at the seam.
  // The strip's line must reach ITS box's floor and the caption's must span
  // its own, top to bottom, so that with no margin between the two boxes
  // (pinned by test/weather-tab.test.js) the line reads as one.
  const nowSegs = (spec) => (spec.main.match(
    /<line x1="[\d.]+" y1="[\d.]+" x2="[\d.]+" y2="[\d.]+" stroke="[^"]*" stroke-width="1\.2"[^>]*>/g) || []);
  const segY = (t) => [Number(/y1="([\d.]+)"/.exec(t)[1]), Number(/y2="([\d.]+)"/.exec(t)[1])];
  // Noon is a labelled column, so up there the line is broken around the
  // glyph and the number it passes through. What the seam needs of it is
  // the LAST segment: wherever the line has to start, it lands on the floor.
  const strip = charts.timeStripSvg(view, LOC, pal, SunCalc);
  const stripSegs = nowSegs(strip);
  assert.ok(stripSegs.length, 'the strip carries a now line');
  assert.equal(segY(stripSegs[stripSegs.length - 1])[1], strip.H,
    'it runs to the strip box\u2019s very floor');
  // Every piece it IS broken into is a piece, not a speck, and together
  // they close on the floor — that a clear column draws one whole line is
  // pinned where the gaps themselves are (test/weather-tab-charts.test.js,
  // 'a rule in the hour strip breaks around the glyph and the number it
  // crosses'), because the now line, standing on an hour tick, no longer
  // has a clear column to stand in.
  stripSegs.forEach((t) => {
    const y = segY(t);
    assert.ok(y[1] - y[0] >= 3, 'a ' + (y[1] - y[0]) + '-unit stub is a speck');
  });
  const footLine = /<line x1="[\d.]+" y1="([\d.]+)" x2="[\d.]+" y2="([\d.]+)" stroke="[^"]*" stroke-width="1.2"/
    .exec(foot.main);
  assert.ok(footLine, 'and the caption picks it up');
  assert.equal(Number(footLine[1]), 0, 'from its own ceiling');
  assert.equal(Number(footLine[2]), foot.H, 'to its own floor — no stub');
});

test('no caption word is ever sliced by the viewport edge', () => {
  // Only ONE day is on screen: the caption rides the pan through a one-day
  // clipping viewport. A word measured against the whole five-day canvas
  // fits the canvas and not the view — late in the evening "Forecast"
  // starts within a word's width of local midnight, so half of it showed
  // today and the other half floated at tomorrow's left edge.
  const pal = charts.palette(false);
  const CH = 4.2;
  let printed = 0;
  for (let min = 0; min < 1440; min += 1) {
    const view = charts.prepareView(fixtureData(), DAY0 + min * 60000);
    const spec = charts.timeFootSvg(view, pal);
    const words = spec.main.match(/<text x="[\d.]+"[^>]*>[^<]*<\/text>/g) || [];
    words.forEach((t) => {
      const x = Number(/x="([\d.]+)"/.exec(t)[1]);
      const word = /">([^<]*)</.exec(t)[1];
      const endAnchored = /text-anchor="end"/.test(t);
      const left = endAnchored ? x - word.length * CH : x;
      const right = endAnchored ? x : x + word.length * CH;
      const day = Math.floor(left / charts.DAY_W);
      assert.ok(left >= day * charts.DAY_W && right <= (day + 1) * charts.DAY_W,
        '"' + word + '" at ' + Math.floor(min / 60) + ':' + (min % 60)
        + ' spans [' + left.toFixed(1) + ',' + right.toFixed(1) + '], outside day ' + day);
      printed += 1;
    });
  }
  assert.ok(printed > 1400, 'the sweep actually rendered words (' + printed + ')');
});

test('a real DWD response reaches the caption: the word follows the modelled fields, the bars follow the rain', () => {
  // End to end through the actual parser — no hand-set flags — so the wiring
  // from Brightsky's per-field provenance to the word on screen is covered.
  // Brightsky answers in UTC and the tab lays DWD's day out on the PHONE's
  // clock, so the records start at the phone's midnight, not UTC's: the
  // hour positions below then hold in any zone the suite runs in.
  const DAY0 = new Date(2026, 8, 20).getTime();
  const NOON = DAY0 + 12 * 3600000;
  const sources = [{ id: 1, observation_type: 'current' }, { id: 9, observation_type: 'forecast' }];
  const build = (modelledFrom, field) => {
    const weather = [];
    for (let h = 0; h < 24; h += 1) {
      const row = {
        timestamp: new Date(DAY0 + h * 3600000).toISOString().replace('Z', '+00:00'),
        source_id: h <= 8 ? 1 : 9,
        temperature: 15, precipitation: 0.4, precipitation_probability: 30,
        wind_speed: 10, wind_gust_speed: 15, wind_direction: 200,
        relative_humidity: 70, dew_point: 9, pressure_msl: 1012, icon: 'rain'
      };
      if (modelledFrom !== null && h >= modelledFrom && h <= 8) {
        row.fallback_source_ids = {};
        row.fallback_source_ids[field] = 9;
      }
      weather.push(row);
    }
    return data.parsers.dwd({ weather, sources }, NOON);
  };
  const pal = charts.palette(false);
  const read = (parsed) => {
    const v = charts.prepareView(parsed, NOON);
    return {
      words: (charts.timeFootSvg(v, pal).main.match(/<text[^>]*>[^<]*<\/text>/g) || [])
        .map((t) => /">([^<]*)</.exec(t)[1]),
      measuredEnd: Number((/<text x="([\d.]+)"[^>]*>Measured</.exec(charts.timeFootSvg(v, pal).main) || [])[1]),
      bars: v.rain.slice(0, 12).map((r) => (r === null ? '.' : '#')).join('')
    };
  };

  // Stations read every drawn field for the records stamped 0..8. Brightsky
  // stamps rain and gust at the END of their hour, so the record stamped
  // 08:00 is 07:00-08:00's and the one stamped 09:00 -- a forecast -- is
  // 08:00-09:00's: the measured stretch is hours 0..7, ending on the 08:00
  // tick.
  const clean = read(build(null));
  assert.deepEqual(clean.words, ['Measured', 'Estimated', 'Forecast']);
  assert.equal(clean.measuredEnd, 8 * charts.HOUR_W - 5);
  assert.equal(clean.bars, '########....', 'eight measured hours of rain');

  // EVERY field the panels draw pulls its weight: if any one of them was
  // filled in from MOSMIX, the word stops there — while the rain bars,
  // which ask only about the rain, are untouched.
  ['temperature', 'precipitation', 'wind_speed', 'wind_gust_speed',
    'wind_direction', 'relative_humidity', 'dew_point', 'pressure_msl'].forEach((field) => {
    const partial = read(build(5, field));
    // Modelled from the record stamped 05:00: an instant there is hour 5's,
    // but the rain and gust stamped 05:00 are hour 4's.
    const ahead = field === 'precipitation' || field === 'wind_gust_speed';
    assert.equal(partial.measuredEnd, (ahead ? 4 : 5) * charts.HOUR_W - 5,
      'a modelled ' + field + ' ends the measured stretch at ' + (ahead ? 4 : 5) + ':00');
    // The rain is the one field that also gates the bars, so it is the one
    // case where a bar goes too.
    assert.equal(partial.bars, field === 'precipitation' ? '####........' : '########....',
      'a modelled ' + field + ' leaves the rain bars alone unless it IS the rain');
  });

  // Modelled from hour 1 leaves a single measured hour — too narrow to name.
  assert.deepEqual(read(build(1, 'temperature')).words, ['Estimated', 'Forecast']);
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
  // Every midnight is seen on the day it OPENS. A bar covers the hour
  // starting at its tick, so a tap on the first sliver of day 1 selects hour
  // 24, from day 1's screen — and the chip hugs that screen's left seam.
  assert.equal(charts.stripChipX(view, 24), charts.DAY_W + 22,
    'the midnight opening day 1 clamps against the seam it is SEEN at');
  assert.equal(charts.stripChipX(view, 15), 15 * charts.HOUR_W, 'mid-day hours sit at their own x');
  // The tick's clamp is its own, tighter one: 1 unit, so the 2-wide stroke
  // isn't halved at a seam but the tick still reads as the true hour x.
  assert.equal(charts.stripTickX(view, 0), 1, 'the tick nudges 1 unit off the left seam');
  assert.equal(charts.stripTickX(view, 24), charts.DAY_W + 1,
    'and so does every midnight, on the day it opens');
  assert.equal(charts.stripTickX(view, 15), 15 * charts.HOUR_W, 'mid-day ticks sit at their true x');
  // Stated as the invariant rather than three cases: whatever the hour,
  // both marks land wholly inside the viewport they are drawn on. A clamp
  // that pushes a mark off screen is worse than the clipping it prevents.
  for (let i = 0; i < view.times.length; i += 1) {
    const d = Math.floor(i / 24);
    const lo = d * charts.DAY_W;
    const hi = (d + 1) * charts.DAY_W;
    const cx = charts.stripChipX(view, i);
    const tx = charts.stripTickX(view, i);
    assert.ok(cx - 20 >= lo && cx + 20 <= hi,
      'hour ' + i + ': the 40-unit chip at ' + cx + ' is inside day ' + d
      + ' [' + lo + '…' + hi + ']');
    assert.ok(tx - 1 >= lo && tx + 1 <= hi,
      'hour ' + i + ': the 2-wide tick at ' + tx + ' is inside day ' + d);
  }
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
  // Each phone draws in its OWN process, with the zone set before it starts —
  // and reports the offset it got, so three renders that all quietly stayed
  // UTC would be caught here rather than compared to each other and declared
  // equal. 1 Jan 2026: Berlin CET (UTC+1), Sydney AEDT (UTC+11), LA PST (UTC-8).
  const draw = (tz) => inZone(tz,
    'const day0 = Date.UTC(2026, 0, 1) - 7200000;'
    + 'const view = charts.prepareView(ARG, day0 + 12 * 3600000);'
    + 'process.stdout.write(new Date(day0).getTimezoneOffset() + "|"'
    + ' + charts.sunMoonPanelSvg(view, { lat: 52.52, lon: 13.405 },'
    + ' charts.palette(false), SunCalc).main);', data).split('|');
  const [homeOff, home] = draw('Europe/Berlin');
  const [awayOff, away] = draw('Australia/Sydney');
  const [farOff, far] = draw('America/Los_Angeles');
  assert.deepEqual([homeOff, awayOff, farOff], ['-60', '-660', '480'],
    'each phone really is where it says it is — equal renders from three UTC '
    + 'processes would satisfy the comparison below without testing anything');
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
    const m = /<line x1="[\d.]+" y1="(\d+)" x2="[\d.]+" y2="(\d+)" stroke="[^"]*" stroke-width="1\.2"/.exec(svg);
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

// The moon disc is a picture of the sky: south of the tropics the phase is mirrored, so
// a waxing crescent is lit on the LEFT there. The lit limb follows the location's own
// geometry, not the phase alone.
test('the moon disc lights the limb the local sky shows, mirrored in the southern hemisphere', () => {
  const pal = charts.palette(false);
  const litLimb = (lat, lon, whenMs) => {
    const day0 = Math.floor(whenMs / 86400000) * 86400000;
    const view = charts.prepareView(fixtureData(day0), whenMs);
    const spec = charts.sunMoonPanelSvg(view, { lat, lon }, pal, SunCalc);
    const d = new RegExp('<path d="(M[^"]+)" fill="' + pal.moonLit.replace(/[().]/g, '\\$&') + '"/>').exec(spec.main);
    assert.ok(d, 'a lit slice is drawn at ' + new Date(whenMs).toISOString());
    return /A[\d.]+ [\d.]+ 0 0 (\d)/.exec(d[1])[1] === '1' ? 'right' : 'left';
  };
  const illum = (ms) => SunCalc.getMoonIllumination(new Date(ms)).phase;
  const WAXING = Date.UTC(2026, 8, 14, 17);   // a waxing crescent (phase ~0.12)
  const SYD_WAXING = Date.UTC(2026, 8, 14, 9);
  const WANING = Date.UTC(2026, 8, 30, 1);    // a waning gibbous (phase ~0.62)
  const SYD_WANING = Date.UTC(2026, 8, 29, 17);
  assert.ok(illum(WAXING) < 0.5 && illum(SYD_WAXING) < 0.5, 'sanity: waxing');
  assert.ok(illum(WANING) > 0.5 && illum(SYD_WANING) > 0.5, 'sanity: waning');
  assert.equal(litLimb(52.52, 13.405, WAXING), 'right', 'Berlin: a waxing moon is lit on the right');
  assert.equal(litLimb(-33.9, 151.2, SYD_WAXING), 'left', 'Sydney: the same phase is lit on the left');
  assert.equal(litLimb(52.52, 13.405, WANING), 'left', 'Berlin: a waning moon is lit on the left');
  assert.equal(litLimb(-33.9, 151.2, SYD_WANING), 'right', 'Sydney: mirrored to the right');
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
  // Up to, NOT including, the row on the now line: a row is the hour
  // STARTING at its stamp (see charts.barX), so the row stamped 11:00 is the
  // hour from 11:00 to noon — over, and no longer a matter of chance — and
  // the row stamped 12:00 is the one running.
  for (let i = 0; i < view.nowIndex; i += 1) {
    assert.equal(view.prob[i], null, `hour ${i} is over: no chance survives it`);
  }
  assert.equal(view.prob[view.nowIndex], 10,
    'the hour in progress — the row ON the now line — keeps its chance');
  assert.equal(view.prob[20], 60, 'later hours are untouched');
  // Every readout inherits it, because they all read view.prob.
  assert.equal((charts.tipHtml('temp', view, 5, s).match(/wx-tip-c/g) || []).length, 2,
    'the tip of a settled hour shows what happened, not what was promised');
  assert.equal(charts.tipHtml('temp', view, 5, s).indexOf('Chance'), -1);
  assert.ok(charts.tipHtml('temp', view, view.nowIndex, s).indexOf('<b>Chance</b>') !== -1,
    'the running hour still carries its Chance column');
  assert.equal(charts.tipHtml('temp', view, view.nowIndex - 1, s).indexOf('Chance'), -1,
    'and the hour that just ended does not');
  assert.equal(charts.tipText('temp', view, 5, s).indexOf('%'), -1,
    'the plain-text tip drops it too');
  // The % row keeps printing the app's dash for them — the row is a ruler,
  // so its 3-hourly cadence must not go blank.
  const svg = charts.tempPanelSvg(view, s, charts.palette(false)).main;
  const marks = svg.match(/>(–|\d+%)<\/text>/g) || [];
  assert.ok(marks.length >= 4 && marks.slice(0, 3).every((m) => m.indexOf('–') !== -1),
    'the first three 3-hourly marks of a midday view are dashes');
  assert.equal(marks[3], '>10%</text>', 'and noon, the hour running, prints its chance');
});

test('an hour that is over shows the rain that FELL, or none at all', () => {
  // The fixture rains 1.2 mm at hours 19-21 and nothing earlier, so give it
  // a wet morning to argue about: 0.9 mm at 07:00, three hours before noon.
  const wet = fixtureData();
  for (let i = 0; i < wet.hourly.time.length; i += 1) {
    if (wet.hourly.time[i] === DAY0 + 7 * 3600000) { wet.hourly.rain[i] = 0.9; }
  }
  // Open-Meteo-shaped: no provenance, so no hour is measured. The morning's
  // rain is a forecast for a time that has gone — it makes no claim here.
  const guess = charts.prepareView(wet, NOON);
  assert.equal(guess.rain[7], null, 'an unmeasured past hour carries no amount');
  assert.equal(guess.rain[19], 1.2, 'the future is untouched — it is a forecast, and says so');
  const svg = charts.tempPanelSvg(guess, { temperatureUnits: 'c' }, charts.palette(false)).main;
  assert.equal(svg.indexOf('id="wx-bar-temp-7"'), -1, 'and draws no bar');
  assert.ok(svg.indexOf('id="wx-bar-temp-19"') !== -1, 'while the forecast bars stand');
  assert.equal(charts.tipHtml('temp', guess, 7, {}).indexOf('0.9'), -1,
    'the tip does not quote it either');

  // DWD-shaped: the same hour backed by a station reading. That IS what
  // fell, so it stays — bar, tip and all.
  const withObs = JSON.parse(JSON.stringify(wet));
  withObs.hourly.measured = withObs.hourly.time.map((t) => t < NOON);
  const obs = charts.prepareView(withObs, NOON);
  assert.equal(obs.rain[7], 0.9, 'a measured past hour keeps what it recorded');
  assert.equal(obs.measured[7], true);
  assert.equal(obs.measured[19], false, 'and the future is never "measured"');
  const obsSvg = charts.tempPanelSvg(obs, { temperatureUnits: 'c' }, charts.palette(false)).main;
  assert.ok(obsSvg.indexOf('id="wx-bar-temp-7"') !== -1, 'its bar is drawn');
  assert.match(charts.tipHtml('temp', obs, 7, {}), /<b>Rain<\/b><i>0\.9 mm<\/i>/);
  // The chance is gone either way: a probability never resolves.
  assert.equal(obs.prob[7], null, 'even a measured past hour has no "chance" left');
});

test('a day tile describes a WHOLE day, on the same yardstick as the four beside it', () => {
  const raw = fixtureData();
  assert.equal(raw.daily[0].probMax, 0, 'the provider called today 0%');
  // The hourly rows settle — the past loses its chance, and its rain bar
  // unless a station measured it — but the tiles do not. Every other tile
  // in the row is a figure for a whole day; settling today alone would
  // measure it on a different yardstick than its four neighbours.
  const view = charts.prepareView(fixtureData(), NOON);
  assert.deepEqual(view.daily, raw.daily, "the tiles are the provider's, untouched");
  // Settling only the CHANCE was worse still: the tile prints amount over
  // chance in one column, so a rained-on morning read "1 mm" over "0%" —
  // two windows stacked as if they were one statement.
  assert.equal(view.daily[0].rainMm, raw.daily[0].rainMm);
  assert.equal(view.daily[0].probMax, raw.daily[0].probMax);
  // Late in the day the hours below have gone blank and the tile has not.
  const late = charts.prepareView(fixtureData(), DAY0 + 23 * 3600000);
  assert.equal(late.daily[0].probMax, raw.daily[0].probMax);
  assert.equal(late.prob[0], null, 'while the settled hours below it are blank');
  // And the fetched data is never mutated, whichever way the view reads it.
  const data = fixtureData();
  charts.prepareView(data, NOON);
  assert.deepEqual(data.daily, raw.daily, 'the fetched data is left alone');
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
  const nowWidth = Number(/<line [^>]*stroke-width="(1\.2)"[^>]*opacity="[\d.]+"/.exec(surfaces.press.main)[1]);

  Object.keys(surfaces).forEach((id) => {
    const svg = surfaces[id].main;
    // By the page ink: the strip's hour ticks stand at every midnight too,
    // but they are axis-coloured stubs hanging off the ruler.
    // In the strip a rule is drawn as the segments left over after the hour
    // label is taken out of it, so a midnight can contribute more than one
    // element. The claim is about POSITIONS ruled, not lines emitted.
    const edges = verticals(svg).filter((v) =>
      v.x >= 0 && v.x % charts.DAY_W === 0 && v.tag.indexOf('stroke="' + pal.ink + '"') !== -1);
    const edgeXs = edges.map((e) => e.x).filter((x, i, a2) => a2.indexOf(x) === i);
    assert.equal(edgeXs.length, view.days + 1,
      id + ': one rule per local midnight, both ends of the timeline included '
      + '(got ' + edgeXs.join(',') + ')');
    for (let d = 0; d <= view.days; d += 1) {
      assert.ok(edges.some((e) => e.x === d * charts.DAY_W),
        id + ': day ' + d + ' starts at x=' + (d * charts.DAY_W));
    }
    edges.forEach((e) => {
      assert.ok(e.tag.indexOf('stroke="' + pal.ink + '"') !== -1,
        id + ': the boundary runs the page ink (white on the dark theme)');
      const op = Number(/opacity="([\d.]+)"/.exec(e.tag)[1]);
      assert.equal(op, 1,
        id + ': the day boundary runs at FULL ink — it is the structure a '
        + 'swipe navigates by, not a hint (' + op + ')');
      assert.equal(op, nowOpacity,
        id + ': and so does the now line; the two are page furniture and '
        + 'neither whispers (' + op + ' vs ' + nowOpacity + ')');
      const dayW = Number(/stroke-width="([\d.]+)"/.exec(e.tag)[1]);
      assert.ok(dayW < nowWidth,
        id + ': they tell each other apart by WEIGHT instead — the now line '
        + 'is the heavier (' + dayW + ' vs ' + nowWidth + ')');
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
    // Segments, in the strip: the boundary is one line with a hole punched
    // where the hour label sits, so the claim is that the TOPMOST segment
    // opens the box and the bottom one closes it.
    // By the page ink: the strip's hour tick stands at this midnight too,
    // but it is an axis-coloured stub hanging off the ruler.
    const segs = verticals(pair[1].main).filter((v) =>
      v.x === charts.DAY_W && v.tag.indexOf('stroke="' + pal.ink + '"') !== -1);
    assert.ok(segs.length, pair[0] + ': the box carries a midnight rule');
    assert.equal(segs[0].y1, 0, pair[0] + ': the rule starts at the box top');
    assert.equal(segs[segs.length - 1].y2, pair[1].H,
      pair[0] + ': and runs to its bottom');
    // And the hole is a hole, not a second rule somewhere else: the pieces
    // run top to bottom in order, never overlapping.
    for (let k = 1; k < segs.length; k += 1) {
      assert.ok(segs[k].y1 >= segs[k - 1].y2,
        pair[0] + ': segment ' + k + ' starts below the one before it ('
        + segs[k - 1].y2 + ' → ' + segs[k].y1 + ')');
    }
  });
});

test('a bar fills the hour it is about — the one STARTING on its own tick', () => {
  // A line or a dot marks the instant an hour begins, so it sits ON the
  // tick. A bar is a claim about a whole hour, and the hour it claims is
  // the one its tick opens — the hour the watch's rain bar draws for the
  // same slot, and the one a tap on that tick asks about. (The data layer
  // re-stamps the providers that report the hour BEFORE their stamp.) So
  // 19:00's bar covers 19:00 → 20:00 and stands to the RIGHT of its tick.
  const pal = charts.palette(false);
  const view = charts.prepareView(fixtureData(), NOON);
  const rectOf = (svg, id) => {
    const t = new RegExp('<rect id="' + id + '"[^>]*>').exec(svg);
    if (!t) { return null; }
    return { x: Number(/x="([\d.-]+)"/.exec(t[0])[1]),
      w: Number(/width="([\d.]+)"/.exec(t[0])[1]), tag: t[0] };
  };
  const temp = charts.tempPanelSvg(view, {}, pal);
  const hum = charts.humidityPanelSvg(view, {}, pal);

  const wet = rectOf(temp.main, 'wx-bar-temp-19');
  assert.ok(wet, 'the wet hour draws a bar');
  assert.equal(wet.x, 19 * charts.HOUR_W, 'it starts on its own tick');
  assert.equal(wet.w, charts.HOUR_W, 'and runs exactly one hour wide');
  assert.equal(wet.x + wet.w, 20 * charts.HOUR_W, 'so it ends on the NEXT hour tick');

  // The humidity bars are inset a unit either side so neighbours read as
  // separate bars — inset from the same span, not from a different one.
  const h6 = rectOf(hum.main, 'wx-bar-hum-6');
  assert.ok(h6, 'the humidity hour draws a bar');
  assert.equal(h6.x, 6 * charts.HOUR_W + 1, 'inset one unit into the hour it covers');
  assert.equal(h6.x + h6.w, 7 * charts.HOUR_W - 1, 'and one unit short of the next tick');

  // Nothing overhangs the canvas: the canvas opens AT 00:00, which is where
  // hour 0's bar starts, and the last hour's ends at the canvas's end.
  const last = view.times.length - 1;
  const first = rectOf(hum.main, 'wx-bar-hum-0');
  assert.ok(first, 'the first hour draws its bar');
  assert.equal(first.x, 1, 'from the canvas start');
  const lastHum = rectOf(hum.main, 'wx-bar-hum-' + last);
  assert.ok(lastHum, 'and so does the last');
  assert.ok(lastHum.x + lastHum.w <= view.days * charts.DAY_W,
    'which does not run past the end (' + (lastHum.x + lastHum.w) + ')');

  // Resting bars carry no border; the panel hands the painter the ink that
  // one wears when the crosshair stands in it, so weather-tab.js never has
  // to re-derive a palette value.
  assert.match(wet.tag, /stroke="none"/, 'a resting bar is not outlined');
  assert.equal(temp.marks.bar.lit, pal.ink, 'the lit border is the page ink');
  assert.equal(hum.marks.bar.lit, pal.ink, 'in every panel that has bars');
  assert.equal(charts.tempPanelSvg(view, {}, charts.palette(true)).marks.bar.lit,
    charts.palette(true).ink, 'and follows the theme');
});

test('a bar is the hour its tick OPENS: the now line starts the running one, the hour before it is over', () => {
  // Two things follow from a bar covering the hour that STARTS at its
  // stamp, and only one of them is geometry.
  //
  // The row standing ON the now line is the hour that is running, so it
  // keeps its chance and its forecast rain; the row before it has finished
  // and is settled like every other past hour — its chance goes, and its
  // rain has to have been measured to survive. Read the bound as inclusive
  // and the running hour is blanked: no chance for the hour everyone is
  // asking about, and no rain drawn for it until it is over.
  //
  // And the FIRST row of the canvas is 00:00-01:00, which is on the canvas,
  // so it draws like any other.
  const pal = charts.palette(false);
  // A wet day the provider also says it MEASURED — otherwise every past
  // hour's rain is blanked for want of a measurement and neither claim
  // above can be seen at all. measuredFor takes a VIEW index.
  const wet = (measuredFor) => {
    const fx = fixtureData();
    fx.hourly.measured = [];
    fx.hourly.measuredAll = [];
    for (let k = 0; k < fx.hourly.time.length; k += 1) {
      fx.hourly.rain[k] = 2;
      const m = Boolean(measuredFor(k - 12));   // 12 h of pre-day spill
      fx.hourly.measured.push(m);
      fx.hourly.measuredAll.push(m);
    }
    return fx;
  };
  const rectOf = (svg, id) => new RegExp('<rect id="' + id + '"[^>]*>').exec(svg);

  const all = charts.prepareView(wet(() => true), NOON);
  const now = all.nowIndex;
  assert.equal(now % 3, 0, 'precondition: now stands on a labelled column');
  const temp = charts.tempPanelSvg(all, {}, pal);

  assert.ok(rectOf(temp.main, 'wx-bar-temp-0'), 'hour 0 is 00:00-01:00, on this canvas, so it draws');
  assert.ok(rectOf(charts.humidityPanelSvg(all, {}, pal).main, 'wx-bar-hum-0'),
    'and the same in every panel that has bars');

  // Each figure is centred over the bar of its own hour.
  const over = (i) => charts.xAt(all, i) + charts.HOUR_W / 2;
  const dashesAt = (svg) => (svg.match(/<text x="[\d.]+"[^>]*>\u2013<\/text>/g) || [])
    .map((t) => Number(/x="([\d.]+)"/.exec(t)[1]));
  assert.ok(dashesAt(temp.main).indexOf(over(now - 3)) !== -1,
    'an hour that has ended shows the dash, not a chance');
  assert.equal(dashesAt(temp.main).indexOf(over(now)), -1,
    'the hour that is running does not');
  assert.equal(all.prob[now - 1], null, 'because prepareView took the chance of the hour before away');
  assert.ok(all.prob[now] !== null && all.prob[now] !== undefined,
    'while the running hour keeps its own');

  // Same rain — but now nobody measured the hour before now, or anything
  // after it.
  const late = charts.prepareView(wet((i) => i < now - 1), NOON);
  assert.equal(late.rain[now - 1], null,
    'an unmeasured hour that is over has no rain figure to show');
  const lateTemp = charts.tempPanelSvg(late, {}, pal);
  assert.equal(rectOf(lateTemp.main, 'wx-bar-temp-' + (now - 1)), null, 'so it draws no bar');
  assert.ok(rectOf(lateTemp.main, 'wx-bar-temp-' + (now - 2)),
    'while the hour before it, which WAS measured, keeps its own');
  assert.equal(late.rain[now], 2, 'and the running hour keeps its forecast');
  assert.ok(rectOf(lateTemp.main, 'wx-bar-temp-' + now), 'drawn from the now line on');
});

test('the value dot is a disc, not a hole: it is drawn over the crosshair it stands on', () => {
  // Each dot is an opaque disc in the panel's own surface colour with the
  // series' ring round it, and punching the lines out where the value is is
  // the whole point of that fill. Emitted before the crosshair, the
  // guideline ran straight through the middle of every ring and the mark
  // read as a cross rather than a point. SVG paints in document order, so
  // the only thing that fixes it is coming last.
  const pal = charts.palette(false);
  const view = charts.prepareView(fixtureData(), NOON);
  [['temp', charts.tempPanelSvg(view, { temperatureUnits: 'c' }, pal)],
    ['wind', charts.windPanelSvg(view, {}, pal)],
    ['hum', charts.humidityPanelSvg(view, {}, pal)],
    ['press', charts.pressurePanelSvg(view, {}, pal)]].forEach((pair) => {
    const name = pair[0];
    const svg = pair[1].main;
    const scrub = svg.indexOf('id="wx-scrub-' + name + '"');
    assert.ok(scrub !== -1, name + ': the panel carries a crosshair');
    const dots = [];
    const re = new RegExp('<circle id="wx-dot-' + name + '-[a-z]+"[^>]*>', 'g');
    let m;
    while ((m = re.exec(svg)) !== null) { dots.push({ at: m.index, tag: m[0] }); }
    assert.ok(dots.length, name + ': and at least one value dot');
    dots.forEach((d) => {
      assert.ok(d.at > scrub,
        name + ': the dot is emitted AFTER the crosshair, so it paints over it');
      // Opaque, or being on top would change nothing.
      assert.match(d.tag, new RegExp('fill="' + pal.surface + '"'),
        name + ': filled with the panel surface, not hollow');
      assert.ok(d.tag.indexOf('fill="none"') === -1, name + ': never fill="none"');
    });
    // The series path still goes UNDER its own dot — the dot marks a point
    // ON the line, and a line drawn over it would halve the ring.
    const firstPath = svg.indexOf('<path d="M');
    if (firstPath !== -1) {
      assert.ok(dots[0].at > firstPath, name + ': and over the series line too');
    }
  });
});

test('a rule in the hour strip breaks around the glyph and the number it crosses', () => {
  // The rules run at full ink now, and type has no background of its own:
  // drawing the line under the text was never enough, because a full-ink
  // stroke still shows between the strokes of a digit and reads as a
  // strike-through. So the line is drawn as the pieces left over.
  const pal = charts.palette(false);
  const view = charts.prepareView(fixtureData(), NOON);
  const spec = charts.timeStripSvg(view, LOC, pal, SunCalc);
  // By the page ink: an hour tick stands at every midnight too, but it is an
  // axis-coloured stub hanging off the ruler, not a boundary.
  const segsAt = (x, width) => (spec.main.match(/<line [^>]*>/g) || [])
    .map((t) => ({
      x: Number(/x1="([\d.]+)"/.exec(t)[1]),
      x2: Number(/x2="([\d.]+)"/.exec(t)[1]),
      y1: Number(/y1="([\d.]+)"/.exec(t)[1]),
      y2: Number(/y2="([\d.]+)"/.exec(t)[1]),
      tag: t
    }))
    .filter((v) => v.x === v.x2 && Math.abs(v.x - x) < 0.05
      && v.tag.indexOf('stroke-width="' + width + '"') !== -1
      && v.tag.indexOf('stroke="' + pal.ink + '"') !== -1)
    .sort((a2, b2) => a2.y1 - b2.y1);

  // A midnight column carries no icon — the weekday marker has that slot —
  // but it does carry an hour label, centred on the fold and halved there by
  // the viewport, which is what the reader asked for. So a day rule breaks
  // exactly once, in the label row, and reads as one line either side of the
  // hole that label fills. The closing fold is the exception and its own
  // explanation: the label row ends with the final day's 21:00, one index
  // short of that fold, so there is nothing standing there to break around.
  for (let d = 0; d <= view.days; d += 1) {
    const rule = segsAt(d * charts.DAY_W, 1);
    const closing = d === view.days;
    assert.equal(rule.length, closing ? 1 : 2,
      'the day rule at day ' + d + ' breaks for its own label (got '
      + rule.map((v) => v.y1 + '…' + v.y2).join(', ') + ')');
    assert.equal(rule[0].y1, 0, 'it opens at the box ceiling');
    assert.equal(rule[rule.length - 1].y2, spec.H, 'and closes on its floor');
    if (!closing) {
      assert.ok(rule[0].y2 <= spec.bandH - 16 && rule[1].y1 >= spec.bandH - 2,
        'with the hole over the label\u2019s own band (got ' + rule[0].y2
        + '…' + rule[1].y1 + ')');
    }
  }
  // The label that hole is for is midnight's, and it is the only one a day
  // that stands on a fold.
  // font-weight 600 picks the ruler's own labels: the selected-hour chip
  // carries a 700 twin at x=0 inside its translated group, and that one is a
  // badge the clamp already keeps clear of the seams.
  const labels = (spec.main.match(/<text [^>]*font-size="11" font-weight="600"[^>]*>[^<]*<\/text>/g) || [])
    .map((t) => ({ x: Number(/x="(-?[\d.]+)"/.exec(t)[1]), txt: />([^<]*)</.exec(t)[1] }))
    .filter((v) => /^\d\d:00$/.test(v.txt));
  // Exactly eight a day — 00:00 through 21:00, every third hour. A count,
  // not a floor: a ruler that labelled every hour would pass any lower bound
  // while setting 35 units of type on a 15-unit pitch, which is not a ruler
  // but a smudge.
  assert.equal(labels.length, 8 * view.days, 'eight labels a day, 00:00…21:00 ('
    + labels.length + ' over ' + view.days + ' days)');
  // One of the eight stands on its day's opening fold and is halved by the
  // viewport there: ":00" at the left edge of every day, "00:" at the right
  // edge of the one before. That is the reader's call over the two
  // alternatives — no midnight label at all, or a nudged one that costs
  // 03:00 its text.
  const onFold = labels.filter((v) => v.x % charts.DAY_W === 0);
  assert.equal(onFold.length, view.days, 'one label a day stands on a fold ('
    + onFold.length + ' over ' + view.days + ')');
  onFold.forEach((v) => {
    assert.equal(v.txt, '00:00',
      'and it is the midnight there, never some other hour (' + v.txt + ' at x=' + v.x + ')');
  });
  // Every other label is whole inside the day it belongs to, clear of both
  // folds by its own half-width — the measured 17.6 of "00:00" at 11px
  // semibold, the widest string this row sets.
  labels.filter((v) => v.x % charts.DAY_W !== 0).forEach((v) => {
    const into = v.x - Math.floor(v.x / charts.DAY_W) * charts.DAY_W;
    assert.ok(into - 17.6 > 0 && into + 17.6 < charts.DAY_W,
      v.txt + ' at ' + into + ' into its day is not whole inside it');
  });
  // And 03:00 pays nothing for midnight: its own text, on its own column.
  assert.equal(labels.filter((v) => v.txt === '03:00').length, view.days,
    '03:00 is named once a day');
  assert.ok(spec.main.indexOf('y2="' + (spec.bandH + 5) + '"') !== -1,
    'and the ruler keeps a long tick on every 3-hourly column');

  // A 3-hourly slot that is not a midnight carries BOTH a glyph and a
  // label, one under the other, and between them the band has nothing left
  // to draw a line in. What must NOT happen is the arithmetic answer: a
  // 2-unit stub above the icon and a 1-unit stub between icon and label,
  // two specks that read as dirt on the screen. The line yields the band
  // and picks up below the ruler.
  const three = charts.prepareView(fixtureData(), DAY0 + 3 * 3600000);
  const threeSpec = charts.timeStripSvg(three, LOC, pal, SunCalc);
  const segsOf = (svg) => (svg.match(/<line [^>]*stroke-width="1\.2"[^>]*>/g) || [])
    .map((t) => ({ y1: Number(/y1="([\d.]+)"/.exec(t)[1]), y2: Number(/y2="([\d.]+)"/.exec(t)[1]) }))
    .sort((a2, b2) => a2.y1 - b2.y1);
  const nowSegs = segsOf(threeSpec.main);
  assert.equal(nowSegs.length, 1,
    'a column with an icon over a label leaves the line one piece, not three '
    + '(got ' + nowSegs.map((v) => v.y1 + '…' + v.y2).join(', ') + ')');
  assert.ok(nowSegs[0].y1 >= threeSpec.bandH - 4,
    'and that piece is the one below the band (' + nowSegs[0].y1 + ')');
  assert.equal(nowSegs[0].y2, threeSpec.H, 'still closing on the floor');
  // The rule against specks, stated on its own: whatever the hour, every
  // piece of line that IS drawn is long enough to read as a line.
  for (let h = 0; h < 24; h += 1) {
    for (let half = 0; half < 2; half += 1) {
      const at = charts.prepareView(fixtureData(), DAY0 + (h + half * 0.5) * 3600000);
      segsOf(charts.timeStripSvg(at, LOC, pal, SunCalc).main).forEach((v) => {
        assert.ok(v.y2 - v.y1 >= 3,
          'a ' + (v.y2 - v.y1) + '-unit stub at ' + h + ':' + (half ? '30' : '00')
          + ' is a speck, not a line');
      });
    }
  }

  // The now line stands on an hour tick, and an hour tick is never more than
  // one hour — 15 units — from a 3-hourly label whose own half-width is 17.5
  // (measured in the browser: "00:00" at 11px/600 sets 35 units wide). Every
  // 3-hourly column carries a label now, midnights included, so EVERY hour
  // lands inside one: the band is never crossed whole, at any hour of the
  // day. Stated as that universal rather than as the list of exempt hours it
  // was while two columns stood textless.
  for (let h = 0; h < 24; h += 1) {
    const at = charts.prepareView(fixtureData(), DAY0 + h * 3600000 + 11 * 60000);
    const segs = segsOf(charts.timeStripSvg(at, LOC, pal, SunCalc).main);
    assert.ok(segs.length >= 1, 'the strip carries a now line at ' + h + ':11');
    const whole = segs.length === 1 && segs[0].y1 === 0;
    assert.equal(whole, false,
      'at ' + h + ':11 the rule breaks for the label it crosses (got '
      + segs.map((v) => v.y1 + '…' + v.y2).join(', ') + ')');
    // And the break is in the label's own row wherever the hour falls: the
    // piece the line ends on picks up below it, never inside it.
    assert.ok(segs[segs.length - 1].y1 >= 42,
      'at ' + h + ':11 the last piece starts below the label ('
      + segs[segs.length - 1].y1 + ')');
    assert.equal(segs[segs.length - 1].y2, 52, 'and always reaches the floor');
  }

  // 01:00 is the busiest hour in the band, and one of the two things it runs
  // into does not stand on a tick at all. The weekday marker never has — it
  // is a left-anchored word in the day's corner, so "what does the nearest
  // tick hold?" could never see it, and the rule used to run through the
  // middle of "Sun". The midnight label it also crosses does stand on one,
  // its own fold 15 units to the left, and 15 is inside the label's 17-unit
  // reach. So the rule comes out in THREE pieces — the corner above the
  // word, the gap between word and number, and the tail below.
  const corner = charts.prepareView(fixtureData(), DAY0 + 3600000 + 11 * 60000);
  assert.equal(charts.nowX(corner), charts.HOUR_W, 'precondition: 01:11 snaps to 01:00');
  const cornerSegs = segsOf(charts.timeStripSvg(corner, LOC, pal, SunCalc).main);
  assert.equal(cornerSegs.length, 3,
    'the 01:00 rule clears the weekday marker AND the midnight label beside it (got '
    + cornerSegs.map((v) => v.y1 + '…' + v.y2).join(', ') + ')');
  assert.ok(cornerSegs[0].y2 <= 7 && cornerSegs[1].y1 >= 16,
    'the first hole covers the word\u2019s own band, 7…16');
  assert.ok(cornerSegs[1].y2 <= 28 && cornerSegs[2].y1 >= 42,
    'and the second covers the label\u2019s, 28…42');
  // The day rule beside it does not gap for the WORD, though: the marker is
  // drawn 4 units clear of its midnight, so the rule passes to its left. Its
  // one break is its own label's, like every other fold's.
  const dayRule = segsAt(charts.DAY_W, 1);
  assert.equal(dayRule.length, 2, 'the midnight rule breaks once, for its own label');
  assert.ok(dayRule[0].y2 >= 16,
    'and runs past the weekday marker\u2019s band rather than through it ('
    + dayRule[0].y2 + ')');
});

test('the strip gaps for the glyph that is drawn, not the one the arithmetic expects', () => {
  // The icon row skips an hour whose condition never arrived: a provider
  // can send no hourly codes at all, and the grid keeps `icon` null when no
  // sample falls near enough, so the renderer does `if (!id) continue`.
  // Deciding the gap from the hour NUMBER alone then breaks the line for a
  // glyph that is not on screen — and it breaks it fatally, because the
  // icon band and the label band between them leave two slivers under
  // MIN_SEG: both get absorbed and the rule has nothing at all inside the
  // 44-unit band, just a stub hanging off the ruler.
  const pal = charts.palette(false);
  const bare = fixtureData();
  for (let k = 0; k < bare.hourly.icon.length; k += 1) { bare.hourly.icon[k] = null; }
  const view = charts.prepareView(bare, DAY0 + 3 * 3600000);
  assert.equal(charts.nowX(view), 3 * charts.HOUR_W,
    'precondition: the now line stands on 03:00, a 3-hourly column');
  const spec = charts.timeStripSvg(view, LOC, pal, SunCalc);
  // The hour row's glyphs carry no id; the selected-hour chip's does, and
  // it has a placeholder to fall back on, so it is not the one in question.
  assert.equal((spec.main.match(/<use xlink:href/g) || []).length, 0,
    'precondition: with no conditions, the hour row draws no glyph at all');
  const segs = (spec.main.match(/<line [^>]*stroke-width="1\.2"[^>]*>/g) || [])
    .map((t) => ({ y1: Number(/y1="([\d.]+)"/.exec(t)[1]), y2: Number(/y2="([\d.]+)"/.exec(t)[1]) }))
    .sort((a2, b2) => a2.y1 - b2.y1);
  assert.equal(segs.length, 2,
    'the rule breaks around the hour label and nothing else (got '
    + segs.map((v) => v.y1 + '…' + v.y2).join(', ') + ')');
  assert.equal(segs[0].y1, 0, 'so it still opens at the box ceiling');
  assert.ok(segs[0].y2 >= spec.bandH - 20,
    'and runs down through the empty icon row to the label (' + segs[0].y2 + ')');
  assert.equal(segs[1].y2, spec.H, 'before closing on the floor');

  // The same hour WITH its condition is the control: there the gap is
  // earned, the band has nothing left to draw in, and the line yields it.
  const lit = charts.prepareView(fixtureData(), DAY0 + 3 * 3600000);
  const litSegs = (charts.timeStripSvg(lit, LOC, pal, SunCalc).main
    .match(/<line [^>]*stroke-width="1\.2"[^>]*>/g) || [])
    .map((t) => Number(/y1="([\d.]+)"/.exec(t)[1]));
  assert.equal(litSegs.length, 1, 'a real glyph leaves one piece');
  assert.ok(litSegs[0] >= spec.bandH - 4, 'and it is the one below the band');
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

test('every mark that says "now" stands on the hour the rest of the tab calls now', () => {
  // nowIndex floors: at 18:11 the strip's chip reads 18:00, the hours the
  // view blanks as past are the ones BEFORE 18, and a tap with no scrub
  // lands on 18. The drawn marks used to read the exact minute instead, so
  // the hairline stood 11 minutes right of the hour it pointed at — and
  // since a bar came to fill the span between two ticks, the washed past cut
  // 2.8 units into the current hour's OWN bar. One reading for all of them.
  const pal = charts.palette(false);
  const tickOf = (svg) => {
    const m = /<line x1="([\d.]+)"[^>]*stroke-width="1\.2"/.exec(svg);
    return m ? Number(m[1]) : null;
  };
  const washOf = (svg) => {
    const m = /<rect x="0" y="0" width="([\d.]+)"[^>]*fill="([^"]*)"\/>/.exec(svg);
    return m && m[2] === pal.past ? Number(m[1]) : null;
  };
  // Every minute of an hour renders the same marks: the hour does not creep.
  const seen = {};
  for (let min = 0; min < 60; min += 7) {
    const view = charts.prepareView(fixtureData(), DAY0 + 18 * 3600000 + min * 60000);
    assert.equal(view.nowIndex, 18, 'the hour itself does not move at :' + min);
    const strip = charts.timeStripSvg(view, LOC, pal, SunCalc);
    assert.equal(tickOf(strip.main), charts.xAt(view, 18),
      'the strip now line sits on 18:00’s tick at :' + min);
    assert.equal(washOf(strip.main), charts.xAt(view, 18),
      'and the washed past ends exactly there — the current hour’s bar '
      + 'is whole, not cut ' + min / 4 + ' units in');
    seen[tickOf(strip.main)] = true;
  }
  assert.deepEqual(Object.keys(seen), [String(charts.xAt(charts.prepareView(
    fixtureData(), DAY0 + 18 * 3600000), 18))], 'one x for the whole hour');

  // And it is the TOP of the hour, not the nearest one: 18:59 is still 18.
  const late = charts.prepareView(fixtureData(), DAY0 + 18 * 3600000 + 59 * 60000);
  assert.equal(tickOf(charts.timeStripSvg(late, LOC, pal, SunCalc).main),
    charts.xAt(late, 18), '18:59 is the 18:00 hour, not the 19:00 one');

  // The panels carry the same mark, from the same place.
  const view = charts.prepareView(fixtureData(), DAY0 + 18 * 3600000 + 11 * 60000);
  const temp = charts.tempPanelSvg(view, { temperatureUnits: 'c' }, pal);
  assert.equal(tickOf(temp.main), charts.xAt(view, 18),
    'the panel now line agrees with the strip’s');
  // The current hour's bar begins where the wash stops, so the two never
  // overlap: the hour that is running is drawn as running, not half over.
  const bar = /<rect id="wx-bar-temp-18" x="([\d.]+)"/.exec(temp.main);
  if (bar) {
    assert.equal(Number(bar[1]), charts.xAt(view, 18),
      'the running hour’s bar starts at the now line, not under it');
  }

  // The sun panel puts its discs at the same x AND reads the sky at that
  // same instant, so the moon sits ON the arc it is drawn over rather than
  // beside it. Proven by moving only the minutes: the disc must not move.
  const sunAt = (min) => {
    const v = charts.prepareView(fixtureData(), DAY0 + 18 * 3600000 + min * 60000);
    const svg = charts.sunMoonPanelSvg(v, LOC, pal, SunCalc).main;
    const c = /<circle cx="([\d.]+)" cy="([\d.]+)" r="5\.5"/.exec(svg);
    return c ? { cx: Number(c[1]), cy: Number(c[2]) } : null;
  };
  const a = sunAt(1);
  const b = sunAt(58);
  assert.ok(a && b, 'the sun panel draws a moon disc');
  assert.deepEqual(a, b,
    'the disc holds still through the hour — x and altitude are read '
    + 'from one instant, so it cannot drift off its own arc');
});

test('no 3-hourly mark stands on a day boundary — that is where a viewport folds', () => {
  // Each panel is one day wide inside an overflow:hidden viewport, so a day
  // boundary is not a line on a canvas: it is the fold between two screens.
  // A mark centred on one is therefore sliced down the middle and shows as
  // two halves, one at the right edge of the day before and one at the left
  // edge of the day after — which is what the reader reported: ":00" and
  // "00:", "10" and "0%". The condition-icon row has always skipped those
  // columns, and the precipitation figures and the direction arrows now do
  // too. The remaining seven columns a day sit at 45…315, a margin of one
  // pitch at each end.
  //
  // The hour LABELS are the one deliberate exception, and the reader's own
  // call: a halved "00:00" reads better to them than an unnamed midnight or
  // a 03:00 with its text taken away, which were the two alternatives. The
  // label row is pinned in its own test below.
  const pal = charts.palette(false);
  const view = charts.prepareView(fixtureData(), NOON);
  const settings = { temperatureUnits: 'c', windUnits: 'kmh' };
  const onSeam = (xs) => xs.filter((x) => x % charts.DAY_W === 0);
  const perDay = 24 / 3 - 1;

  // The probability row: `<text>` centred over the bar of every third hour
  // — half an hour past a multiple of HOUR_W*3. Placed by the hour it is
  // for, it obeys the same rule as the marks that sit on ticks.
  const probXs = (charts.tempPanelSvg(view, settings, pal).main
    .match(/<text x="[\d.]+" y="[\d.]+" text-anchor="middle" font-size="[\d.]+"/g) || [])
    .map((t) => Number(/x="([\d.]+)"/.exec(t)[1]) - charts.HOUR_W / 2);
  assert.equal(probXs.length, perDay * view.days,
    'seven probability figures a day (got ' + probXs.length + ' over ' + view.days + ')');
  assert.ok(probXs.every((x) => x % (charts.HOUR_W * 3) === 0),
    'each centred over its own hour\'s bar');
  assert.deepEqual(onSeam(probXs), [], 'none of them for an hour opening a day');
  // Including hour 0, whose figure would start on the canvas's left edge.
  assert.equal(probXs.indexOf(0), -1, 'and none at the canvas start');

  // The direction row: a rotated `<g>` per arrow.
  const dirXs = (charts.windPanelSvg(view, settings, pal).main
    .match(/<g transform="translate\([\d.]+ [\d.]+\) rotate\([\d.]+\)">/g) || [])
    .map((t) => Number(/translate\(([\d.]+) /.exec(t)[1]));
  assert.equal(dirXs.length, perDay * view.days,
    'seven arrows a day (got ' + dirXs.length + ')');
  assert.deepEqual(onSeam(dirXs), [], 'none of them on a seam');

  // And the icon row, which had the rule first.
  const iconXs = (charts.timeStripSvg(view, LOC, pal, SunCalc).main
    .match(/<use [^>]*transform="translate\([\d.]+ [\d.]+\) scale/g) || [])
    .map((t) => Number(/translate\(([\d.]+) /.exec(t)[1]) + 11);
  assert.deepEqual(onSeam(iconXs), [], 'no icon on a seam either');

  // Stated as the invariant rather than three counts: every 3-hourly mark's
  // hour sits a whole pitch clear of both folds of the day it belongs to (a
  // figure, centred half an hour on, still clears the right fold by 2.5).
  probXs.concat(dirXs).forEach((x) => {
    const into = x - Math.floor(x / charts.DAY_W) * charts.DAY_W;
    assert.ok(into >= charts.HOUR_W * 3 && into <= charts.DAY_W - charts.HOUR_W * 3,
      'x=' + x + ' is ' + into + ' into its day — inside the pitch at one end');
  });
});

test('midnight is named in the ruler, on the fold it stands on', () => {
  // Three arrangements have stood here and the reader picked this one. A day
  // boundary is a viewport fold, so a label centred on one is halved: ":00"
  // opens each day and "00:" closes the one before. Dropping the label
  // instead left the hour the whole ruler is built around unnamed. Nudging it
  // into the day it opens cost 03:00 its text — a label setting 35.2 measured
  // units on a 45-unit pitch cannot travel the 17.6 it needs to leave the
  // fold and still leave its neighbour room. So midnight is named, on its
  // fold, clipped there, and nothing else pays for it.
  const pal = charts.palette(false);
  const view = charts.prepareView(fixtureData(), NOON);
  const spec = charts.timeStripSvg(view, LOC, pal, SunCalc);
  const labels = (spec.main.match(/<text [^>]*font-size="11" font-weight="600"[^>]*>[^<]*<\/text>/g) || [])
    .map((t) => ({ x: Number(/x="(-?[\d.]+)"/.exec(t)[1]), txt: />([^<]*)</.exec(t)[1] }))
    .filter((v) => /^\d\d:00$/.test(v.txt));

  // Which hours are named, within one day. The set is the point: every third
  // hour, from the midnight that opens the day to the 21:00 that closes it.
  const day0 = labels.filter((v) => v.x >= 0 && v.x < charts.DAY_W)
    .sort((a2, b2) => a2.x - b2.x).map((v) => v.txt);
  assert.deepEqual(day0,
    ['00:00', '03:00', '06:00', '09:00', '12:00', '15:00', '18:00', '21:00'],
    'every third hour is named, midnight included and 03:00 with it');

  // Each midnight stands ON its fold. This is the clipping, written as the
  // position that causes it rather than as a pixel count.
  const mids = labels.filter((v) => v.txt === '00:00').sort((a2, b2) => a2.x - b2.x);
  assert.equal(mids.length, view.days, 'one a day, no more');
  mids.forEach((v, d) => {
    assert.equal(v.x, d * charts.DAY_W,
      'day ' + d + '\u2019s midnight is centred on its fold, not nudged off it');
  });
  // And the halving is the VIEWPORT's doing, not the renderer's: the label
  // goes out whole and centre-anchored, and overflow:hidden takes whichever
  // half falls outside the day being read. Anchoring it at the start instead
  // would clip nothing and would also stand the text 17.6 units off the tick
  // it names, which is the one thing a ruler exists to get right.
  assert.match(spec.main,
    /<text x="0" y="\d+" text-anchor="middle" font-size="11" font-weight="600"[^>]*>00:00</,
    'day 0\u2019s midnight is centre-anchored on the fold at x=0');

  // The closing fold is the one midnight NOT named: the label row ends with
  // the last day's 21:00, one index short of it. So the final viewport's
  // right edge carries no half-label where every other day's does.
  assert.equal(labels.filter((v) => v.x >= view.days * charts.DAY_W).length, 0,
    'nothing is labelled past the end of the timeline');

  // 03:00 keeps everything: its text, its icon, and its long ruler tick.
  assert.equal(labels.filter((v) => v.txt === '03:00').length, view.days,
    '03:00 is named once a day');
  const iconXs = (spec.main.match(/<use [^>]*transform="translate\([\d.]+ [\d.]+\) scale/g) || [])
    .map((t) => Number(/translate\(([\d.]+) /.exec(t)[1]) + 11);
  assert.ok(iconXs.indexOf(3 * charts.HOUR_W) !== -1, 'and its icon still stands on its column');

  // A line crossing a label still breaks around it, which is the other half
  // of putting midnight back: the gap machinery asks the nearest TICK what it
  // holds, and every 3-hourly tick holds a label again. At 02:00 the nearest
  // is 03:00's, 15 units to the right and inside its 17-unit reach.
  const across = charts.prepareView(fixtureData(), DAY0 + 2 * 3600000 + 11 * 60000);
  assert.equal(charts.nowX(across), 2 * charts.HOUR_W, 'precondition: 02:11 snaps to 02:00');
  const segs = (charts.timeStripSvg(across, LOC, pal, SunCalc).main
    .match(/<line [^>]*stroke-width="1\.2"[^>]*>/g) || [])
    .map((t) => ({ y1: Number(/y1="([\d.]+)"/.exec(t)[1]), y2: Number(/y2="([\d.]+)"/.exec(t)[1]) }))
    .sort((a2, b2) => a2.y1 - b2.y1);
  assert.equal(segs.length, 2,
    'the 02:00 line breaks around the 03:00 label beside it (got '
    + segs.map((v) => v.y1 + '…' + v.y2).join(', ') + ')');
  assert.ok(segs[0].y2 <= 28 && segs[1].y1 >= 42, 'over the label’s own band');
});

test('a prepared view is a whole number of days — the folds have nothing past them', () => {
  // The hour strip's label row leans on this at both ends: it runs to the
  // last hour in the series, so a whole number of days is what leaves the
  // final 21:00 one index short of the closing fold, and what makes every
  // named midnight the opening of a day that actually exists. A trailing
  // part-day would put a day rule where there is no day behind it. Several
  // other places take the same shape for granted — the day rules, the tile
  // row's day count, and the pan's clamp to days - 1 — so it is pinned once,
  // here, at the one function that decides it.
  const DAY0 = Math.floor(Date.now() / 86400000) * 86400000;
  const shapes = [
    [-12, 72, 0, 'the standard fixture span'],
    [-12, 73, 0, 'one hour into a fourth day'],
    [0, 25, 0, 'one hour into a second day'],
    [0, 1, 0, 'a single hour'],
    [0, 5, 0, 'a handful of hours'],
    [-48, 120, 0, 'two days of history and five ahead'],
    [-12, 100, 0, 'a ragged tail'],
    [-12, 72, 19800, 'India, +05:30 — local midnight is not on an hour index'],
    [-12, 72, 45900, 'Chatham, +12:45'],
    [-12, 72, -28800, 'the other side of the date line']
  ];
  shapes.forEach((sh) => {
    const raw = fixtureData();
    const hourly = { time: [] };
    Object.keys(raw.hourly).forEach((k) => { hourly[k] = []; });
    for (let h = sh[0]; h < sh[1]; h += 1) {
      Object.keys(raw.hourly).forEach((k) => {
        hourly[k].push(k === 'time' ? DAY0 + h * 3600000 : raw.hourly[k][0]);
      });
    }
    const view = charts.prepareView(
      { hourly: hourly, daily: raw.daily, utcOffsetSec: sh[2], fetchedAt: DAY0 },
      DAY0 + 12 * 3600000);
    assert.equal(view.times.length, 24 * view.days,
      sh[3] + ': ' + view.times.length + ' hours is not ' + view.days + ' whole days');
    assert.ok(view.days >= 1, sh[3] + ': and there is at least one day to show');
  });
});
