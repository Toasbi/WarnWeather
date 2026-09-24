// test/view-editor-order.test.js — the Custom-layout editor must LIST a view's bands in
// the order the watch renders them. The legacy order code 0 ('TACB', what every preset
// seeds) is not literal: the watch's legacy engine seats the status row above the clock
// only under the 2-row calendar, and below it under a 3-row calendar, radar or no top.
// The editor used to list the stored letters, so a view seeded from Full calendar or
// No calendar showed its status bar above the clock while the preview and the watch
// drew it below — and no arrow sequence could put it where the list claimed it was.
// preview-layout.js contentBands mirrors the watch's placement (layout.c) and is the
// reference here.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
require('../src/pkjs/config-ui/lib/schema-walk.js');
require('../src/pkjs/config-ui/lib/color.js');
require('../src/pkjs/config-ui/lib/show-when.js');
require('../src/pkjs/config-ui/lib/engine.js');
const PL = require('../src/pkjs/settings/preview-layout.js');
const ve = require('../src/pkjs/settings/view-editor.js');
const vc = require('../src/pkjs/view-cycle.js');
const schema = require('../src/pkjs/settings/schema.js');

/**
 * The editor's rendered row list for view `i`, as band kinds (top/clock/status).
 * @param {Object} S settings state
 * @param {number} i view slot
 * @returns {string[]} kinds in list order, the fixed Top bar and Graph rows left out
 */
function editorKinds(S, i) {
  let html = '';
  const sink = { set innerHTML(h) { html = h; } };
  ve._test.VE.ctx = { S, schema, render() {} };
  ve._test.VE.overlay = { querySelector: (sel) => (sel === '[data-ve-body]' ? sink : { set innerHTML(h) {} }) };
  ve._test.VE.tab = i;
  ve._test.renderEditor();
  ve._test.VE.overlay = null;
  const kind = { 'Top area': 'top', Clock: 'clock', 'Status bar': 'status' };
  return [...html.matchAll(/<span class="lbl">([^<]+)<\/span>/g)]
    .map((m) => kind[m[1]]).filter(Boolean);
}

/**
 * What the preview (and the watch) shows for view `i`, as the same band kinds.
 * @param {Object} S settings state
 * @param {number} i view slot
 * @returns {string[]} kinds top to bottom, the Watch Status strip and the body left out
 */
function watchKinds(S, i) {
  const bands = PL.contentBands(vc.buildCustomCycle(S)[i]);
  return bands.slice(0, -1).map((b) => (b.label === 'Clock' ? 'clock'
    : b.label === 'Watch Status' ? null
      : /Status$/.test(b.label) ? 'status' : 'top')).filter(Boolean);
}

/**
 * A two-view custom state; view 1 is clockless when asked.
 * @param {Object} over per-view overrides
 * @returns {Object} settings state
 */
function state(over) {
  return Object.assign({
    layoutPreset: 'custom', healthMode: 'off', radarMode: 'graph', viewCount: '2',
    viewTop0: 'cal2', viewBody0: 'forecast', viewUpper0: 'weather', viewLower0: 'off', viewOrder0: 'TACB',
    viewTop1: 'cal2', viewBody1: 'forecast', viewUpper1: 'weather', viewLower1: 'off', viewOrder1: 'TACB',
    viewClockOff1: false, viewStripOff1: false
  }, over || {});
}

test('the editor lists every top, row count, order and omission the way the watch draws it', () => {
  // The stripOff axis is the case the clockOff one hides: removing the clock drops the
  // very band whose position the legacy/stacked engines disagree on, so a clockless view
  // lists the same bands either way — but a STRIPLESS view keeps its clock, and the
  // stacker draws it TACB (status above the clock) where the legacy engine would not.
  ['cal2', 'cal3', 'radar', 'none'].forEach((top) => {
    [['weather', 'off'], ['weather', 'radar']].forEach(([upper, lower]) => {
      vc.STACK_ORDERS.forEach((order) => {
        [false, true].forEach((clockOff) => {
          [false, true].forEach((stripOff) => {
            const S = state({ viewTop1: top, viewUpper1: upper, viewLower1: lower,
              viewOrder1: order, viewClockOff1: clockOff, viewStripOff1: stripOff });
            const label = [top, upper + '/' + lower, order, clockOff ? 'no clock' : 'clock',
              stripOff ? 'no top bar' : 'top bar'].join(' ');
            assert.deepEqual(editorKinds(S, 1), watchKinds(S, 1), label);
          });
        });
      });
    });
  });
});

