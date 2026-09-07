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

test('compactDense + radar=graph + health=off: dense default (radar upper, weather lower), radar chart flick stays dense', () => {
  const c = vc.buildViewCycle('compactDense', 'off', 'graph');
  assert.equal(up(c[0]), vc.STATUS_SRC_RADAR, 'dense still shows up with health off');
  assert.equal(lo(c[0]), vc.STATUS_SRC_FORECAST);
  assert.equal(c[0].body, vc.BODY_FC);
  assert.equal(c.length, 2);
  assert.equal(c[1].body, vc.BODY_RADAR);
  // The flick keeps the dense pair: radar row above the clock, forecast row above the chart.
  assert.equal(up(c[1]), vc.STATUS_SRC_RADAR, 'flick keeps the radar upper row');
  assert.equal(lo(c[1]), vc.STATUS_SRC_FORECAST, 'flick keeps the forecast lower row');
});

// fullCal's flick-tier consistency: the default view is ALWAYS the 3-row calendar; once a
// flick drops to the 2-row calendar (the dense health view), every flick does — the radar
// flick must not bounce back to 3 rows between two 2-row neighbours (user report).
test('fullCal + health=status + radar: the radar flick drops to the 2-row dense health+radar view', () => {
  const c = vc.buildViewCycle('fullCal', 'status', 'graph');
  assert.equal(c.length, 3);
  assert.equal(c[0].tier, vc.TIER_FULL, 'default keeps the 3-row calendar');
  assert.equal(c[1].tier, vc.TIER_COMPACT);
  assert.equal(c[2].tier, vc.TIER_COMPACT, 'radar flick matches the health flick tier');
  assert.equal(up(c[2]), vc.STATUS_SRC_HEALTH, 'radar flick keeps the health upper row');
  assert.equal(lo(c[2]), vc.STATUS_SRC_RADAR, 'radar flick carries the radar lower row');
  assert.equal(c[2].body, vc.BODY_RADAR);
  // radarMode=status demotes only the body — rows and tier stay.
  const st = vc.buildViewCycle('fullCal', 'status', 'status');
  assert.equal(st[2].tier, vc.TIER_COMPACT);
  assert.equal(up(st[2]), vc.STATUS_SRC_HEALTH);
  assert.equal(lo(st[2]), vc.STATUS_SRC_RADAR);
  assert.equal(st[2].body, vc.BODY_FC);
});

test('compactDense + radar=graph + health=status: the radar flick stays dense (health upper, radar lower)', () => {
  const c = vc.buildViewCycle('compactDense', 'status', 'graph');
  assert.equal(c.length, 2);
  assert.equal(up(c[1]), vc.STATUS_SRC_HEALTH, 'flick 2 keeps the health upper row');
  assert.equal(lo(c[1]), vc.STATUS_SRC_RADAR, 'flick 2 carries the radar lower row');
  assert.equal(c[1].body, vc.BODY_RADAR, 'graph mode keeps the radar chart body');
  // radarMode=status demotes only the body — the dense rows stay.
  const st = vc.buildViewCycle('compactDense', 'status', 'status');
  assert.equal(up(st[1]), vc.STATUS_SRC_HEALTH);
  assert.equal(lo(st[1]), vc.STATUS_SRC_RADAR);
  assert.equal(st[1].body, vc.BODY_FC);
});

