// test/flick-presets.test.js
// The Layout preset compiles (preset x healthMode x radarEnabled) to CLAY_VIEW_0/1/2
// packed ViewSpec bytes via view-cycle.js. Packed-byte format & values: see view-cycle.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');

global.localStorage = { getItem: function () { return null; }, setItem: function () {}, removeItem: function () {} };

const { buildClayPayload } = require('../src/pkjs/clay-payload.js');

function views(settings) {
  const p = buildClayPayload(settings, null, new Date(0));
  return [p.CLAY_VIEW_0, p.CLAY_VIEW_1, p.CLAY_VIEW_2];
}

test('compactCal default (off/no-radar) → [CAL2·FC·W, off, off]', () => {
  assert.deepStrictEqual(views({ layoutPreset: 'compactCal', radarProvider: 'disabled' }), [0x90, 0, 0]);
});

test('compactCal all + radar → packed 3-stop cycle', () => {
  assert.deepStrictEqual(views({ layoutPreset: 'compactCal', healthMode: 'all', radarProvider: 'dwd' }),
    [0xD0, 0x45, 0x48]);
});

test('compactDense status → dual default, single flick', () => {
  assert.deepStrictEqual(views({ layoutPreset: 'compactDense', healthMode: 'status', radarProvider: 'disabled' }),
    [0x92, 0, 0]);
});

test('fullCal status + radar', () => {
  assert.deepStrictEqual(views({ layoutPreset: 'fullCal', healthMode: 'status', radarProvider: 'dwd' }),
    [0xD0, 0x92, 0xE0]);
});

test('legacy layoutPreset migrates (classic → compactCal)', () => {
  assert.deepStrictEqual(views({ layoutPreset: 'classic', radarProvider: 'dwd' }), [0x90, 0x98, 0]);
});

test('legacy pre-preset topViewMode=none → noCal', () => {
  assert.deepStrictEqual(views({ topViewMode: 'none', radarProvider: 'disabled' }), [0x40, 0, 0]);
});

test('viewResetMin maps straight through', () => {
  const p = buildClayPayload({ layoutPreset: 'compactCal', viewResetMin: '5' }, null, new Date(0));
  assert.strictEqual(p.CLAY_VIEW_RESET_MIN, 5);
});

test('no CLAY_DUAL_STATUS key is emitted', () => {
  const p = buildClayPayload({ layoutPreset: 'compactDense', healthMode: 'status' }, null, new Date(0));
  assert.strictEqual(Object.prototype.hasOwnProperty.call(p, 'CLAY_DUAL_STATUS'), false);
});
