const test = require('node:test');
const assert = require('node:assert/strict');

const WeatherProvider = require('../src/pkjs/weather/provider.js');
var responder;
WeatherProvider.request = function(url, type, onSuccess, onError) { responder(url, onSuccess, onError); };
const OpenWeatherMapProvider = require('../src/pkjs/weather/openweathermap.js');

function round4(n) { return Math.round(n * 10000) / 10000; }

test('OWM maps One Call hourly into trends with imperial→metric conversions', () => {
  responder = function(url, onSuccess) {
    onSuccess(JSON.stringify({
      current: { temp: 71 },
      daily: [{}, {}],
      hourly: [
        { temp: 50, pop: 0.4, rain: { '1h': 1.5 }, snow: { '1h': 0.5 }, wind_speed: 10, wind_gust: 20, uvi: 3, dt: 1700000000 },
        { temp: 60, pop: 0, wind_speed: 0, wind_gust: 0, uvi: 0, dt: 1700003600 }
      ]
    }));
  };
  const p = new OpenWeatherMapProvider('test-key');
  var ok = false;
  p.withProviderData(0, 0, false, function() { ok = true; }, function(f) { throw new Error('unexpected failure ' + JSON.stringify(f)); });

  assert.equal(ok, true, 'onSuccess fires');
  assert.deepEqual(p.tempTrend, [50, 60], '°F passthrough (units=imperial)');
  assert.deepEqual(p.precipTrend, [0.4, 0], 'OWM pop is already 0..1 — no /100');
  assert.deepEqual(p.rainTrend, [2.0, 0], 'rain.1h + snow.1h in mm');
  assert.equal(round4(p.windTrend[0]), 16.0934, 'wind mph→km/h');
  assert.equal(p.windTrend[1], 0);
  assert.equal(round4(p.gustTrend[0]), 32.1868, 'gust mph→km/h');
  assert.deepEqual(p.uvTrend, [3, 0], 'uvi passthrough');
  assert.equal(p.startTime, 1700000000, 'startTime = hourly[0].dt');
  assert.equal(p.currentTemp, 71, 'currentTemp = current.temp');
});
