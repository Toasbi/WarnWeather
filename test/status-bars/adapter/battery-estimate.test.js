'use strict';
// The estimate of the days the watch has left (Muninn's plugin): when it is read, what is
// kept of it, and when the watch is told. When a read is due is estimate-reads.test.js';
// the bake of the days is status-lines-battery-days.test.js'.
const test = require('node:test');
const assert = require('node:assert/strict');
const { withHost } = require('../../helpers/rebake-host.js');

// AGENTS.md: a module that touches storage needs `global.localStorage` mocked BEFORE the
// watch modules load. One store object, emptied in place.
const storage = {};
global.localStorage = {
  getItem(k) { return Object.prototype.hasOwnProperty.call(storage, k) ? storage[k] : null; },
  setItem(k, v) { storage[k] = String(v); },
  removeItem(k) { delete storage[k]; }
};

const batteryEstimate = require('../../../src/pkjs/status-bars/adapter/battery-estimate.js');
const statusRebake = require('../../../src/pkjs/status-bars/application/status-rebake.js');
const KEYS = require('../../../src/pkjs/settings/domain/storage-keys.js');
const batteryDays = require('../../../src/pkjs/status-bars/domain/battery-days.js');
const reads = require('../../../src/pkjs/status-bars/domain/estimate-reads.js');
const { decodeLine } = require('../../helpers/status-line-bytes.js');

const realLog = console.log;
test.before(() => { console.log = function () {}; });
test.after(() => { console.log = realLog; });

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
// The longest wait after an answer that heard when Muninn made its estimate: one made as it
// was read is followed by the read after Muninn's next (estimate-reads.js nextReadAt).
const LONGEST = reads.PERIOD_MS + reads.SETTLE_MS;
// The wait after an answer with no rhythm to follow (no Muninn, no estimate time).
const IDLE = reads.IDLE_INTERVAL_MS;
// The watch battery in its Text look, set to show the days left.
const TEXT_LOOK = { statusTopRight: 'battery', batterySlotLook: 'text' };
const DAYS_ON = Object.assign({ batterySlotDisplay: 'days' }, TEXT_LOOK);
/** The Night battery saver, on with its shipped 0:00-07:00 window. */
const SAVER_ON = { sleepNightEnabled: true, sleepStartHour: '0', sleepEndHour: '7' };
/** Midday: outside the Night battery saver's window. */
const NOON = new Date(2026, 10, 21, 12, 0, 0).getTime();

/**
 * A Pebble app with plugins: records every subscription and lets the test answer it.
 * @returns {Object} The fake, with .subs (each {request, push, fail, unsubscribed}).
 */
function fakePebble() {
  const pebble = { subs: [] };
  pebble.subscribeToSource = (config) => {
    const sub = { request: { category: config.category, item: config.item, properties: config.properties },
      unsubscribed: 0,
      push: (envelope) => config.onData(envelope),
      fail: (code) => config.onError({ code: code, message: code }) };
    pebble.subs.push(sub);
    return { unsubscribe: () => { sub.unsubscribed += 1; } };
  };
  return pebble;
}

/** Muninn's answer, as its plugin sends it (-1 for a number it does not have). */
function stats(daysRemaining, updatedAt) {
  return { pluginUuid: 'd008a08a-6e34-4cc4-98dc-bae02ce5e087', instances: [{ instanceId: '0', properties: {
    daysRemaining: { numericValue: { value: daysRemaining, unit: 'days' } },
    batteryLife: { numericValue: { value: 7, unit: 'days' } },
    lastWeekRate: { numericValue: { value: 14, unit: '%' } },
    updatedAt: { numericValue: { value: updatedAt } }
  } }] };
}

/**
 * Boot the reader with its re-baker, every dependency injected: a PKJS start.
 * @param {Object} [opts] {settings, pebble, clock, keepStorage, watchInfo}.
 * @returns {Object} Handle: mutable .clock/.settings, .pebble, collected .sends, .timers.
 */
