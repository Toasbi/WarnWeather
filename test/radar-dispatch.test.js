const test = require('node:test');
const assert = require('node:assert/strict');
const { dispatchRadarTuplesAt, clearRadarTuples } = require('../src/pkjs/weather/radar-dispatch');

test("'dwd' delegates to fetchDwdAt with lat/lon/slot and passes its tuples through", () => {
  const fetched = { RAIN_RADAR_TREND_UINT8: [1], RAIN_RADAR_TREND_AREA_UINT8: [2], RAIN_RADAR_START: 100 };
  let seen = null;
  let result;
  const fetchDwdAt = (lat, lon, slot, cb) => { seen = { lat, lon, slot }; cb(fetched); };
  dispatchRadarTuplesAt('dwd', { lat: 52.5, lon: 13.4, slotZeroEpoch: 100, fetchDwdAt }, (t) => { result = t; });
  assert.deepEqual(seen, { lat: 52.5, lon: 13.4, slot: 100 });
  assert.equal(result, fetched);
});

test("'dwd' passes null through (DWD failure preserves watch radar)", () => {
  let result = 'unset';
  const fetchDwdAt = (lat, lon, slot, cb) => cb(null);
  dispatchRadarTuplesAt('dwd', { lat: 0, lon: 0, slotZeroEpoch: 0, fetchDwdAt }, (t) => { result = t; });
  assert.equal(result, null);
});

test("'disabled' returns clearing tuples without calling fetchDwdAt", () => {
  let called = false;
  let result;
  const fetchDwdAt = () => { called = true; };
  dispatchRadarTuplesAt('disabled', { lat: 0, lon: 0, slotZeroEpoch: 0, fetchDwdAt }, (t) => { result = t; });
  assert.equal(called, false);
  assert.deepEqual(result, { RAIN_RADAR_TREND_UINT8: [], RAIN_RADAR_TREND_AREA_UINT8: [], RAIN_RADAR_START: 0 });
});

test('unset/unknown provider clears radar (default off)', () => {
  let result;
  dispatchRadarTuplesAt(undefined, { lat: 0, lon: 0, slotZeroEpoch: 0, fetchDwdAt: () => {} }, (t) => { result = t; });
  assert.deepEqual(result, clearRadarTuples());
});

test("'rainbow' delegates to fetchRainbowAt with endpoint/lat/lon/slot and passes its tuples through", () => {
  const fetched = { RAIN_RADAR_TREND_UINT8: [1], RAIN_RADAR_TREND_AREA_UINT8: [0], RAIN_RADAR_START: 100 };
  let seen = null;
  let result;
  const fetchRainbowAt = (endpoint, lat, lon, slot, cb) => { seen = { endpoint, lat, lon, slot }; cb(fetched); };
  dispatchRadarTuplesAt('rainbow',
    { lat: 52.5, lon: 13.4, slotZeroEpoch: 100,
      fetchDwdAt: () => { throw new Error('wrong provider'); },
      fetchRainbowAt, rainbowEndpoint: 'https://proxy.example/rainbow-nowcast' },
    (t) => { result = t; });
  assert.deepEqual(seen, { endpoint: 'https://proxy.example/rainbow-nowcast', lat: 52.5, lon: 13.4, slot: 100 });
  assert.equal(result, fetched);
});

test("'rainbow' passes null through (Rainbow failure preserves watch radar)", () => {
  let result = 'unset';
  const fetchRainbowAt = (endpoint, lat, lon, slot, cb) => cb(null);
  dispatchRadarTuplesAt('rainbow',
    { lat: 0, lon: 0, slotZeroEpoch: 0, fetchRainbowAt, rainbowEndpoint: '' },
    (t) => { result = t; });
  assert.equal(result, null);
});

test("'dwd' and 'disabled' never call fetchRainbowAt", () => {
  let rainbowCalled = false;
  const fetchRainbowAt = () => { rainbowCalled = true; };
  dispatchRadarTuplesAt('dwd',
    { lat: 0, lon: 0, slotZeroEpoch: 0, fetchDwdAt: (a, b, c, cb) => cb(null), fetchRainbowAt }, () => {});
  dispatchRadarTuplesAt('disabled',
    { lat: 0, lon: 0, slotZeroEpoch: 0, fetchDwdAt: () => {}, fetchRainbowAt }, () => {});
  assert.equal(rainbowCalled, false);
});

test("'metno' delegates to fetchMetnoAt with lat/lon/slot and passes its tuples through", () => {
  const fetched = { RAIN_RADAR_TREND_UINT8: [1], RAIN_RADAR_TREND_AREA_UINT8: [0], RAIN_RADAR_START: 100 };
  let seen = null;
  let result;
  const fetchMetnoAt = (lat, lon, slot, cb) => { seen = { lat, lon, slot }; cb(fetched); };
  dispatchRadarTuplesAt('metno',
    { lat: 59.91, lon: 10.75, slotZeroEpoch: 100,
      fetchDwdAt: () => { throw new Error('wrong provider'); },
      fetchRainbowAt: () => { throw new Error('wrong provider'); },
      fetchMetnoAt },
    (t) => { result = t; });
  assert.deepEqual(seen, { lat: 59.91, lon: 10.75, slot: 100 });
  assert.equal(result, fetched);
});

test("'metno' passes null through (Met.no failure preserves watch radar)", () => {
  let result = 'unset';
  const fetchMetnoAt = (lat, lon, slot, cb) => cb(null);
  dispatchRadarTuplesAt('metno', { lat: 0, lon: 0, slotZeroEpoch: 0, fetchMetnoAt }, (t) => { result = t; });
  assert.equal(result, null);
});

test("'dwd' and 'disabled' never call fetchMetnoAt", () => {
  let metnoCalled = false;
  const fetchMetnoAt = () => { metnoCalled = true; };
  dispatchRadarTuplesAt('dwd',
    { lat: 0, lon: 0, slotZeroEpoch: 0, fetchDwdAt: (a, b, c, cb) => cb(null), fetchMetnoAt }, () => {});
  dispatchRadarTuplesAt('disabled',
    { lat: 0, lon: 0, slotZeroEpoch: 0, fetchDwdAt: () => {}, fetchMetnoAt }, () => {});
  assert.equal(metnoCalled, false);
});
