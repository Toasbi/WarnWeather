'use strict';
const { withHost } = require('../../helpers/rebake-host.js');
const { heldTimers } = require('../../helpers/plugin-host.js');
// status-rebake.js' own contract, apart from its phone-battery trigger (whose
// micro-send tests live in status-rebake-battery.test.js): the resend reports back
// through exactly one callback, which is what lets the config close chain the
// forced fetch behind it on the half-duplex channel.
const test = require('node:test');
const assert = require('node:assert/strict');

// AGENTS.md: the storage mock goes in BEFORE the watch modules load.
let storage = {};
global.localStorage = {
  getItem(k) { return Object.prototype.hasOwnProperty.call(storage, k) ? storage[k] : null; },
  setItem(k, v) { storage[k] = String(v); },
  removeItem(k) { delete storage[k]; }
};

const statusRebake = require('../../../src/pkjs/status-bars/application/status-rebake.js');

const realLog = console.log;
test.before(() => { console.log = function () {}; });
test.after(() => { console.log = realLog; delete global.Pebble; });

/**
 * A resend's callbacks, recorded in the order they ran.
 * @returns {{log: string[], ok: Function, fail: Function}} Recorder.
 */
function callbacks() {
  const log = [];
  return { log, ok: () => log.push('ok'), fail: () => log.push('fail') };
}

/** A fake baker that writes the six status keys. */
function fakeBake(payload) {
  ['STATUS_LINE_1_UINT8', 'STATUS_LINE_2_UINT8', 'STATUS_LINE_3_UINT8',
   'STATUS_LINE_4_UINT8'].forEach((k, i) => { payload[k] = [i]; });
  payload.STATUS_LEVELS_UINT8 = [0, 0];
  payload.ALERT_ENTRIES_UINT8 = [];
  return payload;
}

test('no snapshot to re-bake: onSuccess runs at once and nothing is sent', () => {
  storage = {};
  const sends = [];
  statusRebake.init(withHost({ getSettings: () => ({}), sendWeather: (p) => sends.push(p) }));
  const cb = callbacks();
  assert.equal(statusRebake.resendStatus('test', cb.ok, cb.fail), false);
  assert.deepEqual(cb.log, ['ok'], 'a caller chained behind the resend is never stranded');
  assert.equal(sends.length, 0);
});

test('no settings supplier: onSuccess runs at once and nothing is sent', () => {
  storage = {};
  const sends = [];
  statusRebake.init(withHost({ sendWeather: (p) => sends.push(p), buildStatusLines: fakeBake }));
  statusRebake.rememberBakeInputs({ CITY: 'Bonn' }, null);
  const cb = callbacks();
  statusRebake.resendStatus('test', cb.ok, cb.fail);
  assert.deepEqual(cb.log, ['ok']);
  assert.equal(sends.length, 0);
});

test('the outbox\'s callbacks are forwarded: ACK runs onSuccess, NACK onFailure', () => {
  storage = {};
  const sends = [];
  statusRebake.init(withHost({
    getSettings: () => ({}),
    buildStatusLines: fakeBake,
    sendWeather: (p, onSuccess, onFailure) => sends.push({ p, onSuccess, onFailure })
  }));
  statusRebake.rememberBakeInputs({ CITY: 'Bonn' }, null);
  const cb = callbacks();
  assert.equal(statusRebake.resendStatus('test', cb.ok, cb.fail), true);
  assert.deepEqual(cb.log, [], 'nothing runs before the watch answers');
  sends[0].onSuccess();
  statusRebake.resendStatus('test', cb.ok, cb.fail);
  sends[1].onFailure({});
  assert.deepEqual(cb.log, ['ok', 'fail']);
});

test('a bake that throws runs onSuccess and sends nothing: nothing went out, so nothing failed', () => {
  storage = {};
  const sends = [];
  statusRebake.init(withHost({
    getSettings: () => ({}),
    buildStatusLines: () => { throw new Error('boom'); },
    sendWeather: (p) => sends.push(p)
  }));
  statusRebake.rememberBakeInputs({ CITY: 'Bonn' }, null);
  const cb = callbacks();
  assert.doesNotThrow(() => statusRebake.resendStatus('test', cb.ok, cb.fail));
  assert.deepEqual(cb.log, ['ok'], 'the chain behind it still runs');
  assert.equal(sends.length, 0);
});

test('through the real outbox: an unchanged status category skips the send and succeeds at once', () => {
  storage = {};
  const appMessages = [];
  global.Pebble = {
    sendAppMessage: (dict, ack) => { appMessages.push(dict); ack({}); }
  };
  statusRebake.init(withHost({ getSettings: () => ({}), buildStatusLines: fakeBake,
    sendWeather: require('../../../src/pkjs/wire/adapter/outbox.js').sendWeather }));
  statusRebake.rememberBakeInputs({ CITY: 'Bonn' }, null);
  const cb = callbacks();
  statusRebake.resendStatus('first', cb.ok, cb.fail);
  statusRebake.resendStatus('again', cb.ok, cb.fail);
  assert.equal(appMessages.length, 1, 'the second, byte-identical re-bake stays off the air');
  assert.deepEqual(cb.log, ['ok', 'ok']);
});

