// test/api-key-logs.test.js
// Opening and closing settings logged the whole settings blob, and building the
// OpenWeatherMap provider logged its key -- so every PKJS log a user attached to a
// bug report carried their OpenWeatherMap / Tomorrow.io / Yandex keys in plain text.
// Loads the real index.js under the index-boot.test.js mocks and drives
// ready -> Save -> reopen settings; the Rainbow (own key) radar key likewise, and
// through real radar cycles (test/helpers/index-harness.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const { bootIndex, healthyNetwork } = require('./helpers/index-harness.js');

const OWM = 'OWMSECRET_abcdef0123456789';
const TIO = 'TIOSECRET_zyxw9876';
const YDX = 'YDXSECRET_5555';
const RBW = 'RBWSECRET_0f1e2d3c4b5a69788796a5b4';

test('redactForLog masks each API key on a copy and leaves the blob alone', () => {
  const store = {};
  global.localStorage = { getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };
  const claySettings = require('../src/pkjs/clay-settings.js');
  const blob = { provider: 'openweathermap', owmApiKey: OWM, yandexApiKey: '', tomorrowioApiKey: TIO, rainbowApiKey: RBW };
  const out = claySettings.redactForLog(blob);
  assert.deepEqual(out, { provider: 'openweathermap', owmApiKey: '<set>', yandexApiKey: '', tomorrowioApiKey: '<set>',
    rainbowApiKey: '<set>' });
  assert.equal(blob.rainbowApiKey, RBW, 'the real blob keeps the radar key too');
  assert.equal(blob.owmApiKey, OWM, 'the real blob keeps its key');
  assert.equal(claySettings.redactForLog(null), null);
  assert.equal('owmApiKey' in claySettings.redactForLog({ a: 1 }), false, 'absent keys stay absent');
});

test('settings open/close and provider construction never log an API key', (t) => {
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

  const lines = [];
  const realLog = console.log;
  t.after(() => {
    console.log = realLog;
    delete global.localStorage;
    delete global.Pebble;
    delete global.XMLHttpRequest;
  });
  console.log = function () { lines.push(Array.prototype.join.call(arguments, ' ')); };

  require('../src/pkjs/index.js');
  listeners.ready({});
  const claySettings = require('../src/pkjs/clay-settings.js');
  const saved = Object.assign({}, claySettings.read(),
    { provider: 'openweathermap', owmApiKey: OWM, yandexApiKey: YDX, tomorrowioApiKey: TIO,
      rainbowApiKey: RBW, radarProvider: 'rainbowkey', radarMode: 'graph' });
  listeners.webviewclosed({ response: encodeURIComponent(JSON.stringify(saved)) });
  listeners.showConfiguration({});
  console.log = realLog;

  assert.ok(lines.some((l) => l.indexOf('Closing clay: ') === 0), 'close log still written');
  assert.ok(lines.some((l) => l.indexOf('Showing clay: ') === 0), 'open log still written');
  const leaks = lines.filter((l) => [OWM, TIO, YDX, RBW].some((k) => l.indexOf(k) !== -1));
  assert.deepEqual(leaks, [], 'no log line carries a key');
  // Redaction is log-only: storage and the settings page keep the real keys.
  assert.equal(claySettings.read().owmApiKey, OWM);
  assert.ok(decodeURIComponent(opened[opened.length - 1]).indexOf(OWM) !== -1,
    'the settings page still receives the real key');
});

test('a Rainbow (own key) radar cycle never logs the key', (t) => {
  // The boot above never runs a radar request (its XHR never answers and there is
  // no geolocation). This one does, down the three logging paths: a 401 key
  // rejection, a network error and an empty 200 (a parse error), then a Save.
  let rainbowCalls = 0;
  const h = bootIndex(t, {
    settings: { radarMode: 'graph', radarProvider: 'rainbowkey', rainbowApiKey: RBW, fetchIntervalMin: '5' },
    network: (url) => {
      if (/api\.rainbow\.ai/.test(url)) {
        rainbowCalls += 1;
        if (rainbowCalls === 1) { return { status: 401, body: { statusCode: 401 } }; }
        if (rainbowCalls === 2) { return 'error'; }
        return { status: 200, body: '' };
      }
      return healthyNetwork(url);
    },
  });
  h.ready();
  h.minutes(12);
  h.saveSettings({});
  h.minutes(6);

  assert.ok(h.requestsTo(/api\.rainbow\.ai/) >= 3, 'the radar really ran, down all three paths');
  assert.equal(h.count(/key rejected \(status_401\)/), 1);
  assert.deepEqual(h.logs.filter((l) => l.indexOf(RBW) !== -1), [], 'no log line carries the key');
  assert.deepEqual(h.xhrs.filter((u) => u.indexOf(RBW) !== -1), [], 'no request URL carries the key');
});
