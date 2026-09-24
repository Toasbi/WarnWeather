const test = require('node:test');
const assert = require('node:assert/strict');
const { beforeEach } = require('node:test');
const storageKeys = require('../src/pkjs/storage-keys.js');

var store = { wundergroundApiKey: 'k' };   // pre-seed so withApiKey skips the scrape
global.localStorage = {
  getItem: function(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
  setItem: function(k, v) { store[k] = String(v); },
  removeItem: function(k) { delete store[k]; }
};

beforeEach(function() { delete store[storageKeys.WU_HOURLY_CACHE_KEY]; });

const WeatherProvider = require('../src/pkjs/weather/provider.js');
var responder;
WeatherProvider.request = function(url, type, onSuccess, onError) { responder(url, onSuccess, onError); };
const WundergroundProvider = require('../src/pkjs/weather/wunderground.js');
const isPlausiblePressure = require('../src/pkjs/weather/pressure-plausibility.js').isPlausiblePressure;
const fetchOptions = require('../src/pkjs/weather/fetch-options.js');

function round4(n) { return Math.round(n * 10000) / 10000; }

var HOUR = 3600;
// An on-the-hour epoch to anchor the deterministic clock in these tests.
var NOW_HOUR = 1700000000 - (1700000000 % HOUR); // 1699999200

/**
 * Run `fn` with Date.now() pinned to `epochSeconds * 1000`, then restore it.
 * @param {number} epochSeconds Fixed "now" in epoch seconds.
 * @param {Function} fn Body to execute under the frozen clock.
 * @returns {void}
 */
function withMockedNow(epochSeconds, fn) {
  var realNow = Date.now;
  Date.now = function() { return epochSeconds * 1000; };
  try { fn(); }
  finally { Date.now = realNow; }
}

function respondWith(forecasts, currentTemp) {
  return function(url, onSuccess) {
    if (url.indexOf('/wx/observations/current') !== -1) {
      onSuccess(JSON.stringify({ temperature: currentTemp }));
      return;
    }
    onSuccess(JSON.stringify({ forecasts: forecasts }));
  };
}

test('WU maps the hourly forecast with inches→mm and mph→km/h conversions', () => {
  // First bucket is already on the current hour → no synthetic bucket prepended.
  responder = respondWith([
    { temp: 50, pop: 40, qpf: 0.1, wspd: 10, gust: 20, uv_index: 3, fcst_valid: NOW_HOUR },
    { temp: 60, pop: 0, qpf: 0, wspd: 0, gust: null, uv_index: 0, fcst_valid: NOW_HOUR + HOUR }
  ], 71);
  const p = new WundergroundProvider();
  var ok = false;
  withMockedNow(NOW_HOUR + 800, function() {
    p.withProviderData(0, 0, false, function() { ok = true; }, function(f) { throw new Error('unexpected failure ' + JSON.stringify(f)); });
  });

  assert.equal(ok, true, 'onSuccess fires');
  assert.deepEqual(p.tempTrend, [50, 60], 'temp passthrough (units=e, °F)');
  assert.deepEqual(p.precipTrend, [0.4, 0], 'pop /100');
  assert.equal(round4(p.rainTrend[0]), 2.54, 'qpf inches→mm (0.1 × 25.4)');
  assert.equal(p.rainTrend[1], 0);
  assert.equal(round4(p.windTrend[0]), 16.0934, 'wind mph→km/h');
  assert.equal(round4(p.gustTrend[0]), 32.1868, 'gust mph→km/h (max(20,10))');
  assert.equal(p.startTime, NOW_HOUR, 'startTime = current-hour bucket (already present, no prepend)');
  assert.equal(p.currentTemp, 71, 'currentTemp from the current observation');
});

test('WU anchors the forecast to the current wall-clock hour when the feed starts at the next hour', () => {
  // WU's hourly feed rounds up: at :13 past the hour its first bucket is the
  // NEXT full hour, omitting the in-progress hour every other provider shows.
  responder = respondWith([
    { temp: 50, pop: 40, qpf: 0.1, wspd: 10, gust: 20, uv_index: 3, fcst_valid: NOW_HOUR + HOUR },
    { temp: 60, pop: 0, qpf: 0, wspd: 0, gust: null, uv_index: 0, fcst_valid: NOW_HOUR + 2 * HOUR }
  ], 71);
  const p = new WundergroundProvider();
  var ok = false;
  withMockedNow(NOW_HOUR + 800, function() { // 13:20 into the current hour
    p.withProviderData(0, 0, false, function() { ok = true; }, function(f) { throw new Error('unexpected failure ' + JSON.stringify(f)); });
  });

  assert.equal(ok, true, 'onSuccess fires');
  assert.equal(p.startTime, NOW_HOUR, 'startTime snaps to the current floored hour, not the next hour');
  assert.deepEqual(p.tempTrend, [50, 50, 60], 'a current-hour bucket (cloned from the first real hour) is prepended');
  assert.deepEqual(p.precipTrend, [0.4, 0.4, 0], 'prepended current-hour bucket mirrors the first real hour');
});

test('WU gust falls back to wind speed when gust is null', () => {
  responder = respondWith([
    { temp: 50, pop: 0, qpf: 0, wspd: 15, gust: null, uv_index: 0, fcst_valid: NOW_HOUR }
  ], 50);
  const p = new WundergroundProvider();
  withMockedNow(NOW_HOUR + 800, function() {
    p.withProviderData(0, 0, false, function() {}, function(f) { throw new Error('unexpected failure ' + JSON.stringify(f)); });
  });
  assert.equal(round4(p.gustTrend[0]), 24.1401, 'null gust → wind speed (15 mph → km/h)');
});

test('WU reuses the cached current-hour forecast across the hour boundary', () => {
  // Fetch during the hour before NOW_HOUR: WU's soonest bucket is NOW_HOUR (pop 0) → cached.
  responder = respondWith([
    { temp: 50, pop: 0, qpf: 0, wspd: 0, gust: null, uv_index: 0, fcst_valid: NOW_HOUR },
    { temp: 60, pop: 80, qpf: 0.2, wspd: 10, gust: 20, uv_index: 3, fcst_valid: NOW_HOUR + HOUR }
  ], 49);
  withMockedNow(NOW_HOUR - HOUR + 800, function() {
    new WundergroundProvider().withProviderData(0, 0, false, function() {}, function(f) { throw new Error(JSON.stringify(f)); });
  });

  // Fetch during NOW_HOUR: WU rounded up to NOW_HOUR+HOUR (pop 80). The current-hour
  // bar must use the cached NOW_HOUR forecast (pop 0), not a clone of the next hour.
  responder = respondWith([
    { temp: 61, pop: 80, qpf: 0.2, wspd: 10, gust: 20, uv_index: 3, fcst_valid: NOW_HOUR + HOUR },
    { temp: 62, pop: 90, qpf: 0.3, wspd: 12, gust: 24, uv_index: 4, fcst_valid: NOW_HOUR + 2 * HOUR }
  ], 55);
  const p = new WundergroundProvider();
  withMockedNow(NOW_HOUR + 800, function() {
    p.withProviderData(0, 0, false, function() {}, function(f) { throw new Error(JSON.stringify(f)); });
  });

  assert.equal(p.startTime, NOW_HOUR, 'anchored to the current hour');
  assert.equal(p.tempTrend[0], 50, 'cached real current-hour temp, not the next-hour clone (61)');
  assert.equal(p.precipTrend[0], 0, 'cached real current-hour pop, not the next-hour clone (0.8)');
});

test('WU does not fill the current hour from the previous location after a location change', () => {
  // Fetch at A during the hour before NOW_HOUR: A's NOW_HOUR bucket (50°F, 30 mph) is cached.
  responder = respondWith([
    { temp: 50, pop: 90, qpf: 0, wspd: 30, gust: 45, uv_index: 0, fcst_valid: NOW_HOUR },
    { temp: 52, pop: 80, qpf: 0, wspd: 28, gust: 40, uv_index: 0, fcst_valid: NOW_HOUR + HOUR }
  ], 49);
  withMockedNow(NOW_HOUR - HOUR + 800, function() {
    new WundergroundProvider().withProviderData(52.52, 13.405, false, function() {},
      function(f) { throw new Error(JSON.stringify(f)); });
  });

  // Fetch at B during NOW_HOUR: WU rounded up to NOW_HOUR+HOUR. The current hour
  // must come from B's own feed, not A's captured bucket.
  responder = respondWith([
    { temp: 85, pop: 0, qpf: 0, wspd: 2, gust: 3, uv_index: 9, fcst_valid: NOW_HOUR + HOUR },
    { temp: 86, pop: 0, qpf: 0, wspd: 2, gust: 3, uv_index: 9, fcst_valid: NOW_HOUR + 2 * HOUR }
  ], 84);
  const p = new WundergroundProvider();
  withMockedNow(NOW_HOUR + 800, function() {
    p.withProviderData('48.137', '11.575', false, function() {},
      function(f) { throw new Error(JSON.stringify(f)); });
  });

  assert.equal(p.startTime, NOW_HOUR, 'anchored to the current hour');
  assert.equal(p.tempTrend[0], 85, 'B\'s soonest bucket, not A\'s captured 50');
  assert.equal(round4(p.windTrend[0]), 3.2187, 'B\'s wind (2 mph), not A\'s 30 mph');
});

test('wunderground converts mslp from inches of mercury (units=e) to hPa in pressureTrend', () => {
  // The v1 hourly call carries no units param, so the feed is units=e and mslp
  // is inHg (~29.9). Passed through raw it failed the 800-1100 hPa plausibility
  // window, so the pressure line and slot were always off for the default provider.
  responder = respondWith([
    { temp: 50, pop: 0, qpf: 0, wspd: 0, gust: 0, uv_index: 0, mslp: 30.09, fcst_valid: NOW_HOUR },
    // no mslp on this station feed -> 0, which forecast-series rejects (line off)
    { temp: 52, pop: 0, qpf: 0, wspd: 0, gust: 0, uv_index: 0, fcst_valid: NOW_HOUR + HOUR }
  ], 71);
  const p = new WundergroundProvider();
  withMockedNow(NOW_HOUR + 800, function() {
    p.withProviderData(0, 0, false, function() {},
      function(f) { throw new Error('unexpected failure ' + JSON.stringify(f)); });
  });
  assert.equal(Math.round(p.pressureTrend[0] * 10) / 10, 1019.0, '30.09 inHg ≈ 1019.0 hPa');
  assert.equal(p.pressureTrend[1], 0, 'missing mslp still zero-fills');
  assert.equal(isPlausiblePressure(p.pressureTrend[0]), true,
    'a units=e reading lands inside the hPa plausibility window');
});

test('WU maps v1 hourly feels_like and v3 current temperatureFeelsLike (both °F, units=e)', () => {
  responder = function(url, onSuccess) {
    if (url.indexOf('/wx/observations/current') !== -1) {
      onSuccess(JSON.stringify({ temperature: 71, temperatureFeelsLike: 66.4 }));
      return;
    }
    onSuccess(JSON.stringify({ forecasts: [
      { temp: 50, feels_like: 44, pop: 0, qpf: 0, wspd: 0, gust: 0, uv_index: 0, fcst_valid: NOW_HOUR },
      // no feels_like (e.g. the cache-cloned current-hour bucket) -> temp fallback
      { temp: 60, pop: 0, qpf: 0, wspd: 0, gust: 0, uv_index: 0, fcst_valid: NOW_HOUR + HOUR }
    ] }));
  };
  const p = new WundergroundProvider();
  withMockedNow(NOW_HOUR + 800, function() {
    p.withProviderData(0, 0, false, function() {},
      function(f) { throw new Error('unexpected failure ' + JSON.stringify(f)); });
  });
  assert.deepEqual(p.feelsTrend, [44, 60]);
  assert.equal(p.currentFeels, 66.4);
});

test('WU maps hourly dewpt into dewTrend (°F) and wdir into windDirTrend (degrees)', () => {
  responder = respondWith([
    { temp: 50, dewpt: 44, wdir: 270, pop: 0, qpf: 0, wspd: 10, gust: 20, uv_index: 0, fcst_valid: NOW_HOUR },
    { temp: 60, dewpt: 48, wdir: 15, pop: 0, qpf: 0, wspd: 0, gust: null, uv_index: 0, fcst_valid: NOW_HOUR + HOUR }
  ], 71);
  const p = new WundergroundProvider();
  withMockedNow(NOW_HOUR + 800, function() {
    p.withProviderData(0, 0, false, function() {},
      function(f) { throw new Error('unexpected failure ' + JSON.stringify(f)); });
  });

  // One entry per hourly slot. (Not p.numEntries: that is the 24-hour wire
  // window getPayload slices to; these fixtures are deliberately shorter, and
  // every other trend here is the same length as the forecast.)
  assert.equal(p.dewTrend.length, p.tempTrend.length, 'one dew entry per hourly slot');
  assert.equal(p.windDirTrend.length, p.tempTrend.length, 'one bearing per hourly slot');
  assert.deepEqual(p.dewTrend, [44, 48], 'dewpt passthrough (units=e default → °F)');
  assert.ok(p.dewTrend.every((v) => typeof v === 'number' && v >= -80 && v <= 140),
    'plausible °F numbers');
  assert.deepEqual(p.windDirTrend, [270, 15], 'wdir passthrough, "comes from" degrees');
  assert.ok(p.windDirTrend.every((v) => typeof v === 'number' && v >= 0 && v < 360),
    'bearings in [0, 360)');
});

test('WU degrades a missing dewpt/wdir to null, keeping the hourly slots aligned', () => {
  responder = respondWith([
    { temp: 50, dewpt: 44, wdir: 270, pop: 0, qpf: 0, wspd: 0, gust: 0, uv_index: 0, fcst_valid: NOW_HOUR },
    // a station feed without either field: null, never 0 (0 °F and 0° north are
    // both real values) and never the temp fallback feels_like uses
    { temp: 60, pop: 0, qpf: 0, wspd: 0, gust: 0, uv_index: 0, fcst_valid: NOW_HOUR + HOUR }
  ], 71);
  const p = new WundergroundProvider();
  withMockedNow(NOW_HOUR + 800, function() {
    p.withProviderData(0, 0, false, function() {},
      function(f) { throw new Error('unexpected failure ' + JSON.stringify(f)); });
  });
  assert.deepEqual(p.dewTrend, [44, null]);
  assert.deepEqual(p.windDirTrend, [270, null]);
});

test('WU wraps a 360 bearing to 0 so every value stays in [0, 360)', () => {
  responder = respondWith([
    { temp: 50, dewpt: 44, wdir: 360, pop: 0, qpf: 0, wspd: 0, gust: 0, uv_index: 0, fcst_valid: NOW_HOUR }
  ], 71);
  const p = new WundergroundProvider();
  withMockedNow(NOW_HOUR + 800, function() {
    p.withProviderData(0, 0, false, function() {},
      function(f) { throw new Error('unexpected failure ' + JSON.stringify(f)); });
  });
  assert.deepEqual(p.windDirTrend, [0]);
});

test('the anchored current-hour bucket keeps dew point and wind bearing', () => {
  // Regression guard for pickBucket's whitelist: the reconstructed current hour
  // silently loses any field the whitelist omits.
  responder = respondWith([
    { temp: 50, dewpt: 44, wdir: 270, pop: 0, qpf: 0, wspd: 0, gust: null, uv_index: 0, fcst_valid: NOW_HOUR },
    { temp: 60, dewpt: 55, wdir: 90, pop: 80, qpf: 0.2, wspd: 10, gust: 20, uv_index: 3, fcst_valid: NOW_HOUR + HOUR }
  ], 49);
  withMockedNow(NOW_HOUR - HOUR + 800, function() {   // capture NOW_HOUR into the cache
    new WundergroundProvider().withProviderData(0, 0, false, function() {},
      function(f) { throw new Error(JSON.stringify(f)); });
  });

  // WU has now rounded up past the in-progress hour; the cached bucket fills it.
  responder = respondWith([
    { temp: 61, dewpt: 55, wdir: 90, pop: 80, qpf: 0.2, wspd: 10, gust: 20, uv_index: 3, fcst_valid: NOW_HOUR + HOUR },
    { temp: 62, dewpt: 56, wdir: 100, pop: 90, qpf: 0.3, wspd: 12, gust: 24, uv_index: 4, fcst_valid: NOW_HOUR + 2 * HOUR }
  ], 55);
  const p = new WundergroundProvider();
  withMockedNow(NOW_HOUR + 800, function() {
    p.withProviderData(0, 0, false, function() {},
      function(f) { throw new Error(JSON.stringify(f)); });
  });

  assert.equal(p.dewTrend[0], 44, 'cached real current-hour dewpt, not the next-hour clone (55)');
  assert.equal(p.windDirTrend[0], 270, 'cached real current-hour wdir, not the next-hour clone (90)');
});

test('WU leaves currentFeels null when the observation has no temperatureFeelsLike', () => {
  responder = respondWith([
    { temp: 50, pop: 0, qpf: 0, wspd: 0, gust: 0, uv_index: 0, fcst_valid: NOW_HOUR }
  ], 71); // respondWith's current observation carries only `temperature`
  const p = new WundergroundProvider();
  withMockedNow(NOW_HOUR + 800, function() {
    p.withProviderData(0, 0, false, function() {},
      function(f) { throw new Error('unexpected failure ' + JSON.stringify(f)); });
  });
  assert.equal(p.currentFeels, null, 'null → FEELS_CURRENT omitted, temp slot degrades');
});

// ---- A revoked scraped key is re-scraped, once --------------------------
// The key is scraped from wunderground.com and cached for good; when
// weather.com rotated it, the 401 armed the indefinite auth backoff and the
// default provider stopped updating, with an 'API key error' pointing at a key
// field WU does not have — although dropping the key and scraping the current
// one fixes it with no user action.

/**
 * Route WU traffic: wunderground.com embeds `liveKey`; api.weather.com
 * answers `status` for any other key. Counts requests by kind.
 * @param {string} liveKey The key the scraped page embeds.
 * @param {number} [status] What api.weather.com answers a wrong key (401).
 * @returns {{scrapes: number, api: string[]}} Live request log.
 */
function wuRouter(liveKey, status) {
  var log = { scrapes: 0, api: [] };
  var ok = respondWith([
    { temp: 50, pop: 0, qpf: 0, wspd: 0, gust: 0, uv_index: 0, fcst_valid: NOW_HOUR }
  ], 71);
  responder = function(url, onSuccess, onError) {
    if (url.indexOf('www.wunderground.com') !== -1) {
      log.scrapes += 1;
      onSuccess('<script>var u="/v3/wx/observations/current?apiKey=' + liveKey + '&x";</script>');
      return;
    }
    var key = /apiKey=([a-z0-9]*)/.exec(url)[1];
    log.api.push(key);
    if (key !== liveKey) {
      onError({ code: 'status_' + (status || 401), detail: 'http_status' });
      return;
    }
    ok(url, onSuccess);
  };
  return log;
}

/**
 * Run one WU fetch cycle with `cachedKey` in storage (restoring the file's
 * default seed after) and report the outcome.
 * @param {?string} cachedKey Key cached before the cycle (null: none).
 * @param {boolean} force Forced fetch.
 * @returns {{ok: boolean, failures: Object[], key: ?string}} Outcome.
 */
function runWuCycle(cachedKey, force) {
  var out = { ok: false, failures: [], key: null };
  if (cachedKey === null) { delete store.wundergroundApiKey; }
  else { store.wundergroundApiKey = cachedKey; }
  try {
    withMockedNow(NOW_HOUR + 800, function() {
      new WundergroundProvider().withProviderData(0, 0, force,
        function() { out.ok = true; },
        function(f) { out.failures.push(f); });
    });
    out.key = Object.prototype.hasOwnProperty.call(store, 'wundergroundApiKey') ? store.wundergroundApiKey : null;
  } finally {
    store.wundergroundApiKey = 'k';
  }
  return out;
}

[401, 403].forEach(function(status) {
  test('a cached WU key refused with ' + status + ' is re-scraped once and the fetch succeeds', () => {
    var log = wuRouter('freshkey', status);
    var out = runWuCycle('revokedkey', false);
    assert.equal(out.ok, true, 'the cycle succeeds: ' + JSON.stringify(out.failures));
    assert.deepEqual(out.failures, []);
    assert.equal(log.scrapes, 1, 'one scrape');
    assert.deepEqual(log.api, ['revokedkey', 'freshkey', 'freshkey'],
      'refused once, then current + forecast with the fresh key');
    assert.equal(out.key, 'freshkey', 'the fresh key is cached');
  });
});

test('a freshly scraped key that is refused too fails as an auth failure, without looping', () => {
  const authBackoff = require('../src/pkjs/auth-backoff.js');
  // wunderground.com still embeds a key weather.com refuses.
  var log = wuRouter('neverworks');
  responder = (function(route) {
    return function(url, onSuccess, onError) {
      if (url.indexOf('api.weather.com') !== -1) {
        log.api.push(/apiKey=([a-z0-9]*)/.exec(url)[1]);
        onError({ code: 'status_401', detail: 'http_status' });
        return;
      }
      route(url, onSuccess, onError);
    };
  }(responder));
  var out = runWuCycle('revokedkey', false);
  assert.equal(out.ok, false);
  assert.equal(out.failures.length, 1, 'one failure reported');
  assert.deepEqual(out.failures[0], { stage: 'provider_data', code: 'wu_current_status_401' });
  assert.equal(authBackoff.isAuthFailure(out.failures[0]), true, 'the auth backoff still stops a real rejection');
  assert.equal(log.scrapes, 1, 'exactly one re-scrape');
  assert.deepEqual(log.api, ['revokedkey', 'neverworks']);
});

test('a forced fetch scrapes up front and does not scrape again on a refusal', () => {
  var log = wuRouter('livekey');
  responder = (function(route) {
    return function(url, onSuccess, onError) {
      if (url.indexOf('api.weather.com') !== -1) {
        log.api.push('x');
        onError({ code: 'status_403', detail: 'http_status' });
        return;
      }
      route(url, onSuccess, onError);
    };
  }(responder));
  var out = runWuCycle('oldkey', true);
  assert.equal(out.failures.length, 1);
  assert.equal(out.failures[0].code, 'wu_current_status_403');
  assert.equal(log.scrapes, 1);
  assert.equal(log.api.length, 1, 'no second attempt');
});

test('a cached WU key is kept on a failure that is not a key refusal', () => {
  var log = wuRouter('freshkey', 500);
  var out = runWuCycle('cachedkey', false);
  assert.deepEqual(out.failures, [{ stage: 'provider_data', code: 'wu_current_status_500' }]);
  assert.equal(log.scrapes, 0, 'no scrape for a server error');
  assert.equal(out.key, 'cachedkey');
});

// --- the Units tab's feels-like formula ----------------------------------------
// v1 hourly rh (%) + wspd (mph) and the v3 observation's relativeHumidity + windSpeed
// feed 'steadman'; an hour without rh keeps WU's own feels_like.
const feelsLikeF = require('../src/pkjs/weather/feels-like.js').feelsLikeF;
const mphToKmh = require('../src/pkjs/wire-units.js').mphToKmh;

test('WU + steadman recomputes feels from rh/wspd and the observation\'s humidity/wind', () => {
  responder = function(url, onSuccess) {
    if (url.indexOf('/wx/observations/current') !== -1) {
      onSuccess(JSON.stringify({ temperature: 59, temperatureFeelsLike: 57, relativeHumidity: 60, windSpeed: 6.2 }));
      return;
    }
    onSuccess(JSON.stringify({ forecasts: [
      { temp: 59, feels_like: 57, rh: 60, pop: 0, qpf: 0, wspd: 6.2, gust: 0, uv_index: 0, fcst_valid: NOW_HOUR },
      // no rh -> WU's own feels_like stays
      { temp: 60, feels_like: 58, pop: 0, qpf: 0, wspd: 6.2, gust: 0, uv_index: 0, fcst_valid: NOW_HOUR + HOUR }
    ] }));
  };
  const p = new WundergroundProvider();
  p.options = fetchOptions.defaults({ feelsFormula: 'steadman' });
  withMockedNow(NOW_HOUR + 800, function() {
    p.withProviderData(0, 0, false, function() {},
      function(f) { throw new Error('unexpected failure ' + JSON.stringify(f)); });
  });
  const expected = feelsLikeF(59, 60, mphToKmh(6.2));
  assert.deepEqual(p.feelsTrend, [expected, 58]);
  assert.equal(p.currentFeels, expected);
});

test('WU + steadman keeps the observation\'s temperatureFeelsLike when it lacks humidity', () => {
  responder = function(url, onSuccess) {
    if (url.indexOf('/wx/observations/current') !== -1) {
      onSuccess(JSON.stringify({ temperature: 59, temperatureFeelsLike: 57, windSpeed: 6.2 }));
      return;
    }
    onSuccess(JSON.stringify({ forecasts: [
      { temp: 59, feels_like: 57, rh: 60, pop: 0, qpf: 0, wspd: 6.2, gust: 0, uv_index: 0, fcst_valid: NOW_HOUR }
    ] }));
  };
  const p = new WundergroundProvider();
  p.options = fetchOptions.defaults({ feelsFormula: 'steadman' });
  withMockedNow(NOW_HOUR + 800, function() {
    p.withProviderData(0, 0, false, function() {},
      function(f) { throw new Error('unexpected failure ' + JSON.stringify(f)); });
  });
  assert.equal(p.currentFeels, 57);
});

// --- the provider seam: mapped forecast + adoptMapped's gates ------------------

test('WU lands the feed\'s UV when options.fetchUv is on', () => {
  responder = respondWith([
    { temp: 50, pop: 0, qpf: 0, wspd: 0, gust: 0, uv_index: 3, fcst_valid: NOW_HOUR },
    // a missing uv_index reads as 0, as before
    { temp: 60, pop: 0, qpf: 0, wspd: 0, gust: 0, fcst_valid: NOW_HOUR + HOUR }
  ], 71);
  const p = new WundergroundProvider();
  p.options = fetchOptions.defaults({ fetchUv: true });
  withMockedNow(NOW_HOUR + 800, function() {
    p.withProviderData(0, 0, false, function() {},
      function(f) { throw new Error('unexpected failure ' + JSON.stringify(f)); });
  });
  assert.deepEqual(p.uvTrend, [3, 0]);
});

test('WU leaves uvTrend empty when options.fetchUv is off, also on a reused instance', () => {
  responder = respondWith([
    { temp: 50, pop: 0, qpf: 0, wspd: 0, gust: 0, uv_index: 3, fcst_valid: NOW_HOUR },
    { temp: 60, pop: 0, qpf: 0, wspd: 0, gust: 0, uv_index: 5, fcst_valid: NOW_HOUR + HOUR }
  ], 71);
  const p = new WundergroundProvider();
  p.options = fetchOptions.defaults({ fetchUv: true });
  withMockedNow(NOW_HOUR + 800, function() {
    p.withProviderData(0, 0, false, function() {},
      function(f) { throw new Error('unexpected failure ' + JSON.stringify(f)); });
  });
  assert.deepEqual(p.uvTrend, [3, 5], 'precondition: the first cycle adopted UV');

  // The UV selection went away: the next cycle's options turn fetchUv off.
  p.options = fetchOptions.defaults({ fetchUv: false });
  withMockedNow(NOW_HOUR + 800, function() {
    p.withProviderData(0, 0, false, function() {},
      function(f) { throw new Error('unexpected failure ' + JSON.stringify(f)); });
  });
  assert.deepEqual(p.uvTrend, [], 'no stale UV from the previous cycle');
  assert.deepEqual(p.tempTrend, [50, 60], 'the rest of the forecast still lands');
});

test('WU drops feels-like when options.fetchFeels is off', () => {
  responder = function(url, onSuccess) {
    if (url.indexOf('/wx/observations/current') !== -1) {
      onSuccess(JSON.stringify({ temperature: 71, temperatureFeelsLike: 66.4, relativeHumidity: 60, windSpeed: 5 }));
      return;
    }
    onSuccess(JSON.stringify({ forecasts: [
      { temp: 50, feels_like: 44, rh: 60, pop: 0, qpf: 0, wspd: 0, gust: 0, uv_index: 0, fcst_valid: NOW_HOUR }
    ] }));
  };
  const p = new WundergroundProvider();
  p.options = fetchOptions.defaults({ fetchFeels: false });
  withMockedNow(NOW_HOUR + 800, function() {
    p.withProviderData(0, 0, false, function() {},
      function(f) { throw new Error('unexpected failure ' + JSON.stringify(f)); });
  });
  assert.deepEqual(p.feelsTrend, []);
  assert.equal(p.currentFeels, null);
});

test('WU mapForecast emits only MAPPED_KEYS, including every core key', () => {
  const MAPPED_KEYS = WeatherProvider.MAPPED_KEYS;
  const mapped = WundergroundProvider.mapForecast([
    { temp: 50, feels_like: 44, rh: 60, pop: 40, qpf: 0.1, wspd: 10, gust: 20, uv_index: 3,
      mslp: 30.09, dewpt: 44, wdir: 270, fcst_valid: NOW_HOUR }
  ], { temp: 71, feels: 66.4, humidity: 55, windKmh: 8 });
  Object.keys(mapped).forEach(function(key) {
    assert.ok(MAPPED_KEYS.all.indexOf(key) !== -1, key + ' is in MAPPED_KEYS.all');
  });
  MAPPED_KEYS.core.forEach(function(key) {
    assert.ok(Object.prototype.hasOwnProperty.call(mapped, key), 'core key ' + key + ' is mapped');
  });
  // WU sources an API feels-like AND humidity: the resolver inputs ride along
  // raw, so adoptMapped (not the adapter) applies the formula.
  assert.deepEqual(mapped.feelsTrend, [44]);
  assert.deepEqual(mapped.humidityTrend, [60]);
  assert.equal(mapped.currentFeels, 66.4);
  assert.equal(mapped.currentHumidity, 55);
  assert.equal(mapped.currentWindKmh, 8);
});
