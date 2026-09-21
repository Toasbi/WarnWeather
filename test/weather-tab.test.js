// test/weather-tab.test.js — the Weather tab's glue: chip row rendering,
// provider options, the graphs block's fetch orchestration (stubbed through
// the shared data module instance — no network), and the pan-snap math.
const test = require('node:test');
const assert = require('node:assert/strict');
// The tab registers its blocks and its [data-action] handlers on PConf as it
// loads; a stub here lets a test dispatch an action exactly as the engine
// would. It has to stand BEFORE the require.
global.PConf = {
  blocks: { register: () => {} },
  optionsResolvers: { register: () => {} },
  displayResolvers: { register: () => {} },
  actions: {},
  hooks: { onReady: () => {} }
};
const tab = require('../src/pkjs/settings/weather-tab.js');
const data = require('../src/pkjs/settings/weather-tab-data.js');
const model = require('../src/pkjs/settings/weather-tab-model.js');
const css = require('../src/pkjs/settings/weather-tab-css.js');
const charts = require('../src/pkjs/settings/weather-tab-charts.js');
const interact = require('../src/pkjs/settings/weather-tab-interact.js');

// The glue calls Date.now() itself (ensureFetch prepares the view against
// the real clock), so the fixture anchors to the REAL current UTC day —
// with utcOffsetSec 0 the view's day start lands exactly on it, whatever
// date or timezone the suite runs in.
const DAY0 = Math.floor(Date.now() / 86400000) * 86400000;
const SEED = { graphsSeed: { lat: 52.52, lon: 13.405, name: 'Berlin' } };

/**
 * The index just past the close of the div that OPENS at `at`, found by
 * counting tags rather than by looking for the next pair of closes.
 * @param {string} html Markup to walk.
 * @param {number} at Index of that div's opening tag.
 * @returns {number} Index just past its matching close, or -1.
 */
function closeOf(html, at) {
  const TAG = /<(\/?)div\b[^>]*>/g;
  TAG.lastIndex = at;
  let depth = 0, m;
  while ((m = TAG.exec(html)) !== null) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) { return TAG.lastIndex; }
  }
  return -1;
}

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

/**
 * The DOM shape scrubTo walks: the wide svg, inside .wx-pan, inside the
 * clipping viewport that carries data-wxvp. The viewport is the element it
 * measures against — the wide one moves while a day change settles — so a
 * bare rect stub would let the two frames drift apart unnoticed. One
 * viewport is one day wide.
 * @param {number} width Viewport width in px.
 * @param {number} [left] Viewport left in client px.
 * @returns {Object} A stand-in for the wide svg under the pointer.
 */