function boot(opts) {
  opts = opts || {};
  if (!opts.keepStorage) { Object.keys(storage).forEach((k) => { delete storage[k]; }); }
  const h = {
    clock: opts.clock || NOON,
    settings: opts.settings || DAYS_ON,
    pebble: Object.prototype.hasOwnProperty.call(opts, 'pebble') ? opts.pebble : fakePebble(),
    sends: [],
    timers: []
  };
  statusRebake.init(withHost({
    getSettings: () => h.settings,
    getBakeFacts: () => ({ watch: batteryEstimate.bakeFacts() }),
    sendWeather: (p) => { h.sends.push(p); },
    now: () => h.clock
  }));
  // The inputs of a bake the re-bake can re-bake: the real baker runs.
  statusRebake.rememberBakeInputs({ CITY: 'Bonn', CURRENT_TEMP: 68, SUN_EVENTS: [1, 0, 0, 0, 0] },
    opts.watchInfo || { platform: 'basalt' }, new Date(h.clock));
  batteryEstimate.init({
    pebble: h.pebble,
    getSettings: () => h.settings,
    getWatchInfo: () => opts.watchInfo || { platform: 'basalt' },
    now: () => h.clock,
    timers: {
      setTimeout: (fn, ms) => { h.timers.push({ fn: fn, ms: ms }); return h.timers.length; },
      clearTimeout: () => {}
    }
  });
  return h;
}

/**
 * The scheduler's minute, as index.js runs it: the estimate's tick (it may ask Muninn), then
 * the re-bake's, which sends what the watch is owed.
 * @returns {void}
 */
function minute() {
  batteryEstimate.onTick();
  statusRebake.onTick(false);
}

/** The battery slot's text in the last status the watch was sent. */
function sentDays(h) {
  return decodeLine(h.sends[h.sends.length - 1].STATUS_LINE_3_UINT8)[2].text;
}

/** The record of the last read, as stored (null for none). */
function storedRead() {
  const raw = storage[KEYS.BATTERY_ESTIMATE_READ];
  return raw === undefined ? null : JSON.parse(raw);
}

test('init refuses to start without its suppliers', () => {
  assert.throws(() => batteryEstimate.init(), /init needs getSettings, getWatchInfo and now/);
  assert.throws(() => batteryEstimate.init({ getSettings: () => ({}), now: () => 0 }), /init needs/);
  assert.throws(() => batteryEstimate.init({ getSettings: () => ({}), getWatchInfo: () => null }), /init needs/);
});

test('wanted and never read: Muninn is asked at start, for its days and when it made them', () => {
  const h = boot();
  assert.equal(h.pebble.subs.length, 1);
  assert.deepEqual(h.pebble.subs[0].request,
    { category: 'muninn', item: 'stats', properties: ['daysRemaining', 'updatedAt'] });
  assert.equal(h.sends.length, 0, 'asking sends nothing');
});

test('not wanted: nothing is read', () => {
  [TEXT_LOOK,                                                      // the percentage
    { statusTopRight: 'battery', batterySlotDisplay: 'days' },     // the Icon look
    { statusTopRight: 'aqi', batterySlotLook: 'text', batterySlotDisplay: 'days' },   // another item in the slot
    {}].forEach((settings) => {
    const h = boot({ settings: settings });
    assert.equal(h.pebble.subs.length, 0, JSON.stringify(settings));
    batteryEstimate.onTick();
    batteryEstimate.refresh();
    assert.equal(h.pebble.subs.length, 0);
    assert.equal(storedRead(), null, 'and no read is on record');
  });
  assert.equal(boot({ watchInfo: { platform: 'aplite' } }).pebble.subs.length, 0, 'aplite has no such slot');
});

test('a Pebble app without plugins: nothing is read, nothing thrown', () => {
  [null, {}, { subscribeToSource: 'no' }].forEach((pebble) => {
    const h = boot({ pebble: pebble });
    assert.doesNotThrow(() => batteryEstimate.onTick());
    assert.doesNotThrow(() => batteryEstimate.refresh());
    assert.equal(h.sends.length, 0);
    assert.equal(batteryEstimate.bakeFacts().estimate(), null);
  });
});

