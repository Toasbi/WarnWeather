'use strict';
// The Plugin value slots' values (plugin-value-source.js): each read once however many slots
// show it, when it is read, what is kept of it, and when the watch is told. How every plugin read runs, from its record to the status
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
const catalog = require('../../../src/pkjs/status-bars/domain/status-line-catalog.js');
const { decodeLine } = require('../../helpers/status-line-bytes.js');
const { pluginValueSlot } = require('../../helpers/status-slots.js');

// Every line logged, kept for the test that the value never is.
const logged = [];
const realLog = console.log;
test.before(() => { console.log = function () { logged.push(Array.prototype.join.call(arguments, ' ')); }; });
test.after(() => { console.log = realLog; });

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const PHONE = '00000000-0000-0000-0001-000000000001';
const ID = 'phone/phone_state/battery_level';

/**
 * The settings of a slot that holds the Plugin value and picks the Phone plugin's battery level,
 * or what `more` says.
 * @param {string} slotKey The slot.
 * @param {Object} [more] The pick's other parts, by their names (catalog.pluginValueKeys):
 *   {plugin, id, look, icon, label, every}.
 * @returns {Object} Settings.
 */
function slot(slotKey, more) {
  return pluginValueSlot(slotKey, { plugin: PHONE, id: ID, ...more });
}

/** The Watch bar's left slot showing the Phone plugin's battery level, read every hour. */
const SLOT = slot('statusTopLeft');
const KEY = PHONE + '/' + ID;
/** The same plugin's network type. */
const CELL = slot('statusTopLeft', { id: 'phone/phone_state/cell' });
const CELL_KEY = PHONE + '/phone/phone_state/cell';
/** The battery level in the Watch bar's left slot and the network type in its right one. */
const LEVEL_AND_CELL = Object.assign({}, SLOT, slot('statusTopRight', { id: 'phone/phone_state/cell' }));
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

/** The Phone plugin's battery level and network type, in one answer. */
const BOTH = Object.assign({ cell: { shortText: { text: 'LTE' } } }, LEVEL);

/**
 * Boot the source with its re-baker, every dependency injected: a PKJS start.
 * @param {Object} [opts] {settings, pebble, clock, keepStorage, watchInfo, complications,
 *   permissions}: the user's complications as last heard (default none known), and the
 *   permissions this app declares (default none).
 * @returns {Object} Handle: mutable .clock/.settings/.watchInfo, .pebble, collected .sends, .timers.
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
    complications: Object.prototype.hasOwnProperty.call(opts, 'complications') ? opts.complications : null,
    watchInfo: opts.watchInfo || { platform: 'basalt' }
  };
  statusRebake.init(withHost({
    getSettings: () => h.settings,
    getBakeFacts: () => ({ plugin: pluginValueSource.bakeFacts() }),
    sendWeather: (p) => { h.sends.push(p); },
    now: () => h.clock
  }));
  // The inputs of a bake the re-bake can re-bake: the real baker runs.
  statusRebake.rememberBakeInputs({ CITY: 'Bonn', CURRENT_TEMP: 68, SUN_EVENTS: [1, 0, 0, 0, 0] },
    h.watchInfo, new Date(h.clock));
  pluginValueSource.init({
    pebble: h.pebble,
    getSettings: () => h.settings,
    getWatchInfo: () => h.watchInfo,
    now: () => h.clock,
    timers: opts.timers || heldTimers(h.timers),
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

/**
 * @param {string} source A source's key (plugin-values.js sourceOf).
 * @returns {?Object} The value kept of it (KEYS.PLUGIN_VALUES), or null.
 */
function storedValue(source) {
  const map = stored(KEYS.PLUGIN_VALUES);
  return map && Object.prototype.hasOwnProperty.call(map, source) ? map[source] : null;
}

/**
 * @param {string} source A source's key.
 * @returns {?Object} The record of its last read (KEYS.PLUGIN_VALUE_READS), or null.
 */
function storedRead(source) {
  const map = stored(KEYS.PLUGIN_VALUE_READS);
  return map && Object.prototype.hasOwnProperty.call(map, source) ? map[source] : null;
}

test('wanted and never read: the plugin picked is asked at start, for the one value and the instances\' names', () => {
  const h = boot();
  assert.equal(h.pebble.subs.length, 1);
  assert.deepEqual(h.pebble.subs[0].request, { category: 'phone', item: 'phone_state',
    properties: ['battery_level', 'name'], plugin: PHONE, limit: 16 });
});

test('not wanted: nothing is read', () => {
  [['no plugin picked', slot('statusTopLeft', { plugin: '' })],
    ['no value picked', slot('statusTopLeft', { id: '' })],
    ['no slot shows it', Object.assign({}, SLOT, { statusTopLeft: 'aqi' })],
    ['only a bar no screen shows does', slot('statusHealthLeft')],
    ['another slot picks it, which holds another item', Object.assign(slot('statusTopRight'), { statusTopRight: 'aqi',
      statusTopLeft: 'pluginValue' })]]
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
  assert.deepEqual(storedValue(KEY), { source: KEY, reading: reading({ short: '87%', number: 87, unit: '%' }),
    at: NOON, validUntil: null });
  assert.deepEqual(pluginValueSource.bakeFacts().valueOf({ key: KEY }), storedValue(KEY));
  assert.equal(pluginValueSource.bakeFacts().valueOf({ key: CELL_KEY }), null, 'none of a source no slot shows');
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
  const h = boot({ settings: Object.assign(slot('statusTopLeft', { plugin: muninn, id: 'muninn/stats/updatedAt' }),
    { axisTimeFormat: '12h', timeShowAmPm: true }) });
  h.pebble.subs[0].push({ pluginUuid: muninn, instances: [{ instanceId: '0',
    properties: { updatedAt: { numericValue: { value: at } } } }] });
  assert.equal(storedValue(muninn + '/muninn/stats/updatedAt').reading.time, at);
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
  assert.equal(storedValue(KEY).reading.long, 'y'.repeat(64));
});

