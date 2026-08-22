// test/config-wizard-carousel.test.js
//
// centerCar's snap-suppression flag vs REAL browser scroll semantics. The main
// wizard suite's fake DOM dispatches scroll listeners synchronously from the
// scrollLeft setter and models no clamping, so it can never exercise the
// clamped/rounded-back path: a programmatic centering assignment the browser
// clamps back to the current position (first/last card) fires NO scroll event,
// and an armed suppressCarSnap flag would sit stale and eat the first event of
// the user's next real swipe. This fake clamps like a browser and can queue
// events (async dispatch, the real WebView shape) or fire them synchronously.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

global.PConf = {};
require('../src/pkjs/config-ui/lib/schema-walk.js');
require('../src/pkjs/config-ui/lib/color.js');
require('../src/pkjs/config-ui/lib/engine.js');
require('../src/pkjs/settings/blocks.js');
require('../src/pkjs/settings/reset-status-defaults.js');
const schema = require('../src/pkjs/settings/schema.js');
const eng = require('../src/pkjs/config-ui/lib/engine.js');
const platform = require('../src/pkjs/config-ui/lib/platform.js');
require('../src/pkjs/settings/wizard.js');
const PConf = global.PConf;

function wizCtx(saved) {
  const ENV = platform.computeEnv({ platform: 'basalt' });
  return { S: eng.hydrate(schema, saved || {}, ENV), ENV, schema, cfg: { onboardingDone: true } };
}

// Fake DOM with a CLAMPING scrollLeft setter; dispatch 'sync' | 'async'
// (async queues scroll listeners for a manual flush, like a real event loop).
function fakeDom(mode) {
  const listeners = { click: [] };
  let car = null;
  const queue = [];

  function makeCar(html) {
    const cards = [];
    const re = /class="wiz-card( on)?" data-wiz-idx-val="([^"]+)"/g;
    let m;
    while ((m = re.exec(html))) {
      cards.push({ className: 'wiz-card' + (m[1] || ''), offsetLeft: cards.length * 162, offsetWidth: 150, val: m[2] });
    }
    const scrollFns = [];
    let scrollLeft = 0;
    const maxScroll = Math.max(0, cards.length * 162 - 12 - 178); // scrollWidth - clientWidth-ish
    const el = {
      cards,
      clientWidth: 178,
      getAttribute: (n) => (n === 'data-wiz-car' ? 'layoutPreset' : null),
      addEventListener: (ev, fn) => { if (ev === 'scroll') { scrollFns.push(fn); } },
      querySelector: (sel) => (sel === '.wiz-card.on'
        ? cards.find((c) => c.className.indexOf(' on') >= 0) || null : null),
      querySelectorAll: (sel) => (sel === '.wiz-card' ? cards : []),
      parentNode: { querySelector: () => null }
    };
    Object.defineProperty(el, 'scrollLeft', {
      get: () => scrollLeft,
      set: (v) => {
        const clamped = Math.max(0, Math.min(maxScroll, v)); // real-browser clamp
        const moved = clamped !== scrollLeft;
        scrollLeft = clamped;
        if (moved) {
          if (mode === 'sync') { scrollFns.forEach((fn) => fn()); }
          else { scrollFns.forEach((fn) => queue.push(fn)); }
        }
      }
    });
    return el;
  }

  const title = { textContent: '' };
  const foot = { innerHTML: '' };
  const body = {};
  let bodyHtml = '';
  Object.defineProperty(body, 'innerHTML', {
    get: () => bodyHtml,
    set: (h) => { bodyHtml = h; car = h.indexOf('data-wiz-car="') >= 0 ? makeCar(h) : null; }
  });

  const overlay = {
    id: '', innerHTML: '',
    addEventListener: (ev, fn) => { (listeners[ev] = listeners[ev] || []).push(fn); },
    querySelector: (sel) => {
      if (sel === '[data-wiz-title]') { return title; }
      if (sel === '[data-wiz-body]') { return body; }
      if (sel === '[data-wiz-foot]') { return foot; }
      if (sel === '.wiz-car' || sel.indexOf('data-wiz-car=') >= 0) { return car; }
      return null;
    },
    querySelectorAll: () => [],
    parentNode: null,
    click: (closest) => (listeners.click || []).forEach((fn) => fn({ target: { closest } }))
  };

  global.document = {
    getElementById: () => null,
    createElement: (tag) => (tag === 'div' ? overlay : { id: '', textContent: '' }),
    head: { appendChild: () => {} },
    body: { appendChild: () => {} }
  };
  return {
    overlay,
    getCar: () => car,
    flush: () => { const q = queue.splice(0); q.forEach((fn) => fn()); },
    queued: () => queue.length,
    next: () => overlay.click((sel) => (sel === '[data-wiz-nav]' ? { getAttribute: () => 'next' } : null)),
    back: () => overlay.click((sel) => (sel === '[data-wiz-nav]' ? { getAttribute: () => 'back' } : null))
  };
}