test('an estimate is kept, ends the subscription, and reaches the watch with the next tick', () => {
  const h = boot();
  h.pebble.subs[0].push(stats(5, h.clock - 60 * MIN));
  assert.equal(h.pebble.subs[0].unsubscribed, 1, 'read once: no subscription stays');
  assert.deepEqual(JSON.parse(storage[KEYS.BATTERY_ESTIMATE]), { days: 5, updatedAt: h.clock - 60 * MIN });
  assert.deepEqual(batteryEstimate.bakeFacts().estimate(), { days: 5, updatedAt: h.clock - 60 * MIN });
  // Never sent from the answer itself: it comes at any moment, beside a settings save's or
  // a boot's own messages, which bake the estimate just kept.
  assert.equal(h.sends.length, 0, 'the answer sends nothing by itself');
  minute();
  assert.equal(h.sends.length, 1, 'the slot changes from the percentage to the days');
  assert.equal(sentDays(h), '5d');
  minute();
  assert.equal(h.sends.length, 1, 'once');
});

test('a message that goes out before the tick carries the estimate, and the tick then sends nothing new', () => {
  const h = boot();
  h.pebble.subs[0].push(stats(5, h.clock));
  // The settings save's own re-bake, or a fetch's bake: it reads the estimate just kept.
  statusRebake.resendStatus('config-close');
  assert.equal(h.sends.length, 1);
  assert.equal(sentDays(h), '5d');
  const sent = JSON.stringify(h.sends[0]);
  minute();
  // The paid send holds the same bytes, which the outbox drops (this host records them).
  assert.equal(JSON.stringify(h.sends[h.sends.length - 1]), sent);
});

test('the read is kept in storage: when it started, the failures it ends with, and when Muninn made what it heard', () => {
  const h = boot();
  const start = h.clock;
  const made = start - HOUR;
  assert.deepEqual(storedRead(), { at: start, failures: 0, made: null }, 'stamped as it starts');
  h.clock += 5 * 1000;
  h.pebble.subs[0].push(stats(5, made));
  assert.deepEqual(storedRead(), { at: start, failures: 0, made: made }, 'the answer adds when Muninn made it');
  h.clock = start + LONGEST;
  batteryEstimate.onTick();
  assert.deepEqual(storedRead(), { at: start + LONGEST, failures: 0, made: made }, 'the next read starts from it');
  h.pebble.subs[1].fail('TIMEOUT');
  assert.deepEqual(storedRead(), { at: start + LONGEST, failures: 1, made: made }, 'a failure keeps it');
  h.clock += reads.RETRY_MS;
  batteryEstimate.onTick();
  assert.deepEqual(storedRead(), { at: start + LONGEST + reads.RETRY_MS, failures: 1, made: made },
    'a retry starts with them');
  h.pebble.subs[2].push(stats(5, h.clock));
  assert.deepEqual(storedRead(), { at: start + LONGEST + reads.RETRY_MS, failures: 0, made: h.clock },
    'and an answer clears them');
});

test('a PKJS restart reads nothing before the next read is due', () => {
  const first = boot();
  first.pebble.subs[0].push(stats(5, first.clock - 20 * MIN));
  const due = first.clock - 20 * MIN + LONGEST;   // 20 minutes after Muninn's next estimate
  // The watchface left and reopened every few minutes, as a day of other apps does.
  for (let at = first.clock + 5 * MIN; at < due; at += 47 * MIN) {
    const h = boot({ keepStorage: true, clock: at });
    batteryEstimate.onTick();
    assert.equal(h.pebble.subs.length, 0, 'a restart ' + ((at - first.clock) / MIN) + ' min after the read');
  }
  const h = boot({ keepStorage: true, clock: due - MIN });
  batteryEstimate.onTick();
  assert.equal(h.pebble.subs.length, 0);
  h.clock = due;
  batteryEstimate.onTick();
  assert.equal(h.pebble.subs.length, 1, 'then the next read, from the time kept');
});

test('a read cut short by the end of PKJS still counts', () => {
  const first = boot();
  assert.equal(first.pebble.subs.length, 1, 'asked, and the watchface left before the answer');
  const h = boot({ keepStorage: true, clock: first.clock + MIN });
  assert.equal(h.pebble.subs.length, 0, 'not asked again at the next start');
  h.clock = first.clock + IDLE;   // nothing heard: no rhythm to follow
  batteryEstimate.onTick();
  assert.equal(h.pebble.subs.length, 1, 'but when it is due');
});

test('an estimate kept from the last PKJS life is baked at once, and the restart reads nothing', () => {
  const first = boot();
  first.pebble.subs[0].push(stats(5, first.clock));
  const h = boot({ keepStorage: true, clock: first.clock + HOUR });
  assert.deepEqual(batteryEstimate.bakeFacts().estimate(), { days: 5, updatedAt: first.clock });
  assert.equal(h.pebble.subs.length, 0);
  statusRebake.resendStatus('fetch');
  assert.equal(sentDays(h), '5d');
});

