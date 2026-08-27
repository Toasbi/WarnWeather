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
        bands.slice(0, -1).forEach((b) => assert.ok(!b.flex, b.label + ' is fixed-height'));
    });
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
