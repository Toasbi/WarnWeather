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

test('DWD maps Brightsky pressure_msl into pressureTrend', () => {
  responder = function(url, onSuccess) {
    if (url.indexOf('/current_weather') !== -1) {
      onSuccess(JSON.stringify({ weather: { temperature: 20 } }));
      return;
    }
    onSuccess(JSON.stringify({ weather: [
      { temperature: 0, precipitation_probability: 40, precipitation: 1.2, wind_speed: 18, wind_gust_speed: 30, pressure_msl: 1012.5, timestamp: '2023-11-14T22:00:00+00:00' },
      // second hour omits pressure_msl -> 0, which forecast-series rejects (line off)
      { temperature: 10, precipitation_probability: 0, precipitation: 0, wind_speed: 0, wind_gust_speed: 0, timestamp: '2023-11-14T23:00:00+00:00' }
    ] }));
  };
  const p = new DwdProvider();
  p.withProviderData(0, 0, false, function() {}, function(f) { throw new Error('unexpected failure ' + JSON.stringify(f)); });
  assert.deepEqual(p.pressureTrend, [1012.5, 0], 'pressure_msl hPa passthrough, absent → 0');
});

const feelsLikeF = require('../src/pkjs/weather/feels-like.js').feelsLikeF;

test('DWD computes feelsTrend via Steadman from temperature/relative_humidity/wind_speed', () => {
  responder = function(url, onSuccess) {
    if (url.indexOf('/current_weather') !== -1) {
      // current_weather has no plain wind_speed — 10/30/60-minute means only.
      onSuccess(JSON.stringify({ weather: { temperature: 20, relative_humidity: 57, wind_speed_10: 8.3 } }));
      return;
    }
    onSuccess(JSON.stringify({ weather: [
      { temperature: 20, relative_humidity: 50, precipitation_probability: 0, precipitation: 0, wind_speed: 20, wind_gust_speed: 0, timestamp: '2023-11-14T22:00:00+00:00' },
      // no relative_humidity -> the hour falls back to the plain temp (°F)
      { temperature: 10, precipitation_probability: 0, precipitation: 0, wind_speed: 0, wind_gust_speed: 0, timestamp: '2023-11-14T23:00:00+00:00' }
    ] }));
  };
  const p = new DwdProvider();
  p.withProviderData(0, 0, false, function() {}, function(f) { throw new Error('unexpected failure ' + JSON.stringify(f)); });
  assert.equal(p.feelsTrend[0], feelsLikeF(68, 50, 20), 'Steadman on the internal °F/km/h units');
  assert.equal(p.feelsTrend[1], 50, 'missing humidity → the hour reads the actual 10 °C → 50 °F');
  assert.equal(p.currentFeels, feelsLikeF(68, 57, 8.3), 'current uses the 10-minute wind mean');
});

test('DWD computes feels from dew_point when relative_humidity is null (live MOSMIX shape)', () => {
  // Real Brightsky FORECAST records (MOSMIX sources) return relative_humidity:
  // null for every hour but always carry dew_point — before the dew-point path
  // existed, all 24 hours silently fell back to the plain temp, so the feels
  // curve rendered exactly under the temp curve and "never showed up".
  const feelsLikeFromDewF = require('../src/pkjs/weather/feels-like.js').feelsLikeFromDewF;
  responder = function(url, onSuccess) {
    if (url.indexOf('/current_weather') !== -1) {
      // Observation record: RH present → the existing RH path keeps priority.
      onSuccess(JSON.stringify({ weather: { temperature: 24.4, relative_humidity: 48, dew_point: 12.58, wind_speed_10: 16.6 } }));
      return;
    }
    onSuccess(JSON.stringify({ weather: [
      { temperature: 24.5, relative_humidity: null, dew_point: 13.5, precipitation_probability: 0, precipitation: 0, wind_speed: 14.8, wind_gust_speed: 0, timestamp: '2023-11-14T22:00:00+00:00' },
      // neither humidity nor dew point -> plain-temp fallback stays
      { temperature: 10, relative_humidity: null, precipitation_probability: 0, precipitation: 0, wind_speed: 0, wind_gust_speed: 0, timestamp: '2023-11-14T23:00:00+00:00' }
    ] }));
  };
  const p = new DwdProvider();
  p.withProviderData(0, 0, false, function() {}, function(f) { throw new Error('unexpected failure ' + JSON.stringify(f)); });
  const expected = feelsLikeFromDewF(24.5 * 9 / 5 + 32, 13.5 * 9 / 5 + 32, 14.8);
  assert.equal(p.feelsTrend[0], expected, 'dew-point Steadman when RH is null');
  assert.notEqual(p.feelsTrend[0], 24.5 * 9 / 5 + 32, 'must NOT silently equal the plain temp');
  assert.equal(p.feelsTrend[1], 50, 'no moisture data at all → plain 10 °C → 50 °F');
  assert.equal(p.currentFeels, feelsLikeF(24.4 * 9 / 5 + 32, 48, 16.6), 'RH keeps priority when present');
});

test('DWD leaves currentFeels null when current_weather lacks the Steadman inputs', () => {
  responder = function(url, onSuccess) {
    if (url.indexOf('/current_weather') !== -1) {
      onSuccess(JSON.stringify({ weather: { temperature: 20 } }));   // no rh/wind
      return;
    }
    onSuccess(JSON.stringify({ weather: [
      { temperature: 0, precipitation_probability: 0, precipitation: 0, wind_speed: 0, wind_gust_speed: 0, timestamp: '2023-11-14T22:00:00+00:00' }
    ] }));
  };
  const p = new DwdProvider();
  p.withProviderData(0, 0, false, function() {}, function(f) { throw new Error('unexpected failure ' + JSON.stringify(f)); });
  assert.equal(p.currentFeels, null, 'null → FEELS_CURRENT omitted, temp slot degrades');
});
