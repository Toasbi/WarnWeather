// test/view-editor.test.js — the Custom-layout editor's pure core (reorder /
// add / remove / snapshot / view management). The DOM layer is exercised by the
// engine-render integration suite; these pin the state rules it drives.
const test = require('node:test');
const assert = require('node:assert/strict');
const ve = require('../src/pkjs/settings/view-editor.js');
const vc = require('../src/pkjs/view-cycle.js');

function baseView(over) {
  const S = {
    viewCount: '2',
    viewTop0: 'cal2', viewBody0: 'forecast', viewUpper0: 'weather', viewLower0: 'off', viewOrder0: 'TACB',
    viewTop1: 'cal2', viewBody1: 'forecast', viewUpper1: 'weather', viewLower1: 'off', viewOrder1: 'TACB',
    viewClockOff1: false, viewStripOff1: false,
  };
  return Object.assign(S, over || {});
}

test('presence derives from the per-view keys; slot 0 always has a clock', () => {
  const S = baseView();
  assert.deepEqual(ve.presence(S, 0), { T: true, C: true, A: true, B: false, G: true });
  S.viewClockOff1 = true;
  S.viewTop1 = 'none';
  S.viewBody1 = 'none';
  assert.deepEqual(ve.presence(S, 1), { T: false, C: false, A: true, B: false, G: false });
  // A hostile clock-off flag on slot 0 is ignored by presence (no slot-0 key exists;
  // the compiler and the watch belt both enforce it too).
  S.viewClockOff0 = true;
  assert.equal(ve.presence(S, 0).C, true);
});

test('moveBand swaps with the nearest PRESENT neighbour, stepping over absent bands', () => {
  // Clock absent: moving B up from TACB must land it above A (via canonicalize),
  // not swap with the invisible clock.
  const S = baseView({ viewClockOff1: true, viewLower1: 'radar', radarMode: 'graph' });
  // order TACB, C absent; move B up: swaps past C onto A's spot, then canonicalizes
  // back to A-before-B by swapping the SOURCES instead.
  assert.equal(ve.moveBand(S, 1, 'B', -1), true);
  assert.equal(S.viewOrder1, 'TACB', 'string stays canonical');
  assert.equal(S.viewUpper1, 'radar', 'sources swapped: radar now renders above');
  assert.equal(S.viewLower1, 'weather');
});

test('moveBand: edge no-ops and clock-at-top ordering', () => {
  const S = baseView();
  assert.equal(ve.moveBand(S, 0, 'T', -1), false, 'top band already first');
  assert.equal(ve.moveBand(S, 0, 'C', -1), true, 'clock above the status row');
  assert.equal(S.viewOrder0, 'TCAB');
  assert.equal(ve.moveBand(S, 0, 'C', -1), true, 'clock above the calendar');
  assert.equal(S.viewOrder0, 'CTAB');
  assert.equal(ve.moveBand(S, 0, 'C', -1), false, 'clock at the visible top');
  assert.ok(vc.orderCode(S.viewOrder0) > 0, 'a stacked order code compiles');
});

