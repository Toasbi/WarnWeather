// test/index-boot.test.js
// Boot smoke test: index.js must survive `ready` plus the first scheduler
// ticks under a mocked Pebble environment. Pins the moved-helper class of
// regression — needRefresh() once kept calling sleepWindow.isPastRefreshSlot
// after the function moved to channel-scheduler.js, and the resulting
// TypeError escaped the first synchronous tick and killed the 60 s loop for
// good. Nothing else loads index.js under node:test (it registers Pebble
// listeners at require time), so only a boot test can catch that class.
const test = require('node:test');
const assert = require('node:assert/strict');

test('ready boots and the 60 s tick loop survives its first ticks', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });

  // Environment mocks must exist BEFORE index.js loads: it registers Pebble
  // listeners and reads localStorage at require time.
  const store = {};
  global.localStorage = {
    getItem: (k) => Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null,
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };
  // Seed a fetch-success marker so the first tick walks the refresh-slot
  // check instead of fetching, and a fresh update-check stamp so the daily
  // update check stays throttled (no XHR). The marker sits an hour in the
  // FUTURE: seeded at real now, a UTC-aligned interval boundary falling into
  // the test's few-ms run window would flip needRefresh true and send a tick
  // down the real (geolocation-requiring) fetch path — a rare spurious red.
  store.lastFetchSuccess = JSON.stringify({ time: new Date(Date.now() + 60 * 60 * 1000).toISOString() });
  store.last_update_check = String(Date.now());

  const listeners = {};
  global.Pebble = {
    addEventListener: (name, fn) => { listeners[name] = fn; },
    getActiveWatchInfo: () => ({ platform: 'basalt', model: 'qemu_platform_basalt', language: 'en' }),
    getAccountToken: () => 'test-token',
    sendAppMessage: (dict, ack) => { if (ack) { ack(); } },
    showSimpleNotificationOnPebble: () => {},
    openURL: () => {},
  };
  // Inert XHR: any path that still reaches for the network records nothing
  // and never answers, instead of throwing ReferenceError mid-tick.
  global.XMLHttpRequest = function () {
    this.open = () => {};
    this.setRequestHeader = () => {};
    this.send = () => {};
  };
  // Neutralize the developer's local dev-config.js if present, so local
  // dev flags can't reroute the boot path under test.
  try {
    const devConfigPath = require.resolve('../src/pkjs/dev-config.js');
    require.cache[devConfigPath] = {
      id: devConfigPath, filename: devConfigPath, loaded: true, exports: {},
    };
  } catch (e) { /* absent: getDevConfig() already falls back to {} */ }
  // Same for the fixture artifact: an armed fixture (FIXTURE=<x> in .env, which
  // mise test does NOT reset) makes ready take the fixture branch and skip
  // scheduler.start() entirely — this test is about the REAL boot path.
  const fixturePath = require.resolve('../src/pkjs/active-fixture.generated.js');
  require.cache[fixturePath] = {
    id: fixturePath, filename: fixturePath, loaded: true, exports: null,
  };

  t.after(() => {
    delete global.localStorage;
    delete global.Pebble;
    delete global.XMLHttpRequest;
  });

  require('../src/pkjs/index.js');
  assert.ok(listeners.ready, 'index.js registered a ready listener');

  // needRefresh() reads the marker exactly once per tick — count ticks
  // through it.
  let refreshChecks = 0;
  const getItem = global.localStorage.getItem;
  global.localStorage.getItem = (k) => {
    if (k === 'lastFetchSuccess') { refreshChecks++; }
    return getItem(k);
  };

  // scheduler.start() runs the first tick synchronously inside `ready`; with
  // the pre-fix code this is exactly where the TypeError escaped.
  listeners.ready({});
  assert.ok(refreshChecks >= 1, 'first tick ran inside ready and consulted the refresh marker');

  // The loop must re-arm: two more minutes, two more refresh checks.
  const before = refreshChecks;
  t.mock.timers.tick(60 * 1000);
  t.mock.timers.tick(60 * 1000);
  assert.equal(refreshChecks - before, 2, 'tick loop re-armed and kept ticking');
});