// An alert that looks ahead judges tomorrow's peak (the day-max kinds' *_DAY_PEAKS)
// and tomorrow's pollen band (POLLEN_TOMORROW). Both ride the flash backstop, so a
// Days or mark change re-bakes after a PKJS restart with no fetch at all.
test('the backstop keeps what alerts look ahead to: a restart re-bakes Days and marks offline', () => {
  const { decodeAlerts } = require('../../helpers/alert-entries.js');
  storage = {};
  let live = require('../../helpers/on-demand.js').placedOnly(['uv', 'pollen'],
    { alertUvDisplay: 'icon', alertPollenDisplay: 'value' });
  statusRebake.init(withHost({ getSettings: () => live, sendWeather: () => {} }));
  statusRebake.rememberBakeInputs({
    CITY: 'Bonn', UV_TREND_UINT8: [20], UV_DAY_PEAKS: [30, 90, 0],
    POLLEN_TODAY: '1', POLLEN_TOMORROW: '3'
  }, null);
  const KEYS = require('../../../src/pkjs/settings/domain/storage-keys.js');
  const stored = JSON.parse(storage[KEYS.PHONE_BATTERY_SNAPSHOT]).payload;
  assert.deepEqual(stored.UV_DAY_PEAKS, [30, 90, 0], 'tomorrow\'s UV peak is in the backstop');
  assert.equal(stored.POLLEN_TOMORROW, '3', 'and tomorrow\'s pollen band');

  // A restart: the in-memory inputs are gone, the backstop answers.
  const sends = [];
  statusRebake.init(withHost({ getSettings: () => live, sendWeather: (p) => sends.push(p) }));
  statusRebake.resendStatus('restart');
  assert.deepEqual(decodeAlerts(sends[0].ALERT_ENTRIES_UINT8).map((e) => [e.kind, e.level, e.mark, e.value]),
    [[7, 2, 'raquo', ''], [1, 2, 'raquo', '3']], 'UV and pollen alert for tomorrow, both at danger');

  live = Object.assign({}, live, { alertPollenDays: 'today', alertUvNextDayMark: 'gt' });
  statusRebake.resendStatus('config-close');
  assert.deepEqual(decodeAlerts(sends[1].ALERT_ENTRIES_UINT8).map((e) => [e.kind, e.level, e.mark, e.value]),
    [[7, 2, 'gt', '']], 'pollen back to today only; UV marked >');
});

// Sunrise and sunset re-bake the status without a fetch, so the weather condition's and
// the city's icon turn between sun and moon (onTick, on the scheduler's minute tick).
function sunEvents(startType, first, second) {
  const bytes = [startType];
  [first, second].forEach((epoch) => {
    for (let i = 0; i < 4; i += 1) { bytes.push((epoch >>> (8 * i)) & 0xFF); }
  });
  return bytes;
}

test('onTick re-bakes once at sunset and once at sunrise, and not in between', () => {
  storage = {};
  const T = 1700000000;
  const SUNSET = T + 3600;
  const SUNRISE = T + 13 * 3600;
  let now = T * 1000;
  const sends = [];
  statusRebake.init(withHost({ getSettings: () => ({}), sendWeather: (p) => sends.push(p),
    buildStatusLines: fakeBake, now: () => now }));
  assert.equal(statusRebake.onTick(), false, 'no snapshot yet: nothing to re-bake');
  statusRebake.rememberBakeInputs({ SUN_EVENTS: sunEvents(1, SUNSET, SUNRISE) }, null);
  assert.equal(statusRebake.onTick(), false, 'still the day the fetch baked');
  now = (SUNSET - 1) * 1000;
  assert.equal(statusRebake.onTick(), false);
  now = SUNSET * 1000;
  assert.equal(statusRebake.onTick(), true, 'sunset');
  assert.equal(sends.length, 1);
  now = (SUNSET + 600) * 1000;
  assert.equal(statusRebake.onTick(), false, 'once per sunset');
  now = SUNRISE * 1000;
  assert.equal(statusRebake.onTick(), true, 'sunrise');
  assert.equal(sends.length, 2);
});

test('onTick after a restart sends nothing until the next sunset', () => {
  storage = {};
  const T = 1700000000;
  const sends = [];
  let now = T * 1000;
  const opts = { getSettings: () => ({}), sendWeather: (p) => sends.push(p),
    buildStatusLines: fakeBake, now: () => now };
  statusRebake.init(withHost(opts));
  statusRebake.rememberBakeInputs({ SUN_EVENTS: sunEvents(1, T + 3600, T + 13 * 3600) }, null);
  statusRebake.init(withHost(opts));   // PKJS restarted
  assert.equal(statusRebake.onTick(), false, 'no resend of the old snapshot on the return');
  now = (T + 3600) * 1000;
  assert.equal(statusRebake.onTick(), true, 'the sunset still turns it');
  assert.equal(sends.length, 1);
});

