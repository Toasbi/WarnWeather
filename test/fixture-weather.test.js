// test/fixture-weather.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { getFixtureWeatherPayload, getFixtureRadarTuples } = require('../src/pkjs/fixture-weather');

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

test('fixture windKmh feeds the wind secondary line (mid scale), now fillable', () => {
  const fixture = makeFixture({ windKmh: [0, 25, 50] });
  const out = getFixtureWeatherPayload(fixture, { secondaryLine: 'wind', windScale: 'mid', secondaryLineFill: true, barSource: 'off' });
  assert.deepEqual(out.SECONDARY_LINE_TREND_UINT8, [0, 125, 250]);
  assert.equal(out.SECONDARY_LINE_FILL, true);            // fill now works for wind, not just precip
  assert.equal(out.SECONDARY_LINE_FILL_COLOR, 0x555500);  // GColorArmyGreen (resolved as colour: no watchInfo)
  assert.ok(!('WIND_TREND_UINT8' in out));                // transient key never survives
});

test('fixture path threads watchInfo: a B&W watch resolves the wind line white + fill light gray', () => {
  const fixture = makeFixture({ windKmh: [0, 25, 50] });
  const out = getFixtureWeatherPayload(fixture, { secondaryLine: 'wind', windScale: 'mid', secondaryLineFill: true, barSource: 'off' }, { platform: 'diorite' });
  assert.equal(out.SECONDARY_LINE_COLOR, 0xFFFFFF);       // GColorWhite on B&W — proves watchInfo reached the resolver
  assert.equal(out.SECONDARY_LINE_FILL_COLOR, 0xAAAAAA);  // GColorLightGray on B&W
});

test('fixture without windKmh still produces a valid (flat) wind line', () => {
  const fixture = makeFixture({});  // no windKmh
  const out = getFixtureWeatherPayload(fixture, { secondaryLine: 'wind', windScale: 'mid', barSource: 'off' });
  assert.deepEqual(out.SECONDARY_LINE_TREND_UINT8, [0, 0, 0]);
});

test('radar window anchors to startEpoch by default', () => {
  const t = getFixtureRadarTuples(makeFixture({
    rainRadarExactMm: [0, 1, 2], rainRadarAreaMm: [0, 1, 2],
  }));
  assert.equal(t.RAIN_RADAR_START, 1000);
});

test('radarStartEpoch overrides startEpoch for the radar window only', () => {
  // Lets the time-lapse scroll the radar (radarStartEpoch steps per frame) while
  // the forecast graph keeps its own pinned startEpoch.
  const t = getFixtureRadarTuples(makeFixture({
    rainRadarExactMm: [0, 1, 2], rainRadarAreaMm: [0, 1, 2], radarStartEpoch: 1300,
  }));
  assert.equal(t.RAIN_RADAR_START, 1300);
});

test('fixture gustKmh flows to a dashed gust third line when wind+gust are selected', () => {
  const payload = getFixtureWeatherPayload(
    makeFixture({ windKmh: [0, 25, 50], gustKmh: [0, 50, 100] }),
    { secondaryLine: 'wind', thirdLine: 'gust', windScale: 'mid', barSource: 'off' }
  );
  // 0/50/100 km/h gusts @ 50 ceiling → 0/250/250 (uint8 0..250)
  const gust = payload.THIRD_LINE_TREND_UINT8;
  assert.deepEqual(gust, [0, 250, 250]);
});

test('payload emits TEMP_TREND_UINT8 byte array and TEMP_MIN/TEMP_MAX numbers', () => {
  const payload = getFixtureWeatherPayload(
    makeFixture({ temps: [50, 60, 70] }),
    { secondaryLine: 'wind', windScale: 'mid', barSource: 'off' }
  );
  assert.ok(Array.isArray(payload.TEMP_TREND_UINT8), 'temp trend is a byte array');
  payload.TEMP_TREND_UINT8.forEach(function(b) { assert.ok(b >= 0 && b <= 250); });
  assert.equal(typeof payload.TEMP_MIN, 'number');
  assert.equal(typeof payload.TEMP_MAX, 'number');
  assert.ok(!('TEMP_TREND_INT16' in payload), 'old int16 temp key is gone');
});

test('fixture uvIndex feeds the UV secondary line', () => {
  const fixture = makeFixture({
    uvIndex: [5.5, 5.5, 5.5]
  });
  const payload = getFixtureWeatherPayload(
    fixture, { secondaryLine: 'uv', thirdLine: 'off', barSource: 'off' });
  assert.ok(payload, 'fixture payload built');
  // UV 5.5 → tenths 55 → permille 500 → byte 125
  assert.ok(payload.SECONDARY_LINE_TREND_UINT8.every(function(b) { return b === 125; }), 'all UV 5.5 → byte 125');
});
