const test = require('node:test');
const assert = require('node:assert/strict');

const pollen = require('../src/pkjs/weather/pollen.js');

function feature(date, pollenInt, species) {
  return {
    type: 'Feature',
    properties: {
      FORECAST_DATE: date,
      POLLENINT: pollenInt,
      PARAMETER_NAME: species || 'Hasel'
    }
  };
}

test('buildUrl targets the DWD pollen WFS with a latitude-first point', () => {
  const url = pollen.buildUrl(52.52, 13.405);
  const decoded = decodeURIComponent(url);

  assert.match(url, /^https:\/\/maps\.dwd\.de\/geoserver\/dwd\/Pollenflug\/wfs\?/);
  assert.match(decoded, /service=WFS/i);
  assert.match(decoded, /version=2\.0\.0/i);
  assert.match(decoded, /request=GetFeature/i);
  assert.match(decoded, /typeNames=dwd:Pollenflug/i);
  assert.match(decoded, /outputFormat=application\/json/i);
  assert.match(decoded, /srsName=EPSG:4326/i);
  assert.match(decoded, /propertyName=FORECAST_DATE,POLLENINT/i);
  assert.match(decoded, /CQL_FILTER=INTERSECTS\(THE_GEOM,POINT\(52\.52 13\.405\)\)/i);
});

test('localDateKey uses the local calendar date with zero-padded month and day', () => {
  const localDate = new Date(2026, 1, 3, 23, 45);
  assert.equal(pollen.localDateKey(localDate), '2026-02-03');
});

test('worstToday maps every native POLLENINT ordinal', () => {
  const displays = ['0', '0-1', '1', '1-2', '2', '2-3', '3'];

  displays.forEach((display, pollenInt) => {
    assert.equal(
      pollen.worstToday({ features: [feature('2026-07-19T00:00:00Z', pollenInt)] }, '2026-07-19'),
      display,
      'POLLENINT ' + pollenInt
    );
  });
});

test('worstToday chooses the maximum across all eight species', () => {
  const species = ['Hasel', 'Erle', 'Esche', 'Birke', 'Graeser', 'Roggen', 'Beifuss', 'Ambrosia'];
  const features = species.map((name, index) => feature('2026-07-19T00:00:00Z', index === 6 ? 5 : index % 5, name));

  assert.equal(pollen.worstToday({ type: 'FeatureCollection', features }, '2026-07-19'), '2-3');
});

test('worstToday ignores other dates and accepts adjacent-region duplicates', () => {
  const features = [
    feature('2026-07-18T00:00:00Z', 6, 'Birke'),
    feature('2026-07-19T00:00:00Z', 2, 'Birke'),
    feature('2026-07-19T00:00:00Z', 4, 'Birke'),
    feature('2026-07-20T00:00:00Z', 6, 'Birke')
  ];

  assert.equal(pollen.worstToday({ features }, '2026-07-19'), '2');
});

test('worstToday ignores invalid values and malformed features', () => {
  const features = [
    feature('2026-07-19', -1),
    feature('2026-07-19', 7),
    feature('2026-07-19', 1.5),
    feature('2026-07-19', '6'),
    { type: 'Feature' },
    { type: 'Feature', properties: { FORECAST_DATE: '2026-07-19' } },
    null,
    feature('2026-07-19T00:00:00Z', 3)
  ];

  assert.equal(pollen.worstToday({ features }, '2026-07-19'), '1-2');
});

test('worstToday requires an exact date-time day boundary', () => {
  const features = [
    feature('2026-07-190T00:00:00Z', 6),
    feature('2026-07-19', 6),
    feature('2026-07-19 00:00:00Z', 6),
    feature('2026-07-19T00:00:00Z', 2)
  ];

  assert.equal(pollen.worstToday({ features }, '2026-07-19'), '1');
});

test('worstToday returns null for malformed envelopes or no valid today data', () => {
  [null, {}, { features: null }, { features: {} }, { features: [] }].forEach(json => {
    assert.equal(pollen.worstToday(json, '2026-07-19'), null);
  });
  assert.equal(
    pollen.worstToday({ features: [feature('2026-07-18', 6), feature('2026-07-19', -1)] }, '2026-07-19'),
    null
  );
});

