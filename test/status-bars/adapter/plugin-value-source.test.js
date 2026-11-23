'use strict';
// The Plugin value slot's value (plugin-value-source.js): when it is read, what is kept of
// it, and when the watch is told. When a read is due is plugin-value-reads.test.js'; what the
// slot prints and how long a value shows, plugin-values.test.js'.
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

const pluginValueSource = require('../../../src/pkjs/status-bars/adapter/plugin-value-source.js');
const statusRebake = require('../../../src/pkjs/status-bars/application/status-rebake.js');
const KEYS = require('../../../src/pkjs/settings/domain/storage-keys.js');
const { RETRY_MS } = require('../../../src/pkjs/status-bars/domain/plugin-reads.js');
const { decodeLine } = require('../../helpers/status-line-bytes.js');

// Every line logged, kept for the test that the value never is.
const logged = [];
const realLog = console.log;
test.before(() => { console.log = function () { logged.push(Array.prototype.join.call(arguments, ' ')); }; });
test.after(() => { console.log = realLog; });

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const PHONE = '00000000-0000-0000-0001-000000000001';
/** The Watch bar's left slot showing the Phone plugin's battery level, read every hour. */
const SLOT = { statusTopLeft: 'pluginValue', pluginValuePlugin: PHONE,
  pluginValueReading: 'phone/phone_state/battery_level' };
const KEY = PHONE + '/phone/phone_state/battery_level';
/** The same plugin's network type. */
const CELL = Object.assign({}, SLOT, { pluginValueReading: 'phone/phone_state/cell' });
/** The Night battery saver, on with its shipped 0:00-07:00 window. */
const SAVER_ON = { sleepNightEnabled: true, sleepStartHour: '0', sleepEndHour: '7' };
/** Midday: outside the Night battery saver's window. */
const NOON = new Date(2026, 10, 21, 12, 0, 0).getTime();
/** The Phone plugin's battery level, as it sends it. */
const LEVEL = { battery_level: { numericValue: { value: 87, unit: '%' }, shortText: { text: '87%' } } };

/**
 * A Pebble app with plugins: records every subscription and lets the test answer it.
 * @returns {Object} The fake, with .subs (each {request, push, fail, unsubscribed}).
 */
function fakePebble() {
  const pebble = { subs: [] };
  pebble.subscribeToSource = (config) => {
    const sub = { request: { category: config.category, item: config.item, properties: config.properties,
      plugin: config.plugin, limit: config.limit },
    unsubscribed: 0,
    push: (envelope) => config.onData(envelope),
    fail: (code) => config.onError({ code: code, message: code }) };
    pebble.subs.push(sub);
    return { unsubscribe: () => { sub.unsubscribed += 1; } };
  };
  return pebble;
}

/**
 * The Phone plugin's answer.
 * @param {Object} [properties] Its instance's properties (default: the battery level).
 * @param {Object} [extra] Fields of the envelope (validUntilMs, pluginUuid).
 * @returns {Object} The envelope.
 */
function answer(properties, extra) {
  return Object.assign({ pluginUuid: PHONE, instances: [{ instanceId: '0', properties: properties || LEVEL }] },
    extra || {});
}

/**
 * Boot the source with its re-baker, every dependency injected: a PKJS start.
 * @param {Object} [opts] {settings, pebble, clock, keepStorage, watchInfo}.
 * @returns {Object} Handle: mutable .clock/.settings, .pebble, collected .sends, .timers.
 */