test('each slot that shows the value prints it at its own room, from one read', () => {
  const h = boot({ settings: Object.assign({}, SLOT, slot('statusTopMid')) });
  h.pebble.subs[0].push(answer({ battery_level: { numericValue: { value: 12345, unit: 'kWh' } } }));
  minute();
  const slots = decodeLine(h.sends[0].STATUS_LINE_3_UINT8);
  assert.equal(slots[0].text, '12345', 'an edge slot has no room for the unit');
  assert.equal(slots[1].text, '12345 kWh', 'the middle has');
  assert.equal(h.pebble.subs.length, 1);
});

test('the read is kept in storage: its source, when it started, its failures, and until when the answer holds', () => {
  const h = boot();
  assert.deepEqual(storedRead(KEY), { source: KEY, at: NOON, failures: 0, validUntil: null },
    'stamped as it starts');
  h.clock += 5000;
  h.pebble.subs[0].push(answer(null, { validUntilMs: NOON + 2 * HOUR }));
  assert.deepEqual(storedRead(KEY), { source: KEY, at: NOON, failures: 0, validUntil: NOON + 2 * HOUR });
  assert.equal(storedValue(KEY).at, NOON + 5000, 'the value: when it was heard');
  assert.equal(storedValue(KEY).validUntil, NOON + 2 * HOUR);
});