test('fetchPollenInto skips the request when pollen fetching is disabled', () => {
  const WeatherProvider = require('../src/pkjs/weather/provider.js');
  const originalRequest = WeatherProvider.request;
  let requests = 0;
  let doneCalls = 0;
  WeatherProvider.request = function() { requests += 1; };
  try {
    pollen.fetchPollenInto({ fetchPollen: false }, 52.52, 13.405, function() { doneCalls += 1; });
  } finally {
    WeatherProvider.request = originalRequest;
  }
  assert.equal(requests, 0);
  assert.equal(doneCalls, 1);
});

test('fetchPollenInto writes valid today data and calls done exactly once', () => {
  const WeatherProvider = require('../src/pkjs/weather/provider.js');
  const originalRequest = WeatherProvider.request;
  const today = pollen.localDateKey(new Date());
  const provider = { fetchPollen: true, pollenToday: null };
  let requestedUrl;
  let requestedMethod;
  let doneCalls = 0;
  WeatherProvider.request = function(url, method, onSuccess) {
    requestedUrl = url;
    requestedMethod = method;
    onSuccess(JSON.stringify({ features: [feature(today + 'T00:00:00Z', 1), feature(today + 'T00:00:00Z', 6)] }));
  };
  try {
    pollen.fetchPollenInto(provider, 52.52, 13.405, function() { doneCalls += 1; });
  } finally {
    WeatherProvider.request = originalRequest;
  }
  assert.equal(requestedUrl, pollen.buildUrl(52.52, 13.405));
  assert.equal(requestedMethod, 'GET');
  assert.equal(provider.pollenToday, '3');
  assert.equal(doneCalls, 1);
});

test('fetchPollenInto leaves pollen unchanged when the response has no today data', () => {
  const WeatherProvider = require('../src/pkjs/weather/provider.js');
  const originalRequest = WeatherProvider.request;
  const provider = { fetchPollen: true, pollenToday: 'existing' };
  let doneCalls = 0;
  WeatherProvider.request = function(url, method, onSuccess) {
    onSuccess(JSON.stringify({ features: [feature('1999-01-01', 6)] }));
  };
  try {
    pollen.fetchPollenInto(provider, 52.52, 13.405, function() { doneCalls += 1; });
  } finally {
    WeatherProvider.request = originalRequest;
  }
  assert.equal(provider.pollenToday, 'existing');
  assert.equal(doneCalls, 1);
});

test('fetchPollenInto treats parse failures as non-fatal and calls done once', () => {
  const WeatherProvider = require('../src/pkjs/weather/provider.js');
  const originalRequest = WeatherProvider.request;
  const provider = { fetchPollen: true, pollenToday: 'existing' };
  let doneCalls = 0;
  WeatherProvider.request = function(url, method, onSuccess) { onSuccess('{invalid'); };
  try {
    pollen.fetchPollenInto(provider, 52.52, 13.405, function() { doneCalls += 1; });
  } finally {
    WeatherProvider.request = originalRequest;
  }
  assert.equal(provider.pollenToday, 'existing');
  assert.equal(doneCalls, 1);
});

test('fetchPollenInto treats transport failures as non-fatal and calls done once', () => {
  const WeatherProvider = require('../src/pkjs/weather/provider.js');
  const originalRequest = WeatherProvider.request;
  const provider = { fetchPollen: true, pollenToday: 'existing' };
  let doneCalls = 0;
  WeatherProvider.request = function(url, method, onSuccess, onError) {
    onError({ code: 500 });
  };
  try {
    pollen.fetchPollenInto(provider, 52.52, 13.405, function() { doneCalls += 1; });
  } finally {
    WeatherProvider.request = originalRequest;
  }
  assert.equal(provider.pollenToday, 'existing');
  assert.equal(doneCalls, 1);
});

test('fetchPollenInto ignores duplicate success callbacks after completing once', () => {
  const WeatherProvider = require('../src/pkjs/weather/provider.js');
  const originalRequest = WeatherProvider.request;
  const today = pollen.localDateKey(new Date()) + 'T00:00:00Z';
  const provider = { fetchPollen: true, pollenToday: null };
  let doneCalls = 0;
  WeatherProvider.request = function(url, method, onSuccess) {
    onSuccess(JSON.stringify({ features: [feature(today, 2)] }));
    onSuccess(JSON.stringify({ features: [feature(today, 6)] }));
  };
  try {
    pollen.fetchPollenInto(provider, 52.52, 13.405, function() { doneCalls += 1; });
  } finally {
    WeatherProvider.request = originalRequest;
  }
  assert.equal(provider.pollenToday, '1', 'late callback cannot mutate completed state');
  assert.equal(doneCalls, 1);
});

