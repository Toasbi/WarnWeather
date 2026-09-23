'use strict';
// test/wizard-onboarding.test.js — does the first-run wizard auto-open on the config
// the phone ACTUALLY injects? wizard.shouldShow is pure and was only ever unit-tested
// with a hand-built {}; the real page receives claySettings.read() after the PKJS
// `ready` handler has run seedDefaults and the migration ledger. Once seeding filled
// that blob, the wizard never opened on a fresh install again.
//
// These tests drive the real src/pkjs/index.js boot (ready -> showConfiguration) and
// read INJECTED_CFG back out of the data: URL handed to Pebble.openURL.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const PKJS_DIR = path.resolve(__dirname, '../src/pkjs') + path.sep;
const KEYS = require('../src/pkjs/storage-keys');

/**
 * Drop every src/pkjs module from the require cache, so the next require of
 * index.js registers fresh listeners over fresh module state (a new PKJS session).
 * @returns {void}
 */
function forgetPkjsModules() {
  Object.keys(require.cache).forEach((k) => {
    if (k.indexOf(PKJS_DIR) === 0) { delete require.cache[k]; }
  });
}

/**
 * One PKJS session over `store`: load index.js with Pebble/XHR mocks, fire `ready`,
 * then `showConfiguration`, and return the config the page was handed.
 * @param {Object} store The fake localStorage backing object (kept across sessions).
 * @returns {{cfg: Object, listeners: Object}} INJECTED_CFG and the registered listeners.
 */
function bootAndOpenSettings(store) {
  global.localStorage = {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    clear: () => { Object.keys(store).forEach((k) => { delete store[k]; }); }
  };
  // Keep the scheduler's first tick off the network (see test/index-boot.test.js).
  store.lastFetchSuccess = JSON.stringify({ time: new Date(Date.now() + 60 * 60 * 1000).toISOString() });
  store.last_update_check = String(Date.now());

  const listeners = {};
  let opened = null;
  global.Pebble = {
    addEventListener: (name, fn) => { listeners[name] = fn; },
    getActiveWatchInfo: () => ({ platform: 'basalt', model: 'qemu_platform_basalt', language: 'en' }),
    getAccountToken: () => 'test-token',
    sendAppMessage: (dict, ack) => { if (ack) { ack(); } },
    showSimpleNotificationOnPebble: () => {},
    openURL: (url) => { opened = url; }
  };
  global.XMLHttpRequest = function () {
    this.open = () => {};
    this.setRequestHeader = () => {};
    this.send = () => {};
  };

  forgetPkjsModules();
  // Same neutralising as test/index-boot.test.js: no local dev-config, no fixture.
  try {
    const devConfigPath = require.resolve('../src/pkjs/dev-config.js');
    require.cache[devConfigPath] = { id: devConfigPath, filename: devConfigPath, loaded: true, exports: {} };
  } catch (e) { /* absent */ }
  const fixturePath = require.resolve('../src/pkjs/active-fixture.generated.js');
  require.cache[fixturePath] = { id: fixturePath, filename: fixturePath, loaded: true, exports: null };

  require('../src/pkjs/index.js');
  listeners.ready({});
  listeners.showConfiguration({});
  assert.ok(opened, 'showConfiguration opened the settings page');
  const html = decodeURIComponent(opened.replace(/^data:text\/html;charset=utf-8,/, ''));
  const m = /INJECTED_CFG=(\{[\s\S]*?\});INJECTED_ENV=/.exec(html);
  assert.ok(m, 'INJECTED_CFG found in the page');
  return { cfg: JSON.parse(m[1]), listeners };
}

/**
 * Whether the wizard would auto-open for this injected config.
 * @param {Object} cfg INJECTED_CFG.
 * @returns {boolean} The real wizard.shouldShow verdict.
 */
function wizardOpens(cfg) {
  return require('../src/pkjs/settings/wizard.js').shouldShow(cfg);
}

test.beforeEach((t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
});
test.afterEach(() => {
  delete global.localStorage;
  delete global.Pebble;
  delete global.XMLHttpRequest;
});

test('a fresh install opens the wizard on its first settings open', () => {
  const store = {};
  const first = bootAndOpenSettings(store);
  assert.ok(Object.keys(first.cfg).length > 50, 'guard: the page gets the full seeded blob, not {}');
  assert.equal(first.cfg.onboardingDone, false);
  assert.equal(wizardOpens(first.cfg), true, 'fresh install: the wizard auto-opens');
  assert.equal(store[KEYS.ONBOARDING_EXISTING_INSTALL_MIGRATION_KEY], '1',
    'the fresh boot commits the marker too');

  // The phone app usually restarts PKJS before the user first opens settings. The
  // second boot finds a blob (hadExistingInstall true) and must still read as fresh.
  const second = bootAndOpenSettings(store);
  assert.equal(second.cfg.onboardingDone, false);
  assert.equal(wizardOpens(second.cfg), true, 'still un-onboarded on a later boot');
});

test('an existing install upgrading to this build does not get the wizard', () => {
  // A blob stored by an earlier build: seedDefaults' backfill wrote onboardingDone:false
  // into it, and the marker does not exist yet.
  const store = {};
  const seeded = bootAndOpenSettings(store);
  assert.equal(seeded.cfg.onboardingDone, false, 'guard: the backfilled key reads false');
  delete store[KEYS.ONBOARDING_EXISTING_INSTALL_MIGRATION_KEY];

  const upgraded = bootAndOpenSettings(store);
  assert.equal(upgraded.cfg.onboardingDone, true, 'the migration marks the install onboarded');
  assert.equal(wizardOpens(upgraded.cfg), false, 'no wizard for the installed base');
});

test('finishing the wizard sticks, and "Reset watchface" reopens it on the next boot', () => {
  const store = {};
  const first = bootAndOpenSettings(store);
  assert.equal(wizardOpens(first.cfg), true);

  // Save & close: the page returns the blob with onboardingDone set.
  const done = Object.assign({}, first.cfg, { onboardingDone: true });
  first.listeners.webviewclosed({ response: encodeURIComponent(JSON.stringify(done)) });
  const after = bootAndOpenSettings(store);
  assert.equal(wizardOpens(after.cfg), false, 'a completed wizard does not come back');

  // Reset watchface: storage is wiped (markers included), the next boot is fresh.
  const reset = Object.assign({}, after.cfg, { reset: true });
  after.listeners.webviewclosed({ response: encodeURIComponent(JSON.stringify(reset)) });
  const reopened = bootAndOpenSettings(store);
  assert.equal(reopened.cfg.onboardingDone, false);
  assert.equal(wizardOpens(reopened.cfg), true, 'the reset reopens the wizard');
});