test('a stripless view keeps its listed order when its bands are moved and moved back', () => {
  // cal3 + one status bar, top bar removed: the watch stacks it T A C (TACB minus B), so
  // the list must read the same, and a move that returns to that order stores the
  // legacy code again (byte-identical to before the move).
  const S = state({ viewTop1: 'cal3', viewStripOff1: true });
  assert.deepEqual(editorKinds(S, 1), ['top', 'status', 'clock'], 'listed as the watch stacks it');
  assert.deepEqual(watchKinds(S, 1), ['top', 'status', 'clock']);
  assert.equal(ve.moveBand(S, 1, 'C', -1), true);
  assert.deepEqual(editorKinds(S, 1), watchKinds(S, 1));
  assert.deepEqual(watchKinds(S, 1), ['top', 'clock', 'status']);
  assert.equal(ve.moveBand(S, 1, 'C', 1), true);
  assert.equal(S.viewOrder1, 'TACB', 'moved back: the legacy code again');
  assert.deepEqual(editorKinds(S, 1), ['top', 'status', 'clock']);
});

test('a view seeded from any preset opens listed exactly as the watch shows it', () => {
  ['fullCal', 'compactCal', 'noCal'].forEach((preset) => {
    [['off', 'off'], ['status', 'graph'], ['all', 'status']].forEach(([healthMode, radarMode]) => {
      [false, true].forEach((swap) => {
        const S = { layoutPreset: 'custom', healthMode, radarMode, swapClockStatus: swap };
        vc.seedCustomKeys(S, preset);
        for (let i = 0; i < ve.viewCount(S); i++) {
          assert.deepEqual(editorKinds(S, i), watchKinds(S, i),
            [preset, healthMode, radarMode, swap ? 'swapped' : '', 'view ' + i].join(' '));
        }
      });
    });
  });
});

test('under a 3-row calendar the arrows put the status bar above the clock, and back byte-identical', () => {
  const S = state({ viewTop0: 'cal3' });
  assert.deepEqual(editorKinds(S, 0), ['top', 'clock', 'status'], 'listed below the clock, as drawn');
  assert.equal(ve.moveBand(S, 0, 'A', -1), true);
  assert.deepEqual(watchKinds(S, 0), ['top', 'status', 'clock'], 'the watch now draws it above');
  assert.deepEqual(editorKinds(S, 0), watchKinds(S, 0));
  assert.notEqual(vc.orderCode(S.viewOrder0), 0, 'a stacked order the watch renders as listed');
  assert.equal(ve.moveBand(S, 0, 'A', 1), true);
  assert.equal(S.viewOrder0, 'TACB', 'moved back: the legacy order again, byte-identical to the preset');

  // No top: the same move lands the status bar above the clock too.
  const none = state({ viewTop0: 'none' });
  assert.deepEqual(editorKinds(none, 0), ['clock', 'status']);
  assert.equal(ve.moveBand(none, 0, 'A', -1), true);
  assert.deepEqual(watchKinds(none, 0), ['status', 'clock']);
});

test('an order the watch cannot render is refused, not stored as something else', () => {
  // 3-row calendar, one status bar on each side of the clock: T A C B is the legacy
  // slot's order, which a 3-row calendar renders as T C A B, and no stacked code spells it.
  const S = state({ viewTop0: 'cal3', viewLower0: 'radar' });
  assert.deepEqual(editorKinds(S, 0), ['top', 'clock', 'status', 'status']);
  const before = JSON.stringify(S);
  assert.equal(ve.moveBand(S, 0, 'C', 1), false);
  assert.equal(JSON.stringify(S), before, 'nothing changed');
  assert.deepEqual(editorKinds(S, 0), watchKinds(S, 0));
});

test('a second status bar added under a 3-row calendar lands as low as the watch can draw it', () => {
  const S = state({ viewTop0: 'cal3' });
  ve.moveBand(S, 0, 'A', -1);                       // status above the clock
  assert.equal(ve.addElement(S, 0, 'status'), true);
  assert.equal(S.viewLower0, 'radar');
  assert.deepEqual(editorKinds(S, 0), watchKinds(S, 0), 'listed as drawn');
  assert.deepEqual(watchKinds(S, 0), ['top', 'status', 'status', 'clock'],
    'right below the first: below the clock would need the unrenderable T A C B');
});