test('switching the days on asks at once', () => {
  const h = boot({ settings: TEXT_LOOK });
  assert.equal(h.pebble.subs.length, 0, 'the percentage: nothing read');
  h.settings = DAYS_ON;
  batteryEstimate.refresh();
  assert.equal(h.pebble.subs.length, 1, 'just set to days: asked now');
});

test('a settings save with the days left on reads nothing before the next read is due', () => {
  const h = boot();
  h.pebble.subs[0].push(stats(5, h.clock - 20 * MIN));
  [MIN, HOUR, 3 * HOUR, 6 * HOUR - MIN].forEach((later) => {
    h.clock = NOON + later;
    h.settings = Object.assign({}, DAYS_ON, { statusTopLeft: 'city' });   // any other change
    batteryEstimate.refresh();
    assert.equal(h.pebble.subs.length, 1, 'a save ' + (later / MIN) + ' min after the read');
  });
});

test('switching the days off forgets the last read, so switching them on again asks at once', () => {
  const h = boot();
  h.pebble.subs[0].push(stats(5, h.clock));
  assert.ok(storedRead());
  h.clock += 10 * MIN;
  h.settings = TEXT_LOOK;
  batteryEstimate.refresh();
  assert.equal(storedRead(), null, 'off: forgotten');
  assert.ok(storage[KEYS.BATTERY_ESTIMATE], 'the estimate is kept, for a bake once they are on again');
  h.clock += 10 * MIN;
  h.settings = DAYS_ON;
  batteryEstimate.refresh();
  assert.equal(h.pebble.subs.length, 2, 'on again: asked at once');
});

test('a start that finds the days off forgets the last read too', () => {
  const first = boot();
  first.pebble.subs[0].push(stats(5, first.clock));
  boot({ keepStorage: true, settings: TEXT_LOOK, clock: first.clock + MIN });
  assert.equal(storedRead(), null, 'a start that finds them off forgets too');
});

test('the tick asks again when the next read is due, and not a minute before', () => {
  const h = boot();
  const made = h.clock - HOUR;
  h.pebble.subs[0].push(stats(5, made));
  const due = reads.nextReadAt({ at: NOON, failures: 0, made: made });
  assert.equal(due, made + LONGEST, '20 minutes after Muninn\'s next estimate is due');
  h.clock = due - MIN;
  minute();
  assert.equal(h.pebble.subs.length, 1);
  h.clock = due;
  minute();
  assert.equal(h.pebble.subs.length, 2);
});

test('Muninn with no estimate time: the tick asks again 12 hours later', () => {
  const h = boot();
  h.pebble.subs[0].push(stats(-1, -1));
  h.clock = NOON + IDLE - MIN;
  batteryEstimate.onTick();
  assert.equal(h.pebble.subs.length, 1);
  h.clock += MIN;
  batteryEstimate.onTick();
  assert.equal(h.pebble.subs.length, 2);
});

test('Muninn with no days to show but with the time it looked: read after its next wakeup', () => {
  const h = boot();
  // No estimate yet (-1 days), as in its first samples.
  h.pebble.subs[0].push(stats(-1, NOON - 10 * MIN));
  assert.equal(batteryEstimate.bakeFacts().estimate(), null, 'nothing to show');
  assert.equal(storedRead().made, NOON - 10 * MIN, 'but its rhythm is kept');
  h.clock = NOON - 10 * MIN + LONGEST - MIN;
  batteryEstimate.onTick();
  assert.equal(h.pebble.subs.length, 1);
  h.clock += MIN;
  batteryEstimate.onTick();
  assert.equal(h.pebble.subs.length, 2, '20 minutes after its next wakeup');
  // Under a day left, as just before a charge: the read after its next wakeup brings the
  // estimate the charge makes.
  const made = h.clock - 20 * MIN;
  h.pebble.subs[1].push(stats(0, made));
  assert.equal(batteryEstimate.bakeFacts().estimate(), null);
  h.clock = made + LONGEST;
  batteryEstimate.onTick();
  assert.equal(h.pebble.subs.length, 3);
  h.pebble.subs[2].push(stats(9, made + reads.PERIOD_MS));
  minute();
  assert.equal(sentDays(h), '9d');
});

