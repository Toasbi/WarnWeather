const test = require('node:test');
const assert = require('node:assert/strict');

var store = {};
global.localStorage = {
  getItem: function(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
  setItem: function(k, v) { store[k] = String(v); },
  removeItem: function(k) { delete store[k]; }
};

const wuCache = require('../src/pkjs/weather/wu-current-hour-cache.js');
const CACHE_KEY = require('../src/pkjs/storage-keys.js').WU_HOURLY_CACHE_KEY;

var HOUR = 3600;
var H14 = 1700000000 - (1700000000 % HOUR); // on the hour
var H15 = H14 + HOUR;
var H16 = H14 + 2 * HOUR;
var H17 = H14 + 3 * HOUR;
// Two fetch locations far enough apart that their forecasts differ.
var A_LAT = 52.52, A_LON = 13.405;   // location A
var B_LAT = 48.137, B_LON = 11.575;  // location B

function bucket(fcstValid, temp, pop) {
  return { fcst_valid: fcstValid, temp: temp, pop: pop, qpf: 0, wspd: 0, gust: null, uv_index: 0 };
}

function resetStore() { for (var k in store) { if (Object.prototype.hasOwnProperty.call(store, k)) { delete store[k]; } } }

test('WU dropped the current hour: prepends a clone of the soonest bucket at hourFloor', () => {
  var out = wuCache.anchorForecast([bucket(H16, 60, 80), bucket(H17, 62, 90)], H15);
  assert.equal(out.length, 3, 'one bucket prepended ahead of the two real ones');
  assert.equal(out[0].fcst_valid, H15, 'prepended bucket is stamped at the current hour');
  assert.equal(out[0].temp, 60, 'cloned from the soonest bucket (H16)');
});

test('WU still includes the current hour: passes through unchanged, no prepend', () => {
  var out = wuCache.anchorForecast([bucket(H15, 50, 0), bucket(H16, 60, 80)], H15);
  assert.equal(out.length, 2, 'nothing prepended');
  assert.equal(out[0].fcst_valid, H15);
  assert.equal(out[0].temp, 50);
});

test('drops buckets that are already in the past', () => {
  var out = wuCache.anchorForecast([bucket(H14, 40, 0), bucket(H15, 50, 0), bucket(H16, 60, 80)], H15);
  assert.equal(out[0].fcst_valid, H15, 'H14 dropped, anchored at H15');
  assert.equal(out.length, 2);
});

test('captures the upcoming hour and reuses it as the real current-hour bucket next hour', () => {
  resetStore();
  // During hour 14: soonest upcoming is H15 (pop 0) → captured.
  wuCache.anchorForecast([bucket(H15, 50, 0), bucket(H16, 60, 80)], H14, A_LAT, A_LON);
  // During hour 15: WU rounded up; forecast[0] is H16 (pop 80).
  var out = wuCache.anchorForecast([bucket(H16, 61, 80), bucket(H17, 62, 90)], H15, A_LAT, A_LON);
  assert.equal(out[0].fcst_valid, H15, 'anchored to the current hour');
  assert.equal(out[0].temp, 50, 'cached real H15 temp, not the H16 clone (61)');
  assert.equal(out[0].pop, 0, 'cached real H15 pop, not the H16 clone (80)');
});

test('repeated calls within the same hour keep using the cached current-hour bucket', () => {
  resetStore();
  wuCache.anchorForecast([bucket(H15, 50, 0), bucket(H16, 60, 80)], H14, A_LAT, A_LON);  // capture H15
  wuCache.anchorForecast([bucket(H16, 61, 80), bucket(H17, 62, 90)], H15, A_LAT, A_LON); // 1st fetch hour 15
  var out = wuCache.anchorForecast([bucket(H16, 61, 80), bucket(H17, 62, 90)], H15, A_LAT, A_LON); // 2nd fetch hour 15
  assert.equal(out[0].temp, 50, 'still the cached H15 value, not clobbered');
  assert.equal(out[0].pop, 0);
});

test('prunes cache entries for hours that have passed', () => {
  resetStore();
  wuCache.anchorForecast([bucket(H15, 50, 0), bucket(H16, 60, 80)], H14); // caches H15
  wuCache.anchorForecast([bucket(H17, 70, 10)], H16);                     // hourFloor H16 → H15 stale
  var cache = JSON.parse(store[CACHE_KEY]);
  assert.equal(Object.prototype.hasOwnProperty.call(cache, String(H15)), false, 'H15 pruned');
});

test('corrupt cache JSON does not throw and falls back to clone', () => {
  resetStore();
  store[CACHE_KEY] = '{not valid json';
  var out = wuCache.anchorForecast([bucket(H16, 60, 80)], H15);
  assert.equal(out[0].fcst_valid, H15);
  assert.equal(out[0].temp, 60, 'cloned from the soonest bucket');
});

test('stored bucket holds exactly the twelve consumed fields plus its capture coordinates', () => {
  resetStore();
  var entry = { fcst_valid: H16, temp: 60, pop: 80, qpf: 0.2, wspd: 10, gust: 20, uv_index: 3,
    feels_like: 55, rh: 70, mslp: 29.92, dewpt: 51, wdir: 270, wxPhrase: 'Rain', extra: 1 };
  wuCache.anchorForecast([entry, bucket(H17, 62, 90)], H15, A_LAT, A_LON);
  var cache = JSON.parse(store[CACHE_KEY]);
  var stored = cache[String(H16)];
  assert.deepEqual(
    Object.keys(stored).sort(),
    ['dewpt', 'fcst_valid', 'feels_like', 'gust', 'lat', 'lon', 'mslp', 'pop', 'qpf', 'rh', 'temp',
      'uv_index', 'wdir', 'wspd']
  );
  assert.equal(stored.lat, A_LAT);
  assert.equal(stored.lon, A_LON);
});

test('a location change does not reuse the old location\'s captured current hour', () => {
  resetStore();
  // Hour 14 at A captures A's H15 bucket (50°F, windy).
  wuCache.anchorForecast([
    { fcst_valid: H15, temp: 50, pop: 90, qpf: 0, wspd: 30, gust: 45, uv_index: 0, dewpt: 45, mslp: 29.23 },
    bucket(H16, 52, 80)
  ], H14, A_LAT, A_LON);
  // Hour 15 at B (manual location change): WU's feed for B starts at H16. The
  // current hour must be a clone of B's first bucket, not A's captured H15.
  var out = wuCache.anchorForecast([
    { fcst_valid: H16, temp: 85, pop: 0, qpf: 0, wspd: 2, gust: 3, uv_index: 9, dewpt: 60, mslp: 30.18 },
    bucket(H17, 86, 0)
  ], H15, B_LAT, B_LON);
  assert.equal(out[0].fcst_valid, H15, 'still anchored to the current hour');
  assert.equal(out[0].temp, 85, 'B\'s own soonest bucket, not A\'s captured 50');
  assert.equal(out[0].wspd, 2, 'B\'s wind, not A\'s 30 mph');
  assert.equal(out[0].mslp, 30.18);
  assert.equal(Object.prototype.hasOwnProperty.call(out[0], 'lat'), false,
    'the capture stamp never reaches the trend bucket');
});

test('GPS jitter at the same place still reuses the captured current hour', () => {
  resetStore();
  wuCache.anchorForecast([bucket(H15, 50, 0), bucket(H16, 60, 80)], H14, A_LAT, A_LON);
  var out = wuCache.anchorForecast([bucket(H16, 61, 80), bucket(H17, 62, 90)], H15,
    A_LAT + 0.004, A_LON - 0.003);
  assert.equal(out[0].temp, 50, 'cached real H15 temp at (about) the same place');
  assert.equal(out[0].pop, 0);
});

test('manual coordinates arriving as strings match the numeric capture', () => {
  resetStore();
  wuCache.anchorForecast([bucket(H15, 50, 0), bucket(H16, 60, 80)], H14, String(A_LAT), String(A_LON));
  var out = wuCache.anchorForecast([bucket(H16, 61, 80), bucket(H17, 62, 90)], H15, A_LAT, A_LON);
  assert.equal(out[0].temp, 50);
});

test('an entry captured before coordinates were stored falls back to the clone', () => {
  resetStore();
  var legacy = {};
  legacy[String(H15)] = { fcst_valid: H15, temp: 50, pop: 0, qpf: 0, wspd: 0, gust: null, uv_index: 0 };
  store[CACHE_KEY] = JSON.stringify(legacy);
  var out = wuCache.anchorForecast([bucket(H16, 61, 80), bucket(H17, 62, 90)], H15, A_LAT, A_LON);
  assert.equal(out[0].temp, 61, 'unknown capture location → clone of the soonest bucket');
});

test('anchor bucket carries dewpt and wdir so the dew slot and wind arrow stay real', () => {
  resetStore();
  // Same class of bug as the feels_like/mslp regression below: a field missing
  // from pickBucket's whitelist vanishes from the reconstructed current hour.
  var entry = { fcst_valid: H16, temp: 60, pop: 80, qpf: 0, wspd: 10, gust: 20, uv_index: 3,
    dewpt: 51, wdir: 270 };
  var out = wuCache.anchorForecast([entry, bucket(H17, 62, 90)], H15);
  assert.equal(out[0].fcst_valid, H15);
  assert.equal(out[0].dewpt, 51, 'clone keeps the captured dewpt');
  assert.equal(out[0].wdir, 270, 'clone keeps the captured wdir');
});

test('anchor bucket carries feels_like and mslp so the first trend point stays real', () => {
  resetStore();
  // Regression: pickBucket used to drop feels_like/mslp, so the prepended
  // current-hour bucket degraded feels to temp (and pressure to 0) every fetch.
  var entry = { fcst_valid: H16, temp: 60, pop: 80, qpf: 0, wspd: 10, gust: 20, uv_index: 3,
    feels_like: 51, mslp: 29.77 }; // raw inHg (units=e feed)
  var out = wuCache.anchorForecast([entry, bucket(H17, 62, 90)], H15);
  assert.equal(out[0].fcst_valid, H15);
  assert.equal(out[0].feels_like, 51, 'clone keeps the captured feels_like');
  assert.equal(out[0].mslp, 29.77, 'clone keeps the captured (raw) mslp');
});