function boot(opts) {
  opts = opts || {};
  if (!opts.keepStorage) { Object.keys(storage).forEach((k) => { delete storage[k]; }); }
  const h = {
    clock: opts.clock || NOON,
    settings: opts.settings || SLOT,
    pebble: Object.prototype.hasOwnProperty.call(opts, 'pebble') ? opts.pebble : fakePebble(),
    sends: [],
    timers: []
  };
  const watchInfo = opts.watchInfo || { platform: 'basalt' };
  statusRebake.init(withHost({
    getSettings: () => h.settings,
    getBakeFacts: () => ({ plugin: pluginValueSource.bakeFacts() }),
    sendWeather: (p) => { h.sends.push(p); },
    now: () => h.clock
  }));
  // The inputs of a bake the re-bake can re-bake: the real baker runs.
  statusRebake.rememberBakeInputs({ CITY: 'Bonn', CURRENT_TEMP: 68, SUN_EVENTS: [1, 0, 0, 0, 0] },
    watchInfo, new Date(h.clock));
  pluginValueSource.init({
    pebble: h.pebble,
    getSettings: () => h.settings,
    getWatchInfo: () => watchInfo,
    now: () => h.clock,
    timers: {
      setTimeout: (fn, ms) => { h.timers.push({ fn: fn, ms: ms }); return h.timers.length; },
      clearTimeout: () => {}
    }
  });
  return h;
}

/**
 * The scheduler's minute, as index.js runs it: the source's tick (it may read the plugin),
 * then the re-bake's, which sends what the watch is owed.
 * @returns {void}
 */
function minute() {
  pluginValueSource.onTick();
  statusRebake.onTick(false);
}

/**
 * @param {Object} h The boot's handle.
 * @returns {string} The Plugin value slot's text in the last status the watch was sent.
 */
function sentText(h) {
  return decodeLine(h.sends[h.sends.length - 1].STATUS_LINE_3_UINT8)[0].text;
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
  assert.throws(() => pluginValueSource.init(), /init needs getSettings, getWatchInfo and now/);
  assert.throws(() => pluginValueSource.init({ getSettings: () => ({}), now: () => 0 }), /init needs/);
  assert.throws(() => pluginValueSource.init({ getSettings: () => ({}), getWatchInfo: () => null }), /init needs/);
});

test('wanted and never read: the plugin picked is asked at start, for the one value', () => {
  const h = boot();
  assert.equal(h.pebble.subs.length, 1);
  assert.deepEqual(h.pebble.subs[0].request, { category: 'phone', item: 'phone_state',
    properties: ['battery_level'], plugin: PHONE, limit: 1 });
});

test('not wanted: nothing is read', () => {
  [['no plugin picked', { statusTopLeft: 'pluginValue', pluginValueReading: SLOT.pluginValueReading }],
    ['no value picked', { statusTopLeft: 'pluginValue', pluginValuePlugin: PHONE }],
    ['no slot shows it', Object.assign({}, SLOT, { statusTopLeft: 'aqi' })],
    ['only a bar no screen shows does', Object.assign({}, SLOT, { statusTopLeft: 'aqi', statusHealthLeft: 'pluginValue' })]]
    .forEach(([why, settings]) => {
      const h = boot({ settings: settings });
      minute();
      pluginValueSource.refresh();
      assert.equal(h.pebble.subs.length, 0, why);
    });
  const h = boot({ watchInfo: { platform: 'aplite' } });
  minute();
  assert.equal(h.pebble.subs.length, 0, 'aplite');
});

test('a Pebble app without plugins: nothing is read, nothing thrown, and the slot is empty', () => {
  [null, {}].forEach((pebble) => {
    const h = boot({ pebble: pebble });
    minute();
    pluginValueSource.refresh();
    assert.equal(pluginValueSource.bakeFacts().available, false);
    statusRebake.resendStatus('test');
    assert.equal(sentText(h), '', 'the slot is not offered there');
  });
});

test('a value is kept, ends the subscription, and reaches the watch with the next tick', () => {
  const h = boot();
  h.pebble.subs[0].push(answer());
  assert.equal(h.pebble.subs[0].unsubscribed, 1, 'read once: no subscription stays');
  assert.deepEqual(stored(KEYS.PLUGIN_VALUE), { source: KEY,
    reading: { short: '87%', number: 87, unit: '%', long: null }, at: NOON, validUntil: null });
  assert.deepEqual(pluginValueSource.bakeFacts().value(), stored(KEYS.PLUGIN_VALUE));
  // Never sent from the answer itself: it comes at any moment, beside a settings save's or a
  // boot's own messages, which bake the value just kept.
  assert.equal(h.sends.length, 0, 'the answer sends nothing by itself');
  minute();
  assert.equal(h.sends.length, 1);
  assert.equal(sentText(h), '87%');
  minute();
  assert.equal(h.sends.length, 1, 'once');
});

