// test/index-key-status-userdata.test.js
// The key status under a keyed weather provider (settings/key-status.js) marks a key as
// rejected from the auth backoff's record and as working from the last success's — both
// stamped with the fingerprint of the key the update sent (fetch-cycle.js). The page sees
// them only as userData.authBackoff / userData.lastFetchSuccess, which index.js's
// showConfiguration injects; a dropped line would leave every key "not tested yet" on a
// real phone while every settings-page test (which sets userData itself) stayed green.
// Boots the REAL index.js (as index-rainbow-endpoint.test.js does), opens settings and
// decodes the userData the page receives.
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');

/**
 * Decode the INJECTED_USERDATA a device data: URL carries.
 * @param {string} url The URL index.js handed to Pebble.openURL.
 * @returns {Object} The page's userData.
 */
function userDataOf(url) {
  const prefix = 'data:text/html;charset=utf-8,';
  assert.equal(url.indexOf(prefix), 0, 'device branch gives a data: URL');
  const html = decodeURIComponent(url.slice(prefix.length));
  const line = html.split('\n').filter((l) => l.indexOf('INJECTED_SCHEMA=') === 0)[0];
  assert.ok(line, 'the injected snippet is one line');
  const ctx = {};
  vm.runInNewContext(line, ctx);
  return JSON.parse(JSON.stringify(ctx.INJECTED_USERDATA));
}

test('settings open hands the page the auth backoff record and the last success as stored', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const KEYS = require('../src/pkjs/storage-keys.js');
  const store = {};
  global.localStorage = {
    getItem: (k) => Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null,
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };
  // Same seeding as index-boot.test.js: no fetch and no update check on the first tick.
  const success = JSON.stringify({ time: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    id: 'openweathermap', name: 'OpenWeatherMap', keyHash: '1a2b3c4d' });
  store[KEYS.LAST_FETCH_SUCCESS_KEY] = success;
  store.last_update_check = String(Date.now());
  const listeners = {};
  const opened = [];
  global.Pebble = {
    addEventListener: (name, fn) => { listeners[name] = fn; },
    getActiveWatchInfo: () => ({ platform: 'basalt', model: 'qemu_platform_basalt', language: 'en' }),
    getAccountToken: () => 'test-token',
    sendAppMessage: (dict, ack) => { if (ack) { ack(); } },
    showSimpleNotificationOnPebble: () => {},
    openURL: (url) => { opened.push(url); },
  };
  global.XMLHttpRequest = function () {
    this.open = () => {};
    this.setRequestHeader = () => {};
    this.send = () => {};
  };
  try {
    const devConfigPath = require.resolve('../src/pkjs/dev-config.js');
    require.cache[devConfigPath] = { id: devConfigPath, filename: devConfigPath, loaded: true, exports: {} };
  } catch (e) { /* absent */ }
  const fixturePath = require.resolve('../src/pkjs/active-fixture.generated.js');
  require.cache[fixturePath] = { id: fixturePath, filename: fixturePath, loaded: true, exports: null };
  const realLog = console.log;
  t.after(() => {
    console.log = realLog;
    delete global.localStorage;
    delete global.Pebble;
    delete global.XMLHttpRequest;
  });
  console.log = () => {};

  require('../src/pkjs/index.js');
  listeners.ready({});

  listeners.showConfiguration({});
  assert.equal(userDataOf(opened[0]).authBackoff, null, 'no backoff armed: null');
  assert.equal(userDataOf(opened[0]).lastFetchSuccess, success, 'the success record, fingerprint and all');

  const refused = JSON.stringify({ code: 'owm_status_401', since: 1, provider: 'openweathermap', keyHash: '1a2b3c4d' });
  store[KEYS.AUTH_BACKOFF_KEY] = refused;
  listeners.showConfiguration({});
  assert.equal(userDataOf(opened[1]).authBackoff, refused, 'the record exactly as stored');
});