test('the same days heard again send nothing', () => {
  const h = boot();
  h.pebble.subs[0].push(stats(5, h.clock - 60 * MIN));
  h.clock += LONGEST;
  batteryEstimate.onTick();
  assert.equal(h.pebble.subs.length, 2);
  minute();
  assert.equal(h.sends.length, 1);
  h.pebble.subs[1].push(stats(5, h.clock - 5 * MIN));
  minute();
  assert.equal(h.sends.length, 1, 'a newer estimate of the same days is no news');
  assert.equal(JSON.parse(storage[KEYS.BATTERY_ESTIMATE]).updatedAt, h.clock - 5 * MIN, 'but it is kept');
});

test('the estimate kept is heard again: nothing is written', (t) => {
  const h = boot();
  const made = h.clock - 60 * MIN;
  h.pebble.subs[0].push(stats(5, made));
  const writes = [];
  const realSet = global.localStorage.setItem;
  const realRemove = global.localStorage.removeItem;
  t.after(() => { global.localStorage.setItem = realSet; global.localStorage.removeItem = realRemove; });
  global.localStorage.setItem = function (k, v) { writes.push(k); return realSet.call(this, k, v); };
  global.localStorage.removeItem = function (k) { writes.push(k); return realRemove.call(this, k); };
  // Muninn makes a new estimate every 6 hours, and a read can still hear the one kept.
  h.clock += LONGEST;
  batteryEstimate.onTick();
  h.pebble.subs[1].push(stats(5, made));
  assert.deepEqual(writes.filter((k) => k === KEYS.BATTERY_ESTIMATE), [], 'the same estimate: no write');
  assert.equal(writes.filter((k) => k === KEYS.BATTERY_ESTIMATE_READ).length, 1,
    'and of the read, only its start: the answer changes nothing in it');
  statusRebake.onTick(false);
  assert.equal(h.sends.length, 1, 'and no send but the first estimate\'s');
  // A newer one is written.
  h.clock += LONGEST;
  batteryEstimate.onTick();
  h.pebble.subs[2].push(stats(5, made + MIN));
  assert.deepEqual(writes.filter((k) => k === KEYS.BATTERY_ESTIMATE), [KEYS.BATTERY_ESTIMATE]);
  // No estimate, heard twice: dropped once.
  h.clock += LONGEST;
  batteryEstimate.onTick();
  h.pebble.subs[3].push(stats(-1, -1));
  h.clock += IDLE;
  batteryEstimate.onTick();
  h.pebble.subs[4].push(stats(-1, -1));
  assert.equal(writes.filter((k) => k === KEYS.BATTERY_ESTIMATE).length, 2, 'one write, one removal');
  assert.equal(storage[KEYS.BATTERY_ESTIMATE], undefined);
});

test('other days heard are sent', () => {
  const h = boot();
  h.pebble.subs[0].push(stats(5, h.clock));
  minute();
  h.clock += LONGEST;
  minute();
  h.pebble.subs[1].push(stats(4, h.clock));
  minute();
  assert.equal(h.sends.length, 2);
  assert.equal(sentDays(h), '4d');
});

test('set to both: Muninn is read the same, and the watch gets the days beside the place of its percentage', () => {
  const h = boot({ settings: Object.assign({ batterySlotDisplay: 'both' }, TEXT_LOOK) });
  assert.equal(h.pebble.subs.length, 1);
  h.pebble.subs[0].push(stats(5, h.clock));
  minute();
  assert.equal(h.sends.length, 1);
  assert.equal(sentDays(h), batteryDays.PCT_MARK + '|5d');
  h.clock += LONGEST;
  minute();
  h.pebble.subs[1].push(stats(4, h.clock));
  minute();
  assert.equal(h.sends.length, 2, 'other days are news to the pair too');
  assert.equal(sentDays(h), batteryDays.PCT_MARK + '|4d');
});

test('Muninn without an estimate yet (-1) reads as none', () => {
  const h = boot();
  h.pebble.subs[0].push(stats(-1, -1));
  assert.equal(batteryEstimate.bakeFacts().estimate(), null);
  assert.equal(storage[KEYS.BATTERY_ESTIMATE], undefined);
  minute();
  assert.equal(h.sends.length, 0, 'the slot showed the percentage and still does');
});

