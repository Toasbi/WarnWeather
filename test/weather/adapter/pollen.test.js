// Install a localStorage mock BEFORE any watch module loads: the last good pollen answer
// (pollen-store.js) stands in for a refresh that brings none.
global.localStorage = (function () {
  const store = {};
  return {
    writes: 0,
    getItem: (k) => (k in store ? store[k] : null),
    setItem: function (k, v) { this.writes += 1; store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    clear: () => { Object.keys(store).forEach((k) => delete store[k]); }
  };
})();

const { testPorts } = require('../../helpers/source-ports.js');
const test = require('node:test');
// The time every bake in this file runs at, where the test does not care which it is.
const NOW = new Date(2026, 5, 15, 12, 0, 0);
// The aux fetches call http.request through the module object, so stubbing
// the property here intercepts them (the old seam was WeatherProvider.request).
const http = require('../../../src/pkjs/weather/adapter/http.js');
const assert = require('node:assert/strict');

const pollen = require('../../../src/pkjs/weather/adapter/pollen.js');
const pollenDays = require('../../../src/pkjs/weather/domain/pollen-days.js');
const fetchOptions = require('../../../src/pkjs/weather/domain/fetch-options.js');
const KEYS = require('../../../src/pkjs/settings/domain/storage-keys.js');

// Every test starts without a last good answer: one test's must not stand in for another's.
test.beforeEach(() => { localStorage.clear(); });

const DWD = fetchOptions.defaults({ fetchPollen: true, pollenSource: 'dwd' });
const CAMS = fetchOptions.defaults({ fetchPollen: true, pollenSource: 'cams' });

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

/**
 * A DWD answer with one feature for today and one for tomorrow.
 * @param {number} today Today's POLLENINT.
 * @param {number} tomorrow Tomorrow's POLLENINT.
 * @returns {string} The answer as the request hands it on.
 */
function dwdAnswer(today, tomorrow) {
  const now = new Date();
  return JSON.stringify({ features: [feature(pollenDays.localDateKey(now) + 'T00:00:00Z', today),
    feature(pollenDays.localDateKey(pollenDays.nextLocalDay(now)) + 'T00:00:00Z', tomorrow)] });
}

/**
 * A CAMS answer of 48 hours from today's local midnight: every type 0 but grass, at `grass`
 * grains on today's hours and `grassTomorrow` on the rest, each hour's day taken as
 * pollen-days.js takes it (a DST day has 23 or 25 hours).
 * @param {number} grass Today's grass value.
 * @param {number} grassTomorrow Tomorrow's grass value.
 * @returns {string} The answer as the request hands it on.
 */
function camsAnswer(grass, grassTomorrow) {
  const now = new Date();
  const today = pollenDays.localDateKey(now);
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() / 1000;
  const time = Array.from({ length: 48 }, (_, i) => midnight + i * 3600);
  const hourly = { time: time };
  pollenDays.CAMS_TYPES.forEach((type) => {
    hourly[type.field] = time.map((t) => (type.field !== 'grass_pollen' ? 0
      : pollenDays.localDateKey(new Date(t * 1000)) === today ? grass : grassTomorrow));
  });
  return JSON.stringify({ hourly: hourly });
}

/**
 * One pollen fetch with every request answered by `answer`.
 * @param {Object} options The fetch options.
 * @param {number} lat Latitude.
 * @param {number} lon Longitude.
 * @param {function(string, Function, Function)} answer Answers a request: (url, onSuccess, onError).
 * @param {Object} [seed] The provider's bands before the fetch.
 * @returns {{provider: Object, urls: string[], methods: string[], done: number}}
 */
function fetchWith(options, lat, lon, answer, seed) {
  const originalRequest = http.request;
  const provider = Object.assign({ options: options, pollenToday: null, pollenTomorrow: null }, seed);
  const urls = [];
  const methods = [];
  let done = 0;
  http.request = function (url, method, onSuccess, onError) {
    urls.push(url);
    methods.push(method);
    answer(url, onSuccess, onError);
  };
  try {
    pollen.fetchPollenInto(provider, lat, lon, function () { done += 1; });
  } finally {
    http.request = originalRequest;
  }
  return { provider: provider, urls: urls, methods: methods, done: done };
}

// The ways a refresh brings no band, for either source. The answer without today's band holds
// both sources' kinds: the DWD's reader reads its features, the CAMS forecast's its hours.
const FAILURES = {
  'a failed request': (url, onSuccess, onError) => onError({ stage: 'provider_data', code: 'timeout' }),
  'an answer that does not parse': (url, onSuccess) => onSuccess('{not json'),
  'an answer without today\'s band': (url, onSuccess) => onSuccess(JSON.stringify({
    features: [feature('1999-01-01T00:00:00Z', 6)], hourly: { time: [] } })),
  'a request that throws': () => { throw new Error('open failed'); }
};
// A good answer from each source: today's band '1', tomorrow's '3'.
const GOOD = {
  dwd: (url, onSuccess) => onSuccess(dwdAnswer(2, 6)),
  cams: (url, onSuccess) => onSuccess(camsAnswer(4, 40))
};

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

test('buildCamsUrl asks Open-Meteo for every CAMS type by the hour, over the place\'s today and tomorrow', () => {
  const url = pollen.buildCamsUrl('48.85661', 2.35222);
  assert.equal(url, 'https://air-quality-api.open-meteo.com/v1/air-quality?latitude=48.86&longitude=2.35'
    + '&hourly=alder_pollen,birch_pollen,grass_pollen,mugwort_pollen,olive_pollen,ragweed_pollen'
    + '&timeformat=unixtime&timezone=auto&forecast_days=2');
});

test('fetchPollenInto asks nothing with pollen off, or for a source pollen-days.js does not know', () => {
  const off = fetchOptions.defaults({ fetchPollen: false });
  const unknown = fetchOptions.defaults({ fetchPollen: true, pollenSource: 'cam' });
  [off, unknown].forEach((options) => {
    const run = fetchWith(options, 52.52, 13.405, () => assert.fail('no request'), { pollenToday: 'existing' });
    assert.deepEqual(run.urls, [], String(options.pollenSource));
    assert.equal(run.provider.pollenToday, 'existing');
    assert.equal(run.done, 1);
  });
});

test('with the DWD source the fetch writes today\'s worst band and calls done once', () => {
  const today = pollenDays.localDateKey(new Date()) + 'T00:00:00Z';
  const run = fetchWith(DWD, 52.52, 13.405, (url, onSuccess) => {
    onSuccess(JSON.stringify({ features: [feature(today, 1), feature(today, 6)] }));
  });
  assert.deepEqual(run.urls, [pollen.buildUrl(52.52, 13.405)]);
  assert.deepEqual(run.methods, ['GET']);
  assert.equal(run.provider.pollenToday, '3');
  assert.equal(run.done, 1);
});

test('with the DWD source the fetch writes tomorrow\'s worst band beside today\'s, from one request', () => {
  const now = new Date();
  const today = pollenDays.localDateKey(now) + 'T00:00:00Z';
  const tomorrow = pollenDays.localDateKey(pollenDays.nextLocalDay(now)) + 'T00:00:00Z';
  const run = fetchWith(DWD, 52.52, 13.405, (url, onSuccess) => {
    onSuccess(JSON.stringify({ features: [feature(today, 2, 'Birke'), feature(tomorrow, 5, 'Birke'),
      feature(tomorrow, 3, 'Graeser')] }));
  });
  assert.equal(run.urls.length, 1);
  assert.equal(run.provider.pollenToday, '1');
  assert.equal(run.provider.pollenTomorrow, '2-3');
});

test('with the DWD source the fetch leaves tomorrow unset while the DWD has not issued it', () => {
  const today = pollenDays.localDateKey(new Date()) + 'T00:00:00Z';
  const run = fetchWith(DWD, 52.52, 13.405, (url, onSuccess) => {
    onSuccess(JSON.stringify({ features: [feature(today, 4)] }));
  });
  assert.equal(run.provider.pollenToday, '2');
  assert.equal(run.provider.pollenTomorrow, null);
});

test('with the CAMS source the fetch writes today\'s and tomorrow\'s worst band in whole levels', () => {
  const run = fetchWith(CAMS, 48.86, 2.35, (url, onSuccess) => onSuccess(camsAnswer(40, 4)));
  assert.deepEqual(run.urls, [pollen.buildCamsUrl(48.86, 2.35)]);
  assert.equal(run.provider.pollenToday, '3', 'grass at 40: high');
  assert.equal(run.provider.pollenTomorrow, '1', 'grass at 4: low');
  assert.equal(run.done, 1);
});

test('outside the CAMS forecast\'s area the fetch asks nothing', () => {
  const run = fetchWith(CAMS, 40.71, -74.01, () => assert.fail('no request'));
  assert.deepEqual(run.urls, []);
  assert.equal(run.provider.pollenToday, null);
  assert.equal(run.done, 1);
});

test('a late callback cannot change a fetch that has completed', () => {
  const today = pollenDays.localDateKey(new Date()) + 'T00:00:00Z';
  const twice = fetchWith(DWD, 52.52, 13.405, (url, onSuccess) => {
    onSuccess(JSON.stringify({ features: [feature(today, 2)] }));
    onSuccess(JSON.stringify({ features: [feature(today, 6)] }));
  });
  assert.equal(twice.provider.pollenToday, '1', 'a second answer');
  assert.equal(twice.done, 1);
  const thenError = fetchWith(DWD, 52.52, 13.405, (url, onSuccess, onError) => {
    onSuccess(JSON.stringify({ features: [feature(today, 4)] }));
    onError({ code: 500 });
  });
  assert.equal(thenError.provider.pollenToday, '2', 'an error after the answer');
  assert.equal(thenError.done, 1);
});

test('a refresh that brings no band, with no last answer, leaves both bands as they are', () => {
  [DWD, CAMS].forEach((options) => {
    Object.keys(FAILURES).forEach((name) => {
      const label = options.pollenSource + ', ' + name;
      const run = fetchWith(options, 52.52, 13.405, FAILURES[name], { pollenToday: 'existing', pollenTomorrow: 'later' });
      assert.equal(run.urls.length, 1, label);
      assert.equal(run.provider.pollenToday, 'existing', label);
      assert.equal(run.provider.pollenTomorrow, 'later', label);
      assert.equal(run.done, 1, label);
    });
  });
});

test('a refresh that brings no band keeps the last answer\'s bands for the day, from either source', () => {
  [DWD, CAMS].forEach((options) => {
    localStorage.clear();
    fetchWith(options, 52.52, 13.405, GOOD[options.pollenSource]);
    Object.keys(FAILURES).forEach((name) => {
      const label = options.pollenSource + ', ' + name;
      const run = fetchWith(options, 52.54, 13.38, FAILURES[name]);
      assert.equal(run.provider.pollenToday, '1', label + ': today\'s band, from a place within 0.05°');
      assert.equal(run.provider.pollenTomorrow, '3', label + ': and tomorrow\'s');
      assert.equal(run.done, 1, label);
    });
  });
});

test('the stand-in comes only from the same source at the same place', () => {
  fetchWith(CAMS, 48.86, 2.35, GOOD.cams);
  const fail = FAILURES['a failed request'];
  assert.equal(fetchWith(CAMS, 48.95, 2.35, fail).provider.pollenToday, null, 'another place');
  assert.equal(fetchWith(DWD, 48.86, 2.35, fail).provider.pollenToday, null, 'another source');
});

test('only a good answer is kept, and only when it changed', () => {
  localStorage.writes = 0;
  fetchWith(CAMS, 48.86, 2.35, GOOD.cams);
  const stored = JSON.parse(localStorage.getItem(KEYS.LAST_POLLEN_KEY));
  assert.equal(stored.source, 'cams');
  assert.deepEqual([stored.lat, stored.lon], [48.86, 2.35]);
  assert.deepEqual(Object.keys(stored.bands).map((day) => stored.bands[day]), ['1', '3'], 'today\'s and tomorrow\'s');
  fetchWith(CAMS, 48.861, 2.351, GOOD.cams);
  assert.equal(localStorage.writes, 1, 'the same answer at the same place, to 2 decimals: no write');
  fetchWith(CAMS, 48.86, 2.35, FAILURES['a failed request']);
  assert.equal(localStorage.writes, 1, 'a failed refresh writes nothing');
});

test('WeatherProvider initializes and transiently exposes pollenToday', () => {
  const WeatherProvider = require('../../../src/pkjs/weather/adapter/provider.js');
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

test('WeatherProvider initializes and transiently exposes pollenTomorrow', () => {
  const WeatherProvider = require('../../../src/pkjs/weather/adapter/provider.js');
  const provider = new WeatherProvider();
  assert.equal(provider.pollenTomorrow, null);
  provider.tempTrend = [68];
  provider.precipTrend = [0];
  provider.currentTemp = 68;
  provider.startTime = 1700000000;
  provider.cityName = 'Berlin';
  provider.sunEvents = [{ type: 'sunrise', date: new Date(1700003600000) }];
  provider.numEntries = 1;
  assert.equal(provider.getPayload().POLLEN_TOMORROW, null);
  provider.pollenTomorrow = '3';
  assert.equal(provider.getPayload().POLLEN_TOMORROW, '3');
});

test('fetchWithCoordinates completes AQI then pollen before composing the payload', () => {
  const WeatherProvider = require('../../../src/pkjs/weather/adapter/provider.js');
  const airQuality = require('../../../src/pkjs/weather/adapter/air-quality.js');
  const outbox = require('../../../src/pkjs/wire/adapter/outbox.js');
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
    provider.fetchWithCoordinates(52.52, 13.405, function() {}, assert.fail, false, {}, null, undefined, testPorts());
  } finally {
    airQuality.fetchAqiInto = originalAqi;
    pollen.fetchPollenInto = originalPollen;
    outbox.sendWeather = originalSend;
  }
  assert.deepEqual(order, ['aqi', 'pollen', 'compose', 'send']);
  assert.equal(composedPollen, '3');
});

test('each fetch cycle resets today\'s and tomorrow\'s band: a refresh that brings neither packs -- and null', () => {
  const WeatherProvider = require('../../../src/pkjs/weather/adapter/provider.js');
  const airQuality = require('../../../src/pkjs/weather/adapter/air-quality.js');
  const renderPayload = require('../../../src/pkjs/weather/application/render-payload.js');
  const outbox = require('../../../src/pkjs/wire/adapter/outbox.js');
  const originalAqi = airQuality.fetchAqiInto;
  const originalPollen = pollen.fetchPollenInto;
  const originalSend = outbox.sendWeather;
  const provider = new WeatherProvider();
  const packedValues = [];
  const tomorrows = [];
  let pollenCalls = 0;
  let successCalls = 0;

  provider.withCityName = function(lat, lon, done) { done('Berlin', 'DE'); };
  provider.withSunEvents = function(lat, lon, done) {
    done([{ type: 'sunrise', date: new Date(1700003600000) }]);
  };
  provider.withProviderData = function(lat, lon, force, done) {
    provider.tempTrend = [68];
    provider.precipTrend = [0];
    provider.currentTemp = 68;
    provider.startTime = 1700000000;
    provider.numEntries = 1;
    done();
  };
  provider.hasValidData = function() { return true; };
  airQuality.fetchAqiInto = function(p, lat, lon, done) { done(); };
  // The second cycle's fetch brings no band and leaves the provider's as it finds them.
  pollen.fetchPollenInto = function(p, lat, lon, done) {
    pollenCalls += 1;
    if (pollenCalls === 1) { p.pollenToday = '2-3'; p.pollenTomorrow = '3'; }
    done();
  };
  outbox.sendWeather = function(payload, done) {
    var length = payload.STATUS_LINE_1_UINT8[2];
    packedValues.push(Buffer.from(payload.STATUS_LINE_1_UINT8.slice(3, 3 + length)).toString('utf8'));
    done();
  };

  const settings = {
    provider: 'dwd', statusForecastLeft: 'pollen', secondaryLine: 'precip_prob',
    thirdLine: 'off', barSource: 'off', theme: 'dark'
  };
  function transform(payload) {
    tomorrows.push(payload.POLLEN_TOMORROW);
    return renderPayload.toRenderPayload(payload, settings, { platform: 'basalt' }, NOW);
  }
  function fetchOnce() {
    provider.fetchWithCoordinates(52.52, 13.405, function() {
      successCalls += 1;
    }, assert.fail, false, {}, transform, undefined, testPorts());
  }

  try {
    fetchOnce();
    fetchOnce();
  } finally {
    airQuality.fetchAqiInto = originalAqi;
    pollen.fetchPollenInto = originalPollen;
    outbox.sendWeather = originalSend;
  }
  assert.deepEqual(packedValues, ['2-3', '--']);
  assert.deepEqual(tomorrows, ['3', null]);
  assert.equal(successCalls, 2);
});
