// src/pkjs/config-ui/test/back-steps.test.js
// lib/back-steps.js: the Pebble app's WebView goes back in the page's history on the phone's Back
// while it has any, and closes the settings screen otherwise. The page keeps one entry per layer it
// has open, so Back closes the top layer instead of leaving. Driven here over a fake history that
// behaves as Chromium does on a data: page (history.go() lands later, each step from where the one
// before it left the page; an entry added before it lands goes above the entry the page was on).
const test = require('node:test');
const assert = require('node:assert/strict');
const backSteps = require('../lib/back-steps.js');
const { LIB_PAGE_FILES } = require('../scripts/build-page.js');

/**
 * A window with a history as Chromium keeps one for a data: page.
 * @param {{activation: (boolean|undefined), pushThrows: (boolean|undefined)}} [opts] activation:
 *   navigator.userActivation.isActive (left out: a WebView without userActivation); pushThrows:
 *   a WebView that refuses pushState.
 * @returns {Object} The window (win) and the phone's side of it.
 */
function fakeWindow(opts) {
  const o = opts || {};
  const listeners = [];
  const entries = [{ state: null }];
  const steps = [];
  const calls = { go: [], push: 0 };
  let index = 0;
  let left = false;
  const ua = { isActive: o.activation !== undefined ? o.activation : true };
  const fire = () => listeners.slice().forEach((fn) => fn({ state: entries[index].state }));
  const win = {
    navigator: o.activation === undefined ? {} : { userActivation: ua },
    addEventListener(type, fn) { if (type === 'popstate') { listeners.push(fn); } },
    history: {
      scrollRestoration: 'auto',
      get state() { return entries[index].state; },
      get length() { return entries.length; },
      pushState(state, title, url) {
        assert.equal(url, undefined, 'no URL: a data: document may change no more than its fragment');
        if (o.pushThrows) { throw new Error('SecurityError'); }
        calls.push += 1;
        entries.splice(index + 1);
        entries.push({ state });
        index += 1;
      },
      // Each step lands from where the step before it left the page, as Chromium's do.
      go(delta) {
        calls.go.push(delta);
        if (delta === 0) { left = 'reloaded'; return; }
        steps.push((steps.length ? steps[steps.length - 1] : index) + delta);
      }
    }
  };
  const phone = {
    win,
    ua,
    calls,
    entries,
    get index() { return index; },
    get left() { return left; },
    get travelling() { return steps.length > 0; },
    /** The page's history.go() steps land, in order. */
    land() {
      while (steps.length) {
        const to = steps.shift();
        if (to >= 0 && to < entries.length && to !== index) { index = to; fire(); }
      }
    },
    /** The phone's Back: an entry back, or on the first one the settings screen closes. */
    back() {
      if (index === 0) { left = true; return; }
      index -= 1;
      fire();
    },
    /** The iPhone's forward swipe. */
    forward() {
      if (index < entries.length - 1) { index += 1; fire(); }
    },
    /** How many layers the entry shown stands for. */
    get layers() { return (entries[index].state && entries[index].state.pconfLayers) || 0; }
  };
  return phone;
}

/**
 * A part with a stack of layers that a test opens and closes.
 * @param {Object} steps The back-steps instance.
 * @param {number} [rank] Its rank.
 * @returns {{stack: Array<string>, closed: Array<string>, open: function(string): void, shut: function(): void}}
 */
function layered(steps, rank) {
  const p = {
    stack: [],
    closed: [],
    open(name) { p.stack.push(name); steps.sync(); },
    shut() { p.stack.pop(); steps.sync(); },
    shutAll() { p.stack.length = 0; steps.sync(); }
  };
  steps.add({ rank, depth: () => p.stack.length, close: () => { p.closed.push(p.stack.pop()); steps.sync(); } });
  return p;
}

/** Wait for the next task: each tap is a task of its own. */
const nextTap = () => new Promise((resolve) => setTimeout(resolve, 0));

test('a tap that opens a layer adds one entry; Back closes it and the page stays', async () => {
  const phone = fakeWindow();
  const steps = backSteps.create(phone.win);
  const part = layered(steps);
  part.open('dialog');
  assert.equal(phone.layers, 1);
  await nextTap();
  part.open('nested');
  assert.equal(phone.layers, 2);
  phone.back();
  assert.deepEqual(part.stack, ['dialog'], 'Back closed the nested dialog only');
  assert.deepEqual(part.closed, ['nested']);
  assert.equal(phone.layers, 1);
  phone.back();
  assert.deepEqual(part.stack, []);
  assert.equal(phone.left, false, 'the page is still up');
  phone.back();
  assert.equal(phone.left, true, 'with nothing open, Back leaves the page as before');
  assert.deepEqual(phone.calls.go, [], 'Back alone moved the history: the page asked for no step');
});

