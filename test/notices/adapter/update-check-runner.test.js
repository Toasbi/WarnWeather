'use strict';
// test/notices/adapter/update-check-runner.test.js — the I/O half of the daily update check
// (src/pkjs/notices/adapter/update-check-runner.js): the once-a-day throttle, the
// claim-before-fetch rule, the all-stores-or-nothing XHR chain, and the
// notify/persist effects. The pure parse/decide half stays covered by
// test/notices/domain/update-check.test.js.
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

const runner = require('../../../src/pkjs/notices/adapter/update-check-runner.js');

const storeBody = (version) => JSON.stringify({ data: [{ latest_release: { version } }] });

const run = (over) => {
  const notified = [];
  runner.runDailyUpdateCheck(Object.assign({
    stores: ['https://a/api', 'https://b/api'],
    appVersion: '1.13.4',
    devConfig: {},
    isWatchConnected: () => true,
    // notify-watch.js calls back true once the user has decided (it showed).
    notify: (title, body, done) => { notified.push({ title, body }); done(true); },
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

// Pebble app 1.18.0 with its permissions preview on: while the user has not answered for
// ShowNotifications, the phone drops the notification and asks (notify-watch.js calls back false).
// The version stays unremembered, so the next daily check tells them.
test('a notification the phone dropped while asking for the permission is not remembered', () => {
  const store = installFakeStorage();
  installFakeXhr({
    'https://a/api': { status: 200, body: storeBody('1.14.0') },
    'https://b/api': { status: 200, body: storeBody('1.14.0') },
  });
  const shown = [];
  run({ notify: (title, body, done) => { shown.push(title); done(false); } });
  assert.equal(shown.length, 1, 'shown, which makes the phone ask');
  assert.equal(store.update_notified_version, undefined, 'not remembered');
  assert.ok(store.last_update_check, 'the daily slot is still claimed: one check a day');
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
