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

function bytes(presetKey, healthMode, radar) {
  return vc.buildViewCycle(presetKey, healthMode, radar).map(vc.packSpec);
}

test('compactCal cycles', () => {
  assert.deepStrictEqual(bytes('compactCal', 'off', false), [0x90]);                 // CAL2·FC·W
  assert.deepStrictEqual(bytes('compactCal', 'off', true),  [0x90, 0x98]);           // + CAL2·RDR·W
  assert.deepStrictEqual(bytes('compactCal', 'status', false), [0x90, 0x91]);        // + CAL2·FC·H
  assert.deepStrictEqual(bytes('compactCal', 'status', true),  [0x90, 0x91, 0x98]);  // + CAL2·RDR·W (radar in body)
  assert.deepStrictEqual(bytes('compactCal', 'all', false), [0x90, 0x45]);           // + NONE·GRAPH·H
  assert.deepStrictEqual(bytes('compactCal', 'all', true),  [0x90, 0x45, 0x48]);     // CAL2 default, big graph/radar flicks
});

test('compactDense cycles (dual on default when health on)', () => {
  assert.deepStrictEqual(bytes('compactDense', 'off', false), [0x90]);
  assert.deepStrictEqual(bytes('compactDense', 'off', true),  [0x90, 0x98]);
  assert.deepStrictEqual(bytes('compactDense', 'status', false), [0x92]);            // CAL2·FC·D only
  assert.deepStrictEqual(bytes('compactDense', 'status', true),  [0x92, 0x9A]);      // + CAL2·RDR·D (radar in body)
  assert.deepStrictEqual(bytes('compactDense', 'all', false), [0x92, 0x96]);         // + CAL2·GRAPH·D
  assert.deepStrictEqual(bytes('compactDense', 'all', true),  [0x92, 0x96, 0x9A]);   // + CAL2·RDR·D
});

test('fullCal cycles', () => {
  assert.deepStrictEqual(bytes('fullCal', 'off', false), [0xD0]);                    // CAL3·FC·W
  assert.deepStrictEqual(bytes('fullCal', 'off', true),  [0xD0, 0xD8]);              // + CAL3·RDR·W
  assert.deepStrictEqual(bytes('fullCal', 'status', false), [0xD0, 0x92]);           // + CAL2·FC·D
  assert.deepStrictEqual(bytes('fullCal', 'status', true),  [0xD0, 0x92, 0xD8]);     // + CAL3·RDR·W (radar in body)
  assert.deepStrictEqual(bytes('fullCal', 'all', false), [0xD0, 0x45]);              // + NONE·GRAPH·H
  assert.deepStrictEqual(bytes('fullCal', 'all', true),  [0xD0, 0x45, 0x48]);        // + NONE·RDR·W
});

test('noCal cycles (never a calendar)', () => {
  assert.deepStrictEqual(bytes('noCal', 'off', false), [0x40]);                      // NONE·FC·W
  assert.deepStrictEqual(bytes('noCal', 'off', true),  [0x40, 0x48]);
  assert.deepStrictEqual(bytes('noCal', 'status', false), [0x40, 0x41]);             // + NONE·FC·H
  assert.deepStrictEqual(bytes('noCal', 'status', true),  [0x40, 0x41, 0x48]);
  assert.deepStrictEqual(bytes('noCal', 'all', false), [0x40, 0x45]);
  assert.deepStrictEqual(bytes('noCal', 'all', true),  [0x40, 0x45, 0x48]);
});

test("'slot' health mode uses the same cycle as 'off' (no dedicated Health view)", () => {
  ['fullCal', 'compactCal', 'compactDense', 'noCal'].forEach((p) => {
    [false, true].forEach((r) => {
      assert.deepStrictEqual(bytes(p, 'slot', r), bytes(p, 'off', r),
        p + ' radar=' + r + ": 'slot' must match 'off'");
    });
  });
});

test('unknown preset falls back to compactCal', () => {
  assert.deepStrictEqual(bytes('bogus', 'off', false), bytes('compactCal', 'off', false));
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
