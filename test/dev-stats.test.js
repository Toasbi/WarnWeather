const test = require('node:test');
const assert = require('node:assert/strict');

var store = {};
global.localStorage = {
  getItem: function(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
  setItem: function(k, v) { store[k] = String(v); },
  removeItem: function(k) { delete store[k]; }
};

const devStats = require('../src/pkjs/dev-stats');
const KEYS = require('../src/pkjs/storage-keys');

const DAY_MS = 24 * 60 * 60 * 1000;

// These tests run in sequence and share the module-level devStats log
// (mirrors real usage: record() accumulates across the app's lifetime).

test('disabled (default) record is a no-op', () => {
  devStats.record({ type: 'weather', outcome: 'ack', categories: { forecast: 'updated' } });
  assert.equal(store[KEYS.DEV_STATS_KEY], undefined, 'disabled record must not write');
  assert.deepEqual(devStats.read(), []);
});

test('weather ack event: c map with 1/0, ok=1, numeric timestamp', () => {
  devStats.setEnabled(true);
  devStats.record({ type: 'weather', outcome: 'ack', categories: { forecast: 'updated', sun: 'cached' } });
  const events = devStats.read();
  assert.equal(events.length, 1);
  assert.equal(events[0].k, 'weather');
  assert.deepEqual(events[0].c, { forecast: 1, sun: 0 });
  assert.equal(events[0].ok, 1);
  assert.equal(typeof events[0].t, 'number');
});

test('weather nack event: ok=0', () => {
  devStats.record({ type: 'weather', outcome: 'nack', categories: { forecast: 'updated' } });
  const events = devStats.read();
  assert.equal(events[1].ok, 0);
});

test('weather full skip: no ok field at all', () => {
  devStats.record({ type: 'weather', outcome: 'skip', categories: { forecast: 'cached' } });
  const events = devStats.read();
  assert.equal(Object.prototype.hasOwnProperty.call(events[2], 'ok'), false, 'skip must omit ok');
  assert.deepEqual(events[2].c, { forecast: 0 });
});

test('setting events use sent instead of c', () => {
  devStats.record({ type: 'setting', outcome: 'ack', categories: { clay: 'updated' } });
  devStats.record({ type: 'setting', outcome: 'skip', categories: { clay: 'cached' } });
  const events = devStats.read();
  assert.equal(events[3].k, 'setting');
  assert.equal(events[3].sent, 1);
  assert.equal(events[3].ok, 1);
  assert.equal(Object.prototype.hasOwnProperty.call(events[3], 'c'), false, 'setting must omit c');
  assert.equal(events[4].sent, 0);
  assert.equal(Object.prototype.hasOwnProperty.call(events[4], 'ok'), false);
});

test('setEnabled(false) re-gates recording', () => {
  devStats.setEnabled(false);
  const countBefore = devStats.read().length;
  devStats.record({ type: 'weather', outcome: 'ack', categories: { forecast: 'updated' } });
  assert.equal(devStats.read().length, countBefore, 'setEnabled(false) must re-gate recording');
  devStats.setEnabled(true);
});

test('pruning: events older than 7 days vanish from read() and on the next record()', () => {
  const expired = { k: 'weather', t: Date.now() - 8 * DAY_MS, c: { forecast: 1 }, ok: 1 };
  store[KEYS.DEV_STATS_KEY] = JSON.stringify([expired].concat(devStats.read()));
  assert.equal(devStats.read().length, 5, 'read() must hide expired events');
  devStats.record({ type: 'weather', outcome: 'ack', categories: { forecast: 'updated' } });
  assert.equal(JSON.parse(store[KEYS.DEV_STATS_KEY]).length, 6, 'record() must prune expired events');
});

test('corrupt storage recovers cleanly', () => {
  store[KEYS.DEV_STATS_KEY] = 'not json';
  assert.deepEqual(devStats.read(), []);
  devStats.record({ type: 'weather', outcome: 'ack', categories: { forecast: 'updated' } });
  assert.equal(devStats.read().length, 1);
});

test('null/garbage array elements are filtered out, never thrown on', () => {
  store[KEYS.DEV_STATS_KEY] = JSON.stringify([null, 42, { k: 'weather', t: Date.now(), c: { forecast: 1 }, ok: 1 }]);
  assert.equal(devStats.read().length, 1, 'null elements must be filtered, not thrown on');
});

test('clear() wipes the stored log and is a no-op on already-empty storage', () => {
  devStats.clear();
  assert.equal(store[KEYS.DEV_STATS_KEY], undefined, 'clear() must remove the stored key');
  assert.deepEqual(devStats.read(), [], 'read() must be empty after clear()');
  devStats.clear();
  assert.deepEqual(devStats.read(), [], 'clear() on empty storage must be a no-op');
});

test('gc() prunes expired events even while recording is disabled', () => {
  devStats.setEnabled(false);
  const now = Date.now();
  const fresh = { k: 'weather', t: now - 1 * DAY_MS, c: { forecast: 1 }, ok: 1 };
  const expired = { k: 'weather', t: now - 8 * DAY_MS, c: { forecast: 1 }, ok: 1 };
  store[KEYS.DEV_STATS_KEY] = JSON.stringify([expired, fresh]);
  devStats.gc(now);
  assert.deepEqual(JSON.parse(store[KEYS.DEV_STATS_KEY]), [fresh], 'expired events rewritten away');
  devStats.gc(now);
  assert.deepEqual(JSON.parse(store[KEYS.DEV_STATS_KEY]), [fresh], 'no-op when nothing expired');
});

test('summarize() rolls the whole window up per local day and hands over only the newest 100 events', () => {
  devStats.clear();
  const now = Date.now();
  const noon = new Date(now); noon.setHours(12, 0, 0, 0);
  const today = noon.getTime() > now ? noon.getTime() - DAY_MS : noon.getTime();
  const yesterday = today - DAY_MS;
  const events = [];
  // Yesterday: 150 delivered weather sends -- more than the raw list carries.
  for (let i = 0; i < 150; i += 1) {
    events.push({ k: 'weather', t: yesterday + i * 1000, c: { forecast: 1, sun: 0 }, ok: 1 });
  }
  // Today: a rejected send (counted as nack, never as sent/cached), a cache-skip,
  // a notice-only send, and a settings send.
  events.push({ k: 'weather', t: today, c: { forecast: 1 }, ok: 0 });
  events.push({ k: 'weather', t: today + 1000, c: { forecast: 0 } });
  events.push({ k: 'weather', t: today + 2000, c: { notice: 1 }, ok: 1 });
  events.push({ k: 'setting', t: today + 3000, sent: 1, ok: 1 });
  store[KEYS.DEV_STATS_KEY] = JSON.stringify(events);

  const s = devStats.summarize();
  assert.equal(s.total, 154);
  assert.equal(s.events.length, 100, 'raw events capped');
  assert.deepEqual(s.events[s.events.length - 1], events[events.length - 1], 'the newest are kept');
  assert.equal(s.days.length, 2);
  const pad = (n) => (n < 10 ? '0' : '') + n;
  const key = (t) => { const d = new Date(t); return pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
  assert.deepEqual(s.days[0], {
    d: key(yesterday),
    weather: { ack: 150, nack: 0, skip: 0 },
    setting: { ack: 0, nack: 0, skip: 0 },
    cats: { forecast: { sent: 150, cached: 0 }, sun: { sent: 0, cached: 150 } }
  }, 'the day total counts all 150, not just the raw events the page lists');
  assert.deepEqual(s.days[1], {
    d: key(today),
    weather: { ack: 1, nack: 1, skip: 1 },
    setting: { ack: 1, nack: 0, skip: 0 },
    cats: { forecast: { sent: 0, cached: 1 }, notice: { sent: 1, cached: 0 } }
  });
});

test('summarize() of an empty log is an empty summary', () => {
  devStats.clear();
  assert.deepEqual(devStats.summarize(), { days: [], events: [], total: 0 });
});

test('gc() removes the key entirely when every event expired', () => {
  const now = Date.now();
  store[KEYS.DEV_STATS_KEY] = JSON.stringify([{ k: 'weather', t: now - 9 * DAY_MS, c: {}, ok: 1 }]);
  devStats.gc(now);
  assert.equal(store[KEYS.DEV_STATS_KEY], undefined, 'all-expired log removed');
  devStats.gc(now);
  assert.equal(store[KEYS.DEV_STATS_KEY], undefined, 'gc on empty storage is a no-op');
});
