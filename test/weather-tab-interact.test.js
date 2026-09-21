// test/weather-tab-interact.test.js — the Weather tab's pointer mechanics:
// the day-pan gesture's hand-off to the tab (the panned transform and the
// value tips that ride outside it), and the snap arithmetic.
const test = require('node:test');
const assert = require('node:assert/strict');
const interact = require('../src/pkjs/settings/weather-tab-interact.js');

/**
 * A document stub that records the listeners wire() attaches, so a test can
 * drive real touch sequences through the module's own handlers.
 *
 * Built ONCE for the file: the module attaches its listeners on the first
 * wire() call only, so a second stub would capture nothing. Later wire()
 * calls still swap the hooks, which is what each test needs.
 * @returns {Object} The captured listeners plus the stand-in elements.
 */
function listenerHarness() {
  const listeners = {};
  // A stand-in for the panned element, so a test can read the transform
  // setPan actually wrote and compare it against what the tips were told.
  const pan = { style: {} };
  const h = { listeners, pan, row: null };
  global.document = {
    addEventListener: (type, fn) => { listeners[type] = fn; },
    querySelectorAll: (sel) => (sel === '.wx-pan' ? [pan] : []),
    querySelector: (sel) => (sel === '.wx-days' ? h.row : null),
    getElementById: () => null
  };
  return h;
}

const HARNESS = listenerHarness();

/**
 * A day-tile row measured like the real one: 390px viewport, tiles 28% of
 * it wide, 6px gaps and the 8px edge margins the stylesheet gives the first
 * and last tile.
 * @param {number} n Tile count.
 * @returns {Object} A row stub for document.querySelector('.wx-days').
 */
function tileRow(n) {
  const W = 390, TILE = W * 0.28, PITCH = TILE + 6;
  const children = [];
  for (let i = 0; i < n; i += 1) {
    children.push({ offsetLeft: interact.EDGE_PAD + i * PITCH, offsetWidth: TILE });
  }
  return { style: {}, children, parentNode: { clientWidth: W } };
}

/** @returns {number} the px the tile row was last translated by (positive = scrolled right) */
function rowAt() {
  const v = Number(/translateX\((-?[\d.]+)px\)/.exec(HARNESS.row.style.transform)[1]);
  return v === 0 ? 0 : -v;   // -0 is a different value to assert.equal
}

test('a pan drag hands its live position to the value tips, every frame', () => {
  const seen = [];
  const strip = [];
  const { listeners, pan } = HARNESS;
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
      panStrip: (f, animated) => { strip.push({ f, animated }); },
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
    assert.deepEqual(strip, [], 'and moves no tiles either');

    // 100px of a 390px viewport dragged left: the panels translate by that
    // fraction of a day, and the tips — which live OUTSIDE the panned
    // element — must be handed the very same number, or they hang in
    // place while the values slide out from under them.
    touch('touchmove', 200);
    assert.equal(seen.length, 1, 'the drag hands its position to the tips');
    assert.ok(Math.abs(seen[0].f - 100 / 390) < 1e-9, 'a viewport of drag is a day');
    assert.ok(Math.abs(seen[0].f - panelsAt()) < 1e-9,
      'and it is the SAME fractional day the PANELS were translated by');

    assert.deepEqual(strip[0], seen[0],
      'the day tiles ride the SAME drag frame — they are part of the movement, '
      + 'not a strip that catches up once the finger lifts');

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
    assert.deepEqual(strip[strip.length - 1], last,
      'and the tiles travel home on that same curve');
  } finally {
    HARNESS.row = null;
  }
});

