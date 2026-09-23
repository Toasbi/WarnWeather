// src/pkjs/config-ui/test/date-wheel-held-touch.test.js
//
// Regression: the date wheel settled and re-rendered under a finger that was still down.
// A wheel scroll arms a 120 ms settle (commit the centred value, then render()). A pause
// mid-drag emits no scroll events, so the settle fired while the finger was still on the
// wheel: render() rebuilt #modal and replaced the wheel node the browser's scroll gesture
// was latched to, so the rest of the drag moved nothing and the value committed at the
// pause point. The settle now waits for the finger to lift, and the release re-arms it.
//
// Boots the real engine bundle against a DOM shim (the date-wheel-align-loop.test.js
// shape) with a virtual clock, so the engine's #modal touch listeners and the date
// picker's settle machinery are exercised together.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
require('../lib/schema-walk.js');
require('../lib/color.js');
require('../lib/show-when.js');

const SCHEMA = { appName: 'X', versionLabel: 'v0', tabs: [
  { id: 't', label: 'T', sections: [{ items: [
    { type: 'date', messageKey: 'trip', label: 'Target date', defaultValue: '2026-03-01' }
  ] }] }
] };

// Wheel geometry as shell.html lays it out: 220px tall, 88px top padding, 44px options.
// Centre = scrollTop + 110 and option v's centre = 110 + (v - first) * 44, so
// scrollTop = (v - first) * 44 centres value v.
const OPT_H = 44, PAD = 88, WHEEL_H = 220;

/**
 * Boot the engine with the date sheet open.
 * @returns {Object} Harness knobs.
 */
