// test/graph-tail-lockstep.test.js — layout.c's LAYOUT_GRAPH_TAIL must equal
// bottom_view.h's BOTTOM_VIEW_BOTTOM_PAD on every platform arm. The forecast and health
// layers pad their frame bottom by BOTTOM_VIEW_BOTTOM_PAD (their hour labels ink into
// it); a graph in the custom layout's top band is sized rows × row_h + LAYOUT_GRAPH_TAIL
// so its plot keeps the row height. layout.c cannot include the SDK-bound bottom_view.h,
// so the value is mirrored — and this test keeps the two copies in lockstep.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

/**
 * The two arms of an `#ifdef PBL_PLATFORM_EMERY ... #else ... #endif` block defining `name`.
 * @param {string} file repo-relative path
 * @param {string} name macro name
 * @returns {{emery: number, other: number}}
 */
function arms(file, name) {
  const src = fs.readFileSync(path.resolve(__dirname, '..', file), 'utf8');
  const re = new RegExp('#ifdef PBL_PLATFORM_EMERY[\\s\\S]*?#define ' + name + '\\s+(\\d+)'
    + '[\\s\\S]*?#else[\\s\\S]*?#define ' + name + '\\s+(\\d+)[\\s\\S]*?#endif');
  const m = re.exec(src);
  assert.ok(m, name + ': the emery/other #ifdef arms were not found in ' + file);
  return { emery: Number(m[1]), other: Number(m[2]) };
}

test('LAYOUT_GRAPH_TAIL (layout.c) mirrors BOTTOM_VIEW_BOTTOM_PAD (bottom_view.h) per platform', () => {
  const tail = arms('src/c/windows/layout.c', 'LAYOUT_GRAPH_TAIL');
  const pad = arms('src/c/appendix/bottom_view.h', 'BOTTOM_VIEW_BOTTOM_PAD');
  assert.deepEqual(tail, pad);
  assert.deepEqual(pad, { emery: 10, other: 0 }, 'the values the goldens were measured with');
});
