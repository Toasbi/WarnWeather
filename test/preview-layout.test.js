// test/preview-layout.test.js — the Layout tab's band-stack preview
// (src/pkjs/settings/preview-layout.js): the view cycle it resolves, the band
// geometry it turns each ViewSpec into, and the columns it paints them as.
const test = require('node:test');
const assert = require('node:assert/strict');
require('../src/pkjs/config-ui/lib/schema-walk.js');
require('../src/pkjs/config-ui/lib/color.js');
require('../src/pkjs/config-ui/lib/show-when.js');
require('../src/pkjs/config-ui/lib/engine.js');
const LY = require('../src/pkjs/settings/preview-layout.js');

test('presetContents resolves each named preset directly (layoutPreset set)', () => {
    const vc = require('../src/pkjs/view-cycle.js');
    assert.deepEqual(LY.presetContents({ layoutPreset: 'fullCal', healthMode: 'off', radarMode: 'off' }),
        [vc.spec(vc.TIER_FULL, vc.TOP_CAL, vc.BODY_FC, vc.STATUS_SRC_FORECAST, vc.STATUS_SRC_NONE)]);
    assert.deepEqual(LY.presetContents({ layoutPreset: 'compactCal', healthMode: 'off', radarMode: 'off' }),
        [vc.spec(vc.TIER_COMPACT, vc.TOP_CAL, vc.BODY_FC, vc.STATUS_SRC_FORECAST, vc.STATUS_SRC_NONE)]);
    assert.deepEqual(LY.presetContents({ layoutPreset: 'compactDense', healthMode: 'off', radarMode: 'off' }),
        [vc.spec(vc.TIER_COMPACT, vc.TOP_CAL, vc.BODY_FC, vc.STATUS_SRC_FORECAST, vc.STATUS_SRC_NONE)]);
    assert.deepEqual(LY.presetContents({ layoutPreset: 'noCal', healthMode: 'off', radarMode: 'off' }),
        [vc.spec(vc.TIER_NONE, vc.TOP_EMPTY, vc.BODY_FC, vc.STATUS_SRC_FORECAST, vc.STATUS_SRC_NONE)]);
});

test('presetContents falls back to compactCal for an unrecognised preset key', () => {
    assert.deepEqual(LY.presetContents({ layoutPreset: 'bogus', healthMode: 'off', radarMode: 'off' }),
        LY.presetContents({ layoutPreset: 'compactCal', healthMode: 'off', radarMode: 'off' }));
});

test('presetContents migrates legacy layoutPreset/topViewMode settings via view-cycle.js', () => {
    // classic/radarLast/healthFirst -> compactCal; forecast -> noCal; fullCal unchanged.
    const compactCal = LY.presetContents({ layoutPreset: 'compactCal', healthMode: 'off', radarMode: 'off' });
    assert.deepEqual(LY.presetContents({ layoutPreset: 'classic', healthMode: 'off', radarMode: 'off' }), compactCal);
    assert.deepEqual(LY.presetContents({ layoutPreset: 'radarLast', healthMode: 'off', radarMode: 'off' }), compactCal);
    assert.deepEqual(LY.presetContents({ layoutPreset: 'healthFirst', healthMode: 'off', radarMode: 'off' }), compactCal);
    assert.deepEqual(LY.presetContents({ layoutPreset: 'forecast', healthMode: 'off', radarMode: 'off' }),
        LY.presetContents({ layoutPreset: 'noCal', healthMode: 'off', radarMode: 'off' }));
    assert.deepEqual(LY.presetContents({ topViewMode: 'full', healthMode: 'off', radarMode: 'off' }),
        LY.presetContents({ layoutPreset: 'fullCal', healthMode: 'off', radarMode: 'off' }), 'topViewMode full -> fullCal');
    assert.deepEqual(LY.presetContents({ topViewMode: 'none', healthMode: 'off', radarMode: 'off' }),
        LY.presetContents({ layoutPreset: 'noCal', healthMode: 'off', radarMode: 'off' }), 'topViewMode none -> noCal');
    assert.deepEqual(LY.presetContents({ healthMode: 'off', radarMode: 'off' }), compactCal, 'nothing set -> compactCal');
});

