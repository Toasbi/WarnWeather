'use strict';
// The read schedule every plugin read shares (plugin-read-schedule.js), on a reader of the
// test's own: when a read runs, what is kept of it, and when the watch is owed a status. What
// each reader wants, when its next read is due and what it keeps of an answer are its own
// tests' (battery-estimate.test.js, plugin-value-source.test.js, and the domain tests of their
// rules); how the owed status reaches the watch is status-rebake's.
const test = require('node:test');
const assert = require('node:assert/strict');
const { fakePebble, heldTimers } = require('../../helpers/plugin-host.js');

// AGENTS.md: a module that touches storage needs `global.localStorage` mocked BEFORE the
// watch modules load. One store object, emptied in place; `writes` lists every key written
// or removed, and a key in `refused` throws as a full storage does.
const storage = {};
const writes = [];
const refused = new Set();
global.localStorage = {
  getItem(k) { return Object.prototype.hasOwnProperty.call(storage, k) ? storage[k] : null; },
  setItem(k, v) {
    if (refused.has(k)) { throw new Error('QuotaExceededError'); }
    writes.push(k);
    storage[k] = String(v);
  },
  removeItem(k) { writes.push(k); delete storage[k]; }
};

const pluginReadSchedule = require('../../../src/pkjs/status-bars/adapter/plugin-read-schedule.js');
const statusRebake = require('../../../src/pkjs/status-bars/application/status-rebake.js');

const realLog = console.log;
const realOwe = statusRebake.oweStatus;
// The status sends the watch is owed (status-rebake.js oweStatus), counted since the last boot.
let owed = 0;
// Of them, the ones the user waits for at the phone (oweStatus waitedFor): a save's read.
let waited = 0;
test.before(() => {
  console.log = function () {};
  statusRebake.oweStatus = (waitedFor) => {
    owed += 1;
    if (waitedFor) { waited += 1; }
  };
});
test.after(() => {
  console.log = realLog;
  statusRebake.oweStatus = realOwe;
});

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
/** The reader's wait after an answer, and after a failure. */
const EVERY = 2 * HOUR;
const RETRY = HOUR;
/** How long the slot shows a value after it was made. */
const SHOWN = 6 * HOUR;
const READ = 'test_read';
const VALUE = 'test_value';
/** Midday: outside the Night battery saver's window. */
const NOON = new Date(2026, 10, 21, 12, 0, 0).getTime();
/** 3:00, inside it. */
const NIGHT = new Date(2026, 10, 21, 3, 0, 0).getTime();
/** The Night battery saver, on with its shipped 0:00-07:00 window. */
const SAVER_ON = { sleepNightEnabled: true, sleepStartHour: '0', sleepEndHour: '7' };
/** The settings that want what the key 'a' names. */
const WANT_A = { want: 'a' };

/**
 * The test's reader: it wants what settings.want names (each its own key and item, the item
 * whole: no properties asked for, so any answer is the answer, plugin-reader.js readOnce), reads
 * again EVERY after an answer or once the answer's `until` is past, whichever is later, and
 * RETRY after a failure. It keeps an answer's text, made at the answer's `at` or as it came,
 * and the slot shows it for SHOWN after that while the settings want its key.
 * @type {Object}
 */
const SPEC = {
  name: 'test-reader',
  recordKey: READ,
  valueKey: VALUE,
  timeField: 'until',
  wanted: (settings) => (settings && settings.want
    ? { key: settings.want, request: { category: 'test', item: settings.want } } : null),
  nextReadAt: (record) => (record.failures > 0 ? record.at + RETRY
    : Math.max(record.at + EVERY, record.until === null ? 0 : record.until)),
  heard: (envelope, want, nowMs) => ({
    time: typeof envelope.until === 'number' ? envelope.until : null,
    value: typeof envelope.text === 'string'
      ? { source: want.key, text: envelope.text, at: typeof envelope.at === 'number' ? envelope.at : nowMs } : null
  }),
  valueOf: (v) => (v && typeof v.source === 'string' && typeof v.text === 'string' && typeof v.at === 'number'
    ? v : null),
  shown: (value, settings, nowMs) => (value && settings && value.source === settings.want
    && nowMs < value.at + SHOWN ? value.text : null),
  sameShown: (a, b) => a === b
};
const schedule = pluginReadSchedule.create(SPEC);

