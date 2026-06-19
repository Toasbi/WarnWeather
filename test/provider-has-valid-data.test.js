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