test('presetContents reads healthMode/radarMode off state to grow/shrink the cycle', () => {
    assert.equal(LY.presetContents({ layoutPreset: 'compactCal', healthMode: 'off', radarMode: 'off' }).length, 1);
    assert.equal(LY.presetContents({ layoutPreset: 'compactCal', healthMode: 'off', radarMode: 'graph' }).length, 2, 'radar adds a slot');
    assert.equal(LY.presetContents({ layoutPreset: 'compactCal', healthMode: 'status', radarMode: 'off' }).length, 2, 'health status adds a slot');
    assert.equal(LY.presetContents({ layoutPreset: 'compactCal', healthMode: 'status', radarMode: 'graph' }).length, 3, 'both add up to three');
    // radarMode unset (not explicitly 'off') is treated as enabled (defaults to 'graph').
    assert.equal(LY.presetContents({ layoutPreset: 'compactCal', healthMode: 'off' }).length, 2, 'unset radarMode counts as enabled');
});

test('contentBands renders each tier\'s band ordering', () => {
    const vc = require('../src/pkjs/view-cycle.js');
    assert.deepEqual(LY.contentBands(vc.spec(vc.TIER_FULL, vc.TOP_CAL, vc.BODY_FC, vc.STATUS_SRC_FORECAST, vc.STATUS_SRC_NONE)).map((b) => b.label),
        ['Watch Status', 'Calendar (3 rows)', 'Clock', 'Forecast Status', 'Forecast'], 'full tier: clock before status');
    assert.deepEqual(LY.contentBands(vc.spec(vc.TIER_COMPACT, vc.TOP_CAL, vc.BODY_FC, vc.STATUS_SRC_HEALTH, vc.STATUS_SRC_NONE)).map((b) => b.label),
        ['Watch Status', 'Calendar (2 rows)', 'Health Status', 'Clock', 'Forecast'], 'compact tier: upper status before clock');
    assert.deepEqual(LY.contentBands(vc.spec(vc.TIER_COMPACT, vc.TOP_CAL, vc.BODY_FC, vc.STATUS_SRC_FORECAST, vc.STATUS_SRC_NONE)).map((b) => b.label),
        ['Watch Status', 'Calendar (2 rows)', 'Forecast Status', 'Clock', 'Forecast'], 'compact tier: forecast status before clock (single upper row)');
    assert.deepEqual(LY.contentBands(vc.spec(vc.TIER_NONE, vc.TOP_EMPTY, vc.BODY_RADAR, vc.STATUS_SRC_RADAR, vc.STATUS_SRC_NONE)).map((b) => b.label),
        ['Watch Status', 'Clock', 'Radar Status', 'Radar'], 'none tier: no top band, big body; radar view uses the Radar status bar');
    assert.deepEqual(LY.contentBands(vc.spec(vc.TIER_FULL, vc.TOP_RADAR, vc.BODY_FC, vc.STATUS_SRC_NONE, vc.STATUS_SRC_NONE)).map((b) => b.label),
        ['Watch Status', 'Radar', 'Clock', 'Forecast'], 'radar rides the top band; NONE/NONE hides both status rows');
    assert.strictEqual(LY.contentBands(null), null, 'a null/disabled slot has no bands');
});