test('a message that goes out before the tick carries the value, and the tick then sends nothing new', () => {
  const h = boot();
  h.pebble.subs[0].push(answer());
  statusRebake.resendStatus('config-close');
  assert.equal(h.sends.length, 1);
  assert.equal(sentText(h), '87%');
  const sent = JSON.stringify(h.sends[0]);
  minute();
  assert.equal(JSON.stringify(h.sends[h.sends.length - 1]), sent);
});

test('a long text is kept cut to what a value keeps', () => {
  const h = boot();
  h.pebble.subs[0].push(answer({ battery_level: { longText: { text: 'y'.repeat(5000) } } }));
  assert.equal(stored(KEYS.PLUGIN_VALUE).reading.long, 'y'.repeat(64));
});

test('each slot that shows the value prints it at its own room, from one read', () => {
  const h = boot({ settings: Object.assign({}, SLOT, { statusTopMid: 'pluginValue' }) });
  h.pebble.subs[0].push(answer({ battery_level: { numericValue: { value: 12345, unit: 'kWh' } } }));
  minute();
  const slots = decodeLine(h.sends[0].STATUS_LINE_3_UINT8);
  assert.equal(slots[0].text, '12345', 'an edge slot has no room for the unit');
  assert.equal(slots[1].text, '12345 kWh', 'the middle has');
  assert.equal(h.pebble.subs.length, 1);
});

test('the read is kept in storage: its source, when it started, its failures, and until when the answer holds', () => {
  const h = boot();
  assert.deepEqual(stored(KEYS.PLUGIN_VALUE_READ), { source: KEY, at: NOON, failures: 0, validUntil: null },
    'stamped as it starts');
  h.clock += 5000;
  h.pebble.subs[0].push(answer(null, { validUntilMs: NOON + 2 * HOUR }));
  assert.deepEqual(stored(KEYS.PLUGIN_VALUE_READ), { source: KEY, at: NOON, failures: 0, validUntil: NOON + 2 * HOUR });
  assert.equal(stored(KEYS.PLUGIN_VALUE).at, NOON + 5000, 'the value: when it was heard');
  assert.equal(stored(KEYS.PLUGIN_VALUE).validUntil, NOON + 2 * HOUR);
});

test('a PKJS restart reads nothing before the next read is due, and bakes the value kept at once', () => {
  let h = boot();
  h.pebble.subs[0].push(answer());
  h = boot({ keepStorage: true, clock: NOON + 30 * MIN });
  assert.equal(h.pebble.subs.length, 0);
  statusRebake.resendStatus('boot');
  assert.equal(sentText(h), '87%');
  h.clock = NOON + HOUR - MIN;
  minute();
  assert.equal(h.pebble.subs.length, 0, 'not a minute before');
  h.clock = NOON + HOUR;
  minute();
  assert.equal(h.pebble.subs.length, 1, 'an hour after the last');
});

test('a read cut short by the end of PKJS still counts', () => {
  boot();
  const h = boot({ keepStorage: true, clock: NOON + 10 * MIN });
  pluginValueSource.refresh();
  assert.equal(h.pebble.subs.length, 0);
});

test('the Updates setting says how often: the tick reads again after it, and not a minute before', () => {
  [['30', 30 * MIN], ['60', HOUR], ['180', 3 * HOUR], ['360', 6 * HOUR]].forEach(([every, ms]) => {
    const h = boot({ settings: Object.assign({ pluginValueEvery: every }, SLOT) });
    h.pebble.subs[0].push(answer());
    h.clock = NOON + ms - MIN;
    minute();
    pluginValueSource.refresh();
    assert.equal(h.pebble.subs.length, 1, every);
    h.clock = NOON + ms;
    minute();
    assert.equal(h.pebble.subs.length, 2, every);
  });
});