test('the page closing a layer itself steps back over its entry, and that popstate closes nothing', async () => {
  const phone = fakeWindow();
  const steps = backSteps.create(phone.win);
  const part = layered(steps);
  part.open('dialog');
  await nextTap();
  part.open('nested');
  part.shut();   // ‹ on the nested dialog
  assert.deepEqual(phone.calls.go, [-1]);
  phone.land();
  assert.equal(phone.layers, 1);
  assert.deepEqual(part.stack, ['dialog'], 'the page\'s own step closed nothing more');
  assert.deepEqual(part.closed, []);
  phone.back();
  assert.deepEqual(part.stack, [], 'the next Back closes the dialog');
});

test('a tap during the page\'s own step back adds no entry; once the step lands the page goes forward', async () => {
  const phone = fakeWindow();
  const steps = backSteps.create(phone.win);
  const part = layered(steps);
  part.open('dialog A');
  await nextTap();
  part.open('nested');
  await nextTap();
  // × on the root: both close, and before the step lands a row opens another dialog.
  part.shutAll();
  assert.deepEqual(phone.calls.go, [-2]);
  await nextTap();
  part.open('dialog B');
  assert.equal(phone.calls.push, 2, 'no entry while the step is under way');
  assert.deepEqual(phone.calls.go, [-2], 'and no second step');
  phone.land();
  assert.equal(phone.layers, 1, 'the history stands for the one dialog open');
  assert.deepEqual(phone.calls.go, [-2, 1], 'forward over the entry left above');
  phone.back();
  assert.deepEqual(part.stack, [], 'Back closes dialog B');
  assert.equal(phone.left, false);
  phone.back();
  assert.equal(phone.left, true);
});

test('an entry needs a tap: none without a user activation', () => {
  const phone = fakeWindow({ activation: false });
  const steps = backSteps.create(phone.win);
  const part = layered(steps);
  part.open('opened by a timer');
  assert.equal(phone.calls.push, 0, 'nothing is added without a tap');
  phone.back();
  assert.equal(phone.left, true, 'Back leaves the page, as before');
});

test('one entry per tap: Back closes all the layers one tap opened', async () => {
  const phone = fakeWindow({ activation: true });
  const steps = backSteps.create(phone.win);
  const part = layered(steps);
  part.open('dialog');
  await nextTap();
  part.open('new bar\'s dialog');
  part.open('its name field, in the same tap');
  assert.equal(phone.calls.push, 2, 'the second layer of the tap added no entry');
  phone.back();
  assert.deepEqual(part.stack, ['dialog'], 'Back lands on the dialog\'s entry and closes both above it');
  phone.back();
  assert.deepEqual(part.stack, []);
  assert.equal(phone.left, false);
});

test('Back closes the top part\'s layer first: the shared dialog over an overlay', async () => {
  const phone = fakeWindow();
  const steps = backSteps.create(phone.win);
  const dialog = layered(steps, 1);
  const overlay = layered(steps);
  overlay.open('screen editor');
  await nextTap();
  dialog.open('status bar dialog');
  phone.back();
  assert.deepEqual(dialog.stack, []);
  assert.deepEqual(overlay.stack, ['screen editor']);
  phone.back();
  assert.deepEqual(overlay.stack, []);
});

test('a forward swipe to an entry above the layers open goes back to them', async () => {
  const phone = fakeWindow();
  const steps = backSteps.create(phone.win);
  const part = layered(steps);
  part.open('dialog');
  part.shut();
  phone.land();
  assert.equal(phone.layers, 0);
  phone.forward();
  assert.deepEqual(part.stack, [], 'nothing reopens');
  phone.land();
  assert.equal(phone.layers, 0);
});

test('a part that closes nothing leaves the history where Back put it', () => {
  const phone = fakeWindow();
  const steps = backSteps.create(phone.win);
  let n = 0;
  steps.add({ depth: () => n, close: () => {} });
  n = 1;
  steps.sync();
  phone.back();
  assert.equal(phone.layers, 0);
  assert.deepEqual(phone.calls.go, [], 'no step forward that would hold the page');
  phone.back();
  assert.equal(phone.left, true, 'the next Back leaves the page');
});

test('a page without history.pushState, or one that refuses it, works as before', () => {
  [backSteps.create(null), backSteps.create({ history: {}, addEventListener() {} })].forEach((steps) => {
    let n = 0;
    steps.add({ depth: () => n, close: () => { n = 0; } });
    n = 1;
    steps.sync();
    n = 0;
    steps.sync();
  });
  const phone = fakeWindow({ pushThrows: true });
  const steps = backSteps.create(phone.win);
  const part = layered(steps);
  part.open('dialog');
  part.shut();
  assert.deepEqual(phone.calls.go, [], 'no step back over an entry never added');
  assert.notEqual(phone.left, 'reloaded');
});

test('the history keeps its scroll: traversals between this page\'s entries move nothing', () => {
  const phone = fakeWindow();
  backSteps.create(phone.win);
  assert.equal(phone.win.history.scrollRestoration, 'manual');
});

test('the page loads back-steps.js before engine.js, whose boot adds its layers', () => {
  assert.ok(LIB_PAGE_FILES.indexOf('back-steps.js') !== -1);
  assert.ok(LIB_PAGE_FILES.indexOf('back-steps.js') < LIB_PAGE_FILES.indexOf('engine.js'));
});