test('the tile row moves on EVERY day, by an equal step, and stops flush', () => {
  // 5 tiles of 109.2px on a 390px viewport: 586px of content, so the row
  // has 196px of travel — 49px per day change.
  HARNESS.row = tileRow(5);
  try {
    const at = [0, 1, 2, 3, 4].map((d) => { interact.setDayStrip(d, 5, false); return rowAt(); });
    assert.deepEqual(at, [0, 49, 98, 147, 196],
      'one equal step per day: the tiles are part of the pan, so the '
      + 'commonest swipe of all — today to tomorrow — has to move them');
    assert.equal(at[0], 0, 'and the first day still starts flush');
    assert.equal(at[4], 196, 'the last one ends flush, with its margin showing');
    assert.equal(HARNESS.row.style.transition, 'none',
      'a drag frame tracks the finger — no easing');

    // Mid-drag the row is BETWEEN two rests, in proportion: that is what
    // makes it read as one movement with the panels rather than a jump
    // after the fact.
    interact.setDayStrip(2.5, 5, false);
    assert.equal(rowAt(), 122.5, 'halfway across is halfway between the rests');
    interact.setDayStrip(2.25, 5, false);
    assert.equal(rowAt(), 110.3);

    // The panels rubber-band past the ends; the tiles have nowhere to go.
    interact.setDayStrip(-0.4, 5, false);
    assert.equal(rowAt(), 0, 'dragging past the start moves no tiles');
    interact.setDayStrip(4.6, 5, false);
    assert.equal(rowAt(), 196, 'nor past the end');

    // A provider can report more daily rows than there are hours for; those
    // tiles are rendered but not selectable, so the row's travel ends at the
    // LAST SELECTABLE tile — otherwise the last day would scroll itself off
    // to the left to make room for days nobody can open.
    HARNESS.row = tileRow(7);
    interact.setDayStrip(4, 5, false);
    assert.equal(rowAt(), 196, 'the two extra tiles add no travel');
    interact.setDayStrip(5, 5, false);
    assert.equal(rowAt(), 196, 'and day 4 is as far as a 5-day timeline goes');

    // A row that fits has nothing to move.
    HARNESS.row = tileRow(2);
    interact.setDayStrip(1, 2, false);
    assert.equal(rowAt(), 0, 'two tiles fit the viewport: no travel at all');

    HARNESS.row = tileRow(5);
    interact.setDayStrip(1, 5, true);
    assert.equal(HARNESS.row.style.transition, 'transform ' + interact.SETTLE_CSS,
      'a landed day is written through the shared settle curve');
  } finally {
    HARNESS.row = null;
  }
});

test('the click that ends a pan is swallowed, so a swipe never taps a tile', () => {
  const { listeners } = HARNESS;
  let landed = null;
  // A controlled clock: the suppression window is a duration, and an
  // earlier test's pan would otherwise still be inside it.
  const realNow = Date.now;
  let clock = realNow() + 10000;
  Date.now = () => clock;
  try {
  interact.wire({
    view: () => ({ days: 3 }),
    day: () => 0,
    commitDay: (d) => { landed = d; },
    scrub: () => {},
    panTips: () => {},
    panStrip: () => {},
    canPull: () => false,
    refresh: () => {}
  });
  const vpEl = {
    getAttribute: (a) => (a === 'data-wxvp' ? 'days' : null),
    getBoundingClientRect: () => ({ width: 390 })
  };
  const touch = (type, x) => listeners[type]({
    touches: type === 'touchend' ? [] : [{ clientX: x, clientY: 100 }],
    changedTouches: [{ clientX: x, clientY: 100 }],
    target: vpEl,
    preventDefault: () => {}
  });

    // A tap on a tile is NOT a pan: it must still reach the day it hit.
    touch('touchstart', 300);
    touch('touchend', 300);
    assert.equal(interact.tapSuppressed(), false,
      'a press that never moved leaves taps alone');

    // A drag that starts on the tiles ends over one of them, and the click
    // that follows the release would otherwise jump to whatever day the
    // finger happened to lift over.
    touch('touchstart', 300);
    touch('touchmove', 200);
    touch('touchend', 200);
    assert.equal(landed, 1, 'the drag itself lands the day');
    assert.equal(interact.tapSuppressed(), true, 'and the trailing click is swallowed');

    clock += 1000;
    assert.equal(interact.tapSuppressed(), false,
      'a second later the user is tapping again, not finishing a swipe');
  } finally {
    Date.now = realNow;
  }
});

