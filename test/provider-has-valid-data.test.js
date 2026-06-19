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
