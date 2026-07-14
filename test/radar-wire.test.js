const test = require('node:test');
const assert = require('node:assert/strict');
const radarWire = require('../src/pkjs/weather/radar-wire.js');

test('NUM_BARS and SLOT_SECONDS are the shared 24 / 300 wire invariant', () => {
  assert.equal(radarWire.NUM_BARS, 24);
  assert.equal(radarWire.SLOT_SECONDS, 300);
});

test('slotZeroEpochFor pins an exact 5-min boundary to itself', () => {
  const ms = 1700000100 * 1000;   // 1700000100 % 300 === 0
  assert.equal(radarWire.slotZeroEpochFor(ms), 1700000100);
});

test('slotZeroEpochFor pins a mid-slot time down to the previous boundary', () => {
  const ms = (1700000100 + 137) * 1000;   // 137 s into the slot
  assert.equal(radarWire.slotZeroEpochFor(ms), 1700000100);
});

test('slotZeroEpochFor truncates sub-second milliseconds', () => {
  const ms = 1700000100 * 1000 + 999;     // 999 ms past the boundary
  assert.equal(radarWire.slotZeroEpochFor(ms), 1700000100);
});

test('clearRadarTuples returns empty trend arrays and a zero start', () => {
  assert.deepEqual(radarWire.clearRadarTuples(), {
    RAIN_RADAR_TREND_UINT8: [],
    RAIN_RADAR_TREND_AREA_UINT8: [],
    RAIN_RADAR_START: 0
  });
});