test('an answer the plugin says holds longer is read again once it no longer does, 12 hours on at most', () => {
  let h = boot();
  h.pebble.subs[0].push(answer(null, { validUntilMs: NOON + 5 * HOUR }));
  h.clock = NOON + 5 * HOUR - MIN;
  minute();
  assert.equal(h.pebble.subs.length, 1);
  assert.equal(sentText(h), '87%', 'and it shows past three hours while the plugin says it holds');
  h.clock = NOON + 5 * HOUR;
  minute();
  assert.equal(h.pebble.subs.length, 2);
  h = boot();
  h.pebble.subs[0].push(answer(null, { validUntilMs: NOON + 48 * HOUR }));
  h.clock = NOON + 12 * HOUR - MIN;
  minute();
  assert.equal(h.pebble.subs.length, 1);
  h.clock = NOON + 12 * HOUR;
  minute();
  assert.equal(h.pebble.subs.length, 2);
});

test('a value not heard again for three Updates intervals shows as -- at the next bake', () => {
  const h = boot();
  h.pebble.subs[0].push(answer());
  h.clock = NOON + 3 * HOUR - MIN;
  statusRebake.resendStatus('fetch');
  assert.equal(sentText(h), '87%');
  h.clock = NOON + 3 * HOUR;
  statusRebake.resendStatus('fetch');
  assert.equal(sentText(h), '--');
});

test('a value that grows too old turns to -- on the watch at the tick it does, with no fetch to bake it', () => {
  const h = boot();
  h.pebble.subs[0].push(answer());
  minute();
  assert.equal(sentText(h), '87%');
  // Every read after it fails, and nothing else bakes: no fetch, no save.
  [NOON + HOUR, NOON + 2 * HOUR].forEach((t) => {
    h.clock = t;
    minute();
    h.pebble.subs[h.pebble.subs.length - 1].fail('TIMEOUT');
  });
  const sends = h.sends.length;
  h.clock = NOON + 3 * HOUR - MIN;
  minute();
  assert.equal(h.sends.length, sends, 'still shown: nothing to send');
  h.clock = NOON + 3 * HOUR;
  minute();
  assert.equal(h.sends.length, sends + 1, 'too old: the watch is told');
  assert.equal(sentText(h), '--');
  h.clock += MIN;
  minute();
  assert.equal(h.sends.length, sends + 1, 'once');
});

test('the same value heard again sends nothing; another is sent', () => {
  const h = boot();
  h.pebble.subs[0].push(answer());
  minute();
  assert.equal(h.sends.length, 1);
  h.clock += HOUR;
  minute();
  h.pebble.subs[1].push(answer());
  minute();
  assert.equal(h.sends.length, 1, 'the same reading: nothing owed');
  h.clock += HOUR;
  minute();
  h.pebble.subs[2].push(answer({ battery_level: { shortText: { text: '86%' } } }));
  minute();
  assert.equal(h.sends.length, 2);
  assert.equal(sentText(h), '86%');
});

test('the plugin not there drops the value kept, and is asked again after the Updates interval', () => {
  const h = boot();
  h.pebble.subs[0].push(answer());
  minute();
  h.clock = NOON + HOUR;
  minute();
  h.pebble.subs[1].fail('PLUGIN_UNAVAILABLE');
  assert.equal(stored(KEYS.PLUGIN_VALUE), null);
  assert.deepEqual(stored(KEYS.PLUGIN_VALUE_READ), { source: KEY, at: NOON + HOUR, failures: 0, validUntil: null });
  minute();
  assert.equal(sentText(h), '--');
  h.clock = NOON + 2 * HOUR - MIN;
  minute();
  assert.equal(h.pebble.subs.length, 2);
  h.clock = NOON + 2 * HOUR;
  minute();
  assert.equal(h.pebble.subs.length, 3);
});

test('an answer from another plugin than the one picked counts as the picked one not being there', () => {
  const h = boot();
  h.pebble.subs[0].push(answer());
  h.clock = NOON + HOUR;
  minute();
  h.pebble.subs[1].push(answer(null, { pluginUuid: 'ffffffff-0000-0000-0000-000000000001' }));
  assert.equal(stored(KEYS.PLUGIN_VALUE), null);
  minute();
  assert.equal(sentText(h), '--');
});