test('a resend for another reason counts as the bake of its side of sunset', () => {
  storage = {};
  const T = 1700000000;
  let now = T * 1000;
  const sends = [];
  statusRebake.init(withHost({ getSettings: () => ({}), sendWeather: (p) => sends.push(p),
    buildStatusLines: fakeBake, now: () => now }));
  statusRebake.rememberBakeInputs({ SUN_EVENTS: sunEvents(1, T + 3600, T + 13 * 3600) }, null);
  now = (T + 7200) * 1000;
  statusRebake.resendStatus('level');
  assert.equal(statusRebake.onTick(), false, 'the level resend already baked the night');
  assert.equal(sends.length, 1);
});

test('the battery saver: no sunrise or sunset re-bake inside its window; the first tick after sends', () => {
  storage = {};
  const at = (h, m) => new Date(2026, 5, 16, h, m).getTime();
  const SUNRISE = at(4, 45) / 1000;
  const SUNSET = at(21, 30) / 1000;
  let now = at(0, 30);
  const sends = [];
  const settings = { sleepNightEnabled: true, sleepStartHour: '0', sleepEndHour: '7' };
  statusRebake.init(withHost({ getSettings: () => settings, sendWeather: (p) => sends.push(p),
    buildStatusLines: fakeBake, now: () => now }));
  statusRebake.rememberBakeInputs({ SUN_EVENTS: sunEvents(0, SUNRISE, SUNSET) }, null);
  now = SUNRISE * 1000;
  assert.equal(statusRebake.onTick(false), false, 'sunrise inside [0, 7): nothing goes out');
  now = at(6, 59);
  assert.equal(statusRebake.onTick(false), false);
  assert.equal(sends.length, 0);
  now = at(7, 0);
  assert.equal(statusRebake.onTick(false), true, 'the window over, the day shows');
  assert.equal(sends.length, 1);
  assert.equal(statusRebake.onTick(false), false, 'once');
  now = SUNSET * 1000;
  assert.equal(statusRebake.onTick(false), true, 'a sunset outside the window turns it at once');
});

test('a tick with a fetch in flight leaves the sunset to that fetch\'s bake', () => {
  storage = {};
  const T = 1700000000;
  const SUNSET = T + 3600;
  let now = T * 1000;
  const sends = [];
  statusRebake.init(withHost({ getSettings: () => ({}), sendWeather: (p) => sends.push(p),
    buildStatusLines: fakeBake, now: () => now }));
  const payload = { SUN_EVENTS: sunEvents(1, SUNSET, T + 13 * 3600) };
  statusRebake.rememberBakeInputs(payload, null);
  now = SUNSET * 1000;
  assert.equal(statusRebake.onTick(true), false, 'the fetch in flight bakes the night');
  assert.equal(sends.length, 0);
  statusRebake.rememberBakeInputs(payload, null, new Date(now));   // ...and it did
  assert.equal(statusRebake.onTick(false), false, 'nothing left to turn');
  // A fetch that never bakes (it failed) leaves it to the next tick without one.
  now = (T + 13 * 3600) * 1000;
  assert.equal(statusRebake.onTick(true), false);
  assert.equal(statusRebake.onTick(false), true, 'the next tick turns it');
  assert.equal(sends.length, 1);
});

// The sun and moon slots worked out on the phone turn by themselves: at a dawn or dusk, and at
// midnight for the day length and the moon (status-lines.js skyTurnAt). The moon needs no place,
// so these run on the moon alone and turn at the phone's own midnight, whatever its zone.
const MOON_SETTINGS = { statusTopMid: 'moon' };
const BASALT = { platform: 'basalt' };

/**
 * @param {number} d A day of November 2026. @param {number} h Its hour. @param {number} m Its minute.
 * @returns {number} That local time, in epoch ms.
 */
function nov(d, h, m) {
  return new Date(2026, 10, d, h, m).getTime();
}

/**
 * Run `work` with console.log recording the re-bake's sends' reasons.
 * @param {Function} work What to run.
 * @returns {string[]} The reasons of the micro-sends it made.
 */
function sendReasons(work) {
  const reasons = [];
  const quiet = console.log;
  console.log = (line) => {
    const m = /status micro-send \((.*)\)/.exec(String(line));
    if (m) { reasons.push(m[1]); }
  };
  try { work(); } finally { console.log = quiet; }
  return reasons;
}

test('a sun and moon slot re-bakes at its turn, once, as a sky turn', () => {
  storage = {};
  let now = nov(28, 20, 0);
  const sends = [];
  const reasons = sendReasons(() => {
    statusRebake.init(withHost({ getSettings: () => MOON_SETTINGS, sendWeather: (p) => sends.push(p),
      buildStatusLines: fakeBake, now: () => now }));
    statusRebake.rememberBakeInputs({ CITY: 'Bonn' }, BASALT);
    assert.equal(statusRebake.onTick(), false, 'the evening the fetch baked');
    now = nov(28, 23, 59);
    assert.equal(statusRebake.onTick(), false);
    now = nov(29, 0, 0);
    assert.equal(statusRebake.onTick(), true, 'midnight: the new day\'s moon');
    now = nov(29, 0, 1);
    assert.equal(statusRebake.onTick(), false, 'once a midnight');
    now = nov(30, 0, 0);
    assert.equal(statusRebake.onTick(), true, 'and the next one');
  });
  assert.equal(sends.length, 2);
  assert.deepEqual(reasons, ['sky', 'sky']);
});