test('a day change TRAVELS, and the clock that waits for it is the clock that runs it', () => {
  // A released pan glides onto its day instead of cutting to it. Everything
  // that moves with the day reads these two — panels, tile row, value tips,
  // and the tiles' highlight through the stylesheet — so pinning them here
  // pins the lot.
  const ms = /^([\d.]+)s\b/.exec(interact.SETTLE_CSS);
  assert.ok(ms, 'the settle is a real CSS duration: ' + interact.SETTLE_CSS);
  assert.ok(Number(ms[1]) > 0, 'the release is animated, not a cut');
  // The JS timers that wait for the motion to end and the CSS that performs
  // it are two statements of one fact. Drift either way is a bug you only
  // see as a flicker: too short and the tip snaps back before the row lands,
  // too long and the crosshair sits dead for the difference.
  assert.equal(interact.SETTLE_MS, Number(ms[1]) * 1000,
    'the millisecond count IS the CSS duration (' + interact.SETTLE_CSS
    + ' vs ' + interact.SETTLE_MS + 'ms)');
  // Slow enough to read as motion, short enough that the answer is not
  // withheld: a day change is navigation, and navigation you wait for is
  // navigation you stop using.
  assert.ok(interact.SETTLE_MS >= 250 && interact.SETTLE_MS <= 600,
    'a glide, not a crawl (' + interact.SETTLE_MS + 'ms)');
  // Decelerating: the distance is covered early and the last of it settles.
  assert.match(interact.SETTLE_CSS, /cubic-bezier|ease-out/,
    'the curve comes to rest rather than stopping dead');
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

test('the clipped tile viewport is never left holding a scroll offset', () => {
  // overflow:hidden stops the USER scrolling the box, not the engine:
  // bringing a focused tile into view scrolls it anyway (Chrome moves it
  // 186px to reveal the last tile). The row's position is a transform the
  // viewed day owns, so an offset underneath it is a silent desync.
  const vp = { className: 'wx-daysvp', scrollLeft: 186 };
  HARNESS.listeners.scroll({ target: vp });
  assert.equal(vp.scrollLeft, 0, 'the offset is taken straight back out');

  const other = { className: 'res', scrollLeft: 50 };
  HARNESS.listeners.scroll({ target: other });
  assert.equal(other.scrollLeft, 50, 'every other scroller is left alone');
  // The page's own scroll fires this listener on elements that have no
  // className at all (document, and the scrolling element in some engines).
  HARNESS.listeners.scroll({ target: {} });
  HARNESS.listeners.scroll({});
});

test('tabbing to a tile selects its day; pressing one leaves that to the click', () => {
  const landed = [];
  interact.wire({
    view: () => ({ days: 5 }),
    day: () => 0,
    commitDay: (d) => { landed.push(d); },
    scrub: () => {},
    panTips: () => {},
    panStrip: () => {},
    canPull: () => false,
    refresh: () => {}
  });
  const inVp = (vpName) => ({
    getAttribute: (a) => (a === 'data-wxvp' ? vpName : null),
    parentNode: null
  });
  const tile = (day, vpName) => ({
    getAttribute: (a) => (a === 'data-action-arg' ? String(day) : null),
    parentNode: inVp(vpName === undefined ? 'days' : vpName)
  });

  // Keyboard focus: the browser would scroll the clipped box to reveal the
  // tile; selecting its day moves the row the way everything else does.
  HARNESS.listeners.focusin({ target: tile(3) });
  assert.deepEqual(landed, [3], 'focus lands the day');

  HARNESS.listeners.focusin({ target: tile(0) });
  assert.deepEqual(landed, [3], 'the day already shown needs no commit');

  HARNESS.listeners.focusin({ target: tile(9) });
  assert.deepEqual(landed, [3], 'a day past the timeline is not selectable');

  HARNESS.listeners.focusin({ target: tile(2, 'temp') });
  assert.deepEqual(landed, [3], 'focus elsewhere on the page is none of our business');

  HARNESS.listeners.focusin({ target: { getAttribute: () => null, parentNode: inVp('days') } });
  assert.deepEqual(landed, [3], 'something else inside the row carries no day');

  // A press focuses the tile BEFORE the click, and before a drag that
  // starts there has moved a pixel — honouring that focus would jump the
  // day out from under the gesture.
  const vpEl = {
    getAttribute: (a) => (a === 'data-wxvp' ? 'days' : null),
    getBoundingClientRect: () => ({ width: 390 })
  };
  HARNESS.listeners.touchstart({
    touches: [{ clientX: 300, clientY: 100 }], target: vpEl, preventDefault: () => {}
  });
  HARNESS.listeners.focusin({ target: tile(4) });
  assert.deepEqual(landed, [3], 'a press-focus is left to the click handler');
  HARNESS.listeners.touchend({ touches: [], changedTouches: [{ clientX: 300, clientY: 100 }] });
});

test('a rotation re-measures the row, whose transform is in PIXELS', () => {
  // The panels pan in percent and survive a resize untouched; this row is
  // measured, so its old-day pixels would leave the viewed day hanging off
  // the edge (measured: 52px past a 320px viewport).
  const winL = {};
  const docL = {};
  const realWindow = global.window;
  global.window = { addEventListener: (t, fn) => { winL[t] = fn; } };
  const saveDoc = global.document;
  global.document = {
    addEventListener: (t, fn) => { docL[t] = fn; },
    querySelectorAll: () => [],
    querySelector: () => null,
    getElementById: () => null
  };
  const key = require.resolve('../src/pkjs/settings/weather-tab-interact.js');
  const cached = require.cache[key];
  delete require.cache[key];
  try {
    const fresh = require('../src/pkjs/settings/weather-tab-interact.js');
    const moved = [];
    fresh.wire({
      view: () => ({ days: 5 }),
      day: () => 2,
      commitDay: () => {},
      scrub: () => {},
      panTips: () => {},
      panStrip: (f, animated) => { moved.push({ f, animated }); },
      canPull: () => false,
      refresh: () => {}
    });
    assert.ok(winL.resize, 'the module listens for a resize');
    winL.resize();
    assert.deepEqual(moved, [{ f: 2, animated: false }],
      'the row is put back under the day it is showing, without an animation');
  } finally {
    require.cache[key] = cached;
    global.window = realWindow;
    global.document = saveDoc;
  }
});
