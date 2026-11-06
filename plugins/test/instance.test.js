'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const instance = require('../lib/instance');
const vocabulary = require('../lib/vocabulary');
const units = require('../lib/units');
const { validateEnvelope } = require('./helpers/validate');

const HOUR = 3600;
// 6 Nov 2026, 09:30 CET: local midnight is 23:00 UTC the day before.
const MIDNIGHT = Date.UTC(2026, 10, 5, 23) / 1000;
const NOW = MIDNIGHT + 9.5 * HOUR;
const CLEAR = { code: 'sun', short: 'Clear', long: 'Clear sky' };
const RAIN = { code: 'light_rain', short: 'Light rain', long: 'Slight rain' };

/**
 * A forecast with `hours` hourly readings from `start` and three days from midnight.
 *
 * @param {number} start Epoch seconds of the first hour.
 * @param {number} hours Hourly readings.
 * @returns {Object} Normalized forecast.
 */
function forecast(start, hours) {
  const series = (make) => Array.from({ length: hours }, (unused, i) => make(i));
  return {
    utcOffsetMin: 60,
    current: { temperature: 7.4, condition: CLEAR },
    hourly: {
      start,
      temperature: series((i) => i),
      precipitation: series((i) => (i % 2 ? 40 : 0)),
      precipitationAmount: series((i) => (i % 2 ? 0.6 : 0)),
      windSpeed: series(() => 18),
      uvIndex: series(() => null),
      condition: series((i) => (i % 2 ? RAIN : CLEAR)),
    },
    daily: {
      start: MIDNIGHT,
      high: [9, 11, 8],
      low: [1, 2, 0],
      condition: [RAIN, CLEAR, CLEAR],
      sunrise: [MIDNIGHT + 7 * HOUR, MIDNIGHT + 31 * HOUR, MIDNIGHT + 55 * HOUR],
      sunset: [MIDNIGHT + 16 * HOUR, MIDNIGHT + 40 * HOUR, MIDNIGHT + 64 * HOUR],
    },
  };
}

const PLACE = { id: 'home', name: 'Freiburg' };

/**
 * @param {Object} data Normalized forecast.
 * @param {Object} [extra] Options to override.
 * @returns {Object} Instance.
 */
function build(data, extra) {
  return instance.buildInstance(PLACE, data, Object.assign({
    units: units.DEFAULTS, nowSec: NOW, serves: vocabulary.ALL, wanted: null,
  }, extra));
}

test('local midnight in any zone', () => {
  assert.equal(instance.localMidnight(NOW, 60), MIDNIGHT);
  assert.equal(instance.localMidnight(Date.UTC(2026, 10, 6, 3) / 1000, -300), Date.UTC(2026, 10, 5, 5) / 1000);
  assert.equal(instance.localMidnight(Date.UTC(2026, 10, 6, 13) / 1000, 690), Date.UTC(2026, 10, 6, 12, 30) / 1000);
});

test('hourly series start at local midnight and run HOURLY_HOURS', () => {
  const properties = build(forecast(MIDNIGHT - 5 * HOUR, 200)).properties;
  const series = properties.hourly_temperature.series;
  assert.equal(series.start, MIDNIGHT);
  assert.equal(series.stepSec, HOUR);
  assert.equal(series.numericValue.values.length, instance.HOURLY_HOURS);
  // Five hours of yesterday are dropped: the first value is the hour at midnight.
  assert.equal(series.numericValue.values[0], 5);
  assert.equal(series.shortText.values[0], '5°C');
});

test('a forecast that starts after midnight is padded with missing hours, never shifted', () => {
  const series = build(forecast(MIDNIGHT + 3 * HOUR, 30)).properties.hourly_temperature.series;
  assert.deepEqual(series.numericValue.values.slice(0, 4), [null, null, null, 0]);
  assert.equal(series.numericValue.values.length, 33);
});

test('now reads the current block, else the hour now falls in', () => {
  const properties = build(forecast(MIDNIGHT, 48)).properties;
  assert.equal(properties.temperature.numericValue.value, 7.4);
  assert.equal(properties.condition.shortText.text, 'Clear');
  // 09:30 is in the hour starting 09:00: an odd hour, so 40% and 0.6 mm.
  assert.equal(properties.precipitation.numericValue.value, 40);
  assert.equal(properties.precipitation_amount.shortText.text, '0.6mm');
  assert.equal(properties.wind_speed.shortText.text, '18 km/h');
});

test('today is the daily block\'s day for the local date', () => {
  const properties = build(forecast(MIDNIGHT, 48)).properties;
  assert.equal(properties.high.shortText.text, '9°C');
  assert.equal(properties.low.numericValue.value, 1);
  assert.equal(properties.sunrise.timestamp.value, MIDNIGHT + 7 * HOUR);
  assert.equal(properties.sunrise.shortText.text, '07:00');
  assert.equal(properties.daily_high.series.start, MIDNIGHT);
  assert.deepEqual(properties.daily_high.series.numericValue.values, [9, 11, 8]);
  assert.deepEqual(properties.daily_condition_code.series.longText.values, ['light_rain', 'sun', 'sun']);
});

test('a day later the cached forecast is read from the new midnight', () => {
  const properties = build(forecast(MIDNIGHT, 72), { nowSec: NOW + 24 * HOUR }).properties;
  assert.equal(properties.hourly_temperature.series.start, MIDNIGHT + 24 * HOUR);
  assert.equal(properties.hourly_temperature.series.numericValue.values[0], 24);
  assert.equal(properties.high.numericValue.value, 11);
  assert.deepEqual(properties.daily_high.series.numericValue.values, [11, 8]);
});

test('readings a provider lacks are left out, not sent empty', () => {
  const properties = build(forecast(MIDNIGHT, 48)).properties;
  ['hourly_uv_index', 'uv_index', 'pressure', 'hourly_pressure', 'daily_wind_gust'].forEach((name) => {
    assert.equal(properties[name], undefined, name);
  });
});

test('a request for some properties gets only those', () => {
  const properties = build(forecast(MIDNIGHT, 48), { wanted: new Set(['name', 'temperature', 'nope']) }).properties;
  assert.deepEqual(Object.keys(properties), ['name', 'temperature']);
});

test('the user\'s units, in every shape alike', () => {
  const imperial = { temperature: '°F', wind: 'mph', pressure: 'inHg', precipitation: 'in', clock: '12h', locale: '' };
  const properties = build(forecast(MIDNIGHT, 48), { units: imperial }).properties;
  assert.deepEqual(properties.temperature.numericValue, { value: 45.3, unit: '°F' });
  assert.equal(properties.temperature.shortText.text, '45°F');
  assert.deepEqual(properties.hourly_wind_speed.series.numericValue.values.slice(0, 2), [11.2, 11.2]);
  assert.equal(properties.hourly_wind_speed.series.numericValue.unit, 'mph');
  assert.equal(properties.sunset.shortText.text, '4:00 PM');
});

test('everything built passes the Pebble app\'s validator against the full vocabulary', () => {
  const result = validateEnvelope({ instances: [build(forecast(MIDNIGHT, 120))] }, vocabulary.declare(vocabulary.ALL));
  assert.deepEqual(result.dropped, []);
});

test('the name and offset come from the place', () => {
  const properties = build(forecast(MIDNIGHT, 48)).properties;
  assert.deepEqual(properties.name, { shortText: { text: 'Freiburg' }, longText: { text: 'Freiburg' } });
  assert.deepEqual(properties.utc_offset, { numericValue: { value: 60, unit: 'min' } });
});
