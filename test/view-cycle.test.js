// test/view-cycle.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const vc = require('../src/pkjs/view-cycle.js');

test('packSpec encodes tier/top/body/status into one byte', () => {
  assert.strictEqual(vc.packSpec(vc.spec(vc.TIER_COMPACT, vc.TOP_CAL, vc.BODY_FC, vc.ST_W)), 0x90);
  assert.strictEqual(vc.packSpec(vc.spec(vc.TIER_COMPACT, vc.TOP_CAL, vc.BODY_FC, vc.ST_D)), 0x92);
  assert.strictEqual(vc.packSpec(vc.spec(vc.TIER_FULL, vc.TOP_RADAR, vc.BODY_FC, vc.ST_NONE)), 0xE3);
  assert.strictEqual(vc.packSpec(vc.spec(vc.TIER_NONE, vc.TOP_EMPTY, vc.BODY_RADAR, vc.ST_W)), 0x48);
});

test('packSpec of null/off slot is 0', () => {
  assert.strictEqual(vc.packSpec(null), 0);
});

test('unpackSpec round-trips packSpec', () => {
  const s = vc.spec(vc.TIER_FULL, vc.TOP_CAL, vc.BODY_RADAR, vc.ST_W);
  assert.deepStrictEqual(vc.unpackSpec(vc.packSpec(s)), s);
  assert.strictEqual(vc.unpackSpec(0), null);
});

function bytes(presetKey, healthMode, radarMode) {
  return vc.buildViewCycle(presetKey, healthMode, radarMode).map(vc.packSpec);
}

test('compactCal cycles', () => {
  assert.deepStrictEqual(bytes('compactCal', 'off', 'off'), [0x90]);                 // CAL2·FC·W
  assert.deepStrictEqual(bytes('compactCal', 'off', 'graph'),  [0x90, 0x98]);           // + CAL2·RDR·W
  assert.deepStrictEqual(bytes('compactCal', 'status', 'off'), [0x90, 0x91]);        // + CAL2·FC·H
  assert.deepStrictEqual(bytes('compactCal', 'status', 'graph'),  [0x90, 0x91, 0x98]);  // + CAL2·RDR·W (radar in body)
  assert.deepStrictEqual(bytes('compactCal', 'all', 'off'), [0x90, 0x45]);           // + NONE·GRAPH·H
  assert.deepStrictEqual(bytes('compactCal', 'all', 'graph'),  [0x90, 0x45, 0x48]);     // CAL2 default, big graph/radar flicks
});

test('compactDense cycles (dual on default when health on)', () => {
  assert.deepStrictEqual(bytes('compactDense', 'off', 'off'), [0x90]);
  assert.deepStrictEqual(bytes('compactDense', 'off', 'graph'),  [0x90, 0x98]);
  assert.deepStrictEqual(bytes('compactDense', 'status', 'off'), [0x92]);            // CAL2·FC·D only
  assert.deepStrictEqual(bytes('compactDense', 'status', 'graph'),  [0x92, 0x9A]);      // + CAL2·RDR·D (radar in body)
  assert.deepStrictEqual(bytes('compactDense', 'all', 'off'), [0x92, 0x96]);         // + CAL2·GRAPH·D
  assert.deepStrictEqual(bytes('compactDense', 'all', 'graph'),  [0x92, 0x96, 0x9A]);   // + CAL2·RDR·D
});

test('fullCal cycles', () => {
  assert.deepStrictEqual(bytes('fullCal', 'off', 'off'), [0xD0]);                    // CAL3·FC·W
  assert.deepStrictEqual(bytes('fullCal', 'off', 'graph'),  [0xD0, 0xD8]);              // + CAL3·RDR·W
  assert.deepStrictEqual(bytes('fullCal', 'status', 'off'), [0xD0, 0x92]);           // + CAL2·FC·D
  assert.deepStrictEqual(bytes('fullCal', 'status', 'graph'),  [0xD0, 0x92, 0xD8]);     // + CAL3·RDR·W (radar in body)
  assert.deepStrictEqual(bytes('fullCal', 'all', 'off'), [0xD0, 0x45]);              // + NONE·GRAPH·H
  assert.deepStrictEqual(bytes('fullCal', 'all', 'graph'),  [0xD0, 0x45, 0x48]);        // + NONE·RDR·W
});

test('noCal cycles (never a calendar)', () => {
  assert.deepStrictEqual(bytes('noCal', 'off', 'off'), [0x40]);                      // NONE·FC·W
  assert.deepStrictEqual(bytes('noCal', 'off', 'graph'),  [0x40, 0x48]);
  assert.deepStrictEqual(bytes('noCal', 'status', 'off'), [0x40, 0x41]);             // + NONE·FC·H
  assert.deepStrictEqual(bytes('noCal', 'status', 'graph'),  [0x40, 0x41, 0x48]);
  assert.deepStrictEqual(bytes('noCal', 'all', 'off'), [0x40, 0x45]);
  assert.deepStrictEqual(bytes('noCal', 'all', 'graph'),  [0x40, 0x45, 0x48]);
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

test('packSpec/unpackSpec handle BODY_RADAR_STATUS (value 3)', () => {
  const s = vc.spec(vc.TIER_COMPACT, vc.TOP_CAL, vc.BODY_RADAR_STATUS, vc.ST_W);
  assert.strictEqual(vc.packSpec(s), 0x9C);
  assert.deepStrictEqual(vc.unpackSpec(0x9C), s);
});

test("radar 'countdown' mode uses the same cycle as 'off' (no radar flick view)", () => {
  ['fullCal', 'compactCal', 'compactDense', 'noCal'].forEach((p) => {
    ['off', 'status', 'all'].forEach((h) => {
      assert.deepStrictEqual(bytes(p, h, 'countdown'), bytes(p, h, 'off'),
        p + '/' + h + ": 'countdown' must match 'off'");
    });
  });
});

test("radar 'status' mode = the 'graph' cycle with BODY_RADAR -> BODY_RADAR_STATUS (+0x04)", () => {
  assert.deepStrictEqual(bytes('compactCal', 'off', 'status'),    [0x90, 0x9C]);
  assert.deepStrictEqual(bytes('compactCal', 'status', 'status'), [0x90, 0x91, 0x9C]);
  assert.deepStrictEqual(bytes('fullCal', 'off', 'status'),       [0xD0, 0xDC]);
  assert.deepStrictEqual(bytes('compactDense', 'all', 'status'),  [0x92, 0x96, 0x9E]);
  assert.deepStrictEqual(bytes('noCal', 'off', 'status'),         [0x40, 0x4C]);
});
