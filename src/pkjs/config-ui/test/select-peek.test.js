// src/pkjs/config-ui/test/select-peek.test.js — the sheet peek clamp
// (fitSelectPeek): the sizing rule shared by plain selects and the edit sheets.
// Regression home for the Date-format sheet bug: an edit-sheet "row" can be a
// whole stacked radio group hundreds of px tall, and the old
// always-align-to-row-fraction rule collapsed the sheet far below its cap on
// open — then the first tap re-rendered the sheet without the clamp, so it
// visibly jumped to full height.
const test = require('node:test');
const assert = require('node:assert/strict');
require('../lib/schema-walk.js');
require('../lib/color.js');
require('../lib/show-when.js');
const E = require('../lib/engine.js');

// A dialog stub with just the surface fitSelectPeek touches: the capped list,
// its measured rows, and the inline style the clamp writes.
function stubDialog(rowHeights, capH) {
  const list = {
    style: { maxHeight: '' },
    clientHeight: capH,
    scrollHeight: rowHeights.reduce((a, b) => a + b, 0),
    children: rowHeights.map((h) => ({ offsetHeight: h })),
  };
  return {
    open: true,
    classList: { contains: () => false },
    querySelector: (sel) => (sel === '.ssel-list' ? list : null),
    list,
  };
}

test('a giant fold row keeps the full capped height — the capped edge IS the peek', () => {
  // The Date sheet's shape: Bold row + two stacked radio groups. The cap lands
  // 92px into the 450px group (readable) with 358px clipped (clearly scrollable):
  // clamping to a fraction of that row would throw away 40% of the sheet.
  const dlg = stubDialog([70, 350, 450], 512);
  E.fitSelectPeek(dlg);
  assert.equal(dlg.list.style.maxHeight, '', 'no clamp — the natural edge already peeks');
});

test('re-running after a re-render lands the same height (the jump bug)', () => {
  // Interacting inside a sheet re-renders it and drops the inline clamp; the
  // peek now re-runs each render, so consecutive runs must agree — any drift
  // between runs is a visible size jump on tap.
  const uniform = stubDialog(new Array(20).fill(44), 440);
  E.fitSelectPeek(uniform);
  const first = uniform.list.style.maxHeight;
  uniform.list.style.maxHeight = '';           // what an innerHTML rebuild does
  E.fitSelectPeek(uniform);
  assert.equal(uniform.list.style.maxHeight, first, 'uniform list: stable across runs');
  const giant = stubDialog([70, 350, 450], 512);
  E.fitSelectPeek(giant);
  E.fitSelectPeek(giant);
  assert.equal(giant.list.style.maxHeight, '', 'giant-row sheet: stable across runs');
});

test('a boundary-flush fold still gets the classic row-fraction cut', () => {
  // 44px option rows, cap exactly on a row boundary: nothing would peek, so the
  // clamp cuts PEEK_ROW_FRACTION (0.66) into the deepest row that fits:
  // 9 rows (396) + 44 * 0.66 = 425.
  const dlg = stubDialog(new Array(20).fill(44), 440);
  E.fitSelectPeek(dlg);
  assert.equal(dlg.list.style.maxHeight, '425px');
});

test('a nearly-complete fold row is clipped by the minimum, not collapsed to its fraction', () => {
  // Cap shows 40 of the fold row's 44px — it reads as complete (only 4px clipped),
  // so the clamp pulls back just enough to clip MIN_CLIP_PX (12): 396 + 44 - 12 = 428.
  const dlg = stubDialog(new Array(20).fill(44), 436);
  E.fitSelectPeek(dlg);
  assert.equal(dlg.list.style.maxHeight, '428px');
});

test('content that fits under the cap is never clamped', () => {
  const dlg = stubDialog([70, 120], 512);
  E.fitSelectPeek(dlg);
  assert.equal(dlg.list.style.maxHeight, '');
});
