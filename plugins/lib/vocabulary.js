'use strict';

// The `weather/location` vocabulary these plugins serve, and the shapes each property comes in.
//
// Two kinds of names:
// - standard: the names the plugin guide documents for `weather/location` (Weather, under
//   Categories). The Pebble app's weather provider and other watchfaces read these.
// - extended: what a forecast graph needs beyond them (hourly rain, wind, UV, pressure, ...),
//   named the way the standard ones are, so they can be proposed upstream unchanged.
//
// Every property has a kind, and the kind decides its shapes. The Pebble app silently drops a
// shape the manifest doesn't declare, so the manifests and the instance builder both read this one
// table (plugins/test/manifest.test.js holds every package.json to it).

/**
 * The shapes of each kind of reading, in the order a manifest lists them. A condition code is a
 * longText alone, as the built-in weather plugin serves it and the app's weather provider reads it.
 */
const KINDS = {
  text: ['shortText', 'longText'],
  temperature: ['shortText', 'longText', 'numericValue'],
  percent: ['numericValue', 'shortText'],
  speed: ['numericValue', 'shortText'],
  direction: ['numericValue', 'shortText'],
  pressure: ['numericValue', 'shortText', 'longText'],
  amount: ['numericValue', 'shortText'],
  uv: ['numericValue', 'shortText'],
  offset: ['numericValue'],
  time: ['timestamp', 'shortText'],
  condition: ['shortText', 'longText'],
  code: ['longText'],
};

// scope says where the reading comes from:
//   place   - the place itself (its name) or its clock (utc_offset)
//   current - now: the forecast's current block, else the hour now falls in
//   today   - the local day now falls in
//   hourly  - a series of hours from local midnight
//   daily   - a series of days from local midnight
// field names the reading in the normalized forecast (lib/instance.js documents its shape).
const STANDARD = {
  name: { kind: 'text', scope: 'place' },
  temperature: { kind: 'temperature', scope: 'current', field: 'temperature' },
  feels_like: { kind: 'temperature', scope: 'current', field: 'feelsLike' },
  high: { kind: 'temperature', scope: 'today', field: 'high' },
  low: { kind: 'temperature', scope: 'today', field: 'low' },
  condition: { kind: 'condition', scope: 'current', field: 'condition' },
  condition_code: { kind: 'code', scope: 'current', field: 'condition' },
  uv_index: { kind: 'uv', scope: 'current', field: 'uvIndex' },
  precipitation: { kind: 'percent', scope: 'current', field: 'precipitation' },
  humidity: { kind: 'percent', scope: 'current', field: 'humidity' },
  wind_speed: { kind: 'speed', scope: 'current', field: 'windSpeed' },
  wind_direction: { kind: 'direction', scope: 'current', field: 'windDirection' },
  utc_offset: { kind: 'offset', scope: 'place' },
  sunrise: { kind: 'time', scope: 'today', field: 'sunrise' },
  sunset: { kind: 'time', scope: 'today', field: 'sunset' },
  hourly_temperature: { kind: 'temperature', scope: 'hourly', field: 'temperature' },
  hourly_condition: { kind: 'condition', scope: 'hourly', field: 'condition' },
  hourly_condition_code: { kind: 'code', scope: 'hourly', field: 'condition' },
  daily_high: { kind: 'temperature', scope: 'daily', field: 'high' },
  daily_low: { kind: 'temperature', scope: 'daily', field: 'low' },
  daily_condition: { kind: 'condition', scope: 'daily', field: 'condition' },
  daily_condition_code: { kind: 'code', scope: 'daily', field: 'condition' },
  daily_precipitation: { kind: 'percent', scope: 'daily', field: 'precipitation' },
  daily_sunrise: { kind: 'time', scope: 'daily', field: 'sunrise' },
  daily_sunset: { kind: 'time', scope: 'daily', field: 'sunset' },
};

// Interval readings (precipitation, precipitation_amount, wind_gust and the condition) cover the
// hour that STARTS at their stamp, like a bar drawn right of its tick.
const EXTENDED = {
  dew_point: { kind: 'temperature', scope: 'current', field: 'dewPoint' },
  wind_gust: { kind: 'speed', scope: 'current', field: 'windGust' },
  pressure: { kind: 'pressure', scope: 'current', field: 'pressure' },
  cloud_cover: { kind: 'percent', scope: 'current', field: 'cloudCover' },
  precipitation_amount: { kind: 'amount', scope: 'current', field: 'precipitationAmount' },
  hourly_feels_like: { kind: 'temperature', scope: 'hourly', field: 'feelsLike' },
  hourly_dew_point: { kind: 'temperature', scope: 'hourly', field: 'dewPoint' },
  hourly_precipitation: { kind: 'percent', scope: 'hourly', field: 'precipitation' },
  hourly_precipitation_amount: { kind: 'amount', scope: 'hourly', field: 'precipitationAmount' },
  hourly_humidity: { kind: 'percent', scope: 'hourly', field: 'humidity' },
  hourly_wind_speed: { kind: 'speed', scope: 'hourly', field: 'windSpeed' },
  hourly_wind_gust: { kind: 'speed', scope: 'hourly', field: 'windGust' },
  hourly_wind_direction: { kind: 'direction', scope: 'hourly', field: 'windDirection' },
  hourly_uv_index: { kind: 'uv', scope: 'hourly', field: 'uvIndex' },
  hourly_pressure: { kind: 'pressure', scope: 'hourly', field: 'pressure' },
  hourly_cloud_cover: { kind: 'percent', scope: 'hourly', field: 'cloudCover' },
  daily_precipitation_amount: { kind: 'amount', scope: 'daily', field: 'precipitationAmount' },
  daily_uv_index: { kind: 'uv', scope: 'daily', field: 'uvIndex' },
  daily_wind_speed: { kind: 'speed', scope: 'daily', field: 'windSpeed' },
  daily_wind_gust: { kind: 'speed', scope: 'daily', field: 'windGust' },
};

const PROPERTIES = Object.assign({}, STANDARD, EXTENDED);

/** Every property name, standard ones first. */
const ALL = Object.keys(PROPERTIES);

/**
 * Whether a property is a series (one reading per hour or day).
 *
 * @param {string} name Property name.
 * @returns {boolean} True for the hourly_* and daily_* properties.
 */
function isSeries(name) {
  const scope = PROPERTIES[name].scope;
  return scope === 'hourly' || scope === 'daily';
}

/**
 * The shapes a manifest declares for one property: its kind's shapes, as `series.<shape>` for a
 * series.
 *
 * @param {string} name Property name.
 * @returns {string[]} Declared shape names.
 */
function shapesOf(name) {
  const definition = PROPERTIES[name];
  if (!definition) {
    throw new Error('unknown property ' + name);
  }
  const shapes = KINDS[definition.kind];
  return isSeries(name) ? shapes.map((shape) => 'series.' + shape) : shapes.slice();
}

/**
 * The `properties` block of a manifest source serving these names.
 *
 * @param {string[]} names Property names, in the order to declare them.
 * @returns {Object<string, string[]>} Property name -> declared shapes.
 */
function declare(names) {
  const out = {};
  names.forEach((name) => {
    out[name] = shapesOf(name);
  });
  return out;
}

module.exports = {
  KINDS,
  STANDARD,
  EXTENDED,
  PROPERTIES,
  ALL,
  isSeries,
  shapesOf,
  declare,
};