function bootDateSheet() {
  const LIB = path.join(__dirname, '..', 'lib');
  const BUNDLE = ['schema-walk.js', 'color.js', 'show-when.js', 'html.js', 'date-picker.js',
    'range-control.js', 'engine.js']
    .map((f) => fs.readFileSync(path.join(LIB, f), 'utf8')).join('\n')
    + '\nPConf.engine.boot();';

  const listeners = {}, modalListeners = {}, rafQueue = [];
  let renders = 0;

  // Virtual clock: setTimeout/clearTimeout are shadowed inside the bundle only.
  let now = 0, nextId = 1;
  const timers = new Map();
  const setT = (fn, ms) => { const id = nextId++; timers.set(id, { at: now + ms, fn }); return id; };
  const clearT = (id) => { timers.delete(id); };
  function advance(ms) {
    const end = now + ms;
    for (;;) {
      let due = null;
      timers.forEach((t, id) => { if (t.at <= end && (!due || t.at < due.t.at)) { due = { id, t }; } });
      if (!due) { break; }
      timers.delete(due.id);
      now = due.t.at;
      due.t.fn();
    }
    now = end;
  }

  // One wheel per part, its options read back out of the rendered sheet so they always
  // match what render() last produced (the day list is 28–31 long depending on month).
  function makeWheel(part) {
    const wheel = {
      clientHeight: WHEEL_H,
      getAttribute: (n) => (n === 'data-date-wheel' ? part : null),
      closest: (sel) => (sel === '[data-date-wheel]' ? wheel : null),
      querySelectorAll: (sel) => (sel === '.date-opt' ? options(part) : []),
      querySelector: (sel) => (sel === '.date-opt.on'
        ? options(part).filter((o) => o.on)[0] || null : null),
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
  function options(part) {
    const m = new RegExp('data-date-wheel="' + part + '">(.*?)</div>').exec(modal.innerHTML);
    if (!m) { return []; }
    const out = [];
    m[1].replace(/class="date-opt( on)?" data-date-value="(\d+)"/g, (all, on, v) => {
      out.push({ on: Boolean(on), offsetTop: PAD + out.length * OPT_H, offsetHeight: OPT_H,
        getAttribute: (n) => (n === 'data-date-value' ? v : null) });
      return all;
    });
    return out;
  }
  const wheels = { day: makeWheel('day'), month: makeWheel('month'), year: makeWheel('year') };

  let html = '';
  const modal = {
    style: {}, open: false,
    classList: { add() {}, remove() {}, contains() { return false; } },
    setAttribute() {},
    showModal() { this.open = true; },
    close() { this.open = false; },
    addEventListener: (type, fn) => { modalListeners[type] = fn; },
    removeEventListener() {},
    querySelector: (sel) => (sel === '.ssel-modal-ttl' ? { id: 'date-ttl-trip' } : null),
    querySelectorAll: (sel) => (sel === '[data-date-wheel]'
      ? [wheels.day, wheels.month, wheels.year] : [])
  };
  Object.defineProperty(modal, 'innerHTML', {
    get() { return html; },
    set(v) { if (v) { renders += 1; } html = v; }
  });
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

  const fn = new Function('document', 'INJECTED_SCHEMA', 'INJECTED_ENV', 'INJECTED_CFG',
    'INJECTED_USERDATA', 'INJECTED_RETURN', 'requestAnimationFrame', 'setTimeout', 'clearTimeout',
    BUNDLE);
  fn(document, SCHEMA, {}, {}, {}, 'pebblejs://close#',
    (f) => { rafQueue.push(f); return rafQueue.length; }, setT, clearT);

  const trigger = { getAttribute: (n) => (n === 'data-date' ? 'trip' : null) };
  listeners.click({ target: { closest: (s) => (s === '[data-date]' ? trigger : null) } });
  // Drain the alignment rAFs so the suppression guard is down and user scrolls count.
  for (let guard = 0; guard < 100 && rafQueue.length; guard += 1) { rafQueue.shift()(); }

  return {
    modal, modalListeners, wheels, advance, scroll,
    renders: () => renders,
    /** @returns {?string} The day the sheet currently renders as selected. */
    selectedDay: () => (options('day').filter((o) => o.on)[0] || { getAttribute: () => null })
      .getAttribute('data-date-value'),
    touch: (type, fingers) => modalListeners[type]({
      target: wheels.day, touches: fingers, changedTouches: [{ clientY: 300 }] })
  };
}

test('date sheet: the harness opens on the default date', () => {
  const h = bootDateSheet();
  assert.equal(h.modal.open, true);
  assert.equal(h.selectedDay(), '1');
});

test('date wheel: without a finger down, a scroll still settles after 120 ms', () => {
  const h = bootDateSheet();
  const before = h.renders();
  h.wheels.day.scrollTop = 1 * OPT_H;           // a fling that came to rest on day 2
  h.advance(119);
  assert.equal(h.renders(), before, 'not before the idle window');
  h.advance(1);
  assert.equal(h.renders(), before + 1, 'the settle re-renders once');
  assert.equal(h.selectedDay(), '2');
});

test('date wheel: no settle under a held finger; the release commits once', () => {
  const h = bootDateSheet();
  const before = h.renders();
  h.touch('touchstart', [{ clientY: 300 }]);
  h.wheels.day.scrollTop = 1 * OPT_H;           // drag to day 2 ...
  h.advance(400);                               // ... and hold still past the idle window
  assert.equal(h.renders(), before,
    'the settle re-rendered the wheel under the finger (freezes the rest of the drag)');
  assert.equal(h.selectedDay(), '1', 'nothing committed while the finger is down');

  h.wheels.day.scrollTop = 3 * OPT_H;           // the drag goes on to day 4
  h.advance(400);
  assert.equal(h.renders(), before, 'still held: still no settle');

  h.touch('touchend', []);                      // lifted exactly on a snap point: no more scroll
  h.advance(119);
  assert.equal(h.renders(), before, 'the release waits the idle window, for a fling to start');
  h.advance(1);
  assert.equal(h.renders(), before + 1, 'the release re-arms the settle: exactly one commit');
  assert.equal(h.selectedDay(), '4', 'commits where the drag ended, not where it paused');
  h.advance(1000);
  assert.equal(h.renders(), before + 1, 'and only once');
});

test('date wheel: a fling after the release keeps deferring the settle as before', () => {
  const h = bootDateSheet();
  const before = h.renders();
  h.touch('touchstart', [{ clientY: 300 }]);
  h.wheels.day.scrollTop = 1 * OPT_H;
  h.touch('touchend', []);
  h.advance(60);
  h.wheels.day.scrollTop = 2 * OPT_H;           // momentum still moving the wheel
  h.advance(100);
  assert.equal(h.renders(), before, 'the momentum scroll re-armed the settle');
  h.advance(20);
  assert.equal(h.renders(), before + 1);
  assert.equal(h.selectedDay(), '3');
});

test('date wheel: a cancelled touch releases the hold like a touchend', () => {
  const h = bootDateSheet();
  const before = h.renders();
  h.touch('touchstart', [{ clientY: 300 }]);
  h.wheels.day.scrollTop = 1 * OPT_H;
  h.advance(400);
  assert.equal(h.renders(), before);
  h.touch('touchcancel', []);
  h.advance(120);
  assert.equal(h.renders(), before + 1);
  assert.equal(h.selectedDay(), '2');
});

test('date wheel: lifting one finger of two keeps the hold', () => {
  const h = bootDateSheet();
  const before = h.renders();
  h.touch('touchstart', [{ clientY: 300 }]);
  h.touch('touchstart', [{ clientY: 300 }, { clientY: 400 }]);
  h.wheels.day.scrollTop = 1 * OPT_H;
  h.touch('touchend', [{ clientY: 300 }]);      // one finger still down
  h.advance(400);
  assert.equal(h.renders(), before, 'a finger is still on the sheet');
  h.touch('touchend', []);
  h.advance(120);
  assert.equal(h.renders(), before + 1);
  assert.equal(h.selectedDay(), '2');
});

test('date wheel: closing the sheet mid-hold still commits the wheel', () => {
  const h = bootDateSheet();
  h.touch('touchstart', [{ clientY: 300 }]);
  h.wheels.day.scrollTop = 1 * OPT_H;
  h.advance(400);
  h.modalListeners.click({ target: { closest: (s) => (s === '[data-select-close]' ? {} : null) } });
  assert.equal(h.modal.open, false, 'sheet closed');
  assert.match(h.scroll.innerHTML, /<span>2 Mar 2026<\/span>/, 'the close flushed the held wheel');
  h.touch('touchend', []);                      // the finger lifts after the sheet is gone
  h.advance(1000);
  assert.equal(h.modal.open, false, 'no stray settle re-opened anything');
  assert.match(h.scroll.innerHTML, /<span>2 Mar 2026<\/span>/);
});
