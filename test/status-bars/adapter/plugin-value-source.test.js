'use strict';
// The Plugin value slot's value (plugin-value-source.js): when it is read, what is kept of
// it, and when the watch is told. How every plugin read runs, from its record to the status
// the watch is owed, is plugin-read-schedule.test.js'; here, the slot's side of it. When a
// read is due is plugin-value-reads.test.js'; what the slot prints and how long a value shows,
// plugin-values.test.js'.
const test = require('node:test');
const assert = require('node:assert/strict');
const { withHost } = require('../../helpers/rebake-host.js');
const { fakePebble, heldTimers, reading, PERMS, PLUGINS, preferencesPlugin } = require('../../helpers/plugin-host.js');

// AGENTS.md: a module that touches storage needs `global.localStorage` mocked BEFORE the
// watch modules load. One store object, emptied in place.
const storage = {};
global.localStorage = {
  getItem(k) { return Object.prototype.hasOwnProperty.call(storage, k) ? storage[k] : null; },
  setItem(k, v) { storage[k] = String(v); },
  removeItem(k) { delete storage[k]; }
};

const pluginValueSource = require('../../../src/pkjs/status-bars/adapter/plugin-value-source.js');
const pluginReader = require('../../../src/pkjs/status-bars/adapter/plugin-reader.js');
const statusRebake = require('../../../src/pkjs/status-bars/application/status-rebake.js');
const KEYS = require('../../../src/pkjs/settings/domain/storage-keys.js');
const { PREFERENCES } = require('../../../src/pkjs/status-bars/domain/plugin-values.js');
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
  pluginValueId: 'phone/phone_state/battery_level' };
const KEY = PHONE + '/phone/phone_state/battery_level';
/** The same plugin's network type. */
const CELL = Object.assign({}, SLOT, { pluginValueId: 'phone/phone_state/cell' });
/** Midday: outside the Night battery saver's window. */
const NOON = new Date(2026, 10, 21, 12, 0, 0).getTime();
/** The Phone plugin's battery level, as it sends it. */
const LEVEL = { battery_level: { numericValue: { value: 87, unit: '%' }, shortText: { text: '87%' } } };

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
 * @param {Object} [opts] {settings, pebble, clock, keepStorage, watchInfo, complications,
 *   permissions}: the user's complications as last heard (default none known), and the
 *   permissions this app declares (default none).
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
    timers: [],
    complications: Object.prototype.hasOwnProperty.call(opts, 'complications') ? opts.complications : null
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
    timers: heldTimers(h.timers),
    permissions: opts.permissions,
    getComplications: () => h.complications
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

test('wanted and never read: the plugin picked is asked at start, for the one value', () => {
  const h = boot();
  assert.equal(h.pebble.subs.length, 1);
  assert.deepEqual(h.pebble.subs[0].request, { category: 'phone', item: 'phone_state',
    properties: ['battery_level'], plugin: PHONE, limit: 1 });
});