test('the Updates setting says how often: the tick reads again after it, and not a minute before', () => {
  [['15', 15 * MIN], ['30', 30 * MIN], ['60', HOUR], ['180', 3 * HOUR], ['360', 6 * HOUR]].forEach(([every, ms]) => {
    const h = boot({ settings: slot('statusTopLeft', { every: every }) });
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
  const h = boot({ settings: slot('statusTopLeft', { id: WIFI, look: 'both', icon: 'wifi' }) });
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

test('in the Icon look a new text with the same state owes the watch nothing; another state does', () => {
  const WIFI = 'phone/phone_state/wifi';
  const h = boot({ settings: slot('statusTopLeft', { id: WIFI, look: 'icon', icon: 'wifi' }) });
  /**
   * @param {boolean} on Whether the Wi-Fi is on. @param {string} name Its network's name.
   * @returns {Object} The Phone plugin's answer.
   */
  const wifi = (on, name) => answer({ wifi: { boolean: { value: on }, shortText: { text: name } } });
  h.pebble.subs[0].push(wifi(true, 'Home'));
  minute();
  assert.equal(h.sends.length, 1);
  assert.deepEqual(decodeLine(h.sends[0].STATUS_LINE_3_UINT8)[0].text, '', 'the icon alone');
  h.clock += HOUR;
  minute();
  h.pebble.subs[1].push(wifi(true, 'Work'));
  minute();
  assert.equal(h.sends.length, 1, 'the watch shows no text: nothing owed');
  h.clock += HOUR;
  minute();
  h.pebble.subs[2].push(wifi(false, 'Work'));
  minute();
  assert.equal(h.sends.length, 2, 'off: the icon\'s off form is owed');
});

test('a label reaches the watch in place of the value\'s text, the icon turning with it; a new text with the same state owes nothing', () => {
  const h = boot({ settings: slot('statusTopLeft', { id: 'phone/phone_state/wifi', look: 'both', icon: 'wifi',
    label: 'Lamp' }) });
  const wifi = (on, name) => answer({ wifi: { boolean: { value: on }, shortText: { text: name } } });
  h.pebble.subs[0].push(wifi(true, 'Home'));
  minute();
  const on = decodeLine(h.sends[0].STATUS_LINE_3_UINT8)[0];
  assert.equal(on.text, 'Lamp');
  h.clock += HOUR;
  minute();
  h.pebble.subs[1].push(wifi(true, 'Work'));
  minute();
  assert.equal(h.sends.length, 1, 'the watch shows the label: nothing owed');
  h.clock += HOUR;
  minute();
  h.pebble.subs[2].push(wifi(false, 'Work'));
  minute();
  const off = decodeLine(h.sends[1].STATUS_LINE_3_UINT8)[0];
  assert.equal(off.text, 'Lamp', 'off: the label still');
  assert.notEqual(off.icon, on.icon, 'and the icon\'s off form');
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
  assert.equal(storedValue(KEY), null);
  assert.equal(sentText(h), '--');
  assert.deepEqual(storedRead(KEY), { source: KEY, at: NOON + HOUR, failures: 0, validUntil: null },
    'an answer of nothing: the next read after the Updates interval');
});

test('an answer from another plugin than the one picked counts as the picked one not being there', () => {
  const h = boot();
  h.pebble.subs[0].push(answer());
  h.clock = NOON + HOUR;
  minute();
  h.pebble.subs[1].push(answer(null, { pluginUuid: 'ffffffff-0000-0000-0000-000000000001' }));
  assert.equal(storedValue(KEY), null);
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
  assert.deepEqual(h.pebble.subs[1].request.properties, ['cell', 'name']);
  assert.equal(storedValue(KEY), null, 'the old value is gone');
  assert.equal(storedRead(KEY), null, 'and its read');
  statusRebake.resendStatus('config-close');
  assert.equal(sentText(h), '--', 'and never shown for the new one');
  h.pebble.subs[1].push(answer({ cell: { shortText: { text: 'LTE' } } }));
  minute();
  assert.equal(sentText(h), 'LTE');
  h.settings = slot('statusTopLeft', { id: 'phone/phone_state/cell', plugin: 'ffffffff-0000-0000-0000-000000000001' });
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
    assert.equal(storedValue(KEY), null);
    assert.equal(storedRead(KEY).failures, 0);
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
  assert.equal(storedValue(CELL_KEY).reading.short, '5G');
  minute();
  assert.equal(sentText(h), '5G', 'on the watch at the next tick');
});

test('the value is never logged: it is another app\'s data', () => {
  logged.length = 0;
  const h = boot({ settings: slot('statusTopLeft', { every: '30' }) });
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

test('the settings page gets each value last heard whole, by its source, while a slot shows it', () => {
  const h = boot({ settings: LEVEL_AND_CELL });
  assert.deepEqual(pluginValueSource.forPage(null), {}, 'none yet');
  h.pebble.subs[0].push(answer(BOTH, { validUntilMs: NOON + 2 * HOUR }));
  const value = { source: KEY, reading: reading({ short: '87%', number: 87, unit: '%' }), at: NOON,
    validUntil: NOON + 2 * HOUR };
  assert.deepEqual(Object.keys(pluginValueSource.forPage(null)), [KEY, CELL_KEY], 'each its own');
  assert.deepEqual(pluginValueSource.forPage(null)[KEY], value);
  assert.equal(pluginValueSource.forPage(null)[CELL_KEY].reading.short, 'LTE');
  h.settings = SLOT;
  pluginValueSource.refresh();
  assert.deepEqual(Object.keys(pluginValueSource.forPage(null)), [KEY], 'a source no slot shows any more: gone');
});

// --- which instance ---------------------------------------------------------------------

/** A home plugin's rooms, each with its lights, as it sends them: the kitchen first. */
const HOME = 'aaaaaaaa-0000-0000-0000-00000000000a';
const ROOMS = (rooms) => ({ pluginUuid: HOME, instances: rooms.map(([id, name, on]) => ({ instanceId: id,
  properties: { name: { shortText: { text: name } }, on: { boolean: { value: on }, shortText: { text: on ? 'On' : 'Off' } } } })) });
const LIGHTS = { plugin: HOME, id: 'home/room_lights/on' };
const ITEM = HOME + '/home/room_lights';

test('a slot that picks an instance shows that one\'s value, wherever the plugin sends it, by a key of its own', () => {
  const h = boot({ settings: slot('statusTopLeft', Object.assign({ instance: 'hall/2' }, LIGHTS)) });
  assert.deepEqual(h.pebble.subs[0].request, { category: 'home', item: 'room_lights', properties: ['on', 'name'],
    plugin: HOME, limit: 16 }, 'the instance asked for is never sent: the read brings the first 16');
  h.pebble.subs[0].push(ROOMS([['kitchen', 'Kitchen', true], ['hall/2', 'Hall', false]]));
  const key = HOME + '#hall%2F2/home/room_lights/on';
  assert.equal(storedValue(key).reading.short, 'Off', 'the hall\'s');
  assert.equal(storedValue(HOME + '/home/room_lights/on'), null, 'nothing kept for the first');
  minute();
  assert.equal(sentText(h), 'Off');
});

test('an instance the plugin no longer sends shows --, never the first in its place', () => {
  const h = boot({ settings: slot('statusTopLeft', Object.assign({ instance: 'hall' }, LIGHTS)) });
  h.pebble.subs[0].push(ROOMS([['kitchen', 'Kitchen', true]]));
  assert.equal(storedValue(HOME + '#hall/home/room_lights/on'), null, 'nothing kept for it');
  statusRebake.resendStatus('fetch');
  assert.equal(sentText(h), '--');
});

test('a slot on the first shows the first instance that has its value: a weather station\'s pressure from its indoor module', () => {
  const STATION = 'bbbbbbbb-0000-0000-0000-00000000000b';
  const moduleOf = (id, name, props) => ({ instanceId: id,
    properties: Object.assign({ name: { shortText: { text: name } } }, props) });
  const h = boot({ settings: slot('statusTopLeft', { plugin: STATION, id: 'weather/netatmo/pressure' }) });
  assert.deepEqual(h.pebble.subs[0].request.properties, ['pressure', 'name']);
  h.pebble.subs[0].push({ pluginUuid: STATION, instances: [moduleOf('02:00:00:aa:bb:01', 'Home - Outdoor', {}),
    moduleOf('70:ee:50:aa:bb:02', 'Home - Indoor', { pressure: { shortText: { text: '1013hPa' } } })] });
  assert.equal(storedValue(STATION + '/weather/netatmo/pressure').reading.short, '1013hPa');
  minute();
  assert.equal(sentText(h), '1013hPa');
});

test('two slots, the first room and the hall, are one read, each showing its own', () => {
  const h = boot({ settings: Object.assign({}, slot('statusTopLeft', LIGHTS),
    slot('statusTopRight', Object.assign({ instance: 'hall' }, LIGHTS))) });
  assert.equal(h.pebble.subs.length, 1);
  h.pebble.subs[0].push(ROOMS([['kitchen', 'Kitchen', true], ['hall', 'Hall', false]]));
  minute();
  const cells = decodeLine(h.sends[h.sends.length - 1].STATUS_LINE_3_UINT8);
  assert.deepEqual([cells[0].text, cells[2].text], ['On', 'Off']);
});

test('the instances a read brings are kept by the item for the page, and go once no slot picks a value of it', () => {
  const h = boot({ settings: slot('statusTopLeft', LIGHTS) });
  assert.deepEqual(pluginValueSource.instancesForPage(), {}, 'none yet');
  h.pebble.subs[0].push(ROOMS([['kitchen', 'Kitchen', true], ['hall', 'Hall', false]]));
  const names = [{ id: 'kitchen', name: 'Kitchen' }, { id: 'hall', name: 'Hall' }];
  assert.deepEqual(pluginValueSource.instancesForPage(), { [ITEM]: names });
  assert.deepEqual(stored(KEYS.PLUGIN_INSTANCES), { [ITEM]: names });
  h.settings = slot('statusTopLeft', { plugin: HOME, id: 'home/room_lights/brightness' });
  pluginValueSource.refresh();
  assert.deepEqual(pluginValueSource.instancesForPage(), { [ITEM]: names }, 'another value of the item: kept');
  h.settings = SLOT;
  pluginValueSource.refresh();
  assert.deepEqual(pluginValueSource.instancesForPage(), {}, 'no slot picks the item: gone');
  storage[KEYS.PLUGIN_INSTANCES] = '[1]';
  assert.deepEqual(pluginValueSource.instancesForPage(), {}, 'what is stored that is none');
});

test('a complication\'s read keeps no instances: the Pebble app picks its plugin, and its place its instance', () => {
  const h = boot({ settings: SECOND, complications: [TEMPERATURE], permissions: PERMS, pebble: fakePebble(PLUGINS) });
  const named = weather(['21\u00b0', '4\u00b0']);
  named.instances.forEach((one, i) => { one.properties.name = { shortText: { text: 'Place ' + i } }; });
  h.pebble.subs[0].push(named);
  assert.equal(storedValue(SECOND_KEY).reading.short, '4\u00b0', 'read');
  assert.equal(stored(KEYS.PLUGIN_INSTANCES), null);
});

test('a read asks for the names only where the Which row can list them: never for the name itself, nor the next event', () => {
  const CALENDAR = 'bbbbbbbb-0000-0000-0000-00000000000b';
  const h = boot({ settings: Object.assign({}, slot('statusTopLeft', { plugin: HOME, id: 'home/room_lights/name' }),
    slot('statusTopRight', { plugin: CALENDAR, id: 'calendar/event/title' })) });
  assert.deepEqual(h.pebble.subs.map((sub) => [sub.request.properties, sub.request.limit]),
    [[['name'], 1], [['title'], 1]], 'the first instance alone');
  h.pebble.subs[0].push(ROOMS([['kitchen', 'Kitchen', true], ['hall', 'Hall', false]]));
  h.pebble.subs[1].push({ pluginUuid: CALENDAR, instances: [{ instanceId: 'e1',
    properties: { title: { shortText: { text: 'Standup' } } } }] });
  assert.deepEqual([storedValue(HOME + '/home/room_lights/name').reading.short,
    storedValue(CALENDAR + '/calendar/event/title').reading.short], ['Kitchen', 'Standup']);
  assert.equal(stored(KEYS.PLUGIN_INSTANCES), null, 'no names kept where no row lists them');
});

test('the next event is the first the plugin sends, whatever it brings, even where it sends more than asked for', () => {
  // A Pebble app from before 2.0.0 sends every event, whatever the limit (plugin-reader.js PluginRequest).
  const CALENDAR = 'bbbbbbbb-0000-0000-0000-00000000000b';
  const h = boot({ settings: slot('statusTopLeft', { plugin: CALENDAR, id: 'calendar/event/location' }) });
  assert.equal(h.pebble.subs[0].request.limit, 1);
  h.pebble.subs[0].push({ pluginUuid: CALENDAR, instances: [
    { instanceId: 'e1', properties: { title: { shortText: { text: 'Standup' } } } },
    { instanceId: 'e2', properties: { location: { shortText: { text: 'Room 4' } } } }] });
  h.timers.filter((t) => t.ms === pluginReader.FULLER_ANSWER_MS).forEach((t) => t.fn());
  assert.equal(h.pebble.subs[0].unsubscribed, 1, 'the read is over');
  assert.equal(storedValue(CALENDAR + '/calendar/event/location'), null, 'never a later event\'s');
  statusRebake.resendStatus('fetch');
  assert.equal(sentText(h), '--');
});

test('the names kept are those the Which row can list: an instance without an id a slot can pick, or a name, is left out', () => {
  const h = boot({ settings: slot('statusTopLeft', LIGHTS) });
  h.pebble.subs[0].push(ROOMS([['kitchen', 'Kitchen', true], ['', 'Nowhere', true], ['hall', '', false],
    ['x'.repeat(65), 'Long', true], ['attic', 'Attic', false]]));
  assert.deepEqual(stored(KEYS.PLUGIN_INSTANCES), { [ITEM]: [{ id: 'kitchen', name: 'Kitchen' },
    { id: 'attic', name: 'Attic' }] });
});

// --- several values -----------------------------------------------------------------------

test('two values of one plugin\'s item are one read for both: each is kept on its own, and each slot shows its own', () => {
  const h = boot({ settings: LEVEL_AND_CELL });
  assert.equal(h.pebble.subs.length, 1, 'the plugin runs once for both');
  assert.deepEqual(h.pebble.subs[0].request, { category: 'phone', item: 'phone_state',
    properties: ['battery_level', 'name', 'cell'], plugin: PHONE, limit: 16 }, 'both asked for, in the bars\' order');
  h.pebble.subs[0].push(answer(BOTH));
  assert.equal(h.pebble.subs[0].unsubscribed, 1);
  assert.deepEqual(Object.keys(stored(KEYS.PLUGIN_VALUES)).sort(), [CELL_KEY, KEY].sort());
  assert.equal(storedRead(KEY).source, KEY);
  assert.equal(storedRead(CELL_KEY).source, CELL_KEY);
  minute();
  const slots = decodeLine(h.sends[h.sends.length - 1].STATUS_LINE_3_UINT8);
  assert.deepEqual([slots[0].text, slots[2].text], ['87%', 'LTE']);
});

test('one value in two slots is read once, as often as the slot that wants it most often says', () => {
  const h = boot({ settings: Object.assign(slot('statusTopLeft', { every: '60' }), slot('statusTopRight', { every: '15' })) });
  assert.equal(h.pebble.subs.length, 1, 'one read for both');
  h.pebble.subs[0].push(answer());
  h.clock = NOON + 15 * MIN - MIN;
  minute();
  assert.equal(h.pebble.subs.length, 1);
  h.clock = NOON + 15 * MIN;
  minute();
  assert.equal(h.pebble.subs.length, 2, 'the right slot\'s 15 minutes');
});

test('a slot\'s Updates changed for the value it shows: the next read keeps the new Updates', () => {
  const h = boot({ settings: slot('statusTopLeft', { every: '60' }) });
  h.pebble.subs[0].push(answer());
  // The user saves 15 minutes for the same value: no read now, the value is read 15 minutes on.
  h.settings = slot('statusTopLeft', { every: '15' });
  pluginValueSource.refresh();
  assert.equal(h.pebble.subs.length, 1, 'a value already read is not read again at the save');
  h.clock = NOON + 15 * MIN;
  minute();
  assert.equal(h.pebble.subs.length, 2, 'the new 15 minutes');
});

test('a second slot that shows a value already shown: the watch is owed what both show', () => {
  const h = boot({ settings: slot('statusTopLeft') });
  h.pebble.subs[0].push(answer());
  minute();
  const sent = h.sends.length;
  h.settings = Object.assign(slot('statusTopLeft'), slot('statusTopMid', { icon: 'phone' }));
  h.clock += MIN;
  minute();
  assert.equal(h.pebble.subs.length, 1, 'read once for both');
  assert.equal(h.sends.length, sent + 1, 'the tick sends the line with the second slot');
  assert.deepEqual(decodeLine(h.sends[h.sends.length - 1].STATUS_LINE_3_UINT8).map((cell) => cell.text),
    ['87%', '87%', decodeLine(h.sends[sent - 1].STATUS_LINE_3_UINT8)[2].text]);
});

test('a value no slot picks any more goes at the save; the other slot\'s stays and is not read again', () => {
  const h = boot({ settings: LEVEL_AND_CELL });
  h.pebble.subs[0].push(answer(BOTH));
  h.clock += 10 * MIN;
  h.settings = Object.assign({}, SLOT, { statusTopRight: 'aqi' });
  pluginValueSource.refresh();
  assert.equal(storedValue(CELL_KEY), null);
  assert.equal(storedRead(CELL_KEY), null);
  assert.equal(storedValue(KEY).reading.short, '87%');
  assert.equal(h.pebble.subs.length, 1, 'the battery level is not due');
  h.settings = LEVEL_AND_CELL;
  pluginValueSource.refresh();
  assert.equal(h.pebble.subs.length, 2, 'picked again: read at once');
});

test('a value no slot picks any more while it is read: the answer goes nowhere, the other read lands', () => {
  const h = boot({ settings: LEVEL_AND_CELL });
  h.settings = SLOT;
  pluginValueSource.refresh();
  h.pebble.subs[0].push(answer(BOTH));
  assert.deepEqual(Object.keys(stored(KEYS.PLUGIN_VALUES)), [KEY]);
  assert.equal(storedRead(CELL_KEY), null);
  assert.equal(h.pebble.subs.length, 1, 'and nothing is read again');
});

// --- one read for the values of one plugin's item ---------------------------------------------

test('a value of the item read now is read with it, though its own read is not due: they go together from then on', () => {
  const h = boot();
  h.pebble.subs[0].push(answer());
  h.clock = NOON + 20 * MIN;
  h.settings = LEVEL_AND_CELL;
  pluginValueSource.refresh();
  assert.equal(h.pebble.subs.length, 2, 'one read for the value picked and the one shown');
  assert.deepEqual(h.pebble.subs[1].request.properties, ['cell', 'name', 'battery_level'], 'the battery level joins');
  h.pebble.subs[1].push(answer(BOTH));
  assert.equal(storedRead(KEY).at, NOON + 20 * MIN, 'the battery level read anew');
  assert.equal(storedValue(CELL_KEY).reading.short, 'LTE');
  h.clock = NOON + HOUR;
  minute();
  assert.equal(h.pebble.subs.length, 2, 'not at the hour it was due before');
  h.clock = NOON + 20 * MIN + HOUR;
  minute();
  assert.equal(h.pebble.subs.length, 3, 'an hour after the read they shared');
  assert.deepEqual(h.pebble.subs[2].request.properties, ['battery_level', 'name', 'cell'], 'together again');
});

test('a value of the item whose read is under way does not join another: it is not read twice at once', () => {
  const h = boot();
  h.clock = NOON + 20 * MIN;
  h.settings = LEVEL_AND_CELL;
  pluginValueSource.refresh();
  assert.equal(h.pebble.subs.length, 2);
  assert.deepEqual(h.pebble.subs[1].request.properties, ['cell', 'name'], 'the battery level is read already');
});

test('one read waits for the answer that brings every value asked for: the network type a moment after the battery level', () => {
  const h = boot({ settings: LEVEL_AND_CELL });
  h.pebble.subs[0].push(answer());
  assert.equal(h.pebble.subs[0].unsubscribed, 0, 'still listening: the network type may follow');
  assert.equal(storedValue(KEY), null, 'nothing kept yet');
  h.pebble.subs[0].push(answer(Object.assign({ cell: { shortText: { text: '5G' } } }, LEVEL)));
  assert.equal(h.pebble.subs[0].unsubscribed, 1);
  assert.equal(storedValue(KEY).reading.short, '87%');
  assert.equal(storedValue(CELL_KEY).reading.short, '5G');
});

test('one read that no fuller answer follows: each value takes what the answer brings of it', () => {
  const h = boot({ settings: LEVEL_AND_CELL });
  h.pebble.subs[0].push(answer());
  h.timers.filter((t) => t.ms === pluginReader.FULLER_ANSWER_MS).forEach((t) => t.fn());
  assert.equal(h.pebble.subs[0].unsubscribed, 1, 'the read is over');
  assert.equal(storedValue(KEY).reading.short, '87%');
  assert.equal(storedValue(CELL_KEY), null, 'an answer of nothing for the network type');
  assert.equal(storedRead(CELL_KEY).failures, 0);
});

test('one read that fails fails for each value: each counts it, and keeps the value it had', () => {
  const h = boot({ settings: LEVEL_AND_CELL });
  h.pebble.subs[0].push(answer(BOTH));
  h.clock = NOON + HOUR;
  minute();
  h.pebble.subs[1].fail('TIMEOUT');
  assert.deepEqual([storedRead(KEY).failures, storedRead(CELL_KEY).failures], [1, 1]);
  assert.deepEqual([storedValue(KEY).reading.short, storedValue(CELL_KEY).reading.short], ['87%', 'LTE']);
});

test('values of two plugins are two reads, and so are a complication and a pick of the same item: the Pebble app picks the complication\'s plugin', () => {
  const OTHER = 'ffffffff-0000-0000-0000-000000000001';
  let h = boot({ settings: Object.assign({}, SLOT, slot('statusTopRight', { plugin: OTHER, id: 'phone/phone_state/cell' })) });
  assert.deepEqual(h.pebble.subs.map((sub) => [sub.request.plugin, sub.request.properties]),
    [[PHONE, ['battery_level', 'name']], [OTHER, ['cell', 'name']]]);
  h = boot({ settings: Object.assign({}, SECOND, slot('statusTopRight', { id: 'phone/phone_state/cell' })),
    complications: [CHARGE], permissions: PERMS,
    pebble: fakePebble(PLUGINS.concat([{ uuid: PHONE, name: 'Phone', sources: [{ category: 'phone', items: ['phone_state'] }] }])) });
  assert.deepEqual(h.pebble.subs.map((sub) => [sub.request.plugin, sub.request.properties]),
    [[undefined, ['battery_level']], [PHONE, ['cell', 'name']]]);
});

test('two complications of one source are one read, for as many instances as the furthest place names', () => {
  const h = bootTwoPlaces();
  assert.equal(h.pebble.subs.length, 1);
  assert.deepEqual(h.pebble.subs[0].request, { category: 'weather', item: 'location', properties: ['temperature'],
    limit: 2 });
  h.pebble.subs[0].push(weather(['21\u00b0', '4\u00b0']));
  minute();
  const cells = decodeLine(h.sends[h.sends.length - 1].STATUS_LINE_3_UINT8);
  assert.deepEqual([cells[0].text, cells[2].text], ['4\u00b0', '21\u00b0'], 'each place its own location\'s');
});

test('the reads an answer makes again are one read too: both places changed while their one read was under way', () => {
  const h = bootTwoPlaces();
  h.complications = [Object.assign({}, CHARGE, { position: 0 }), Object.assign({}, CHARGE, { property: 'cell' })];
  pluginValueSource.complicationsChanged();
  assert.equal(h.pebble.subs.length, 1, 'the read under way is waited for');
  h.pebble.subs[0].push(weather(['21°', '4°']));
  assert.equal(h.pebble.subs.length, 2, 'then one read for both new readings');
  assert.deepEqual(h.pebble.subs[1].request, { category: 'phone', item: 'phone_state',
    properties: ['cell', 'battery_level'], limit: 1 });
});

test('a read that throws holds up no read of another item: it is made, and the throw goes on after it', () => {
  const OTHER = 'ffffffff-0000-0000-0000-000000000001';
  const pebble = fakePebble();
  let fails = 1;
  const timers = {
    setTimeout: () => { if (fails) { fails -= 1; throw new Error('no timer'); } return 1; },
    clearTimeout: () => {}
  };
  assert.throws(() => boot({ settings: Object.assign({}, SLOT, slot('statusTopRight', { plugin: OTHER, id: 'phone/phone_state/cell' })),
    pebble: pebble, timers: timers }), /no timer/);
  assert.deepEqual(pebble.subs.map((sub) => sub.request.plugin), [PHONE, OTHER], 'the other plugin is read all the same');
});

test('an answer that throws for one value reaches the other values of its read all the same', () => {
  const h = boot({ settings: LEVEL_AND_CELL });
  let fails = 1;
  Object.defineProperty(h, 'settings', {
    get: () => { if (fails) { fails -= 1; throw new Error('a mishap'); } return LEVEL_AND_CELL; }
  });
  assert.throws(() => h.pebble.subs[0].push(answer(BOTH)), /a mishap/);
  assert.equal(storedValue(CELL_KEY).reading.short, 'LTE', 'the network type is kept');
  h.clock = NOON + HOUR;
  minute();
  assert.equal(h.pebble.subs.length, 2);
  assert.deepEqual(h.pebble.subs[1].request.properties, ['battery_level', 'name', 'cell'],
    'neither waits for an answer any more');
});

test('an answer that throws for one value still makes at once the reads the others ask for', () => {
  const h = bootTwoPlaces();
  h.complications = [FIRST_PLACE, Object.assign({}, TEMPERATURE, { property: 'humidity' })];
  pluginValueSource.complicationsChanged();
  const pluginValues = require('../../../src/pkjs/status-bars/domain/plugin-values.js');
  const real = pluginValues.slotTextOf;
  pluginValues.slotTextOf = function (pick) {
    if (pick.id === 'preferences/complications/0') { throw new Error('a mishap'); }
    return real.apply(this, arguments);
  };
  try {
    assert.throws(() => h.pebble.subs[0].push(weather(['21\u00b0', '4\u00b0'])), /a mishap/);
  } finally {
    pluginValues.slotTextOf = real;
  }
  assert.equal(h.pebble.subs.length, 2, 'not a minute later');
  assert.ok(h.pebble.subs[1].request.properties.includes('humidity'), 'the second place\'s new reading');
});

test('a start keeps only the values of the sources a slot picks', () => {
  Object.keys(storage).forEach((k) => { delete storage[k]; });
  const kept = { source: KEY, reading: reading({ short: '87%' }), at: NOON - 10 * MIN, validUntil: null };
  const gone = { source: CELL_KEY, reading: reading({ short: 'LTE' }), at: NOON - 10 * MIN, validUntil: null };
  storage[KEYS.PLUGIN_VALUES] = JSON.stringify({ [KEY]: kept, [CELL_KEY]: gone });
  storage[KEYS.PLUGIN_VALUE_READS] = JSON.stringify({ [KEY]: { source: KEY, at: NOON - 10 * MIN, failures: 0, validUntil: null },
    [CELL_KEY]: { source: CELL_KEY, at: NOON - 10 * MIN, failures: 0, validUntil: null } });
  const h = boot({ keepStorage: true });
  assert.deepEqual(stored(KEYS.PLUGIN_VALUES), { [KEY]: kept });
  assert.deepEqual(Object.keys(stored(KEYS.PLUGIN_VALUE_READS)), [KEY]);
  assert.equal(h.pebble.subs.length, 0, 'not due');
  statusRebake.resendStatus('fetch');
  assert.equal(sentText(h), '87%', 'shown at once');
});

test('a value whose bar the watch is not sent for a while keeps its read and its value: shown again, it shows at once and is read when due', () => {
  const h = boot();
  h.pebble.subs[0].push(answer());
  minute();
  // The user's other watch, which shows no Plugin value slot (aplite), for ten minutes.
  h.watchInfo = { platform: 'aplite' };
  h.clock += 10 * MIN;
  minute();
  assert.equal(storedValue(KEY).reading.short, '87%', 'the value is kept');
  assert.equal(storedRead(KEY).at, NOON, 'and its read');
  h.watchInfo = { platform: 'basalt' };
  h.clock += 10 * MIN;
  minute();
  assert.equal(h.pebble.subs.length, 1, 'not read again before it is due');
  statusRebake.resendStatus('fetch');
  assert.equal(sentText(h), '87%', 'shown at once');
  h.clock = NOON + HOUR;
  minute();
  assert.equal(h.pebble.subs.length, 2, 'read when due');
});

test('a start on a watch that shows none of the slots keeps the values of the sources they pick', () => {
  Object.keys(storage).forEach((k) => { delete storage[k]; });
  const cell = { source: CELL_KEY, reading: reading({ short: 'LTE' }), at: NOON - 10 * MIN, validUntil: null };
  const cellRead = { source: CELL_KEY, at: NOON - 10 * MIN, failures: 0, validUntil: null };
  const value = { source: KEY, reading: reading({ short: '87%' }), at: NOON - 10 * MIN, validUntil: null };
  const record = { source: KEY, at: NOON - 10 * MIN, failures: 0, validUntil: null };
  storage[KEYS.PLUGIN_VALUES] = JSON.stringify({ [CELL_KEY]: cell });
  storage[KEYS.PLUGIN_VALUE_READS] = JSON.stringify({ [CELL_KEY]: cellRead });
  // As 3.4.0 kept it.
  storage[KEYS.PLUGIN_VALUE] = JSON.stringify(value);
  storage[KEYS.PLUGIN_VALUE_READ] = JSON.stringify(record);
  const h = boot({ keepStorage: true, watchInfo: { platform: 'aplite' },
    settings: LEVEL_AND_CELL });
  assert.equal(h.pebble.subs.length, 0, 'nothing is read for them');
  assert.deepEqual(stored(KEYS.PLUGIN_VALUES), { [CELL_KEY]: cell, [KEY]: value });
  assert.deepEqual(stored(KEYS.PLUGIN_VALUE_READS), { [CELL_KEY]: cellRead, [KEY]: record });
  assert.equal(storage[KEYS.PLUGIN_VALUE], undefined);
  assert.equal(storage[KEYS.PLUGIN_VALUE_READ], undefined);
});

test('the value kept before 3.5.0 moves to the slots that show its source, and shows at once', () => {
  Object.keys(storage).forEach((k) => { delete storage[k]; });
  const value = { source: KEY, reading: reading({ short: '87%' }), at: NOON - 10 * MIN, validUntil: null };
  const record = { source: KEY, at: NOON - 10 * MIN, failures: 0, validUntil: null };
  storage[KEYS.PLUGIN_VALUE] = JSON.stringify(value);
  storage[KEYS.PLUGIN_VALUE_READ] = JSON.stringify(record);
  const h = boot({ keepStorage: true, settings: Object.assign({}, SLOT, slot('statusTopMid')) });
  assert.equal(storage[KEYS.PLUGIN_VALUE], undefined);
  assert.equal(storage[KEYS.PLUGIN_VALUE_READ], undefined);
  assert.deepEqual(storedValue(KEY), value);
  assert.deepEqual(storedRead(KEY), record);
  assert.equal(h.pebble.subs.length, 0, 'its read moved with it: not due');
  statusRebake.resendStatus('fetch');
  const slots = decodeLine(h.sends[h.sends.length - 1].STATUS_LINE_3_UINT8);
  assert.deepEqual([slots[0].text, slots[1].text], ['87%', '87%']);
});

test('the value kept before 3.5.0 of a source no slot picks goes, and so does a read without a value', () => {
  [[{ source: CELL_KEY, reading: reading({ short: 'LTE' }), at: NOON, validUntil: null },
    { source: CELL_KEY, at: NOON, failures: 0, validUntil: null }, 'another source'],
  [null, { source: KEY, at: NOON - 10 * MIN, failures: 2, validUntil: null }, 'a read alone']].forEach(([value, record, why]) => {
    Object.keys(storage).forEach((k) => { delete storage[k]; });
    if (value) { storage[KEYS.PLUGIN_VALUE] = JSON.stringify(value); }
    storage[KEYS.PLUGIN_VALUE_READ] = JSON.stringify(record);
    const h = boot({ keepStorage: true });
    assert.equal(storage[KEYS.PLUGIN_VALUE], undefined, why);
    assert.equal(storage[KEYS.PLUGIN_VALUE_READ], undefined, why);
    assert.equal(storedValue(CELL_KEY), null, why);
    assert.equal(h.pebble.subs.length, 1, why + ': the slot\'s own source is read at once');
  });
});

test('the value kept before 3.5.0 goes even where it does not parse', () => {
  Object.keys(storage).forEach((k) => { delete storage[k]; });
  storage[KEYS.PLUGIN_VALUE] = '{"source": ';
  storage[KEYS.PLUGIN_VALUE_READ] = 'nope';
  boot({ keepStorage: true });
  assert.equal(storage[KEYS.PLUGIN_VALUE], undefined);
  assert.equal(storage[KEYS.PLUGIN_VALUE_READ], undefined);
});

test('before init a bake asks the global Pebble whether plugins are read, and has no value yet', () => {
  const path = require.resolve('../../../src/pkjs/status-bars/adapter/plugin-value-source.js');
  const cached = require.cache[path];
  const had = Object.prototype.hasOwnProperty.call(global, 'Pebble');
  const realPebble = global.Pebble;
  delete require.cache[path];
  const fresh = require(path);
  require.cache[path] = cached;
  try {
    global.Pebble = fakePebble();
    assert.equal(fresh.bakeFacts().available, true, 'so its slots show --, not nothing');
    assert.equal(fresh.bakeFacts().valueOf({ key: KEY }), null);
    global.Pebble = {};
    assert.equal(fresh.bakeFacts().available, false);
  } finally {
    if (had) { global.Pebble = realPebble; } else { delete global.Pebble; }
  }
});

// --- a complication ------------------------------------------------------------

/** The slot showing the user's second complication. */
const SECOND = slot('statusTopLeft', { plugin: PREFERENCES, id: 'preferences/complications/1' });
const SECOND_KEY = PREFERENCES + '/preferences/complications/1';
/** The user's complications: the temperature of their second weather location, and the phone's charge. */
const TEMPERATURE = { position: 1, category: 'weather', item: 'location', index: 1, property: 'temperature' };
/** The temperature of their first weather location, as their first complication. */
const FIRST_PLACE = Object.assign({}, TEMPERATURE, { position: 0, index: 0 });
/** The slot showing the user's first complication. */
const FIRST = slot('statusTopRight', { plugin: PREFERENCES, id: 'preferences/complications/0' });
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

/**
 * Boot with two slots, showing the user's first and second complications: the temperatures of
 * their first two weather locations.
 * @returns {Object} The boot's handle.
 */
function bootTwoPlaces() {
  return boot({ settings: Object.assign({}, SECOND, FIRST), complications: [FIRST_PLACE, TEMPERATURE],
    permissions: PERMS, pebble: fakePebble(PLUGINS) });
}

test('a complication: the reading it names, from whichever plugin serves its source, of the instance it names', () => {
  const h = boot({ settings: SECOND, complications: [TEMPERATURE], permissions: PERMS, pebble: fakePebble(PLUGINS) });
  assert.deepEqual(h.pebble.subs[0].request, { category: 'weather', item: 'location', properties: ['temperature'],
    limit: 2 }, 'no plugin named: the one the user prefers for it in the Pebble app answers');
  h.pebble.subs[0].push(weather(['21\u00b0', '4\u00b0']));
  assert.equal(storedValue(SECOND_KEY).source, SECOND_KEY + '/weather/location/1/temperature');
  assert.equal(storedValue(SECOND_KEY).reading.short, '4\u00b0', 'the second location\'s');
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
  assert.equal(pluginValueSource.forPage([CHARGE])[SECOND_KEY].reading.short, '87%');
  // The user moved the temperature to the second place in the Pebble app, and opens the
  // settings before the slot has read it.
  assert.deepEqual(pluginValueSource.forPage([TEMPERATURE]), {}, 'never as the temperature');
  assert.deepEqual(pluginValueSource.forPage([]), {}, 'nor once the place is empty');
  assert.deepEqual(pluginValueSource.forPage(null), {}, 'nor while the complications are not known');
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
  assert.equal(storedValue(SECOND_KEY), null);
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
  assert.equal(storedValue(SECOND_KEY), null, 'the phone\'s charge is not kept as the temperature');
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
  assert.equal(storedValue(SECOND_KEY), null, 'no reading is the place\'s now');
  assert.deepEqual(pluginValueSource.forPage(null), {});
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
  assert.equal(storedValue(SECOND_KEY), null);
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

test('words beside a moment give way to its date at the midnight after it', () => {
  const at = new Date(2026, 10, 21, 23, 10, 0).getTime();
  const h = bootUpdated(new Date(2026, 10, 21, 23, 30, 0).getTime());
  h.pebble.subs[0].push(answer({ updatedAt: { shortText: { text: 'Synced' }, numericValue: { value: at } } },
    { pluginUuid: 'm' }));
  minute();
  assert.equal(sentText(h), 'Synced', 'its own day: the words');
  const sends = h.sends.length;
  h.clock = new Date(2026, 10, 22, 0, 0, 0).getTime();
  minute();
  assert.equal(h.sends.length, sends + 1, 'the watch is owed the change');
  assert.equal(sentText(h), '21 Nov', 'the words would say the same of any day');
});

test('a pick of the Preferences plugin\'s own reading, which 3.4.0 listed, is never read: the value kept is dropped at once', () => {
  const pick = slot('statusTopLeft', { plugin: PREFERENCES, id: 'preferences/weather_location/latitude' });
  const key = PREFERENCES + '/preferences/weather_location/latitude';
  Object.keys(storage).forEach((k) => { delete storage[k]; });
  storage[KEYS.PLUGIN_VALUE] = JSON.stringify({ source: key, reading: reading({ short: '52.52', number: 52.52 }),
    at: NOON - 10 * MIN, validUntil: null });
  storage[KEYS.PLUGIN_VALUE_READ] = JSON.stringify({ source: key, at: NOON - 10 * MIN, failures: 0, validUntil: null });
  const h = boot({ keepStorage: true, settings: pick, permissions: PERMS, pebble: fakePebble([preferencesPlugin([{
    category: 'preferences', items: ['weather_location'], properties: { latitude: ['numericValue'] } }])]) });
  assert.equal(storedValue(key), null, 'the user\'s position, dropped as the slot starts');
  assert.equal(stored(KEYS.PLUGIN_VALUE), null, 'kept as before 3.5.0: moved, then dropped');
  statusRebake.resendStatus('fetch');
  assert.equal(sentText(h), '--');
  assert.deepEqual(pluginValueSource.forPage(null), {}, 'nor on the settings page');
  h.clock += 2 * HOUR;
  minute();
  pluginValueSource.refresh();
  assert.equal(h.pebble.subs.length, 0, 'never asked');
});

test('a pick of what is no value to show, which the Value row no longer lists, is never read and shows --', () => {
  const h = boot({ settings: slot('statusTopLeft', { plugin: PHONE, id: 'phone/phone_state/network_code' }),
    permissions: PERMS, pebble: fakePebble([{ uuid: PHONE, name: 'Phone', sources: [{ category: 'phone',
      items: ['phone_state'], properties: { network_code: ['shortText'] } }] }]) });
  h.clock += 2 * HOUR;
  minute();
  pluginValueSource.refresh();
  assert.equal(h.pebble.subs.length, 0, 'never asked');
  statusRebake.resendStatus('fetch');
  assert.equal(sentText(h), '--');
});

test('a value of a plugin\'s own that asks for a permission this app never declared is not read either', () => {
  const h = boot({ permissions: PERMS, pebble: fakePebble([{ uuid: PHONE, name: 'Phone', sources: [{ category: 'phone',
    items: ['phone_state'], callerPermissions: ['Contacts'] }] }]) });
  assert.equal(h.pebble.subs.length, 0);
});
