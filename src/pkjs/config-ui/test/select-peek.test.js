// src/pkjs/config-ui/test/select-peek.test.js — the sheet peek clamp
// (fitSelectPeek): the sizing rule shared by plain selects and the edit sheets.
// Regression home for the Date-format sheet bug: an edit-sheet "row" can be a
// whole stacked radio group hundreds of px tall, and the old
// always-align-to-row-fraction rule collapsed the sheet far below its cap on
// open — then the first tap re-rendered the sheet without the clamp, so it
// visibly jumped to full height.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
// The lib files in the page's own order (build-page.js), so a bundle here loads what the
// page loads.
const { LIB_PAGE_FILES } = require('../scripts/build-page.js');
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

// --- .picking while an in-place option list is open -------------------------------
// A select inside an edit sheet expands its options under its row (engine
// renderInlineList). The peek clamp must never clip that list, so syncDialog marks the
// sheet .picking while one is open — the class the palette already uses, which raises
// the cap (shell.html) and makes fitSelectPeek stand down. Node has no layout: this
// proves the state machine, not the pixel heights.

/**
 * Boot the engine against a DOM shim whose #modal has a real showModal() (so syncDialog
 * runs past its guard) and records its classList, with one edit sheet holding a select.
 * The classList stub has NO toggle(): the engine must use add/remove.
 * @returns {{modal: Object, classes: Set<string>, listeners: Object, modalListeners: Object}}
 *   The knobs to drive the sheet.
 */
function bootSelectSheet() {
  const LIB = path.join(__dirname, '..', 'lib');
  const BUNDLE = LIB_PAGE_FILES
    .map((f) => fs.readFileSync(path.join(LIB, f), 'utf8')).join('\n')
    + '\nPConf.engine.boot();';
  const SCHEMA = { appName: 'X', versionLabel: 'v0', tabs: [{ id: 't', label: 'T', sections: [
    { title: 'S', items: [{ type: 'sheet', sheetId: 'fmt', label: 'Format' }] },
    { sheetOnly: true, sheetId: 'fmt', title: 'Format', items: [
      { type: 'select', messageKey: 'sep', label: 'Separator', defaultValue: 'slash',
        options: [['12/10', 'slash'], ['12 (10)', 'paren'], ['Custom', 'custom']] }
    ] }
  ] }] };
  const listeners = {}, modalListeners = {};
  const classes = new Set();
  const modal = {
    innerHTML: '', style: {}, open: false,
    classList: {
      add: (c) => { classes.add(c); },
      remove: (c) => { classes.delete(c); },
      contains: (c) => classes.has(c)
    },
    setAttribute() {},
    showModal() { this.open = true; },
    close() { this.open = false; },
    addEventListener: (type, fn) => { modalListeners[type] = fn; },
    removeEventListener: () => {},
    querySelector: () => null,
    querySelectorAll: () => []
  };
  const scroll = { innerHTML: '', className: '', scrollTop: 0,
    addEventListener: (type, fn) => { listeners[type] = fn; } };
  const generic = () => ({ innerHTML: '', textContent: '', addEventListener() {} });
  const ids = { scroll, modal, tabs: generic(), save: generic(), appTitle: generic(), toast: generic() };
  const document = { getElementById: (id) => ids[id] || generic(), addEventListener() {}, querySelector: () => null };
  const fn = new Function('document', 'INJECTED_SCHEMA', 'INJECTED_ENV', 'INJECTED_CFG',
    'INJECTED_USERDATA', 'INJECTED_RETURN', 'requestAnimationFrame', 'setTimeout', 'clearTimeout',
    BUNDLE);
  fn(document, SCHEMA, { color: true }, {}, {}, 'pebblejs://close#', () => 0, () => 0, () => {});
  return { modal, classes, listeners, modalListeners };
}

/**
 * A delegated click whose target matches exactly one selector.
 * @param {Function} listener The captured click listener.
 * @param {string} selector The selector the target answers to.
 * @param {Object} attrs getAttribute table for the matched node.
 * @returns {void}
 */
function clickOn(listener, selector, attrs) {
  const node = { getAttribute: (n) => (Object.prototype.hasOwnProperty.call(attrs, n) ? attrs[n] : null) };
  listener({ target: { closest: (sel) => (sel === selector ? node : null) } });
}

test('sheet: .picking is on while an inline option list is open, and off once it collapses', () => {
  const h = bootSelectSheet();
  clickOn(h.listeners.click, '[data-edit-sheet]', { 'data-edit-sheet': 'fmt' });
  assert.equal(h.modal.open, true, 'the sheet opened');
  assert.equal(h.classes.has('edit'), true);
  assert.equal(h.classes.has('picking'), false, 'a collapsed select does not grow the sheet');

  clickOn(h.modalListeners.click, '[data-select]', { 'data-select': 'sep' });
  assert.ok(h.modal.innerHTML.indexOf('class="isel-list"') !== -1, 'the list is open');
  assert.equal(h.classes.has('picking'), true, 'an open list grows the sheet');
  // With .picking on, the peek clamp stands down: it can never clip the list.
  const clampable = stubDialog(new Array(20).fill(44), 440);
  clampable.classList = { contains: (c) => h.classes.has(c) };
  E.fitSelectPeek(clampable);
  assert.equal(clampable.list.style.maxHeight, '', 'no peek clamp while .picking');

  clickOn(h.modalListeners.click, '[data-select-pick]', { 'data-k': 'sep', 'data-select-pick': 'paren' });
  assert.equal(h.classes.has('picking'), false, 'a pick collapses the list, so the sheet shrinks back');
  assert.equal(h.modal.open, true, 'and stays open');

  clickOn(h.modalListeners.click, '[data-select]', { 'data-select': 'sep' });
  assert.equal(h.classes.has('picking'), true, 'reopened');
  clickOn(h.modalListeners.click, '[data-select]', { 'data-select': 'sep' });
  assert.equal(h.classes.has('picking'), false, 'a second tap collapses it');

  clickOn(h.modalListeners.click, '[data-select]', { 'data-select': 'sep' });
  clickOn(h.modalListeners.click, '[data-select-close]', {});
  assert.equal(h.modal.open, false, 'the sheet closed');
  assert.equal(h.classes.has('picking'), false, '.picking does not survive the close');
});