/**
 * A reader of one thing only, as the watch battery's days left is: its key is null, and its
 * value names no source.
 */
const ONE_THING = pluginReadSchedule.create(Object.assign({}, SPEC, {
  wanted: (settings) => (settings && settings.want
    ? { key: null, request: { category: 'test', item: 'one' } } : null),
  heard: (envelope, want, nowMs) => ({ time: null,
    value: typeof envelope.text === 'string' ? { text: envelope.text, at: nowMs } : null }),
  valueOf: (v) => (v && typeof v.text === 'string' && typeof v.at === 'number' ? v : null),
  shown: (value, settings, nowMs) => (value && nowMs < value.at + SHOWN ? value.text : null)
}));

/**
 * Boot the schedule, every dependency injected: a PKJS start.
 * @param {Object} [opts] {settings, pebble, clock, keepStorage, schedule}.
 * @returns {Object} Handle: mutable .clock/.settings, .pebble, .timers.
 */
function boot(opts) {
  opts = opts || {};
  if (!opts.keepStorage) { Object.keys(storage).forEach((k) => { delete storage[k]; }); }
  owed = 0;
  waited = 0;
  writes.length = 0;
  const h = {
    clock: opts.clock || NOON,
    settings: opts.settings || WANT_A,
    pebble: Object.prototype.hasOwnProperty.call(opts, 'pebble') ? opts.pebble : fakePebble(),
    timers: []
  };
  (opts.schedule || schedule).init({
    pebble: h.pebble,
    getSettings: () => h.settings,
    getWatchInfo: () => ({ platform: 'basalt' }),
    now: () => h.clock,
    timers: heldTimers(h.timers)
  });
  return h;
}

/**
 * @param {string} key A storage key.
 * @returns {*} What is stored under it, parsed; null for none.
 */
function stored(key) {
  const raw = storage[key];
  return raw === undefined ? null : JSON.parse(raw);
}

test('init refuses to start without its suppliers', () => {
  assert.throws(() => schedule.init(), /test-reader: init needs getSettings, getWatchInfo and now/);
  assert.throws(() => schedule.init({ getSettings: () => ({}), now: () => 0 }), /init needs/);
  assert.throws(() => schedule.init({ getSettings: () => ({}), getWatchInfo: () => null }), /init needs/);
});

test('wanted and never read: read at start, its record stamped before the answer, with a timeout', () => {
  const h = boot();
  assert.equal(h.pebble.subs.length, 1);
  assert.deepEqual(h.pebble.subs[0].request, { category: 'test', item: 'a' });
  assert.deepEqual(stored(READ), { source: 'a', at: NOON, failures: 0, until: null });
  assert.equal(h.timers.length, 1);
  assert.equal(owed, 0, 'a read owes nothing');
});

test('not wanted: nothing is read and nothing stored, at a start, a tick or a save', () => {
  const h = boot({ settings: {} });
  schedule.onTick();
  schedule.refresh();
  assert.equal(h.pebble.subs.length, 0);
  assert.deepEqual(writes, []);
});

test('a Pebble app without plugins: nothing is read, nothing thrown', () => {
  [null, {}, { subscribeToSource: 'no' }].forEach((pebble) => {
    boot({ pebble: pebble });
    assert.equal(schedule.available(), false);
    assert.doesNotThrow(() => { schedule.onTick(); schedule.refresh(); });
    assert.deepEqual(writes, [], JSON.stringify(pebble));
  });
});

