// src/pkjs/config-ui/test/back-steps.test.js
// lib/back-steps.js: the Pebble app's WebView goes back in the page's history on the phone's Back
// while it has any, and closes the settings screen otherwise. The page keeps one entry per layer it
// has open, so Back closes the top layer instead of leaving. Driven here over a fake history that
// behaves as Chromium does on a data: page (history.go() lands later, each step from where the one
// before it left the page; an entry added before it lands goes above the entry the page was on).
const test = require('node:test');
const assert = require('node:assert/strict');
const backSteps = require('../lib/back-steps.js');
const { installHistory, nextTap } = require('./fake-history.js');
const { LIB_PAGE_FILES } = require('../scripts/build-page.js');

/**
 * Back steps over a fake window's history.
 * @param {Object} [opts] installHistory's options.
 * @returns {{phone: Object, steps: Object, win: Object}}
 */
function setup(opts) {
  const win = {};
  const phone = installHistory(win, opts);
  return { phone, steps: backSteps.create(win), win };
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

test('a tap that opens a layer adds one entry; Back closes it and the page stays', async () => {
  const { phone, steps } = setup();
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

test('the page closing a layer itself leaves its entry for the next one, and Back still closes one', async () => {
  const { phone, steps } = setup();
  const part = layered(steps);
  part.open('dialog');
  await nextTap();
  part.open('list');
  part.shut();   // a pick closes the list
  assert.deepEqual(phone.calls.go, [], 'no step back while a layer stays open');
  assert.equal(phone.layers, 2);
  await nextTap();
  part.open('another list');
  assert.equal(phone.calls.push, 2, 'the next list takes the entry left above');
  part.shut();
  phone.back();
  assert.deepEqual(part.stack, [], 'Back closed the dialog: one layer, though its entry stood for two');
  assert.deepEqual(phone.calls.go, [-1], 'and with none left open, back to the first entry');
  phone.land();
  assert.equal(phone.layers, 0);
  phone.back();
  assert.equal(phone.left, true, 'so the next Back leaves the page');
});

test('with no layer left open the page goes back to its first entry, and that popstate closes nothing', async () => {
  const { phone, steps } = setup();
  const part = layered(steps);
  part.open('dialog');
  await nextTap();
  part.open('nested');
  part.shut();
  part.shut();   // Done on the dialog
  assert.deepEqual(phone.calls.go, [-2]);
  phone.land();
  assert.equal(phone.layers, 0);
  assert.deepEqual(part.closed, [], 'the page\'s own step closed nothing');
  phone.back();
  assert.equal(phone.left, true);
});

test('a tap during the page\'s own step back adds no entry; once the step lands the page goes forward', async () => {
  const { phone, steps } = setup();
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
  const { phone, steps } = setup({ activation: false });
  const part = layered(steps);
  part.open('opened by a timer');
  assert.equal(phone.calls.push, 0, 'nothing is added without a tap');
  phone.back();
  assert.equal(phone.left, true, 'Back leaves the page, as before');
});

test('an entry needs the tap\'s own event: none from a timer while the activation still lasts', async () => {
  const { phone, steps, win } = setup({ activation: true });
  win.event = undefined;   // a WebView that has window.event: none outside a handler
  const part = layered(steps);
  part.open('opened by a timer, seconds after a tap');
  assert.equal(phone.calls.push, 0, 'no entry: no tap is being handled');
  await nextTap();
  win.event = { type: 'click' };
  part.open('a tap\'s');
  win.event = undefined;
  assert.equal(phone.calls.push, 1, 'the tap\'s own layer gets one');
});

test('a tap that opens two layers adds one entry, also over entries left above', async () => {
  const { phone, steps } = setup({ activation: true });
  const part = layered(steps);
  part.open('dialog');
  await nextTap();
  part.open('list');
  part.shutAll();   // Done: back to the first entry, the two entries left above
  phone.land();
  await nextTap();
  part.stack.push('new bar\'s dialog', 'its name field');   // opened together, one repaint
  steps.sync();
  assert.equal(phone.calls.push, 3, 'one new entry for the tap');
  assert.deepEqual(phone.calls.go, [-2], 'not a step forward over the old ones');
  phone.back();
  assert.deepEqual(part.stack, [], 'Back closes both, as on a page that had none above');
});

test('a step of the page\'s own that never lands holds the history back no more than 3 s', async (t) => {
  t.mock.timers.enable({ apis: ['Date'] });
  const { phone, steps } = setup();
  const part = layered(steps);
  part.open('dialog');
  part.shut();   // the step back to the first entry, which this WebView drops
  assert.deepEqual(phone.calls.go, [-1]);
  t.mock.timers.tick(3001);
  await nextTap();
  part.open('another dialog');   // the entry the step left stands for it
  await nextTap();
  part.open('nested');
  assert.equal(phone.layers, 2, 'after 3 s the page stops waiting: the nested dialog has its entry');
});

test('one entry per tap: Back closes all the layers one tap opened', async () => {
  const { phone, steps } = setup({ activation: true });
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
  const { phone, steps } = setup();
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
  const { phone, steps } = setup();
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

test('a forward swipe over an entry left above closes nothing', async () => {
  const { phone, steps } = setup();
  const part = layered(steps);
  part.open('dialog');
  await nextTap();
  part.open('list');
  phone.back();
  assert.deepEqual(part.stack, ['dialog'], 'Back closed the list');
  phone.forward();
  assert.deepEqual(part.stack, ['dialog'], 'forward again: the dialog stays, nothing reopens');
  assert.deepEqual(phone.calls.go, []);
  phone.back();
  assert.deepEqual(part.stack, [], 'and Back closes the dialog');
});

test('a part that closes nothing leaves the history where Back put it', () => {
  const { phone, steps } = setup();
  let n = 0, asked = 0;
  // A Back that asked again and again would never end: fail instead.
  steps.add({ depth: () => n, close: () => { asked += 1; if (asked > 5) { throw new Error('asked to close ' + asked + ' times'); } } });
  n = 1;
  steps.sync();
  phone.back();
  assert.equal(asked, 1, 'asked once');
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
  const { phone, steps } = setup({ pushThrows: true });
  const part = layered(steps);
  part.open('dialog');
  part.shut();
  assert.deepEqual(phone.calls.go, [], 'no step back over an entry never added');
  assert.notEqual(phone.left, 'reloaded');
});

test('a page the WebView reloaded on one of its entries goes back to its first one, so Back leaves', () => {
  const win = {};
  const phone = installHistory(win);
  win.history.pushState({ pconfLayers: 1 }, '');
  win.history.pushState({ pconfLayers: 2 }, '');   // the page reloads here, nothing open
  const steps = backSteps.create(win);
  steps.add({ depth: () => 0, close: () => {} });
  steps.sync();   // the page's first render
  assert.deepEqual(phone.calls.go, [-2]);
  phone.land();
  phone.back();
  assert.equal(phone.left, true, 'one Back leaves, as on any page with nothing open');
});

test('the history keeps its scroll: traversals between this page\'s entries move nothing', () => {
  const { win } = setup();
  assert.equal(win.history.scrollRestoration, 'manual');
});

test('the page loads back-steps.js before engine.js, whose boot adds its layers', () => {
  assert.ok(LIB_PAGE_FILES.indexOf('back-steps.js') !== -1);
  assert.ok(LIB_PAGE_FILES.indexOf('back-steps.js') < LIB_PAGE_FILES.indexOf('engine.js'));
});