test('without a sun and moon slot nothing turns at midnight', () => {
  storage = {};
  let now = nov(28, 20, 0);
  const sends = [];
  statusRebake.init(withHost({ getSettings: () => ({ statusTopMid: 'sun' }), sendWeather: (p) => sends.push(p),
    buildStatusLines: fakeBake, now: () => now }));
  statusRebake.rememberBakeInputs({ CITY: 'Bonn' }, BASALT);
  now = nov(29, 0, 0);
  assert.equal(statusRebake.onTick(), false);
  assert.equal(sends.length, 0);
});

test('the battery saver: a sky turn inside its window waits for the window\'s end', () => {
  storage = {};
  let now = nov(28, 20, 0);
  const sends = [];
  const settings = Object.assign({ sleepNightEnabled: true, sleepStartHour: '0', sleepEndHour: '7' }, MOON_SETTINGS);
  statusRebake.init(withHost({ getSettings: () => settings, sendWeather: (p) => sends.push(p),
    buildStatusLines: fakeBake, now: () => now }));
  statusRebake.rememberBakeInputs({ CITY: 'Bonn' }, BASALT);
  now = nov(29, 0, 0);
  assert.equal(statusRebake.onTick(false), false, 'midnight inside [0, 7): nothing goes out');
  now = nov(29, 6, 59);
  assert.equal(statusRebake.onTick(false), false);
  now = nov(29, 7, 0);
  assert.equal(statusRebake.onTick(false), true, 'the window over, the new day\'s moon shows');
  assert.equal(statusRebake.onTick(false), false, 'once');
  assert.equal(sends.length, 1);
});

test('a fetch in flight at a sky turn bakes it; a resend for another reason latches the next one', () => {
  storage = {};
  let now = nov(28, 20, 0);
  const sends = [];
  statusRebake.init(withHost({ getSettings: () => MOON_SETTINGS, sendWeather: (p) => sends.push(p),
    buildStatusLines: fakeBake, now: () => now }));
  statusRebake.rememberBakeInputs({ CITY: 'Bonn' }, BASALT);
  now = nov(29, 0, 0);
  assert.equal(statusRebake.onTick(true), false, 'the fetch in flight bakes the new day');
  statusRebake.rememberBakeInputs({ CITY: 'Bonn' }, BASALT, new Date(now));   // ...and it did
  assert.equal(statusRebake.onTick(false), false, 'nothing left to turn');
  now = nov(30, 0, 5);
  statusRebake.resendStatus('config-close');
  assert.equal(sends.length, 1);
  assert.equal(statusRebake.onTick(false), false, 'the save\'s resend baked the new day');
  assert.equal(sends.length, 1);
});

test('a sky turn whose re-bake throws is not tried again every minute', () => {
  storage = {};
  let now = nov(28, 20, 0);
  let bakes = 0;
  statusRebake.init(withHost({ getSettings: () => MOON_SETTINGS, sendWeather: () => {},
    buildStatusLines: () => { bakes += 1; throw new Error('boom'); }, now: () => now }));
  statusRebake.rememberBakeInputs({ CITY: 'Bonn' }, BASALT);
  now = nov(29, 0, 0);
  assert.equal(statusRebake.onTick(), false, 'nothing went out');
  now = nov(29, 0, 1);
  statusRebake.onTick();
  now = nov(29, 0, 2);
  statusRebake.onTick();
  assert.equal(bakes, 1, 'it would throw again: the turn is spent');
});

test('after a restart the first tick counts as the sky\'s bake; the next turn re-bakes', () => {
  storage = {};
  let now = nov(28, 20, 0);
  const sends = [];
  const opts = { getSettings: () => MOON_SETTINGS, sendWeather: (p) => sends.push(p),
    buildStatusLines: fakeBake, now: () => now };
  statusRebake.init(withHost(opts));
  statusRebake.rememberBakeInputs({ CITY: 'Bonn' }, BASALT);
  now = nov(29, 0, 30);
  statusRebake.init(withHost(opts));   // PKJS restarted, past the turn its last life latched
  assert.equal(statusRebake.onTick(), false, 'no resend of the old snapshot on the return');
  now = nov(30, 0, 0);
  assert.equal(statusRebake.onTick(), true, 'the next midnight turns it');
  assert.equal(sends.length, 1);
});

test('the scheduler\'s minute tick runs the re-bake\'s, told whether a fetch is in flight', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', '..', '../src/pkjs/index.js'), 'utf8');
  const body = src.slice(src.indexOf('function onSchedulerTick() {'));
  const tick = body.slice(0, body.indexOf('\n}'));
  assert.ok(tick.indexOf('statusRebake.onTick(fetchCycle.isInFlight());') > 0);
});