test('an answer is kept here and in storage, ends the subscription, and owes the watch a status', () => {
  const h = boot();
  h.clock += 5000;
  h.pebble.subs[0].push({ text: '87%', until: NOON + 3 * HOUR });
  assert.equal(h.pebble.subs[0].unsubscribed, 1, 'read once: no subscription stays');
  const value = { source: 'a', text: '87%', at: NOON + 5000 };
  assert.deepEqual(schedule.value(), value);
  assert.deepEqual(stored(VALUE), value);
  assert.deepEqual(stored(READ), { source: 'a', at: NOON, failures: 0, until: NOON + 3 * HOUR },
    'the read keeps the reader\'s time from the answer');
  assert.equal(owed, 1, 'the slot shows something new');
});

test('a value heard again owes nothing and writes nothing; one the slot shows otherwise owes the watch', () => {
  const h = boot();
  const answerAt = (envelope) => {
    h.clock += EVERY;
    schedule.onTick();
    h.pebble.subs[h.pebble.subs.length - 1].push(envelope);
  };
  h.pebble.subs[0].push({ text: '87%', at: NOON - MIN });
  writes.length = 0;
  answerAt({ text: '87%', at: NOON - MIN });
  assert.deepEqual(writes.filter((k) => k === VALUE), [], 'the value kept, heard again: no write');
  answerAt({ text: '87%' });
  assert.deepEqual(writes.filter((k) => k === VALUE), [VALUE], 'a newer one is written');
  assert.equal(owed, 1, 'but the slot shows the same: nothing owed');
  answerAt({ text: '90%' });
  assert.equal(owed, 2);
  answerAt({});
  assert.equal(stored(VALUE), null, 'an answer with nothing to keep drops the value');
  assert.equal(owed, 3, 'and the slot shows nothing now');
  answerAt({});
  assert.deepEqual(writes.filter((k) => k === VALUE), [VALUE, VALUE, VALUE], 'nothing, heard twice: dropped once');
  assert.equal(owed, 3);
});

test('a restart reads nothing before the next read is due, and holds the value kept from the start', () => {
  let h = boot();
  h.pebble.subs[0].push({ text: '87%', until: NOON + 3 * HOUR });
  h = boot({ keepStorage: true, clock: NOON + 30 * MIN });
  schedule.refresh();
  assert.equal(h.pebble.subs.length, 0, 'neither the start nor a save');
  assert.deepEqual(schedule.value(), { source: 'a', text: '87%', at: NOON });
  assert.equal(owed, 1, 'a start owes a send: whether the watch got the value died with the last PKJS');
  h.clock = NOON + 3 * HOUR - MIN;
  schedule.onTick();
  assert.equal(h.pebble.subs.length, 0);
  h.clock = NOON + 3 * HOUR;
  schedule.onTick();
  assert.equal(h.pebble.subs.length, 1, 'due by the reader\'s time, kept in storage');
});

test('a start owes a send only while the slot shows a value kept', () => {
  let h = boot();
  assert.equal(owed, 0, 'nothing kept');
  h.pebble.subs[0].push({ text: '87%' });
  h = boot({ keepStorage: true, clock: NOON + MIN });
  assert.equal(owed, 1);
  boot({ keepStorage: true, clock: NOON + SHOWN });
  assert.equal(owed, 0, 'grown too old: the slot shows none');
  boot({ keepStorage: true, clock: NOON + MIN, settings: {} });
  assert.equal(owed, 0, 'nothing wanted');
});

test('the answer to a read a save asked for is owed as waited for; one the clock asked for is not', () => {
  const h = boot({ settings: {} });
  h.settings = WANT_A;
  schedule.refresh();
  h.pebble.subs[0].push({ text: '87%' });
  assert.deepEqual([owed, waited], [1, 1], 'the user waits at the phone: paid inside the saver\'s window too');
  h.clock = NOON + EVERY;
  schedule.onTick();
  h.pebble.subs[1].push({ text: '90%' });
  assert.deepEqual([owed, waited], [2, 1], 'the next one waits for the window\'s end');
});