test('any other failure keeps the value, and is asked again an hour later, then two hours after a second', () => {
  const h = boot({ settings: Object.assign({ pluginValueEvery: '360' }, SLOT) });
  h.pebble.subs[0].push(answer());
  h.clock = NOON + 6 * HOUR;
  minute();
  h.pebble.subs[1].fail('PERMISSION_DENIED');
  assert.equal(stored(KEYS.PLUGIN_VALUE).reading.short, '87%', 'kept');
  assert.deepEqual(stored(KEYS.PLUGIN_VALUE_READ), { source: KEY, at: NOON + 6 * HOUR, failures: 1, validUntil: null });
  h.clock = NOON + 6 * HOUR + RETRY_MS - MIN;
  minute();
  assert.equal(h.pebble.subs.length, 2);
  h.clock = NOON + 6 * HOUR + RETRY_MS;
  minute();
  assert.equal(h.pebble.subs.length, 3);
  h.pebble.subs[2].fail('TIMEOUT');
  const second = h.clock;
  h.clock = second + 2 * RETRY_MS - MIN;
  minute();
  assert.equal(h.pebble.subs.length, 3);
  h.clock = second + 2 * RETRY_MS;
  minute();
  assert.equal(h.pebble.subs.length, 4);
  h.pebble.subs[3].push(answer());
  assert.equal(stored(KEYS.PLUGIN_VALUE_READ).failures, 0, 'an answer ends the run of failures');
});

test('a plugin that never answers: no second read while the first is under way, then it times out', () => {
  const h = boot();
  h.clock = NOON + 2 * HOUR;
  minute();
  pluginValueSource.refresh();
  assert.equal(h.pebble.subs.length, 1);
  assert.equal(h.timers.length, 1);
  h.timers[0].fn();
  assert.equal(h.pebble.subs[0].unsubscribed, 1);
  assert.equal(stored(KEYS.PLUGIN_VALUE_READ).failures, 1);
  minute();
  assert.equal(h.pebble.subs.length, 2, 'the retry an hour after the read that timed out is due');
});

test('picking another value forgets the old one\'s read and value, and the save reads the new one at once', () => {
  const h = boot();
  h.pebble.subs[0].push(answer());
  minute();
  h.clock += 10 * MIN;
  h.settings = CELL;
  pluginValueSource.refresh();
  assert.equal(h.pebble.subs.length, 2);
  assert.deepEqual(h.pebble.subs[1].request.properties, ['cell']);
  assert.equal(stored(KEYS.PLUGIN_VALUE), null, 'the old value is gone');
  statusRebake.resendStatus('config-close');
  assert.equal(sentText(h), '--', 'and never shown for the new one');
  h.pebble.subs[1].push(answer({ cell: { shortText: { text: 'LTE' } } }));
  minute();
  assert.equal(sentText(h), 'LTE');
  h.settings = Object.assign({}, CELL, { pluginValuePlugin: 'ffffffff-0000-0000-0000-000000000001' });
  pluginValueSource.refresh();
  assert.equal(h.pebble.subs.length, 3, 'another plugin is another value');
  assert.equal(h.pebble.subs[2].request.plugin, 'ffffffff-0000-0000-0000-000000000001');
});

test('switching the slot off forgets the last read, so switching it on again reads at once', () => {
  const h = boot();
  h.pebble.subs[0].push(answer());
  h.settings = Object.assign({}, SLOT, { statusTopLeft: 'aqi' });
  pluginValueSource.refresh();
  assert.equal(stored(KEYS.PLUGIN_VALUE_READ), null);
  h.clock += 5 * MIN;
  h.settings = SLOT;
  pluginValueSource.refresh();
  assert.equal(h.pebble.subs.length, 2);
});

