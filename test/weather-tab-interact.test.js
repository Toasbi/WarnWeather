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
  const VW = 390;
  // A stand-in for the panned element, so a test can read the transform
  // setPan actually wrote and compare it against what the tips were told.
  // Its BOX is where the transform has actually left it — h.live, in days —
  // which is what beginGesture reads to find out where the page is. Layout
  // is only served once a test sets h.live: the others have none to read,
  // and a null there is the module's own "fall back to the committed day".
  const pan = {
    style: {},
    getBoundingClientRect: () => ({ left: -h.live * VW, width: VW * h.liveDays }),
    parentNode: { clientWidth: VW, getBoundingClientRect: () => ({ left: 0, width: VW }) }
  };
  const h = { listeners, pan, row: null, live: null, liveDays: 3 };
  global.document = {
    addEventListener: (type, fn) => { listeners[type] = fn; },
    querySelectorAll: (sel) => (sel === '.wx-pan' ? [pan] : []),
    querySelector: (sel) => {
      if (sel === '.wx-days') { return h.row; }
      if (sel === '.wx-pan' && h.live !== null) { return pan; }
      return null;
    },
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

test('a swipe started mid-settle picks the page up where it IS, not where it is going', () => {
  // A release commits the destination day and starts the settle. A finger
  // down 50ms later is looking at a page BETWEEN two days — and the first
  // move frame writes transition:'none', which cancels the curve and puts
  // the tab wherever the gesture says it started. Taking that from the
  // committed day meant the whole tab teleported the rest of the way in one
  // frame: on a 390px viewport, a ~190px jolt in the frame the user
  // expected to keep gliding. Flicking day to day is how you cross five
  // days, so this was every other swipe.
  const { listeners, pan } = HARNESS;
  const DAYS = 3;
  const seen = [];
  const panelsAt = () =>
    -Number(/translateX\((-?[\d.]+)%\)/.exec(pan.style.transform)[1]) * DAYS / 100;
  // Halfway home to day 1, which the last release already committed.
  HARNESS.live = 0.49;
  HARNESS.liveDays = DAYS;
  try {
    interact.wire({
      view: () => ({ days: DAYS }),
      day: () => 1,
      commitDay: () => {},
      scrub: () => {},
      panTips: (f) => { seen.push(f); },
      panStrip: () => {},
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
    touch('touchmove', 200);           // 100px further left, a quarter day
    const want = 0.49 + 100 / 390;
    assert.ok(Math.abs(panelsAt() - want) < 1e-9,
      'the drag continues from the visible position (' + panelsAt() + ' vs ' + want + ')');
    assert.ok(Math.abs(seen[seen.length - 1] - want) < 1e-9,
      'and the tips are handed the same number, as on any other frame');
    // Stated as the thing that must NOT happen, because the failure is a
    // jump and a jump is only visible as a difference.
    assert.ok(Math.abs(panelsAt() - (1 + 100 / 390)) > 0.4,
      'not the committed day, which would be half a viewport of teleport');
    listeners.touchcancel({});

    // The reading only wins while it is credible. A layout read can land
    // mid-reflow, and a transform nobody has written yet reads as zero —
    // either way the committed day is the better answer, so a position the
    // timeline could not be in is discarded rather than obeyed.
    HARNESS.live = 9;                  // day 9 of a 3-day timeline
    seen.length = 0;
    touch('touchstart', 300);
    touch('touchmove', 200);
    assert.ok(Math.abs(panelsAt() - (1 + 100 / 390)) < 1e-9,
      'an impossible reading stands down for the committed day (got '
      + panelsAt() + ')');
    listeners.touchcancel({});
  } finally {
    HARNESS.live = null;
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
    assert.equal(HARNESS.row.style.transition, 'transform ' + interact.settleCss(),
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

/**
 * The speed profile of a CSS cubic-bezier, sampled along its own parameter:
 * dy/dx is how fast the animation is moving relative to its own average.
 * @param {string} css A transition tail containing a cubic-bezier().
 * @returns {Array<number>} Speeds, start to finish.
 */
function speeds(css) {
  const m = /cubic-bezier\(([\d.]+),\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)\)/.exec(css);
  assert.ok(m, 'a settle names a cubic-bezier: ' + css);
  const x1 = Number(m[1]), y1 = Number(m[2]), x2 = Number(m[3]), y2 = Number(m[4]);
  const out = [];
  for (let i = 1; i < 100; i += 1) {
    const s = i / 100;
    const dx = 3 * (1 - s) * (1 - s) * x1 + 6 * (1 - s) * s * (x2 - x1) + 3 * s * s * (1 - x2);
    const dy = 3 * (1 - s) * (1 - s) * y1 + 6 * (1 - s) * s * (y2 - y1) + 3 * s * s * (1 - y2);
    if (dx > 1e-9) { out.push(dy / dx); }
  }
  return out;
}

/** @param {number} ms A duration. @returns {number} the seconds a CSS tail prints. */
const secs = (css) => Number(/^([\d.]+)s/.exec(css)[1]);

test('a settle only ever slows down — whatever armed it', () => {
  // This is the whole ask, stated as a property rather than as a curve: a
  // released pan must never be moving FASTER at any moment than it was the
  // moment before. The shape it started as — a symmetric ease-in-out on the
  // spring-back — failed exactly this: from a standstill it accelerates
  // through the middle, which reads as the page taking off after the finger
  // has already let go.
  [
    ['a carry', () => interact.armSettle(300, 1.4)],
    ['a spring-back', () => interact.armSettle(-120, 0.9)],
    ['a hand that had stopped', () => interact.armSettle(300, 0.01)],
    ['a tap, with no gesture at all', () => interact.armSettle(772, 0)],
    ['the stylesheet default', () => ({ css: interact.SETTLE_CSS })]
  ].forEach((c) => {
    const css = c[1]().css;
    const v = speeds(css);
    for (let i = 1; i < v.length; i += 1) {
      assert.ok(v[i] <= v[i - 1] + 1e-6,
        c[0] + ' speeds up at ' + i + '% (' + v[i - 1].toFixed(3) + ' -> '
        + v[i].toFixed(3) + ') on ' + css);
    }
    assert.ok(v[0] > v[v.length - 1], c[0] + ' actually decelerates');
  });
});

test('a carrying settle is timed by the hand; a reversal is timed by the distance', () => {
  // The lurch this replaces was arithmetic, not taste. An ease-out's
  // opening speed is (its slope) x (the distance left) / (the duration) —
  // fix the duration and the opening speed is decided by the DISTANCE,
  // which is why a slow drag used to release into a settle 4.7x faster than
  // the finger that let it go. So for a release that keeps going, the
  // duration is derived from the speed instead.
  const msOf = (travel, v) => interact.armSettle(travel, v).ms;

  // Twice the release speed over the same distance: half the time, and so
  // the same opening speed.
  const slow = msOf(60, 1.0);
  const fast = msOf(60, 2.0);
  assert.ok(fast < slow, 'a faster hand is handed a shorter curve');
  assert.ok(Math.abs(slow / fast - 2) < 0.05,
    'and exactly proportionally so, which is what holds the opening speed '
    + 'to the hand’s: ' + slow + ' vs ' + fast);

  // Under the carry threshold there is no speed worth continuing, so the
  // distance times it — a hand that has already stopped is not carrying
  // anything, and a settle that bolts away from it is the complaint.
  const stopped = interact.armSettle(300, 0.05);
  const carried = interact.armSettle(300, 1.0);
  assert.notEqual(stopped.css, carried.css, 'and it takes the other curve');
  assert.ok(stopped.ms >= interact.REST_MIN_MS && stopped.ms <= interact.REST_MAX_MS);

  // A reversal cannot continue anything — the content has to travel the
  // opposite way to the finger — so the speed is ignored there too.
  const back = interact.armSettle(-300, 1.0);
  assert.equal(back.css, stopped.css, 'a spring-back is a start from rest');
  // Timed by how far it has to come back: a nudge returns quickly, a long
  // overscroll takes its time, and both open at about the same speed.
  const near = interact.armSettle(-20, 1.0).ms;
  const far = interact.armSettle(-300, 1.0).ms;
  assert.ok(near < far, 'a short way back is a short way back');

  // Both ends are bounded: no settle is instant, and none outstays a
  // gesture. TAP_SUPPRESS_MS is not a ceiling on these — it guards the
  // click that follows the release, not the motion.
  assert.ok(interact.armSettle(4000, 3).ms <= interact.CARRY_MAX_MS);
  assert.ok(interact.armSettle(1, 3).ms > 0);
  assert.ok(interact.armSettle(100000, 0).ms <= interact.REST_MAX_MS);
  assert.ok(interact.armSettle(0, 0).ms >= interact.REST_MIN_MS);

  // The seconds the CSS prints ARE the milliseconds the timers wait.
  [interact.armSettle(60, 1.0), interact.armSettle(-40, 0)].forEach((sv) => {
    assert.ok(Math.abs(secs(sv.css) * 1000 - sv.ms) < 0.5,
      'the curve and the clock agree: ' + sv.css + ' vs ' + sv.ms + 'ms');
  });
});

test('the tile row is a row, not a page: a flick carries on past the next day', () => {
  // A chart is read a day at a time, so one swipe turns one day whichever
  // way it went. The tile row is a strip of five: swiping it should get
  // through it, which means momentum — and, because the row's own travel is
  // a fraction of the screen's, its own scale as well.
  // One tile-width of finger per day — the row's pitch, measured (109.2px
  // of tile + a 6px gap on a 390px viewport; 114 on the real 420px page).
  const TILE = 115.2;
  const PAGE = 386;

  // A slow drag lands where it was let go, at the row's scale: 100px is
  // most of a day of row, where on a chart it is a quarter of one.
  assert.equal(interact.snapTargetDay(0, -100, TILE, 5, 900, 0, true), 1);
  assert.equal(interact.snapTargetDay(0, -100, PAGE, 5, 900, 0, false), 0);
  // And it takes a real drag to cross the row, not a flick of the wrist:
  // this is the measured half-screen sweep that used to eat all five days.
  assert.equal(interact.snapTargetDay(0, -180, TILE, 5, 720, -0.25, true), 2,
    'an unhurried half-screen drag moves two days, not the whole timeline');

  // A flick carries past it. Same finger distance, this time with speed
  // behind it — and the faster it went, the further it goes.
  const fling = (v) => interact.snapTargetDay(0, -60, TILE, 5, 120, v, true);
  assert.ok(fling(-1.5) > fling(-0.5), 'a harder flick goes further');
  assert.equal(fling(-3), 4, 'a hard flick crosses the whole timeline');

  // A chart flick does not, however hard: the graphs are a page at a time.
  assert.equal(interact.snapTargetDay(0, -60, PAGE, 5, 120, -3, false), 1,
    'one swipe, one day — a chart swipe that skipped two would leave the '
    + 'reader hunting for their place');

  // A flick always moves at least one day, even when the arithmetic rounds
  // back onto the day it started from. That case is not hypothetical: a
  // row that FITS its viewport has no travel to scale by, the page scale
  // takes over, and a third of a screen is a third of a day.
  assert.equal(interact.snapTargetDay(0, -60, PAGE, 2, 120, 0, true), 1,
    'a short fast swipe on a two-day row still turns the day');
  assert.equal(interact.snapTargetDay(1, 60, PAGE, 2, 120, 0, true), 0, 'and back');
  // A slow one does not — that is a drag that changed its mind.
  assert.equal(interact.snapTargetDay(0, -60, PAGE, 2, 900, 0, true), 0);

  // Both ends still clamp, fling or no fling.
  assert.equal(interact.snapTargetDay(0, 400, TILE, 5, 100, 5, true), 0);
  assert.equal(interact.snapTargetDay(4, -400, TILE, 5, 100, -5, true), 4);
});

test('a tile drag is paced by the row’s PITCH, not by the little travel it has', () => {
  // The scale a tile gesture uses is a choice with three plausible answers,
  // and the reader can feel which one is in force. Pinned end to end, through
  // the module's own handlers, so it is the CHOICE under test and not the
  // arithmetic that consumes it.
  //
  // On this row — 5 tiles, 115.2px pitch, 196px of travel over 4 day-steps —
  // one unhurried 240px drag reaches a different day under each:
  //   pitch  115.2 px/day -> 2.08 -> day 2   (what we want)
  //   travel  49.0 px/day -> 4.90 -> day 4   (the row tracks the finger, and
  //                                           a half-screen drag eats the
  //                                           whole timeline: too fast)
  //   page   390.0 px/day -> 0.62 -> day 1   (the row reads as stuck)
  const { listeners } = HARNESS;
  let landed = null;
  const realNow = Date.now;
  let clock = realNow() + 20000;
  Date.now = () => clock;
  HARNESS.row = tileRow(5);
  try {
    interact.wire({
      view: () => ({ days: 5 }),
      day: () => 0,
      commitDay: (d) => { landed = d; },
      scrub: () => {},
      panTips: () => {},
      panStrip: () => {},
      canPull: () => false,
      refresh: () => {}
    });
    const on = (vp) => ({
      getAttribute: (a) => (a === 'data-wxvp' ? vp : null),
      getBoundingClientRect: () => ({ width: 390 })
    });
    const drag = (vp, dx) => {
      const el = on(vp);
      const fire = (type, x) => listeners[type]({
        touches: type === 'touchend' ? [] : [{ clientX: x, clientY: 100 }],
        changedTouches: [{ clientX: x, clientY: 100 }],
        target: el,
        preventDefault: () => {}
      });
      landed = null;
      fire('touchstart', 330);
      // Unhurried, and in steps, so the release velocity is a real reading
      // off the last 90ms rather than one long jump.
      for (let k = 1; k <= 8; k += 1) { clock += 90; fire('touchmove', 330 + dx * k / 8); }
      // Then held still before lifting, so the fling term is zero and what
      // is under test is the DRAG scale alone. (A finger that stalls before
      // it lifts is the module's own definition of a drag, not a throw —
      // it is why the velocity window is only the trailing 90ms.)
      clock += 90;
      fire('touchmove', 330 + dx);
      clock += 90;
      fire('touchend', 330 + dx);
      clock += 2000;   // clear the tap-suppression window for the next drag
      return landed;
    };

    assert.equal(drag('days', -240), 2,
      'a 240px drag on the tiles is two days: one tile-width buys one day');
    // And the pitch is the DISTANCE between two tiles, not the offset of
    // one: at a tile and a half the day rounds up, which it would not if
    // the row's 8px leading margin had been folded into the stride.
    assert.equal(drag('days', -180), 2,
      'a tile and a half rounds up to two days');
    // The same finger distance on a chart is a quarter of a page, and a
    // chart is read a page at a time — so it rounds back to where it began.
    assert.equal(drag('temp', -240), 1,
      'the charts keep their own scale: one screen, one day');

    // And the same drag means the same thing however many tiles the
    // provider gave us. This is why the pitch and not the travel: the
    // travel is (pitch × N − viewport) / (N − 1), which is not a property
    // of a day at all. At four tiles it is 27px a day — FASTER than at
    // five, so the shorter forecast would swipe quicker — and at three the
    // row fits, the travel is zero, and the gesture used to fall all the
    // way back to the page's 390. One finger distance, three meanings.
    [4, 3].forEach((n) => {
      HARNESS.row = tileRow(n);
      interact.wire({
        view: () => ({ days: n }),
        day: () => 0,
        commitDay: (d) => { landed = d; },
        scrub: () => {},
        panTips: () => {},
        panStrip: () => {},
        canPull: () => false,
        refresh: () => {}
      });
      assert.equal(drag('days', -240), 2,
        'a ' + n + '-tile row is paced by the same pitch as a 5-tile one');
    });
  } finally {
    Date.now = realNow;
    HARNESS.row = null;
  }
});

test('the settle opens at the speed the finger arrived with, and never steps at the threshold', () => {
  // Timing the settle off the release only matches the hand while the
  // duration is free. Past CARRY_MAX_MS the clamp binds and the opening
  // speed is pinned at slope x distance / 700 whatever the hand was doing
  // — and the distance here is a whole day, so that is most of the band.
  // The curve carries the velocity instead, and this pins that it does.
  const at = (x1, x2) => {
    const bx = (t) => 3 * (1 - t) ** 2 * t * x1 + 3 * (1 - t) * t * t * x2 + t ** 3;
    const by = (t) => 3 * (1 - t) ** 2 * t + 3 * (1 - t) * t * t + t ** 3;
    return (u) => {
      let lo = 0; let hi = 1; let t = u;
      for (let k = 0; k < 60; k += 1) { t = (lo + hi) / 2; if (bx(t) < u) lo = t; else hi = t; }
      return by(t);
    };
  };
  const curve = (css) => {
    const m = /cubic-bezier\(([\d.]+), 1, ([\d.]+), 1\)/.exec(css);
    assert.ok(m, 'the armed curve is one of the family: ' + css);
    return at(Number(m[1]), Number(m[2]));
  };
  // Opening speed of the settle, px/ms, against the finger's own.
  const opens = (D, v) => {
    const sv = interact.armSettle(D, v);
    const f = curve(sv.css);
    const h = 1e-5;
    return (f(h) - f(0)) / h * Math.abs(D) / sv.ms / Math.abs(v);
  };

  // Where the clamp binds — every distance a real day change covers — the
  // settle now leaves at the finger's speed rather than bolting.
  [[193, 0.5], [193, 1], [326, 1], [326, 2], [386, 1.2], [114, 0.3], [48, 0.3]]
    .forEach(([D, v]) => {
      assert.ok(Math.abs(opens(D, v) - 1) < 0.02,
        'D=' + D + ' v=' + v + ' opens at ' + opens(D, v).toFixed(2) + 'x the finger');
    });

  // And it does not STEP at CARRY_MIN_V. This was the real defect: the
  // marginally faster hand crossed into the carry branch and got a settle
  // 3.8x quicker off the mark than the marginally slower one — measured
  // 3.84x -> 14.48x at D=326, worse than the lurch that started all this.
  [193, 260, 326, 386].forEach((D) => {
    const below = opens(D, interact.CARRY_MIN_V - 0.001);
    const above = opens(D, interact.CARRY_MIN_V + 0.001);
    assert.ok(Math.abs(above - below) / below < 0.1,
      'at D=' + D + ' the two sides of CARRY_MIN_V agree (' + below.toFixed(2)
      + 'x vs ' + above.toFixed(2) + 'x)');
  });

  // Whatever it arms, the curve only ever slows down and lands exactly on
  // the day — an accelerating middle is the ramp-up being complained
  // about, and a curve passing 1 would overshoot the day and come back.
  const seen = new Set();
  [[193, 0.201], [193, 0.5], [193, 1], [193, 2.5], [326, 0.3], [326, 1], [326, 4],
    [114, 0.3], [48, 0.25], [-40, 0.5], [386, 0.21], [386, 6]].forEach(([D, v]) => {
    const css = interact.armSettle(D, v).css;
    if (seen.has(css)) { return; }
    seen.add(css);
    const f = curve(css);
    let prev = 0; let peak = 0; let peakAt = 0; let maxY = 0; let first = 0;
    const N = 1500;
    for (let i = 1; i <= N; i += 1) {
      const y = f(i / N);
      const sl = (y - prev) * N;
      if (i === 1) { first = sl; }
      if (sl > peak) { peak = sl; peakAt = i / N; }
      if (y > maxY) { maxY = y; }
      prev = y;
    }
    assert.ok(peakAt <= 0.002, css + ' peaks at t=' + peakAt.toFixed(3) + ', not at the start');
    assert.ok(peak <= first * 1.001, css + ' speeds up after it starts');
    assert.ok(maxY <= 1.000005, css + ' overshoots the day (maxY ' + maxY.toFixed(6) + ')');
  });
  assert.ok(seen.size >= 5, 'the sweep really did arm several different curves (' + seen.size + ')');

  // Both clamps. A hard flick with almost nothing left to run wants a
  // slope of 10 or 12; it gets CARRY_SLOPE, because that curve already
  // spends two thirds of its clock on the last tenth of the ground and
  // asking for stiffer only lengthens that crawl. Nothing ever arms a
  // curve outside the two the module names.
  const x1of = (css) => Number(/cubic-bezier\(([\d.]+),/.exec(css)[1]);
  [[48, 3], [30, 2], [114, 6], [20, 1.5]].forEach(([D, v]) => {
    assert.ok(Math.abs(x1of(interact.armSettle(D, v).css) - 1 / interact.CARRY_SLOPE) < 0.001,
      'D=' + D + ' v=' + v + ' is capped at the stiffest tuned curve, not solved past it');
  });
  [[193, 0.5], [193, 1], [326, 1], [48, 3], [386, 0.21], [114, 0.3], [326, 4]].forEach(([D, v]) => {
    const x1 = x1of(interact.armSettle(D, v).css);
    assert.ok(x1 >= 1 / interact.CARRY_SLOPE - 0.001 && x1 <= 1 / interact.REST_SLOPE + 0.001,
      'D=' + D + ' v=' + v + ' arms x1=' + x1 + ', inside the family\u2019s two ends');
  });
});

test('one finger tap is ONE scrub — the browser\'s mouse twins do not undo it', () => {
  // A touch device follows every touchend the page did not preventDefault
  // with mousedown/mouseup/click at the same coordinates, so that pages
  // written for a mouse work under a finger. A pan preventDefaults its
  // touchmove and is spared; a tap never moves, so it is always followed.
  //
  // Both listener sets are document-level and both run the same
  // beginGesture/endGesture pair, so one tap ran the gesture TWICE. That
  // was harmless while a scrub was idempotent and became total when a tap
  // became a toggle: the touch pair raised the crosshair and the mouse
  // pair, finding that hour already selected, put it back down. Measured
  // in Chromium's touch emulation before this: every tap on the Weather
  // tab was a no-op and the chip never left the hour marked NOW.
  const { listeners } = HARNESS;
  const scrubs = [];
  const realNow = Date.now;
  let clock = realNow() + 60000;
  Date.now = () => clock;
  HARNESS.row = null;
  try {
    interact.wire({
      view: () => ({ days: 5 }),
      day: () => 0,
      commitDay: () => {},
      scrub: (el, x) => { scrubs.push(x); },
      panTips: () => {},
      panStrip: () => {},
      canPull: () => false,
      refresh: () => {}
    });
    const chart = {
      getAttribute: (a) => (a === 'data-wxvp' ? 'temp' : (a === 'data-wxchart' ? 'temp' : null)),
      getBoundingClientRect: () => ({ width: 390 })
    };
    const touch = (type, x) => listeners[type]({
      touches: type === 'touchend' ? [] : [{ clientX: x, clientY: 100 }],
      changedTouches: [{ clientX: x, clientY: 100 }],
      target: chart,
      preventDefault: () => {}
    });
    const mouse = (type, x) => listeners[type]({
      clientX: x, clientY: 100, target: chart, buttons: type === 'mouseup' ? 0 : 1,
      preventDefault: () => {}
    });

    // The exact sequence a phone delivers, timings included: the twins
    // arrive a few ms behind the finger, at the same coordinates.
    touch('touchstart', 240);
    clock += 60;
    touch('touchend', 240);
    clock += 8;
    mouse('mousedown', 240);
    clock += 2;
    mouse('mouseup', 240);

    assert.deepEqual(scrubs, [240],
      'the tap scrubs once; the mouse twins that followed it are not a second tap');

    // The window is a WINDOW, not a latch: a machine with both a
    // touchscreen and a mouse gets its mouse back as soon as the pointer
    // that produced these events cannot be the finger that just lifted.
    // This is also the desktop config-page preview, which has no
    // touchscreen at all and must keep working unchanged.
    //
    // A whole second, spelled out rather than read off the module, so the
    // window's SIZE is pinned and not just its existence: a guard that
    // latched, or that ran for longer than a person takes to move from the
    // screen to the mouse, would pass a test written in its own units.
    clock += 1000;
    mouse('mousedown', 300);
    clock += 10;
    mouse('mouseup', 300);
    assert.deepEqual(scrubs, [240, 300],
      'a mouse press a second after the last touch still scrubs');

    // And the window is half-open: the twins land within a few ms, so the
    // far edge belongs to the mouse.
    clock += 1000;
    touch('touchstart', 260);
    clock += 60;
    touch('touchend', 260);
    clock += interact.MOUSE_AFTER_TOUCH_MS;
    mouse('mousedown', 210);
    clock += 10;
    mouse('mouseup', 210);
    assert.deepEqual(scrubs, [240, 300, 260, 210],
      'a press exactly one window after the touch is the mouse, not a twin');

    // And a touch arriving after that re-arms it — the guard is not spent
    // by the one tap that armed it first.
    clock += 1000;
    touch('touchstart', 180);
    clock += 60;
    touch('touchend', 180);
    clock += 8;
    mouse('mousedown', 180);
    clock += 2;
    mouse('mouseup', 180);
    assert.deepEqual(scrubs, [240, 300, 260, 210, 180],
      'the second tap is one scrub too, not one plus its echo');

    // The twins can land in the SAME millisecond the finger lifted in;
    // nothing makes a browser wait a tick before synthesizing them.
    clock += 1000;
    touch('touchstart', 150);
    clock += 60;
    touch('touchend', 150);
    mouse('mousedown', 150);
    mouse('mouseup', 150);
    assert.deepEqual(scrubs, [240, 300, 260, 210, 180, 150],
      'a twin that arrives in the same millisecond is still a twin');

    // A SLOW tap: a finger that rests a second before lifting is still a
    // tap, and its twins still follow the LIFT. Age the guard from the
    // touch that ended the gesture, not the one that began it.
    clock += 1000;
    touch('touchstart', 120);
    clock += 900;
    touch('touchend', 120);
    clock += 8;
    mouse('mousedown', 120);
    clock += 2;
    mouse('mouseup', 120);
    assert.deepEqual(scrubs, [240, 300, 260, 210, 180, 150, 120],
      'a long press is one scrub too — the window runs from the finger lifting');

    // And the twins must leave nothing standing. A mousedown that got
    // through would build a gesture no mouseup ever ends, and a live
    // gesture is not inert: it pans on the next move and it shuts the
    // keyboard out of the day tiles.
    // An ABORTED touch ends one too — a system gesture stealing the
    // finger, a call arriving — and the twins can follow it just the same.
    clock += 1000;
    touch('touchstart', 90);
    clock += 40;
    listeners.touchcancel({ touches: [], changedTouches: [], target: chart });
    clock += 8;
    mouse('mousedown', 90);
    clock += 2;
    mouse('mouseup', 90);
    assert.deepEqual(scrubs, [240, 300, 260, 210, 180, 150, 120],
      'a cancelled touch scrubs nothing, and its twins do not scrub for it');

    let panned = 0;
    interact.wire({
      view: () => ({ days: 5 }),
      day: () => 0,
      commitDay: () => {},
      scrub: (el, x) => { scrubs.push(x); },
      panTips: () => { panned += 1; },
      panStrip: () => {},
      canPull: () => false,
      refresh: () => {}
    });
    clock += 10;
    touch('touchmove', 40);
    assert.equal(panned, 0,
      'no gesture is left standing by the twins — a stray move pans nothing');
  } finally {
    Date.now = realNow;
  }
});