function panelStub(width, left) {
  const vp = {
    getAttribute: (k) => (k === 'data-wxvp' ? 'temp' : null),
    getBoundingClientRect: () => ({ left: left || 0, width })
  };
  const pan = { getAttribute: () => null, parentNode: vp };
  return { getAttribute: () => null, parentNode: pan };
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
    const stickyAt = html.indexOf(
      '<div class="wx-sticky"><div class="wx-daysvp" data-wxvp="days"><div class="wx-days">');
    assert.ok(stickyAt !== -1,
      'the pinned box opens straight onto the 5-day tile row (tiles pin too), '
      + 'and the row rides a viewport a drag can grab — swiping the tiles '
      + 'pans the days like swiping any chart');
    const stripVpAt = html.indexOf('data-wxvp="strip"');
    const seam = html.indexOf('</div><div class="wx-bleed">', stickyAt);
    assert.ok(seam !== -1 && seam < stripVpAt && stripVpAt - seam < 200,
      'the hour strip\'s bleed box follows the tile row immediately, inside '
      + 'the same pinned element — tiles and time axis travel together');
    assert.equal(html.indexOf('<div class="wx-sticky">', stickyAt + 1), -1,
      'and nothing else pins — one sticky element');
    // Where the pinned element actually ENDS. Counting div tags is the
    // only honest way to ask: searching for the next '</div></div>' finds
    // whatever nesting happens to sit there — the strip viewport's own pan
    // and vp closes, in this markup — so such an assertion holds wherever
    // the caption row is put, which is to say it asserts nothing.
    const stickyEnd = closeOf(html, stickyAt);
    assert.ok(stickyEnd > stickyAt, 'the pinned element closes somewhere');
    assert.ok(stripVpAt < stickyEnd,
      'the hour strip rides INSIDE the pinned box, not as a sibling after it closes');
    // ...and the pin ends THERE: the Measured|Forecast caption is a row of
    // its own, outside the sticky element, so it scrolls away while the
    // ruler above it stays put.
    const footAt = html.indexOf('<div class="wx-stripfoot">');
    assert.ok(footAt > stripVpAt, 'the caption row follows the pinned strip');
    assert.ok(footAt >= stickyEnd,
      'the caption row opens no earlier than the pinned box\u2019s close — the pin ends at the ticks');
    assert.ok(html.indexOf('data-wxvp="foot"', footAt) !== -1
      && html.indexOf('data-wxvp="foot"', footAt) - footAt < 200,
      'the caption rides its own viewport, so it pans with the days');
    // The caption's words live in that row, never in the pinned block. On
    // this fixture only "Forecast" is printed — nothing about it is
    // measured — so it is the one that has to be there and be outside.
    const forecastAt = html.indexOf('>Forecast<', stickyAt);
    assert.ok(forecastAt > footAt,
      'the caption text itself is no longer anywhere in the pinned block');
    const measuredAt = html.indexOf('>Measured<', stickyAt);
    assert.ok(measuredAt === -1 || measuredAt > footAt,
      'and neither is the other half, when a provider earns one');
    // No vertical gap between the ruler's box and the caption's: the two are
    // separate svgs now, and the now line has to cross the seam unbroken.
    const footMargin = /\.wx-stripfoot \.wx-bleed\{margin:([^;]+);/.exec(css.WX_CSS);
    assert.ok(footMargin, 'the caption row keeps the strip\'s spacing, not a panel\'s');
    assert.equal(footMargin[1].trim().split(/\s+/)[0], '0',
      'and no top margin, or the now line breaks at the seam (' + footMargin[1] + ')');
    // The tile icon's two sizes move in lockstep: the renderer's px and
    // the CSS min-height that keeps icon-LESS tiles from collapsing
    // shorter than icon-bearing ones. Read one, assert the other.
    const iconPx = Number((css.WX_CSS.match(/\.wx-day-icon\{[^}]*min-height:(\d+)px/) || [])[1]);
    assert.ok(iconPx > 0, '.wx-day-icon reserves the icon slot height');
    assert.ok(html.indexOf('class="wx-day-icon"><svg viewBox="0 0 25 25" width="' + iconPx + '"') !== -1,
      'the tile renderer draws its icon at the SAME size the CSS reserves');
    assert.ok(css.WX_CSS.indexOf('.wx-sticky{position:-webkit-sticky;position:sticky') !== -1,
      '.wx-sticky actually pins (both position spellings for old WebViews)');
    // Swiping to another day hands the tile highlight over as a FADE, and
    // on the pan's OWN curve — the duration is read from the module that
    // animates the panels, never a second copy of the number.
    assert.ok(css.WX_CSS.indexOf('transition:border-color ' + interact.SETTLE_CSS + ';}') !== -1,
      'the tile border cross-fades on the pan settle curve');
    assert.ok(css.WX_CSS.indexOf('.wx-day-name{font-weight:600;color:var(--fg);transition:color '
      + interact.SETTLE_CSS + ';}') !== -1,
      'and the accent day name fades with it');
    // The rendered string cannot tell a borrowed duration from a copied
    // one — they are the same characters. The SOURCE can: the rule has to
    // interpolate interact.SETTLE_CSS, so the two can never drift apart.
    const cssSrc = require('node:fs').readFileSync(
      require('node:path').join(__dirname, '..', 'src/pkjs/settings/weather-tab-css.js'), 'utf8');
    assert.match(cssSrc, /transition:border-color ' \+ interact\.SETTLE_CSS/,
      'the tile rule interpolates the pan curve rather than repeating it');
    assert.equal(cssSrc.indexOf("transition:border-color 0.22s"), -1,
      'and nobody hand-copied the number back in');
    // The pinned strip's two companion fixes: the sticky box itself
    // carries the -16px bleed (inner wrapper zeroed) so its opaque
    // backdrop covers the full strip width, and the tip stacks above it.
    const stickyGap = Number((css.WX_CSS.match(/\.wx-sticky \.wx-bleed\{margin:(\d+)px 0 0/) || [])[1]);
    assert.ok(/\.wx-sticky\{[^}]*margin:8px -16px 0/.test(css.WX_CSS)
      && stickyGap > 0
      && css.WX_CSS.indexOf('.wx-sticky .wx-daysvp{margin:0') !== -1,
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
    // A finger dragged PAST the left edge of the canvas clamps onto hour
    // 0, which stands ON the day seam: the tick must take stripTickX's
    // 1-unit nudge (not the raw hour x 0) and the chip stripChipX's 22 —
    // the renderer's clamps, exercised through the scrub path ("one
    // clamp, both paths"). Hour 0 is only ever reached this way: its own
    // bar covers the hour BEFORE midnight, which is off this canvas.
    const svg = panelStub(360);
    tab._scrubTo(svg, -1);
    assert.equal(tick.x1, 1, 'the scrub path nudges the tick off the seam');
    assert.equal(tick.x2, 1);
    assert.equal(chip.transform, 'translate(22 0)', 'the chip move shares stripChipX');
    // Midnight UTC is night in Berlin: the chip swap uses the render's
    // night-resolved ids, not the raw day glyph — no sun at 2am.
    assert.equal(chipIcon.href, '#wxi-hnclear',
      'a night-hour scrub swaps the chip to the moon twin');
    // And the mirror case, which the clamp used to get exactly backwards.
    // A bar covers the hour ENDING at its tick, so the last sliver of a
    // day's canvas selects the MIDNIGHT that closes it — hour 24, which
    // this screen is the only screen that can reach. Clamping it into the
    // day it arithmetically starts put the chip 22 units past this
    // viewport's right edge and the tick 1 past it: the badge and its
    // pointer disappeared on that tap, while the tip and the lit bar
    // stayed. Both must land INSIDE the day on screen.
    tab._scrubTo(svg, 359.9);
    assert.equal(chip.transform, 'translate(' + (charts.DAY_W - 22) + ' 0)',
      'the closing midnight hugs this day\u2019s right seam, not the next day\u2019s left');
    assert.equal(tick.x1, charts.DAY_W - 1, 'and the tick nudges in off the same seam');
    assert.ok(tick.x1 < charts.DAY_W && Number(/translate\((-?[\d.]+)/.exec(chip.transform)[1]) + 20 <= charts.DAY_W,
      'both are wholly inside the viewport that selected them');
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
    const svg = panelStub(390);
    // A client x in the MIDDLE of hour h's bar — the span that ends on h's
    // own tick — so the scrub selects h and not a neighbour.
    const px = (h) => (h - 0.5) * charts.HOUR_W / charts.DAY_W * 390;

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
    const svg = panelStub(390);
    const px = (h) => h * charts.HOUR_W / charts.DAY_W * 390;

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

    // The other drag direction is just as real: swiping BACK toward an
    // earlier day slides the hour off the RIGHT edge instead.
    tab._panTips(-0.55);
    assert.equal(tip.style.display, 'none', 'off the right edge hides it too');
    tab._panTips(-2);
    assert.equal(tip.style.display, 'none', 'a whole day back, still gone');

    // Dragging back brings it home.
    tab._panTips(0);
    assert.equal(tip.style.display, 'block', 'panning back restores it');
    assert.equal(parseInt(tip.style.left, 10), atRest, 'at its resting place');

    // The release path itself: a short drag that springs back to the SAME
    // day keeps the crosshair alive, so committing that day has to land
    // the tips back on their values — nothing else will.
    tab._panTips(0.2);
    assert.notEqual(parseInt(tip.style.left, 10), atRest, 'mid-drag, carried off its value');
    tab._commitDay(0);
    assert.equal(parseInt(tip.style.left, 10), atRest,
      'the same-day spring-back brings the tips home');

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

test('the crosshair lands in the hour the finger is INSIDE, and outlines its bar', () => {
  tab._resetState();
  const realFetch = data.fetchWeather;
  let respond = null;
  data.fetchWeather = (provider, lat, lon, settings, cb) => { respond = cb; };
  // A stand-in for every bar the panel draws, so the painter's writes can be
  // read back per hour.
  const bars = {};
  const barFor = (id) => {
    if (!bars[id]) { bars[id] = { attrs: {}, setAttribute(k, v) { this.attrs[k] = String(v); } }; }
    return bars[id];
  };
  const tip = { style: {}, innerHTML: '', offsetWidth: 60, offsetHeight: 44,
    parentNode: { clientWidth: 390, clientHeight: 150 } };
  global.document = {
    getElementById: (id) => (id.indexOf('wx-bar-') === 0 ? barFor(id)
      : (id === 'wx-tip-temp' ? tip : null))
  };
  try {
    const state = { graphsLocation: 'current', temperatureUnits: 'c' };
    tab._setCtx({ S: state, render: () => {} });
    tab.weatherGraphsBlock(state, {}, SEED);
    respond(fixture(), null);
    tab.weatherGraphsBlock(state, {}, SEED);
    const view = tab._fetchState().view;
    const svg = panelStub(390);
    // A pointer at a FRACTION of an hour, in client px — 19.05 means
    // 19:03 on the clock.
    const at = (h) => h * charts.HOUR_W / charts.DAY_W * 390;
    const litTemp = () => Object.keys(bars).filter((k) =>
      k.indexOf('wx-bar-temp-') === 0 && bars[k].attrs.stroke && bars[k].attrs.stroke !== 'none');

    // A bar fills the hour that ENDS on its own tick, so the span the clock
    // calls 19:00 → 20:00 is the bar labelled 20. The hour a tap belongs to
    // is therefore the one the finger is INSIDE, one past the tick it has
    // just cleared. Rounding to the nearest tick, or flooring to the one
    // behind, both light a bar beside the one under the finger.
    [[19.05, 20], [19.5, 20], [19.95, 20], [20.05, 21]].forEach((c) => {
      // Park somewhere else first. Three of these four land on the SAME
      // hour by design, and a second tap on the hour already selected puts
      // it down (pinned in its own test below) — which would make this one
      // read as a placement failure.
      tab._scrubTo(svg, at(2));
      tab._scrubTo(svg, at(c[0]));
      assert.deepEqual(litTemp(), ['wx-bar-temp-' + c[1]],
        'a tap at clock hour ' + c[0] + ' lights the bar it stands in');
    });

    // The border IS the selection: the bar it leaves carries none, and the
    // one it lands on is at full strength as well as outlined.
    tab._scrubTo(svg, at(19.5));
    const marks = charts.tempPanelSvg(view, state, charts.palette(false)).marks;
    assert.equal(bars['wx-bar-temp-20'].attrs.stroke, marks.bar.lit,
      'the selected bar wears the page ink');
    assert.equal(bars['wx-bar-temp-20'].attrs.opacity, '1', 'at full strength');
    tab._scrubTo(svg, at(20.5));
    assert.equal(bars['wx-bar-temp-20'].attrs.stroke, 'none',
      'and the hour left behind gives its border back');
    assert.equal(bars['wx-bar-temp-20'].attrs.opacity, String(marks.bar.dim),
      'along with its brightness — a dim bar left outlined reads as a '
      + 'second selection');
    assert.deepEqual(litTemp(), ['wx-bar-temp-21'], 'exactly one bar is ever lit');

    // Exactly ON a tick is the boundary between two spans, and it belongs
    // to the one that STARTS there — the half-open rule Math.floor gives
    // everywhere else, and the one that keeps the canvas's own left edge
    // usable: x = 0 opens hour 1's span, and hour 1 has a bar, where hour
    // 0's span is off the canvas and draws nothing. (A rect's own left
    // edge is inside it and its right edge is not, so this is also what
    // the painter already believes.) Measured in canvas units so the
    // boundary is exact and not a float a hair to one side of it.
    const exact = panelStub(charts.DAY_W);
    const onTick = charts.DAY_W / 4;
    assert.equal(onTick % charts.HOUR_W, 0, 'precondition: a quarter day is an hour tick');
    tab._scrubTo(exact, onTick);
    assert.deepEqual(litTemp(), ['wx-bar-temp-' + (onTick / charts.HOUR_W + 1)],
      'a tap exactly on a tick takes the span that starts there');
  } finally {
    delete global.document;
    data.fetchWeather = realFetch;
    tab._resetState();
  }
});

test('a tap during the settle reads the day the page is going to, not the one it is leaving', () => {
  // A release commits the destination day and starts the settle; the wide
  // svg then spends up to CARRY_MAX_MS somewhere between the two days, and
  // its own box says so. Everything the paint does afterwards — the tip's
  // placement, the strip chip — is in the COMMITTED day's frame, so reading
  // that moving box answers a question nobody asked and lands a whole day
  // out: the crosshair goes off-screen and the tip hides itself, which
  // looks exactly like a tap that did nothing.
  tab._resetState();
  const realFetch = data.fetchWeather;
  let respond = null;
  data.fetchWeather = (provider, lat, lon, settings, cb) => { respond = cb; };
  const bars = {};
  const barFor = (id) => {
    if (!bars[id]) { bars[id] = { attrs: {}, setAttribute(k, v) { this.attrs[k] = String(v); } }; }
    return bars[id];
  };
  const tip = { style: {}, innerHTML: '', offsetWidth: 60, offsetHeight: 44,
    parentNode: { clientWidth: 390, clientHeight: 150 } };
  global.document = {
    getElementById: (id) => (id.indexOf('wx-bar-') === 0 ? barFor(id)
      : (id === 'wx-tip-temp' ? tip : null))
  };
  try {
    const state = { graphsLocation: 'current', temperatureUnits: 'c' };
    tab._setCtx({ S: state, render: () => {} });
    tab.weatherGraphsBlock(state, {}, SEED);
    respond(fixture(), null);
    tab.weatherGraphsBlock(state, {}, SEED);
    const view = tab._fetchState().view;
    assert.ok(view.days >= 2, 'precondition: there is a second day to move to');

    // The viewport holds still; the wide element inside it is caught
    // halfway through the curve, half a viewport to the left.
    const vp = {
      getAttribute: (k) => (k === 'data-wxvp' ? 'temp' : null),
      getBoundingClientRect: () => ({ left: 0, width: 390 })
    };
    const midFlight = {
      getAttribute: () => null,
      getBoundingClientRect: () => ({ left: -195, width: 390 * view.days }),
      parentNode: { getAttribute: () => null, parentNode: vp }
    };
    tab._commitDay(1);
    assert.equal(tab._panDay(), 1, 'the destination is committed at release');

    // A tap 10% into the viewport: 2.4 h into day 1, so the span
    // 02:00 → 03:00, which is the hour labelled 03:00 of day 1.
    tab._scrubTo(midFlight, 39);
    const lit = Object.keys(bars).filter((k) =>
      k.indexOf('wx-bar-temp-') === 0 && bars[k].attrs.stroke && bars[k].attrs.stroke !== 'none');
    assert.deepEqual(lit, ['wx-bar-temp-27'],
      'the hour is day 1\u2019s, measured against the viewport the finger is on');
    assert.equal(tip.style.display, 'block', 'so the tip has somewhere to be');
    assert.equal(parseInt(tip.style.left, 10), 49,
      'and stands where the tap did, a tenth of the way in');
  } finally {
    delete global.document;
    data.fetchWeather = realFetch;
    tab._resetState();
  }
});

test('the chip IS the selection: a second tap puts it down, and a day change takes it away', () => {
  // The strip chip is a dark box with a white border round one hour — the
  // page's loudest "this one". Two things followed from letting it rest on
  // an anchor hour instead:
  //   * swipe to another day and it reappeared on that day's noon, an hour
  //     nobody had chosen, so the selection looked like it had followed you;
  //   * and there was no way to put a selection DOWN short of swiping away
  //     and back, because every tap was a select.
  // So: visible when something is selected, or when it is standing on NOW —
  // and only one day has a now.
  tab._resetState();
  const realFetch = data.fetchWeather;
  let respond = null;
  data.fetchWeather = (provider, lat, lon, settings, cb) => { respond = cb; };
  const el = {};
  const nodeFor = (id) => {
    if (!el[id]) { el[id] = { attrs: {}, style: {}, innerHTML: '', offsetWidth: 60, offsetHeight: 44,
      parentNode: { clientWidth: 390, clientHeight: 150 },
      setAttribute(k, v) { this.attrs[k] = String(v); },
      setAttributeNS() {}, querySelector: () => null }; }
    return el[id];
  };
  global.document = { getElementById: (id) => nodeFor(id) };
  try {
    const state = { graphsLocation: 'current', temperatureUnits: 'c' };
    tab._setCtx({ S: state, render: () => {} });
    tab.weatherGraphsBlock(state, {}, SEED);
    respond(fixture(), null);
    tab.weatherGraphsBlock(state, {}, SEED);
    const view = tab._fetchState().view;
    const svg = panelStub(390);
    const at = (h) => (h - 0.5) * charts.HOUR_W / charts.DAY_W * 390;
    const chip = () => el['wx-strip-hi'].attrs.display;
    const tick = () => el['wx-strip-hi-tick'].attrs.display;
    const litTemp = () => Object.keys(el).filter((k) =>
      k.indexOf('wx-bar-temp-') === 0 && el[k].attrs.stroke && el[k].attrs.stroke !== 'none');

    // At rest on the day that HAS a now, the chip stands on it.
    tab._repaintScrub();
    assert.equal(chip(), 'inline', 'the resting chip marks now');
    assert.equal(tick(), 'inline', 'and so does its ruler tick');
    assert.equal(Number(el['wx-strip-hi-tick'].attrs.x1),
      charts.stripTickX(view, view.nowIndex), 'on now\u2019s own hour');

    // Select an hour: the chip moves to it.
    const pick = view.nowIndex + 3;
    tab._scrubTo(svg, at(pick));
    assert.equal(chip(), 'inline', 'a selection is a chip');
    assert.deepEqual(litTemp(), ['wx-bar-temp-' + pick], 'and a lit bar');

    // Tap the SAME hour again: everything lets go.
    tab._scrubTo(svg, at(pick));
    assert.deepEqual(litTemp(), [], 'the second tap puts the bar down');
    assert.equal(el['wx-scrub-temp'].attrs.x1, '-10', 'and parks the crosshair');
    assert.equal(el['wx-tip-temp'].style.display, 'none', 'and the value tip');
    assert.equal(chip(), 'inline',
      'the chip stays, because this day HAS a now for it to fall back to');
    assert.equal(Number(el['wx-strip-hi-tick'].attrs.x1),
      charts.stripTickX(view, view.nowIndex), 'which is where it goes');

    // A day with no now has nothing for the chip to rest on, so it goes.
    tab._scrubTo(svg, at(pick));
    assert.equal(chip(), 'inline', 'precondition: something is selected again');
    tab._commitDay(1);
    assert.equal(tab._panDay(), 1);
    assert.deepEqual(litTemp(), [], 'the day change drops the selection');
    assert.equal(chip(), 'none', 'and takes the chip with it — day 1 has no now');
    assert.equal(tick(), 'none', 'nor its tick');
    // Dropped, not merely unpainted. A re-render re-establishes the scrub
    // from the stored index — a refresh, or the freshness label ticking over
    // — so an index left behind would bring the previous day's selection
    // back a moment later, on an hour that is no longer on screen.
    tab._repaintScrub();
    assert.deepEqual(litTemp(), [], 'a repaint does not resurrect it');
    assert.equal(chip(), 'none', 'nor the chip');
    assert.equal(el['wx-scrub-temp'].attrs.x1, '-10', 'nor the crosshair');

    // Back onto today and it returns, on now.
    tab._commitDay(0);
    assert.equal(chip(), 'inline', 'today gets its now-chip back');
  } finally {
    delete global.document;
    data.fetchWeather = realFetch;
    tab._resetState();
  }
});

test('a settling pan eases the tips home, and holds back the ones that left the viewport', () => {
  tab._resetState();
  const realFetch = data.fetchWeather;
  const realSetTimeout = global.setTimeout;
  const realClearTimeout = global.clearTimeout;
  let respond = null;
  data.fetchWeather = (provider, lat, lon, settings, cb) => { respond = cb; };
  const timers = [];
  global.setTimeout = (fn, ms) => { timers.push({ fn, ms }); return timers.length; };
  global.clearTimeout = () => {};
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
    const svg = panelStub(390);
    const px = (h) => h * charts.HOUR_W / charts.DAY_W * 390;

    tab._scrubTo(svg, px(12));
    const atRest = parseInt(tip.style.left, 10);
    assert.equal(tip.style.transition, '', 'a scrub lands at once, never on a curve');
    timers.length = 0;   // ignore whatever the render path itself scheduled

    // Case one: the tip is still on screen when the finger lifts. The
    // panels ease home over SETTLE_MS, so the tip must ease with them —
    // arriving instantly would float it over a still-moving value.
    tab._panTips(0.2, false);
    assert.equal(tip.style.transition, '', 'drag frames track the finger exactly, unananimated');
    tab._panTips(0, true);
    assert.equal(tip.style.transition, 'left ' + interact.settleCss(),
      'the settle puts the tip on the pan\'s own curve');
    assert.equal(tip.style.webkitTransition, 'left ' + interact.settleCss(), 'old WebViews too');
    assert.equal(parseInt(tip.style.left, 10), atRest, 'and aims it at its resting place');
    assert.equal(timers.length, 0, 'a visible tip needs no deferral');

    // Case two: the drag carried the value off-viewport, so the tip is
    // already hidden. The day change TRAVELS, so the tip must wait the
    // glide out — re-showing it mid-flight would park it over a value that
    // has not arrived yet.
    assert.ok(interact.settleMs() > 0, 'the day change travels, it does not land');
    tab._panTips(0.6, false);
    assert.equal(tip.style.display, 'none', 'gone with its value');
    tab._panTips(0, true);
    assert.equal(tip.style.display, 'none',
      'a released spring-back does NOT resurrect it over a value mid-flight');
    assert.equal(timers.length, 1, 'its return is deferred instead');
    assert.equal(timers[0].ms, interact.settleMs(), 'by exactly the pan\'s settle time');

    timers[0].fn();
    assert.equal(tip.style.display, 'block', 'once the pan has landed it comes back');
    assert.equal(parseInt(tip.style.left, 10), atRest, 'on its value');
    assert.equal(tip.style.transition, '', 'and lands at once — the pan is already home');

    // A fresh scrub during the settle owns the tips; the stale timer must
    // not paint over what paintScrub just placed.
    timers.length = 0;
    tab._panTips(0.6, false);
    tab._panTips(0, true);
    const pending = timers[timers.length - 1];
    tab._scrubTo(svg, px(6));
    const afterScrub = tip.style.left;
    pending.fn();
    assert.equal(tip.style.left, afterScrub, 'the stale settle timer stands down');

    // Case three: the tips ride the settle the RELEASE armed, not a
    // constant. A carry and a spring-back are different lengths now, so a
    // tip on the wrong one either flashes back over a value still in
    // flight or hangs after the panels have stopped.
    tab._scrubTo(svg, px(12));
    assert.equal(parseInt(tip.style.left, 10), atRest, 'back on the hour under test');
    // A fast release still going the way it was going: a carry.
    interact.armSettle(200, 1.2);
    const carry = { ms: interact.settleMs(), css: interact.settleCss() };
    assert.notEqual(carry.css, interact.SETTLE_CSS, 'a carry is timed by the hand, not by a constant');
    timers.length = 0;
    tab._panTips(0.6, false);
    tab._panTips(0, true);
    assert.equal(timers[0].ms, carry.ms, 'the held-back tip waits exactly the carry out');
    timers[0].fn();
    // And a spring-back, which travels the other way and starts from rest.
    interact.armSettle(-200, 1.2);
    const rest = { ms: interact.settleMs(), css: interact.settleCss() };
    assert.notEqual(rest.css, carry.css,
      'a reversal has no speed to continue, so it takes the other curve');
    assert.ok(rest.ms >= interact.REST_MIN_MS && rest.ms <= interact.REST_MAX_MS,
      'timed by how far it has to come back, not by how fast the hand was');
    // A DIFFERENT hour each time this re-establishes a live tip: tapping the
    // one already selected puts it down, and these lines only want a tip on
    // screen, not a statement about the toggle.
    tab._scrubTo(svg, px(11));
    timers.length = 0;
    tab._panTips(0.6, false);
    tab._panTips(0, true);
    assert.equal(timers[0].ms, rest.ms, 'and the tip waits THAT out instead');
    // A tip still ON screen has nothing to wait for — it rides the curve
    // itself, and it must be the armed one, or it arrives at its resting x
    // at a different moment than the value under it.
    tab._scrubTo(svg, px(10));
    tab._panTips(0, true);
    assert.equal(tip.style.transition, 'left ' + interact.settleCss(),
      'on the very curve the panels are running');
    assert.equal(tip.style.transition, 'left ' + rest.css, 'which here is the from-rest one');
  } finally {
    delete global.document;
    global.setTimeout = realSetTimeout;
    global.clearTimeout = realClearTimeout;
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
    const svg = panelStub(390);
    // A client x in the MIDDLE of hour h's bar, so the scrub selects h.
    const px = (h) => (h - 0.5) * charts.HOUR_W / charts.DAY_W * 390;

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

    // Release slop — a tap at the very edge can round to the hour sitting
    // ON the day seam (scrubTo clamps to the timeline, not the day). That
    // hour is still at the viewport boundary, so it stays VISIBLE, pulled
    // back inside rather than hidden: the half-pixel slack in placeTipX's
    // hide window exists for exactly this.
    tab._scrubTo(svg, px(24));
    assert.equal(tip.style.display, 'block', 'the seam hour is still on screen');
    assert.equal(parseInt(tip.style.left, 10), 390 - 34,
      'an off-day crosshair px is clamped back into the viewport');

    // A genuinely off-window hour is a different matter: it is hidden,
    // and placeTipX returns before touching left — so assert on display,
    // never on a left the function no longer writes.
    tip.style.left = '(untouched)';
    tab._scrubTo(svg, px(47));
    assert.equal(tip.style.display, 'none', 'an hour a day out of frame has no tip');
    assert.equal(tip.style.left, '(untouched)',
      'and a hidden tip is not repositioned at all');
    tip.style.left = '';

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

test('the tile row is a panned track, not a scroll container', () => {
  // A row the user can scroll AND a row the day owns cannot both be right:
  // a scroll offset survives the day change and leaves the strip showing a
  // day the panels are not on. So the row stops scrolling and is moved by
  // transform, on the pan's own curve.
  assert.match(css.WX_CSS, /\.wx-daysvp\{[^}]*overflow:hidden/,
    'the viewport clips the tiles that hang past the page');
  assert.match(css.WX_CSS, /\.wx-daysvp\{[^}]*touch-action:pan-y/,
    'a vertical drag still scrolls the page');
  const row = /\.wx-days\{([^}]*)\}/.exec(css.WX_CSS)[1];
  assert.equal(/overflow/.test(row), false, 'the row itself no longer scrolls: ' + row);
  assert.match(row, /position:relative/,
    'it stays the tiles’ offsetParent, which is what the pan measures');
  // The resting offset is measured, not scrolled, so the module that does
  // the measuring has to know the edge margin the stylesheet hands out —
  // one number, read from the CSS here so the two cannot drift.
  const edge = Number(/\.wx-days \.wx-day:last-child\{margin-right:(\d+)px/.exec(css.WX_CSS)[1]);
  assert.equal(interact.EDGE_PAD, edge,
    'the pan’s EDGE_PAD is the tiles’ own edge margin (' + edge + 'px)');
  assert.equal(
    Number(/\.wx-days \.wx-day:first-child\{margin-left:(\d+)px/.exec(css.WX_CSS)[1]), edge,
    'and both ends carry the same margin');
});

/**
 * A day-tile stub: the renderer gives every tile the day it selects as its
 * action arg, and the highlight reads that same attribute.
 * @param {number} day Day index the tile stands for.
 * @returns {Object} Tile stub with a weekday name element inside it.
 */
function tileStub(day) {
  const name = { style: {} };
  return {
    style: {}, disabled: false, name: name,
    getAttribute: (a) => (a === 'data-action-arg' ? String(day) : null),
    querySelector: (sel) => (sel === '.wx-day-name' ? name : null)
  };
}

test('the tile highlight is handed over BY the drag, not after it', () => {
  const pal = charts.palette(false);
  const tiles = [tileStub(0), tileStub(1), tileStub(2), tileStub(3)];
  tiles[3].disabled = true;      // past the timeline's end
  global.document = { querySelectorAll: (sel) => (sel === '.wx-day' ? tiles : []) };
  const realTimeout = global.setTimeout;
  const queued = [];
  global.setTimeout = (fn, ms) => { queued.push({ fn, ms }); return 0; };
  try {
    // Three tenths of the way from day 1 to day 2: the tile being left
    // still holds seven tenths of the accent, the one being dragged in has
    // taken three — they always sum to exactly one highlight.
    tab._fadeDayCards(1.3, false);
    assert.equal(tiles[1].style.borderColor, charts.fadeInk(pal.link, 0.7));
    assert.equal(tiles[2].style.borderColor, charts.fadeInk(pal.link, 0.3));
    assert.equal(tiles[0].style.borderColor, charts.fadeInk(pal.link, 0),
      'a day away is no highlight at all');
    assert.equal(tiles[1].name.style.color, charts.mixInk(pal.ink, pal.link, 0.7),
      'the weekday name travels on the same fraction as the border');
    assert.equal(tiles[2].name.style.color, charts.mixInk(pal.ink, pal.link, 0.3));
    assert.equal(tiles[0].style.transition, 'none',
      'a drag frame tracks the finger rather than chasing it');
    assert.equal(queued.length, 0, 'and schedules nothing');

    // Right on a day, the whole highlight is on that tile.
    tab._fadeDayCards(2, false);
    assert.equal(tiles[2].style.borderColor, charts.fadeInk(pal.link, 1));
    assert.equal(tiles[1].style.borderColor, charts.fadeInk(pal.link, 0));

    // A tile past the timeline's end cannot be landed on, so it never
    // takes any of the highlight — not even while the drag passes it.
    tab._fadeDayCards(3, false);
    assert.equal(tiles[3].style.borderColor, charts.fadeInk(pal.link, 0),
      'an off-timeline tile stays unlit');

    // On release the remaining fraction is finished on the curve the
    // RELEASE armed, and the inline inks are dropped once it has run — the
    // .sel rule they agree with owns the resting state. Naming the curve
    // rather than falling back to the stylesheet is what keeps the colours
    // in step with the row they are painted on: a flick and a spring-back
    // are different lengths, and the stylesheet only knows one of them.
    interact.armSettle(300, 1.5);
    const armed = { ms: interact.settleMs(), css: interact.settleCss() };
    assert.notEqual(armed.css, interact.SETTLE_CSS, 'this release carries');
    tab._fadeDayCards(1, true);
    assert.equal(tiles[1].style.transition, 'border-color ' + armed.css,
      'the border rides the armed curve, not the stylesheet default');
    assert.equal(tiles[1].name.style.transition, 'color ' + armed.css,
      'and so does the weekday name');
    assert.equal(queued.length, 1, 'and schedules the hand-back');
    assert.equal(queued[0].ms, armed.ms, 'after exactly that settle');
    queued[0].fn();
    assert.equal(tiles[1].style.borderColor, '', 'the inline ink is gone');
    assert.equal(tiles[1].name.style.color, '', 'on the name too');
    assert.equal(tiles[1].style.transition, '');
  } finally {
    global.setTimeout = realTimeout;
    delete global.document;
    tab._resetState();
  }
});

test('a swipe across the tiles pans the days and never taps the one it lands on', () => {
  tab._resetState();
  const realFetch = data.fetchWeather;
  let respond = null;
  data.fetchWeather = (provider, lat, lon, settings, cb) => { respond = cb; };
  const listeners = {};
  global.document = {
    addEventListener: (type, fn) => { listeners[type] = fn; },
    querySelectorAll: () => [],
    querySelector: () => null,
    getElementById: () => null
  };
  const realNow = Date.now;
  let clock = realNow();
  try {
    const state = { graphsLocation: 'current' };
    tab._setCtx({ S: state, render: () => {} });
    tab.weatherGraphsBlock(state, {}, SEED);
    respond(fixture(), null);

    // Wire the pointer module to the tab's own seams: this is the real
    // path a finger takes, listeners and all.
    interact.wire({
      view: () => tab._fetchState().view,
      day: () => tab._panDay(),
      commitDay: tab._commitDay,
      scrub: tab._scrubTo,
      panTips: tab._panTips,
      panStrip: tab._panStrip,
      canPull: () => false,
      refresh: () => {}
    });
    const tileVp = {
      getAttribute: (a) => (a === 'data-wxvp' ? 'days' : null),
      getBoundingClientRect: () => ({ width: 390 })
    };
    const touch = (type, x) => listeners[type]({
      touches: type === 'touchend' ? [] : [{ clientX: x, clientY: 100 }],
      changedTouches: [{ clientX: x, clientY: 100 }],
      target: tileVp,
      preventDefault: () => {}
    });

    Date.now = () => clock;
    touch('touchstart', 300);
    touch('touchmove', 180);
    touch('touchend', 180);
    assert.equal(tab._panDay(), 1,
      'a drag that STARTS on the tile row pans the days, like a drag on a chart');

    // The release fires a click on whatever tile the finger lifted over —
    // day 2's, say. Honouring it would jump a day past the snap.
    assert.equal(global.PConf.actions.wxShowDay('2'), false);
    assert.equal(tab._panDay(), 1, 'the pan’s trailing tap is swallowed');

    // A real tap, later, still selects its day.
    clock += 1000;
    global.PConf.actions.wxShowDay('2');
    assert.equal(tab._panDay(), 2, 'tapping a tile still jumps to it');
  } finally {
    Date.now = realNow;
    data.fetchWeather = realFetch;
    delete global.document;
    tab._resetState();
  }
});

test('panel titles name the quantity, not the unit', () => {
  tab._resetState();
  let respond = null;
  const realFetch = data.fetchWeather;
  data.fetchWeather = (provider, lat, lon, settings, cb) => { respond = cb; };
  try {
    const state = { graphsLocation: 'current', temperatureUnits: 'c', windUnits: 'mph' };
    tab._setCtx({ S: state, render: () => {} });
    tab.weatherGraphsBlock(state, {}, SEED);
    respond(fixture(), null);
    const html = tab.weatherGraphsBlock(state, {}, SEED);
    // Not one panel, ALL of them: the rule is about the heading, so it is
    // read off every title the block emits rather than off the two that
    // once carried a unit. A title is a quantity — "Wind & gusts",
    // "Pressure" — and a unit appended to one read as a label stuck on.
    const titles = (html.match(/<span class="wx-panel-title">[^<]*<\/span>/g) || [])
      .map((t) => /">([^<]*)</.exec(t)[1]);
    assert.deepEqual(titles, ['5-day forecast', 'Temperature &amp; precipitation',
      'Wind &amp; gusts', 'Humidity &amp; dew point', 'Pressure', 'Sun &amp; moon'],
      'every panel is named by its quantity alone');
    titles.forEach((t) => {
      assert.equal(t.indexOf('·'), -1, '"' + t + '" carries a unit on the heading');
    });
    // The unit is not lost: the hour the tip shows carries it, in whatever
    // unit the watch is set to — and for the two panels whose axis prints
    // bare numbers, the tip is now the ONLY place it appears.
    const view = charts.prepareView(fixture(), Date.now());
    assert.match(charts.tipHtml('wind', view, view.nowIndex, state), /<i>\d+ mph<\/i>/);
    assert.match(charts.tipHtml('wind', view, view.nowIndex, { windUnits: 'kph' }), /<i>\d+ km\/h<\/i>/);
    assert.match(charts.tipHtml('press', view, view.nowIndex, state), /<i>\d+ hPa<\/i>/);
  } finally {
    data.fetchWeather = realFetch;
    tab._resetState();
  }
});

test('freshness rides the 5-day title line, and the old footer is gone', () => {
  tab._resetState();
  let respond = null;
  const realFetch = data.fetchWeather;
  const realNow = Date.now;
  data.fetchWeather = (provider, lat, lon, settings, cb) => { respond = cb; };
  try {
    const state = { graphsLocation: 'current', temperatureUnits: 'c', windUnits: 'kph' };
    tab._setCtx({ S: state, render: () => {} });
    tab.weatherGraphsBlock(state, {}, SEED);
    // fetchWeather stamps every result with its meta (weather-tab-data.js);
    // the age is read from THAT stamp, so a cache hit still reports when the
    // data was fetched rather than when this render asked for it.
    const at = Date.now();
    const fx = fixture();
    fx.meta = { provider: 'openmeteo', fetchedAt: at, lat: 52.52, lon: 13.405 };
    respond(fx, null);

    let html = tab.weatherGraphsBlock(state, {}, SEED);
    assert.equal(html.indexOf('wx-foot"'), -1,
      'nothing trails the panels any more — the old footer moved up');
    const head = html.indexOf('<div class="wx-panel-head"><span class="wx-panel-title">5-day forecast</span>');
    assert.ok(head !== -1, 'the 5-day head still opens with its title');
    const fresh = html.indexOf('<span class="wx-fresh">', head);
    assert.ok(fresh !== -1 && fresh < html.indexOf('</div>', head),
      'the freshness group sits INSIDE that head, right of the title');
    assert.ok(html.indexOf('wx-age') < html.indexOf('wx-refresh'),
      'how old it is, then the way to make it newer');
    assert.ok(fresh < html.indexOf('data-wxvp="days"'),
      'and the whole line stands above the tile row');
    assert.match(html.slice(fresh, fresh + 200), /<span class="wx-age" id="wx-age">just now<\/span>/,
      'a fetch that just landed reads "just now"');
    assert.ok(html.indexOf('data-action="wxRefreshWeather"') > fresh,
      'Refresh stays, inside the group');
    // Neither the location nor the provider is repeated: the chip row and
    // the Provider card already name theirs.
    assert.equal(html.slice(fresh, html.indexOf('</div>', fresh)).indexOf('Berlin'), -1);
    assert.equal(html.slice(fresh, html.indexOf('</div>', fresh)).indexOf('Open-Meteo'), -1);

    // The age is live: it counts up without a refetch.
    Date.now = () => at + 7 * 60000 + 30000;
    html = tab.weatherGraphsBlock(state, {}, SEED);
    assert.match(html, /<span class="wx-age" id="wx-age">7 min ago<\/span>/);
    Date.now = realNow;

    // A refetch replaces the age with its own word and parks the button —
    // nothing to press while it is already pressing.
    global.PConf.actions.wxRefreshWeather();
    html = tab.weatherGraphsBlock(state, {}, SEED);
    assert.match(html, /<span class="wx-age" id="wx-age">updating…<\/span>/);
    assert.equal(html.indexOf('data-action="wxRefreshWeather"'), -1);
  } finally {
    Date.now = realNow;
    data.fetchWeather = realFetch;
    tab._resetState();
  }
});

test('the age keeps counting without a re-render, and stops when its line is gone', () => {
  tab._resetState();
  const realFetch = data.fetchWeather;
  const realNow = Date.now;
  const realInterval = global.setInterval;
  const realClear = global.clearInterval;
  let respond = null;
  data.fetchWeather = (provider, lat, lon, settings, cb) => { respond = cb; };
  const intervals = [];
  const cleared = [];
  global.setInterval = (fn, ms) => { intervals.push({ fn, ms }); return intervals.length; };
  global.clearInterval = (id) => { cleared.push(id); };
  const age = { textContent: 'just now' };
  let ageEl = age;
  global.document = { getElementById: (id) => (id === 'wx-age' ? ageEl : null) };
  try {
    const state = { graphsLocation: 'current', temperatureUnits: 'c', windUnits: 'kph' };
    tab._setCtx({ S: state, render: () => {} });
    tab.weatherGraphsBlock(state, {}, SEED);
    const at = Date.now();
    const fx = fixture();
    fx.meta = { provider: 'openmeteo', fetchedAt: at, lat: 52.52, lon: 13.405 };
    respond(fx, null);
    tab.weatherGraphsBlock(state, {}, SEED);

    // Nothing on this tab re-renders while it is used: swiping days and
    // scrubbing hours both write the DOM directly. Without a ticker the
    // line the user asked for would say "just now" for the whole session.
    assert.equal(intervals.length, 1, 'the render arms exactly one ticker');
    const tick = intervals[0].fn;
    assert.ok(intervals[0].ms > 0 && intervals[0].ms <= 30000,
      'fine enough that the minute turning shows up promptly');

    Date.now = () => at + 3 * 60000;
    tick();
    assert.equal(age.textContent, '3 min ago', 'the label counts up in place');
    Date.now = () => at + 2 * 3600000;
    tick();
    assert.equal(age.textContent, '2 h ago', 'and keeps climbing the ladder');

    // It rewrites one node and nothing else — no render, and emphatically
    // no refetch, so a keyed provider's quota is untouched.
    assert.equal(tab._fetchState().status, 'ok');

    // A second render replaces the ticker rather than stacking one.
    Date.now = realNow;
    tab.weatherGraphsBlock(state, {}, SEED);
    assert.equal(intervals.length, 2, 'the new render arms its own');
    assert.equal(cleared.length, 1, 'and retires the old one');

    // The line can vanish under it — another tab, an error — and then the
    // ticker has nothing left to keep true.
    ageEl = null;
    intervals[1].fn();
    assert.equal(cleared.length, 2, 'it stands itself down');

    // A refetch parks it outright: that render writes "updating…" into the
    // line, and a ticker would paint an age for the data being replaced
    // straight over the word.
    ageEl = age;
    tab.weatherGraphsBlock(state, {}, SEED);
    assert.equal(intervals.length, 3, 'a normal render arms one again');
    global.PConf.actions.wxRefreshWeather();
    const html = tab.weatherGraphsBlock(state, {}, SEED);
    assert.match(html, /<span class="wx-age" id="wx-age">updating…<\/span>/);
    assert.equal(intervals.length, 3, 'no ticker runs over "updating…"');
    assert.equal(cleared.length, 3, 'and the one that was running is retired');
  } finally {
    Date.now = realNow;
    global.setInterval = realInterval;
    global.clearInterval = realClear;
    delete global.document;
    data.fetchWeather = realFetch;
    tab._resetState();
  }
});

test('a render puts the tile row back BEFORE the frame goes up, not after it', () => {
  tab._resetState();
  let respond = null;
  const realFetch = data.fetchWeather;
  data.fetchWeather = (provider, lat, lon, settings, cb) => { respond = cb; };
  const raf = [];
  const timeouts = [];
  const realTimeout = global.setTimeout;
  global.requestAnimationFrame = (fn) => { raf.push(fn); return raf.length; };
  global.setTimeout = (fn, ms) => { if (ms === 0) { timeouts.push(fn); return 0; } return realTimeout(fn, ms); };
  global.document = { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] };
  try {
    const state = { graphsLocation: 'current', temperatureUnits: 'c', windUnits: 'kph' };
    tab._setCtx({ S: state, render: () => {} });
    tab.weatherGraphsBlock(state, {}, SEED);
    respond(fixture(), null);
    raf.length = 0;
    timeouts.length = 0;

    tab.weatherGraphsBlock(state, {}, SEED);
    // A setTimeout(0) can land AFTER a paint, and that paint showed the row
    // parked at Today. Both fix-ups go through the pre-paint callback.
    assert.equal(raf.length, 2, 'the strip pan and the scrub repaint both ride rAF');
    assert.equal(timeouts.length, 2, 'and both keep a timeout fallback, for a hidden page');
    // The fallback must be harmless when the frame already ran it.
    raf.forEach((fn) => fn());
    timeouts.forEach((fn) => fn());
  } finally {
    global.setTimeout = realTimeout;
    delete global.requestAnimationFrame;
    delete global.document;
    data.fetchWeather = realFetch;
    tab._resetState();
  }
});

test('on the current hour the crosshair stands down and lets the now line speak', () => {
  tab._resetState();
  const realFetch = data.fetchWeather;
  let respond = null;
  data.fetchWeather = (provider, lat, lon, settings, cb) => { respond = cb; };
  const lines = {};
  const lineFor = (id) => {
    if (!lines[id]) { lines[id] = { attrs: {}, setAttribute(k, v) { this.attrs[k] = String(v); } }; }
    return lines[id];
  };
  const bars = {};
  const barFor = (id) => {
    if (!bars[id]) { bars[id] = { attrs: {}, setAttribute(k, v) { this.attrs[k] = String(v); } }; }
    return bars[id];
  };
  global.document = {
    getElementById: (id) => (id.indexOf('wx-scrub-') === 0 ? lineFor(id)
      : (id.indexOf('wx-bar-') === 0 ? barFor(id) : null))
  };
  try {
    const state = { graphsLocation: 'current', temperatureUnits: 'c' };
    tab._setCtx({ S: state, render: () => {} });
    tab.weatherGraphsBlock(state, {}, SEED);
    respond(fixture(), null);
    tab.weatherGraphsBlock(state, {}, SEED);
    const view = tab._fetchState().view;
    const svg = panelStub(390);
    // A client x in the MIDDLE of hour h's bar, so the scrub selects h.
    const at = (h) => (h - 0.5) * charts.HOUR_W / charts.DAY_W * 390;
    const x = () => lines['wx-scrub-temp'].attrs.x1;
    const now = view.nowIndex;

    // Another hour: the crosshair is the mark, and it stands on that hour.
    tab._scrubTo(svg, at(now + 2));
    assert.equal(x(), String(charts.xAt(view, now + 2)),
      'away from now the crosshair draws where the finger is');

    // The current hour: the now line already stands on this exact tick —
    // both marks snap to the hour — and it is the stronger of the two. The
    // crosshair is drawn last and in the muted grey, so leaving it there
    // would paint over the now line and make the page's firmest statement
    // read as its softest.
    tab._scrubTo(svg, at(now));
    assert.equal(x(), '-10', 'on the current hour the crosshair parks');
    // Everything else the scrub does still happens — this is a line standing
    // down, not a selection that failed.
    assert.equal(bars['wx-bar-temp-' + now].attrs.opacity, '1',
      'the hour is still selected: its bar lights');
    assert.ok(bars['wx-bar-temp-' + now].attrs.stroke
      && bars['wx-bar-temp-' + now].attrs.stroke !== 'none',
      'and is still outlined');

    // And it comes straight back on the next hour over.
    tab._scrubTo(svg, at(now + 1));
    assert.equal(x(), String(charts.xAt(view, now + 1)), 'one hour on, it is back');
  } finally {
    delete global.document;
    data.fetchWeather = realFetch;
    tab._resetState();
  }
});

test('a tapped day is timed by how far it has to travel', () => {
  // A tap has no speed to continue, so it always takes the from-rest curve
  // — but it does have a distance, and the tile three days away is not the
  // same journey as the one next door. Arming it with no distance at all
  // (which is what "there was no gesture" naively means) collapsed every
  // jump onto the floor of the range: four days crossed in 200ms.
  tab._resetState();
  const realFetch = data.fetchWeather;
  let respond = null;
  data.fetchWeather = (provider, lat, lon, settings, cb) => { respond = cb; };
  // A page whose chart viewport measures 400px — one day per screen.
  const vp = { clientWidth: 400 };
  // Well clear of any earlier test's pan: a tap inside the suppression
  // window is swallowed before it ever reaches the day change.
  const realNow = Date.now;
  Date.now = () => realNow() + 100000;
  global.document = {
    querySelector: (sel) => (sel === '.wx-pan' ? { parentNode: vp } : null),
    querySelectorAll: () => [],
    getElementById: () => null,
    addEventListener: () => {}
  };
  try {
    const state = { graphsLocation: 'current' };
    tab._setCtx({ S: state, render: () => {} });
    tab.weatherGraphsBlock(state, {}, SEED);
    respond(fixture(), null);
    interact.armSettle(0, 0);
    const floor = interact.settleMs();
    // Day 0 -> day 1: a real distance, so a real duration.
    global.PConf.actions.wxShowDay('1');
    const near = interact.settleMs();
    assert.ok(near > floor,
      'one day over is timed by the screen it crosses, not by the floor ('
      + near + ' vs ' + floor + ')');
    assert.ok(near <= interact.REST_MAX_MS, 'and stays inside the range');
    assert.match(interact.settleCss(), /cubic-bezier/, 'on the from-rest curve');
  } finally {
    Date.now = realNow;
    delete global.document;
    data.fetchWeather = realFetch;
    tab._resetState();
  }
});

test('panDay is a WHOLE day, so the tiles can match it and one of them stays lit', () => {
  // Four things read panDay by EXACT equality — the tiles' .sel class, the
  // rendered strip's selected tile, the hour a tap resolves to, and the day
  // the panels rest on. A fractional day reaching it fails all four at
  // once, and the most visible failure is that no tile matches: the row
  // loses its accent border entirely the moment the settle ends and the
  // inline drag ink is cleared, so nothing says which day is on screen.
  // The residue can be a thousandth of a day, which looks landed.
  //
  // snapTargetDay is fixed at source and tested there; this pins the same
  // invariant at the sink, where it is relied on.
  tab._resetState();
  const realFetch = data.fetchWeather;
  let respond = null;
  data.fetchWeather = (provider, lat, lon, settings, cb) => { respond = cb; };
  const tiles = [0, 1, 2].map((d) => ({
    className: 'wx-day',
    style: {},
    disabled: false,
    getAttribute: (k) => (k === 'data-action-arg' ? String(d) : null),
    querySelector: () => null
  }));
  global.document = {
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: (sel) => (sel === '.wx-day' ? tiles : [])
  };
  try {
    const state = { graphsLocation: 'current', temperatureUnits: 'c' };
    tab._setCtx({ S: state, render: () => {} });
    tab.weatherGraphsBlock(state, {}, SEED);
    respond(fixture(), null);
    tab.weatherGraphsBlock(state, {}, SEED);
    assert.ok(tab._fetchState().view.days >= 2, 'precondition: more than one day');

    /** @returns {Array<string>} the data-action-arg of every tile wearing .sel */
    const lit = () => tiles.filter((t) => (' ' + t.className + ' ').indexOf(' sel ') !== -1)
      .map((t) => t.getAttribute('data-action-arg'));

    tab._commitDay(1);
    assert.deepEqual(lit(), ['1'], 'precondition: a whole day lights its tile');

    // What a flick released mid-settle used to hand over.
    tab._commitDay(1.8727);
    assert.equal(tab._panDay(), 2, 'the fraction is resolved to the day it reads as');
    assert.deepEqual(lit(), ['2'], 'and that day’s tile is the one lit');

    // The near-miss is the dangerous one: it looks landed.
    tab._commitDay(0.9986);
    assert.equal(tab._panDay(), 1, 'a thousandth of a day short is still that day');
    assert.deepEqual(lit(), ['1'], 'one tile lit, not none');

    // And exactly one, always — never two, never zero.
    [0, 0.4, 0.5, 1.2, 1.5, 2, 2.49].forEach((d) => {
      tab._commitDay(d);
      assert.equal(lit().length, 1, 'exactly one tile is lit at d=' + d);
      assert.equal(lit()[0], String(tab._panDay()), 'and it is panDay’s own tile');
    });
  } finally {
    delete global.document;
    data.fetchWeather = realFetch;
    tab._resetState();
  }
});
