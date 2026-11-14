// test/page/engine/watch-preview-cycle.test.js — the view cycle as the Watchface tab's watch preview
// draws it (page/layout/preview-watch.js): which views each layout gives, and each view's
// bands top to bottom as the preview speaks them (the Layout card's words: Watch bar,
// Calendar (3 rows), Clock, Forecast bar, Forecast …), on the seats the watch gives
// them (view-cycle.js stackSeats). These checks ran on the schematic band preview
// (preview-layout.js) until the watch preview replaced it.
const test = require('node:test');
const assert = require('node:assert/strict');
require('../../../src/pkjs/config-ui/lib/schema-walk.js');
require('../../../src/pkjs/lib/color.js');
require('../../../src/pkjs/config-ui/lib/show-when.js');
require('../../../src/pkjs/config-ui/lib/engine.js');
require('../../../src/pkjs/page/settings/blocks.js');
const vc = require('../../../src/pkjs/layout/domain/view-cycle.js');
const pw = require('../../../src/pkjs/page/layout/preview-watch.js');

const BASALT = { platform: 'basalt', color: true };
const NOW = new Date(2026, 8, 7, 15, 0);

/**
 * One view's bands as the watch preview speaks them.
 * @param {?Object} spec The view.
 * @param {Object} [S] Settings (only the look depends on them).
 * @param {Object} [env] Platform env.
 * @returns {string[]} Band names, top to bottom.
 */
function bands(spec, S, env) {
  const e = env || BASALT;
  return pw.screenSvg(spec, 0, S || {}, e, {}, e.platform === 'emery' ? 1 : 0, NOW).label.split(', ');
}

/**
 * Every view of a state's cycle, as bands.
 * @param {Object} S Settings.
 * @param {Object} [env] Platform env.
 * @returns {string[][]}
 */
function cycleBands(S, env) {
  return vc.resolveViewCycle(S, env || BASALT).map((spec) => bands(spec, S, env));
}

test('each preset\'s Default view, in the watch\'s order', () => {
  const off = (preset) => cycleBands({ layoutPreset: preset, healthMode: 'off', radarMode: 'off' });
  assert.deepEqual(off('fullCal'), [['Watch bar', 'Calendar (3 rows)', 'Clock', 'Forecast bar', 'Forecast']]);
  assert.deepEqual(off('compactCal'), [['Watch bar', 'Calendar (2 rows)', 'Forecast bar', 'Clock', 'Forecast']]);
  assert.deepEqual(off('compactDense'), off('compactCal'), 'dense with no row to add is compact');
  assert.deepEqual(off('noCal'), [['Watch bar', 'Clock', 'Forecast bar', 'Forecast']]);
  assert.deepEqual(off('bogus'), off('compactCal'), 'an unknown preset reads as Compact calendar');
  // Swap clock and status row: the forecast row moves under the clock, next to the graph.
  assert.deepEqual(cycleBands({ layoutPreset: 'compactCal', healthMode: 'off', radarMode: 'off', swapClockStatus: true }),
    [['Watch bar', 'Calendar (2 rows)', 'Clock', 'Forecast bar', 'Forecast']]);
});

test('radar and health grow the cycle by a view each', () => {
  const n = (S) => vc.resolveViewCycle(Object.assign({ layoutPreset: 'compactCal' }, S), BASALT).length;
  assert.equal(n({ healthMode: 'off', radarMode: 'off' }), 1);
  assert.equal(n({ healthMode: 'off', radarMode: 'graph' }), 2, 'radar adds a view');
  assert.equal(n({ healthMode: 'status', radarMode: 'off' }), 2, 'the health bar adds a view');
  assert.equal(n({ healthMode: 'status', radarMode: 'graph' }), 3, 'both add up to three');
  assert.equal(n({ healthMode: 'off' }), 2, 'an unset radar mode counts as the default, on');
  const html = pw.watchPreview({ layoutPreset: 'compactDense', radarMode: 'graph', healthMode: 'all' }, BASALT, {});
  assert.deepEqual((html.match(/class="wpv-cap" aria-hidden="true">[^<]*/g) || []).map((m) => m.split('>')[1]),
    ['Default', 'Flick 1', 'Flick 2'], 'one card per view, named');
});

