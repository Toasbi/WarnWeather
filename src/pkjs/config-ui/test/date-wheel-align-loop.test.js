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
