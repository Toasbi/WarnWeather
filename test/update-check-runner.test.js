'use strict';
// test/update-check-runner.test.js — the I/O half of the daily update check
// (src/pkjs/update-check-runner.js): the once-a-day throttle, the
// claim-before-fetch rule, the all-stores-or-nothing XHR chain, and the
// notify/persist effects. The pure parse/decide half stays covered by
// test/update-check.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');

function installFakeStorage() {
  const store = {};
  global.localStorage = {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    clear: () => { Object.keys(store).forEach((k) => delete store[k]); },
  };
  return store;
}

/** One-shot fake XHR class serving canned per-URL responses. */
function installFakeXhr(responses) {
  const requested = [];
  global.XMLHttpRequest = function () {
    const xhr = this;
    this.open = (method, url) => { xhr.url = url; requested.push(url); };
    this.send = () => {
      const r = responses[xhr.url];
      if (!r) { xhr.onerror(); return; }
      xhr.status = r.status;
      xhr.responseText = r.body || '';
      xhr.onload();
    };
  };
  return requested;
}

const runner = require('../src/pkjs/update-check-runner.js');

const storeBody = (version) => JSON.stringify({ data: [{ latest_release: { version } }] });

const run = (over) => {
  const notified = [];
  runner.runDailyUpdateCheck(Object.assign({
    stores: ['https://a/api', 'https://b/api'],
    appVersion: '1.13.4',
    devConfig: {},
    isWatchConnected: () => true,
    notify: (title, body) => notified.push({ title, body }),
  }, over || {}));
  return notified;
};

test('no watch connected: nothing runs and the daily slot stays unclaimed', () => {
  const store = installFakeStorage();
  installFakeXhr({});
  run({ isWatchConnected: () => false });
  assert.equal(store.last_update_check, undefined);
});

test('a newer version in EVERY store notifies once and persists the version', () => {
  const store = installFakeStorage();
  installFakeXhr({
    'https://a/api': { status: 200, body: storeBody('1.14.0') },
    'https://b/api': { status: 200, body: storeBody('1.14.0') },
  });
  const notified = run();
  assert.equal(notified.length, 1);
  assert.match(notified[0].body, /new version is available/);
  assert.equal(store.update_notified_version, '1.14.0');
  assert.ok(store.last_update_check, 'the daily slot is claimed');

  // Second run within 24h: throttled, no second notification.
  installFakeXhr({});
  assert.equal(run().length, 0, 'throttled — the slot was already claimed today');
});

test('the daily slot is claimed BEFORE fetching, so a failing store cannot retry every tick', () => {
  const store = installFakeStorage();
  installFakeXhr({ 'https://a/api': { status: 500 } });   // first store fails
  const notified = run();
  assert.equal(notified.length, 0, 'all-stores-or-nothing: no notify on failure');
  assert.ok(store.last_update_check, 'the slot is claimed even though the fetch failed');
});

test('one unparseable store body suppresses the whole check (all-stores-or-nothing)', () => {
  installFakeStorage();
  installFakeXhr({
    'https://a/api': { status: 200, body: storeBody('1.14.0') },
    'https://b/api': { status: 200, body: 'not json' },
  });
  assert.equal(run().length, 0);
});

test('dev override versions skip the XHRs entirely', () => {
  const store = installFakeStorage();
  const requested = installFakeXhr({});
  const notified = run({ devConfig: {
    forceUpdateCheckOnBoot: true,
    overrideLatestStoreVersions: ['9.9.9', '9.9.9'],
  } });
  assert.equal(requested.length, 0, 'no store request made');
  assert.equal(notified.length, 1);
  assert.equal(store.update_notified_version, '9.9.9');
});
