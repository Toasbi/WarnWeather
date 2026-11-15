// test/weather/adapter/radar/request-throttle.test.js
//
// The request throttle on its own: one request per UTC-aligned slot of the source's
// interval, the slot's answer re-served in between. fetch-cycle.js runs two of them (the
// radar's, whose failures count, and the sky rows'), covered end to end in
// test/shell/fetch-cycle.test.js, rainbow-radar-throttle.test.js and sky-refresh.test.js.

// Install a localStorage mock BEFORE the module loads. See
// test/wire/adapter/change-detector.test.js for the pattern.
global.localStorage = (function () {
  const store = {};
  return {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    clear: () => { Object.keys(store).forEach((k) => delete store[k]); }
  };
})();

const test = require('node:test');
const assert = require('node:assert/strict');
const requestThrottle = require('../../../../src/pkjs/weather/adapter/radar/request-throttle.js');

const KEY = 'testThrottle';
const MIN = 60 * 1000;
const HALF_HOUR = 30 * MIN;
const T0 = Date.UTC(2026, 10, 15, 10, 0, 0);   // on a half-hour boundary

function counting() {
  return requestThrottle.createRequestThrottle({ key: KEY, answerField: 'tuples', failuresCount: true });
}

function answerOnly() {
  return requestThrottle.createRequestThrottle({ key: KEY, answerField: 'tuple', failuresCount: false });
}

function stored() {
  return JSON.parse(localStorage.getItem(KEY));
}

test.beforeEach(() => { localStorage.clear(); });

test('isPastSlot trips only once a later UTC-aligned slot starts', () => {
  assert.equal(requestThrottle.isPastSlot(T0, T0 + HALF_HOUR - 1, HALF_HOUR), false);
  assert.equal(requestThrottle.isPastSlot(T0, T0 + HALF_HOUR, HALF_HOUR), true);
  assert.equal(requestThrottle.isPastSlot(T0 + 29 * MIN, T0 + HALF_HOUR, HALF_HOUR), true);
});

test('when failures count, the request holds its slot before it is answered', () => {
  const throttle = counting();
  assert.equal(throttle.take('rainbow', HALF_HOUR, T0 + 5 * MIN, false).request, true);
  assert.deepEqual(stored(), { id: 'rainbow', at: T0 + 5 * MIN });
  // It failed (nothing remembered): the slot is still taken, so a failing source is not hammered.
  const again = throttle.take('rainbow', HALF_HOUR, T0 + 10 * MIN, false);
  assert.equal(again.request, false);
  assert.equal(again.answer, null);
  assert.equal(throttle.take('rainbow', HALF_HOUR, T0 + HALF_HOUR, false).request, true, 'the next slot asks');
});

test('the slot\'s answer is re-served until the next slot, and a forced fetch asks anyway', () => {
  const throttle = counting();
  const slot = throttle.take('rainbow', HALF_HOUR, T0 + 5 * MIN, false);
  throttle.remember(slot, { RAIN_RADAR_START: 1 });
  assert.deepEqual(stored(), { id: 'rainbow', at: T0 + 5 * MIN, tuples: { RAIN_RADAR_START: 1 } });
  assert.deepEqual(throttle.take('rainbow', HALF_HOUR, T0 + 20 * MIN, false).answer, { RAIN_RADAR_START: 1 });
  assert.equal(throttle.take('rainbow', HALF_HOUR, T0 + 21 * MIN, true).request, true);
  // The forced request owns the record now: the earlier slot's late answer is not kept.
  throttle.remember(slot, { RAIN_RADAR_START: 2 });
  assert.deepEqual(stored(), { id: 'rainbow', at: T0 + 21 * MIN });
});

test('when failures do not count, only an answer holds the slot', () => {
  const throttle = answerOnly();
  const failed = throttle.take('openmeteo', HALF_HOUR, T0 + 5 * MIN, false);
  assert.equal(failed.request, true);
  throttle.remember(failed, null);
  assert.equal(localStorage.getItem(KEY), null, 'nothing is recorded before or without an answer');
  const asked = throttle.take('openmeteo', HALF_HOUR, T0 + 10 * MIN, false);
  assert.equal(asked.request, true, 'the next cycle asks again');
  throttle.remember(asked, { RADAR_SKY_UINT8: [1, 2] });
  const kept = throttle.take('openmeteo', HALF_HOUR, T0 + 25 * MIN, false);
  assert.equal(kept.request, false);
  assert.deepEqual(kept.answer, { RADAR_SKY_UINT8: [1, 2] });
  assert.equal(throttle.take('openmeteo', HALF_HOUR, T0 + HALF_HOUR, false).request, true);
});

test('an interval of 0 forgets the record and keeps nothing; another source asks again', () => {
  const throttle = counting();
  throttle.remember(throttle.take('rainbow', HALF_HOUR, T0, false), { RAIN_RADAR_START: 1 });
  assert.equal(throttle.take('dwd', HALF_HOUR, T0 + MIN, false).request, true, 'another id is not throttled by it');
  const off = throttle.take('disabled', 0, T0 + 2 * MIN, false);
  assert.equal(off.request, true);
  assert.equal(localStorage.getItem(KEY), null);
  throttle.remember(off, { RAIN_RADAR_START: 0 });
  assert.equal(localStorage.getItem(KEY), null);
});

test('a broken store asks anyway without throwing', () => {
  const saved = global.localStorage;
  const throwing = () => { throw new Error('quota'); };
  global.localStorage = { getItem: throwing, setItem: throwing, removeItem: throwing, clear: throwing };
  try {
    const throttle = counting();
    const slot = throttle.take('rainbow', HALF_HOUR, T0, false);
    assert.equal(slot.request, true);
    assert.doesNotThrow(() => throttle.remember(slot, { RAIN_RADAR_START: 1 }));
  } finally {
    global.localStorage = saved;
  }
});
