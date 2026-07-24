// test/flick-presets.test.js
// The Layout preset compiles (preset x healthMode x radarMode) to CLAY_VIEW_0/1/2
// packed ViewSpec uint16s via view-cycle.js. Packed-value format & values: see
// view-cycle.test.js. Values below are the 10-bit positional encoding (statusUpper/
// statusLower), computed from the current view-cycle.js MATRIX — not hand-picked.
const test = require('node:test');
const assert = require('node:assert/strict');

global.localStorage = { getItem: function () { return null; }, setItem: function () {}, removeItem: function () {} };

const { buildClayPayload } = require('../src/pkjs/clay-payload.js');

function views(settings) {
  const p = buildClayPayload(settings, null, new Date(0));
  return [p.CLAY_VIEW_0, p.CLAY_VIEW_1, p.CLAY_VIEW_2];
}

test('compactCal default (off/no-radar) → [CAL2·FC upper, off, off]', () => {
  assert.deepStrictEqual(views({ layoutPreset: 'compactCal', radarMode: 'off' }), [0x244, 0, 0]);
});

test('compactCal all + radar → packed 3-stop cycle', () => {
  assert.deepStrictEqual(views({ layoutPreset: 'compactCal', healthMode: 'all', radarMode: 'graph' }),
    [0x244, 0x11C, 0x128]);   // CAL2 default (2-row), big graph + radar-chart flicks
});

test('compactDense status → health-dense default, single flick', () => {
  assert.deepStrictEqual(views({ layoutPreset: 'compactDense', healthMode: 'status', radarMode: 'off' }),
    [0x24D, 0, 0]);   // CAL2·FC, statusUpper=HEALTH, statusLower=FORECAST
});

test('fullCal status + radar', () => {
  assert.deepStrictEqual(views({ layoutPreset: 'fullCal', healthMode: 'status', radarMode: 'graph' }),
    [0x344, 0x24D, 0x368]);   // radar flick = CAL3·RDR (radar chart body, RADAR status row)
});

test('legacy layoutPreset migrates (classic → compactCal)', () => {
  assert.deepStrictEqual(views({ layoutPreset: 'classic', radarMode: 'graph' }), [0x244, 0x268, 0]);
});

test('legacy pre-preset topViewMode=none → noCal', () => {
  assert.deepStrictEqual(views({ topViewMode: 'none', radarMode: 'off' }), [0x104, 0, 0]);
});

test('viewResetMin maps straight through', () => {
  const p = buildClayPayload({ layoutPreset: 'compactCal', viewResetMin: '5' }, null, new Date(0));
  assert.strictEqual(p.CLAY_VIEW_RESET_MIN, 5);
});

test('no CLAY_DUAL_STATUS key is emitted', () => {
  const p = buildClayPayload({ layoutPreset: 'compactDense', healthMode: 'status' }, null, new Date(0));
  assert.strictEqual(Object.prototype.hasOwnProperty.call(p, 'CLAY_DUAL_STATUS'), false);
});

// radarMode='status' keeps the schema.js-documented behavior ("Adds the Radar Status Bar
// while retaining the forecast graph"): unlike 'graph', the radar flick's chart body
// (BODY_RADAR) demotes to a plain forecast body (BODY_FC) — its RADAR status row is
// unchanged. There is no BODY_RADAR_STATUS enum anymore; the distinction is now purely
// positional (see view-cycle.js's demoteRadarBody).
test('compactCal all + radar status → radar flick keeps the forecast body with a RADAR status row (no chart)', () => {
  assert.deepStrictEqual(
    views({ layoutPreset: 'compactCal', healthMode: 'all', radarMode: 'status' }),
    [0x244, 0x11C, 0x108]);   // last stop: NONE·FC (not NONE·RDR), statusUpper=RADAR
});