test('each tier seats its status rows where the watch does', () => {
  const S = vc.spec;
  assert.deepEqual(bands(S(vc.TIER_FULL, vc.TOP_CAL, vc.BODY_FC, vc.STATUS_SRC_FORECAST, vc.STATUS_SRC_NONE)),
    ['Watch bar', 'Calendar (3 rows)', 'Clock', 'Forecast bar', 'Forecast'], 'full: the clock before the row');
  assert.deepEqual(bands(S(vc.TIER_COMPACT, vc.TOP_CAL, vc.BODY_FC, vc.STATUS_SRC_HEALTH, vc.STATUS_SRC_NONE)),
    ['Watch bar', 'Calendar (2 rows)', 'Health bar', 'Clock', 'Forecast'], 'compact: the upper row above the clock');
  assert.deepEqual(bands(S(vc.TIER_NONE, vc.TOP_EMPTY, vc.BODY_RADAR, vc.STATUS_SRC_RADAR, vc.STATUS_SRC_NONE)),
    ['Watch bar', 'Clock', 'Radar bar', 'Radar'], 'none: no top area, the radar graph below');
  assert.deepEqual(bands(S(vc.TIER_FULL, vc.TOP_RADAR, vc.BODY_FC, vc.STATUS_SRC_NONE, vc.STATUS_SRC_NONE)),
    ['Watch bar', 'Radar', 'Clock', 'Forecast'], 'the radar in the top area; no status row');
});

test('a status row is named by its own source, never guessed from the graphs', () => {
  const S = vc.spec;
  const radarBody = bands(S(vc.TIER_COMPACT, vc.TOP_CAL, vc.BODY_RADAR, vc.STATUS_SRC_RADAR, vc.STATUS_SRC_NONE));
  assert.ok(radarBody.indexOf('Radar bar') >= 0 && radarBody.indexOf('Forecast bar') < 0);
  const topRadarForecastRow = bands(S(vc.TIER_FULL, vc.TOP_RADAR, vc.BODY_FC, vc.STATUS_SRC_FORECAST, vc.STATUS_SRC_NONE));
  assert.ok(topRadarForecastRow.indexOf('Forecast bar') >= 0 && topRadarForecastRow.indexOf('Radar bar') < 0);
  const dual = bands(S(vc.TIER_COMPACT, vc.TOP_CAL, vc.BODY_RADAR, vc.STATUS_SRC_HEALTH, vc.STATUS_SRC_RADAR));
  assert.ok(dual.indexOf('Health bar') >= 0 && dual.indexOf('Radar bar') >= 0);
});

test('a dense view: its upper row above the clock, its lower one below', () => {
  const dense = bands(vc.spec(vc.TIER_COMPACT, vc.TOP_CAL, vc.BODY_FC, vc.STATUS_SRC_HEALTH, vc.STATUS_SRC_FORECAST));
  assert.ok(dense.indexOf('Health bar') < dense.indexOf('Clock'));
  assert.ok(dense.indexOf('Clock') < dense.indexOf('Forecast bar'));
  // Compact calendar (dense) with the radar bar only: one view, the radar row above the clock.
  const c = cycleBands({ layoutPreset: 'compactDense', healthMode: 'off', radarMode: 'status' });
  assert.equal(c.length, 1);
  assert.ok(c[0].indexOf('Radar bar') < c[0].indexOf('Clock'));
  assert.ok(c[0].indexOf('Clock') < c[0].indexOf('Forecast bar'));
});

test('the radar bar alone flicks to the forecast under a Radar bar row', () => {
  const c = cycleBands({ layoutPreset: 'compactCal', healthMode: 'off', radarMode: 'status' });
  assert.equal(c.length, 2);
  assert.ok(c[1].indexOf('Radar bar') >= 0 && c[1].indexOf('Forecast') >= 0);
});

test('custom: the preview draws the compiled per-view keys; aplite draws its compactCal fold', () => {
  const CUSTOM = {
    layoutPreset: 'custom', healthMode: 'off', radarMode: 'off', viewCount: '2',
    viewTop0: 'cal2', viewBody0: 'forecast', viewUpper0: 'weather', viewLower0: 'off', viewOrder0: 'TACB',
    viewTop1: 'none', viewBody1: 'forecast', viewUpper1: 'off', viewLower1: 'off', viewOrder1: 'CTAB',
    viewClockOff1: true, viewStripOff1: true
  };
  assert.deepEqual(cycleBands(CUSTOM), vc.buildCustomCycle(CUSTOM).map((s) => bands(s, CUSTOM)));
  assert.deepEqual(cycleBands(CUSTOM)[1], ['Forecast'], 'a view of nothing but its graph');
  const aplite = { platform: 'aplite', color: false, themePolarity: false };
  assert.deepEqual(cycleBands(CUSTOM, aplite),
    vc.buildViewCycle('compactCal', 'off', 'off', false).map((s) => bands(s, CUSTOM, aplite)));
});

