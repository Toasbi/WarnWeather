// test/weather/adapter/forecast-snapshots.test.js — where the forecast snapshots are kept: what
// is saved loads back, an unreadable store holds none, a drop empties the store and counts
// itself, and a store that fails never fails the fetch.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const store = {};
let writes = 0;
let failing = false;
global.localStorage = {
  getItem: (k) => { if (failing) { throw new Error('quota'); } return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
  setItem: (k, v) => { if (failing) { throw new Error('quota'); } writes += 1; store[k] = String(v); },
  removeItem: (k) => { if (failing) { throw new Error('quota'); } delete store[k]; }
};
const KEYS = require('../../../src/pkjs/settings/domain/storage-keys.js');
const snapshots = require('../../../src/pkjs/weather/adapter/forecast-snapshots.js');

const ENTRY = { provider: 'metno', kind: 'uv', place: { lat: 52.52, lon: 13.4 }, at: 1, startTime: 0,
  request: { hours: 24, peaks: [] }, fields: { uvTrend: [1, 2] } };

test.beforeEach(() => { Object.keys(store).forEach((k) => { delete store[k]; }); writes = 0; failing = false; });

const NONE = { entries: [], drops: 0 };

test('what is saved loads back, in one write', () => {
  snapshots.save({ entries: [ENTRY], drops: 2 });
  assert.equal(writes, 1);
  assert.deepEqual(snapshots.load(), { entries: [ENTRY], drops: 2 });
  assert.deepEqual(JSON.parse(store[KEYS.FORECAST_SNAPSHOTS_KEY]).v, 1);
});

test('an unreadable store holds none; a drop empties the store and counts itself', () => {
  assert.deepEqual(snapshots.load(), NONE, 'nothing stored yet');
  store[KEYS.FORECAST_SNAPSHOTS_KEY] = '{oops';
  assert.deepEqual(snapshots.load(), NONE);
  snapshots.clear();
  assert.deepEqual(snapshots.load(), { entries: [], drops: 1 }, 'a drop over an unreadable store');
  snapshots.save({ entries: [ENTRY], drops: 1 });
  snapshots.clear();
  assert.deepEqual(snapshots.load(), { entries: [], drops: 2 });
});

test('a store that throws serves none and takes nothing, without a throw', () => {
  failing = true;
  assert.deepEqual(snapshots.load(), NONE);
  assert.doesNotThrow(() => snapshots.save({ entries: [ENTRY], drops: 0 }));
  assert.doesNotThrow(() => snapshots.clear());
});
