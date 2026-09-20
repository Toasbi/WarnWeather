// test/weather-tab.test.js — the Weather tab's glue: chip row rendering,
// provider options, the graphs block's fetch orchestration (stubbed through
// the shared data module instance — no network), and the pan-snap math.
const test = require('node:test');
const assert = require('node:assert/strict');
const tab = require('../src/pkjs/settings/weather-tab.js');
const data = require('../src/pkjs/settings/weather-tab-data.js');
const model = require('../src/pkjs/settings/weather-tab-model.js');
const css = require('../src/pkjs/settings/weather-tab-css.js');
const charts = require('../src/pkjs/settings/weather-tab-charts.js');

// The glue calls Date.now() itself (ensureFetch prepares the view against
// the real clock), so the fixture anchors to the REAL current UTC day —
// with utcOffsetSec 0 the view's day start lands exactly on it, whatever
// date or timezone the suite runs in.
const DAY0 = Math.floor(Date.now() / 86400000) * 86400000;
const SEED = { graphsSeed: { lat: 52.52, lon: 13.405, name: 'Berlin' } };

/** @returns {Object} a minimal normalized dataset the charts accept */
function fixture() {
  const hourly = { time: [], temp: [], rain: [], prob: [], wind: [], gust: [], dir: [], rh: [], dew: [], pressure: [], icon: [], sunshineMin: [] };
  for (let h = 0; h <= 48; h += 1) {
    hourly.time.push(DAY0 + h * 3600000);
    hourly.temp.push(15);
    hourly.rain.push(0);
    hourly.prob.push(10);
    hourly.wind.push(10);
    hourly.gust.push(18);
    hourly.dir.push(200);
    hourly.rh.push(60);
    hourly.dew.push(8);
    hourly.pressure.push(1013);
    hourly.icon.push('clear');
  }
  return {
    hourly,
    daily: [{ date: DAY0, tmin: 10, tmax: 20, icon: 'clear', rainMm: 0, probMax: 5, sunshineH: 8 }],
    utcOffsetSec: 0
  };
}