test('index.js hands the re-bake the host\'s timer and the channel\'s state, which a debt paid early needs', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', '..', '../src/pkjs/index.js'), 'utf8');
  const call = src.slice(src.indexOf('statusRebake.init({'));
  const options = call.slice(0, call.indexOf('});'));
  // Without them paySoon falls back to the tick without a word: a value picked would wait up
  // to a minute again, with every test of the re-bake still green.
  ['setTimeout: hostSetTimeout', 'fetchInFlight: fetchCycle.isInFlight', 'sendsInFlight: outbox.sendsInFlight']
    .forEach((wired) => { assert.ok(options.indexOf(wired) > 0, wired); });
});

test('index.js composes the batteries\', the Plugin value\'s and the sky\'s facts once: the fetch\'s bake, the re-bake\'s and the fixture\'s read the same', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', '..', '../src/pkjs/index.js'), 'utf8');
  // The sky's place is the one the automatic theme reads (themeCoords), read only when a bake asks.
  assert.match(src, /function bakeFacts\(\) \{\n    return \{ phone: phoneBattery\.bakeFacts\(\), watch: batteryEstimate\.bakeFacts\(\),\n        plugin: pluginValueSource\.bakeFacts\(\), sky: \{ position: themeCoords \} \};\n\}/);
  assert.equal((src.match(/getBakeFacts: bakeFacts,/g) || []).length, 2, 'the fetch cycle and the re-bake');
  assert.ok(src.indexOf('facts: bakeFacts() });') > 0, 'the fixture send');
});

test('a re-bake reads the supplier\'s facts, the phone\'s replaced where the caller brings its own', () => {
  storage = {};
  const seen = [];
  const supplied = { phone: { supported: true }, watch: { estimate: () => null } };
  statusRebake.init(withHost({ getSettings: () => ({}), sendWeather: () => {}, getBakeFacts: () => supplied,
    buildStatusLines: (payload, settings, watchInfo, now, facts) => { seen.push(facts); return fakeBake(payload); } }));
  statusRebake.rememberBakeInputs({ CITY: 'Bonn' }, null);
  statusRebake.resendStatus('test');
  assert.equal(seen[0], supplied, 'as supplied');
  const exact = { supported: true, reading: () => ({ available: true, level: 62 }) };
  statusRebake.bakeStatus(exact);
  assert.equal(seen[1].phone, exact, 'the ride-along\'s exact reading');
  assert.equal(seen[1].watch, supplied.watch, 'beside the watch battery\'s, untouched');
  assert.equal(supplied.phone.reading, undefined, 'and the supplier\'s object is not written to');

  // A host that supplies none: the bake is handed null, or the caller's phone alone.
  statusRebake.init(withHost({ getSettings: () => ({}), sendWeather: () => {},
    buildStatusLines: (payload, settings, watchInfo, now, facts) => { seen.push(facts); return fakeBake(payload); } }));
  statusRebake.rememberBakeInputs({ CITY: 'Bonn' }, null);
  statusRebake.resendStatus('test');
  assert.equal(seen[2], null);
  statusRebake.bakeStatus(exact);
  assert.deepEqual(Object.keys(seen[3]), ['phone']);
});

// --- News that can wait for the morning (resendStatusAwake) -------------------
// A battery reading that moved is sent at once by day. Inside the Night battery saver's
// window its send is owed, and the first tick after the window pays it.

/**
 * A re-baker with bake inputs, at a clock the test moves, under the saver's 0:00-07:00 window.
 * @param {Object} [settings] Settings (the saver on by default).
 * @param {function(Object, Object, Object, number, Object): Object} [build] The bake (fakeBake by default).
 * @param {Object} [host] More of the host's options (its timer, the fetch's state).
 * @returns {{sends: Object[], answers: Array<{onSuccess: function(): void, onFailure: function(Object): void}>,
 *   at: function(number, number): void}} What was sent, each send's outbox callbacks, and the clock's setter.
 */
function bootSaver(settings, build, host) {
  storage = {};
  // sends: what went out; answers: each send's outbox callbacks, to ACK or NACK it.
  const h = { sends: [], answers: [], now: 0 };
  h.at = (hour, minute) => { h.now = new Date(2026, 5, 16, hour, minute).getTime(); };
  h.at(12, 0);
  statusRebake.init(withHost(Object.assign({
    getSettings: () => settings || { sleepNightEnabled: true, sleepStartHour: '0', sleepEndHour: '7' },
    sendWeather: (p, onSuccess, onFailure) => { h.answers.push({ onSuccess, onFailure }); h.sends.push(p); },
    buildStatusLines: build || fakeBake, now: () => h.now }, host)));
  // Baked at noon, with no sun events: no day/night turn of its own in these tests.
  statusRebake.rememberBakeInputs({ CITY: 'Bonn' }, null, new Date(h.now));
  return h;
}

