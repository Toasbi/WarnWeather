// src/pkjs/config-ui/test/range-value.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
// Shared dual-use modules must populate global.PConf before engine.js reads them.
require('../lib/schema-walk.js');
require('../lib/color.js');
require('../lib/show-when.js');
const E = require('../lib/engine.js');

const ITEM = { type: 'range', messageKey: 'hrScale', defaultValue: '40-180',
  min: 30, max: 220, step: 5, minSpan: 50 };

test('parseRange reads a lo-hi string', () => {
  assert.deepEqual(E.parseRange('50-100', ITEM), { lo: 50, hi: 100 });
});

test('parseRange falls back to the item default, then to the bounds', () => {
  assert.deepEqual(E.parseRange(undefined, ITEM), { lo: 40, hi: 180 });
  assert.deepEqual(E.parseRange('garbage', ITEM), { lo: 40, hi: 180 });
  assert.deepEqual(E.parseRange('90', ITEM), { lo: 40, hi: 180 }, 'a single number is not a range');
  const noDefault = { min: 30, max: 220, step: 5, minSpan: 50 };
  assert.deepEqual(E.parseRange('', noDefault), { lo: 30, hi: 220 });
});

test('parseRange rejects an inverted or too-narrow stored pair', () => {
  assert.deepEqual(E.parseRange('95-55', ITEM), { lo: 40, hi: 180 }, 'hi below lo');
  assert.deepEqual(E.parseRange('60-70', ITEM), { lo: 40, hi: 180 }, 'span below minSpan');
});

test('formatRange round-trips parseRange', () => {
  assert.equal(E.formatRange({ lo: 50, hi: 100 }), '50-100');
  assert.deepEqual(E.parseRange(E.formatRange({ lo: 60, hi: 130 }), ITEM), { lo: 60, hi: 130 });
});

test('snapToStep rounds to the nearest step and clamps to the bounds', () => {
  assert.equal(E.snapToStep(57, 30, 220, 5), 55);
  assert.equal(E.snapToStep(58, 30, 220, 5), 60);
  assert.equal(E.snapToStep(-10, 30, 220, 5), 30, 'below min clamps');
  assert.equal(E.snapToStep(9999, 30, 220, 5), 220, 'above max clamps');
  assert.equal(E.snapToStep(33, 30, 220, 5), 35, 'steps are measured off min');
});

test('moveThumb moves one thumb, snapped and bounded', () => {
  assert.deepEqual(E.moveThumb({ lo: 50, hi: 130 }, 'lo', 62, ITEM), { lo: 60, hi: 130 });
  assert.deepEqual(E.moveThumb({ lo: 50, hi: 130 }, 'hi', 141, ITEM), { lo: 50, hi: 140 });
  assert.deepEqual(E.moveThumb({ lo: 50, hi: 130 }, 'lo', 0, ITEM), { lo: 30, hi: 130 });
  assert.deepEqual(E.moveThumb({ lo: 50, hi: 130 }, 'hi', 400, ITEM), { lo: 50, hi: 220 });
});

test('moveThumb enforces minSpan instead of crossing', () => {
  // lo pushed up toward hi stops 50 below it.
  assert.deepEqual(E.moveThumb({ lo: 50, hi: 130 }, 'lo', 200, ITEM), { lo: 80, hi: 130 });
  // hi pulled down toward lo stops 50 above it.
  assert.deepEqual(E.moveThumb({ lo: 50, hi: 130 }, 'hi', 60, ITEM), { lo: 50, hi: 100 });
});

test('moveThumb does not mutate its input', () => {
  const before = { lo: 50, hi: 130 };
  E.moveThumb(before, 'lo', 200, ITEM);
  assert.deepEqual(before, { lo: 50, hi: 130 });
});

test('moveThumb defaults step/minSpan sanely when the item omits them', () => {
  const bare = { min: 0, max: 100 };
  assert.deepEqual(E.moveThumb({ lo: 10, hi: 90 }, 'lo', 11, bare), { lo: 11, hi: 90 },
    'no step -> step 1');
  assert.deepEqual(E.moveThumb({ lo: 10, hi: 90 }, 'lo', 95, bare), { lo: 89, hi: 90 },
    'no minSpan -> 1');
});
