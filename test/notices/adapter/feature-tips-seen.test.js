'use strict';
// Which new-feature tips an install has seen (notices/adapter/feature-tips-seen.js): the list
// a boot starts, what the settings page is handed, and what the card's Got it records.
const test = require('node:test');
const assert = require('node:assert/strict');

const store = {};
global.localStorage = {
  getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; }
};
const KEYS = require('../../../src/pkjs/settings/domain/storage-keys.js');
const featureTips = require('../../../src/pkjs/notices/domain/feature-tips.js');
const seen = require('../../../src/pkjs/notices/adapter/feature-tips-seen.js');

const KEY = KEYS.FEATURE_TIPS_SEEN_KEY;
const BASALT = { platform: 'basalt', plugins: true };
const ids = (tips) => tips.map((tip) => tip.id);

test.beforeEach(() => { Object.keys(store).forEach((k) => { delete store[k]; }); });

test('the key is the storage-keys one', () => {
  assert.equal(KEY, 'feature_tips_seen');
});

test('a fresh install has seen every tip: nothing is new to it', () => {
  seen.init(false);
  assert.deepEqual(JSON.parse(store[KEY]), featureTips.allIds());
  assert.deepEqual(seen.pending(BASALT), []);
});

test('an install from before the tips has seen none, and is shown them', () => {
  seen.init(true);
  assert.deepEqual(JSON.parse(store[KEY]), []);
  assert.deepEqual(ids(seen.pending(BASALT)), ids(featureTips.pending([], BASALT)));
});

test('a list already kept is left alone by every later boot', () => {
  store[KEY] = JSON.stringify(['blackTheme']);
  seen.init(true);
  seen.init(false);
  assert.deepEqual(JSON.parse(store[KEY]), ['blackTheme']);
});

test('before any boot wrote a list, and with an unreadable one, every tip counts as unseen', () => {
  assert.equal(seen.read(), null);
  assert.deepEqual(ids(seen.pending(BASALT)), ids(featureTips.pending([], BASALT)));
  ['not json', '{"a":1}', '7', 'null'].forEach((raw) => {
    store[KEY] = raw;
    assert.equal(seen.read(), null, raw);
    assert.deepEqual(ids(seen.pending(BASALT)), ids(featureTips.pending([], BASALT)), raw);
  });
});

test('Got it: the tips the card showed are seen, and it shows them no more', () => {
  seen.init(true);
  const shown = ids(seen.pending(BASALT));
  assert.ok(shown.length > 0);
  seen.acknowledge(BASALT);
  assert.deepEqual(JSON.parse(store[KEY]), shown);
  shown.forEach((id) => assert.equal(ids(seen.pending(BASALT)).indexOf(id), -1, id));
  // A second Got it with nothing shown changes nothing.
  const before = store[KEY];
  seen.acknowledge(BASALT);
  assert.equal(store[KEY], before);
});

test('a tip this watch could not use stays unseen, and shows once it can be used', () => {
  seen.init(true);
  const noPlugins = { platform: 'basalt', plugins: false };
  assert.equal(ids(seen.pending(noPlugins)).indexOf('batteryDays'), -1);
  seen.acknowledge(noPlugins);
  assert.equal(JSON.parse(store[KEY]).indexOf('batteryDays'), -1, 'not shown, so not seen');
  assert.ok(ids(seen.pending(BASALT)).indexOf('batteryDays') !== -1, 'the Pebble app got plugins: now it shows');
});