test('compactDense with radar off keeps the no-radar dense cycles intact (health on)', () => {
  const st = vc.buildViewCycle('compactDense', 'status', 'off');
  assert.equal(st.length, 1);
  assert.equal(up(st[0]), vc.STATUS_SRC_HEALTH);
  assert.equal(lo(st[0]), vc.STATUS_SRC_FORECAST);
  const all = vc.buildViewCycle('compactDense', 'all', 'off');
  assert.equal(all.length, 2);
  assert.equal(all[1].body, vc.BODY_GRAPH);
  assert.equal(up(all[1]), vc.STATUS_SRC_HEALTH);
  assert.equal(lo(all[1]), vc.STATUS_SRC_FORECAST);
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

// --- custom-layout wire fields: clockOff (bit 10), stripOff (bit 11), order (bits 12-15) ---

function flagged(clockOff, stripOff, order) {
  const s = vc.spec(vc.TIER_COMPACT, vc.TOP_CAL, vc.BODY_FC,
    vc.STATUS_SRC_FORECAST, vc.STATUS_SRC_NONE);
  if (clockOff) { s.clockOff = true; }
  if (stripOff) { s.stripOff = true; }
  if (order) { s.order = order; }
  return s;
}

test('packSpec places clockOff/stripOff/order in bits 10/11/12-15', () => {
  const base = vc.packSpec(flagged(false, false, 0));
  assert.equal(vc.packSpec(flagged(true, false, 0)), base | 0x400);
  assert.equal(vc.packSpec(flagged(false, true, 0)), base | 0x800);
  assert.equal(vc.packSpec(flagged(false, false, 11)), base | (11 << 12));
  assert.equal(vc.packSpec(flagged(true, true, 15)), base | 0x400 | 0x800 | (15 << 12));
});

test('packSpec/unpackSpec round-trips the custom fields in canonical form', () => {
  [flagged(true, false, 0), flagged(false, true, 0), flagged(true, true, 7),
   flagged(false, false, 11), flagged(true, true, 15)].forEach((s) => {
    assert.deepEqual(vc.unpackSpec(vc.packSpec(s)), s);
  });
  // Unset fields stay ABSENT after a round-trip (canonical form), so legacy
  // 10-bit values decode to exactly the pre-custom spec shape.
  const legacy = vc.unpackSpec(0x244);
  assert.ok(!('clockOff' in legacy) && !('stripOff' in legacy) && !('order' in legacy));
});

test('bit-15 orders pack above 0x7FFF (negative int16 on the wire) without corruption', () => {
  const v = vc.packSpec(flagged(false, false, 8));
  assert.ok(v > 0x7FFF, 'order 8 sets bit 15');
  assert.deepEqual(vc.unpackSpec(v), flagged(false, false, 8));
});

// The upgrade no-op guarantee: NO preset compile, under ANY mode combination or
// transform, may ever set bits 10-15 — presets must pack byte-identically to
// pre-custom builds so upgrades transmit nothing.
test('presets never carry the custom bits (full matrix sweep)', () => {
  ['fullCal', 'compactCal', 'compactDense', 'noCal'].forEach((p) =>
    ['off', 'slot', 'status', 'all'].forEach((h) =>
      ['off', 'countdown', 'status', 'graph'].forEach((r) =>
        [false, true].forEach((sw) => {
          bytes(p, h, r, sw).forEach((v) => {
            assert.equal(v & 0xFC00, 0,
              p + '/' + h + '/' + r + '/' + sw + ' leaked custom bits: 0x' + v.toString(16));
          });
        }))));
});

// Cycle transforms clone specs; a clone via the 5-arg spec() would silently drop
// the custom fields. Pin that every transform's clone path preserves them.
test('transforms preserve clockOff/stripOff/order through their clones', () => {
  // swapUpperToLower's clone path: lone upper row moves down, flags survive.
  const swapIn = flagged(true, true, 5); // lone-upper compact spec + all fields
  const swapped = vc.swapUpperToLower(swapIn);
  assert.notStrictEqual(swapped, swapIn, 'sanity: the transform cloned');
  assert.equal(swapped.statusUpper, vc.STATUS_SRC_NONE);
  assert.equal(swapped.statusLower, vc.STATUS_SRC_FORECAST);
  assert.equal(swapped.clockOff, true);
  assert.equal(swapped.stripOff, true);
  assert.equal(swapped.order, 5);

  // demoteRadarBody's clone path: chart body demotes, flags survive.
  const radar = vc.spec(vc.TIER_COMPACT, vc.TOP_CAL, vc.BODY_RADAR,
    vc.STATUS_SRC_RADAR, vc.STATUS_SRC_FORECAST);
  radar.clockOff = true;
  radar.order = 3;
  const demoted = vc.demoteRadarBody(radar);
  assert.notStrictEqual(demoted, radar, 'sanity: the transform cloned');
  assert.equal(demoted.body, vc.BODY_FC);
  assert.equal(demoted.clockOff, true);
  assert.equal(demoted.order, 3);
  assert.ok(!('stripOff' in demoted), 'unset fields stay absent (canonical form)');

  // cloneSpec itself: independent copy, all fields, canonical absence.
  const cloned = vc.cloneSpec(radar);
  assert.notStrictEqual(cloned, radar);
  assert.deepEqual(cloned, radar);
});