test('remove/add element round-trips; re-added elements land above the graph', () => {
  const S = baseView();
  assert.equal(ve.removeElement(S, 1, 'C'), true);
  assert.equal(S.viewClockOff1, true);
  assert.equal(ve.removeElement(S, 1, 'topbar'), true);
  assert.equal(S.viewStripOff1, true);
  assert.equal(ve.removeElement(S, 1, 'T'), true);
  assert.equal(S.viewTop1, 'none');
  // Source-aware ＋: the sibling row already shows weather and neither radar nor
  // health is capable here, so a second status bar is NOT offered (it would only
  // duplicate and fold away).
  assert.deepEqual(ve.addableElements(S, 1).map((a) => a[1]).sort(),
    ['clock', 'top', 'topbar'].sort());
  // Re-add the clock: it lands at the END of the drawn order (directly above the graph).
  // This view has no top bar, so the watch stacks even the legacy code literally (T A C B
  // minus the absent bands = A, C) — the legacy code already draws the clock last, and
  // storedOrderFor prefers it (byte-identical to the seed).
  assert.equal(ve.addElement(S, 1, 'clock'), true);
  assert.equal(S.viewClockOff1, false);
  const drawn = ve.displayOrder(S, 1).filter((b) => ve.presence(S, 1)[b]);
  assert.deepEqual(drawn, ['A', 'C'], 'clock re-added above the graph');
  assert.equal(S.viewOrder1, 'TACB', 'the legacy code already draws it there');
  // With radar capable, the second status bar becomes addable and fills the free
  // slot with the first NON-DUPLICATE capable source (radar — weather is taken).
  S.radarMode = 'graph';
  assert.ok(ve.addableElements(S, 1).map((a) => a[1]).indexOf('status') >= 0);
  assert.equal(ve.freeStatusSource(S, 1), 'radar');
  assert.equal(ve.addElement(S, 1, 'status'), true);
  assert.equal(S.viewLower1, 'radar');
  // Slot 0 can never remove clock or top bar.
  assert.equal(ve.removeElement(S, 0, 'C'), false);
  assert.equal(ve.removeElement(S, 0, 'topbar'), false);
});

test('normalizeAfterPick: sibling source dedupe and the single radar layer', () => {
  const S = baseView({ viewUpper0: 'weather', viewLower0: 'weather' });
  ve.normalizeAfterPick(S, 0, 'viewUpper0');
  assert.equal(S.viewLower0, 'off', 'fresh pick wins; sibling clears');
  S.viewTop0 = 'radar'; S.viewBody0 = 'radar';
  ve.normalizeAfterPick(S, 0, 'viewBody0');
  assert.equal(S.viewTop0, 'cal2', 'one radar layer: the fresh body pick wins');
});

test('snapshot/restore covers every custom key (the ✕ draft-discard path)', () => {
  const S = baseView({ viewTopSize0: '3', viewBodySize0: 'fill', viewAlign0: 'clock',
    viewTopSize1: '3', viewBodySize1: 'fill', viewAlign1: 'clock' });
  const snap = ve.takeSnapshot(S);
  S.viewTop0 = 'none'; S.viewOrder1 = 'ABCT'; S.viewClockOff1 = true; S.viewCount = '3';
  S.viewBody0 = 'none'; S.viewAlign0 = 'bottom'; S.viewTopSize1 = '4'; S.viewBodySize1 = '2';
  ve.restoreSnapshot(S, snap);
  assert.equal(S.viewTop0, 'cal2');
  assert.equal(S.viewOrder1, 'TACB');
  assert.equal(S.viewClockOff1, false);
  assert.equal(S.viewCount, '2');
  assert.equal(S.viewBody0, 'forecast');
  assert.equal(S.viewAlign0, 'clock');
  assert.equal(S.viewTopSize1, '3');
  assert.equal(S.viewBodySize1, 'fill');
});

// ── Graph removal, the last-element guard, Position ─────────────────────────

test('the Graph is removable on every view, the Default included, and comes back', () => {
  const S = baseView({ healthMode: 'off', radarMode: 'graph' });
  assert.equal(ve.removeElement(S, 0, 'G'), true, 'the Default may drop its graph (decided)');
  assert.equal(S.viewBody0, 'none');
  assert.equal(vc.buildCustomCycle(S)[0].body, vc.BODY_NONE);
  assert.equal(ve.removeElement(S, 0, 'G'), false, 'already gone');
  assert.ok(ve.addableElements(S, 0).map((a) => a[1]).indexOf('graph') >= 0, '＋ offers the Graph');
  assert.equal(ve.addElement(S, 0, 'graph'), true);
  assert.equal(S.viewBody0, 'forecast', 'the first free graph kind');
  assert.equal(S.viewBodySize0, 'fill', 'a re-added graph fills again');
  assert.equal(vc.buildCustomCycle(S)[0].body, vc.BODY_FC);
});