test('an estimate that goes away takes the days off the watch', () => {
  const h = boot();
  h.pebble.subs[0].push(stats(5, h.clock));
  minute();
  h.clock += LONGEST;
  minute();
  h.pebble.subs[1].push(stats(-1, -1));
  assert.equal(storage[KEYS.BATTERY_ESTIMATE], undefined);
  minute();
  assert.equal(h.sends.length, 2);
  assert.equal(sentDays(h), '', 'back to the percentage, which the watch prints itself');
});

test('Muninn not installed drops what was kept; any other failure keeps it', () => {
  const h = boot();
  h.pebble.subs[0].push(stats(5, h.clock));
  minute();
  h.clock += LONGEST;
  minute();
  h.pebble.subs[1].fail('TIMEOUT');
  assert.deepEqual(batteryEstimate.bakeFacts().estimate(), { days: 5, updatedAt: h.clock - LONGEST },
    'a hiccup keeps the estimate');
  assert.equal(h.pebble.subs[1].unsubscribed, 1);
  minute();
  assert.equal(h.sends.length, 1);
  h.clock += reads.RETRY_MS;
  minute();
  h.pebble.subs[2].fail('PLUGIN_UNAVAILABLE');
  assert.equal(batteryEstimate.bakeFacts().estimate(), null, 'Muninn is gone: so is its estimate');
  minute();
  assert.equal(h.sends.length, 2);
  assert.equal(sentDays(h), '');
});

test('a plugin that never answers: no second read while the first is under way', () => {
  const h = boot();
  assert.equal(h.timers.length, 1, 'the read has a timeout');
  h.clock += 2 * LONGEST;
  batteryEstimate.onTick();
  batteryEstimate.refresh();
  assert.equal(h.pebble.subs.length, 1, 'not asked again while the first read is under way');
  h.timers[0].fn();
  assert.equal(h.pebble.subs[0].unsubscribed, 1, 'given up on');
});

test('a failed read is asked again an hour later, then two hours after a second failure', () => {
  const h = boot();
  h.timers[0].fn();   // TIMEOUT, as Muninn not answering in time is
  h.clock += reads.RETRY_MS - MIN;
  batteryEstimate.onTick();
  assert.equal(h.pebble.subs.length, 1, 'not at the next tick');
  h.clock += MIN;
  batteryEstimate.onTick();
  assert.equal(h.pebble.subs.length, 2, 'an hour after the failed read');
  h.pebble.subs[1].fail('UNKNOWN');
  h.clock += 2 * reads.RETRY_MS - MIN;
  batteryEstimate.onTick();
  assert.equal(h.pebble.subs.length, 2);
  h.clock += MIN;
  batteryEstimate.onTick();
  assert.equal(h.pebble.subs.length, 3, 'two hours after the second');
  h.pebble.subs[2].push(stats(5, h.clock));
  h.clock += 2 * reads.RETRY_MS;
  batteryEstimate.onTick();
  assert.equal(h.pebble.subs.length, 3, 'an answer ends the retries');
});

test('Muninn not installed is an answer: asked again 12 hours later, not an hour', () => {
  const h = boot();
  h.pebble.subs[0].fail('PLUGIN_UNAVAILABLE');
  assert.deepEqual(storedRead(), { at: NOON, failures: 0, made: null });
  h.clock += reads.RETRY_MS;
  batteryEstimate.onTick();
  assert.equal(h.pebble.subs.length, 1);
  h.clock = NOON + IDLE;
  batteryEstimate.onTick();
  assert.equal(h.pebble.subs.length, 2);
});

test('Muninn removed: its rhythm goes with it, and it is asked every 12 hours', () => {
  const h = boot();
  h.pebble.subs[0].push(stats(5, NOON - 20 * MIN));
  h.clock = NOON - 20 * MIN + LONGEST;
  batteryEstimate.onTick();
  h.pebble.subs[1].fail('PLUGIN_UNAVAILABLE');
  assert.equal(storedRead().made, null);
  const read = h.clock;
  h.clock = read + LONGEST;   // where its rhythm would have put the next read
  batteryEstimate.onTick();
  assert.equal(h.pebble.subs.length, 2, 'no rhythm to follow any more');
  h.clock = read + IDLE;
  batteryEstimate.onTick();
  assert.equal(h.pebble.subs.length, 3);
});

