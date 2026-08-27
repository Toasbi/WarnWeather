// src/pkjs/config-ui/test/date-wheel-align-loop.test.js
//
// Regression: the date bottom sheet used to flicker the instant it opened. alignDateWheels()
// centres each wheel by writing wheel.scrollTop; every write dispatches a 'scroll' event, and the
// wheel scroll handler answered that programmatic scroll with a 120 ms settle -> render ->
// re-align, whose alignment dispatched another scroll — a self-sustaining render loop (~8x/sec).
// The fix guards the handler with suppressWheelScroll while alignment is writing scrollTop.
//
// engine.test.js's shim gives #modal no showModal(), so syncDialog() early-returns and the
// alignment path never runs there. This harness supplies a real showModal() plus wheels whose
// scrollTop setter dispatches 'scroll' exactly as a browser does, so alignment actually fires, and
// asserts it schedules ZERO settle timers (the buggy code scheduled one per wheel).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
require('../lib/schema-walk.js');
require('../lib/color.js');
require('../lib/show-when.js');

const SCHEMA = { appName: 'X', versionLabel: 'v0', tabs: [
  { id: 't', label: 'T', sections: [{ items: [
    { type: 'date', messageKey: 'trip', label: 'Target date', defaultValue: '2026-12-24' }
  ] }] }
] };

