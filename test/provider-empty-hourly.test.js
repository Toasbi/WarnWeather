// test/provider-empty-hourly.test.js
// Regression (G1 / S2): a provider response with an empty `hourly` forecast
// array must route to `onFailure`, not throw uncaught. Pre-fix the `hourly[0]`
// dereference ran outside any try/catch, so an empty `hourly: []` killed the
// fetch chain silently with a TypeError.
const test = require('node:test');
const assert = require('node:assert/strict');

// Stub the shared transport BEFORE the provider modules capture
// `var request = WeatherProvider.request;` at module-eval time. Each request
// resolves synchronously with whatever `responder` returns, so the whole
// withProviderData chain runs synchronously and a throw surfaces here.
const WeatherProvider = require('../src/pkjs/weather/provider.js');
var responder;
WeatherProvider.request = function(url, type, onSuccess, onError) {
  responder(url, onSuccess, onError);
};

const OpenWeatherMapProvider = require('../src/pkjs/weather/openweathermap.js');
const DwdProvider = require('../src/pkjs/weather/dwd.js');

test('OWM withProviderData routes empty hourly[] to onFailure without throwing', () => {
  responder = function(url, onSuccess) {
    // `hourly: []` passes the truthiness guard but has no [0] element.
    onSuccess(JSON.stringify({ hourly: [], current: { temp: 50 }, daily: [{}, {}] }));
  };
  const provider = new OpenWeatherMapProvider('test-key');
  var failureArg = null;
  var succeeded = false;
  assert.doesNotThrow(function() {
    provider.withProviderData(0, 0, true,
      function() { succeeded = true; },
      function(f) { failureArg = f; });
  });
  assert.equal(succeeded, false, 'must not report success on empty hourly');
  assert.ok(failureArg, 'onFailure must be called');
  assert.equal(failureArg.stage, 'provider_data');
  assert.equal(failureArg.code, 'owm_empty_hourly');
});

test('DWD withProviderData routes empty forecast to onFailure with an accurate code', () => {
  // Without an explicit guard the empty `hourly` still gets caught downstream,
  // but mislabeled `dwd_current_parse_error`. The guard must reject the empty
  // forecast directly, before the current-weather call, with a forecast code.
  var requestedUrls = [];
  responder = function(url, onSuccess) {
    requestedUrls.push(url);
    // withDwdForecast reads JSON.parse(response).weather as the hourly array.
    onSuccess(JSON.stringify({ weather: [] }));
  };
  const provider = new DwdProvider();
  var failureArg = null;
  var succeeded = false;
  assert.doesNotThrow(function() {
    provider.withProviderData(0, 0, true,
      function() { succeeded = true; },
      function(f) { failureArg = f; });
  });
  assert.equal(succeeded, false, 'must not report success on empty forecast');
  assert.ok(failureArg, 'onFailure must be called');
  assert.equal(failureArg.stage, 'provider_data');
  assert.equal(failureArg.code, 'dwd_forecast_empty');
  // The guard must short-circuit before the /current_weather request fires.
  assert.equal(requestedUrls.length, 1, 'must not call current-weather on empty forecast');
});
