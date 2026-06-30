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
  wuCache.anchorForecast([bucket(H15, 50, 0), bucket(H16, 60, 80)], H14);
  // During hour 15: WU rounded up; forecast[0] is H16 (pop 80).
  var out = wuCache.anchorForecast([bucket(H16, 61, 80), bucket(H17, 62, 90)], H15);
  assert.equal(out[0].fcst_valid, H15, 'anchored to the current hour');
  assert.equal(out[0].temp, 50, 'cached real H15 temp, not the H16 clone (61)');
  assert.equal(out[0].pop, 0, 'cached real H15 pop, not the H16 clone (80)');
});

test('repeated calls within the same hour keep using the cached current-hour bucket', () => {
  resetStore();
  wuCache.anchorForecast([bucket(H15, 50, 0), bucket(H16, 60, 80)], H14);  // capture H15
  wuCache.anchorForecast([bucket(H16, 61, 80), bucket(H17, 62, 90)], H15); // 1st fetch hour 15
  var out = wuCache.anchorForecast([bucket(H16, 61, 80), bucket(H17, 62, 90)], H15); // 2nd fetch hour 15
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

test('stored bucket holds exactly the seven consumed fields', () => {
  resetStore();
  var entry = { fcst_valid: H16, temp: 60, pop: 80, qpf: 0.2, wspd: 10, gust: 20, uv_index: 3, wxPhrase: 'Rain', extra: 1 };
  wuCache.anchorForecast([entry, bucket(H17, 62, 90)], H15);
  var cache = JSON.parse(store[CACHE_KEY]);
  var stored = cache[String(H16)];
  assert.deepEqual(
    Object.keys(stored).sort(),
    ['fcst_valid', 'gust', 'pop', 'qpf', 'temp', 'uv_index', 'wspd']
  );
});
