// test/fixture-weather.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { getFixtureWeatherPayload } = require('../src/pkjs/fixture-weather');

function decode16(bytes) {
  return Array.from(new Int16Array(new Uint8Array(bytes).buffer));
}

// A minimal-but-valid 3-hour fixture: temps/precipPct present, 2 sun events.
function makeFixture(over) {
  return {
    name: 'test',
    weather: Object.assign({
      city: 'Testville',
      currentTemp: 60,
      startEpoch: 1000,
      temps: [50, 51, 52],
      precipPct: [0, 0, 0],
      sunEvents: [
        { type: 'sunrise', epoch: 1000 },
        { type: 'sunset', epoch: 2000 }
      ]
    }, over)
  };
}

test('fixture windKmh feeds the wind secondary line (mid scale)', () => {
  const fixture = makeFixture({ windKmh: [0, 25, 50] });
  const out = getFixtureWeatherPayload(fixture, { secondaryLine: 'wind', windScale: 'mid', barSource: 'off' });
  assert.deepEqual(decode16(out.SECONDARY_LINE_TREND_INT16), [0, 500, 1000]);
  assert.equal(out.SECONDARY_LINE_FILL, false);
  assert.ok(!('WIND_TREND_UINT8' in out)); // transient key never survives
});

test('fixture without windKmh still produces a valid (flat) wind line', () => {
  const fixture = makeFixture({});  // no windKmh
  const out = getFixtureWeatherPayload(fixture, { secondaryLine: 'wind', windScale: 'mid', barSource: 'off' });
  assert.deepEqual(decode16(out.SECONDARY_LINE_TREND_INT16), [0, 0, 0]);
});