test('a read that PKJS ends before the answer still counts', () => {
  boot();
  const h = boot({ keepStorage: true, clock: NOON + MIN });
  schedule.refresh();
  assert.equal(h.pebble.subs.length, 0, 'not read again at the next start');
  h.clock = NOON + EVERY;
  schedule.onTick();
  assert.equal(h.pebble.subs.length, 1, 'but when it is due');
});

test('one read at a time: neither a tick nor a save reads while one is under way, and a timeout ends it', () => {
  const h = boot();
  h.clock = NOON + 3 * HOUR;
  schedule.onTick();
  schedule.refresh();
  assert.equal(h.pebble.subs.length, 1);
  h.timers[0].fn();
  assert.equal(h.pebble.subs[0].unsubscribed, 1, 'given up on');
  assert.deepEqual(stored(READ), { source: 'a', at: NOON, failures: 1, until: null }, 'a failure');
  schedule.onTick();
  assert.equal(h.pebble.subs.length, 2, 'read again once the wait after a failure is over');
});

test('not wanted any more: the record is forgotten and the value kept, so wanted again it is read at once', () => {
  let h = boot();
  h.pebble.subs[0].push({ text: '87%' });
  h.clock += 10 * MIN;
  h.settings = {};
  schedule.refresh();
  assert.equal(stored(READ), null);
  assert.deepEqual(stored(VALUE), { source: 'a', text: '87%', at: NOON }, 'kept, for a bake once it is wanted again');
  h.clock += 10 * MIN;
  h.settings = WANT_A;
  schedule.refresh();
  assert.equal(h.pebble.subs.length, 2, 'wanted again: read at once');
  h = boot({ keepStorage: true, settings: {}, clock: h.clock + MIN });
  assert.equal(stored(READ), null, 'a start that finds it not wanted forgets too');
});

test('another key: the old key\'s record and value are forgotten, and the new one is read at once', () => {
  const h = boot();
  h.pebble.subs[0].push({ text: '87%' });
  h.clock += 10 * MIN;
  h.settings = { want: 'b' };
  schedule.refresh();
  assert.equal(schedule.value(), null);
  assert.equal(stored(VALUE), null);
  assert.equal(h.pebble.subs.length, 2);
  assert.equal(h.pebble.subs[1].request.item, 'b');
  assert.deepEqual(stored(READ), { source: 'b', at: NOON + 10 * MIN, failures: 0, until: null },
    'nothing of the old read carries over');
  assert.equal(owed, 1, 'the first answer\'s alone: the save sends its own status');
});

test('an answer after what is wanted changed is dropped, and what is wanted now is read as it comes, in the Night battery saver\'s window too', () => {
  const h = boot({ settings: SAVER_ON, clock: NIGHT });
  h.settings = Object.assign({}, WANT_A, SAVER_ON);
  schedule.refresh();
  assert.equal(h.pebble.subs.length, 1, 'a save with no read before it reads in the window');
  h.settings = Object.assign({ want: 'b' }, SAVER_ON);
  schedule.refresh();
  assert.equal(h.pebble.subs.length, 1, 'no second read while the first is under way');
  h.pebble.subs[0].push({ text: 'A' });
  assert.equal(schedule.value(), null, 'the answer for a is not kept');
  assert.equal(stored(VALUE), null);
  assert.equal(h.pebble.subs.length, 2, 'b, read as the first read ends: the save it held up');
  assert.equal(h.pebble.subs[1].request.item, 'b');
  schedule.onTick();
  assert.equal(h.pebble.subs.length, 2, 'one read at a time');
  h.settings = Object.assign({ want: 'c' }, SAVER_ON);
  schedule.refresh();
  h.pebble.subs[1].fail('TIMEOUT');
  assert.deepEqual(stored(READ), { source: 'c', at: NIGHT, failures: 0, until: null },
    'a failure that comes after a change is dropped as well, and c is read');
  assert.equal(h.pebble.subs.length, 3);
});