test('an answer that comes after the value was changed is dropped, and the new one is read as it comes', () => {
  const h = boot();
  h.settings = CELL;
  pluginValueSource.refresh();
  assert.equal(h.pebble.subs.length, 1, 'the first read is still under way');
  h.pebble.subs[0].push(answer());
  assert.equal(stored(KEYS.PLUGIN_VALUE), null, 'the old value\'s answer is not kept');
  assert.equal(h.pebble.subs.length, 2, 'the save\'s read, which the first held up');
  assert.deepEqual(h.pebble.subs[1].request.properties, ['cell']);
  minute();
  assert.equal(h.pebble.subs.length, 2, 'one read at a time');
});

test('an answer without the value, or with none the slot can print, shows -- and counts as an answer', () => {
  [answer({ cell: { shortText: { text: 'LTE' } } }), answer({ battery_level: { boolean: true } }),
    { pluginUuid: PHONE, instances: [] }].forEach((envelope) => {
    const h = boot();
    h.pebble.subs[0].push(envelope);
    assert.equal(stored(KEYS.PLUGIN_VALUE), null);
    assert.equal(stored(KEYS.PLUGIN_VALUE_READ).failures, 0);
    statusRebake.resendStatus('fetch');
    assert.equal(sentText(h), '--');
    h.clock = NOON + HOUR - MIN;
    minute();
    assert.equal(h.pebble.subs.length, 1, 'read again after the Updates interval');
  });
});

test('the Night battery saver: a read due in its window waits for the window to close', () => {
  const h = boot({ settings: Object.assign({}, SLOT, SAVER_ON), clock: new Date(2026, 10, 21, 23, 30, 0).getTime() });
  h.pebble.subs[0].push(answer());
  h.clock = new Date(2026, 10, 22, 0, 30, 0).getTime();
  minute();
  h.clock = new Date(2026, 10, 22, 6, 59, 0).getTime();
  minute();
  assert.equal(h.pebble.subs.length, 1, 'no read in the window');
  h.clock = new Date(2026, 10, 22, 7, 0, 0).getTime();
  minute();
  assert.equal(h.pebble.subs.length, 2, 'the first tick after it');
});

test('the Night battery saver: a start in its window with nothing read waits for it too', () => {
  const h = boot({ settings: Object.assign({}, SLOT, SAVER_ON), clock: new Date(2026, 10, 21, 3, 0, 0).getTime() });
  assert.equal(h.pebble.subs.length, 0, 'no read on a start at 3:00');
  h.clock = new Date(2026, 10, 21, 7, 0, 0).getTime();
  minute();
  assert.equal(h.pebble.subs.length, 1);
});

test('the Night battery saver: picking a value in its window reads at once, and the watch hears after it', () => {
  const h = boot({ settings: Object.assign({}, SAVER_ON), clock: new Date(2026, 10, 21, 5, 0, 0).getTime() });
  h.settings = Object.assign({}, SLOT, SAVER_ON);
  pluginValueSource.refresh();
  assert.equal(h.pebble.subs.length, 1, 'the user is at the phone, waiting to see the value');
  h.pebble.subs[0].push(answer());
  statusRebake.onTick(false);
  assert.equal(h.sends.length, 0, 'still inside the window');
  h.clock = new Date(2026, 10, 21, 7, 0, 0).getTime();
  statusRebake.onTick(false);
  assert.equal(h.sends.length, 1, 'paid on the first tick after the window');
  assert.equal(sentText(h), '87%');
});

test('the Night battery saver: a value picked while a read is under way is read as that read ends', () => {
  const h = boot({ settings: Object.assign({}, SAVER_ON), clock: new Date(2026, 10, 21, 5, 0, 0).getTime() });
  h.settings = Object.assign({}, SLOT, SAVER_ON);
  pluginValueSource.refresh();
  assert.equal(h.pebble.subs.length, 1, 'the battery level, read as it is picked');
  h.settings = Object.assign({}, CELL, SAVER_ON);
  pluginValueSource.refresh();
  assert.equal(h.pebble.subs.length, 1, 'no second read while the first is under way');
  h.pebble.subs[0].fail('TIMEOUT');
  assert.equal(h.pebble.subs.length, 2, 'the network type, read as the first read ends');
  assert.deepEqual(h.pebble.subs[1].request.properties, ['cell']);
});

