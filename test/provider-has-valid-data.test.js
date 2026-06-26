// test/provider-has-valid-data.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const WeatherProvider = require('../src/pkjs/weather/provider.js');

function makeProvider(over) {
  const p = new WeatherProvider();
  return Object.assign(p, over);
}

test('hasValidData true when all fields present and trends long enough', () => {
  const p = makeProvider({
    tempTrend: new Array(24).fill(50),
    precipTrend: new Array(24).fill(0.1),
    startTime: 1000,
    currentTemp: 60
  });
  assert.equal(p.hasValidData(), true);
});

test('hasValidData is strictly boolean false when a field is missing', () => {
  const p = makeProvider({ precipTrend: new Array(24).fill(0.1), startTime: 1, currentTemp: 1 });
  delete p.tempTrend;
  assert.equal(p.hasValidData(), false);
});

test('hasValidData is strictly boolean false when trends too short', () => {
  const p = makeProvider({
    tempTrend: new Array(3).fill(50),
    precipTrend: new Array(3).fill(0.1),
    startTime: 1000,
    currentTemp: 60
  });
  assert.equal(p.hasValidData(), false); // pre-fix this path returns undefined
});

test('getPayload emits WIND_TREND_UINT8 as rounded, clamped km/h', () => {
  const p = makeProvider({
    numEntries: 3,
    tempTrend: [50, 51, 52],
    precipTrend: [0, 0.5, 1],
    rainTrend: [0, 0, 0],
    windTrend: [0, 12.6, 300],   // 300 clamps to 255
    startTime: 1000,
    currentTemp: 60,
    cityName: 'Testville',
    sunEvents: [
      { type: 'sunrise', date: new Date(1000 * 1000) },
      { type: 'sunset', date: new Date(2000 * 1000) }
    ]
  });
  const payload = p.getPayload();
  assert.deepEqual(payload.WIND_TREND_UINT8, [0, 13, 255]);
});

test('constructor default windTrend is a zero-filled numEntries array', () => {
  const p = new WeatherProvider();
  assert.equal(p.windTrend.length, p.numEntries);
  assert.ok(p.windTrend.every(function(v) { return v === 0; }));
});

// Locks the SUN_EVENTS wire encoding (leading sunrise/sunset byte + LE Int32
// epoch-seconds per event) so the encodeSunEvents extraction can't drift it.
test('getPayload encodes SUN_EVENTS as [startByte, ...LE int32 epoch seconds]', () => {
  const p = makeProvider({
    numEntries: 3,
    tempTrend: [50, 51, 52],
    precipTrend: [0, 0.5, 1],
    rainTrend: [0, 0, 0],
    windTrend: [0, 0, 0],
    gustTrend: [0, 0, 0],
    startTime: 1000,
    currentTemp: 60,
    cityName: 'X',
    sunEvents: [
      { type: 'sunrise', date: new Date(1000 * 1000) }, // 1000 s
      { type: 'sunset', date: new Date(2000 * 1000) }    // 2000 s
    ]
  });
  // 0 = list starts on a sunrise; 1000 -> E8 03 00 00, 2000 -> D0 07 00 00 (LE).
  assert.deepEqual(p.getPayload().SUN_EVENTS, [0, 232, 3, 0, 0, 208, 7, 0, 0]);
});

test('composeWeatherPayload merges extras then applies the transform', () => {
  const p = makeProvider({
    numEntries: 3,
    tempTrend: [50, 51, 52],
    precipTrend: [0, 0.5, 1],
    rainTrend: [0, 0, 0],
    windTrend: [0, 0, 0],
    gustTrend: [0, 0, 0],
    startTime: 1000,
    currentTemp: 60,
    cityName: 'Town',
    sunEvents: [
      { type: 'sunrise', date: new Date(1000 * 1000) },
      { type: 'sunset', date: new Date(2000 * 1000) }
    ]
  });
  const out = p.composeWeatherPayload({ IS_SLEEPING: 1, RAIN_RADAR_START: 42 }, function(payload) {
    payload.TRANSFORMED = true;
    return payload;
  });
  assert.equal(out.CITY, 'Town');         // base payload preserved
  assert.equal(out.IS_SLEEPING, 1);       // extra merged
  assert.equal(out.RAIN_RADAR_START, 42); // extra merged
  assert.equal(out.TRANSFORMED, true);    // transform applied last
});

test('composeWeatherPayload works with no extras and no transform', () => {
  const p = makeProvider({
    numEntries: 3,
    tempTrend: [50, 51, 52],
    precipTrend: [0, 0.5, 1],
    rainTrend: [0, 0, 0],
    windTrend: [0, 0, 0],
    gustTrend: [0, 0, 0],
    startTime: 1000,
    currentTemp: 60,
    cityName: 'Town',
    sunEvents: [
      { type: 'sunrise', date: new Date(1000 * 1000) },
      { type: 'sunset', date: new Date(2000 * 1000) }
    ]
  });
  const out = p.composeWeatherPayload(null, undefined);
  assert.equal(out.CITY, 'Town');
  assert.ok(Array.isArray(out.TEMP_TREND_UINT8));
});
