// test/weather/adapter/reset-settings-open.test.js
// "Reset watchface" leaves no settings blob until the next launch (clay-settings.js resetAll:
// the next boot then reads a fresh install and reopens setup). Opening the settings in that
// same session must still open the page, which hydrates the defaults and shows setup. From
// 2.5.0 the settings-open handler threw there instead (date-format.js effectiveHolidayCountry
// read the absent blob), so the settings stayed shut until the phone app restarted the
// watchface. Its own file: index.js registers its Pebble listeners once, at require time.
const test = require('node:test');
const assert = require('node:assert/strict');

test('the settings open right after Reset watchface, before the next launch', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const store = {};
  global.localStorage = {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    clear: () => { Object.keys(store).forEach((k) => { delete store[k]; }); },
  };
  // As index-boot.test.js: no fetch and no update check on the first tick.
  store.lastFetchSuccess = JSON.stringify({ time: new Date(Date.now() + 60 * 60 * 1000).toISOString() });
  store.last_update_check = String(Date.now());
  const listeners = {};
  const opened = [];
  global.Pebble = {  // no `platform: 'pypkjs'`: the device data: URL, as on a phone
    addEventListener: (name, fn) => { listeners[name] = fn; },
    getActiveWatchInfo: () => ({ platform: 'emery', model: 'qemu_platform_emery', language: 'en' }),
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
  const fixturePath = require.resolve('../../../src/pkjs/weather/adapter/active-fixture.generated.js');
  require.cache[fixturePath] = { id: fixturePath, filename: fixturePath, loaded: true, exports: null };
  t.after(() => {
    delete global.localStorage;
    delete global.Pebble;
    delete global.XMLHttpRequest;
  });

  require('../../../src/pkjs/index.js');
  listeners.ready({});
  listeners.showConfiguration({});
  assert.equal(opened.length, 1, 'the settings open before the reset');

  // The page's Reset watchface: its blob comes back with reset on.
  const blob = JSON.parse(store['clay-settings']);
  blob.reset = true;
  listeners.webviewclosed({ response: encodeURIComponent(JSON.stringify(blob)) });
  assert.equal(store['clay-settings'], undefined, 'the reset leaves no settings blob until the next launch');

  listeners.showConfiguration({});
  assert.equal(opened.length, 2, 'the settings open again in the same session');
  const page = decodeURIComponent(opened[1]);
  assert.ok(page.indexOf('INJECTED_CFG={}') !== -1, 'with no settings: the page hydrates its defaults (setup opens)');
});