test('resendStatusAwake sends at once outside the saver window, after its step', () => {
  const h = bootSaver();
  const order = [];
  h.sends.push = (p) => { order.push('send'); return Array.prototype.push.call(h.sends, p); };
  assert.equal(statusRebake.resendStatusAwake('level', () => order.push('step')), true);
  assert.deepEqual(order, ['step', 'send'], 'the step runs before the bake that is sent');
  assert.equal(statusRebake.onTick(false), false, 'nothing is owed afterwards');
  assert.equal(h.sends.length, 1);
});

test('inside the saver window the send is owed: no step, no send, until the first tick after it', () => {
  const h = bootSaver();
  let steps = 0;
  const step = () => { steps += 1; };
  h.at(3, 0);
  assert.equal(statusRebake.resendStatusAwake('level', step), false);
  assert.equal(statusRebake.resendStatusAwake('level', step), false, 'a second move inside the window');
  assert.equal(h.sends.length, 0, 'no wake-up for a readout overnight');
  assert.equal(steps, 0, 'and its step waits with it');
  h.at(6, 59);
  assert.equal(statusRebake.onTick(false), false, 'still inside [0, 7)');
  h.at(7, 0);
  assert.equal(statusRebake.onTick(true), false, 'not beside a fetch in flight, whose message carries the status');
  assert.equal(h.sends.length, 0);
  assert.equal(statusRebake.onTick(false), true, 'the next tick pays it');
  assert.equal(h.sends.length, 1, 'one send');
  assert.equal(steps, 1, 'a trigger\'s step runs once, however often it owed');
  assert.equal(statusRebake.onTick(false), false, 'once');
  assert.equal(h.sends.length, 1);
});

test('one send pays every trigger: the steps of all, in the order they came to owe', () => {
  const h = bootSaver();
  const ran = [];
  h.at(3, 0);
  statusRebake.resendStatusAwake('level', () => ran.push('phone'));
  statusRebake.resendStatusAwake('battery-days');   // a trigger without a step owes a send too
  h.at(7, 30);
  // A reading that moves after the window, before the tick: its send carries what was owed.
  assert.equal(statusRebake.resendStatusAwake('other', () => ran.push('other')), true);
  assert.deepEqual(ran, ['phone', 'other']);
  assert.equal(h.sends.length, 1);
  assert.equal(statusRebake.onTick(false), false, 'the debt went with it');
});

test('a trigger without a step owes a send all the same; with the saver off nothing is ever owed', () => {
  const h = bootSaver();
  h.at(3, 0);
  assert.equal(statusRebake.resendStatusAwake('battery-days'), false);
  h.at(7, 0);
  assert.equal(statusRebake.onTick(false), true);
  assert.equal(h.sends.length, 1);

  const off = bootSaver({ sleepNightEnabled: false });
  off.at(3, 0);
  assert.equal(statusRebake.resendStatusAwake('battery-days'), true, '03:00 with the saver off is an ordinary minute');
  assert.equal(off.sends.length, 1);
});

test('oweStatus sends nothing now, by day or by night: the next tick that may send pays it', () => {
  const h = bootSaver();
  statusRebake.oweStatus(false);
  statusRebake.oweStatus(false);
  assert.equal(h.sends.length, 0, 'noon, outside the window: still not sent from here');
  assert.equal(statusRebake.onTick(true), false, 'not beside a fetch in flight');
  assert.equal(h.sends.length, 0);
  assert.equal(statusRebake.onTick(false), true);
  assert.equal(h.sends.length, 1, 'one send for both');
  assert.equal(statusRebake.onTick(false), false, 'once');

  h.at(3, 0);
  statusRebake.oweStatus(false);
  assert.equal(statusRebake.onTick(false), false, 'inside the saver window it waits, as any owed send');
  h.at(7, 0);
  assert.equal(statusRebake.onTick(false), true);
  assert.equal(h.sends.length, 2);
});

test('a debt the user waits for at the phone is paid inside the window, at the next tick', () => {
  const h = bootSaver();
  h.at(3, 0);
  statusRebake.oweStatus(true);
  assert.equal(h.sends.length, 0, 'never sent from here');
  assert.equal(statusRebake.onTick(true), false, 'not beside a fetch in flight');
  assert.equal(statusRebake.onTick(false), true, 'inside the window: a save asked for it');
  assert.equal(h.sends.length, 1);
  statusRebake.oweStatus(false);
  assert.equal(statusRebake.onTick(false), false, 'paid, the window holds the next debt again');
  statusRebake.oweStatus(true);
  assert.equal(statusRebake.onTick(false), true, 'one waited for pays the others with it');
  assert.equal(h.sends.length, 2);
  assert.equal(statusRebake.onTick(false), false, 'once');
});

/**
 * bootSaver with the host's timer, whose callbacks the test fires by hand.
 * @param {{fetchInFlight: (function(): boolean|undefined), sendsInFlight: (function(): number|undefined)}} [host]
 *   Whether a weather fetch is running, and how many sends wait for the watch's answer.
 * @returns {Object} bootSaver's harness, and timers: each timer's callback and delay.
 */
