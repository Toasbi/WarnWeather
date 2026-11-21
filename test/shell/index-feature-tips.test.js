// test/shell/index-feature-tips.test.js
// The card of new features to try (page/notices/feature-tips-panel.js) draws from
// userData.featureTips, which only index.js' showConfiguration hands over, and its Got it
// only counts once index.js' webviewclosed records it. A dropped line in either would leave
// the card never shown, or shown forever, on a real phone while every page test (which sets
// userData itself) stayed green. Boots the REAL index.js, as index-key-status-userdata.test.js
// does, for an install from before the tips and for a fresh one.
const test = require('node:test');
const assert = require('node:assert/strict');
const { userDataOf } = require('../helpers/settings-url.js');
const path = require('node:path');

const PKJS_DIR = path.resolve(__dirname, '..', '..', 'src', 'pkjs') + path.sep;

/**
 * Boot index.js against a store and hand back what the test drives.
 * @param {Object} t The test context.
 * @param {Object} store The phone's localStorage, as it is before the boot.
 * @param {Object} [pebbleExtras] More of the Pebble object (subscribeToSource: plugins).
 * @param {string} [platform] The watch (basalt by default).
 * @returns {{listeners: Object, opened: string[], store: Object, KEYS: Object}}
 */
function boot(t, store, pebbleExtras, platform) {
  // A later life in the same test: the last one's timers die with it.
  try { t.mock.timers.reset(); } catch (e) { /* nothing enabled yet */ }
  t.mock.timers.enable({ apis: ['setTimeout'] });
  // A boot of its own: index.js and what it requires hold state per load.
  Object.keys(require.cache).forEach((k) => { if (k.indexOf(PKJS_DIR) === 0) { delete require.cache[k]; } });
  global.localStorage = {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    clear: () => { Object.keys(store).forEach((k) => { delete store[k]; }); }
  };
  const KEYS = require('../../src/pkjs/settings/domain/storage-keys.js');
  // Same seeding as index-boot.test.js: no fetch and no update check on the first tick.
  store[KEYS.LAST_FETCH_SUCCESS_KEY] = JSON.stringify({ time: new Date(Date.now() + 60 * 60 * 1000).toISOString(), name: 'Berlin' });
  store.last_update_check = String(Date.now());
  const listeners = {};
  const opened = [];
  global.Pebble = Object.assign({
    addEventListener: (name, fn) => { listeners[name] = fn; },
    getActiveWatchInfo: () => ({ platform: platform || 'basalt', model: 'qemu_platform_' + (platform || 'basalt'), language: 'en' }),
    getAccountToken: () => 'test-token',
    sendAppMessage: (dict, ack) => { if (ack) { ack(); } },
    showSimpleNotificationOnPebble: () => {},
    openURL: (url) => { opened.push(url); }
  }, pebbleExtras || {});
  global.XMLHttpRequest = function () {
    this.open = () => {};
    this.setRequestHeader = () => {};
    this.send = () => {};
  };
  try {
    const devConfigPath = require.resolve('../src/pkjs/dev-config.js');
    require.cache[devConfigPath] = { id: devConfigPath, filename: devConfigPath, loaded: true, exports: {} };
  } catch (e) { /* absent */ }
  const fixturePath = require.resolve('../../src/pkjs/weather/adapter/active-fixture.generated.js');
  require.cache[fixturePath] = { id: fixturePath, filename: fixturePath, loaded: true, exports: null };
  const realLog = console.log;
  t.after(() => {
    console.log = realLog;
    delete global.localStorage;
    delete global.Pebble;
    delete global.XMLHttpRequest;
  });
  console.log = () => {};
  require('../../src/pkjs/index.js');
  listeners.ready({});
  return { listeners: listeners, opened: opened, store: store, KEYS: KEYS };
}

/** A Pebble app with plugins: subscriptions that never answer. */
const PLUGINS = { subscribeToSource: () => ({ unsubscribe: () => {} }) };
/** The stored settings of an install from before the tips. */
const EXISTING = { 'clay-settings': JSON.stringify({ provider: 'openmeteo', onboardingDone: true }) };

/**
 * Save the settings page with some of its keys set, as its Save does.
 * @param {Object} h The boot's handle. @param {Object} changed The keys the page changed.
 * @returns {void}
 */
