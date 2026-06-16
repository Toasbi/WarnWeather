const test = require('node:test');
const assert = require('node:assert/strict');
const { dispatchRadarTuples, clearRadarTuples } = require('../src/pkjs/weather/radar-dispatch');

test("'dwd' delegates to fetchDwd with provider + slot and passes its tuples through", () => {
  const provider = { id: 'wunderground' };
  const fetched = { RAIN_RADAR_TREND_UINT8: [1], RAIN_RADAR_TREND_AREA_UINT8: [2], RAIN_RADAR_START: 100 };
  let seenProvider, seenSlot, result;
  const fetchDwd = (p, slot, cb) => { seenProvider = p; seenSlot = slot; cb(fetched); };
  dispatchRadarTuples('dwd', { provider, slotZeroEpoch: 100, fetchDwd }, (t) => { result = t; });
  assert.equal(seenProvider, provider);
  assert.equal(seenSlot, 100);
  assert.equal(result, fetched);
});

test("'dwd' passes null through (DWD failure preserves watch radar)", () => {
  let result = 'unset';
  const fetchDwd = (p, slot, cb) => cb(null);
  dispatchRadarTuples('dwd', { provider: {}, slotZeroEpoch: 0, fetchDwd }, (t) => { result = t; });
  assert.equal(result, null);
});

test("'disabled' returns clearing tuples without calling fetchDwd", () => {
  let called = false;
  let result;
  const fetchDwd = () => { called = true; };
  dispatchRadarTuples('disabled', { provider: {}, slotZeroEpoch: 0, fetchDwd }, (t) => { result = t; });
  assert.equal(called, false);
  assert.deepEqual(result, { RAIN_RADAR_TREND_UINT8: [], RAIN_RADAR_TREND_AREA_UINT8: [], RAIN_RADAR_START: 0 });
});

test('unset/unknown provider clears radar (default off)', () => {
  let result;
  dispatchRadarTuples(undefined, { provider: {}, slotZeroEpoch: 0, fetchDwd: () => {} }, (t) => { result = t; });
  assert.deepEqual(result, clearRadarTuples());
});
