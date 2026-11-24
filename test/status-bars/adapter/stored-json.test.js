'use strict';
// stored-json.js: a value the plugin reads keep in storage, read back parsed and written only
// when it changed (plugin-read-schedule.js, complication-list.js).
const test = require('node:test');
const assert = require('node:assert/strict');

const store = {};
const writes = [];
global.localStorage = {
  getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
  setItem: (k, v) => { writes.push(k); store[k] = String(v); },
  removeItem: (k) => { writes.push('-' + k); delete store[k]; },
};
const storedJson = require('../../../src/pkjs/status-bars/adapter/stored-json.js');

test('read: what is stored, parsed; null for none and for what does not parse', () => {
  store.a = '{"x":[1,2]}';
  store.b = '{not json';
  assert.deepEqual(storedJson.read('a'), { x: [1, 2] });
  assert.equal(storedJson.read('b'), null);
  assert.equal(storedJson.read('c'), null);
});

test('write: a value that changed is stored, none removes the key, the one held writes nothing', () => {
  writes.length = 0;
  assert.equal(storedJson.write('k', { v: 1 }, null, 'test: the value'), true);
  assert.equal(store.k, '{"v":1}');
  assert.equal(storedJson.write('k', { v: 1 }, { v: 1 }, 'test: the value'), false, 'heard again');
  assert.equal(storedJson.write('k', null, { v: 1 }, 'test: the value'), true);
  assert.equal(store.k, undefined);
  assert.equal(storedJson.write('k', null, null, 'test: the value'), false);
  assert.deepEqual(writes, ['k', '-k']);
});

test('write: a storage that refuses is logged by what the value is, and the value counts as changed', (t) => {
  const logged = [];
  t.mock.method(console, 'log', (line) => logged.push(line));
  const setItem = global.localStorage.setItem;
  global.localStorage.setItem = () => { throw new Error('QuotaExceededError'); };
  t.after(() => { global.localStorage.setItem = setItem; });
  assert.equal(storedJson.write('k', { secret: 'reading' }, null, 'test: the value'), true);
  assert.deepEqual(logged, ['test: the value was not stored.']);
});
