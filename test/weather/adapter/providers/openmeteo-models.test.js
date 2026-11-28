// test/weather/adapter/providers/openmeteo-models.test.js — an Open-Meteo fetch with the weather
// model the settings pick (fetch-options.js openMeteoModel): the requests it makes, ECMWF's
// chance beside a model without one, and the default where the model has no forecast for the
// place. Patches WeatherProvider.request BEFORE requiring the adapter, which captures it for its
// aux calls at load.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const WeatherProvider = require('../../../../src/pkjs/weather/adapter/provider.js');
const fetchOptions = require('../../../../src/pkjs/weather/domain/fetch-options.js');
let responder;
WeatherProvider.request = function (url, type, onSuccess, onError) { responder(url, onSuccess, onError); };
const openmeteo = require('../../../../src/pkjs/weather/adapter/providers/openmeteo.js');

const HOUR = 3600;
const BASE = 1718841600;
const series = (n, f) => Array.from({ length: n }, (_, i) => f(i));

/**
 * A main answer of 72 hours: the temperature at bucket i is 50 + i, the chance 20 %, the
 * amount 1 mm.
 * @param {Object} [over] Hourly fields to replace.
 * @returns {Object}
 */
function mainAnswer(over) {
  const hourly = { time: series(72, (i) => BASE + i * HOUR), temperature_2m: series(72, (i) => 50 + i),
    precipitation_probability: series(72, () => 20), precipitation: series(72, () => 1),
    windspeed_10m: series(72, () => 10), windgusts_10m: series(72, () => null) };
  return { current: { temperature_2m: 61 }, hourly: Object.assign(hourly, over) };
}

/** @returns {Object} ECMWF's chance answer: 70 % every hour. */
function chanceAnswer() {
  return { hourly: { time: series(72, (i) => BASE + i * HOUR), precipitation_probability: series(72, () => 70) } };
}

/**
 * Answer every request as Open-Meteo would, a model's main request with `main` (an answer, or
 * a failure value for onError), and record the URLs.
 * @param {Object<string, *>} mains Model id → its main request's answer or {fail: error}.
 * @returns {string[]} The URLs asked, in order.
 */
function serve(mains) {
  const urls = [];
  responder = function (url, onSuccess, onError) {
    urls.push(url);
    if (url.indexOf('current=apparent_temperature') !== -1) {
      onSuccess(JSON.stringify({ hourly: { time: series(72, (i) => BASE + i * HOUR) }, current: {} }));
      return;
    }
    if (url.indexOf('hourly=precipitation_probability&') !== -1) {
      onSuccess(JSON.stringify(chanceAnswer()));
      return;
    }
    const model = /&models=([a-z0-9_]+)/.exec(url)[1];
    const answer = mains[model];
    if (answer && answer.fail) {
      onError(answer.fail);
      return;
    }
    onSuccess(JSON.stringify(answer || mainAnswer()));
  };
  return urls;
}

/**
 * One fetch with a model.
 * @param {Object} p An OpenMeteoProvider.
 * @param {number} lat Latitude.
 * @param {number} lon Longitude.
 * @returns {?Object} The failure value, or null on success.
 */
function fetch(p, lat, lon) {
  const realNow = Date.now;
  Date.now = function () { return (BASE + 8 * HOUR + 60) * 1000; };
  let outcome;
  try {
    p.withProviderData(lat, lon, false, function () { outcome = null; }, function (f) { outcome = f; });
  } finally {
    Date.now = realNow;
  }
  assert.notEqual(outcome, undefined, 'the fetch called back');
  return outcome;
}

/**
 * A provider with the model picked.
 * @param {string} model A model id.
 * @returns {Object}
 */
function providerWith(model) {
  const p = new openmeteo.OpenMeteoProvider();
  p.options = fetchOptions.defaults({ fetchUv: false, openMeteoModel: model });
  return p;
}

/**
 * The model each main request asked, in order.
 * @param {string[]} urls The URLs asked.
 * @returns {string[]}
 */
function mainModels(urls) {
  return urls.filter((u) => u.indexOf('hourly=temperature_2m') !== -1).map((u) => /&models=([a-z0-9_]+)/.exec(u)[1]);
}

test('the fetch asks the picked model, and takes its forecast without the amount it does not bring', () => {
  openmeteo._resetForTests();
  const urls = serve({});
  const p = providerWith('chmi_aladin_seamless');
  assert.equal(fetch(p, 50.08, 14.42), null);
  assert.deepEqual(mainModels(urls), ['chmi_aladin_seamless']);
  assert.equal(urls.length, 2, 'the main request, then the aux one');
  assert.equal(p.tempTrend[0], 58);
  assert.deepEqual(p.rainTrend, [], 'ALADIN\'s chance is ECMWF\'s: no amount');
  assert.equal(p.recoveredFailure, null);
  const own = providerWith('ukmo_seamless');
  assert.equal(fetch(own, 51.5, -0.12), null);
  assert.equal(own.rainTrend[0], 1, 'the Met Office\'s chance is its own: its amount');
});

