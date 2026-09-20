// test/weather-tab-interact.test.js — the Weather tab's pointer mechanics:
// the day-pan gesture's hand-off to the tab (the panned transform and the
// value tips that ride outside it), and the snap arithmetic.
const test = require('node:test');
const assert = require('node:assert/strict');
const interact = require('../src/pkjs/settings/weather-tab-interact.js');

/**
 * A document stub that records the listeners wire() attaches, so a test
 * can drive real touch sequences through the module's own handlers.
 * @returns {Object} The captured listeners, keyed by event type.
 */
function listenerHarness() {
  const listeners = {};
  // A stand-in for the panned element, so a test can read the transform
  // setPan actually wrote and compare it against what the tips were told.
  const pan = { style: {} };
  global.document = {
    addEventListener: (type, fn) => { listeners[type] = fn; },
    querySelectorAll: (sel) => (sel === '.wx-pan' ? [pan] : []),
    querySelector: () => null,
    getElementById: () => null
  };
  return { listeners, pan };
}

test('a pan drag hands its live position to the value tips, every frame', () => {
  const seen = [];
  const { listeners, pan } = listenerHarness();
  const DAYS = 3;
  /** @returns {number} the fractional day the PANELS were last moved to */
  const panelsAt = () =>
    -Number(/translateX\((-?[\d.]+)%\)/.exec(pan.style.transform)[1]) * DAYS / 100;
  try {
    interact.wire({
      view: () => ({ days: 3 }),
      day: () => 0,
      commitDay: () => {},
      scrub: () => {},
      panTips: (f, animated) => { seen.push({ f, animated }); },
      canPull: () => false,
      refresh: () => {}
    });
    const vpEl = {
      getAttribute: (a) => (a === 'data-wxvp' ? 'temp' : null),
      getBoundingClientRect: () => ({ width: 390 })
    };
    const touch = (type, x) => listeners[type]({
      touches: type === 'touchend' ? [] : [{ clientX: x, clientY: 100 }],
      changedTouches: [{ clientX: x, clientY: 100 }],
      target: vpEl,
      preventDefault: () => {}
    });

    touch('touchstart', 300);
    assert.deepEqual(seen, [], 'a press that has not moved pans nothing');

    // 100px of a 390px viewport dragged left: the panels translate by that
    // fraction of a day, and the tips — which live OUTSIDE the panned
    // element — must be handed the very same number, or they hang in
    // place while the values slide out from under them.
    touch('touchmove', 200);
    assert.equal(seen.length, 1, 'the drag hands its position to the tips');
    assert.ok(Math.abs(seen[0].f - 100 / 390) < 1e-9, 'a viewport of drag is a day');
    assert.ok(Math.abs(seen[0].f - panelsAt()) < 1e-9,
      'and it is the SAME fractional day the PANELS were translated by');

    touch('touchmove', 100);
    assert.equal(seen.length, 2, 'every frame, not just the first');
    assert.ok(Math.abs(seen[1].f - 200 / 390) < 1e-9, 'tracking the finger');
    assert.ok(Math.abs(seen[1].f - panelsAt()) < 1e-9, 'still in step with the panels');
    assert.equal(seen[1].animated, false,
      'a drag frame is unanimated — it tracks the finger, it does not chase it');

    // Rubber-banding past day 0: the panels move at 0.35x out there, so
    // the tips have to be handed the DAMPED position too — the undamped
    // one would slide them off their values at the timeline ends.
    touch('touchmove', 500);
    const damped = seen[seen.length - 1];
    assert.ok(damped.f < 0, 'dragging right at day 0 goes past the start');
    assert.ok(Math.abs(damped.f - (-200 / 390) * 0.35) < 1e-9, 'damped, not raw');
    assert.ok(Math.abs(damped.f - panelsAt()) < 1e-9,
      'and the tips get exactly what the panels got, damping included');

    // An abort eases the panels back to the resting day, so the tips have
    // to be told to travel on that curve rather than snap ahead of them.
    listeners.touchcancel({});
    const last = seen[seen.length - 1];
    assert.equal(last.f, 0, 'the abort hands back the resting day');
    assert.equal(last.animated, true, 'and flags it as an eased settle');
  } finally {
    delete global.document;
  }
});

test('snapTargetDay: flicks advance one day, slow drags round, both clamp', () => {
  // A quick flick past 12% of the viewport advances exactly one day...
  assert.equal(interact.snapTargetDay(1, -100, 390, 3, 200), 2);
  assert.equal(interact.snapTargetDay(1, 100, 390, 3, 200), 0);
  // ...while a slow drag rounds to the nearest day boundary.
  assert.equal(interact.snapTargetDay(1, -100, 390, 3, 900), 1, 'a quarter-viewport crawl stays');
  assert.equal(interact.snapTargetDay(1, -260, 390, 3, 900), 2, 'past the halfway point moves');
  // Both ends clamp to the timeline.
  assert.equal(interact.snapTargetDay(0, 300, 390, 3, 200), 0);
  assert.equal(interact.snapTargetDay(2, -300, 390, 3, 200), 2);
});

test('panPct translates by whole viewports, one per day', () => {
  assert.equal(interact.panPct(0, 3), -0);
  assert.equal(interact.panPct(1, 3), -(100 / 3));
  assert.equal(interact.panPct(2, 4), -50);
});