test('custom flags: no clock, no top bar, a stacked order, a graph in the top area', () => {
  const full = (extra) => Object.assign(vc.spec(vc.TIER_FULL, vc.TOP_CAL, vc.BODY_FC,
    vc.STATUS_SRC_FORECAST, vc.STATUS_SRC_HEALTH), extra);
  assert.deepEqual(bands(vc.unpackSpec(vc.packSpec(Object.assign(vc.spec(vc.TIER_NONE, vc.TOP_EMPTY, vc.BODY_RADAR,
    vc.STATUS_SRC_NONE, vc.STATUS_SRC_NONE), { clockOff: true, stripOff: true })))), ['Radar'], 'the full-screen radar');
  const ctab = vc.spec(vc.TIER_COMPACT, vc.TOP_CAL, vc.BODY_FC, vc.STATUS_SRC_FORECAST, vc.STATUS_SRC_HEALTH);
  ctab.order = vc.orderCode('CTAB');
  assert.deepEqual(bands(ctab), ['Watch bar', 'Clock', 'Calendar (2 rows)', 'Forecast bar', 'Health bar', 'Forecast']);
  // Order 0 with a flag: the watch stacks TACB (the upper row above the clock), never the
  // full tier's legacy clock-first order.
  assert.deepEqual(bands(full({ clockOff: true })),
    ['Watch bar', 'Calendar (3 rows)', 'Forecast bar', 'Health bar', 'Forecast']);
  assert.deepEqual(bands(full({ stripOff: true })),
    ['Calendar (3 rows)', 'Forecast bar', 'Clock', 'Health bar', 'Forecast']);
  assert.deepEqual(bands(Object.assign(vc.spec(vc.TIER_NONE, vc.TOP_GRAPH, vc.BODY_GRAPH, vc.STATUS_SRC_NONE,
    vc.STATUS_SRC_NONE), { order: 1 })), ['Watch bar', 'Forecast', 'Clock', 'Health graph']);
  assert.deepEqual(bands(Object.assign(vc.spec(vc.TIER_NONE, vc.TOP_GRAPH, vc.BODY_FC, vc.STATUS_SRC_NONE,
    vc.STATUS_SRC_NONE), { order: 1, topKind: vc.TOP_KIND_HEALTH })), ['Watch bar', 'Health graph', 'Clock', 'Forecast']);
  assert.deepEqual(bands(Object.assign(vc.spec(vc.TIER_COMPACT, vc.TOP_CAL, vc.BODY_NONE, vc.STATUS_SRC_FORECAST,
    vc.STATUS_SRC_NONE), { order: 1 })), ['Watch bar', 'Calendar (2 rows)', 'Clock', 'Forecast bar'], 'a graphless view');
});

test('Position moves a stack that fills nothing; the top bar never moves', () => {
  const lone = (align, extra) => pw.layoutView(Object.assign(vc.spec(vc.TIER_NONE, vc.TOP_EMPTY, vc.BODY_NONE,
    vc.STATUS_SRC_NONE, vc.STATUS_SRC_NONE), { order: 1, align: align }, extra || {}), 0);
  const top = lone(vc.ALIGN_TOP), mid = lone(vc.ALIGN_CENTER), bot = lone(vc.ALIGN_BOTTOM), clk = lone(vc.ALIGN_CLOCK);
  [top, mid, bot, clk].forEach((l) => assert.equal(l.strip, top.strip, 'the top bar stays put'));
  const sc = pw.SCREEN[0], y = (l) => l.bands[0].y, h = top.bands[0].h;
  assert.ok(y(bot) > y(mid) && y(mid) > y(top), 'Bottom below Middle below Top');
  assert.equal(y(bot) - y(top), 2 * (y(mid) - y(top)) + ((y(bot) - y(top)) % 2), 'Middle splits the slack');
  assert.ok(Math.abs(y(clk) + h / 2 - sc.h / 2) <= 1, 'Clock: the clock\'s middle on the screen\'s midline');
  // Without a clock, Clock reads as Middle.
  const rowOnly = (align) => pw.layoutView(Object.assign(vc.spec(vc.TIER_NONE, vc.TOP_EMPTY, vc.BODY_NONE,
    vc.STATUS_SRC_FORECAST, vc.STATUS_SRC_NONE), { order: 1, clockOff: true, align: align }), 0);
  assert.deepEqual(rowOnly(vc.ALIGN_CLOCK), rowOnly(vc.ALIGN_CENTER));
  // A view whose graph fills ignores the Position.
  const filled = (align) => pw.layoutView(Object.assign(vc.spec(vc.TIER_COMPACT, vc.TOP_CAL, vc.BODY_FC,
    vc.STATUS_SRC_FORECAST, vc.STATUS_SRC_NONE), { align: align }), 0);
  assert.deepEqual(filled(vc.ALIGN_BOTTOM), filled(vc.ALIGN_TOP));
});

