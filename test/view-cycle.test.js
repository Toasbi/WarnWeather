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

test('a dormant compactDense (no status row makes it dense) compiles as compactCal, swap included', () => {
  // The settings page shows it as Compact calendar with the swap toggle; the watch must agree.
  [['off', 'off'], ['slot', 'countdown'], ['off', 'countdown'], ['slot', 'off']].forEach(([h, r]) => {
    assert.deepEqual(vc.buildViewCycle('compactDense', h, r, true), vc.buildViewCycle('compactCal', h, r, true), h + '/' + r);
  });
  const swapped = vc.buildViewCycle('compactDense', 'off', 'off', true);
  assert.equal(lo(swapped[0]), vc.STATUS_SRC_FORECAST, 'the forecast row moved below the clock');
  // An ACTIVE dense preset has no single row to swap and ignores the toggle, as before.
  assert.deepEqual(vc.buildViewCycle('compactDense', 'status', 'off', true),
    vc.buildViewCycle('compactDense', 'status', 'off', false));
  assert.deepEqual(vc.buildViewCycle('compactDense', 'off', 'graph', true),
    vc.buildViewCycle('compactDense', 'off', 'graph', false));
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

test("resolvePresetKey folds 'custom' to the EXPLICIT compactCal — legacy topViewMode must not redirect it", () => {
  assert.strictEqual(vc.resolvePresetKey({ layoutPreset: 'custom' }), 'compactCal');
  assert.strictEqual(vc.resolvePresetKey({ layoutPreset: 'custom', topViewMode: 'full' }), 'compactCal');
  assert.strictEqual(vc.resolvePresetKey({ layoutPreset: 'custom', topViewMode: 'none' }), 'compactCal');
});

test('seedCustomKeys copies the leaving preset once and latches; preset re-picks leave keys dormant', () => {
  const S = { healthMode: 'status', radarMode: 'graph', swapClockStatus: false, layoutPreset: 'custom' };
  vc.seedCustomKeys(S, 'fullCal');
  assert.equal(S.customLayoutSeeded, true);
  assert.equal(S.viewCount, '3', 'fullCal+status+graph compiles a 3-view cycle');
  assert.equal(S.viewTop0, 'cal', 'the calendar is one choice...');
  assert.equal(S.viewTopSize0, '3', '...its rows are the size');
  // Seeded keys compile back byte-identical to the preset cycle (zero-transmit).
  const preset = vc.buildViewCycle('fullCal', 'status', 'graph', false).map(vc.packSpec);
  assert.deepStrictEqual(vc.buildCustomCycle(S).map(vc.packSpec), preset);
  // Latched: a second entry (after the user customized) must NOT re-seed.
  S.viewTop0 = 'none';
  vc.seedCustomKeys(S, 'compactCal');
  assert.equal(S.viewTop0, 'none', 'custom work survives re-entering Custom');
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
// transform, may ever set bits 10-31 of the wire word (the custom bits of the low
// half, or anything in the ext half) — presets must pack byte-identically to
// pre-custom builds so upgrades transmit nothing.
test('presets never carry the custom bits or an ext word (full matrix sweep)', () => {
  ['fullCal', 'compactCal', 'compactDense', 'noCal'].forEach((p) =>
    ['off', 'slot', 'status', 'all'].forEach((h) =>
      ['off', 'countdown', 'status', 'graph'].forEach((r) =>
        [false, true].forEach((sw) => {
          vc.buildViewCycle(p, h, r, sw).forEach((s) => {
            const w = vc.packWire(s);
            assert.equal(w >>> 10, 0,
              p + '/' + h + '/' + r + '/' + sw + ' leaked custom bits: 0x' + w.toString(16));
            assert.equal(w, vc.packSpec(s), 'a preset wire word is its 16-bit packSpec');
          });
        }))));
});

// isStacked is the watch's ORDER rule (layout.c spec_is_stacked), shared by the preview
// and the editor's band list: an explicit order OR a removed chrome band draws the order
// code literally; anything else draws its tier's legacy order.
test('isStacked mirrors the watch order rule: order >= 1 or a removed clock/top bar', () => {
  const base = vc.spec(vc.TIER_FULL, vc.TOP_CAL, vc.BODY_FC, vc.STATUS_SRC_FORECAST, vc.STATUS_SRC_NONE);
  assert.equal(vc.isStacked(null), false, 'a disabled slot');
  assert.equal(vc.isStacked(base), false, 'order 0 with full chrome keeps its tier\'s legacy order');
  assert.equal(vc.isStacked(Object.assign(vc.cloneSpec(base), { clockOff: true })), true);
  assert.equal(vc.isStacked(Object.assign(vc.cloneSpec(base), { stripOff: true })), true);
  for (let code = 1; code <= 11; code++) {
    assert.equal(vc.isStacked(Object.assign(vc.cloneSpec(base), { order: code })), true, 'order ' + code);
  }
  ['fullCal', 'compactCal', 'compactDense', 'noCal'].forEach((p) =>
    ['off', 'slot', 'status', 'all'].forEach((h) =>
      ['off', 'countdown', 'status', 'graph'].forEach((r) =>
        [false, true].forEach((sw) => vc.buildViewCycle(p, h, r, sw).forEach((s) =>
          assert.equal(vc.isStacked(s), false, p + '/' + h + '/' + r + '/' + sw))))));
});

// ── Custom compiler (buildCustomCycle / specToKeys) ──────────────────────────

// THE upgrade-safety proof: entering Custom seeds the per-view keys from the compiled
// preset cycle, and an untouched Custom session must compile back to BYTE-IDENTICAL
// packed values — so the change-detector transmits nothing on mode entry.
test('specToKeys ∘ buildViewCycle round-trips byte-identical for every preset cell', () => {
  ['fullCal', 'compactCal', 'compactDense', 'noCal'].forEach((p) =>
    ['off', 'slot', 'status', 'all'].forEach((h) =>
      ['off', 'countdown', 'status', 'graph'].forEach((r) =>
        [false, true].forEach((sw) => {
          const cycle = vc.buildViewCycle(p, h, r, sw);
          const S = Object.assign({ healthMode: h, radarMode: r }, vc.specToKeys(cycle));
          const rebuilt = vc.buildCustomCycle(S);
          assert.deepStrictEqual(rebuilt.map(vc.packWire), cycle.map(vc.packWire),
            p + '/' + h + '/' + r + '/' + sw);
          assert.deepStrictEqual(rebuilt.map(vc.packWire), cycle.map(vc.packSpec),
            'an untouched Custom session sends no ext word');
        }))));
});

test('buildCustomCycle: slot 0 never drops its clock, but may drop its top bar; flicks both', () => {
  const S = {
    viewCount: '2', healthMode: 'off', radarMode: 'off',
    viewTop0: 'cal2', viewBody0: 'forecast', viewUpper0: 'weather', viewLower0: 'off', viewOrder0: 'TACB',
    viewTop1: 'none', viewBody1: 'forecast', viewUpper1: 'off', viewLower1: 'off', viewOrder1: 'TACB',
    viewClockOff0: true,   // hostile: the Default view always shows the time
    viewStripOff0: true,
    viewClockOff1: true, viewStripOff1: true,
  };
  const views = vc.buildCustomCycle(S);
  const packed = views.map(vc.packSpec);
  assert.equal(packed[0] & 0x400, 0, 'default view keeps its clock');
  assert.equal(packed[0] & 0x800, 0x800, 'default view may drop its top bar');
  assert.equal(packed[1] & 0xC00, 0xC00, 'flick view carries both flags');
  // specToKeys writes the Default view's top-bar key back, and never a clock key.
  const keys = vc.specToKeys(views);
  assert.equal(keys.viewStripOff0, true);
  assert.equal(keys.viewClockOff0, undefined);
  assert.equal(vc.specToKeys(vc.buildCustomCycle(Object.assign({}, S, { viewStripOff0: false }))).viewStripOff0, false);
});

test('buildCustomCycle: capability folds mirror the watch resolve', () => {
  const base = {
    viewCount: '1',
    viewTop0: 'radar', viewBody0: 'radar', viewUpper0: 'radar', viewLower0: 'health',
    viewOrder0: 'TACB',
  };
  // radarMode 'status': chart seats fold (top->cal3, body->forecast), the radar ROW stays.
  let c = vc.buildCustomCycle(Object.assign({ radarMode: 'status', healthMode: 'all' }, base));
  assert.equal(c[0].top, vc.TOP_CAL);
  assert.equal(c[0].tier, vc.TIER_FULL);
  assert.equal(c[0].body, vc.BODY_FC);
  assert.equal(c[0].statusUpper, vc.STATUS_SRC_RADAR);
  assert.equal(c[0].statusLower, vc.STATUS_SRC_HEALTH);
  // radarMode 'countdown': the radar row folds too; healthMode 'slot' folds health rows.
  c = vc.buildCustomCycle(Object.assign({ radarMode: 'countdown', healthMode: 'slot' }, base));
  assert.equal(c[0].statusUpper, vc.STATUS_SRC_NONE);
  assert.equal(c[0].statusLower, vc.STATUS_SRC_NONE);
  // healthMode 'status': health graph body folds to forecast, health row survives.
  c = vc.buildCustomCycle({
    viewCount: '1', radarMode: 'off', healthMode: 'status',
    viewTop0: 'cal2', viewBody0: 'health', viewUpper0: 'health', viewLower0: 'off', viewOrder0: 'TACB',
  });
  assert.equal(c[0].body, vc.BODY_FC);
  assert.equal(c[0].statusUpper, vc.STATUS_SRC_HEALTH);
});

test('buildCustomCycle: fold-promote only under the legacy order', () => {
  const mk = (order) => ({
    viewCount: '1', radarMode: 'off', healthMode: 'off',
    viewTop0: 'cal2', viewBody0: 'forecast',
    viewUpper0: 'radar', viewLower0: 'weather', viewOrder0: order,
  });
  // Legacy order: folded upper promotes the surviving lower (dense degradation).
  const legacy = vc.buildCustomCycle(mk('TACB'))[0];
  assert.equal(legacy.statusUpper, vc.STATUS_SRC_FORECAST);
  assert.equal(legacy.statusLower, vc.STATUS_SRC_NONE);
  assert.ok(!('order' in legacy));
  // Stacked order: seats are user-placed positions — the survivor stays put.
  const stacked = vc.buildCustomCycle(mk('ATBC'))[0];
  assert.equal(stacked.statusUpper, vc.STATUS_SRC_NONE);
  assert.equal(stacked.statusLower, vc.STATUS_SRC_FORECAST);
  assert.equal(stacked.order, vc.orderCode('ATBC'));
});

test('buildCustomCycle: viewCount clamps and absent keys fall back sanely', () => {
  assert.equal(vc.buildCustomCycle({ viewCount: '9', radarMode: 'off', healthMode: 'off' }).length, 1);
  const c = vc.buildCustomCycle({ viewCount: '1', radarMode: 'off', healthMode: 'off' });
  assert.equal(c[0].tier, vc.TIER_COMPACT, 'default top is the 2-row calendar');
  assert.equal(c[0].body, vc.BODY_FC);
  assert.equal(c[0].statusUpper, vc.STATUS_SRC_NONE);
});

// The canonical order table must stay in lockstep with src/c/windows/layout.c's
// STACK_ORDER (the C side pins the same list through rendered band order in
// test/c/layout_test.c stacked_order_parity). Code 0 = legacy; codes 1-11 = stacker.
test('STACK_ORDERS matches the documented canonical list, code 0 is legacy', () => {
  assert.deepStrictEqual(vc.STACK_ORDERS, [
    'TACB', 'TCAB', 'TABC', 'CTAB', 'CATB', 'CABT',
    'ATCB', 'ATBC', 'ACTB', 'ACBT', 'ABTC', 'ABCT',
  ]);
  // Every entry: a permutation of TCAB with A before B (canonical form).
  vc.STACK_ORDERS.forEach((s) => {
    assert.deepStrictEqual(s.split('').sort(), ['A', 'B', 'C', 'T'], s);
    assert.ok(s.indexOf('A') < s.indexOf('B'), s + ': A must render above B');
  });
  assert.equal(vc.orderCode('TACB'), 0);
  assert.equal(vc.orderCode('CTAB'), 3);
  assert.equal(vc.orderCode('ABCT'), 11);
  assert.equal(vc.orderCode('BACT'), 0, 'non-canonical input falls back to legacy');
  assert.equal(vc.orderCode('nope'), 0);
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

  // ...and the ext word's fields ride every clone too.
  const ext = Object.assign(vc.spec(vc.TIER_NONE, vc.TOP_GRAPH, vc.BODY_RADAR,
    vc.STATUS_SRC_FORECAST, vc.STATUS_SRC_NONE), { topKind: 1, topSize: 3, bodySize: 1, align: 2 });
  assert.deepEqual(vc.cloneSpec(ext), ext);
  const extDemoted = vc.demoteRadarBody(ext);
  assert.deepEqual([extDemoted.topKind, extDemoted.topSize, extDemoted.bodySize, extDemoted.align],
    [1, 3, 1, 2]);
});

// ── Graphless views + Position (custom compiler) ────────────────────────────

/**
 * A one-view custom state.
 * @param {Object} over key overrides
 * @returns {Object} settings state
 */
function customState(over) {
  return Object.assign({
    layoutPreset: 'custom', healthMode: 'off', radarMode: 'graph', viewCount: '1',
    viewTop0: 'cal2', viewBody0: 'forecast', viewUpper0: 'weather', viewLower0: 'off',
    viewOrder0: 'TACB', viewTopSize0: '3', viewBodySize0: 'fill', viewAlign0: 'clock'
  }, over || {});
}

test('specToKeys emits the three new keys per view at their defaults for presets', () => {
  const keys = vc.specToKeys(vc.buildViewCycle('fullCal', 'all', 'graph', false));
  for (let i = 0; i < 3; i++) {
    assert.equal(keys['viewTopSize' + i], '3');
    assert.equal(keys['viewBodySize' + i], 'fill');
    assert.equal(keys['viewAlign' + i], 'clock');
  }
});

test("viewBody 'none' compiles to BODY_NONE and carries its Position", () => {
  const c = vc.buildCustomCycle(customState({ viewBody0: 'none', viewAlign0: 'bottom' }));
  assert.equal(c[0].body, vc.BODY_NONE);
  assert.equal(c[0].align, vc.ALIGN_BOTTOM);
  assert.equal(vc.isStacked(c[0]), true, 'the watch stacks a graphless view');
  assert.equal(vc.packWire(c[0]) >>> 16, 3 << 7, 'align rides the ext word');
  // the Default view may drop its graph too (decided); Clock centred is code 0
  const d = vc.buildCustomCycle(customState({ viewBody0: 'none' }))[0];
  assert.equal(d.body, vc.BODY_NONE);
  assert.ok(!('align' in d), 'Clock centred is the default → absent (canonical)');
  assert.equal(vc.packWire(d), vc.packSpec(d));
});

test('Position is dropped while the graph fills (the watch would ignore it)', () => {
  const c = vc.buildCustomCycle(customState({ viewAlign0: 'bottom' }))[0];
  assert.ok(!('align' in c));
  assert.equal(vc.packWire(c), vc.packSpec(c));
  const bad = vc.buildCustomCycle(customState({ viewBody0: 'none', viewAlign0: 'sideways' }))[0];
  assert.ok(!('align' in bad), 'an unknown Position falls back to the default');
});

test('keys → spec → keys round-trips a graphless view', () => {
  const S = customState({ viewCount: '2', viewTop1: 'none', viewBody1: 'none', viewUpper1: 'weather',
    viewLower1: 'off', viewOrder1: 'TACB', viewClockOff1: false, viewStripOff1: true,
    viewTopSize1: '3', viewBodySize1: 'fill', viewAlign1: 'center' });
  const cycle = vc.buildCustomCycle(S);
  const keys = vc.specToKeys(cycle);
  assert.equal(keys.viewBody1, 'none');
  assert.equal(keys.viewAlign1, 'center');
  const again = vc.buildCustomCycle(Object.assign({}, S, keys));
  assert.deepStrictEqual(again.map(vc.packWire), cycle.map(vc.packWire));
});

test('a flick left with nothing on it compiles to a disabled slot', () => {
  // Flick 1's only element is a Health status bar; switching health off folds it away.
  const S = customState({ viewCount: '2', viewTop1: 'none', viewBody1: 'none', viewUpper1: 'health',
    viewLower1: 'off', viewOrder1: 'TACB', viewClockOff1: true, viewStripOff1: false });
  S.healthMode = 'status';
  assert.notEqual(vc.buildCustomCycle(S)[1], null, 'the health row shows');
  S.healthMode = 'off';
  const cycle = vc.buildCustomCycle(S);
  assert.equal(cycle.length, 2);
  assert.equal(cycle[1], null, 'nothing left → disabled');
  assert.equal(vc.packWire(cycle[1]), 0, 'sent as 0: the watch skips the slot');
  // A lone clock, or a lone graph, is still a view.
  S.viewClockOff1 = false;
  assert.notEqual(vc.buildCustomCycle(S)[1], null);
  S.viewClockOff1 = true; S.viewBody1 = 'forecast';
  assert.notEqual(vc.buildCustomCycle(S)[1], null);
});

test('a blob that predates the new keys compiles to ext 0 (the upgrade path)', () => {
  ['fullCal', 'compactCal', 'compactDense', 'noCal'].forEach((p) => {
    const S = { layoutPreset: 'custom', healthMode: 'all', radarMode: 'graph' };
    vc.seedCustomKeys(S, p);
    for (let i = 0; i < 3; i++) {
      delete S['viewTopSize' + i]; delete S['viewBodySize' + i]; delete S['viewAlign' + i];
    }
    vc.buildCustomCycle(S).forEach((s) => assert.equal(vc.packWire(s), vc.packSpec(s), p));
  });
});

// ── Graphs in the top area (Phase 2a) ───────────────────────────────────────

test('a forecast or health graph in the top area compiles to top code 3 at tier NONE, kind in the ext', () => {
  const f = vc.buildCustomCycle(customState({ viewTop0: 'forecast', viewBody0: 'health', healthMode: 'all' }))[0];
  assert.equal(f.top, vc.TOP_GRAPH);
  assert.equal(f.tier, vc.TIER_NONE, 'no calendar rows: full date, large-font rows');
  assert.ok(!('topKind' in f), 'forecast is kind 0 → absent (canonical)');
  assert.equal(f.body, vc.BODY_GRAPH);
  assert.equal((vc.packWire(f) >> 6) & 3, 3, 'wire top code 3');
  assert.equal(vc.isStacked(f), true);
  const h = vc.buildCustomCycle(customState({ viewTop0: 'health', healthMode: 'all' }))[0];
  assert.equal(h.topKind, vc.TOP_KIND_HEALTH);
  assert.equal((vc.packExt(h) >> 6) & 1, 1, 'ext bit 6 = health');
});

test('top graphs fold by capability and never duplicate the body\'s graph', () => {
  // health top without healthMode 'all' → the top area empties (not a calendar)
  const h = vc.buildCustomCycle(customState({ viewTop0: 'health', healthMode: 'status' }))[0];
  assert.equal(h.top, vc.TOP_EMPTY);
  assert.equal(h.tier, vc.TIER_NONE);
  // the same kind in both seats: the top keeps it
  assert.equal(vc.buildCustomCycle(customState({ viewTop0: 'forecast', viewBody0: 'forecast' }))[0].body,
    vc.BODY_NONE);
  // a body that FOLDS to the forecast under a forecast top goes empty, not a 2nd forecast
  assert.equal(vc.buildCustomCycle(customState({ viewTop0: 'forecast', viewBody0: 'health',
    healthMode: 'off' }))[0].body, vc.BODY_NONE);
  assert.equal(vc.buildCustomCycle(customState({ viewTop0: 'forecast', viewBody0: 'radar',
    radarMode: 'status' }))[0].body, vc.BODY_NONE);
  // a health top with a forecast body is the two-graph view
  const two = vc.buildCustomCycle(customState({ viewTop0: 'health', viewBody0: 'forecast', healthMode: 'all' }))[0];
  assert.equal(two.top, vc.TOP_GRAPH);
  assert.equal(two.body, vc.BODY_FC);
});

test('keys → spec → keys round-trips both top graphs', () => {
  ['forecast', 'health'].forEach((top) => {
    const S = customState({ viewTop0: top, viewBody0: top === 'forecast' ? 'health' : 'forecast',
      healthMode: 'all' });
    const cycle = vc.buildCustomCycle(S);
    const keys = vc.specToKeys(cycle);
    assert.equal(keys.viewTop0, top);
    assert.deepStrictEqual(vc.buildCustomCycle(Object.assign({}, S, keys)).map(vc.packWire),
      cycle.map(vc.packWire));
  });
});

// ── Sizes (Phase 2b) ─────────────────────────────────────────────────────────

test('sizes compile to canonical codes: seat defaults absent, forecast never 2 rows, one fill', () => {
  const top = (over) => vc.buildCustomCycle(customState(Object.assign({ healthMode: 'all', radarMode: 'graph' }, over)))[0];
  assert.equal(top({ viewTop0: 'radar', viewTopSize0: '4' }).topSize, vc.SIZE_4);
  assert.equal(top({ viewTop0: 'health', viewTopSize0: '2' }).topSize, vc.SIZE_2, 'health may take 2 rows');
  assert.ok(!('topSize' in top({ viewTop0: 'forecast', viewTopSize0: '2', viewBody0: 'health' })),
    'a forecast top asked for 2 rows compiles to 3 = its default');
  assert.equal(top({ viewBodySize0: '2' }).bodySize, vc.SIZE_3, 'a forecast body: 2 → 3 rows');
  assert.equal(top({ viewBody0: 'health', viewBodySize0: '2' }).bodySize, vc.SIZE_2);
  assert.ok(!('topSize' in top({ viewTop0: 'cal3', viewTopSize0: '2' })), 'a stale size on a calendar top → 0');
  assert.ok(!('bodySize' in top({ viewBody0: 'none', viewBodySize0: '4' })), 'no body, no size');
  assert.ok(!('bodySize' in top({ viewBodySize0: 'fill' })), 'fill is the body default');
  const both = top({ viewTop0: 'radar', viewTopSize0: 'fill', viewBodySize0: 'fill' });
  assert.ok(!('topSize' in both), 'both fill → the body fills, the top takes its 3-row default');
  const fillTop = top({ viewTop0: 'radar', viewTopSize0: 'fill', viewBodySize0: '3', viewAlign0: 'bottom' });
  assert.equal(fillTop.topSize, vc.SIZE_FILL);
  assert.ok(!('align' in fillTop), 'the top fills: no alignment');
  const sized = top({ viewBodySize0: '3', viewAlign0: 'bottom' });
  assert.equal(sized.align, vc.ALIGN_BOTTOM, 'a sized body leaves slack: alignment applies');
  assert.equal(vc.isStacked(sized), true);
});

test('stackFits mirrors the watch arithmetic (spec cases, both screen families)', () => {
  const view = (over) => vc.buildCustomCycle(customState(Object.assign({ healthMode: 'all',
    radarMode: 'graph', viewOrder0: 'TCAB' }, over)))[0];
  const B = view({ viewTop0: 'cal2', viewBody0: 'none' });
  const C = view({ viewTop0: 'health', viewBody0: 'forecast' });
  const D = view({ viewTop0: 'forecast', viewTopSize0: '4', viewBody0: 'health' });
  const cal3 = view({ viewTop0: 'cal3', viewBody0: 'forecast' });
  const over = view({ viewTop0: 'forecast', viewTopSize0: '4', viewBody0: 'health', viewBodySize0: '4',
    viewLower0: 'radar' });
  [B, C, cal3].forEach((s) => {
    assert.deepEqual(vc.stackFits(s, 'basalt'), { fits: true, over: 0 });
    assert.deepEqual(vc.stackFits(s, 'emery'), { fits: true, over: 0 });
    assert.equal(vc.stackFits(s, '').fits, true);
  });
  // D + a row fits on the fullCal seats: 60 + 45 + 14 (the row rests on the graph in the
  // reserve) + a 2-row fill floor = 149 of 155 (emery 194 of 202).
  assert.deepEqual(vc.stackFits(D, 'basalt'), { fits: true, over: 0 });
  assert.deepEqual(vc.stackFits(D, 'emery'), { fits: true, over: 0 });
  // ...a second row does not: 169 of 155, 214 of 202; an unknown watch takes the worse.
  const D2 = view({ viewTop0: 'forecast', viewTopSize0: '4', viewBody0: 'health', viewLower0: 'radar' });
  assert.deepEqual(vc.stackFits(D2, 'basalt'), { fits: false, over: 14 });
  assert.deepEqual(vc.stackFits(D2, 'emery'), { fits: false, over: 12 });
  assert.deepEqual(vc.stackFits(D2, ''), { fits: false, over: 14 });
  // The C golden's overflow clamp (sz10): 4-row top + clock + two rows + 4-row body →
  // the body gets 16 of its 60 px on the 144 px watch = 44 px too tall.
  assert.equal(vc.stackFits(over, 'basalt').over, 44);
  assert.deepEqual(vc.stackFits(null, 'emery'), { fits: true, over: 0 });
});

test('stackFits: legacy-order views always fit; the watch\'s no-data fallbacks are budgeted', () => {
  const view = (over) => vc.buildCustomCycle(customState(Object.assign({ healthMode: 'all',
    radarMode: 'graph' }, over)))[0];
  // cal3 + two status bars at the legacy order, graph filling: the watch draws it
  // with a 31 px graph and cuts nothing (it used to read "too tall by 8 px").
  const legacy = view({ viewTop0: 'cal3', viewLower0: 'health' });
  assert.equal(vc.isStacked(legacy), false);
  ['basalt', 'emery', ''].forEach((p) => assert.deepEqual(vc.stackFits(legacy, p), { fits: true, over: 0 }));
  // The budget is exact: every data state laid out as the watch folds it (resolveForFit).
  // A 2-row radar top + weather/radar rows + a 2-row health graph needs 150 of 155 with all
  // data, but without health the graph becomes a 3-row forecast: 165 — refused.
  const h2 = view({ viewTop0: 'radar', viewTopSize0: '2', viewBody0: 'health', viewBodySize0: '2',
    viewLower0: 'radar', viewOrder0: 'TABC' });
  assert.equal(vc.stackNeed(vc.resolveForFit(h2, true, true), 0).need, 150);
  assert.equal(vc.stackNeed(vc.resolveForFit(h2, true, false), 0).need, 165);
  assert.deepEqual(vc.stackFits(h2, 'basalt'), { fits: false, over: 10 });
  // ...while a view whose outage also DROPS a band is not over-budgeted: cal3 + a weather
  // and a health row over a 2-row health graph loses the health row with the data (149 /
  // 150 of 155 in every state) and fits — it used to be refused by an additive budget.
  const fitsAll = view({ viewTop0: 'cal3', viewBody0: 'health', viewBodySize0: '2',
    viewLower0: 'health', viewOrder0: 'TACB' });
  assert.deepEqual(vc.stackFits(fitsAll, 'basalt'), { fits: true, over: 0 });
  // A filling radar top folds to the calendar without radar data (the watch's
  // CALENDAR fold): 150 as the calendar, 151 at the radar's fill floor — it fits both ways.
  const rf = view({ viewTop0: 'radar', viewTopSize0: 'fill', viewBodySize0: '4', viewUpper0: 'off',
    viewLower0: 'radar', viewOrder0: 'TCAB' });
  assert.equal(vc.resolveForFit(rf, false, true).top, vc.TOP_CAL);
  assert.equal(vc.stackNeed(vc.resolveForFit(rf, false, true), 0).need, 150);
  assert.equal(vc.stackNeed(vc.resolveForFit(rf, true, true), 0).need, 151);
  assert.deepEqual(vc.stackFits(rf, 'basalt'), { fits: true, over: 0 });
  // Every state of every sizable shape is checked against the watch itself by
  // scripts/check-fit-lockstep.js (run from scripts/test-c.sh).
});

test('a 2-row radar top without the radar chart compiles to the 2-row calendar (same height)', () => {
  const c = vc.buildCustomCycle(customState({ viewTop0: 'radar', viewTopSize0: '2', radarMode: 'status' }))[0];
  assert.equal(c.top, vc.TOP_CAL);
  assert.equal(c.tier, vc.TIER_COMPACT);
  const c4 = vc.buildCustomCycle(customState({ viewTop0: 'radar', viewTopSize0: '4', radarMode: 'status' }))[0];
  assert.equal(c4.tier, vc.TIER_FULL);
});

test('the fit table is the C engine\'s geometry', () => {
  const P = vc.FIT_PX;
  [0, 1].forEach((f) => {
    assert.equal(P.cal2[f], 2 * P.row[f], 'cal2 = 2 rows');
    assert.equal(P.cal3[f], 3 * P.row[f], 'cal3 = 3 rows');
    assert.equal(P.clock[f], P.cal3[f], 'the clock band = the 3-row calendar (45 : 45 weights)');
  });
  assert.deepEqual([P.availStrip[0], P.availNoStrip[0]], [168 - 13, 168 - 0], '144: floor - cursor start');
  assert.deepEqual([P.availStrip[1], P.availNoStrip[1]], [224 - 22, 224 - 2], 'emery: floor - cursor start');
  assert.equal(P.tail, undefined, 'N-row bands carry the graph tail inside their rows');
  assert.deepEqual(P.statusLarge, [17, 21], 'STATUS_LARGE_BAND_H');
  assert.deepEqual(P.gap, [3, 1], 'STATUS_FORECAST_CLEARANCE');
  assert.deepEqual(P.reserve, [14, 14], 'WEATHER_STATUS_HEIGHT (fullCal row slot)');
  assert.deepEqual(P.noneRow, [22, 30], 'NONE_STATUS_HEIGHT');
  assert.deepEqual(P.slide, [2, 1], 'the calendar seat on the strip ink, minus the reserve');
  // Every number is also checked shape by shape against the C engine:
  // scripts/check-fit-lockstep.js (run by scripts/test-c.sh).
});

// ── The ext word (high half of CLAY_VIEW_n) ──────────────────────────────────

/**
 * A custom spec with the given ext fields on a stripless compact base.
 * @param {Object} over spec overrides
 * @returns {Object} spec
 */
function extSpec(over) {
  return Object.assign(vc.spec(vc.TIER_COMPACT, vc.TOP_CAL, vc.BODY_FC,
    vc.STATUS_SRC_FORECAST, vc.STATUS_SRC_NONE), over);
}

test('packExt bit layout: bodySize 0-2, topSize 3-5, topKind 6, align 7-8', () => {
  assert.equal(vc.packExt(null), 0);
  assert.equal(vc.packExt(extSpec({})), 0, 'no fields → 0');
  assert.equal(vc.packExt(extSpec({ bodySize: vc.SIZE_4 })), 3);
  assert.equal(vc.packExt(extSpec({ body: vc.BODY_NONE, align: vc.ALIGN_BOTTOM })), 3 << 7);
  const g = extSpec({ tier: vc.TIER_NONE, top: vc.TOP_GRAPH, topKind: 1, topSize: vc.SIZE_4,
    bodySize: vc.SIZE_2 });
  assert.equal(vc.packExt(g), 1 | (3 << 3) | (1 << 6));
  const all = extSpec({ tier: vc.TIER_NONE, top: vc.TOP_GRAPH, topKind: 1, topSize: vc.SIZE_2,
    body: vc.BODY_NONE, align: vc.ALIGN_CENTER });
  assert.equal(vc.packExt(all), (1 << 3) | (1 << 6) | (2 << 7));
  assert.ok(vc.packExt(all) < 0x8000, 'bit 15 of the ext stays clear');
});

test('packWire = packSpec in the low half + packExt in the high half; unpackWire inverts it', () => {
  const cases = [
    extSpec({}),
    extSpec({ body: vc.BODY_NONE, align: vc.ALIGN_TOP, stripOff: true, order: 11 }),
    extSpec({ tier: vc.TIER_NONE, top: vc.TOP_GRAPH, topKind: 1, topSize: vc.SIZE_FILL,
      body: vc.BODY_NONE, clockOff: true, order: 8 }),
    extSpec({ tier: vc.TIER_FULL, top: vc.TOP_RADAR, topSize: vc.SIZE_2, bodySize: vc.SIZE_4,
      align: vc.ALIGN_BOTTOM }),
  ];
  cases.forEach((s) => {
    const w = vc.packWire(s);
    assert.equal(w & 0xFFFF, vc.packSpec(s));
    assert.equal(Math.floor(w / 65536), vc.packExt(s));
    assert.ok(w >= 0 && w < 0x80000000, 'a positive int32 (bit 31 clear)');
    assert.equal(w >>> 31, 0);
    assert.equal(vc.packWire(vc.unpackWire(w)), w, 'round trip');
  });
  assert.equal(vc.unpackWire(0), null);
  assert.equal(vc.unpackWire(5 << 16), null, 'a zero low half is a disabled slot whatever the ext says');
});

test('the ext packs NORMALISED, exactly as the watch applies it', () => {
  // explicit fill on the body / 3 rows on a top are the seat defaults → 0
  assert.equal(vc.packExt(extSpec({ bodySize: vc.SIZE_FILL })), 0);
  assert.equal(vc.packExt(extSpec({ tier: vc.TIER_FULL, top: vc.TOP_RADAR, topSize: vc.SIZE_3 })), 0);
  // sizes on a calendar top, on an absent body; topKind on a non-graph top → dropped
  assert.equal(vc.packExt(extSpec({ topSize: vc.SIZE_4 })), 0, 'calendar tops take no size');
  assert.equal(vc.packExt(extSpec({ body: vc.BODY_NONE, bodySize: vc.SIZE_4 })) & 7, 0);
  assert.equal(vc.packExt(extSpec({ topKind: 1 })), 0, 'topKind only on a graph top');
  // out-of-range sizes → 0
  assert.equal(vc.packExt(extSpec({ bodySize: 6 })), 0);
  // one fill per view: a fill top under a filling body → the body fills
  const both = extSpec({ tier: vc.TIER_NONE, top: vc.TOP_GRAPH, topSize: vc.SIZE_FILL });
  assert.equal((vc.packExt(both) >> 3) & 7, 0, 'both-fill → the top takes its default');
  // align only while nothing fills
  assert.equal(vc.packExt(extSpec({ align: vc.ALIGN_BOTTOM })), 0, 'the body fills → no align');
  assert.equal(vc.packExt(extSpec({ bodySize: vc.SIZE_2, align: vc.ALIGN_BOTTOM })) >> 7, 3,
    'a sized body leaves slack → align kept');
});

test('hasFill: the default body fills; a sized body or none leaves slack unless the top fills', () => {
  assert.equal(vc.hasFill(extSpec({})), true);
  assert.equal(vc.hasFill(extSpec({ bodySize: vc.SIZE_3 })), false);
  assert.equal(vc.hasFill(extSpec({ body: vc.BODY_NONE })), false);
  assert.equal(vc.hasFill(extSpec({ body: vc.BODY_NONE, tier: vc.TIER_FULL, top: vc.TOP_RADAR,
    topSize: vc.SIZE_FILL })), true);
  assert.equal(vc.hasFill(extSpec({ body: vc.BODY_NONE, topSize: vc.SIZE_FILL })), false,
    'a calendar top never fills');
});

test('isStacked covers the new shapes: no body, a top graph, a non-default size', () => {
  assert.equal(vc.isStacked(extSpec({ body: vc.BODY_NONE })), true);
  assert.equal(vc.isStacked(extSpec({ tier: vc.TIER_NONE, top: vc.TOP_GRAPH })), true);
  assert.equal(vc.isStacked(extSpec({ bodySize: vc.SIZE_2 })), true);
  assert.equal(vc.isStacked(extSpec({ tier: vc.TIER_FULL, top: vc.TOP_RADAR, topSize: vc.SIZE_4 })), true);
  // defaults that normalise away do NOT dispatch (the watch applies the same rule)
  assert.equal(vc.isStacked(extSpec({ bodySize: vc.SIZE_FILL })), false);
  assert.equal(vc.isStacked(extSpec({ tier: vc.TIER_FULL, top: vc.TOP_RADAR, topSize: vc.SIZE_3 })), false);
  assert.equal(vc.isStacked(extSpec({ topSize: vc.SIZE_4 })), false, 'a calendar top takes no size');
  assert.equal(vc.isStacked(extSpec({ align: vc.ALIGN_BOTTOM })), false, 'align alone never dispatches');
});

// The capability gate table — THE single source: buildCustomCycle folds by it,
// view-editor.js's freeStatusSource offers by it, and custom-layout-schema.js
// builds its declarative optionDisabledWhen gates from the same arrays.
test('capabilities: mode lists pinned, booleans derived per seat kind', () => {
  assert.deepEqual(vc.RADAR_CHART_MODES, ['graph']);
  assert.deepEqual(vc.RADAR_ROW_MODES, ['status', 'graph']);
  assert.deepEqual(vc.HEALTH_ROW_MODES, ['status', 'all']);
  assert.deepEqual(vc.HEALTH_BODY_MODES, ['all']);
  assert.deepEqual(vc.capabilities({ radarMode: 'graph', healthMode: 'all' }),
    { radarChart: true, radarRow: true, healthRow: true, healthBody: true });
  assert.deepEqual(vc.capabilities({ radarMode: 'status', healthMode: 'status' }),
    { radarChart: false, radarRow: true, healthRow: true, healthBody: false });
  assert.deepEqual(vc.capabilities({ radarMode: 'countdown', healthMode: 'slot' }),
    { radarChart: false, radarRow: false, healthRow: false, healthBody: false },
    'countdown shows no radar view; slot shows health only in the regular bars');
  assert.deepEqual(vc.capabilities({ radarMode: 'off', healthMode: 'off' }),
    { radarChart: false, radarRow: false, healthRow: false, healthBody: false });
  assert.deepEqual(vc.capabilities({}),
    { radarChart: false, radarRow: false, healthRow: false, healthBody: false },
    'absent modes gate closed');
  assert.deepEqual(vc.capabilities(null), vc.capabilities({}), 'null state is safe');
});

test('buildCustomCycle folds seats exactly per capabilities() (spot check)', () => {
  // radarMode 'status': the radar ROW survives, the radar CHART seats fold away.
  const S = {
    viewCount: '1', radarMode: 'status', healthMode: 'off',
    viewTop0: 'radar', viewBody0: 'radar', viewUpper0: 'radar', viewLower0: 'off',
    viewOrder0: 'TACB',
  };
  const s = vc.buildCustomCycle(S)[0];
  assert.equal(s.top, vc.TOP_CAL, 'top radar seat folds to the calendar');
  assert.equal(s.body, vc.BODY_FC, 'radar body folds to the forecast');
  assert.equal(s.statusUpper, vc.STATUS_SRC_RADAR, 'the radar status ROW survives');
});

// "Weather only": the Miami radar-flick look as a preset — no top bar, the rain radar on
// top, clock, weather row, filling graph; health flicks are No calendar's.
test('weatherOnly: no top bar, radar on top, clock then weather row; health flicks from noCal', () => {
  const g = vc.buildViewCycle('weatherOnly', 'off', 'graph');
  assert.equal(g.length, 1, 'the radar is in the Default view: no radar flick');
  assert.equal(g[0].top, vc.TOP_RADAR);
  assert.equal(g[0].tier, vc.TIER_FULL, 'a 3-row radar');
  assert.equal(g[0].stripOff, true, 'no top bar');
  assert.equal(g[0].body, vc.BODY_FC);
  assert.equal(g[0].statusUpper, vc.STATUS_SRC_FORECAST);
  assert.equal(g[0].order, 1, 'drawn literally: radar, clock, weather row (T C A B)');
  assert.equal(vc.packWire(g[0]) >>> 0, 0x1B84, 'the Miami flick view with its top bar off');
  assert.deepEqual(vc.stackFits(g[0], ''), { fits: true, over: 0 });
  // Radar as a status row: no chart, the radar row under the weather row.
  const st = vc.buildViewCycle('weatherOnly', 'off', 'status')[0];
  assert.equal(st.top, vc.TOP_EMPTY);
  assert.deepEqual([st.statusUpper, st.statusLower], [vc.STATUS_SRC_FORECAST, vc.STATUS_SRC_RADAR]);
  assert.equal(st.stripOff, true);
  // No radar view at all: clock, weather row, graph.
  const off = vc.buildViewCycle('weatherOnly', 'off', 'off')[0];
  assert.deepEqual([off.top, off.statusLower, off.stripOff], [vc.TOP_EMPTY, vc.STATUS_SRC_NONE, true]);
  // Health flicks are No calendar's, whatever the radar.
  ['status', 'all'].forEach((h) => {
    const wo = vc.buildViewCycle('weatherOnly', h, 'graph').slice(1).map(vc.packWire);
    const nc = vc.buildViewCycle('noCal', h, 'off').slice(1).map(vc.packWire);
    assert.deepEqual(wo, nc, 'health ' + h);
  });
  assert.equal(vc.resolvePresetKey({ layoutPreset: 'weatherOnly' }), 'weatherOnly');
});
