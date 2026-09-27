// test/index-rainbow-endpoint.test.js
// The Rainbow (own key) Test button POSTs the rainbow-nowcast proxy's key-check mode, and
// the page learns that URL only from userData.rainbowEndpoint, which index.js's
// showConfiguration injects from the build's package.json. Nothing else carries it to the
// page, so a dropped line would leave the button saying "isn't available in this build"
// on every production build while every settings-page test (which sets the userData
// itself) stayed green. Boots the REAL index.js (as api-key-logs.test.js does), opens
// settings on the device branch and decodes the userData the page receives.
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');

const EP = 'https://proxy.example/functions/v1/rainbow-nowcast';

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

test('settings open hands the page the build\'s Rainbow proxy endpoint, or \'\' without one', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const store = {};
  global.localStorage = {
    getItem: (k) => Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null,
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };
  // Same seeding as index-boot.test.js: no fetch and no update check on the first tick.
  store.lastFetchSuccess = JSON.stringify({ time: new Date(Date.now() + 60 * 60 * 1000).toISOString() });
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

  // index.js reads pkg.rainbow at settings-open time, from the same cached package.json.
  const pkg = require('../package.json');
  const hadRainbow = Object.prototype.hasOwnProperty.call(pkg, 'rainbow');
  const realRainbow = pkg.rainbow;
  const realLog = console.log;
  t.after(() => {
    console.log = realLog;
    if (hadRainbow) { pkg.rainbow = realRainbow; } else { delete pkg.rainbow; }
    delete global.localStorage;
    delete global.Pebble;
    delete global.XMLHttpRequest;
  });
  console.log = () => {};

  pkg.rainbow = { endpoint: EP };
  require('../src/pkjs/index.js');
  listeners.ready({});

  listeners.showConfiguration({});
  assert.equal(opened.length, 1, 'the settings page opened');
  assert.equal(userDataOf(opened[0]).rainbowEndpoint, EP, 'a production-style build passes its proxy URL');

  pkg.rainbow = { endpoint: '' };
  listeners.showConfiguration({});
  assert.equal(userDataOf(opened[1]).rainbowEndpoint, '', 'a build with an empty endpoint passes \'\'');

  delete pkg.rainbow;
  listeners.showConfiguration({});
  assert.equal(userDataOf(opened[2]).rainbowEndpoint, '', 'a build with no rainbow block passes \'\'');
});
