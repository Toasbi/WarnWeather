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
