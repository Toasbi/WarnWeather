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

test('wunderground maps mslp (mean sea level pressure, mb == hPa) into pressureTrend', () => {
  responder = respondWith([
    { temp: 50, pop: 0, qpf: 0, wspd: 0, gust: 0, uv_index: 0, mslp: 1019, fcst_valid: NOW_HOUR },
    // no mslp on this station feed -> 0, which forecast-series rejects (line off)
    { temp: 52, pop: 0, qpf: 0, wspd: 0, gust: 0, uv_index: 0, fcst_valid: NOW_HOUR + HOUR }
  ], 71);
  const p = new WundergroundProvider();
  withMockedNow(NOW_HOUR + 800, function() {
    p.withProviderData(0, 0, false, function() {},
      function(f) { throw new Error('unexpected failure ' + JSON.stringify(f)); });
  });
  assert.deepEqual(p.pressureTrend, [1019, 0]);
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
