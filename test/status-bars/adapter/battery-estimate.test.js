'use strict';
// The estimate of the days the watch has left (Muninn's plugin): when it is read, what is
// kept of it, and when the watch is told. The bake of it is
// status-lines-battery-days.test.js'.
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
const { decodeLine } = require('../../helpers/status-line-bytes.js');

const realLog = console.log;
test.before(() => { console.log = function () {}; });
test.after(() => { console.log = realLog; });

const MIN = 60 * 1000;
const DAY = 24 * 60 * MIN;
// The watch battery in its Text look, set to show the days left.
const TEXT_LOOK = { statusTopRight: 'battery', batterySlotLook: 'text' };
const DAYS_ON = Object.assign({ batterySlotDisplay: 'days' }, TEXT_LOOK);
/** The Night battery saver, on with its shipped 0:00-07:00 window. */
const SAVER_ON = { sleepNightEnabled: true, sleepStartHour: '0', sleepEndHour: '7' };

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
 * Boot the reader with its re-baker, every dependency injected.
 * @param {Object} [opts] {settings, pebble, clock, keepStorage, watchInfo}.
 * @returns {Object} Handle: mutable .clock/.settings, .pebble, collected .sends, .timers.
 */
function boot(opts) {
  opts = opts || {};
  if (!opts.keepStorage) { Object.keys(storage).forEach((k) => { delete storage[k]; }); }
  const h = {
    // Midday: outside the Night battery saver's window.
    clock: opts.clock || new Date(2026, 10, 21, 12, 0, 0).getTime(),
    settings: opts.settings || DAYS_ON,
    pebble: Object.prototype.hasOwnProperty.call(opts, 'pebble') ? opts.pebble : fakePebble(),
    sends: [],
    timers: []
  };
  statusRebake.init(withHost({
    getSettings: () => h.settings,
    getWatchBattery: batteryEstimate.bakeFacts,
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

test('wanted: Muninn is asked once at start, for its days and when it made them', () => {
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

test('the same days heard again send nothing', () => {
  const h = boot();
  h.pebble.subs[0].push(stats(5, h.clock - 60 * MIN));
  h.clock += batteryEstimate.READ_INTERVAL_MS;
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
  // Muninn makes a new estimate a few times a day; the reads in between hear the one kept.
  h.clock += batteryEstimate.READ_INTERVAL_MS;
  batteryEstimate.onTick();
  h.pebble.subs[1].push(stats(5, made));
  assert.deepEqual(writes.filter((k) => k === KEYS.BATTERY_ESTIMATE), [], 'the same estimate: no write');
  statusRebake.onTick(false);
  assert.equal(h.sends.length, 1, 'and no send but the first estimate\'s');
  // A newer one is written.
  h.clock += batteryEstimate.READ_INTERVAL_MS;
  batteryEstimate.onTick();
  h.pebble.subs[2].push(stats(5, made + MIN));
  assert.deepEqual(writes.filter((k) => k === KEYS.BATTERY_ESTIMATE), [KEYS.BATTERY_ESTIMATE]);
  // No estimate, heard twice: dropped once.
  h.clock += batteryEstimate.READ_INTERVAL_MS;
  batteryEstimate.onTick();
  h.pebble.subs[3].push(stats(-1, -1));
  h.clock += batteryEstimate.READ_INTERVAL_MS;
  batteryEstimate.onTick();
  h.pebble.subs[4].push(stats(-1, -1));
  assert.equal(writes.filter((k) => k === KEYS.BATTERY_ESTIMATE).length, 2, 'one write, one removal');
  assert.equal(storage[KEYS.BATTERY_ESTIMATE], undefined);
});

test('other days heard are sent', () => {
  const h = boot();
  h.pebble.subs[0].push(stats(5, h.clock));
  minute();
  h.clock += batteryEstimate.READ_INTERVAL_MS;
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
  h.clock += batteryEstimate.READ_INTERVAL_MS;
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
  h.clock += batteryEstimate.READ_INTERVAL_MS;
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
  h.clock += batteryEstimate.READ_INTERVAL_MS;
  minute();
  h.pebble.subs[1].fail('TIMEOUT');
  assert.deepEqual(batteryEstimate.bakeFacts().estimate(), { days: 5, updatedAt: h.clock - batteryEstimate.READ_INTERVAL_MS },
    'a hiccup keeps the estimate');
  assert.equal(h.pebble.subs[1].unsubscribed, 1);
  minute();
  assert.equal(h.sends.length, 1);
  h.clock += batteryEstimate.READ_INTERVAL_MS;
  minute();
  h.pebble.subs[2].fail('PLUGIN_UNAVAILABLE');
  assert.equal(batteryEstimate.bakeFacts().estimate(), null, 'Muninn is gone: so is its estimate');
  minute();
  assert.equal(h.sends.length, 2);
  assert.equal(sentDays(h), '');
});

test('a plugin that never answers is given up on, and asked again later', () => {
  const h = boot();
  assert.equal(h.timers.length, 1, 'the read has a timeout');
  h.clock += batteryEstimate.READ_INTERVAL_MS;
  batteryEstimate.onTick();
  assert.equal(h.pebble.subs.length, 1, 'not asked again while the first read is under way');
  h.timers[0].fn();
  assert.equal(h.pebble.subs[0].unsubscribed, 1);
  batteryEstimate.onTick();
  assert.equal(h.pebble.subs.length, 2, 'the next tick asks again');
});

test('the tick asks again only after the read interval', () => {
  const h = boot();
  h.pebble.subs[0].push(stats(5, h.clock));
  h.clock += batteryEstimate.READ_INTERVAL_MS - MIN;
  batteryEstimate.onTick();
  assert.equal(h.pebble.subs.length, 1);
  h.clock += MIN;
  batteryEstimate.onTick();
  assert.equal(h.pebble.subs.length, 2);
});

test('saving the settings asks at once, whenever the last read was', () => {
  const h = boot({ settings: TEXT_LOOK });
  assert.equal(h.pebble.subs.length, 0, 'the percentage: nothing read');
  h.settings = DAYS_ON;
  batteryEstimate.refresh();
  assert.equal(h.pebble.subs.length, 1, 'just set to days: asked now');
});

test('an estimate kept from the last PKJS life is baked at once, and heard again without a send', () => {
  const first = boot();
  first.pebble.subs[0].push(stats(5, first.clock));
  const h = boot({ keepStorage: true });
  assert.deepEqual(batteryEstimate.bakeFacts().estimate(), { days: 5, updatedAt: first.clock });
  h.pebble.subs[0].push(stats(5, h.clock));
  assert.equal(h.sends.length, 0);
});

test('the Night battery saver holds a change back until its window has closed', () => {
  const h = boot({ settings: Object.assign({}, DAYS_ON, SAVER_ON),
    clock: new Date(2026, 10, 21, 3, 0, 0).getTime() });
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

test('an estimate too old to show is kept but changes nothing on the watch', () => {
  const h = boot();
  h.pebble.subs[0].push(stats(5, h.clock - 3 * DAY));
  assert.equal(h.sends.length, 0, 'older than two days: the slot keeps the percentage');
  assert.ok(storage[KEYS.BATTERY_ESTIMATE]);
});

test('unreadable storage reads as no estimate', () => {
  boot();
  storage[KEYS.BATTERY_ESTIMATE] = '{not json';
  assert.equal(batteryEstimate.bakeFacts().estimate(), null);
  storage[KEYS.BATTERY_ESTIMATE] = 'null';
  assert.equal(batteryEstimate.bakeFacts().estimate(), null);
});