function save(h, changed) {
  const blob = Object.assign(JSON.parse(h.store['clay-settings'] || '{}'), changed);
  h.listeners.webviewclosed({ response: encodeURIComponent(JSON.stringify(blob)) });
}

test('an install from before the tips is handed them on settings open, until Got it is saved', (t) => {
  const h = boot(t, Object.assign({}, EXISTING), PLUGINS);
  assert.equal(h.store[h.KEYS.FEATURE_TIPS_SEEN_KEY], '[]', 'the boot starts its list: none seen');
  h.listeners.showConfiguration({});
  const tips = userDataOf(h.opened[0]).featureTips;
  assert.ok(Array.isArray(tips) && tips.length > 0, 'the card has tips to draw');
  assert.deepEqual(tips.map((tip) => tip.id), ['batteryDays', 'blackTheme']);
  tips.forEach((tip) => assert.deepEqual(Object.keys(tip), ['id', 'title', 'html', 'sheet', 'tab']));

  // Saved without Got it: still unseen, and handed over again.
  save(h, { vibe: false });
  h.listeners.showConfiguration({});
  assert.deepEqual(userDataOf(h.opened[1]).featureTips.map((tip) => tip.id), ['batteryDays', 'blackTheme']);

  // Got it, then Save: seen, and the next open has no card.
  save(h, { featureTipsAck: true });
  assert.deepEqual(JSON.parse(h.store[h.KEYS.FEATURE_TIPS_SEEN_KEY]), ['batteryDays', 'blackTheme']);
  h.listeners.showConfiguration({});
  assert.equal(userDataOf(h.opened[2]).featureTips, null);
});

test('a fresh install is handed none: nothing is new to it', (t) => {
  const h = boot(t, {}, PLUGINS);
  assert.deepEqual(JSON.parse(h.store[h.KEYS.FEATURE_TIPS_SEEN_KEY]), ['batteryDays', 'blackTheme']);
  h.listeners.showConfiguration({});
  assert.equal(userDataOf(h.opened[0]).featureTips, null);
});

test('Reset watchface leaves a fresh install: it has seen every tip, whatever is saved before its next boot', (t) => {
  const store = Object.assign({}, EXISTING);
  const h = boot(t, store, PLUGINS);
  h.listeners.showConfiguration({});
  assert.ok(userDataOf(h.opened[0]).featureTips, 'before the reset the tips are pending');

  save(h, { reset: true });
  assert.equal(store['clay-settings'], undefined, 'the reset wiped the settings');
  assert.deepEqual(JSON.parse(store[h.KEYS.FEATURE_TIPS_SEEN_KEY]), ['batteryDays', 'blackTheme']);
  h.listeners.showConfiguration({});
  assert.equal(userDataOf(h.opened[1]).featureTips, null, 'no card in the same PKJS life');

  // The wizard saved before the next boot: that boot finds stored settings, as an
  // install from before the tips would.
  save(h, { onboardingDone: true });
  assert.ok(store['clay-settings']);
  const next = boot(t, store, PLUGINS);
  next.listeners.showConfiguration({});
  assert.equal(userDataOf(next.opened[0]).featureTips, null, 'and none after it');
});

test('a phone or watch that cannot use a feature is not handed its tip, and keeps it for later', (t) => {
  // No plugins in this Pebble app: no days left to try.
  const h = boot(t, Object.assign({}, EXISTING));
  h.listeners.showConfiguration({});
  assert.deepEqual(userDataOf(h.opened[0]).featureTips.map((tip) => tip.id), ['blackTheme']);
  save(h, { featureTipsAck: true });
  assert.deepEqual(JSON.parse(h.store[h.KEYS.FEATURE_TIPS_SEEN_KEY]), ['blackTheme'], 'only the tip it showed');
});

test('aplite is handed no tip for the watch battery\'s days, plugins or not', (t) => {
  const h = boot(t, Object.assign({}, EXISTING), PLUGINS, 'aplite');
  h.listeners.showConfiguration({});
  assert.deepEqual(userDataOf(h.opened[0]).featureTips.map((tip) => tip.id), ['blackTheme']);
});