// The configurable bar reads "Radar Status" whenever the RADAR source occupies that slot —
// a direct data-driven mapping (statusUpper/statusLower), not inferred from spec.top/spec.body
// (mirrors main_window.c's per-source layer assignment). A top-radar view with an explicit
// FORECAST status row is NOT auto-relabeled — that inference is gone from the new model.
test('contentBands labels the configurable bar "Radar Status" for a radar view', () => {
    const vc = require('../src/pkjs/view-cycle.js');
    const label = (spec) => LY.contentBands(spec).map((b) => b.label);
    // radar as the body (the radar-graph flick stop)
    assert.ok(label(vc.spec(vc.TIER_COMPACT, vc.TOP_CAL, vc.BODY_RADAR, vc.STATUS_SRC_RADAR, vc.STATUS_SRC_NONE)).indexOf('Radar Status') >= 0,
        'radar-body view reads Radar Status');
    assert.ok(label(vc.spec(vc.TIER_COMPACT, vc.TOP_CAL, vc.BODY_RADAR, vc.STATUS_SRC_RADAR, vc.STATUS_SRC_NONE)).indexOf('Forecast Status') < 0,
        'radar-body view has no Forecast Status label');
    // radar riding the top band with an explicit RADAR status row present
    assert.ok(label(vc.spec(vc.TIER_FULL, vc.TOP_RADAR, vc.BODY_FC, vc.STATUS_SRC_RADAR, vc.STATUS_SRC_NONE)).indexOf('Radar Status') >= 0,
        'top-radar view with a RADAR status row reads Radar Status');
    // top-radar with a FORECAST (not RADAR) status row is NOT relabeled — no top/body inference
    const topRadarForecastStatus = label(vc.spec(vc.TIER_FULL, vc.TOP_RADAR, vc.BODY_FC, vc.STATUS_SRC_FORECAST, vc.STATUS_SRC_NONE));
    assert.ok(topRadarForecastStatus.indexOf('Forecast Status') >= 0 && topRadarForecastStatus.indexOf('Radar Status') < 0,
        'top-radar view with an explicit FORECAST status row keeps Forecast Status (no inference from top)');
    // two rows on a radar view: RADAR upper + HEALTH lower — each label comes from its own slot
    const dual = label(vc.spec(vc.TIER_COMPACT, vc.TOP_CAL, vc.BODY_RADAR, vc.STATUS_SRC_HEALTH, vc.STATUS_SRC_RADAR));
    assert.ok(dual.indexOf('Radar Status') >= 0 && dual.indexOf('Health Status') >= 0,
        'two-row radar view: Radar Status + Health Status');
    // a plain forecast view still reads Forecast Status
    assert.ok(label(vc.spec(vc.TIER_COMPACT, vc.TOP_CAL, vc.BODY_FC, vc.STATUS_SRC_FORECAST, vc.STATUS_SRC_NONE)).indexOf('Forecast Status') >= 0,
        'forecast-body view keeps Forecast Status');
});

test('contentBands renders the health-dense pairing (upper=HEALTH, lower=FORECAST) as two status rows', () => {
    const vc = require('../src/pkjs/view-cycle.js');
    const bands = LY.contentBands(vc.spec(vc.TIER_COMPACT, vc.TOP_CAL, vc.BODY_FC, vc.STATUS_SRC_HEALTH, vc.STATUS_SRC_FORECAST));
    const labels = bands.map((b) => b.label);
    assert.ok(labels.indexOf('Health Status') >= 0 && labels.indexOf('Forecast Status') >= 0);
    assert.ok(labels.indexOf('Health Status') < labels.indexOf('Clock'), 'upper row (Health) rides above the clock');
    assert.ok(labels.indexOf('Clock') < labels.indexOf('Forecast Status'), 'lower row (Forecast) sits below the clock');
});

// A status bar occupies exactly the space freed by dropping the 3rd calendar row, so
// the compact calendar + its status band read as tall as the full 3-row calendar.
test('contentBands: Cal2 + gap + status = Cal3 (status = the freed calendar row)', () => {
    const vc = require('../src/pkjs/view-cycle.js');
    const GAP = 2; // renderers stack bands with a 2px gap
    const full = LY.contentBands(vc.spec(vc.TIER_FULL, vc.TOP_CAL, vc.BODY_FC, vc.STATUS_SRC_FORECAST, vc.STATUS_SRC_NONE));
    const compact = LY.contentBands(vc.spec(vc.TIER_COMPACT, vc.TOP_CAL, vc.BODY_FC, vc.STATUS_SRC_FORECAST, vc.STATUS_SRC_NONE));
    const cal3 = full.find((b) => b.label === 'Calendar (3 rows)').h;
    const cal2 = compact.find((b) => b.label === 'Calendar (2 rows)').h;
    const status = compact.find((b) => b.label === 'Forecast Status').h;
    assert.equal(cal2 + GAP + status, cal3, 'dropping the 3rd calendar row buys exactly one status line');
});

// The body (Forecast / Health graph / Radar) is the flex element: it absorbs whatever
// vertical space the fixed bands leave, so it always reaches the bottom of the frame.
test('contentBands: the body band is the flex element, all others fixed', () => {
    const vc = require('../src/pkjs/view-cycle.js');
    [vc.BODY_FC, vc.BODY_GRAPH, vc.BODY_RADAR].forEach((body) => {
        const bands = LY.contentBands(vc.spec(vc.TIER_COMPACT, vc.TOP_CAL, body, vc.STATUS_SRC_FORECAST, vc.STATUS_SRC_NONE));
        const last = bands[bands.length - 1];
        assert.equal(last.flex, true, 'the last (body) band is marked flex');
        assert.equal(last.kind, 'body');
        bands.slice(0, -1).forEach((b) => assert.ok(!b.flex, b.label + ' is fixed-height'));
    });
});

