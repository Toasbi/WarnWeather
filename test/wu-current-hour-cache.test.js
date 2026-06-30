const test = require('node:test');
const assert = require('node:assert/strict');

const wuCache = require('../src/pkjs/weather/wu-current-hour-cache.js');

var HOUR = 3600;
var H14 = 1700000000 - (1700000000 % HOUR); // on the hour
var H15 = H14 + HOUR;
var H16 = H14 + 2 * HOUR;
var H17 = H14 + 3 * HOUR;

function bucket(fcstValid, temp, pop) {
  return { fcst_valid: fcstValid, temp: temp, pop: pop, qpf: 0, wspd: 0, gust: null, uv_index: 0 };
}

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
