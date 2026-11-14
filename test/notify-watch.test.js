'use strict';
// src/pkjs/notices/adapter/notify-watch.js: a notification on the watch as far as the Pebble app's permissions
// let it show (ShowNotifications, app 1.18.0 with the permissions preview on). It shows unless the
// user turned notifications off for the app, and says whether the user has decided: false while
// the phone asks first and drops this one, so the caller keeps it for a later run.
const test = require('node:test');
const assert = require('node:assert/strict');
const { notifyWatch } = require('../src/pkjs/notices/adapter/notify-watch.js');

// The phone's question is asked once per install (storage-keys.js NOTIFY_ASKED_KEY): every
// case starts from a fresh store unless it keeps the one before.
let store = {};
function installStorage(keep) {
  if (!keep) { store = {}; }
  global.localStorage = {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); }
  };
}

/**
 * Run notifyWatch against a fake Pebble global.
 * @param {*} permissions Pebble.permissions (undefined: an app without the API).
 * @returns {Promise<{shown: Array, decided: Array}>} What it showed and every done() answer.
 */
async function runWith(permissions) {
  const shown = [];
  const decided = [];
  global.Pebble = { showSimpleNotificationOnPebble: (t, b) => shown.push([t, b]) };
  installStorage();
  if (permissions !== undefined) { global.Pebble.permissions = permissions; }
  try {
    notifyWatch('Title', 'Body', (d) => decided.push(d));
    await new Promise((r) => setImmediate(r));
  } finally {
    delete global.Pebble;
  }
  return { shown, decided };
}

test('an app without Pebble.permissions (preview off, or before 1.17.0) shows it: decided', async () => {
  const r = await runWith(undefined);
  assert.deepEqual(r.shown, [['Title', 'Body']]);
  assert.deepEqual(r.decided, [true]);
});

test('granted: shown, decided', async () => {
  const r = await runWith({ query: () => Promise.resolve('granted') });
  assert.equal(r.shown.length, 1);
  assert.deepEqual(r.decided, [true]);
});

test('prompt: shown, which makes the phone ask, but not decided: the caller keeps it', async () => {
  const asked = [];
  const r = await runWith({ query: (k) => { asked.push(k); return Promise.resolve('prompt'); } });
  assert.deepEqual(asked, ['ShowNotifications'], 'asks about its own permission');
  assert.equal(r.shown.length, 1);
  assert.deepEqual(r.decided, [false]);
});

test('prompt again after asking once (the user dismissed the question): no new question, decided', async () => {
  const prompt = { query: () => Promise.resolve('prompt') };
  assert.deepEqual((await runWith(prompt)).decided, [false], 'the first run asks');
  const shown = [];
  const decided = [];
  global.Pebble = { showSimpleNotificationOnPebble: (t, b) => shown.push([t, b]), permissions: prompt };
  installStorage(true);
  try {
    notifyWatch('Title', 'Body', (d) => decided.push(d));
    await new Promise((r) => setImmediate(r));
  } finally { delete global.Pebble; }
  assert.equal(shown.length, 0, 'not shown: showing is what asks');
  assert.deepEqual(decided, [true], 'the caller records it and stops retrying');
});

test('denied: not shown, decided (the user said no)', async () => {
  const r = await runWith({ query: () => Promise.resolve('denied') });
  assert.equal(r.shown.length, 0);
  assert.deepEqual(r.decided, [true]);
});

test('a query that throws, rejects or answers no promise shows it, as before the API', async () => {
  for (const query of [() => { throw new Error('x'); }, () => Promise.reject(new Error('x')),
    () => undefined, () => 'granted']) {
    const r = await runWith({ query });
    assert.equal(r.shown.length, 1);
    assert.deepEqual(r.decided, [true]);
  }
  assert.deepEqual((await runWith({ query: () => 'prompt' })).decided, [false], 'a plain string answer counts');
});

test('done is optional, and called once', async () => {
  installStorage();
  global.Pebble = { showSimpleNotificationOnPebble: () => {}, permissions: { query: () => Promise.resolve('granted') } };
  try {
    assert.doesNotThrow(() => notifyWatch('T', 'B'));
    await new Promise((r) => setImmediate(r));
  } finally { delete global.Pebble; }
  let calls = 0;
  const thenTwice = { then: (ok) => { ok('granted'); ok('denied'); } };
  global.Pebble = { showSimpleNotificationOnPebble: () => {}, permissions: { query: () => thenTwice } };
  try { notifyWatch('T', 'B', () => { calls++; }); } finally { delete global.Pebble; }
  assert.equal(calls, 1);
});