test('a clock that went back starts the wait again from now, and never reads early', () => {
  const h = boot();
  h.pebble.subs[0].push(stats(5, h.clock));
  h.clock = NOON - 3 * DAY;
  batteryEstimate.onTick();
  assert.equal(h.pebble.subs.length, 1, 'no read for it');
  assert.deepEqual(storedRead(), { at: NOON - 3 * DAY, failures: 0, made: NOON }, 'the wait starts from now');
  // Muninn's estimate is now days ahead of the clock: no rhythm to follow.
  h.clock += IDLE - MIN;
  batteryEstimate.onTick();
  assert.equal(h.pebble.subs.length, 1);
  h.clock += MIN;
  batteryEstimate.onTick();
  assert.equal(h.pebble.subs.length, 2, 'not three days and more later, when the old time comes round');
});

test('the Night battery saver: a read due in its window waits for the window to close', () => {
  const h = boot({ settings: Object.assign({}, DAYS_ON, SAVER_ON) });
  h.pebble.subs[0].push(stats(5, h.clock));
  minute();
  assert.equal(h.sends.length, 1);
  h.clock += LONGEST;   // 18:20, outside the window
  minute();
  assert.equal(h.pebble.subs.length, 2);
  h.pebble.subs[1].push(stats(5, h.clock - 20 * MIN));   // Muninn's 18:00
  h.clock = new Date(2026, 10, 22, 0, 20, 0).getTime();  // its 0:00 is in: in the window
  minute();
  h.clock = new Date(2026, 10, 22, 6, 59, 0).getTime();
  minute();
  assert.equal(h.pebble.subs.length, 2, 'no read in the window');
  h.clock = new Date(2026, 10, 22, 7, 0, 0).getTime();
  minute();
  assert.equal(h.pebble.subs.length, 3, 'the first tick after it');
});

test('the Night battery saver: a start in its window with nothing read waits for it too', () => {
  const h = boot({ settings: Object.assign({}, DAYS_ON, SAVER_ON),
    clock: new Date(2026, 10, 21, 3, 0, 0).getTime() });
  assert.equal(h.pebble.subs.length, 0, 'no read on a start at 3:00');
  h.clock = new Date(2026, 10, 21, 7, 0, 0).getTime();
  minute();
  assert.equal(h.pebble.subs.length, 1);
});

test('the Night battery saver: switching the days on in its window asks at once, and the watch hears after it', () => {
  const h = boot({ settings: Object.assign({}, TEXT_LOOK, SAVER_ON),
    clock: new Date(2026, 10, 21, 3, 0, 0).getTime() });
  h.settings = Object.assign({}, DAYS_ON, SAVER_ON);
  batteryEstimate.refresh();
  assert.equal(h.pebble.subs.length, 1, 'the user is at the phone, waiting to see the days');
  h.pebble.subs[0].push(stats(5, h.clock));
  assert.equal(h.sends.length, 0, 'no wake-up for a battery readout overnight');
  assert.ok(storage[KEYS.BATTERY_ESTIMATE], 'but the estimate is kept');
  statusRebake.onTick(false);
  assert.equal(h.sends.length, 0, 'still inside the window');
  h.clock = new Date(2026, 10, 21, 7, 0, 0).getTime();
  statusRebake.onTick(true);
  assert.equal(h.sends.length, 0, 'not beside a fetch in flight, whose message bakes it anyway');
  statusRebake.onTick(false);
  assert.equal(h.sends.length, 1, 'paid on the first free tick after the window');
  assert.equal(sentDays(h), '5d');
  statusRebake.onTick(false);
  assert.equal(h.sends.length, 1, 'once');
});

test('the Night battery saver: a save in its window with a read on record waits like any other read', () => {
  const h = boot({ settings: Object.assign({}, DAYS_ON, SAVER_ON),
    clock: new Date(2026, 10, 21, 23, 0, 0).getTime() });
  h.pebble.subs[0].push(stats(5, new Date(2026, 10, 21, 18, 0, 0).getTime()));
  h.clock = new Date(2026, 10, 22, 0, 20, 0).getTime();   // due: Muninn's 0:00 is in
  batteryEstimate.refresh();
  assert.equal(h.pebble.subs.length, 1);
});