test('sizes: a sized radar takes 2, 3 or 4 rows; a forecast is never under 3', () => {
  const radarTop = (size) => pw.layoutView(Object.assign(vc.spec(vc.TIER_FULL, vc.TOP_RADAR, vc.BODY_FC,
    vc.STATUS_SRC_NONE, vc.STATUS_SRC_NONE), { order: 1, topSize: size, bodySize: vc.SIZE_3 }), 0).bands[0].h;
  assert.ok(radarTop(vc.SIZE_2) < radarTop(vc.SIZE_3) && radarTop(vc.SIZE_3) < radarTop(vc.SIZE_4));
  const fcBody = (size) => {
    const l = pw.layoutView(Object.assign(vc.spec(vc.TIER_COMPACT, vc.TOP_CAL, vc.BODY_FC, vc.STATUS_SRC_NONE,
      vc.STATUS_SRC_NONE), { order: 1, bodySize: size }), 0);
    return l.bands[l.bands.length - 1].h;
  };
  assert.equal(fcBody(vc.SIZE_2), fcBody(vc.SIZE_3), 'the watch draws a 2-row forecast as 3 rows');
});

test('the screen follows the theme: white on black, black on white for both light themes', () => {
  ['light', 'bw-light'].forEach((theme) => {
    const html = pw.watchPreview({ layoutPreset: 'compactCal', healthMode: 'off', radarMode: 'off', theme: theme }, BASALT, {});
    assert.ok(html.indexOf('<rect x="-9" y="-9" width="162" height="186" fill="#FFFFFF"></rect>') >= 0, theme);
  });
  const dark = pw.watchPreview({ layoutPreset: 'compactCal', healthMode: 'off', radarMode: 'off', theme: 'dark' }, BASALT, {});
  assert.ok(dark.indexOf('<rect x="-9" y="-9" width="162" height="186" fill="#000000"></rect>') >= 0);
});

test('the custom layout editor\'s preview: one view on its own, or a blank screen for an empty slot', () => {
  const S = { layoutPreset: 'custom', healthMode: 'off', radarMode: 'graph', viewCount: '2',
    viewTop0: 'cal2', viewBody0: 'forecast', viewUpper0: 'weather', viewLower0: 'off', viewOrder0: 'TACB',
    viewTop1: 'radar', viewBody1: 'none', viewUpper1: 'off', viewLower1: 'off', viewOrder1: 'TCAB',
    viewClockOff1: true, viewStripOff1: true };
  const one = pw.viewScreen(S, BASALT, 1, {});
  assert.equal(one.label, 'Radar');
  assert.match(one.svg, /^<svg class="wpv-scr" viewBox="-9 -9 162 186"/);
  const ids = (pw.viewScreen(S, BASALT, 0, {}).svg.match(/ id="[^"]*"/g) || []);
  assert.ok(ids.length > 0 && ids.every((m) => /-ve0-\d+"$/.test(m)), 'its graphs\' ids are its own: ' + ids.join(' '));
  const none = pw.viewScreen(S, BASALT, 2, {});
  assert.equal(none.label, 'Nothing to show');
  assert.match(none.svg, />Nothing to show<\/text><\/svg>$/);
  assert.match(pw.viewScreen(S, { platform: 'emery', color: true }, 0, {}).svg, /viewBox="-12 -12 224 252"/);
});
