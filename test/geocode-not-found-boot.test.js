// test/geocode-not-found-boot.test.js
// End to end through the REAL index.js boot and 60 s tick loop (the
// test/index-boot.test.js harness): a manual address LocationIQ cannot
// resolve, or refuses outright, used to be looked up again on every tick —
// the failed fetch leaves needRefresh() true — each time spending the one key
// every install shares. Now a miss is remembered and the scheduled fetches
// skip the lookup, and a refusal waits out a cooldown that keeps growing.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

/**
 * Boot index.js with a manual address and count LocationIQ requests across
 * ready plus `ticks` minute ticks. The mocked clock (setTimeout and Date)
 * advances with each tick, so time-based cooldowns expire as they would.
 * @param {Object} t node:test context.
 * @param {{status: number, body: string}} answer LocationIQ's reply.
 * @param {number} [ticks] Minute ticks to run after ready (default 10).
 * @returns {{perTick: number[], store: Object}} Cumulative counts + storage.
 */
function bootWithUnresolvableAddress(t, answer, ticks) {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.now() });
  // Each test boots a fresh index.js (it registers its listeners on load).
  const pkjsDir = path.resolve(__dirname, '../src/pkjs') + path.sep;
  Object.keys(require.cache).forEach((id) => {
    if (id.indexOf(pkjsDir) === 0) { delete require.cache[id]; }
  });
  const store = {};
  global.localStorage = {
    getItem: (k) => Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null,
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };
  // An existing install with a typo for its location and no successful fetch
  // yet; a fresh update-check stamp keeps the daily check off the network.
  store['clay-settings'] = JSON.stringify({ location: 'Muenchnxq' });
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
  let liq = 0;
  global.XMLHttpRequest = function () {
    const xhr = this;
    this.open = (m, url) => { xhr._url = url; };
    this.setRequestHeader = () => {};
    this.send = () => {
      if (/locationiq\.com/.test(xhr._url)) {
        liq += 1;
        xhr.status = answer.status;
        xhr.responseText = answer.body;
        xhr.onload.call(xhr);
      }
      // Anything else (holidays, news) stays inert: never answers.
    };
  };
  // Neutralize a local dev-config.js and an armed fixture, as index-boot does.
  try {
    const devConfigPath = require.resolve('../src/pkjs/dev-config.js');
    require.cache[devConfigPath] = { id: devConfigPath, filename: devConfigPath, loaded: true, exports: {} };
  } catch (e) { /* absent */ }
  const fixturePath = require.resolve('../src/pkjs/active-fixture.generated.js');
  require.cache[fixturePath] = { id: fixturePath, filename: fixturePath, loaded: true, exports: null };

  const origLog = console.log;
  console.log = () => {};
  t.after(() => {
    console.log = origLog;
    delete global.localStorage;
    delete global.Pebble;
    delete global.XMLHttpRequest;
  });

  require('../src/pkjs/index.js');
  listeners.ready({});
  const perTick = [liq];
  for (let i = 0; i < (ticks || 10); i++) {
    t.mock.timers.tick(60 * 1000);
    perTick.push(liq);
  }
  console.log = origLog;
  return { perTick: perTick, store: store };
}

test('an address LocationIQ answers 404 for is asked once, not every minute', (t) => {
  const run = bootWithUnresolvableAddress(t, { status: 404, body: '{"error":"Unable to geocode"}' });
  assert.deepEqual(run.perTick, [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
  const attempt = JSON.parse(run.store.lastFetchAttempt);
  assert.deepEqual(attempt.error, { stage: 'forward_geocode', code: 'status_404' },
    'the settings diagnostics still show why weather is missing');
  assert.equal(run.store.authBackoff, undefined, 'not mistaken for a provider key failure');
});

test('a LocationIQ key refusal (401) is asked again after a growing pause, not every minute', (t) => {
  const run = bootWithUnresolvableAddress(t, { status: 401, body: '{"error":"Invalid key"}' }, 60);
  // The ticks on which a new request went out: the cooldown doubles each
  // time (60 s, 60 s, 2, 4, 8, 16 min ... up to 30 min), where resetting it
  // on every expiry asked the shared key once a minute.
  const askedAt = run.perTick.reduce((acc, n, i) => {
    if (n > (i === 0 ? 0 : run.perTick[i - 1])) { acc.push(i); }
    return acc;
  }, []);
  assert.deepEqual(askedAt, [0, 1, 2, 4, 8, 16, 32]);
  assert.equal(run.store.authBackoff, undefined, 'the shared key is not the provider\'s');
});