test('storage that refuses the time of a read still reads no more often', (t) => {
  const realSet = global.localStorage.setItem;
  t.after(() => { global.localStorage.setItem = realSet; });
  global.localStorage.setItem = function (k, v) {
    if (k === KEYS.BATTERY_ESTIMATE_READ) { throw new Error('QuotaExceededError'); }
    return realSet.call(this, k, v);
  };
  const h = boot();
  h.pebble.subs[0].push(stats(5, h.clock - 20 * MIN));
  assert.equal(storedRead(), null, 'not stored');
  for (let i = 0; i < 60; i++) {
    h.clock += MIN;
    batteryEstimate.onTick();
    batteryEstimate.refresh();
  }
  assert.equal(h.pebble.subs.length, 1, 'this PKJS life keeps the time itself');
});

test('three days of restarts, Muninn\'s wakeups and minute ticks: each estimate read once, minutes after it', () => {
  // Muninn makes an estimate at 0:05, 6:05, 12:05 and 18:05; the watchface restarts every
  // 25 minutes, as leaving it for other apps does.
  const madeBefore = (t) => {
    const d = new Date(t);
    const slot = Math.floor((d.getHours() * 60 + d.getMinutes() - 5) / 360);
    return slot < 0 ? new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1, 18, 5).getTime()
      : new Date(d.getFullYear(), d.getMonth(), d.getDate(), slot * 6, 5).getTime();
  };
  const pebble = fakePebble();
  let answered = 0;
  const answer = (at) => {
    for (let i = answered; i < pebble.subs.length; i++) { pebble.subs[i].push(stats(5, madeBefore(at))); }
    answered = pebble.subs.length;
  };
  const start = new Date(2026, 10, 21, 9, 0, 0).getTime();
  let h = boot({ pebble: pebble, clock: start });
  assert.equal(pebble.subs.length, 1, 'never read: asked at the first start');
  const seen = [{ at: start, made: madeBefore(start) }];
  answer(start);
  for (let at = start + MIN; at < start + 3 * DAY; at += MIN) {
    const before = pebble.subs.length;
    if ((at - start) % (25 * MIN) === 0) {
      h = boot({ pebble: pebble, keepStorage: true, clock: at });
    }
    h.clock = at;
    minute();
    if (pebble.subs.length > before) { seen.push({ at: at, made: madeBefore(at) }); }
    answer(at);
  }
  const times = JSON.stringify(seen.map((r) => new Date(r.at).toTimeString().slice(0, 5)));
  // 9:00 (the start), then 20 minutes after each of Muninn's: 12:25, 18:25, 0:25, 6:25...
  assert.equal(seen.length, 13, 'four a day, and the first at the start: ' + times);
  seen.slice(1).forEach((r, i) => {
    assert.equal(r.at - r.made, reads.SETTLE_MS, 'read ' + (i + 1) + ': 20 minutes after the estimate');
    assert.equal(r.made - seen[i].made, 6 * HOUR, 'read ' + (i + 1) + ': the estimate after the one before');
  });
});

test('an estimate older than a day is kept but changes nothing on the watch', () => {
  const h = boot();
  h.pebble.subs[0].push(stats(5, h.clock - DAY - MIN));
  minute();
  assert.equal(h.sends.length, 0, 'older than a day: the slot keeps the percentage');
  assert.ok(storage[KEYS.BATTERY_ESTIMATE]);
});

test('unreadable storage reads as no estimate', () => {
  boot();
  storage[KEYS.BATTERY_ESTIMATE] = '{not json';
  assert.equal(batteryEstimate.bakeFacts().estimate(), null);
  storage[KEYS.BATTERY_ESTIMATE] = 'null';
  assert.equal(batteryEstimate.bakeFacts().estimate(), null);
});

test('an unreadable record of the last read reads as none: Muninn is asked once, and it is whole again', () => {
  ['{not json', 'null', '{"at":"x","failures":0}', '{"at":1}'].forEach((raw) => {
    boot();
    storage[KEYS.BATTERY_ESTIMATE_READ] = raw;
    const h = boot({ keepStorage: true });
    assert.equal(h.pebble.subs.length, 1, raw);
    assert.deepEqual(storedRead(), { at: h.clock, failures: 0, made: null }, raw);
    batteryEstimate.onTick();
    assert.equal(h.pebble.subs.length, 1, raw + ': once');
  });
});