test('graphsProviderOptions labels Auto with its resolution and gates keyed rows', () => {
  const opts = tab.graphsProviderOptions({ provider: 'dwd' });
  assert.equal(opts[0][1], 'auto');
  assert.match(opts[0][0], /Auto \(DWD/);
  assert.deepEqual(opts.slice(1).map((o) => o[1]), ['dwd', 'openmeteo']);
  const withKeys = tab.graphsProviderOptions({ provider: 'metno', owmApiKey: 'k' });
  assert.match(withKeys[0][0], /Auto \(Open-Meteo\)/, 'metno is not page-fetchable');
  assert.ok(withKeys.some((o) => o[1] === 'openweathermap'));
});

test('graphsProviderHeader labels the collapsed Provider card with the current pick', () => {
  assert.match(tab.graphsProviderHeader({ provider: 'dwd' }), /^Auto \(DWD/, 'no pick reads as Auto');
  assert.equal(tab.graphsProviderHeader({ graphsProvider: 'openmeteo' }), 'Open-Meteo');
  assert.equal(tab.graphsProviderHeader({ graphsProvider: 'tomorrowio', tomorrowioApiKey: 't' }), 'tomorrow.io');
  assert.match(tab.graphsProviderHeader({ graphsProvider: 'tomorrowio' }), /^Auto/,
    'a keyed pick whose key is gone falls back to the Auto label');
});

test('firstFreeSlot walks the three slots', () => {
  const slot = model.serializeSlot({ name: 'X', lat: 1, lon: 2 });
  assert.equal(tab.firstFreeSlot({}), 1);
  assert.equal(tab.firstFreeSlot({ savedLocation1: slot }), 2);
  assert.equal(tab.firstFreeSlot({ savedLocation1: slot, savedLocation2: slot, savedLocation3: slot }), null);
});

test('the chip row: current seed, saved slots, Add, and the no-location hint', () => {
  const slot = model.serializeSlot({ name: 'Siegen', lat: 50.9, lon: 8.0 });
  let html = tab.weatherLocationsBlock({ graphsLocation: 'current', savedLocation1: slot }, {}, SEED);
  assert.ok(html.indexOf('Berlin') !== -1, 'current chip carries the seeded city');
  assert.ok(html.indexOf('Siegen') !== -1);
  assert.ok(html.indexOf('+ Add') !== -1, 'a free slot offers Add');
  assert.ok(html.indexOf('wx-chip on') !== -1);
  assert.equal(html.indexOf('wx-chip-tools'), -1, 'no Replace/Remove while Current is active');

  html = tab.weatherLocationsBlock({ graphsLocation: '1', savedLocation1: slot }, {}, SEED);
  assert.ok(html.indexOf('wx-chip-tools') !== -1, 'the active saved slot offers Replace/Remove');

  html = tab.weatherLocationsBlock({}, {}, {});
  assert.ok(html.indexOf('disabled') !== -1, 'no seed disables the Current chip');
  assert.ok(html.indexOf('No location yet') !== -1);

  const full = {
    savedLocation1: slot, savedLocation2: slot, savedLocation3: slot
  };
  html = tab.weatherLocationsBlock(full, {}, SEED);
  assert.equal(html.indexOf('+ Add'), -1, 'three slots hide Add');
});

test('the graphs block orchestrates: loading → panels on data, error → Retry, no double fetch', () => {
  tab._resetState();
  let calls = 0;
  let respond = null;
  const realFetch = data.fetchWeather;
  data.fetchWeather = (provider, lat, lon, settings, cb) => {
    calls += 1;
    respond = cb;
  };
  try {
    const state = { graphsLocation: 'current', temperatureUnits: 'c', windUnits: 'kph' };
    let rendered = 0;
    tab._setCtx({ S: state, render: () => { rendered += 1; } });

    let html = tab.weatherGraphsBlock(state, {}, SEED);
    assert.match(html, /Loading Berlin/);
    assert.equal(calls, 1);
    html = tab.weatherGraphsBlock(state, {}, SEED);
    assert.equal(calls, 1, 'a re-render while loading must not refetch');

    const fx = fixture();
    respond(fx, null);
    assert.equal(rendered, 1, 'data arrival asks the engine for a repaint');
    html = tab.weatherGraphsBlock(state, {}, SEED);
    assert.ok(html.indexOf('Temperature &amp; precipitation') !== -1);
    assert.equal(html.indexOf('wx-readout'), -1,
      'no per-graph readout row: the floating tip is the only value surface');
    assert.equal(html.indexOf('wx-read-'), -1, 'and no readout mount ids');
    assert.ok(html.indexOf('5-day forecast') !== -1);
    assert.ok(html.indexOf('5-day forecast') < html.indexOf('data-wxvp="strip"'),
      'the 5-day selector leads, then the shared hour strip (the app layout)');
    assert.ok(html.indexOf('data-wxvp="strip"') < html.indexOf('Temperature &amp; precipitation'));
    const stickyAt = html.indexOf('<div class="wx-sticky"><div class="wx-days">');
    assert.ok(stickyAt !== -1,
      'the pinned box opens straight onto the 5-day tile row (tiles pin too)');
    const stripVpAt = html.indexOf('data-wxvp="strip"');
    const seam = html.indexOf('</div><div class="wx-bleed">', stickyAt);
    assert.ok(seam !== -1 && seam < stripVpAt && stripVpAt - seam < 200,
      'the hour strip\'s bleed box follows the tile row immediately, inside '
      + 'the same pinned element — tiles and time axis travel together');
    assert.equal(html.indexOf('<div class="wx-sticky">', stickyAt + 1), -1,
      'and nothing else pins — one sticky element');
    // The seam substring alone cannot tell "strip inside the sticky box"
    // from "sticky closes after the tiles, strip follows as a sibling":
    // both contain '</div><div class="wx-bleed">'. A DOUBLE close before
    // the strip viewport is the sibling shape — the tile row's close
    // followed by the sticky's own — so its absence pins containment.
    const dblClose = html.indexOf('</div></div>', stickyAt);
    assert.ok(dblClose === -1 || dblClose > stripVpAt,
      'the hour strip rides INSIDE the pinned box, not as a sibling '
      + 'after it closes');
    // The tile icon's two sizes move in lockstep: the renderer's px and
    // the CSS min-height that keeps icon-LESS tiles from collapsing
    // shorter than icon-bearing ones. Read one, assert the other.
    const iconPx = Number((css.WX_CSS.match(/\.wx-day-icon\{[^}]*min-height:(\d+)px/) || [])[1]);
    assert.ok(iconPx > 0, '.wx-day-icon reserves the icon slot height');
    assert.ok(html.indexOf('class="wx-day-icon"><svg viewBox="0 0 25 25" width="' + iconPx + '"') !== -1,
      'the tile renderer draws its icon at the SAME size the CSS reserves');
    assert.ok(css.WX_CSS.indexOf('.wx-sticky{position:-webkit-sticky;position:sticky') !== -1,
      '.wx-sticky actually pins (both position spellings for old WebViews)');
    // The pinned strip's two companion fixes: the sticky box itself
    // carries the -16px bleed (inner wrapper zeroed) so its opaque
    // backdrop covers the full strip width, and the tip stacks above it.
    const stickyGap = Number((css.WX_CSS.match(/\.wx-sticky \.wx-bleed\{margin:(\d+)px 0 0/) || [])[1]);
    assert.ok(/\.wx-sticky\{[^}]*margin:8px -16px 0/.test(css.WX_CSS)
      && stickyGap > 0
      && css.WX_CSS.indexOf('.wx-sticky .wx-days{margin:0') !== -1,
      'the sticky box owns the bleed margin; the tile row and the strip '
      + 'inside it drop their own side bleeds');
    assert.ok(stickyGap >= 10,
      'the pinned tile row and hour strip keep visible air between them, '
      + 'so they read as two bands rather than one slab (gap ' + stickyGap + 'px)');
    const z = (sel) => Number((css.WX_CSS.match(
      new RegExp(sel.replace('.', '\\.') + '\\{[^}]*z-index:(\\d+)')) || [])[1]);
    assert.ok(z('.wx-tip') < z('.wx-sticky'),
      'the value tip scrolls UNDER the pinned hour axis, never over it ('
      + z('.wx-tip') + ' vs ' + z('.wx-sticky') + ')');
    // Tile meta rows: the two cells are EQUAL flex halves with centered
    // text, so each value floats with the same air on both sides — and the
    // halves' widths never depend on the text, keeping the sun column
    // vertically aligned across both rows.
    assert.ok(/\.wx-day-wet\{[^}]*flex:1;min-width:0;text-align:center/.test(css.WX_CSS)
      && /\.wx-day-sun\{[^}]*flex:1;min-width:0;text-align:center/.test(css.WX_CSS)
      && /\.wx-day-meta\{[^}]*white-space:nowrap/.test(css.WX_CSS),
      'tile meta cells are equal centered halves — min-width:0 keeps them '
      + 'equal even when a value outgrows its half, and the row\'s nowrap '
      + 'makes that value SPILL instead of wrapping and growing the tile '
      + '(a ~41px half on a 320px phone loses to "12.5 mm" without both)');
    assert.equal(/\.wx-day-meta\{[^}]*space-between/.test(css.WX_CSS), false,
      'meta values no longer glue to the tile borders');
    assert.ok(html.indexOf('data-wxchart="press"') !== -1);
    assert.ok(html.indexOf('data-action="wxShowDay"') !== -1, 'day tiles navigate the panels');
    assert.equal(calls, 1, 'a fresh render serves from module state');

    // Error path: new location key, failing fetch → Retry button, and no
    // render-driven refetch loop.
    const state2 = { graphsLocation: '1', savedLocation1: model.serializeSlot({ name: 'Oslo', lat: 59.9, lon: 10.7 }) };
    tab._setCtx({ S: state2, render: () => {} });
    html = tab.weatherGraphsBlock(state2, {}, SEED);
    assert.equal(calls, 2);
    respond(null, 'network');
    html = tab.weatherGraphsBlock(state2, {}, SEED);
    assert.match(html, /Couldn’t load weather \(network\)/);
    assert.ok(html.indexOf('wxRetryWeather') !== -1);
    tab.weatherGraphsBlock(state2, {}, SEED);
    assert.equal(calls, 2, 'an error never refetches from a render');
  } finally {
    data.fetchWeather = realFetch;
    tab._resetState();
  }
});

test('a new location resets the viewed day to today', () => {
  tab._resetState();
  const realFetch = data.fetchWeather;
  let respond = null;
  data.fetchWeather = (provider, lat, lon, settings, cb) => { respond = cb; };
  try {
    const state = { graphsLocation: 'current' };
    tab._setCtx({ S: state, render: () => {} });
    tab.weatherGraphsBlock(state, {}, SEED);
    respond(fixture(), null);
    assert.equal(tab._panDay(), 0);
    const state2 = { graphsLocation: '1', savedLocation1: model.serializeSlot({ name: 'Oslo', lat: 59.9, lon: 10.7 }) };
    tab.weatherGraphsBlock(state2, {}, SEED);
    respond(fixture(), null);
    assert.equal(tab._panDay(), 0, 'a location switch lands on its today');
  } finally {
    data.fetchWeather = realFetch;
    tab._resetState();
  }
});

test('a scrub moves the strip tick and chip through the shared clamps (the DOM path)', () => {
  tab._resetState();
  const realFetch = data.fetchWeather;
  let respond = null;
  data.fetchWeather = (provider, lat, lon, settings, cb) => { respond = cb; };
  // paintScrub writes the crosshair by direct DOM calls; a stub document
  // that yields only the two strip elements keeps every other branch
  // parked (missing ids are skipped), pinning exactly the scrub-path
  // clamps — the renderer's string output is pinned in the charts suite.
  const tick = {};
  const chip = {};
  const chipIcon = {};
  const el = (store) => ({
    setAttribute: (k, v) => { store[k] = v; },
    setAttributeNS: () => {}
  });
  global.document = {
    getElementById: (id) => {
      if (id === 'wx-strip-hi-tick') return el(tick);
      if (id === 'wx-strip-hi') return el(chip);
      if (id === 'wx-strip-hi-icon') return el(chipIcon);
      return null;
    }
  };
  try {
    const state = { graphsLocation: 'current' };
    tab._setCtx({ S: state, render: () => {} });
    tab.weatherGraphsBlock(state, {}, SEED);
    respond(fixture(), null);
    tab.weatherGraphsBlock(state, {}, SEED);
    // A tap at the wide svg's left edge = hour 0, ON the day seam: the
    // tick must take stripTickX's 1-unit nudge (not the raw hour x 0)
    // and the chip stripChipX's 22 — the renderer's clamps, exercised
    // through the scrub path ("one clamp, both paths").
    const svg = { getBoundingClientRect: () => ({ left: 0, width: 360 }) };
    tab._scrubTo(svg, 0);
    assert.equal(tick.x1, 1, 'the scrub path nudges the tick off the seam');
    assert.equal(tick.x2, 1);
    assert.equal(chip.transform, 'translate(22 0)', 'the chip move shares stripChipX');
    // Midnight UTC is night in Berlin: the chip swap uses the render's
    // night-resolved ids, not the raw day glyph — no sun at 2am.
    assert.equal(chipIcon.href, '#wxi-hnclear',
      'a night-hour scrub swaps the chip to the moon twin');
  } finally {
    delete global.document;
    data.fetchWeather = realFetch;
    tab._resetState();
  }
});

test('the value tip always sits just above the hour\'s topmost mark — overflowing the plot when needed', () => {
  tab._resetState();
  const realFetch = data.fetchWeather;
  let respond = null;
  data.fetchWeather = (provider, lat, lon, settings, cb) => { respond = cb; };
  // A temp ridge: hour 12 is the series max (its dot rides near the panel
  // top → the tip must OVERFLOW the plot), hour 2 sits low (room above).
  const fx = fixture();
  for (let h = 0; h <= 48; h += 1) {
    const d = h % 24;
    fx.hourly.temp[h] = d <= 12 ? d : 24 - d;
  }
  const tip = {
    style: {}, innerHTML: '',
    offsetWidth: 60, offsetHeight: 44,
    parentNode: { clientWidth: 390, clientHeight: 150 }
  };
  global.document = {
    getElementById: (id) => (id === 'wx-tip-temp' ? tip : null)
  };
  try {
    const state = { graphsLocation: 'current', temperatureUnits: 'c' };
    tab._setCtx({ S: state, render: () => {} });
    tab.weatherGraphsBlock(state, {}, SEED);
    respond(fx, null);
    tab.weatherGraphsBlock(state, {}, SEED);
    // The anchor paintScrub derives, recomputed from the same view + spec.
    const view = tab._fetchState().view;
    const marksOf = () => charts.tempPanelSvg(view, state, charts.palette(false)).marks;
    const anchorAt = (i) => {
      const marks = marksOf();
      const ln = marks.lines[0];
      return (marks.bottom - (ln.vals[i] - ln.min) / (ln.max - ln.min) * (marks.bottom - marks.top))
        / marks.H * tip.parentNode.clientHeight;
    };
    const svg = { getBoundingClientRect: () => ({ left: 0, width: 390 }) };
    const px = (h) => h * charts.HOUR_W / (view.days * charts.DAY_W) * 390;

    tab._scrubTo(svg, px(2));
    assert.equal(parseInt(tip.style.top, 10),
      Math.round(anchorAt(2) - tip.offsetHeight - 8),
      'the tip bottom sits 8px above the hour\'s dot');

    assert.ok(anchorAt(12) - tip.offsetHeight - 8 < 0,
      'precondition: the ridge top leaves no room inside the plot');
    tab._scrubTo(svg, px(12));
    assert.equal(parseInt(tip.style.top, 10),
      Math.round(anchorAt(12) - tip.offsetHeight - 8),
      'no room inside → the tip OVERFLOWS the graph upward (negative top), '
      + 'still just above the value — never aside, below, or clamped in');
    const cross12 = 12 * charts.HOUR_W / charts.DAY_W * 390;
    assert.equal(parseInt(tip.style.left, 10), Math.round(cross12),
      'and stays centered on the crosshair');

    // A rain bar higher than the dot re-anchors the tip above the BAR:
    // the anchor is the hour's TOPMOST mark, not just the line dots.
    view.rain[2] = 2;
    tab.weatherGraphsBlock(state, {}, SEED);   // re-render: marks pick up the bar
    const marks2 = marksOf();
    const barPx = marks2.bar.tops[2] / marks2.H * tip.parentNode.clientHeight;
    assert.ok(barPx < anchorAt(2), 'precondition: the bar tops the dot at hour 2');
    tab._scrubTo(svg, px(2));
    assert.equal(parseInt(tip.style.top, 10),
      Math.round(barPx - tip.offsetHeight - 8),
      'with a bar above the dot, the tip clears the BAR top');
  } finally {
    delete global.document;
    data.fetchWeather = realFetch;
    tab._resetState();
  }
});

test('a pan carries the tips with their values and drops them at the viewport edge', () => {
  tab._resetState();
  const realFetch = data.fetchWeather;
  let respond = null;
  data.fetchWeather = (provider, lat, lon, settings, cb) => { respond = cb; };
  const tip = {
    style: {}, innerHTML: '',
    offsetWidth: 60, offsetHeight: 44,
    parentNode: { clientWidth: 390, clientHeight: 150 }
  };
  global.document = {
    getElementById: (id) => (id === 'wx-tip-temp' ? tip : null)
  };
  try {
    const state = { graphsLocation: 'current', temperatureUnits: 'c' };
    tab._setCtx({ S: state, render: () => {} });
    tab.weatherGraphsBlock(state, {}, SEED);
    respond(fixture(), null);
    tab.weatherGraphsBlock(state, {}, SEED);
    const view = tab._fetchState().view;
    const svg = { getBoundingClientRect: () => ({ left: 0, width: 390 }) };
    const px = (h) => h * charts.HOUR_W / (view.days * charts.DAY_W) * 390;

    // Scrub hour 12 (mid-day 0), then drag toward the next day.
    tab._scrubTo(svg, px(12));
    assert.equal(tip.style.display, 'block');
    const atRest = parseInt(tip.style.left, 10);

    // Quarter of a day dragged: the value has travelled a quarter of the
    // viewport left, and its tip must have travelled with it.
    tab._panTips(0.25);
    assert.equal(tip.style.display, 'block', 'still on screen at a quarter day');
    assert.ok(Math.abs((atRest - parseInt(tip.style.left, 10)) - 390 * 0.25) <= 0.5,
      'the tip tracks its value exactly — one viewport travelled per day '
      + 'of drag (moved ' + (atRest - parseInt(tip.style.left, 10)) + 'px)');

    // Half a day: hour 12 lands ON the left edge — the last frame where
    // its value is still visible, so the tip is too.
    tab._panTips(0.5);
    assert.equal(tip.style.display, 'block', 'visible while the value is at the very edge');

    // Past it: the value is off-screen, so the overlay goes with it
    // rather than hanging over a value the viewport no longer shows.
    tab._panTips(0.55);
    assert.equal(tip.style.display, 'none', 'the value left the viewport → the tip hides');
    tab._panTips(2);
    assert.equal(tip.style.display, 'none', 'and stays hidden a whole day away');

    // Dragging back brings it home.
    tab._panTips(0);
    assert.equal(tip.style.display, 'block', 'panning back restores it');
    assert.equal(parseInt(tip.style.left, 10), atRest, 'at its resting place');

    // A tip with no live content is never resurrected by a drag.
    tip.innerHTML = '';
    tip.style.display = 'none';
    tab._panTips(0);
    assert.equal(tip.style.display, 'none', 'an empty tip stays hidden');
  } finally {
    delete global.document;
    data.fetchWeather = realFetch;
    tab._resetState();
  }
});

test('tip horizontal clamps: wide tips stay centered; edge hours pin inside the viewport', () => {
  tab._resetState();
  const realFetch = data.fetchWeather;
  let respond = null;
  data.fetchWeather = (provider, lat, lon, settings, cb) => { respond = cb; };
  const fx = fixture();
  for (let h = 0; h <= 48; h += 1) {
    const d = h % 24;
    fx.hourly.temp[h] = d <= 12 ? d : 24 - d;   // ridge: hour 12 = the max
  }
  const tip = {
    style: {}, innerHTML: '',
    offsetWidth: 340, offsetHeight: 44,        // wide — once forced sideways dodges
    parentNode: { clientWidth: 390, clientHeight: 150 }
  };
  global.document = {
    getElementById: (id) => (id === 'wx-tip-temp' ? tip : null)
  };
  try {
    const state = { graphsLocation: 'current', temperatureUnits: 'c' };
    tab._setCtx({ S: state, render: () => {} });
    tab.weatherGraphsBlock(state, {}, SEED);
    respond(fx, null);
    tab.weatherGraphsBlock(state, {}, SEED);
    const view = tab._fetchState().view;
    const svg = { getBoundingClientRect: () => ({ left: 0, width: 390 }) };
    const px = (h) => h * charts.HOUR_W / (view.days * charts.DAY_W) * 390;

    // A WIDE tip at the ridge top — the shape that used to trigger the
    // below/last-resort dodges — now simply overflows upward, centered.
    tab._scrubTo(svg, px(12));
    assert.ok(parseInt(tip.style.top, 10) < 0,
      'a wide tip at the ridge top overflows the plot, no sideways dodge');
    const cross12 = 12 * charts.HOUR_W / charts.DAY_W * 390;
    assert.equal(parseInt(tip.style.left, 10), Math.round(cross12),
      'and stays centered on the crosshair');

    // Right edge — a late-hour scrub: the tip's half-width (+4px air)
    // clamps it inside the viewport instead of running off-screen.
    tip.offsetWidth = 60;
    tab._scrubTo(svg, px(23));
    assert.equal(parseInt(tip.style.left, 10), 390 - 34,
      'right edge: clamped to half a tip + air inside the viewport');

    // Release slop — a tap can round to an hour past the visible day
    // (scrubTo clamps to the timeline, not the day): the raw crosshair px
    // leaves the viewport and must be pulled back before centering.
    tab._scrubTo(svg, px(47));
    assert.equal(parseInt(tip.style.left, 10), 390 - 34,
      'an off-day crosshair px is clamped back into the viewport');

    tab._scrubTo(svg, px(0));
    assert.equal(parseInt(tip.style.left, 10), 34, 'left edge: clamped in');
  } finally {
    delete global.document;
    data.fetchWeather = realFetch;
    tab._resetState();
  }
});

test('refreshWeather refetches the same key manually, keeping the charts and the viewed day', () => {
  tab._resetState();
  let calls = 0;
  let respond = null;
  const realFetch = data.fetchWeather;
  data.fetchWeather = (provider, lat, lon, settings, cb) => { calls += 1; respond = cb; };
  try {
    const state = { graphsLocation: 'current' };
    tab._setCtx({ S: state, render: () => {} });
    tab.weatherGraphsBlock(state, {}, SEED);
    respond(fixture(), null);
    assert.equal(calls, 1);
    assert.equal(tab.refreshWeather(), true, 'idle → a refetch is due');
    let html = tab.weatherGraphsBlock(state, {}, SEED);
    assert.equal(calls, 2, 'the manual refresh refetches the same key');
    assert.ok(html.indexOf('Temperature &amp; precipitation') !== -1,
      'the previous charts stay up (dimmed) while updating');
    assert.ok(html.indexOf('updating') !== -1);
    assert.equal(tab.refreshWeather(), false, 'no stacked refetch while one is loading');
    assert.equal(tab._panDay(), 0, 'the viewed day survives a refresh');
    respond(fixture(), null);
    html = tab.weatherGraphsBlock(state, {}, SEED);
    assert.equal(calls, 2);
    assert.ok(html.indexOf('wxRefreshWeather') !== -1, 'the footer offers the manual Refresh');
  } finally {
    data.fetchWeather = realFetch;
    tab._resetState();
  }
});

test('a manual refresh with Current active re-reads the phone GPS and follows it', () => {
  tab._resetState();
  const fetchCalls = [];
  let respond = null;
  let gpsCb = null;
  let revArgs = null;
  let revCb = null;
  const realFetch = data.fetchWeather;
  const realGps = data.getGpsFix;
  const realRev = data.reverseGeocode;
  data.fetchWeather = (provider, lat, lon, settings, cb) => { fetchCalls.push([lat, lon]); respond = cb; };
  data.getGpsFix = (cb) => { gpsCb = cb; };
  data.reverseGeocode = (lat, lon, cb) => { revArgs = [lat, lon]; revCb = cb; };
  try {
    const state = { graphsLocation: 'current' };
    tab._setCtx({ S: state, USERDATA: SEED, render: () => {} });
    tab.weatherGraphsBlock(state, {}, SEED);
    respond(fixture(), null);
    assert.equal(fetchCalls.length, 1);

    assert.equal(tab.refreshWeather(), true);
    assert.ok(gpsCb, 'the Current pick asks the device for a fresh fix');
    assert.equal(fetchCalls.length, 1, 'the refetch waits for the fix');
    let html = tab.weatherGraphsBlock(state, {}, SEED);
    assert.ok(html.indexOf('updating') !== -1, 'the wait paints as a dimmed update');
    assert.equal(fetchCalls.length, 1, 'a render during the GPS wait must not fetch');

    gpsCb({ lat: 53.55, lon: 9.99 }, null);   // ~255 km away
    tab.weatherGraphsBlock(state, {}, SEED);
    assert.equal(fetchCalls.length, 2);
    assert.deepEqual(fetchCalls[1], [53.55, 9.99], 'the refetch runs at the fresh fix');
    html = tab.weatherLocationsBlock(state, {}, SEED);
    assert.ok(html.indexOf('Current location') !== -1, 'a far move drops the stale city name');
    assert.equal(html.indexOf('Berlin'), -1);
    assert.deepEqual(revArgs, [53.55, 9.99], 'and asks the reverse geocoder for the new one');
    revCb('Hamburg', null);
    html = tab.weatherLocationsBlock(state, {}, SEED);
    assert.ok(html.indexOf('Hamburg') !== -1, 'the reverse geocode relabels the Current chip');
    respond(fixture(), null);
    assert.equal(tab._panDay(), 0, 'a moved location lands on its today');
  } finally {
    data.fetchWeather = realFetch;
    data.getGpsFix = realGps;
    data.reverseGeocode = realRev;
    tab._resetState();
  }
});

test('GPS jitter keeps the city name; a failed fix degrades to a plain refresh', () => {
  tab._resetState();
  const fetchCalls = [];
  let respond = null;
  let gpsCb = null;
  let revCalled = false;
  const realFetch = data.fetchWeather;
  const realGps = data.getGpsFix;
  const realRev = data.reverseGeocode;
  data.fetchWeather = (provider, lat, lon, settings, cb) => { fetchCalls.push([lat, lon]); respond = cb; };
  data.getGpsFix = (cb) => { gpsCb = cb; };
  data.reverseGeocode = () => { revCalled = true; };
  try {
    const state = { graphsLocation: 'current' };
    tab._setCtx({ S: state, USERDATA: SEED, render: () => {} });
    tab.weatherGraphsBlock(state, {}, SEED);
    respond(fixture(), null);

    tab.refreshWeather();
    gpsCb({ lat: 52.5206, lon: 13.4041 }, null);   // metres of drift
    tab.weatherGraphsBlock(state, {}, SEED);
    assert.deepEqual(fetchCalls[1], [52.52, 13.405],
      'jitter never adopts coordinates — the fetch key stays stable, so the viewed day survives');
    assert.equal(tab._gpsSeed(), null, 'no seed override for a same-place fix');
    assert.equal(revCalled, false, 'no reverse geocode for a same-place fix');
    respond(fixture(), null);

    gpsCb = null;
    tab.refreshWeather();
    assert.ok(gpsCb, 'each refresh asks for a fix again');
    gpsCb(null, 'denied');
    tab.weatherGraphsBlock(state, {}, SEED);
    assert.equal(fetchCalls.length, 3, 'a failed fix still refreshes');
    assert.deepEqual(fetchCalls[2], [52.52, 13.405], 'at the previous coordinates');
  } finally {
    data.fetchWeather = realFetch;
    data.getGpsFix = realGps;
    data.reverseGeocode = realRev;
    tab._resetState();
  }
});

test('a pending city lookup survives a jitter refresh, and a failed one is retried', () => {
  tab._resetState();
  let respond = null;
  let gpsCb = null;
  const revCbs = [];
  const realFetch = data.fetchWeather;
  const realGps = data.getGpsFix;
  const realRev = data.reverseGeocode;
  data.fetchWeather = (provider, lat, lon, settings, cb) => { respond = cb; };
  data.getGpsFix = (cb) => { gpsCb = cb; };
  data.reverseGeocode = (lat, lon, cb) => { revCbs.push(cb); };
  try {
    const state = { graphsLocation: 'current' };
    tab._setCtx({ S: state, USERDATA: SEED, render: () => {} });
    tab.weatherGraphsBlock(state, {}, SEED);
    respond(fixture(), null);

    // Far move: one lookup starts; the weather refetch completes first.
    tab.refreshWeather();
    gpsCb({ lat: 53.55, lon: 9.99 }, null);
    tab.weatherGraphsBlock(state, {}, SEED);
    respond(fixture(), null);
    assert.equal(revCbs.length, 1);

    // A same-place refresh while the lookup is still in flight must neither
    // duplicate it nor orphan it: the answer still labels the chip.
    tab.refreshWeather();
    gpsCb({ lat: 53.5504, lon: 9.9903 }, null);
    tab.weatherGraphsBlock(state, {}, SEED);
    respond(fixture(), null);
    assert.equal(revCbs.length, 1, 'no duplicate lookup while one is pending');
    revCbs[0]('Hamburg', null);
    assert.equal(tab._gpsSeed().name, 'Hamburg', 'the pending answer still lands');

    // Failure path: another far move whose lookup dies — the next
    // same-place refresh retries instead of stranding the placeholder.
    tab.refreshWeather();
    gpsCb({ lat: 48.14, lon: 11.58 }, null);
    tab.weatherGraphsBlock(state, {}, SEED);
    respond(fixture(), null);
    assert.equal(revCbs.length, 2);
    revCbs[1](null, 'network');
    assert.equal(tab._gpsSeed().name, 'Current location');
    tab.refreshWeather();
    gpsCb({ lat: 48.1402, lon: 11.5803 }, null);
    tab.weatherGraphsBlock(state, {}, SEED);
    respond(fixture(), null);
    assert.equal(revCbs.length, 3, 'the placeholder name is retried on the next refresh');
    revCbs[2]('Munich', null);
    assert.equal(tab._gpsSeed().name, 'Munich');
  } finally {
    data.fetchWeather = realFetch;
    data.getGpsFix = realGps;
    data.reverseGeocode = realRev;
    tab._resetState();
  }
});

test('moveKm wraps the antimeridian: Fiji-side jitter is not a far move', () => {
  tab._resetState();
  const fetchCalls = [];
  let respond = null;
  let gpsCb = null;
  let revCalled = false;
  const realFetch = data.fetchWeather;
  const realGps = data.getGpsFix;
  const realRev = data.reverseGeocode;
  data.fetchWeather = (provider, lat, lon, settings, cb) => { fetchCalls.push([lat, lon]); respond = cb; };
  data.getGpsFix = (cb) => { gpsCb = cb; };
  data.reverseGeocode = () => { revCalled = true; };
  try {
    const FIJI = { graphsSeed: { lat: -16.8, lon: 179.995, name: 'Taveuni' } };
    const state = { graphsLocation: 'current' };
    tab._setCtx({ S: state, USERDATA: FIJI, render: () => {} });
    tab.weatherGraphsBlock(state, {}, FIJI);
    respond(fixture(), null);

    tab.refreshWeather();
    gpsCb({ lat: -16.8, lon: -179.995 }, null);   // ~2 km around the date line
    tab.weatherGraphsBlock(state, {}, FIJI);
    assert.equal(tab._gpsSeed(), null, 'a date-line crossing of metres stays jitter');
    assert.equal(revCalled, false);
    assert.deepEqual(fetchCalls[1], [-16.8, 179.995]);
  } finally {
    data.fetchWeather = realFetch;
    data.getGpsFix = realGps;
    data.reverseGeocode = realRev;
    tab._resetState();
  }
});

test('a refresh with a saved slot active never touches the GPS', () => {
  tab._resetState();
  let fetchCalls = 0;
  let respond = null;
  let gpsAsked = false;
  const realFetch = data.fetchWeather;
  const realGps = data.getGpsFix;
  data.fetchWeather = (provider, lat, lon, settings, cb) => { fetchCalls += 1; respond = cb; };
  data.getGpsFix = () => { gpsAsked = true; };
  try {
    const state = { graphsLocation: '1', savedLocation1: model.serializeSlot({ name: 'Oslo', lat: 59.9, lon: 10.7 }) };
    tab._setCtx({ S: state, USERDATA: SEED, render: () => {} });
    tab.weatherGraphsBlock(state, {}, SEED);
    respond(fixture(), null);
    assert.equal(tab.refreshWeather(), true);
    tab.weatherGraphsBlock(state, {}, SEED);
    assert.equal(fetchCalls, 2, 'the slot refreshes normally');
    assert.equal(gpsAsked, false, 'a fixed city needs no device fix');
  } finally {
    data.fetchWeather = realFetch;
    data.getGpsFix = realGps;
    tab._resetState();
  }
});

test('snapTargetDay: rounds to the nearest day, flicks advance one, clamps at the ends', () => {
  const vw = 400;
  assert.equal(tab.snapTargetDay(1, -100, vw, 5, 800), 1, 'a slow quarter-drag springs back');
  assert.equal(tab.snapTargetDay(1, -240, vw, 5, 800), 2, 'past halfway rounds forward');
  assert.equal(tab.snapTargetDay(1, 240, vw, 5, 800), 0, 'and backward');
  assert.equal(tab.snapTargetDay(1, -60, vw, 5, 150), 2, 'a quick flick advances one day');
  assert.equal(tab.snapTargetDay(1, 60, vw, 5, 150), 0, 'a quick flick goes back one day');
  assert.equal(tab.snapTargetDay(0, 300, vw, 5, 100), 0, 'clamped at the first day');
  assert.equal(tab.snapTargetDay(4, -300, vw, 5, 100), 4, 'clamped at the last day');
  assert.equal(tab.panPct(2, 5), -40, 'day 2 of 5 pans to -40% of the wide element');
});