test('the plugin not there: the value kept is dropped, and the record keeps no failure and no time', () => {
  const h = boot();
  h.pebble.subs[0].push({ text: '87%', until: NOON + 3 * HOUR });
  h.clock = NOON + 3 * HOUR;
  schedule.onTick();
  h.pebble.subs[1].fail('PLUGIN_UNAVAILABLE');
  assert.equal(schedule.value(), null);
  assert.equal(stored(VALUE), null);
  assert.deepEqual(stored(READ), { source: 'a', at: NOON + 3 * HOUR, failures: 0, until: null });
  assert.equal(owed, 2, 'the slot shows nothing now');
});

test('any other failure keeps the value and the reader\'s time, and counts; an answer ends the count', () => {
  const h = boot();
  h.pebble.subs[0].push({ text: '87%', until: NOON + 3 * HOUR });
  h.clock = NOON + 3 * HOUR;
  schedule.onTick();
  h.pebble.subs[1].fail('PERMISSION_DENIED');
  assert.deepEqual(schedule.value(), { source: 'a', text: '87%', at: NOON });
  assert.deepEqual(stored(READ), { source: 'a', at: NOON + 3 * HOUR, failures: 1, until: NOON + 3 * HOUR });
  h.clock += RETRY;
  schedule.onTick();
  h.pebble.subs[2].fail('UNKNOWN');
  assert.equal(stored(READ).failures, 2);
  h.clock += RETRY;
  schedule.onTick();
  h.pebble.subs[3].push({ text: '88%' });
  assert.deepEqual(stored(READ), { source: 'a', at: NOON + 5 * HOUR, failures: 0, until: null });
  assert.equal(owed, 2, 'the first value and the new one');
});

test('a save\'s read that times out or fails without a reason is read again at the next tick, once, in the Night battery saver\'s window too', () => {
  ['TIMEOUT', 'UNKNOWN'].forEach((code) => {
    const h = boot({ settings: {} });
    h.settings = WANT_A;
    schedule.refresh();
    h.pebble.subs[0].fail(code);
    h.clock += MIN;
    schedule.onTick();
    assert.equal(h.pebble.subs.length, 2, code + ': read again at the next tick, not an hour later');
    h.pebble.subs[1].fail(code);
    assert.deepEqual(stored(READ), { source: 'a', at: NOON + MIN, failures: 2, until: null }, code);
    h.clock += MIN;
    schedule.onTick();
    assert.equal(h.pebble.subs.length, 2, code + ': once: then the wait after a failure');
  });
  const h = boot({ settings: SAVER_ON, clock: NIGHT });
  h.settings = Object.assign({}, WANT_A, SAVER_ON);
  schedule.refresh();
  h.pebble.subs[0].fail('TIMEOUT');
  h.clock += MIN;
  schedule.onTick();
  assert.equal(h.pebble.subs.length, 2, 'the save\'s read went in the window: so does its read again');
  h.pebble.subs[1].push({ text: '87%' });
  assert.deepEqual([owed, waited], [1, 1], 'its answer is owed as the save\'s');
});

test('no read again at the next tick for a failure that would come back, nor for a read no save asked for', () => {
  ['PERMISSION_DENIED', 'RATE_LIMITED', 'AUTH_REQUIRED', 'INVALID_REQUEST'].forEach((code) => {
    const h = boot({ settings: {} });
    h.settings = WANT_A;
    schedule.refresh();
    h.pebble.subs[0].fail(code);
    h.clock += MIN;
    schedule.onTick();
    assert.equal(h.pebble.subs.length, 1, code);
  });
  const h = boot();
  h.pebble.subs[0].fail('TIMEOUT');
  h.clock += MIN;
  schedule.onTick();
  assert.equal(h.pebble.subs.length, 1, 'a start\'s read waits the reader\'s wait after a failure');
});

