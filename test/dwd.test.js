const test = require('node:test');
const assert = require('node:assert/strict');

const WeatherProvider = require('../src/pkjs/weather/provider.js');
var responder;
WeatherProvider.request = function(url, type, onSuccess, onError) { responder(url, onSuccess, onError); };
const DwdProvider = require('../src/pkjs/weather/dwd.js');

test('DWD maps Brightsky forecast/current with °C→°F and km/h passthrough', () => {
  responder = function(url, onSuccess) {
    if (url.indexOf('/current_weather') !== -1) {
      onSuccess(JSON.stringify({ weather: { temperature: 20 } }));   // °C
      return;
    }
    onSuccess(JSON.stringify({ weather: [
      { temperature: 0, precipitation_probability: 40, precipitation: 1.2, wind_speed: 18, wind_gust_speed: 30, timestamp: '2023-11-14T22:00:00+00:00' },
      { temperature: 10, precipitation_probability: 0, precipitation: 0, wind_speed: 0, wind_gust_speed: 0, timestamp: '2023-11-14T23:00:00+00:00' }
    ] }));
  };
  const p = new DwdProvider();   // fetchUv unset → no UV request, onSuccess fires after current
  var ok = false;
  p.withProviderData(0, 0, false, function() { ok = true; }, function(f) { throw new Error('unexpected failure ' + JSON.stringify(f)); });

  assert.equal(ok, true, 'onSuccess fires');
  assert.deepEqual(p.tempTrend, [32, 50], '°C→°F (0→32, 10→50)');
  assert.deepEqual(p.precipTrend, [0.4, 0], 'probability /100');
  assert.deepEqual(p.rainTrend, [1.2, 0], 'precipitation mm passthrough');
  assert.deepEqual(p.windTrend, [18, 0], 'wind_speed km/h passthrough');
  assert.deepEqual(p.gustTrend, [30, 0], 'wind_gust_speed km/h passthrough');
  assert.equal(p.currentTemp, 68, 'current 20°C → 68°F');
  assert.equal(p.startTime, Math.floor(Date.parse('2023-11-14T22:00:00+00:00') / 1000), 'startTime from hourly[0].timestamp');
});