test('the Night battery saver: a save in its window with a read on record waits like any other read', () => {
  const h = boot({ settings: Object.assign({}, SLOT, SAVER_ON), clock: new Date(2026, 10, 21, 23, 0, 0).getTime() });
  h.pebble.subs[0].push(answer());
  h.clock = new Date(2026, 10, 22, 0, 30, 0).getTime();
  pluginValueSource.refresh();
  assert.equal(h.pebble.subs.length, 1);
});

test('a clock that went back starts the wait again from now, and never reads early', () => {
  const h = boot();
  h.pebble.subs[0].push(answer());
  h.clock = NOON - 2 * HOUR;
  minute();
  assert.equal(h.pebble.subs.length, 1);
  assert.equal(stored(KEYS.PLUGIN_VALUE_READ).at, NOON - 2 * HOUR);
  h.clock = NOON - HOUR - MIN;
  minute();
  assert.equal(h.pebble.subs.length, 1);
  h.clock = NOON - HOUR;
  minute();
  assert.equal(h.pebble.subs.length, 2);
});

test('storage that refuses the record of a read still reads no more often', (t) => {
  const realSet = global.localStorage.setItem;
  t.after(() => { global.localStorage.setItem = realSet; });
  global.localStorage.setItem = function (k, v) {
    if (k === KEYS.PLUGIN_VALUE_READ) { throw new Error('QuotaExceededError'); }
    return realSet.call(this, k, v);
  };
  const h = boot();
  h.pebble.subs[0].push(answer());
  assert.equal(stored(KEYS.PLUGIN_VALUE_READ), null, 'not stored');
  for (let i = 0; i < 50; i++) {
    h.clock += MIN;
    minute();
    pluginValueSource.refresh();
  }
  assert.equal(h.pebble.subs.length, 1, 'this PKJS life keeps the time itself');
});

test('unreadable storage reads as no value and no read: the plugin is asked once, and it is whole again', () => {
  Object.keys(storage).forEach((k) => { delete storage[k]; });
  storage[KEYS.PLUGIN_VALUE] = '{oops';
  storage[KEYS.PLUGIN_VALUE_READ] = '{"at":"x"}';
  const h = boot({ keepStorage: true });
  assert.equal(h.pebble.subs.length, 1);
  assert.equal(pluginValueSource.bakeFacts().value(), null);
  h.pebble.subs[0].push(answer());
  assert.deepEqual(stored(KEYS.PLUGIN_VALUE_READ), { source: KEY, at: NOON, failures: 0, validUntil: null });
  assert.equal(stored(KEYS.PLUGIN_VALUE).reading.short, '87%');
});

test('the value is never logged: it is another app\'s data', () => {
  logged.length = 0;
  const h = boot({ settings: Object.assign({ pluginValueEvery: '30' }, SLOT) });
  h.pebble.subs[0].push(answer({ battery_level: { shortText: { text: 'Secret 4711' } } }));
  minute();
  h.clock += 30 * MIN;
  minute();
  h.pebble.subs[1].push(answer({ battery_level: { numericValue: { value: 4711, unit: 'kWh' } } }));
  minute();
  h.clock += 30 * MIN;
  minute();
  h.pebble.subs[2].fail('PLUGIN_UNAVAILABLE');
  minute();
  assert.ok(logged.length > 0, 'it logs what happens');
  assert.deepEqual(logged.filter((line) => /4711|Secret|kWh/.test(line)), []);
});

test('the settings page gets the value last heard whole, whichever source the settings pick', () => {
  const h = boot();
  assert.equal(pluginValueSource.value(), null, 'none yet');
  h.pebble.subs[0].push(answer(null, { validUntilMs: NOON + 2 * HOUR }));
  const value = { source: KEY, reading: { short: '87%', number: 87, unit: '%', long: null }, at: NOON,
    validUntil: NOON + 2 * HOUR };
  assert.deepEqual(pluginValueSource.value(), value);
  h.settings = CELL;
  assert.deepEqual(pluginValueSource.value(), value, 'the page judges it against its own pick');
});