function bootSoon(host) {
  const timers = [];
  const h = bootSaver(null, null, Object.assign(heldTimers(timers), host));
  h.timers = timers;
  return h;
}

test('a debt the user waits for at the phone is paid a moment after it is owed, not at the next tick', () => {
  const h = bootSoon();
  statusRebake.oweStatus(true);
  statusRebake.oweStatus(true);
  assert.equal(h.sends.length, 0, 'not from here: the save\'s own messages go first');
  assert.deepEqual(h.timers.map((t) => t.ms), [statusRebake.OWED_SOON_MS], 'one timer for both');
  assert.ok(statusRebake.OWED_SOON_MS <= 5000, 'seconds, where the tick can take a minute');
  h.timers[0].fn();
  assert.equal(h.sends.length, 1, 'paid');
  assert.equal(statusRebake.onTick(false), false, 'the tick finds nothing owed');
  statusRebake.oweStatus(true);
  assert.equal(h.timers.length, 2, 'the next debt sets a timer of its own');
  h.at(3, 0);
  h.timers[1].fn();
  assert.equal(h.sends.length, 2, 'inside the Night battery saver\'s window too: a save asked for it');
});

test('news nobody waits for still waits for the tick; a fetch in flight or a NACK leaves a debt to it', () => {
  let fetching = true;
  const h = bootSoon({ fetchInFlight: () => fetching });
  statusRebake.oweStatus(false);
  assert.equal(h.timers.length, 0, 'no timer for news that can wait');
  statusRebake.oweStatus(true);
  h.timers[0].fn();
  assert.equal(h.sends.length, 0, 'not beside a fetch in flight, whose message carries the status');
  fetching = false;
  assert.equal(statusRebake.onTick(false), true, 'the tick pays it');
  h.answers[0].onFailure({});
  assert.equal(h.timers.length, 1, 'a NACK owes it again to the tick, at its backoff');
  assert.equal(statusRebake.onTick(false), true, 'sent again by the tick');
});

test('while the watch refuses sends, a debt the user waits for keeps to their backoff: the timer leaves it to the tick', () => {
  const h = bootSoon();
  statusRebake.oweStatus(false);
  assert.equal(statusRebake.onTick(false), true, 'minute 1');
  h.answers[0].onFailure({});
  assert.equal(statusRebake.onTick(false), true, 'minute 2');
  h.answers[1].onFailure({});
  statusRebake.oweStatus(true);
  h.timers[0].fn();
  assert.equal(h.sends.length, 2, 'not sent by the timer to a watch that refuses');
  assert.equal(statusRebake.onTick(false), false, 'minute 3: the backoff still waits, its step not taken by the timer');
  assert.equal(statusRebake.onTick(false), true, 'minute 4, as after any second NACK');
});

test('a debt paid early waits out a send still on the channel, then pays; a channel that stays busy leaves it to the tick', () => {
  let busy = 1;
  const h = bootSoon({ sendsInFlight: () => busy });
  statusRebake.oweStatus(true);
  h.timers[0].fn();
  assert.equal(h.sends.length, 0, 'not beside the save\'s own send, which waits for its answer');
  assert.equal(h.timers.length, 2, 'it waits again');
  busy = 0;
  h.timers[1].fn();
  assert.equal(h.sends.length, 1, 'the channel is free: paid');

  busy = 1;
  h.answers[0].onSuccess();
  statusRebake.oweStatus(true);
  const before = h.timers.length;
  for (let i = 0; i < statusRebake.OWED_SOON_TRIES; i++) { h.timers[h.timers.length - 1].fn(); }
  assert.equal(h.timers.length, before + statusRebake.OWED_SOON_TRIES - 1, 'a few waits, then no more');
  assert.equal(h.sends.length, 1, 'never sent beside the busy channel');
  busy = 0;
  assert.equal(statusRebake.onTick(false), true, 'the tick pays it');
});

test('a settings save\'s send pays a debt of no step, so the timer sends nothing twice; an answer after it is news of its own', () => {
  const h = bootSoon();
  statusRebake.oweStatus(true);   // the answer came before the save's own bake
  assert.equal(statusRebake.resendStatus('config-close'), true);
  h.timers[0].fn();
  assert.equal(h.sends.length, 1, 'the save\'s bake carried it: nothing sent again before its ACK');
  assert.equal(statusRebake.onTick(false), false, 'nor at the tick');
  h.answers[0].onSuccess();
  statusRebake.oweStatus(true);   // an answer after the save's bake is news of its own
  h.timers[1].fn();
  assert.equal(h.sends.length, 2);
});

test('a NACKed owed send is owed again, to the next tick, waited for as it was', () => {
  const h = bootSaver();
  statusRebake.oweStatus(false);
  assert.equal(statusRebake.onTick(false), true);
  h.answers[0].onFailure({ data: { transactionId: 1 } });
  assert.equal(statusRebake.onTick(false), true, 'sent again');
  h.answers[1].onSuccess();
  assert.equal(statusRebake.onTick(false), false, 'ACKed: paid');

  h.at(3, 0);
  statusRebake.oweStatus(true);
  assert.equal(statusRebake.onTick(false), true);
  h.answers[2].onFailure({ data: { transactionId: 2 } });
  assert.equal(statusRebake.onTick(false), true, 'inside the window still: the user waits for it');
  assert.equal(h.sends.length, 4);
});

