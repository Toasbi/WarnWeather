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