test('freeBodyContent skips the Top area\'s content and incapable kinds', () => {
  const S = baseView({ healthMode: 'off', radarMode: 'graph' });
  assert.equal(ve.freeBodyContent(S, 0), 'forecast');
  S.viewTop0 = 'forecast';                       // (Phase 2a: a forecast graph up top)
  assert.equal(ve.freeBodyContent(S, 0), 'radar', 'health needs healthMode all');
  S.healthMode = 'all';
  assert.equal(ve.freeBodyContent(S, 0), 'health');
  S.viewTop0 = 'radar'; S.healthMode = 'off';
  assert.equal(ve.freeBodyContent(S, 0), 'forecast');
  S.viewTop0 = 'forecast'; S.radarMode = 'off';
  assert.equal(ve.freeBodyContent(S, 0), null, 'nothing left to add');
  S.viewBody0 = 'none';
  assert.ok(ve.addableElements(S, 0).every((a) => a[1] !== 'graph'), 'no Graph offered then');
});

test('a re-added graph takes the fill back from a filling top area', () => {
  const S = baseView({ viewBody0: 'none', viewTop0: 'radar', viewTopSize0: 'fill', radarMode: 'graph' });
  assert.equal(ve.addElement(S, 0, 'graph'), true);
  assert.equal(S.viewTopSize0, '3');
  assert.equal(S.viewBodySize0, 'fill');
});

test('the last element of a view keeps its ✕ withheld', () => {
  const S = baseView({ viewTop1: 'none', viewUpper1: 'off', viewBody1: 'none' });
  assert.equal(ve.elementCount(S, 1), 1, 'only the clock is left');
  assert.equal(ve.removeElement(S, 1, 'C'), false);
  assert.equal(S.viewClockOff1, false);
  S.viewClockOff1 = true; S.viewBody1 = 'forecast';
  assert.equal(ve.elementCount(S, 1), 1, 'only the graph is left');
  assert.equal(ve.removeElement(S, 1, 'G'), false);
  assert.equal(ve.removeElement(S, 1, 'topbar'), true, 'the top bar is not an element');
});

test('setAlign writes a known Position only', () => {
  const S = baseView({ viewAlign0: 'clock' });
  assert.equal(ve.setAlign(S, 0, 'bottom'), true);
  assert.equal(S.viewAlign0, 'bottom');
  assert.equal(ve.setAlign(S, 0, 'bottom'), false, 'unchanged');
  assert.equal(ve.setAlign(S, 0, 'sideways'), false);
  assert.equal(S.viewAlign0, 'bottom');
  assert.equal(ve.viewHasFill(S, 0), true, 'the graph fills: Position moot');
  S.viewBody0 = 'none';
  assert.equal(ve.viewHasFill(S, 0), false);
  assert.equal(vc.buildCustomCycle(S)[0].align, vc.ALIGN_BOTTOM);
});

test('addView copies the Default; removeView compacts so the last slot frees', () => {
  const S = baseView({ viewTop0: 'cal3', viewOrder0: 'TCAB', viewBody0: 'none', viewAlign0: 'top' });
  assert.equal(ve.addView(S), 2, 'new view is slot 2');
  assert.equal(S.viewCount, '3');
  assert.equal(S.viewTop2, 'cal3', 'copied from the Default');
  assert.equal(S.viewOrder2, 'TCAB');
  assert.equal(S.viewBody2, S.viewBody0);
  assert.equal(S.viewAlign2, S.viewAlign0, 'the v2 keys are copied too');
  assert.equal(S.viewClockOff2, false, 'fresh flick keeps its clock');
  assert.equal(ve.addView(S), -1, 'full at 3');
  // Remove Flick 1: Flick 2 compacts down into its slot.
  S.viewTop1 = 'none'; S.viewTop2 = 'radar'; S.viewAlign2 = 'bottom';
  assert.equal(ve.removeView(S, 1), true);
  assert.equal(S.viewCount, '2');
  assert.equal(S.viewTop1, 'radar', 'former Flick 2 took the slot');
  assert.equal(S.viewAlign1, 'bottom', 'with its Position');
  assert.equal(ve.removeView(S, 0), false, 'the Default is not removable');
  // The freed slot no longer compiles: the cycle really shrinks on the wire.
  const cycle = vc.buildCustomCycle(Object.assign({ healthMode: 'off', radarMode: 'graph' }, S));
  assert.equal(cycle.length, 2);
});
