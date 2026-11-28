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
const pollenStore = require('../../../src/pkjs/weather/adapter/pollen-store.js');
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

test('buildCamsUrl asks Open-Meteo for every CAMS type by the hour, from the place\'s yesterday to the day after its tomorrow', () => {
  const url = pollen.buildCamsUrl('48.85661', 2.35222);
  assert.equal(url, 'https://air-quality-api.open-meteo.com/v1/air-quality?latitude=48.86&longitude=2.35'
    + '&hourly=alder_pollen,birch_pollen,grass_pollen,mugwort_pollen,olive_pollen,ragweed_pollen'
    + '&timeformat=unixtime&timezone=auto&past_days=1&forecast_days=3');
});

/**
 * Answers a CAMS request as Open-Meteo does for a place whose current day began at `placeDay`
 * (timezone=auto): by the hour from that day's start past_days days back, for past_days +
 * forecast_days days. Grass is at 4 on the phone's today and 40 on its tomorrow, every other
 * hour and type at 0.
 * @param {number} placeDay Epoch seconds of the place's midnight that began its current day.
 * @returns {function(string, Function)} The request's answer: (url, onSuccess).
 */
function camsAround(placeDay) {
  return (url, onSuccess) => {
    const query = new URL(url).searchParams;
    const past = Number(query.get('past_days'));
    const time = Array.from({ length: (past + Number(query.get('forecast_days'))) * 24 },
      (_, i) => placeDay - past * 86400 + i * 3600);
    const now = new Date();
    const grass = {};
    grass[pollenDays.localDateKey(now)] = 4;
    grass[pollenDays.localDateKey(pollenDays.nextLocalDay(now))] = 40;
    const hourly = { time: time };
    pollenDays.CAMS_TYPES.forEach((type) => {
      hourly[type.field] = time.map((t) => (type.field === 'grass_pollen'
        ? grass[pollenDays.localDateKey(new Date(t * 1000))] || 0 : 0));
    });
    onSuccess(JSON.stringify({ hourly: hourly }));
  };
}