test('not wanted: nothing is read', () => {
  [['no plugin picked', { statusTopLeft: 'pluginValue', pluginValueId: SLOT.pluginValueId }],
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
  assert.deepEqual(stored(KEYS.PLUGIN_VALUE), { source: KEY, reading: reading({ short: '87%', number: 87, unit: '%' }),
    at: NOON, validUntil: null });
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

test('Muninn\'s updatedAt, a number of epoch milliseconds, reaches the watch as the clock time it names', () => {
  const muninn = 'd008a08a-6e34-4cc4-98dc-bae02ce5e087';
  const at = new Date(2026, 10, 21, 11, 7, 0).getTime();
  const h = boot({ settings: { statusTopLeft: 'pluginValue', pluginValuePlugin: muninn,
    pluginValueId: 'muninn/stats/updatedAt', axisTimeFormat: '12h', timeShowAmPm: true } });
  h.pebble.subs[0].push({ pluginUuid: muninn, instances: [{ instanceId: '0',
    properties: { updatedAt: { numericValue: { value: at } } } }] });
  assert.equal(stored(KEYS.PLUGIN_VALUE).reading.time, at);
  minute();
  assert.equal(sentText(h), '11:07a');
});

test('a timestamp, in epoch seconds as a plugin sends it, reaches the watch as a clock time', () => {
  const h = boot();
  h.pebble.subs[0].push(answer({ battery_level: { timestamp: { value: new Date(2026, 10, 21, 18, 30).getTime() / 1000 } } }));
  minute();
  assert.equal(sentText(h), '18:30');
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

test('a value that turns off with the same text is sent again, with the icon\'s off form; the same again sends nothing', () => {
  const WIFI = 'phone/phone_state/wifi';
  const h = boot({ settings: Object.assign({}, SLOT, { pluginValueId: WIFI, pluginValueIcon: 'wifi' }) });
  /**
   * The Phone plugin's Wi-Fi, as a boolean with words of its own.
   * @param {boolean} on Whether it is on.
   * @returns {Object} The answer.
   */
  const wifi = (on) => answer({ wifi: { boolean: { value: on }, shortText: { text: 'Home' } } });
  const sentIcon = () => decodeLine(h.sends[h.sends.length - 1].STATUS_LINE_3_UINT8)[0].icon;
  const I = require('../../../src/pkjs/status-bars/domain/status-line-catalog.js').ICONS;
  h.pebble.subs[0].push(wifi(true));
  minute();
  assert.equal(h.sends.length, 1);
  assert.equal(sentText(h), 'Home');
  assert.equal(sentIcon(), I.PV_WIFI);
  h.clock += HOUR;
  minute();
  h.pebble.subs[1].push(wifi(false));
  minute();
  assert.equal(h.sends.length, 2, 'the text is the same; the icon is not');
  assert.equal(sentText(h), 'Home');
  assert.equal(sentIcon(), I.PV_WIFI_OFF);
  h.clock += HOUR;
  minute();
  h.pebble.subs[2].push(wifi(false));
  minute();
  assert.equal(h.sends.length, 2, 'still off: nothing owed');
});

test('a picked plugin the phone no longer lists is not asked, so no other plugin runs for it: the slot shows --', () => {
  const h = boot();
  h.pebble.subs[0].push(answer());
  minute();
  assert.equal(sentText(h), '87%');
  h.pebble.enumeratePlugins = () => [{ uuid: 'aaaaaaaa-0000-0000-0000-000000000001', name: 'Another',
    sources: [{ category: 'phone', items: ['phone_state'], properties: { battery_level: ['numericValue'] } }] }];
  h.clock = NOON + HOUR;
  minute();
  assert.equal(h.pebble.subs.length, 1, 'not asked');
  assert.equal(stored(KEYS.PLUGIN_VALUE), null);
  assert.equal(sentText(h), '--');
  assert.deepEqual(stored(KEYS.PLUGIN_VALUE_READ), { source: KEY, at: NOON + HOUR, failures: 0, validUntil: null },
    'an answer of nothing: the next read after the Updates interval');
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

test('an answer without the value, or with none the slot can print, shows -- and counts as an answer', () => {
  [answer({ cell: { shortText: { text: 'LTE' } } }), answer({ battery_level: { boolean: true } }),
    { pluginUuid: PHONE, instances: [] }].forEach((envelope) => {
    const h = boot();
    h.pebble.subs[0].push(envelope);
    // One without the value is held a moment for a fuller one (plugin-reader.js readOnce).
    h.timers.filter((t) => t.ms === pluginReader.FULLER_ANSWER_MS).forEach((t) => t.fn());
    assert.equal(h.pebble.subs[0].unsubscribed, 1, 'the read is over');
    assert.equal(stored(KEYS.PLUGIN_VALUE), null);
    assert.equal(stored(KEYS.PLUGIN_VALUE_READ).failures, 0);
    statusRebake.resendStatus('fetch');
    assert.equal(sentText(h), '--');
    h.clock = NOON + HOUR - MIN;
    minute();
    assert.equal(h.pebble.subs.length, 1, 'read again after the Updates interval');
  });
});

test('the Phone plugin\'s network type, sent a moment after its first answer, is the value: not --', () => {
  const h = boot({ settings: {} });
  h.settings = CELL;
  pluginValueSource.refresh();
  // The Phone plugin answers with what the phone knows at once, then again with the network type.
  h.pebble.subs[0].push(answer());
  assert.equal(h.pebble.subs[0].unsubscribed, 0, 'still listening');
  h.pebble.subs[0].push(answer(Object.assign({ cell: { shortText: { text: '5G' } } }, LEVEL)));
  assert.equal(h.pebble.subs[0].unsubscribed, 1);
  assert.equal(stored(KEYS.PLUGIN_VALUE).reading.short, '5G');
  minute();
  assert.equal(sentText(h), '5G', 'on the watch at the next tick');
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

test('the settings page gets the value last heard whole, while it is of the source the settings pick', () => {
  const h = boot();
  assert.equal(pluginValueSource.forPage(SLOT, null), null, 'none yet');
  h.pebble.subs[0].push(answer(null, { validUntilMs: NOON + 2 * HOUR }));
  const value = { source: KEY, reading: reading({ short: '87%', number: 87, unit: '%' }), at: NOON,
    validUntil: NOON + 2 * HOUR };
  assert.deepEqual(pluginValueSource.forPage(SLOT, null), value);
  assert.deepEqual(pluginValueSource.forPage(Object.assign({}, SLOT, { statusTopLeft: 'aqi' }), null), value,
    'whether a bar shows the slot or not: the dialog is the source\'s');
  assert.equal(pluginValueSource.forPage(CELL, null), null, 'another value\'s');
  assert.equal(pluginValueSource.forPage({}, null), null, 'none picked');
});

// --- a complication ------------------------------------------------------------

/** The slot showing the user's second complication. */
const SECOND = { statusTopLeft: 'pluginValue', pluginValuePlugin: PREFERENCES,
  pluginValueId: 'preferences/complications/1' };
const SECOND_KEY = PREFERENCES + '/preferences/complications/1';
/** The user's complications: the temperature of their second weather location, and the phone's charge. */
const TEMPERATURE = { position: 1, category: 'weather', item: 'location', index: 1, property: 'temperature' };
const CHARGE = { position: 1, category: 'phone', item: 'phone_state', index: 0, property: 'battery_level' };
/** Muninn's last update as the user's second complication, a moment in epoch milliseconds. */
const UPDATED = { position: 1, category: 'muninn', item: 'stats', index: 0, property: 'updatedAt' };
/** The plugin list with Muninn, which serves it. */
const MUNINN = [{ uuid: 'm', name: 'Muninn', sources: [{ category: 'muninn', items: ['stats'] }] }];

/**
 * The weather plugin's answer: a temperature for each of the user's weather locations.
 * @param {Array<string>} temperatures The texts, one for each location.
 * @returns {Object} The envelope.
 */
function weather(temperatures) {
  return { pluginUuid: 'w', instances: temperatures.map((t, i) => ({ instanceId: 'loc' + i,
    properties: { temperature: { shortText: { text: t } } } })) };
}

/**
 * Boot with Muninn's last update as the slot's complication.
 * @param {number} [clock] The time (default NOON).
 * @returns {Object} The boot's handle.
 */
function bootUpdated(clock) {
  return boot({ clock: clock, settings: SECOND, complications: [UPDATED], permissions: PERMS, pebble: fakePebble(MUNINN) });
}

test('a complication: the reading it names, from whichever plugin serves its source, of the instance it names', () => {
  const h = boot({ settings: SECOND, complications: [TEMPERATURE], permissions: PERMS, pebble: fakePebble(PLUGINS) });
  assert.deepEqual(h.pebble.subs[0].request, { category: 'weather', item: 'location', properties: ['temperature'],
    limit: 2 }, 'no plugin named: the one the user prefers for it in the Pebble app answers');
  h.pebble.subs[0].push(weather(['21\u00b0', '4\u00b0']));
  assert.equal(stored(KEYS.PLUGIN_VALUE).source, SECOND_KEY + '/weather/location/1/temperature');
  assert.equal(stored(KEYS.PLUGIN_VALUE).reading.short, '4\u00b0', 'the second location\'s');
  minute();
  assert.equal(sentText(h), '4\u00b0');
});

test('a complication changed in the Pebble app: the next tick drops the old reading and reads the new one', () => {
  const h = boot({ settings: SECOND, complications: [TEMPERATURE], permissions: PERMS, pebble: fakePebble(PLUGINS) });
  h.pebble.subs[0].push(weather(['21\u00b0', '4\u00b0']));
  minute();
  h.complications = [CHARGE];
  h.clock += MIN;
  minute();
  assert.equal(h.pebble.subs.length, 2, 'read at once, not an Updates interval later');
  assert.deepEqual(h.pebble.subs[1].request, { category: 'phone', item: 'phone_state', properties: ['battery_level'],
    limit: 1 });
  assert.equal(sentText(h), '--', 'the old reading is not the complication\'s any more');
  h.pebble.subs[1].push(answer());
  minute();
  assert.equal(sentText(h), '87%');
});

test('a complication this app may not read is never asked: the slot shows --', () => {
  const calendar = { position: 1, category: 'calendar', item: 'event', index: 0, property: 'starts_at' };
  const h = boot({ settings: SECOND, complications: [calendar], permissions: PERMS, pebble: fakePebble(PLUGINS) });
  assert.equal(h.pebble.subs.length, 0, 'the Pebble app would ask the user for Calendar');
  minute();
  pluginValueSource.refresh();
  assert.equal(h.pebble.subs.length, 0);
  statusRebake.resendStatus('test');
  assert.equal(sentText(h), '--');
});

test('the settings page gets a complication\'s value only while its place names the reading it was read from', () => {
  const h = boot({ settings: SECOND, complications: [CHARGE], permissions: PERMS, pebble: fakePebble(PLUGINS) });
  h.pebble.subs[0].push(answer());
  assert.equal(pluginValueSource.forPage(SECOND, [CHARGE]).reading.short, '87%');
  // The user moved the temperature to the second place in the Pebble app, and opens the
  // settings before the slot has read it.
  assert.equal(pluginValueSource.forPage(SECOND, [TEMPERATURE]), null, 'never as the temperature');
  assert.equal(pluginValueSource.forPage(SECOND, []), null, 'nor once the place is empty');
  assert.equal(pluginValueSource.forPage(SECOND, null), null, 'nor while the complications are not known');
});

test('a complication changed while no bar showed the slot: the save that puts it back shows --, not the old reading', () => {
  const h = boot({ settings: SECOND, complications: [CHARGE], permissions: PERMS, pebble: fakePebble(PLUGINS) });
  h.pebble.subs[0].push(answer());
  minute();
  assert.equal(sentText(h), '87%');
  h.clock += 10 * MIN;
  h.settings = Object.assign({}, SECOND, { statusTopLeft: 'aqi' });
  pluginValueSource.refresh();
  h.complications = [TEMPERATURE];
  h.clock += 10 * MIN;
  h.settings = SECOND;
  pluginValueSource.refresh();
  statusRebake.resendStatus('config-close');
  assert.equal(sentText(h), '--', 'the phone\'s charge is not the temperature');
  assert.equal(stored(KEYS.PLUGIN_VALUE), null);
  assert.deepEqual(h.pebble.subs[1].request.properties, ['temperature'], 'the temperature, read at once');
  h.pebble.subs[1].fail('TIMEOUT');
  statusRebake.resendStatus('fetch');
  assert.equal(sentText(h), '--', 'nor once its read failed');
});

test('a complication changed in the Pebble app is read as the list says so, and a read of the old reading under way is dropped', () => {
  // A start with the list kept from before the change reads the reading the place named then.
  const h = boot({ settings: SECOND, complications: [CHARGE], permissions: PERMS, pebble: fakePebble(PLUGINS) });
  assert.deepEqual(h.pebble.subs[0].request.properties, ['battery_level']);
  // The Preferences plugin's first answer says the place names the temperature now.
  h.complications = [TEMPERATURE];
  pluginValueSource.complicationsChanged();
  h.pebble.subs[0].push(answer());
  assert.equal(stored(KEYS.PLUGIN_VALUE), null, 'the phone\'s charge is not kept as the temperature');
  assert.deepEqual(h.pebble.subs[1].request.properties, ['temperature'], 'the temperature, read as that read ends');
  h.pebble.subs[1].push(weather(['21\u00b0', '4\u00b0']));
  minute();
  assert.equal(sentText(h), '4\u00b0');
  h.complications = [CHARGE];
  h.clock += MIN;
  pluginValueSource.complicationsChanged();
  assert.equal(h.pebble.subs.length, 3, 'with no read under way, at once');
  statusRebake.resendStatus('fetch');
  assert.equal(sentText(h), '--', 'and the temperature is not the phone\'s charge');
});

test('the complications no longer known: the value kept is dropped, as the settings page has it', () => {
  const h = boot({ settings: SECOND, complications: [TEMPERATURE], permissions: PERMS, pebble: fakePebble(PLUGINS) });
  h.pebble.subs[0].push(weather(['21\u00b0', '4\u00b0']));
  minute();
  assert.equal(sentText(h), '4\u00b0');
  // The Pebble app stopped serving the complications (complication-list.js holds none).
  h.complications = null;
  pluginValueSource.complicationsChanged();
  assert.equal(stored(KEYS.PLUGIN_VALUE), null, 'no reading is the place\'s now');
  assert.equal(pluginValueSource.forPage(SECOND, null), null);
  h.clock += MIN;
  minute();
  assert.equal(sentText(h), '--', 'on the watch at the next tick');
  h.complications = [TEMPERATURE];
  pluginValueSource.complicationsChanged();
  assert.equal(h.pebble.subs.length, 2, 'known again: read at once');
});

test('a place left empty: nothing is read, and the value kept is dropped', () => {
  const h = boot({ settings: SECOND, complications: [TEMPERATURE], permissions: PERMS, pebble: fakePebble(PLUGINS) });
  h.pebble.subs[0].push(weather(['21\u00b0', '4\u00b0']));
  h.complications = [];
  h.clock += MIN;
  minute();
  assert.equal(h.pebble.subs.length, 1);
  assert.equal(stored(KEYS.PLUGIN_VALUE), null);
  assert.equal(sentText(h), '--');
});

test('the complications not known yet: nothing is read until they are, then at once', () => {
  const h = boot({ settings: SECOND, complications: null, permissions: PERMS, pebble: fakePebble(PLUGINS) });
  minute();
  assert.equal(h.pebble.subs.length, 0);
  h.complications = [TEMPERATURE];
  minute();
  assert.equal(h.pebble.subs.length, 1);
});

test('a complication\'s moment prints as a clock time: its property\'s name is last in the value\'s key', () => {
  const at = new Date(2026, 10, 21, 11, 7, 0).getTime();
  const h = bootUpdated();
  h.pebble.subs[0].push(answer({ updatedAt: { numericValue: { value: at } } }, { pluginUuid: 'm' }));
  minute();
  assert.equal(sentText(h), '11:07');
});

test('a moment of the day the slot showed it on gets its date at the midnight after it', () => {
  const at = new Date(2026, 10, 21, 23, 10, 0).getTime();
  const h = bootUpdated(new Date(2026, 10, 21, 23, 30, 0).getTime());
  h.pebble.subs[0].push(answer({ updatedAt: { numericValue: { value: at } } }, { pluginUuid: 'm' }));
  minute();
  assert.equal(sentText(h), '23:10');
  h.clock = new Date(2026, 10, 21, 23, 59, 0).getTime();
  const sends = h.sends.length;
  minute();
  assert.equal(h.sends.length, sends, 'nothing owed while it is still that day');
  h.clock = new Date(2026, 10, 22, 0, 0, 0).getTime();
  minute();
  assert.equal(sentText(h), '21 Nov', 'yesterday\'s: a side slot has no room for the time as well');
});

test('a moment the slot prints none of owes the watch nothing at the midnight after it', () => {
  const at = new Date(2026, 10, 21, 23, 10, 0).getTime();
  const h = bootUpdated(new Date(2026, 10, 21, 23, 30, 0).getTime());
  h.pebble.subs[0].push(answer({ updatedAt: { shortText: { text: 'Synced' }, numericValue: { value: at } } },
    { pluginUuid: 'm' }));
  minute();
  assert.equal(sentText(h), 'Synced', 'its short text prints, not its moment');
  const sends = h.sends.length;
  h.clock = new Date(2026, 10, 22, 0, 0, 0).getTime();
  minute();
  assert.equal(h.sends.length, sends, 'the same text on either day');
});

test('a pick of the Preferences plugin\'s own reading, which 3.4.0 listed, is never read: the value kept is dropped at once', () => {
  const pick = { statusTopLeft: 'pluginValue', pluginValuePlugin: PREFERENCES,
    pluginValueId: 'preferences/weather_location/latitude' };
  const key = PREFERENCES + '/preferences/weather_location/latitude';
  Object.keys(storage).forEach((k) => { delete storage[k]; });
  storage[KEYS.PLUGIN_VALUE] = JSON.stringify({ source: key, reading: reading({ short: '52.52', number: 52.52 }),
    at: NOON - 10 * MIN, validUntil: null });
  storage[KEYS.PLUGIN_VALUE_READ] = JSON.stringify({ source: key, at: NOON - 10 * MIN, failures: 0, validUntil: null });
  const h = boot({ keepStorage: true, settings: pick, permissions: PERMS, pebble: fakePebble([preferencesPlugin([{
    category: 'preferences', items: ['weather_location'], properties: { latitude: ['numericValue'] } }])]) });
  assert.equal(stored(KEYS.PLUGIN_VALUE), null, 'the user\'s position, dropped as the slot starts');
  statusRebake.resendStatus('fetch');
  assert.equal(sentText(h), '--');
  assert.equal(pluginValueSource.forPage(pick, null), null, 'nor on the settings page');
  h.clock += 2 * HOUR;
  minute();
  pluginValueSource.refresh();
  assert.equal(h.pebble.subs.length, 0, 'never asked');
});

test('a value of a plugin\'s own that asks for a permission this app never declared is not read either', () => {
  const h = boot({ permissions: PERMS, pebble: fakePebble([{ uuid: PHONE, name: 'Phone', sources: [{ category: 'phone',
    items: ['phone_state'], callerPermissions: ['Contacts'] }] }]) });
  assert.equal(h.pebble.subs.length, 0);
});
