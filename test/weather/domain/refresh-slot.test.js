// test/weather/domain/refresh-slot.test.js — the refresh slot: UTC-aligned chunks of an
// interval since the epoch.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { isPastSlot } = require('../../../src/pkjs/weather/domain/refresh-slot.js');

const MIN = 60 * 1000;
const HALF_HOUR = 30 * MIN;
const T0 = Date.UTC(2026, 10, 15, 10, 0, 0);   // on a half-hour boundary

test('isPastSlot trips only once a later UTC-aligned slot starts', () => {
  assert.equal(isPastSlot(T0, T0 + HALF_HOUR - 1, HALF_HOUR), false);
  assert.equal(isPastSlot(T0, T0 + HALF_HOUR, HALF_HOUR), true);
  assert.equal(isPastSlot(T0 + 29 * MIN, T0 + HALF_HOUR, HALF_HOUR), true);
});

test('the update interval is the stored minutes in ms; a value that is no number gives no slot', () => {
  const { updateIntervalMs } = require('../../../src/pkjs/weather/domain/refresh-slot.js');
  assert.equal(updateIntervalMs({ fetchIntervalMin: '15' }), 15 * MIN);
  assert.equal(updateIntervalMs({ fetchIntervalMin: 60 }), 60 * MIN);
  assert.ok(Number.isNaN(updateIntervalMs({ fetchIntervalMin: 'soon' })));
});
