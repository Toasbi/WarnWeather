// test/weather/domain/forecast-model.test.js — the forecast model works on plain data: no
// provider instance, no clock (forecast-model.js). The provider base's own tests cover the
// rules in depth through WeatherProvider#adoptMapped and #getPayload.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const model = require('../../../src/pkjs/weather/domain/forecast-model.js');

test('adoptMapped fills a plain target by the mapped-key rules', () => {
  const target = { options: { fetchFeels: false, fetchUv: false }, numEntries: 2, rainTrend: [9, 9] };
  model.adoptMapped(target, { tempTrend: [50, 51], precipTrend: [0, 0], startTime: 100, currentTemp: 50 });
  assert.deepEqual(target.rainTrend, [0, 0], 'an absent zeroed series is zero-filled');
  assert.deepEqual(target.dewTrend, [], 'an absent empty series is []');
  assert.equal(target.currentCondition, null);
  assert.equal(target.currentTemp, 50);
});

test('buildPayload is a function of the fields and the time it is handed', () => {
  const forecast = { options: {}, numEntries: 2, tempTrend: [50.4, 60.6], precipTrend: [0.5, 1],
    rainTrend: [0, 1], windTrend: [0, 10], gustTrend: [0, 20], uvTrend: [], startTime: 100,
    currentTemp: 55, cityName: 'Bonn', sunEvents: [] };
  const a = model.buildPayload(forecast, 1700000000);
  const b = model.buildPayload(forecast, 1700000000);
  assert.deepEqual(a, b);
  assert.deepEqual(a.TEMP_RAW_TREND, [50, 61]);
  assert.equal(a.TEMP_MIN, 50);
  assert.equal(a.TEMP_MAX, 61);
  assert.equal(a.CITY, 'Bonn');
  assert.equal(a.NUM_ENTRIES, 2);
});

// --- adoptReadings: another provider's readings laid on by time (Per reading) ------------------

test('adoptReadings lays another forecast\'s readings on hour by hour, the values of the moment as they are', () => {
  const H = 3600;
  const fm = require('../../../src/pkjs/weather/domain/forecast-model.js');
  const target = { startTime: 10 * H, windTrend: [1, 1, 1], gustTrend: [2, 2, 2], currentCondition: 'clear' };
  const source = { startTime: 9 * H, windTrend: [10, 11, 12, 13], gustTrend: [20, 21, 22, 23], currentCondition: 'rain' };
  assert.equal(fm.adoptReadings(target, source, ['windTrend', 'gustTrend', 'currentCondition']), true);
  assert.deepEqual(target.windTrend, [11, 12, 13], 'from the hour the target starts at');
  assert.deepEqual(target.gustTrend, [21, 22, 23]);
  assert.equal(target.currentCondition, 'rain');
  const same = { startTime: 10 * H, dewTrend: [] };
  assert.equal(fm.adoptReadings(same, { startTime: 10 * H, dewTrend: [5, 6] }, ['dewTrend']), true);
  assert.deepEqual(same.dewTrend, [5, 6]);
});

test('adoptReadings lays nothing on where the hours do not line up, and drops a key the source lacks', () => {
  const H = 3600;
  const fm = require('../../../src/pkjs/weather/domain/forecast-model.js');
  const target = { startTime: 10 * H, windTrend: [1] };
  assert.equal(fm.adoptReadings(target, { startTime: 11 * H, windTrend: [9] }, ['windTrend']), false,
    'a source that starts later');
  assert.equal(fm.adoptReadings(target, { startTime: 10 * H - 1800, windTrend: [9] }, ['windTrend']), false,
    'off the hour grid');
  assert.deepEqual(target.windTrend, [1], 'left as it was');
  const lacking = { startTime: 10 * H, sunTimes: [{ type: 'sunrise', at: 1 }] };
  assert.equal(fm.adoptReadings(lacking, { startTime: 10 * H }, ['sunTimes']), true);
  assert.equal(Object.prototype.hasOwnProperty.call(lacking, 'sunTimes'), false);
});
