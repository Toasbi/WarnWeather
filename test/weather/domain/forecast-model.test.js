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

// --- adoptReadings: another provider's readings laid on by time (a reading pick) ---------------

test('adoptReadings lays another forecast\'s readings on hour by hour, the values of the moment as they are', () => {
  const H = 3600;
  const fm = require('../../../src/pkjs/weather/domain/forecast-model.js');
  const target = { startTime: 10 * H, windTrend: [1, 1, 1], gustTrend: [2, 2, 2], currentCondition: 'clear' };
  const source = { startTime: 9 * H, windTrend: [10, 11, 12, 13], gustTrend: [20, 21, 22, 23], currentCondition: 'rain' };
  assert.deepEqual(fm.adoptReadings(target, source, ['windTrend', 'gustTrend', 'currentCondition']),
    ['windTrend', 'gustTrend', 'currentCondition']);
  assert.deepEqual(target.windTrend, [11, 12, 13], 'from the hour the target starts at');
  assert.deepEqual(target.gustTrend, [21, 22, 23]);
  assert.equal(target.currentCondition, 'rain');
  const same = { startTime: 10 * H, dewTrend: [] };
  assert.deepEqual(fm.adoptReadings(same, { startTime: 10 * H, dewTrend: [5, 6] }, ['dewTrend']), ['dewTrend']);
  assert.deepEqual(same.dewTrend, [5, 6]);
});

test('adoptReadings lays only the values of the moment on where the hours do not line up', () => {
  const H = 3600;
  const fm = require('../../../src/pkjs/weather/domain/forecast-model.js');
  const target = { startTime: 10 * H, windTrend: [1], currentTemp: 50 };
  assert.deepEqual(fm.adoptReadings(target, { startTime: 11 * H, windTrend: [9], currentTemp: 60 },
    ['windTrend', 'currentTemp']), ['currentTemp'], 'a source that starts later');
  assert.equal(target.currentTemp, 60, 'the temperature now needs no hours');
  assert.deepEqual(fm.adoptReadings(target, { startTime: 10 * H - 1800, windTrend: [9] }, ['windTrend']), [],
    'off the hour grid');
  assert.deepEqual(target.windTrend, [1], 'left as it was');
});

test('adoptReadings drops a key the source lacks', () => {
  const H = 3600;
  const fm = require('../../../src/pkjs/weather/domain/forecast-model.js');
  const lacking = { startTime: 10 * H, sunTimes: [{ type: 'sunrise', at: 1 }] };
  assert.deepEqual(fm.adoptReadings(lacking, { startTime: 10 * H }, ['sunTimes']), ['sunTimes']);
  assert.equal(Object.prototype.hasOwnProperty.call(lacking, 'sunTimes'), false);
});

test('the hours from one start to another: whole hours on, else none', () => {
  const H = 3600;
  assert.equal(model.hourShift(10 * H, 12 * H), 2);
  assert.equal(model.hourShift(10 * H, 10 * H), 0);
  assert.equal(model.hourShift(12 * H, 10 * H), null, 'the second starts first');
  assert.equal(model.hourShift(10 * H, 10 * H + 1800), null, 'off the hour grid');
  assert.equal(model.hourShift(undefined, 10 * H), null);
});

