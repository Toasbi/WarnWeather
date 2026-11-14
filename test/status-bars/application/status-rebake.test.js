'use strict';
// status-rebake.js' own contract, apart from its phone-battery trigger (whose
// micro-send tests live in phone-battery.test.js): the resend reports back
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
  statusRebake.init({ getSettings: () => ({}), sendWeather: (p) => sends.push(p) });
  const cb = callbacks();
  assert.equal(statusRebake.resendStatus('test', cb.ok, cb.fail), false);
  assert.deepEqual(cb.log, ['ok'], 'a caller chained behind the resend is never stranded');
  assert.equal(sends.length, 0);
});

test('no settings supplier: onSuccess runs at once and nothing is sent', () => {
  storage = {};
  const sends = [];
  statusRebake.init({ sendWeather: (p) => sends.push(p), buildStatusLines: fakeBake });
  statusRebake.rememberBakeInputs({ CITY: 'Bonn' }, null);
  const cb = callbacks();
  statusRebake.resendStatus('test', cb.ok, cb.fail);
  assert.deepEqual(cb.log, ['ok']);
  assert.equal(sends.length, 0);
});

test('the outbox\'s callbacks are forwarded: ACK runs onSuccess, NACK onFailure', () => {
  storage = {};
  const sends = [];
  statusRebake.init({
    getSettings: () => ({}),
    buildStatusLines: fakeBake,
    sendWeather: (p, onSuccess, onFailure) => sends.push({ p, onSuccess, onFailure })
  });
  statusRebake.rememberBakeInputs({ CITY: 'Bonn' }, null);
  const cb = callbacks();
  assert.equal(statusRebake.resendStatus('test', cb.ok, cb.fail), true);
  assert.deepEqual(cb.log, [], 'nothing runs before the watch answers');
  sends[0].onSuccess();
  statusRebake.resendStatus('test', cb.ok, cb.fail);
  sends[1].onFailure({});
  assert.deepEqual(cb.log, ['ok', 'fail']);
});

test('a bake that throws runs onFailure and sends nothing', () => {
  storage = {};
  const sends = [];
  statusRebake.init({
    getSettings: () => ({}),
    buildStatusLines: () => { throw new Error('boom'); },
    sendWeather: (p) => sends.push(p)
  });
  statusRebake.rememberBakeInputs({ CITY: 'Bonn' }, null);
  const cb = callbacks();
  assert.doesNotThrow(() => statusRebake.resendStatus('test', cb.ok, cb.fail));
  assert.deepEqual(cb.log, ['fail'], 'the chain behind it still runs');
  assert.equal(sends.length, 0);
});

test('through the real outbox: an unchanged status category skips the send and succeeds at once', () => {
  storage = {};
  const appMessages = [];
  global.Pebble = {
    sendAppMessage: (dict, ack) => { appMessages.push(dict); ack({}); }
  };
  statusRebake.init({ getSettings: () => ({}), buildStatusLines: fakeBake });
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
  statusRebake.init({ getSettings: () => live, sendWeather: () => {} });
  statusRebake.rememberBakeInputs({
    CITY: 'Bonn', UV_TREND_UINT8: [20], UV_DAY_PEAKS: [30, 90, 0],
    POLLEN_TODAY: '1', POLLEN_TOMORROW: '3'
  }, null);
  const KEYS = require('../../../src/pkjs/settings/adapter/storage-keys.js');
  const stored = JSON.parse(storage[KEYS.PHONE_BATTERY_SNAPSHOT]).payload;
  assert.deepEqual(stored.UV_DAY_PEAKS, [30, 90, 0], 'tomorrow\'s UV peak is in the backstop');
  assert.equal(stored.POLLEN_TOMORROW, '3', 'and tomorrow\'s pollen band');

  // A restart: the in-memory inputs are gone, the backstop answers.
  const sends = [];
  statusRebake.init({ getSettings: () => live, sendWeather: (p) => sends.push(p) });
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
  statusRebake.init({ getSettings: () => ({}), sendWeather: (p) => sends.push(p),
    buildStatusLines: fakeBake, now: () => now });
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
  statusRebake.init(opts);
  statusRebake.rememberBakeInputs({ SUN_EVENTS: sunEvents(1, T + 3600, T + 13 * 3600) }, null);
  statusRebake.init(opts);   // PKJS restarted
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
  statusRebake.init({ getSettings: () => ({}), sendWeather: (p) => sends.push(p),
    buildStatusLines: fakeBake, now: () => now });
  statusRebake.rememberBakeInputs({ SUN_EVENTS: sunEvents(1, T + 3600, T + 13 * 3600) }, null);
  now = (T + 7200) * 1000;
  statusRebake.resendStatus('charging');
  assert.equal(statusRebake.onTick(), false, 'the charging resend already baked the night');
  assert.equal(sends.length, 1);
});

test('the scheduler\'s minute tick runs the day/night check (index.js onSchedulerTick)', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', '..', '../src/pkjs/index.js'), 'utf8');
  const body = src.slice(src.indexOf('function onSchedulerTick() {'));
  assert.ok(body.slice(0, body.indexOf('\n}')).indexOf('statusRebake.onTick();') > 0);
});