// ── Graphless views (custom layout v2) ──────────────────────────────────────

/**
 * The y of each labelled band in a rendered column, top to bottom.
 * @param {string} svgPart renderBandColumn markup
 * @returns {Object<string, number>} label → the band rect's y
 */
function bandYs(svgPart) {
    const rects = [...svgPart.matchAll(/<rect x="[^"]*" y="([^"]*)"[^>]*height="([^"]*)"/g)]
        .map((m) => Number(m[1]));
    const labels = [...svgPart.matchAll(/<text[^>]*>([^<]+)<\/text>/g)].map((m) => m[1]).slice(1);
    const out = {};
    labels.forEach((l, i) => { out[l] = rects[i]; });
    return out;
}

test('contentBands: a graphless view has no body band and no flex band; every band has a kind', () => {
    const vc = require('../src/pkjs/view-cycle.js');
    const s = Object.assign(vc.spec(vc.TIER_COMPACT, vc.TOP_CAL, vc.BODY_NONE, vc.STATUS_SRC_FORECAST,
        vc.STATUS_SRC_NONE), { order: 1 });
    const bands = LY.contentBands(s);
    assert.deepEqual(bands.map((b) => b.kind), ['strip', 'top', 'clock', 'status']);
    assert.ok(bands.every((b) => !b.flex), 'nothing fills');
});

test('renderBandColumn: the Position shifts the stack under a pinned Watch Status strip', () => {
    const vc = require('../src/pkjs/view-cycle.js');
    const s = Object.assign(vc.spec(vc.TIER_NONE, vc.TOP_EMPTY, vc.BODY_NONE, vc.STATUS_SRC_NONE,
        vc.STATUS_SRC_NONE), {});
    const bands = LY.contentBands(s);           // Watch Status 12 + Clock 30
    const col = (a) => bandYs(LY.renderBandColumn(bands, 0, 60, 'Flick', null, false, 'dark', a));
    const top = col(vc.ALIGN_TOP), mid = col(vc.ALIGN_CENTER), bot = col(vc.ALIGN_BOTTOM);
    const clk = col(vc.ALIGN_CLOCK);
    [top, mid, bot, clk].forEach((c) => assert.equal(c['Watch Status'], 16, 'the strip is pinned'));
    assert.equal(top.Clock, 30, 'Top: right under the strip (16 + 12 + gap 2)');
    const slack = 104 - (12 + 2 + 30);
    assert.equal(bot.Clock, 30 + slack, 'Bottom: the stack ends on the column floor');
    assert.equal(mid.Clock, 30 + Math.floor(slack / 2));
    assert.equal(clk.Clock + 15, 68, 'Clock: the clock band is centred on the column midline');
});

test('renderBandColumn: Clock without a clock reads as Middle; a filled column ignores the Position', () => {
    const vc = require('../src/pkjs/view-cycle.js');
    const lone = LY.contentBands(Object.assign(vc.spec(vc.TIER_NONE, vc.TOP_EMPTY, vc.BODY_NONE,
        vc.STATUS_SRC_FORECAST, vc.STATUS_SRC_NONE), { clockOff: true }));
    const c = bandYs(LY.renderBandColumn(lone, 0, 60, 'F', null, false, 'dark', vc.ALIGN_CLOCK));
    const m = bandYs(LY.renderBandColumn(lone, 0, 60, 'F', null, false, 'dark', vc.ALIGN_CENTER));
    assert.equal(c['Forecast Status'], m['Forecast Status']);
    const filled = LY.contentBands(vc.spec(vc.TIER_COMPACT, vc.TOP_CAL, vc.BODY_FC,
        vc.STATUS_SRC_FORECAST, vc.STATUS_SRC_NONE));
    assert.deepEqual(bandYs(LY.renderBandColumn(filled, 0, 60, 'D', null, false, 'dark', vc.ALIGN_BOTTOM)),
        bandYs(LY.renderBandColumn(filled, 0, 60, 'D', null, false, 'dark', vc.ALIGN_TOP)));
});

test('presetContents: compactDense + radar=status folds radar into the single default (no flick)', () => {
    const c = LY.presetContents({ layoutPreset: 'compactDense', healthMode: 'off', radarMode: 'status' });
    assert.equal(c.length, 1);
    const labels = LY.contentBands(c[0]).map((b) => b.label);
    assert.ok(labels.indexOf('Radar Status') >= 0);
    assert.ok(labels.indexOf('Forecast Status') >= 0);
});

test('contentBands orders radar-upper above the clock and forecast-lower below', () => {
    const c = LY.presetContents({ layoutPreset: 'compactDense', healthMode: 'off', radarMode: 'status' });
    const labels = LY.contentBands(c[0]).map((b) => b.label);
    assert.ok(labels.indexOf('Radar Status') < labels.indexOf('Clock'));
    assert.ok(labels.indexOf('Clock') < labels.indexOf('Forecast Status'));
});

test('resolveBandHeights: the flex band absorbs the slack so bands + gaps fill availH', () => {
    const bands = [{ h: 12 }, { h: 20 }, { h: 20, flex: true }];
    const heights = LY.resolveBandHeights(bands, 100, 2);
    const total = heights.reduce((s, h) => s + h, 0) + (bands.length - 1) * 2;
    assert.equal(total, 100, 'bands + gaps exactly fill the available height');
    assert.equal(heights[2], 100 - 12 - 20 - 2 * 2, 'flex band = remaining space after fixed bands + gaps');
});

test('resolveBandHeights: the flex band never collapses below a visible minimum', () => {
    const heights = LY.resolveBandHeights([{ h: 90 }, { h: 20, flex: true }], 50, 2);
    assert.ok(heights[1] >= 12, 'flex band clamped to a visible minimum instead of going negative');
});

// radarMode 'status' packs the flick stop as BODY_RADAR_STATUS — the forecast body
// (chart suppressed) with the status line turned to radar, mirroring the watch.
// (The band labeling itself is pinned by the contentBands tests above.)
test('layoutPreviewCombined: radarMode "status" renders the flick column as Forecast + Radar Status', () => {
    const svg = LY.layoutPreviewCombined({ layoutPreset: 'compactCal', healthMode: 'off', radarMode: 'status' }, {}, {});
    assert.ok(svg.indexOf('>Forecast<') >= 0, 'radar-status flick body renders as Forecast');
    assert.ok(svg.indexOf('>Radar Status<') >= 0, 'status band reads Radar Status');
});

test('layoutPreviewCombined: one column per cycle slot, headers Default/Flick 1/Flick 2', () => {
    const one = LY.layoutPreviewCombined({ layoutPreset: 'compactCal', radarMode: 'off', healthMode: 'off' }, {}, {});
    assert.ok(one.indexOf('Default') >= 0, 'Default header present');
    assert.strictEqual(one.indexOf('Flick 1'), -1, 'no flick column for a single-slot cycle');

    const two = LY.layoutPreviewCombined({ layoutPreset: 'compactCal', radarMode: 'graph', healthMode: 'off' }, {}, {});
    assert.ok(two.indexOf('Default') >= 0 && two.indexOf('Flick 1') >= 0, 'Default + Flick 1 present');
    assert.ok(two.indexOf('Radar') >= 0, 'flick 1 column shows the Radar band');
    assert.strictEqual(two.indexOf('Flick 2'), -1, 'no third column for a two-slot cycle');

    const three = LY.layoutPreviewCombined({ layoutPreset: 'compactDense', radarMode: 'graph', healthMode: 'all' }, {}, {});
    assert.ok(three.indexOf('Default') >= 0 && three.indexOf('Flick 1') >= 0 && three.indexOf('Flick 2') >= 0,
        'all three column headers present for a three-slot cycle');
});

test('layoutPreviewCombined: toggling radar/health grows or shrinks the columns (no dimming, no notes)', () => {
    const radarOff = LY.layoutPreviewCombined({ layoutPreset: 'compactCal', radarMode: 'off', healthMode: 'off' }, {}, {});
    const radarOn = LY.layoutPreviewCombined({ layoutPreset: 'compactCal', radarMode: 'graph', healthMode: 'off' }, {}, {});
    assert.strictEqual(radarOff.indexOf('Radar'), -1, 'radar column absent when radar is disabled');
    assert.ok(radarOn.indexOf('Radar') >= 0, 'radar column present once radar is enabled');
    assert.strictEqual(radarOn.indexOf('needs radar'), -1, 'no availability note anywhere');

    const healthOff = LY.layoutPreviewCombined({ layoutPreset: 'compactCal', radarMode: 'off', healthMode: 'off' }, {}, {});
    const healthOn = LY.layoutPreviewCombined({ layoutPreset: 'compactCal', radarMode: 'off', healthMode: 'status' }, {}, {});
    assert.strictEqual(healthOff.indexOf('Health Status'), -1, 'health column absent when health is off');
    assert.ok(healthOn.indexOf('Health Status') >= 0, 'health column present once health is on');
    assert.strictEqual(healthOn.indexOf('needs health'), -1, 'no availability note anywhere');
});

test('layoutPreviewCombined: columns span the full window width, flush left (no side padding)', () => {
    const svg = LY.layoutPreviewCombined({ layoutPreset: 'compactCal', radarMode: 'graph', healthMode: 'off' }, {}, {});
    // Left (Default) column starts flush at x=0 (no black side padding inset).
    assert.ok(svg.indexOf('<rect x="0" y="16"') >= 0, 'left column band starts at x=0');
});
test('layoutPreviewCombined: light theme flips the canvas background to white', () => {
  const state = { layoutPreset: 'compactCal', healthMode: 'off', radarMode: 'off', theme: 'light' };
  assert.ok(LY.layoutPreviewCombined(state, {}).indexOf('fill="#FFFFFF"') >= 0);
});

test('layoutPreviewCombined: bw-light theme also flips the canvas background to white', () => {
  const state = { layoutPreset: 'compactCal', healthMode: 'off', radarMode: 'off', theme: 'bw-light' };
  assert.ok(LY.layoutPreviewCombined(state, {}).indexOf('fill="#FFFFFF"') >= 0);
});

// The band-stack chrome (renderBandColumn's band fill + empty-column placeholder)
// used to be a fixed dark hex regardless of theme, so a light canvas still showed
// dark "cards" floating on it. It now washes previewInk's rgba helper — the same
// theme-relative mechanism the other previews use for dividers/gridlines.
test('layoutPreviewCombined: light theme themes the band chrome too, not just the canvas', () => {
  const state = { layoutPreset: 'compactCal', healthMode: 'status', radarMode: 'graph', theme: 'light' };
  const combined = LY.layoutPreviewCombined(state, {});
  assert.equal(combined.indexOf('#1B1F27'), -1, 'band fill is no longer hardcoded dark');
  assert.equal(combined.indexOf('#12151C'), -1, 'placeholder fill is no longer hardcoded dark');
  assert.ok(combined.indexOf('rgba(0,0,0,0.12)') >= 0, 'band fill washes black-on-white in light theme');
});

test('layoutPreviewCombined: dark theme keeps the light-on-black band wash', () => {
  const state = { layoutPreset: 'compactCal', healthMode: 'status', radarMode: 'graph', theme: 'dark' };
  assert.ok(LY.layoutPreviewCombined(state, {}).indexOf('rgba(255,255,255,0.12)') >= 0);
});

// ── Custom layout previews ──────────────────────────────────────────────────
const vc = require('../src/pkjs/view-cycle.js');

const CUSTOM_STATE = {
  layoutPreset: 'custom', healthMode: 'off', radarMode: 'off',
  viewCount: '2',
  viewTop0: 'cal2', viewBody0: 'forecast', viewUpper0: 'weather', viewLower0: 'off', viewOrder0: 'TACB',
  viewTop1: 'none', viewBody1: 'forecast', viewUpper1: 'off', viewLower1: 'off', viewOrder1: 'CTAB',
  viewClockOff1: true, viewStripOff1: true,
};

test('presetContents: custom compiles the per-view keys; the preview IS the wire', () => {
  const contents = LY.presetContents(CUSTOM_STATE, { platform: 'basalt' });
  assert.deepStrictEqual(contents.map(vc.packSpec),
    vc.buildCustomCycle(CUSTOM_STATE).map(vc.packSpec));
});

test('presetContents: an aplite env shows the folded compactCal cycle, matching its wire', () => {
  const contents = LY.presetContents(CUSTOM_STATE, { platform: 'aplite' });
  assert.deepStrictEqual(contents.map(vc.packSpec),
    vc.buildViewCycle('compactCal', 'off', 'off', false).map(vc.packSpec));
});

test('contentBands: clockOff drops the Clock band, stripOff drops the Watch Status band', () => {
  const spec = vc.unpackSpec(vc.packSpec(Object.assign(
    vc.spec(vc.TIER_NONE, vc.TOP_EMPTY, vc.BODY_RADAR, vc.STATUS_SRC_NONE, vc.STATUS_SRC_NONE),
    { clockOff: true, stripOff: true })));
  const labels = LY.contentBands(spec).map((b) => b.label);
  assert.deepEqual(labels, ['Radar'], 'the full-screen radar: nothing but the body');
});

test('contentBands: a stacked order renders the movable bands in STACK_ORDERS sequence', () => {
  // CTAB with a full house: Clock, Calendar, Status A, Status B, then the body.
  const s = vc.spec(vc.TIER_COMPACT, vc.TOP_CAL, vc.BODY_FC,
    vc.STATUS_SRC_FORECAST, vc.STATUS_SRC_HEALTH);
  s.order = vc.orderCode('CTAB');
  const labels = LY.contentBands(s).map((b) => b.label);
  assert.deepEqual(labels, ['Watch Status', 'Clock', 'Calendar (2 rows)',
    'Forecast Status', 'Health Status', 'Forecast']);
});

// The watch dispatches ANY custom view with clockOff/stripOff OR order 1-11 through
// its generic stacker (band sequence = STACK_ORDERS[order], order 0 = 'TACB', absent
// bands skipped); only pure order-0 full-chrome specs take the legacy tier branches.
// contentBands mirrors that rule exactly — pin both flag paths at order 0.
test('contentBands: an order-0 spec with clockOff stacks TACB minus the clock', () => {
  const s = vc.spec(vc.TIER_FULL, vc.TOP_CAL, vc.BODY_FC,
    vc.STATUS_SRC_FORECAST, vc.STATUS_SRC_HEALTH);
  s.clockOff = true;   // order stays 0 (legacy) — the flag alone must pick the stacker
  const labels = LY.contentBands(s).map((b) => b.label);
  assert.deepEqual(labels, ['Watch Status', 'Calendar (3 rows)',
    'Forecast Status', 'Health Status', 'Forecast'],
    'TACB with C absent: top, upper, lower, body — no Clock band');
});

test('contentBands: an order-0 spec with stripOff stacks TACB, not the legacy full order', () => {
  // Discriminating case: the legacy full/none branch puts the Clock BEFORE the
  // status rows (T C A B); the stacker's TACB puts the upper row above the clock.
  const s = vc.spec(vc.TIER_FULL, vc.TOP_CAL, vc.BODY_FC,
    vc.STATUS_SRC_FORECAST, vc.STATUS_SRC_HEALTH);
  s.stripOff = true;
  const labels = LY.contentBands(s).map((b) => b.label);
  assert.deepEqual(labels, ['Calendar (3 rows)', 'Forecast Status', 'Clock',
    'Health Status', 'Forecast'],
    'stacker TACB (A above C), Watch Status dropped — the watch\'s rendering');
});

test('contentBands: a graph in the top area is a labelled 3-row top band', () => {
    const vc = require('../src/pkjs/view-cycle.js');
    const f = LY.contentBands(Object.assign(vc.spec(vc.TIER_NONE, vc.TOP_GRAPH, vc.BODY_GRAPH,
        vc.STATUS_SRC_NONE, vc.STATUS_SRC_NONE), { order: 1 }));
    assert.deepEqual(f.map((b) => b.label), ['Watch Status', 'Forecast', 'Clock', 'Health graph']);
    assert.equal(f[1].kind, 'top');
    const h = LY.contentBands(Object.assign(vc.spec(vc.TIER_NONE, vc.TOP_GRAPH, vc.BODY_FC,
        vc.STATUS_SRC_NONE, vc.STATUS_SRC_NONE), { order: 1, topKind: vc.TOP_KIND_HEALTH }));
    assert.equal(h[1].label, 'Health graph');
    assert.equal(h[1].h, f[1].h, 'both 3 rows (sizes are Phase 2b)');
});

// ── Sizes (Phase 2b) ─────────────────────────────────────────────────────────

test('contentBands: sized bands take 2 / 3 / 4 schematic rows; at most one band is flex', () => {
    const vc = require('../src/pkjs/view-cycle.js');
    const radar = (topSize, extra) => LY.contentBands(Object.assign(vc.spec(vc.TIER_FULL, vc.TOP_RADAR,
        vc.BODY_FC, vc.STATUS_SRC_NONE, vc.STATUS_SRC_NONE), { order: 1, topSize }, extra || {}));
    assert.equal(radar(vc.SIZE_2)[1].h, 22);
    assert.equal(radar(vc.SIZE_3)[1].h, 34);
    assert.equal(radar(vc.SIZE_4)[1].h, 46);
    // a filling top with a sized body: the top is the one flex band
    const ft = radar(vc.SIZE_FILL, { bodySize: vc.SIZE_3 });
    assert.equal(ft[1].flex, true);
    assert.equal(ft[ft.length - 1].flex, false);
    assert.equal(ft[ft.length - 1].h, 34);
    // a forecast body never shows 2 rows (the watch clamp)
    const fc2 = LY.contentBands(Object.assign(vc.spec(vc.TIER_COMPACT, vc.TOP_CAL, vc.BODY_FC,
        vc.STATUS_SRC_NONE, vc.STATUS_SRC_NONE), { order: 1, bodySize: vc.SIZE_2 }));
    assert.equal(fc2[fc2.length - 1].h, 34);
    // every compiled shape has at most one flex band
    [vc.SIZE_2, vc.SIZE_3, vc.SIZE_4, vc.SIZE_FILL, undefined].forEach((ts) =>
        [vc.SIZE_2, vc.SIZE_4, undefined].forEach((bs) => {
            const s = vc.spec(vc.TIER_NONE, vc.TOP_GRAPH, vc.BODY_GRAPH, vc.STATUS_SRC_FORECAST, vc.STATUS_SRC_NONE);
            if (ts) { s.topSize = ts; }
            if (bs) { s.bodySize = bs; }
            const canonical = vc.unpackWire(vc.packWire(s));
            assert.ok(LY.contentBands(canonical).filter((b) => b.flex).length <= 1, ts + '/' + bs);
        }));
});

test('renderBandColumn: only a view the WATCH cannot fit is clipped and flagged; others squeeze', () => {
    const vc = require('../src/pkjs/view-cycle.js');
    const tall = LY.contentBands(Object.assign(vc.spec(vc.TIER_NONE, vc.TOP_GRAPH, vc.BODY_GRAPH,
        vc.STATUS_SRC_FORECAST, vc.STATUS_SRC_RADAR), { order: 1, topSize: vc.SIZE_4, bodySize: vc.SIZE_4 }));
    assert.match(LY.renderBandColumn(tall, 0, 60, 'F', null, false, 'dark', 0, true), />cut off</);
    const squeezed = LY.renderBandColumn(tall, 0, 60, 'F', null, false, 'dark', 0, false);
    assert.doesNotMatch(squeezed, />cut off</);
    const bottoms = [...squeezed.matchAll(/<rect x="[^"]*" y="([^"]*)"[^>]*height="([^"]*)"/g)]
        .map((m) => Number(m[1]) + Number(m[2]));
    assert.ok(Math.max(...bottoms) <= 120, 'squeezed into the column');
});

test('the previews never flag a view the watch shows whole (spec example D, golden sz7)', () => {
    const base = { layoutPreset: 'custom', healthMode: 'all', radarMode: 'graph', viewCount: '2',
        viewTop0: 'cal2', viewBody0: 'forecast', viewUpper0: 'weather', viewLower0: 'off',
        viewOrder0: 'TACB', viewBodySize0: '3',                                    // sz7
        viewTop1: 'forecast', viewTopSize1: '4', viewBody1: 'health', viewUpper1: 'off',
        viewLower1: 'off', viewOrder1: 'TCAB', viewClockOff1: false, viewStripOff1: false };  // D
    ['basalt', 'emery', ''].forEach((platform) => {
        assert.doesNotMatch(LY.layoutPreviewCombined(base, { platform }), />cut off</, platform);
        [0, 1].forEach((i) =>
            assert.doesNotMatch(LY.viewPreviewSvg(base, { platform }, i), />cut off</, platform + ' ' + i));
    });
    // ...but a view too tall for the 144 px watch is flagged there, and not on emery's.
    const tall = Object.assign({}, base, { viewUpper1: 'weather', viewOrder1: 'CTAB' });
    assert.match(LY.viewPreviewSvg(tall, { platform: 'basalt' }, 1), />cut off</);
    assert.doesNotMatch(LY.viewPreviewSvg(tall, { platform: 'emery' }, 1), />cut off</);
});