test('a status send that keeps NACKing is resent after 1, 2, then every 4 minutes; an ACK ends it', () => {
  const h = bootSaver();
  statusRebake.oweStatus(false);
  const sentAt = [];
  for (let minute = 1; minute <= 16; minute++) {
    if (statusRebake.onTick(false)) {
      sentAt.push(minute);
      h.answers[h.answers.length - 1].onFailure({});
    }
  }
  assert.deepEqual(sentAt, [1, 2, 4, 8, 12, 16], 'the settings channel\'s backoff (nack-backoff.js)');
  for (let minute = 17; minute <= 19; minute++) { assert.equal(statusRebake.onTick(false), false); }
  assert.equal(statusRebake.onTick(false), true, 'minute 20');
  h.answers[h.answers.length - 1].onSuccess();
  assert.equal(statusRebake.onTick(false), false, 'ACKed: nothing is owed');
  statusRebake.oweStatus(false);
  assert.equal(statusRebake.onTick(false), true);
  h.answers[h.answers.length - 1].onFailure({});
  assert.equal(statusRebake.onTick(false), true, 'after an ACK, the next NACK is resent a minute later again');
});

test('a send the user waits for gets one retry inside the window: NACKed twice, it waits for the window to close', () => {
  const h = bootSaver();
  h.at(3, 0);
  statusRebake.oweStatus(true);
  assert.equal(statusRebake.onTick(false), true);
  h.answers[0].onFailure({});
  h.at(3, 1);
  assert.equal(statusRebake.onTick(false), true, 'one retry: the user waits for it');
  h.answers[1].onFailure({});
  for (let minute = 2; minute < 60; minute++) {
    h.at(3, minute);
    assert.equal(statusRebake.onTick(false), false, '03:' + minute);
  }
  assert.equal(h.sends.length, 2, 'a watch that keeps refusing is left alone for the night');
  h.at(7, 0);
  assert.equal(statusRebake.onTick(false), true, 'the first tick after the window pays it');
});

test('a settings save\'s status send the watch NACKs is owed again; the chain behind it goes on', () => {
  const h = bootSaver();
  const cb = callbacks();
  assert.equal(statusRebake.resendStatus('config-close', cb.ok, cb.fail), true);
  h.answers[0].onFailure({});
  assert.deepEqual(cb.log, ['fail'], 'the forced fetch queued behind it still runs');
  assert.equal(statusRebake.onTick(true), false, 'not beside that fetch, whose message carries the status');
  assert.equal(statusRebake.onTick(false), true, 'a failed fetch leaves it to the next tick');
  h.answers[1].onSuccess();
  assert.deepEqual(cb.log, ['fail'], 'the retry runs none of the save\'s callbacks');

  h.at(3, 0);
  statusRebake.resendStatus('config-close', cb.ok, cb.fail);
  h.answers[2].onFailure({});
  assert.equal(statusRebake.onTick(false), true, 'a save at night: the user waits for it, so it is retried there');
  h.answers[3].onFailure({});
  h.at(3, 5);
  assert.equal(statusRebake.onTick(false), false);
  h.at(3, 6);
  assert.equal(statusRebake.onTick(false), false, 'NACKed twice: left for the window\'s end');
});

test('an owed send whose bake throws is not owed again: it would throw again', () => {
  let broken = true;
  const h = bootSaver(null, (payload) => {
    if (broken) { throw new Error('broken bake'); }
    return fakeBake(payload);
  });
  statusRebake.oweStatus(false);
  assert.equal(statusRebake.onTick(false), false, 'nothing sent');
  broken = false;
  assert.equal(statusRebake.onTick(false), false, 'nothing owed: the next tick sends nothing');
  assert.equal(h.sends.length, 0);
});

test('a resend for another reason inside the window leaves the debt, and init forgets it', () => {
  const h = bootSaver();
  let steps = 0;
  h.at(3, 0);
  statusRebake.resendStatusAwake('level', () => { steps += 1; });
  // A settings save at night (the user is awake) re-bakes at once, without the owed step.
  assert.equal(statusRebake.resendStatus('config-close'), true);
  assert.equal(steps, 0);
  h.at(7, 0);
  assert.equal(statusRebake.onTick(false), true, 'still owed');
  assert.equal(steps, 1);

  const again = bootSaver();
  again.at(3, 0);
  statusRebake.resendStatusAwake('level');
  const fresh = bootSaver();   // a new PKJS life
  fresh.at(7, 0);
  assert.equal(statusRebake.onTick(false), false, 'a debt does not outlive its PKJS');
});

test('init without a clock is refused at once, not at the first tick', () => {
  assert.throws(() => statusRebake.init({ getSettings: () => ({}) }), /options\.now/);
  assert.throws(() => statusRebake.init(), /options\.now/);
});