// Boot the engine against a DOM shim, open the date sheet, and return the harness knobs.
function bootDateSheet() {
  const LIB = path.join(__dirname, '..', 'lib');
  const BUNDLE = fs.readFileSync(path.join(LIB, 'schema-walk.js'), 'utf8')
    + '\n' + fs.readFileSync(path.join(LIB, 'color.js'), 'utf8')
    + '\n' + fs.readFileSync(path.join(LIB, 'show-when.js'), 'utf8')
    + '\n' + fs.readFileSync(path.join(LIB, 'html.js'), 'utf8')
    + '\n' + fs.readFileSync(path.join(LIB, 'date-picker.js'), 'utf8')
    + '\n' + fs.readFileSync(path.join(LIB, 'range-control.js'), 'utf8')
    + '\n' + fs.readFileSync(path.join(LIB, 'engine.js'), 'utf8')
    + '\nPConf.engine.boot();';

  const listeners = {};        // #scroll listeners (click/input)
  const modalListeners = {};   // #modal listeners (click/scroll/touch...)
  const rafQueue = [];
  let settleTimers = 0;        // count of setTimeout(fn, 120) — the settle the scroll handler arms

  // A wheel whose scrollTop setter dispatches 'scroll' to the captured handler, like a browser does
  // for a programmatic scroll. Only dispatch on a real change (browsers don't fire on no-op sets),
  // so the selected option sits deep enough that centring moves scrollTop off zero.
  function makeWheel(part) {
    const wheel = {
      clientHeight: 220, offsetHeight: 44,
      getAttribute: (n) => (n === 'data-date-wheel' ? part : null),
      querySelector: (sel) => (sel === '.date-opt.on'
        ? { offsetTop: 440, offsetHeight: 44 } : null),
      closest: (sel) => (sel === '[data-date-wheel]' ? wheel : null),
      _top: 0
    };
    Object.defineProperty(wheel, 'scrollTop', {
      get() { return this._top; },
      set(v) {
        if (v === this._top) { return; }
        this._top = v;
        if (modalListeners.scroll) { modalListeners.scroll({ target: wheel }); }
      }
    });
    return wheel;
  }
  const wheels = [makeWheel('day'), makeWheel('month'), makeWheel('year')];

  const modal = {
    innerHTML: '', style: {}, open: false,
    classList: { add() {}, remove() {}, contains() { return false; } },
    setAttribute() {},
    showModal() { this.open = true; },
    close() { this.open = false; },
    addEventListener: (type, fn) => { modalListeners[type] = fn; },
    querySelector: (sel) => (sel === '.ssel-modal-ttl' ? { id: 'date-ttl-trip' } : null),
    querySelectorAll: (sel) => (sel === '[data-date-wheel]' ? wheels : [])
  };
  const scroll = { innerHTML: '', className: '',
    addEventListener: (type, fn) => { listeners[type] = fn; } };
  const generic = () => ({ innerHTML: '', textContent: '', addEventListener() {} });
  const ids = { scroll, modal, tabs: generic(), save: generic(),
    appTitle: generic(), toast: generic() };
  const document = {
    getElementById: (id) => ids[id] || generic(),
    addEventListener() {},
    querySelector: (sel) => (/^\[data-date="/.test(sel) ? { focus() {} } : null)
  };

  // Controlled timers, passed as params so they shadow the globals only inside the bundle.
  const raf = (fn) => { rafQueue.push(fn); return rafQueue.length; };
  const setT = (fn, ms) => { if (ms === 120) { settleTimers += 1; } return 0; };
  const clearT = () => {};

  const fn = new Function('document', 'INJECTED_SCHEMA', 'INJECTED_ENV', 'INJECTED_CFG',
    'INJECTED_USERDATA', 'INJECTED_RETURN', 'requestAnimationFrame', 'setTimeout', 'clearTimeout',
    BUNDLE);
  fn(document, SCHEMA, {}, {}, {}, 'pebblejs://close#', raf, setT, clearT);

  // Open the date sheet by clicking its whole-row trigger.
  const trigger = { getAttribute: (n) => (n === 'data-date' ? 'trip' : null) };
  listeners.click({ target: { closest: (s) => (s === '[data-date]' ? trigger : null) } });

  // Drain every rAF (alignment's clear-guard + safety re-align schedule more); cap to stay finite.
  function drainRaf() {
    for (let guard = 0; guard < 100 && rafQueue.length; guard += 1) {
      rafQueue.shift()();
    }
  }

  return { modalListeners, wheels, drainRaf, settle: () => settleTimers, modal };
}

test('date sheet: alignment scrolls schedule no settle (no flicker loop)', () => {
  const h = bootDateSheet();
  assert.match(h.modal.innerHTML, /data-date-picker="trip"/, 'sheet opened');
  // The opening align wrote scrollTop on all three wheels, dispatching a 'scroll' each. None may
  // arm a settle — otherwise the settle re-renders, re-aligns, and the loop flickers forever.
  assert.equal(h.settle(), 0, 'opening alignment armed a settle timer (flicker loop)');
  h.drainRaf();
  assert.equal(h.settle(), 0, 'post-layout re-align armed a settle timer (flicker loop)');
});

test('date sheet: a genuine user wheel scroll still arms a settle', () => {
  const h = bootDateSheet();
  h.drainRaf();                        // clears the suppression guard set during alignment
  // A real scroll (not driven by alignment) must still be answered with a settle -> commit.
  h.modalListeners.scroll({ target: h.wheels[0] });
  assert.equal(h.settle(), 1, 'user scroll no longer arms a settle — handler over-suppressed');
});

// --- .picking: the sheet grows while a palette is open -----------------------
// An expanded 64-swatch palette is 8 grid rows, which does not fit under the sheet's
// 80dvh cap; syncDialog puts `.picking` on the dialog while one is open and shell.html
// raises the cap to 94dvh. This harness lives here for the same reason the date one
// does: it is the only #modal shim with a real showModal(), so it is the only place
// syncDialog() runs past its `if (!dlg || !dlg.showModal) return;` guard.
//
// Node has NO layout: nothing below can tell you whether 94dvh is tall enough. What it
// proves is the state machine — the class appears with the palette and leaves with it.

/** A click event whose target.closest answers from a selector -> element map.
 * @param {Object} map Selector -> element (anything absent resolves to null).
 * @returns {{target: {closest: function(string): ?Object}}} The event stub.
 */
function clickOn(map) {
  return { target: { closest: (sel) => (Object.prototype.hasOwnProperty.call(map, sel) ? map[sel] : null) } };
}

/** An element stub answering getAttribute from an attribute map.
 * @param {Object} attrs Attribute name -> value.
 * @returns {{getAttribute: function(string): ?string, focus: function()}} The element stub.
 */
function el(attrs) {
  return { getAttribute: (n) => (Object.prototype.hasOwnProperty.call(attrs, n) ? attrs[n] : null), focus() {} };
}

// Boot the engine against a DOM shim whose #modal records its classList, then return the
// knobs to drive the sheet. The classList stub deliberately has NO toggle(): the engine
// must use add/remove (the two-argument toggle is unsafe in old Android WebViews), so a
// regression would throw here rather than pass quietly.
function bootPickingSheet() {
  const LIB = path.join(__dirname, '..', 'lib');
  const BUNDLE = ['schema-walk.js', 'color.js', 'show-when.js', 'html.js', 'date-picker.js',
    'range-control.js', 'engine.js']
    .map((f) => fs.readFileSync(path.join(LIB, f), 'utf8')).join('\n')
    + '\nPConf.engine.boot();';

  const SCHEMA = { appName: 'X', versionLabel: 'v0', tabs: [{ id: 't', label: 'T', sections: [
    { id: 'graphColors', title: 'Graph colors', items: [
      { type: 'sheet', sheetId: 'gcWind', label: 'Wind speed',
        editBadgeFrom: { resolver: 'gcBadge', args: { scope: 'wind' } } },
      // A palette and a select sheet in the BODY, for the cross-surface guard below.
      { type: 'color', messageKey: 'bodyColor', label: 'Body colour', defaultValue: 0xFF0000 },
      { type: 'select', messageKey: 'metric', label: 'Metric', defaultValue: 'wind',
        options: [['Wind', 'wind'], ['UV', 'uv']] }
    ] },
    { sheetOnly: true, sheetId: 'gcWind', title: 'Wind speed colors', items: [
      { type: 'color', messageKey: 'gcWindLineDark', label: 'Line', defaultValue: 0xFFFF00 }
    ] }
  ] }] };

  const listeners = {}, modalListeners = {}, rafQueue = [];
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
    querySelector: () => null,          // no .ssel-list / .ssel-modal-ttl / search box
    querySelectorAll: () => []
  };
  const scroll = { innerHTML: '', className: '', scrollTop: 0,
    addEventListener: (type, fn) => { listeners[type] = fn; } };
  const generic = () => ({ innerHTML: '', textContent: '', addEventListener() {} });
  const ids = { scroll, modal, tabs: generic(), save: generic(),
    appTitle: generic(), toast: generic() };
  const document = {
    getElementById: (id) => ids[id] || generic(),
    addEventListener() {},
    querySelector: () => null
  };

  const fn = new Function('document', 'INJECTED_SCHEMA', 'INJECTED_ENV', 'INJECTED_CFG',
    'INJECTED_USERDATA', 'INJECTED_RETURN', 'requestAnimationFrame', 'setTimeout', 'clearTimeout',
    BUNDLE);
  fn(document, SCHEMA, { color: true }, {}, {}, 'pebblejs://close#',
    (f) => { rafQueue.push(f); return rafQueue.length; }, () => 0, () => {});

  // The bundle installs its OWN registries over global.PConf, so app-side resolvers can
  // only be registered after it has run.
  global.PConf.badgeResolvers.register('gcBadge', function () {
    return { label: 'Edit', dots: [{ color: '#FFFF00' }, { color: '#555500', ring: true }] };
  });

  return { modal, listeners, modalListeners, classes, scroll };
}

test('sheet: .picking is added while a palette is open and removed with it', () => {
  const h = bootPickingSheet();
  assert.equal(h.classes.has('picking'), false, 'nothing open -> no picking');

  // Open the edit sheet from its Edit button.
  h.listeners.click(clickOn({ '[data-edit-sheet]': el({ 'data-edit-sheet': 'gcWind' }) }));
  assert.equal(h.modal.open, true, 'sheet opened');
  assert.ok(h.modal.innerHTML.indexOf('data-color="gcWindLineDark"') !== -1,
    'the colour row is in the sheet');
  assert.equal(h.classes.has('edit'), true, 'an edit sheet is marked .edit');
  assert.equal(h.classes.has('picking'), false, 'a closed palette does not grow the sheet');

  // Expand the palette from inside the sheet.
  h.modalListeners.click(clickOn({ '[data-color]': el({ 'data-color': 'gcWindLineDark' }) }));
  assert.ok(h.modal.innerHTML.indexOf('data-color-pick=') !== -1, 'palette rendered');
  assert.equal(h.classes.has('picking'), true, 'an open palette grows the sheet');
  assert.equal(h.classes.has('edit'), true, 'and it is still the edit sheet');

  // Pick a swatch: the palette collapses, so the sheet must shrink back.
  h.modalListeners.click(clickOn({
    '[data-color-pick]': el({ 'data-color-pick': '#FF0000', 'data-k': 'gcWindLineDark' })
  }));
  assert.equal(h.classes.has('picking'), false, 'picking dropped once the palette closes');
  assert.equal(h.modal.open, true, 'the sheet itself stays open');

  // Reopen it, then close the whole sheet: .picking must not survive the close.
  h.modalListeners.click(clickOn({ '[data-color]': el({ 'data-color': 'gcWindLineDark' }) }));
  assert.equal(h.classes.has('picking'), true, 'palette reopened');
  h.modalListeners.click(clickOn({ '[data-select-close]': el({}) }));
  assert.equal(h.modal.open, false, 'sheet closed');
  assert.equal(h.classes.has('picking'), false, 'picking cleared on close');
  assert.equal(h.classes.has('edit'), false, 'so is edit');
});

test('a palette left open in the tab body does not grow an unrelated select sheet', () => {
  // openColor is ONE variable serving palettes in both surfaces, but only the edit
  // sheet ever renders a palette inside the dialog. Keyed on openColor alone, a body
  // palette would raise the cap on (and suppress the peek clamp of) a select sheet
  // opened from the same card.
  const h = bootPickingSheet();
  h.listeners.click(clickOn({ '[data-color]': el({ 'data-color': 'bodyColor' }) }));
  assert.ok(h.scroll.innerHTML.indexOf('data-color-pick=') !== -1, 'body palette expanded');
  assert.equal(h.modal.open, false, 'a body palette opens no dialog');

  h.listeners.click(clickOn({ '[data-select]': el({ 'data-select': 'metric' }) }));
  assert.equal(h.modal.open, true, 'the select sheet opened');
  assert.equal(h.classes.has('picking'), false, 'a select sheet holds no palette, so no growth');
});