test('fetchPollenInto ignores an error callback after success', () => {
  const WeatherProvider = require('../src/pkjs/weather/provider.js');
  const originalRequest = WeatherProvider.request;
  const today = pollen.localDateKey(new Date()) + 'T00:00:00Z';
  const provider = { fetchPollen: true, pollenToday: null };
  let doneCalls = 0;
  WeatherProvider.request = function(url, method, onSuccess, onError) {
    onSuccess(JSON.stringify({ features: [feature(today, 4)] }));
    onError({ code: 500 });
  };
  try {
    pollen.fetchPollenInto(provider, 52.52, 13.405, function() { doneCalls += 1; });
  } finally {
    WeatherProvider.request = originalRequest;
  }
  assert.equal(provider.pollenToday, '2');
  assert.equal(doneCalls, 1);
});

test('fetchPollenInto treats a synchronous request throw as non-fatal', () => {
  const WeatherProvider = require('../src/pkjs/weather/provider.js');
  const originalRequest = WeatherProvider.request;
  const provider = { fetchPollen: true, pollenToday: 'existing' };
  let doneCalls = 0;
  WeatherProvider.request = function() { throw new Error('open failed'); };
  try {
    assert.doesNotThrow(() => {
      pollen.fetchPollenInto(provider, 52.52, 13.405, function() { doneCalls += 1; });
    });
  } finally {
    WeatherProvider.request = originalRequest;
  }
  assert.equal(provider.pollenToday, 'existing');
  assert.equal(doneCalls, 1);
});

test('WeatherProvider initializes and transiently exposes pollenToday', () => {
  const WeatherProvider = require('../src/pkjs/weather/provider.js');
  const provider = new WeatherProvider();
  assert.equal(provider.pollenToday, null);

  provider.tempTrend = [68];
  provider.precipTrend = [0];
  provider.currentTemp = 68;
  provider.startTime = 1700000000;
  provider.cityName = 'Berlin';
  provider.sunEvents = [{ type: 'sunrise', date: new Date(1700003600000) }];
  provider.numEntries = 1;
  provider.pollenToday = '1-2';
  assert.equal(provider.getPayload().POLLEN_TODAY, '1-2');
});

test('fetchWithCoordinates completes AQI then pollen before composing the payload', () => {
  const WeatherProvider = require('../src/pkjs/weather/provider.js');
  const airQuality = require('../src/pkjs/weather/air-quality.js');
  const outbox = require('../src/pkjs/outbox.js');
  const originalAqi = airQuality.fetchAqiInto;
  const originalPollen = pollen.fetchPollenInto;
  const originalSend = outbox.sendWeather;
  const provider = new WeatherProvider();
  const order = [];
  let composedPollen = null;

  provider.withCityName = function(lat, lon, done) { done('Berlin', 'DE'); };
  provider.withSunEvents = function(lat, lon, done) { done([]); };
  provider.withProviderData = function(lat, lon, force, done) { done(); };
  provider.hasValidData = function() { return true; };
  provider.composeWeatherPayload = function() {
    order.push('compose');
    composedPollen = provider.pollenToday;
    return {};
  };
  airQuality.fetchAqiInto = function(p, lat, lon, done) {
    order.push('aqi');
    done();
  };
  pollen.fetchPollenInto = function(p, lat, lon, done) {
    order.push('pollen');
    p.pollenToday = '3';
    done();
  };
  outbox.sendWeather = function(payload, done) {
    order.push('send');
    done();
  };

  try {
    provider.fetchWithCoordinates(52.52, 13.405, function() {}, assert.fail, false, {}, null);
  } finally {
    airQuality.fetchAqiInto = originalAqi;
    pollen.fetchPollenInto = originalPollen;
    outbox.sendWeather = originalSend;
  }
  assert.deepEqual(order, ['aqi', 'pollen', 'compose', 'send']);
  assert.equal(composedPollen, '3');
});
