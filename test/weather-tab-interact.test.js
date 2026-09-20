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
  global.document = {
    addEventListener: (type, fn) => { listeners[type] = fn; },
    querySelectorAll: () => [],
    querySelector: () => null,
    getElementById: () => null
  };
  return listeners;
}

test('a pan drag hands its live position to the value tips, every frame', () => {
  const seen = [];
  const listeners = listenerHarness();
  try {
    interact.wire({
      view: () => ({ days: 3 }),
      day: () => 0,
      commitDay: () => {},
      scrub: () => {},
      panTips: (f) => { seen.push(f); },
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
    assert.ok(Math.abs(seen[0] - 100 / 390) < 1e-9,
      'and it is the SAME fractional day the panels are translated by');

    touch('touchmove', 100);
    assert.equal(seen.length, 2, 'every frame, not just the first');
    assert.ok(Math.abs(seen[1] - 200 / 390) < 1e-9, 'tracking the finger');
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
