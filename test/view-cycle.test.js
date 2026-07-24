// test/view-cycle.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const vc = require('../src/pkjs/view-cycle.js');

test('packSpec of null/off slot is 0', () => {
  assert.strictEqual(vc.packSpec(null), 0);
});

function bytes(presetKey, healthMode, radarMode, swapClockStatus) {
  return vc.buildViewCycle(presetKey, healthMode, radarMode, swapClockStatus).map(vc.packSpec);
}
function up(s) { return s.statusUpper; }
function lo(s) { return s.statusLower; }

test('compactDense + radar=status + health=off = single dense default (radar upper, forecast lower), no flick', () => {
  const c = vc.buildViewCycle('compactDense', 'off', 'status');
  assert.equal(c.length, 1);
  assert.equal(up(c[0]), vc.STATUS_SRC_RADAR);
  assert.equal(lo(c[0]), vc.STATUS_SRC_FORECAST);
  assert.equal(c[0].body, vc.BODY_FC);
});

test('compactDense + health=status (today) = health upper + forecast lower, single view', () => {
  const c = vc.buildViewCycle('compactDense', 'status', 'off');
  assert.equal(c.length, 1);
  assert.equal(up(c[0]), vc.STATUS_SRC_HEALTH);
  assert.equal(lo(c[0]), vc.STATUS_SRC_FORECAST);
});

test('compactDense + both radar=status and health=status: health-dense default, radar on a flick', () => {
  const c = vc.buildViewCycle('compactDense', 'status', 'status');
  assert.equal(up(c[0]), vc.STATUS_SRC_HEALTH);
  assert.equal(lo(c[0]), vc.STATUS_SRC_FORECAST);
  assert.ok(c.length >= 2);
  assert.ok(c.slice(1).some((s) => up(s) === vc.STATUS_SRC_RADAR || lo(s) === vc.STATUS_SRC_RADAR));
});

test('compactCal single forecast: default upper; swapClockStatus moves it to lower', () => {
  const normal = vc.buildViewCycle('compactCal', 'off', 'off');
  assert.equal(up(normal[0]), vc.STATUS_SRC_FORECAST);
  assert.equal(lo(normal[0]), vc.STATUS_SRC_NONE);
  const swapped = vc.buildViewCycle('compactCal', 'off', 'off', true);
  assert.equal(up(swapped[0]), vc.STATUS_SRC_NONE);
  assert.equal(lo(swapped[0]), vc.STATUS_SRC_FORECAST);
});

test('no view maps two sources to the same band, and no source repeats across bands', () => {
  ['fullCal', 'compactCal', 'compactDense', 'noCal'].forEach((p) =>
    ['off', 'slot', 'status', 'all'].forEach((h) =>
      ['off', 'countdown', 'status', 'graph'].forEach((r) =>
        [false, true].forEach((sw) => {
          vc.buildViewCycle(p, h, r, sw).forEach((s) => {
            const rows = [s.statusUpper, s.statusLower].filter((x) => x !== vc.STATUS_SRC_NONE);
            const uniq = rows.filter((x, i) => rows.indexOf(x) === i);
            assert.equal(rows.length, uniq.length, p + '/' + h + '/' + r + '/' + sw + ' repeats a source');
            assert.ok(rows.length <= 2);
          });
        }))));
});

// radarMode='status' keeps the schema.js-documented behavior ("Adds the Radar Status Bar
// while retaining the forecast graph") for every preset, not just compactDense's dense
// fold above: the radar flick's chart body (BODY_RADAR) demotes to BODY_FC, but its
// STATUS_SRC_RADAR row is untouched — radarMode='graph' keeps the chart.
test("radar 'status' mode keeps the forecast body (no chart) but still carries a RADAR status row; 'graph' keeps the chart", () => {
  ['fullCal', 'compactCal', 'noCal'].forEach((p) => {
    const statusCycle = vc.buildViewCycle(p, 'off', 'status');
    const graphCycle = vc.buildViewCycle(p, 'off', 'graph');
    assert.equal(statusCycle.length, graphCycle.length, p + ': same slot count');
    const radarSlotStatus = statusCycle[statusCycle.length - 1];
    const radarSlotGraph = graphCycle[graphCycle.length - 1];
    assert.equal(radarSlotStatus.body, vc.BODY_FC, p + ": radar 'status' slot keeps a forecast (non-chart) body");
    assert.equal(radarSlotGraph.body, vc.BODY_RADAR, p + ": radar 'graph' slot keeps the chart body");
    assert.ok(radarSlotStatus.statusUpper === vc.STATUS_SRC_RADAR || radarSlotStatus.statusLower === vc.STATUS_SRC_RADAR,
      p + ": radar 'status' slot still carries a RADAR status row");
  });
});