test('a model without a chance asks ECMWF\'s first, and the forecast takes it', () => {
  openmeteo._resetForTests();
  const urls = serve({ meteofrance_seamless: mainAnswer({ precipitation_probability: series(72, () => null) }) });
  const p = providerWith('meteofrance_seamless');
  assert.equal(fetch(p, 48.85, 2.35), null);
  assert.match(urls[0], /hourly=precipitation_probability&[\s\S]*&models=ecmwf_ifs025/);
  assert.deepEqual(mainModels(urls), ['meteofrance_seamless']);
  assert.equal(p.precipTrend[0], 0.7);
  assert.deepEqual(p.rainTrend, []);
});

test('a failed chance request fails the forecast, with its own code', () => {
  openmeteo._resetForTests();
  const urls = serve({});
  responder = (function (inner) {
    return function (url, onSuccess, onError) {
      if (url.indexOf('hourly=precipitation_probability&') !== -1) {
        urls.push(url);
        onError({ code: 'status_503' });
        return;
      }
      inner(url, onSuccess, onError);
    };
  })(responder);
  const failure = fetch(providerWith('jma_seamless'), 35.68, 139.69);
  assert.deepEqual(failure, { stage: 'provider_data', code: 'openmeteo_chance_status_503' });
  assert.equal(urls.length, 1, 'the main request is not made');
});

test('where the model has no forecast, the fetch takes the default\'s and remembers the place', () => {
  openmeteo._resetForTests();
  const urls = serve({ chmi_aladin_seamless: { fail: { code: 'status_400' } } });
  const p = providerWith('chmi_aladin_seamless');
  assert.equal(fetch(p, 40.71, -74.0), null);
  assert.deepEqual(mainModels(urls), ['chmi_aladin_seamless', 'ecmwf_ifs025']);
  assert.equal(p.rainTrend[0], 1, 'the default\'s forecast, with its amount');
  assert.deepEqual(p.recoveredFailure, { stage: 'provider_data', code: 'openmeteo_status_400' },
    'the fetch\'s telemetry carries why once');
  p.recoveredFailure = null;
  urls.length = 0;
  assert.equal(fetch(p, 40.74, -74.03), null);
  assert.deepEqual(mainModels(urls), ['ecmwf_ifs025'], 'the same place, to a tenth: the default at once');
  assert.equal(p.recoveredFailure, null);
  urls.length = 0;
  assert.equal(fetch(p, 41.0, -74.0), null);
  assert.deepEqual(mainModels(urls), ['chmi_aladin_seamless', 'ecmwf_ifs025'], 'another place: the model again');
  urls.length = 0;
  assert.equal(fetch(providerWith('meteoswiss_icon_seamless'), 41.0, -74.0), null);
  assert.equal(mainModels(urls)[0], 'meteoswiss_icon_seamless', 'each model by its own places');
});

test('the fetch remembers a few places without a forecast: a position across a tenth\'s edge asks the model once', () => {
  openmeteo._resetForTests();
  const urls = serve({ chmi_aladin_seamless: { fail: { code: 'status_400' } } });
  const p = providerWith('chmi_aladin_seamless');
  const asked = (lat) => {
    urls.length = 0;
    assert.equal(fetch(p, lat, -74.0), null);
    return mainModels(urls);
  };
  const both = ['chmi_aladin_seamless', 'ecmwf_ifs025'];
  assert.deepEqual(asked(40.749), both);
  assert.deepEqual(asked(40.751), both, 'the next tenth');
  assert.deepEqual(asked(40.749), ['ecmwf_ifs025'], 'back across the edge: still known');
  assert.deepEqual(asked(40.751), ['ecmwf_ifs025']);
  [41.0, 41.2, 41.4, 41.6].forEach((lat) => assert.deepEqual(asked(lat), both, String(lat)));
  assert.deepEqual(asked(40.749), both, 'four newer places later, the first is asked again');
});

test('an answer without a day of temperatures takes the default too', () => {
  openmeteo._resetForTests();
  const urls = serve({ chmi_aladin_seamless: mainAnswer({ temperature_2m: series(72, () => null) }) });
  const p = providerWith('chmi_aladin_seamless');
  assert.equal(fetch(p, 40.71, -74.0), null);
  assert.deepEqual(mainModels(urls), ['chmi_aladin_seamless', 'ecmwf_ifs025']);
  assert.equal(p.recoveredFailure.code, 'openmeteo_missing_fields');
});

test('a failure the default would meet too fails the fetch: the server, the connection, the daily limit', () => {
  ['status_429', 'status_500', 'timeout', 'network_error'].forEach((code) => {
    openmeteo._resetForTests();
    const urls = serve({ chmi_aladin_seamless: { fail: { code: code } } });
    const failure = fetch(providerWith('chmi_aladin_seamless'), 50.08, 14.42);
    assert.deepEqual(failure, { stage: 'provider_data', code: 'openmeteo_' + code }, code);
    assert.deepEqual(mainModels(urls), ['chmi_aladin_seamless'], code + ': the default is not asked');
  });
});

test('the default with no forecast for the place fails the fetch, as before', () => {
  openmeteo._resetForTests();
  const urls = serve({ ecmwf_ifs025: { fail: { code: 'status_400' } } });
  assert.deepEqual(fetch(providerWith('ecmwf_ifs025'), 50.08, 14.42),
    { stage: 'provider_data', code: 'openmeteo_status_400' });
  assert.deepEqual(mainModels(urls), ['ecmwf_ifs025']);
});
