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

const statusRebake = require('../src/pkjs/status-rebake.js');

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