test('with the CAMS source the phone\'s today and tomorrow are whole wherever the place\'s day begins', (t) => {
  // The phone's hour, and where the place's current day began, in hours from the phone's
  // midnight: a phone on New York time with Berlin as the place, at 20:00, and a phone on
  // Berlin time with New York, at 03:00.
  const CASES = [
    { hour: 20, placeDay: 18, what: 'the place\'s day began this evening' },
    { hour: 3, placeDay: 6 - 24, what: 'the place\'s day began yesterday morning' }
  ];
  t.mock.timers.enable({ apis: ['Date'] });
  CASES.forEach((c) => {
    localStorage.clear();
    t.mock.timers.setTime(new Date(2026, 5, 15, c.hour, 0, 0).getTime());
    const midnight = new Date(2026, 5, 15).getTime() / 1000;
    const run = fetchWith(CAMS, 48.86, 2.35, camsAround(midnight + c.placeDay * 3600));
    assert.equal(run.provider.pollenToday, '1', c.what + ': today\'s band');
    assert.equal(run.provider.pollenTomorrow, '3', c.what + ': tomorrow\'s band');
  });
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

test('outside the CAMS forecast\'s area the fetch asks nothing, and nothing stands in', () => {
  const run = fetchWith(CAMS, 40.71, -74.01, () => assert.fail('no request'));
  assert.deepEqual(run.urls, []);
  assert.equal(run.provider.pollenToday, null);
  assert.equal(run.done, 1);
  // A good answer just inside the area's north edge is kept; 0.03° beyond it, past the edge,
  // it does not stand in, though it is within 0.05°.
  fetchWith(CAMS, 71.99, 10, GOOD.cams);
  const beyond = fetchWith(CAMS, 72.02, 10, () => assert.fail('no request'));
  assert.deepEqual([beyond.provider.pollenToday, beyond.provider.pollenTomorrow, beyond.done], [null, null, 1]);
});

test('a fetch whose bands fail to settle still finishes, and leaves the bands as they are', () => {
  const settle = pollenDays.settle;
  pollenDays.settle = () => { throw new Error('settle failed'); };
  try {
    const run = fetchWith(CAMS, 48.86, 2.35, GOOD.cams, { pollenToday: 'existing', pollenTomorrow: 'later' });
    assert.equal(run.done, 1);
    assert.equal(run.provider.pollenToday, 'existing');
    assert.equal(run.provider.pollenTomorrow, 'later');
  } finally {
    pollenDays.settle = settle;
  }
});

test('the last answer\'s store never throws: an unreadable record is none, and a failing store costs only the stand-in', () => {
  localStorage.setItem(KEYS.LAST_POLLEN_KEY, '{not json');
  assert.equal(pollenStore.read(), null, 'an unreadable record');
  const saved = global.localStorage;
  const throwing = () => { throw new Error('storage unavailable'); };
  global.localStorage = { getItem: throwing, setItem: throwing, removeItem: throwing, clear: throwing };
  try {
    assert.equal(pollenStore.read(), null, 'a store that cannot be read');
    assert.doesNotThrow(() => pollenStore.write({ source: 'cams', lat: 48.86, lon: 2.35, bands: {} }));
    const good = fetchWith(CAMS, 48.86, 2.35, GOOD.cams);
    assert.deepEqual([good.provider.pollenToday, good.provider.pollenTomorrow, good.done], ['1', '3', 1],
      'a good answer shows though it cannot be kept');
    const failed = fetchWith(CAMS, 48.86, 2.35, FAILURES['a failed request']);
    assert.deepEqual([failed.provider.pollenToday, failed.done], [null, 1], 'a failed refresh: no stand-in');
  } finally {
    global.localStorage = saved;
  }
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

test('fetchWithCoordinates asks for air quality and pollen side by side, and composes once both are done', () => {
  const WeatherProvider = require('../../../src/pkjs/weather/adapter/provider.js');
  const airQuality = require('../../../src/pkjs/weather/adapter/air-quality.js');
  const outbox = require('../../../src/pkjs/wire/adapter/outbox.js');
  const originalAqi = airQuality.fetchAqiInto;
  const originalPollen = pollen.fetchPollenInto;
  const originalSend = outbox.sendWeather;
  const provider = new WeatherProvider();
  const order = [];
  const answer = {};
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
  // Both answer only when the test says so.
  airQuality.fetchAqiInto = function(p, lat, lon, done) {
    order.push('aqi');
    answer.aqi = done;
  };
  pollen.fetchPollenInto = function(p, lat, lon, done) {
    order.push('pollen');
    p.pollenToday = '3';
    answer.pollen = done;
  };
  outbox.sendWeather = function(payload, done) {
    order.push('send');
    done();
  };

  try {
    provider.fetchWithCoordinates(52.52, 13.405, function() {}, assert.fail, false, {}, null, undefined, testPorts());
    assert.deepEqual(order, ['aqi', 'pollen'], 'pollen is asked before air quality answers');
    answer.pollen();
    answer.pollen();
    assert.deepEqual(order, ['aqi', 'pollen'], 'pollen alone composes nothing, however often it calls back');
    answer.aqi();
    answer.aqi();
  } finally {
    airQuality.fetchAqiInto = originalAqi;
    pollen.fetchPollenInto = originalPollen;
    outbox.sendWeather = originalSend;
  }
  assert.deepEqual(order, ['aqi', 'pollen', 'compose', 'send'], 'composed and sent once');
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

test('a failed refresh after a good one still sends the day\'s band, through the real adapter', () => {
  const WeatherProvider = require('../../../src/pkjs/weather/adapter/provider.js');
  const airQuality = require('../../../src/pkjs/weather/adapter/air-quality.js');
  const renderPayload = require('../../../src/pkjs/weather/application/render-payload.js');
  const outbox = require('../../../src/pkjs/wire/adapter/outbox.js');
  const originalAqi = airQuality.fetchAqiInto;
  const originalRequest = http.request;
  const originalSend = outbox.sendWeather;
  const provider = new WeatherProvider();
  provider.options = DWD;
  const packedValues = [];
  const tomorrows = [];
  const pollenUrls = [];

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
  // The DWD answers the first refresh and fails the second.
  http.request = function (url, method, onSuccess, onError) {
    pollenUrls.push(url);
    if (pollenUrls.length === 1) { GOOD.dwd(url, onSuccess); } else { FAILURES['a failed request'](url, onSuccess, onError); }
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
  try {
    [1, 2].forEach(() => provider.fetchWithCoordinates(52.52, 13.405, function() {}, assert.fail, false, {},
      transform, undefined, testPorts()));
  } finally {
    airQuality.fetchAqiInto = originalAqi;
    http.request = originalRequest;
    outbox.sendWeather = originalSend;
  }
  assert.deepEqual(pollenUrls, [pollen.buildUrl(52.52, 13.405), pollen.buildUrl(52.52, 13.405)]);
  assert.deepEqual(packedValues, ['1', '1'], 'today\'s band, the second time from the last answer');
  assert.deepEqual(tomorrows, ['3', '3']);
});