// The snap commit sits behind a 90 ms debounce inside wizard.js — wait it out.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('clamped-back centering disarms: the next single-event swipe commits', async () => {
  // On card = first option => target is negative, clamps back to 0: no scroll
  // event ever fires, so the armed flag MUST be disarmed by centerCar itself.
  const dom = fakeDom('async');
  const ctx = wizCtx({ layoutPreset: 'fullCal', onboardingDone: true });
  PConf.hooks.runReady(ctx);
  PConf.actions.startWizard();
  dom.next(); // welcome -> layout
  assert.equal(dom.queued(), 0, 'clamped-back assignment fired no scroll event');
  dom.getCar().scrollLeft = 162; // user swipe, ONE event only
  dom.flush();
  await sleep(150);
  assert.equal(ctx.S.layoutPreset, 'compactCal',
    'the single swipe event after a clamped centering must commit, not be eaten');
});

test('async-dispatch centering is suppressed once, later swipes commit', async () => {
  // compactDense coerces the SELECTION to compactCal: the centering scroll
  // moves, its late event must be suppressed (no coerced commit), and a
  // later real swipe must still commit normally.
  const dom = fakeDom('async');
  const ctx = wizCtx({ layoutPreset: 'compactDense', onboardingDone: true });
  PConf.hooks.runReady(ctx);
  PConf.actions.startWizard();
  dom.next();
  assert.equal(dom.queued(), 1, 'centering fired one queued event');
  dom.flush(); // delivered late, must be suppressed
  await sleep(150);
  assert.equal(ctx.S.layoutPreset, 'compactDense',
    'the async centering event must not commit the coerced card');
  dom.getCar().scrollLeft = 0; // single-event swipe toward fullCal
  dom.flush();
  await sleep(150);
  assert.equal(ctx.S.layoutPreset, 'fullCal', 'a later real swipe commits');
});

test('sync-dispatch centering consumes the flag once, no re-suppression', async () => {
  // Engines may fire scroll synchronously from the setter: the handler
  // consumes the flag mid-assignment, and centerCar's post-assignment disarm
  // must not re-suppress the user's next swipe.
  const dom = fakeDom('sync');
  const ctx = wizCtx({ layoutPreset: 'compactDense', onboardingDone: true });
  PConf.hooks.runReady(ctx);
  PConf.actions.startWizard();
  dom.next();
  await sleep(150);
  assert.equal(ctx.S.layoutPreset, 'compactDense', 'sync centering event suppressed');
  dom.getCar().scrollLeft = 0; // single-event swipe (sync dispatch)
  await sleep(150);
  assert.equal(ctx.S.layoutPreset, 'fullCal',
    'a swipe right after sync-dispatch centering must commit');
});

test('repeated centerCar across re-renders leaves no stale armed flag', async () => {
  const dom = fakeDom('async');
  const ctx = wizCtx({ layoutPreset: 'fullCal', onboardingDone: true });
  PConf.hooks.runReady(ctx);
  PConf.actions.startWizard();
  dom.next();            // layout render 1 (clamped-back, no event)
  dom.back();            // welcome
  dom.next();            // layout render 2 (fresh car, clamped-back again)
  assert.equal(dom.queued(), 0, 'no events queued across re-renders');
  dom.getCar().scrollLeft = 162; // single-event swipe
  dom.flush();
  await sleep(150);
  assert.equal(ctx.S.layoutPreset, 'compactCal', 'swipe after re-renders commits');
});