test('a save after a read that failed reads again at once, in the Night battery saver\'s window too; after one answered, it does not', () => {
  let h = boot();
  h.pebble.subs[0].fail('PERMISSION_DENIED');
  h.clock += 10 * MIN;
  schedule.refresh();
  assert.equal(h.pebble.subs.length, 2, 'no value came for what the user picked: they are at the phone');
  assert.deepEqual(stored(READ), { source: 'a', at: NOON + 10 * MIN, failures: 1, until: null },
    'stamped as it starts, its failures still counted');
  h.pebble.subs[1].push({ text: '87%' });
  h.clock += 10 * MIN;
  schedule.refresh();
  assert.equal(h.pebble.subs.length, 2, 'answered: the next read waits for its time');
  h = boot({ settings: Object.assign({}, WANT_A, SAVER_ON), clock: new Date(2026, 10, 21, 23, 0, 0).getTime() });
  h.pebble.subs[0].fail('PERMISSION_DENIED');
  h.clock = NIGHT;
  schedule.onTick();
  assert.equal(h.pebble.subs.length, 1, 'no tick reads in the window');
  schedule.refresh();
  assert.equal(h.pebble.subs.length, 2, 'a save does');
});

test('another source picked forgets the read again owed to the old one: the new one is read at once', () => {
  const h = boot({ settings: {} });
  h.settings = WANT_A;
  schedule.refresh();
  h.pebble.subs[0].fail('TIMEOUT');
  h.settings = { want: 'b' };
  schedule.refresh();
  assert.equal(h.pebble.subs.length, 2);
  assert.equal(h.pebble.subs[1].request.item, 'b');
  h.pebble.subs[1].fail('TIMEOUT');
  h.clock += MIN;
  schedule.onTick();
  assert.equal(h.pebble.subs.length, 3, 'the new source\'s save read gets its own read again');
  assert.equal(h.pebble.subs[2].request.item, 'b');
  h.settings = {};
  schedule.refresh();
  h.pebble.subs[2].fail('TIMEOUT');
  h.settings = WANT_A;
  h.clock += MIN;
  schedule.onTick();
  assert.equal(h.pebble.subs.length, 4, 'wanted again: read at once, as a value wanted again is');
});

test('a clock that went back starts the wait again from now, and never reads early', () => {
  const h = boot();
  h.pebble.subs[0].push({ text: '87%' });
  h.clock = NOON - 3 * HOUR;
  schedule.onTick();
  assert.equal(h.pebble.subs.length, 1, 'no read for it');
  assert.deepEqual(stored(READ), { source: 'a', at: NOON - 3 * HOUR, failures: 0, until: null });
  h.clock = NOON - 3 * HOUR + EVERY - MIN;
  schedule.onTick();
  assert.equal(h.pebble.subs.length, 1);
  h.clock += MIN;
  schedule.onTick();
  assert.equal(h.pebble.subs.length, 2, 'not once the old time comes round');
});

test('the Night battery saver: a read due in its window waits for the window to close, a save\'s too', () => {
  const h = boot({ settings: Object.assign({}, WANT_A, SAVER_ON), clock: new Date(2026, 10, 21, 23, 0, 0).getTime() });
  h.pebble.subs[0].push({ text: '87%' });
  h.clock = new Date(2026, 10, 22, 1, 0, 0).getTime();
  schedule.onTick();
  h.clock = new Date(2026, 10, 22, 6, 59, 0).getTime();
  schedule.onTick();
  schedule.refresh();
  assert.equal(h.pebble.subs.length, 1, 'no read in the window, a save with a read on record included');
  h.clock = new Date(2026, 10, 22, 7, 0, 0).getTime();
  schedule.onTick();
  assert.equal(h.pebble.subs.length, 2, 'the first tick after it');
});

test('the Night battery saver: a start in its window with nothing read waits for it too', () => {
  const h = boot({ settings: Object.assign({}, WANT_A, SAVER_ON), clock: NIGHT });
  assert.equal(h.pebble.subs.length, 0, 'no read on a start at 3:00');
  h.clock = new Date(2026, 10, 21, 6, 59, 0).getTime();
  schedule.onTick();
  assert.equal(h.pebble.subs.length, 0);
  h.clock = new Date(2026, 10, 21, 7, 0, 0).getTime();
  schedule.onTick();
  assert.equal(h.pebble.subs.length, 1);
});