test("'slot' health mode uses the same cycle as 'off' (no dedicated Health view)", () => {
  ['fullCal', 'compactCal', 'compactDense', 'noCal'].forEach((p) => {
    ['off', 'countdown', 'status', 'graph'].forEach((r) => {
      assert.deepStrictEqual(bytes(p, 'slot', r), bytes(p, 'off', r),
        p + ' radar=' + r + ": 'slot' must match 'off'");
    });
  });
});

test('unknown preset falls back to compactCal', () => {
  assert.deepStrictEqual(bytes('bogus', 'off', 'off'), bytes('compactCal', 'off', 'off'));
});

test('resolvePresetKey passes through new keys', () => {
  assert.strictEqual(vc.resolvePresetKey({ layoutPreset: 'fullCal' }), 'fullCal');
  assert.strictEqual(vc.resolvePresetKey({ layoutPreset: 'compactCal' }), 'compactCal');
  assert.strictEqual(vc.resolvePresetKey({ layoutPreset: 'compactDense' }), 'compactDense');
  assert.strictEqual(vc.resolvePresetKey({ layoutPreset: 'noCal' }), 'noCal');
});

test('resolvePresetKey migrates legacy layoutPreset values', () => {
  assert.strictEqual(vc.resolvePresetKey({ layoutPreset: 'classic' }), 'compactCal');
  assert.strictEqual(vc.resolvePresetKey({ layoutPreset: 'forecast' }), 'noCal');
  assert.strictEqual(vc.resolvePresetKey({ layoutPreset: 'radarLast' }), 'compactCal');
  assert.strictEqual(vc.resolvePresetKey({ layoutPreset: 'healthFirst' }), 'compactCal');
});

test('resolvePresetKey migrates pre-preset installs (topViewMode only)', () => {
  assert.strictEqual(vc.resolvePresetKey({ topViewMode: 'full' }), 'fullCal');
  assert.strictEqual(vc.resolvePresetKey({ topViewMode: 'none' }), 'noCal');
  assert.strictEqual(vc.resolvePresetKey({}), 'compactCal');
});

test("radar 'countdown' mode uses the same cycle as 'off' (no radar flick view)", () => {
  ['fullCal', 'compactCal', 'compactDense', 'noCal'].forEach((p) => {
    ['off', 'status', 'all'].forEach((h) => {
      assert.deepStrictEqual(bytes(p, h, 'countdown'), bytes(p, h, 'off'),
        p + '/' + h + ": 'countdown' must match 'off'");
    });
  });
});

test('packSpec/unpackSpec round-trips the 10-bit positional status', () => {
  const cases = [
    vc.spec(vc.TIER_COMPACT, vc.TOP_CAL, vc.BODY_FC, vc.STATUS_SRC_FORECAST, vc.STATUS_SRC_NONE),
    vc.spec(vc.TIER_COMPACT, vc.TOP_CAL, vc.BODY_FC, vc.STATUS_SRC_HEALTH, vc.STATUS_SRC_FORECAST),
    vc.spec(vc.TIER_COMPACT, vc.TOP_CAL, vc.BODY_FC, vc.STATUS_SRC_RADAR, vc.STATUS_SRC_FORECAST),
    vc.spec(vc.TIER_NONE, vc.TOP_EMPTY, vc.BODY_RADAR, vc.STATUS_SRC_RADAR, vc.STATUS_SRC_NONE),
    vc.spec(vc.TIER_FULL, vc.TOP_CAL, vc.BODY_GRAPH, vc.STATUS_SRC_HEALTH, vc.STATUS_SRC_NONE),
  ];
  cases.forEach((s) => assert.deepEqual(vc.unpackSpec(vc.packSpec(s)), s));
});

test('packSpec fits in 10 bits and 0 decodes to null (disabled slot)', () => {
  assert.ok(vc.packSpec(vc.spec(vc.TIER_FULL, vc.TOP_RADAR, vc.BODY_RADAR,
    vc.STATUS_SRC_HEALTH, vc.STATUS_SRC_FORECAST)) < 1024);
  assert.equal(vc.unpackSpec(0), null);
  assert.equal(vc.packSpec(null), 0);
});
