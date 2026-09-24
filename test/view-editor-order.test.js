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
 * The editor body's HTML for view `i`.
 * @param {Object} S settings state
 * @param {number} i view slot
 * @returns {string} the rendered band list
 */
function editorHtml(S, i) {
  let html = '';
  const sink = { set innerHTML(h) { html = h; } };
  ve._test.VE.ctx = { S, schema, render() {} };
  ve._test.VE.overlay = { querySelector: (sel) => (sel === '[data-ve-body]' ? sink : { set innerHTML(h) {} }) };
  ve._test.VE.tab = i;
  ve._test.renderEditor();
  ve._test.VE.overlay = null;
  return html;
}

/**
 * The editor's rendered row list for view `i`, as band kinds (top/clock/status).
 * @param {Object} S settings state
 * @param {number} i view slot
 * @returns {string[]} kinds in list order, the fixed Top bar and Graph rows left out
 */
function editorKinds(S, i) {
  const html = editorHtml(S, i);
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
  return bands.filter((b) => b.kind !== 'strip' && b.kind !== 'body').map((b) => b.kind);
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
  ['cal2', 'cal3', 'radar', 'none', 'forecast', 'health'].forEach((top) => {
    [['weather', 'off'], ['weather', 'radar']].forEach(([upper, lower]) => {
      vc.STACK_ORDERS.forEach((order) => {
        [false, true].forEach((clockOff) => {
          [false, true].forEach((stripOff) => {
            [['forecast', 'fill'], ['forecast', '3'], ['none', 'fill']].forEach(([body, size]) => {
              const S = state({ viewTop1: top, viewUpper1: upper, viewLower1: lower,
                viewOrder1: order, viewClockOff1: clockOff, viewStripOff1: stripOff,
                viewBody1: body, viewBodySize1: size, healthMode: 'all' });
              const label = [top, upper + '/' + lower, order, clockOff ? 'no clock' : 'clock',
                stripOff ? 'no top bar' : 'top bar', 'graph ' + body + ' ' + size].join(' ');
              assert.deepEqual(editorKinds(S, 1), watchKinds(S, 1), label);
            });
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

/**
 * The packed wire words of every view — what the watch receives.
 * @param {Object} S settings state
 * @returns {number[]} packWire per view
 */
function wire(S) {
  return vc.buildCustomCycle(S).map(vc.packWire);
}

test('moving a lone status bar past its absent sibling and back is byte-identical', () => {
  // One status bar under a 3-row calendar: up above the clock, then back down. The
  // absent second bar's slot is stepped over; that must not turn the lone UPPER row into
  // a lone LOWER row (which the legacy engine draws 14 px lower over a shorter graph).
  ['cal3', 'radar', 'none'].forEach((top) => {
    const S = state({ viewTop0: top });
    const before = wire(S);
    assert.equal(ve.moveBand(S, 0, 'A', -1), true, top + ': up');
    assert.equal(ve.moveBand(S, 0, 'A', 1), true, top + ': back down');
    assert.equal(S.viewOrder0, 'TACB', top);
    assert.equal(S.viewUpper0, 'weather', top + ': still the upper row');
    assert.equal(S.viewLower0, 'off', top);
    assert.deepEqual(wire(S), before, top + ': the watch receives exactly what it had');
  });
});

test('moving the top area down and back up is byte-identical, one or two status bars', () => {
  [['weather', 'off'], ['weather', 'radar']].forEach(([upper, lower]) => {
    const S = state({ viewTop0: 'cal3', viewUpper0: upper, viewLower0: lower });
    const before = wire(S);
    assert.equal(ve.moveBand(S, 0, 'T', 1), true);
    assert.deepEqual(editorKinds(S, 0), watchKinds(S, 0));
    assert.equal(ve.moveBand(S, 0, 'T', -1), true);
    assert.equal(S.viewOrder0, 'TACB', upper + '/' + lower);
    assert.deepEqual(wire(S), before, upper + '/' + lower);
  });
});

test('the Graph row carries a ✕ on every tab; the Alignment row shows only without a fill', () => {
  const S = state();
  let html = editorHtml(S, 0);
  assert.match(html, /data-ve-del="G"/, 'the Default\'s graph is removable');
  assert.doesNotMatch(html, /data-ve-align/, 'the graph fills: no Alignment row');
  S.viewBody0 = 'none'; S.viewAlign0 = 'bottom';
  html = editorHtml(S, 0);
  assert.doesNotMatch(html, /data-ve-del="G"/, 'no Graph row once removed');
  assert.match(html, /<div class="ve-align"><div class="ve-align-hd">Alignment<\/div>/,
    'a section of its own, not an element row');
  assert.doesNotMatch(html, /ve-pos/, 'never styled as an element band');
  assert.ok(html.indexOf('ve-align') > html.indexOf('data-ve-addtoggle'),
    'below the element list and its ＋ button');
  assert.match(html, /No graph, so the elements sit together in the free space\./,
    'the row says what it aligns and why it is there');
  assert.match(html, /Clock mid keeps the clock in the middle of the screen/);
  assert.match(html, /class="on" data-ve-align="bottom"/, 'the stored alignment is on');
  const order = [...html.matchAll(/data-ve-align="(\w+)">([^<]+)</g)].map((m) => m[2]);
  assert.deepEqual(order, ['Top', 'Middle', 'Bottom', 'Clock mid']);
  // A clockless flick: 'Clock mid' is neither offered nor explained, and a stored
  // 'clock' shows as Middle.
  const C = state({ viewBody1: 'none', viewClockOff1: true, viewAlign1: 'clock' });
  html = editorHtml(C, 1);
  assert.doesNotMatch(html, /data-ve-align="clock"/);
  assert.doesNotMatch(html, /Clock mid/);
  assert.match(html, /class="on" data-ve-align="center"/);
});

test('each tab shows a live preview of its view that follows the edits', () => {
  const S = state({ viewBody1: 'none', viewAlign1: 'top' });
  const preview = (h) => (/<div class="ve-preview">(<svg[\s\S]*?<\/svg>)<\/div>/.exec(h) || [])[1];
  const top = preview(editorHtml(S, 1));
  assert.ok(top, 'a preview SVG heads the tab');
  assert.match(top, />Clock</, 'it draws this view\'s bands');
  assert.doesNotMatch(top, />Forecast</, 'no graph band for a graphless view');
  S.viewAlign1 = 'bottom';
  assert.notEqual(preview(editorHtml(S, 1)), top, 'an alignment tap moves the preview');
  S.viewBody1 = 'forecast';
  assert.match(preview(editorHtml(S, 1)), />Forecast</, 'a re-added graph shows up');
});

test('the last element keeps no ✕', () => {
  const S = state({ viewTop1: 'none', viewUpper1: 'off', viewBody1: 'none' });
  const html = editorHtml(S, 1);
  assert.doesNotMatch(html, /data-ve-del="C"/, 'the clock is the only element left');
  assert.match(html, /data-ve-del="topbar"/, 'the top bar is not an element');
});

// An edit that switches a view between the watch's two engines — the legacy engine
// (order code 0 with full chrome and a filling graph) and the stacker — must not move
// the bands the user did not touch. Under a 3-row calendar, a radar top or no top the
// legacy engine draws the status bar BELOW the clock, the stacker's code 0 above it.
test('removing and re-adding the graph keeps the drawn order, and comes back byte-identical', () => {
  ['cal3', 'radar', 'none', 'cal2'].forEach((top) => {
    [['weather', 'off'], ['weather', 'radar']].forEach(([upper, lower]) => {
      const S = state({ viewTop1: top, viewUpper1: upper, viewLower1: lower });
      const label = top + ' ' + upper + '/' + lower;
      const drawn = watchKinds(S, 1);
      const before = wire(S);
      assert.equal(ve.removeElement(S, 1, 'G'), true, label);
      assert.deepEqual(watchKinds(S, 1), drawn, label + ': nothing moved on the watch');
      assert.deepEqual(editorKinds(S, 1), drawn, label + ': nor in the list');
      assert.equal(ve.addElement(S, 1, 'graph'), true, label);
      assert.deepEqual(wire(S), before, label + ': the graph back = the view as it was');
    });
  });
});

test('removing and re-adding the top bar keeps the drawn order, and comes back byte-identical', () => {
  ['cal3', 'radar', 'none', 'cal2'].forEach((top) => {
    const S = state({ viewTop1: top });
    const drawn = watchKinds(S, 1);
    const before = wire(S);
    assert.equal(ve.removeElement(S, 1, 'topbar'), true, top);
    assert.deepEqual(watchKinds(S, 1), drawn, top + ': nothing moved');
    assert.deepEqual(editorKinds(S, 1), drawn, top);
    assert.equal(ve.addElement(S, 1, 'topbar'), true, top);
    assert.deepEqual(wire(S), before, top + ': byte-identical again');
  });
});

test('a sheet pick that switches engines keeps the drawn order (keepOrder)', () => {
  // Simulates the overlay's sheet flow: capture before the sheet opens, the engine
  // writes the key, then normalizeAfterPick and keepOrder run in the close callback.
  const S = state({ viewTop1: 'cal3', viewBody1: 'none' });
  const drawn = watchKinds(S, 1);
  const snap = ve.orderSnapshot(S, 1);
  S.viewBody1 = 'forecast';
  ve.normalizeAfterPick(S, 1, 'viewBody1');
  ve.keepOrder(S, 1, snap);
  assert.deepEqual(watchKinds(S, 1), drawn);
});

test('removing and re-adding the graph keeps a stacked order code byte-identical', () => {
  // The Default view with its calendar moved below the status bar (a stacked code), then
  // the calendar removed: the stored code still draws Weather, Clock. Removing and
  // re-adding the graph must not rewrite that code (the watch would resend the settings
  // and snap the flick cursor home for an edit the user undid).
  const S = state();
  assert.equal(ve.moveBand(S, 0, 'T', 1), true);
  assert.equal(ve.removeElement(S, 0, 'T'), true);
  const before = wire(S);
  const drawn = watchKinds(S, 0);
  assert.equal(ve.removeElement(S, 0, 'G'), true);
  assert.deepEqual(watchKinds(S, 0), drawn);
  assert.equal(ve.addElement(S, 0, 'graph'), true);
  assert.deepEqual(wire(S), before, 'the stored code survives the round trip');
});

test('picking a graph for the top area keeps the drawn order (the sheet flow switches engines)', () => {
  // cal3 + weather row, legacy code 0: drawn T C A. Picking the forecast graph for the top
  // area makes the view stacked (and moves the forecast up); the bands must stay put.
  const S = state({ viewTop1: 'cal3', healthMode: 'all' });
  const drawn = watchKinds(S, 1);
  const before = wire(S);
  let snap = ve.orderSnapshot(S, 1);
  S.viewTop1 = 'forecast';
  ve.normalizeAfterPick(S, 1, 'viewTop1');
  ve.keepOrder(S, 1, snap);
  assert.equal(S.viewBody1, 'none', 'the forecast moved up');
  assert.deepEqual(watchKinds(S, 1), drawn, 'nothing else moved');
  // ...and picking the calendar back (then re-adding the graph) restores the view
  snap = ve.orderSnapshot(S, 1);
  S.viewTop1 = 'cal3';
  ve.normalizeAfterPick(S, 1, 'viewTop1');
  ve.keepOrder(S, 1, snap);
  assert.equal(ve.addElement(S, 1, 'graph'), true);
  assert.deepEqual(wire(S), before);
});

// ── Sizes (Phase 2b) ─────────────────────────────────────────────────────────

/**
 * The editor HTML for view `i` edited for watch `platform` (the ready ctx carries ENV).
 * @param {Object} S @param {number} i @param {string} platform
 * @returns {string} HTML
 */
function editorHtmlOn(S, i, platform) {
  let html = '';
  const sink = { set innerHTML(h) { html = h; } };
  ve._test.VE.ctx = { S, schema, render() {}, ENV: { platform } };
  ve._test.VE.overlay = { querySelector: (sel) => (sel === '[data-ve-body]' ? sink : { set innerHTML(h) {} }) };
  ve._test.VE.tab = i;
  ve._test.renderEditor();
  ve._test.VE.overlay = null;
  return html;
}

/** @param {string} html @param {string} stem @returns {Object<string,string>} value → state */
function sizeButtons(html, stem) {
  const out = {};
  [...html.matchAll(new RegExp('<button type="button"( class="on")? data-ve-size="' + stem
    + ':(\\w+)"( disabled)?>', 'g'))]
    .forEach((m) => { out[m[2]] = m[1] ? 'on' : m[3] ? 'off' : 'ok'; });
  return out;
}

test('size lines: on the graph row and every top area — a calendar takes 2 or 3 rows', () => {
  const S = state({ viewTop1: 'cal3', healthMode: 'all' });
  let html = editorHtml(S, 1);
  assert.match(html, /data-ve-size="BodySize:fill"/);
  assert.deepEqual(sizeButtons(html, 'TopSize'), { 2: 'ok', 3: 'on' },
    'the older cal3 spelling shows as a 3-row calendar; no 4 or Fill');
  assert.match(html, />Calendar</, 'one Calendar choice in the row');
  S.viewTop1 = 'health'; S.viewBody1 = 'forecast';
  html = editorHtml(S, 1);
  assert.match(html, /Size · rows/);
  assert.deepEqual(Object.keys(sizeButtons(html, 'TopSize')), ['2', '3', '4', 'fill']);
  assert.equal(sizeButtons(html, 'TopSize')['3'], 'on', 'a top defaults to 3 rows');
  assert.equal(sizeButtons(html, 'BodySize').fill, 'on', 'the graph defaults to fill');
  assert.equal(sizeButtons(html, 'BodySize')['2'], 'off', 'a forecast never takes 2 rows');
});

test('sizes that make the view too tall for the edited watch are inert (never the current one)', () => {
  // Forecast top + clock + weather row + health body: a 4-row top fits emery with the
  // body filling, but the 144 px watch runs out (see stackFits' D + row case).
  const S = state({ viewTop1: 'forecast', viewBody1: 'health', viewOrder1: 'TCAB', healthMode: 'all' });
  assert.equal(sizeButtons(editorHtmlOn(S, 1, 'basalt'), 'TopSize')['4'], 'off');
  assert.equal(sizeButtons(editorHtmlOn(S, 1, 'emery'), 'TopSize')['4'], 'off', '213 of 202 on emery too');
  assert.equal(sizeButtons(editorHtmlOn(S, 1, 'basalt'), 'TopSize')['2'], 'off', 'forecast: never 2');
  // an ENV-less ctx (the unknown watch) checks both screens and keeps rendering
  assert.equal(sizeButtons(editorHtml(S, 1), 'TopSize')['4'], 'off');
  // a stored layout that does not fit shows the note, and its value stays selectable
  S.viewTopSize1 = '4';
  const html = editorHtmlOn(S, 1, 'basalt');
  assert.match(html, /Too tall for your watch by 3 px/);
  assert.equal(sizeButtons(html, 'TopSize')['4'], 'on');
});

test('setSize keeps one fill per view, and a size change that switches engines keeps the order', () => {
  const S = state({ viewTop1: 'radar', viewBody1: 'forecast', healthMode: 'all' });
  assert.equal(ve.setSize(S, 1, 'TopSize', 'fill'), true);
  assert.equal(S.viewBodySize1, '3', 'the filling graph gives the fill up');
  assert.equal(ve.setSize(S, 1, 'BodySize', 'fill'), true);
  assert.equal(S.viewTopSize1, '3');
  assert.equal(ve.setSize(S, 1, 'BodySize', '7'), false);
  // cal3 + weather, legacy engine (T C A): sizing the graph makes the view stacked —
  // the bands stay where they were drawn, and sizing it back restores the view exactly.
  const C = state({ viewTop1: 'cal3', healthMode: 'all' });
  const drawn = watchKinds(C, 1);
  const before = wire(C);
  let snap = ve.orderSnapshot(C, 1);
  ve.setSize(C, 1, 'BodySize', '3');
  ve.keepOrder(C, 1, snap);
  assert.deepEqual(watchKinds(C, 1), drawn);
  snap = ve.orderSnapshot(C, 1);
  ve.setSize(C, 1, 'BodySize', 'fill');
  ve.keepOrder(C, 1, snap);
  assert.deepEqual(wire(C), before);
});

test('a size tap that would move a band across the clock is refused', () => {
  // emery: radar top + two status bars (legacy: T C A B). Size the radar to 2 rows (the
  // stacker, order kept), then move the weather bar above the clock (T A C B). Going back
  // to 3 rows would hand the view back to the legacy engine, which cannot draw T A C B —
  // the bar would jump below the clock — so '3' is inert.
  const S = state({ viewTop1: 'radar', viewLower1: 'health', healthMode: 'all' });
  let snap = ve.orderSnapshot(S, 1);
  ve.setSize(S, 1, 'TopSize', '2');
  ve.keepOrder(S, 1, snap);
  assert.equal(ve.moveBand(S, 1, 'A', -1), true);
  assert.deepEqual(watchKinds(S, 1), ['top', 'status', 'clock', 'status']);
  assert.equal(ve.sizeFits(S, 1, 'TopSize', '3'), false);
  assert.equal(sizeButtons(editorHtmlOn(S, 1, 'emery'), 'TopSize')['3'], 'off');
  assert.equal(sizeButtons(editorHtmlOn(S, 1, 'emery'), 'TopSize')['2'], 'on');
});

test('a top-area size never outlives the content it was set for', () => {
  const S = state({ viewTop1: 'health', viewTopSize1: '2', viewBody1: 'forecast', healthMode: 'all' });
  assert.equal(ve.removeElement(S, 1, 'T'), true);
  assert.equal(S.viewTopSize1, '3', '✕ Top area drops its size');
  S.viewTopSize1 = '2';                              // a stale value from an older build
  assert.equal(ve.addElement(S, 1, 'top'), true);
  assert.equal(S.viewTop1, 'cal');
  assert.equal(S.viewTopSize1, '2', '＋ Top area starts as a clean 2-row calendar');
  // a forecast top at Fill moved down to the graph row: the calendar left behind is 2 rows
  S.viewTop1 = 'forecast'; S.viewTopSize1 = 'fill'; S.viewBody1 = 'health'; S.viewBodySize1 = '3';
  S.viewBody1 = 'forecast';
  ve.normalizeAfterPick(S, 1, 'viewBody1');
  assert.equal(S.viewTop1, 'cal');
  assert.equal(S.viewTopSize1, '2');
  // a radar at Fill switched to the calendar: the size follows, within 2 or 3 rows
  S.viewTop1 = 'radar'; S.viewTopSize1 = 'fill';
  S.viewTop1 = 'cal';
  ve.normalizeAfterPick(S, 1, 'viewTop1');
  assert.equal(S.viewTopSize1, '3');
});

test('＋ Add element offers the top area by its seat name, not its first content', () => {
  const S = state({ viewTop1: 'none' });
  assert.deepEqual(ve.addableElements(S, 1).filter((a) => a[1] === 'top'), [['Top area', 'top']]);
});

test('the calendar size: 2 · 3 rows; a size change never moves the other bands', () => {
  // Legacy engine, one status bar: a 2-row calendar draws it above the clock, a 3-row one
  // below. Changing the calendar's SIZE keeps the bar where the user sees it (a stacked
  // code), and changing it back restores the view byte for byte.
  const S = state({ viewTop1: 'cal', viewTopSize1: '2' });
  const drawn = watchKinds(S, 1);
  const before = wire(S);
  assert.deepEqual(drawn, ['top', 'status', 'clock']);
  let snap = ve.orderSnapshot(S, 1);
  assert.equal(ve.setSize(S, 1, 'TopSize', '3'), true);
  ve.keepOrder(S, 1, snap);
  assert.equal(vc.buildCustomCycle(S)[1].tier, vc.TIER_FULL, 'a 3-row calendar now');
  assert.deepEqual(watchKinds(S, 1), drawn, 'the status bar stayed above the clock');
  snap = ve.orderSnapshot(S, 1);
  assert.equal(ve.setSize(S, 1, 'TopSize', '2'), true);
  ve.keepOrder(S, 1, snap);
  assert.deepEqual(wire(S), before);
  assert.equal(ve.setSize(S, 1, 'TopSize', '4'), false, 'a calendar has no 4th row');
  assert.equal(ve.setSize(S, 1, 'TopSize', 'fill'), false);
  // the older spellings are sized the same way (and rewritten to 'cal')
  const L = state({ viewTop1: 'cal3' });
  assert.equal(ve.setSize(L, 1, 'TopSize', '2'), true);
  assert.equal(L.viewTop1, 'cal');
  assert.equal(L.viewTopSize1, '2');
});

test('the Alignment note names what does not fill, a top-area graph included', () => {
  const S = state({ viewTop1: 'forecast', viewBody1: 'none', healthMode: 'all' });
  const html = editorHtml(S, 1);
  assert.match(html, /Nothing fills this view, so the elements sit together in the free space\./);
  assert.doesNotMatch(html, /No graph, so/);
  S.viewTop1 = 'cal2';
  assert.match(editorHtml(S, 1), /No graph, so the elements sit together/);
});