test('the Night battery saver: a save in its window with no read before it reads at once', () => {
  const h = boot({ settings: Object.assign({}, WANT_A, SAVER_ON), clock: NIGHT });
  schedule.refresh();
  assert.equal(h.pebble.subs.length, 1, 'the user is at the phone, waiting to see the value');
});

test('a value the slot stops showing with the time owes the watch a status at the tick it does; a save owes none', () => {
  let h = boot();
  // The plugin says its answer holds 10 hours: no read before then.
  h.pebble.subs[0].push({ text: '87%', until: NOON + 10 * HOUR });
  h.clock = NOON + SHOWN - MIN;
  schedule.onTick();
  assert.equal(owed, 1, 'still shown');
  h.clock = NOON + SHOWN;
  schedule.onTick();
  assert.equal(owed, 2, 'shown no more: the watch is owed the status without it');
  h.clock += MIN;
  schedule.onTick();
  assert.equal(owed, 2, 'once');
  h = boot();
  h.pebble.subs[0].push({ text: '87%', until: NOON + 10 * HOUR });
  h.clock = NOON + SHOWN;
  schedule.refresh();
  h.clock += MIN;
  schedule.onTick();
  assert.equal(owed, 1, 'a save sends its own status, and the tick after it owes none');
});

test('storage that refuses the record of a read still reads no more often', (t) => {
  t.after(() => refused.clear());
  refused.add(READ);
  const h = boot();
  h.pebble.subs[0].push({ text: '87%' });
  assert.equal(stored(READ), null, 'not stored');
  for (let i = 0; i < 60; i++) {
    h.clock += MIN;
    schedule.onTick();
    schedule.refresh();
  }
  assert.equal(h.pebble.subs.length, 1, 'this PKJS life keeps the record itself');
});

test('storage that refuses the value: it is kept here all the same', (t) => {
  t.after(() => refused.clear());
  refused.add(VALUE);
  const h = boot();
  h.pebble.subs[0].push({ text: '87%' });
  assert.equal(stored(VALUE), null, 'not stored');
  assert.deepEqual(schedule.value(), { source: 'a', text: '87%', at: NOON });
  assert.equal(owed, 1);
});

test('unreadable storage reads as no record and no value: read once, and both are whole again', () => {
  [['{oops', '{oops'], ['null', 'null'], ['{"source":"a","at":"x","failures":0}', '{"source":"a"}'],
    ['{"source":"a","at":1700000000000}', '5']].forEach(([read, value]) => {
    Object.keys(storage).forEach((k) => { delete storage[k]; });
    storage[READ] = read;
    storage[VALUE] = value;
    const h = boot({ keepStorage: true });
    assert.equal(h.pebble.subs.length, 1, read);
    assert.equal(schedule.value(), null, value);
    h.pebble.subs[0].push({ text: '87%' });
    assert.deepEqual(stored(READ), { source: 'a', at: NOON, failures: 0, until: null }, read);
    assert.deepEqual(stored(VALUE), { source: 'a', text: '87%', at: NOON }, value);
  });
});

test('a reader of one thing only: its record names no key, and a restart reads nothing before it is due', () => {
  const first = boot({ schedule: ONE_THING });
  assert.deepEqual(first.pebble.subs[0].request, { category: 'test', item: 'one' });
  first.pebble.subs[0].push({ text: '87%' });
  assert.deepEqual(stored(READ), { source: null, at: NOON, failures: 0, until: null });
  const h = boot({ schedule: ONE_THING, keepStorage: true, clock: NOON + EVERY - MIN });
  ONE_THING.refresh();
  assert.equal(h.pebble.subs.length, 0);
  assert.deepEqual(ONE_THING.value(), { text: '87%', at: NOON });
  h.clock += MIN;
  ONE_THING.onTick();
  assert.equal(h.pebble.subs.length, 1);
});
