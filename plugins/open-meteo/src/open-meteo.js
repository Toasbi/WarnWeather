'use strict';

// Open-Meteo (https://open-meteo.com): keyless and worldwide. Two requests per place, with the same
// model choices the WarnWeather watchface makes (src/pkjs/weather/openmeteo.js), so the two agree:
//
// - the forecast pins ECMWF IFS 0.25° (models=ecmwf_ifs025). The default best_match blends models
//   and takes the chance of rain from a different one than the amount, so a 90% hour often comes
//   with 0.0 mm. ECMWF's amount tracks its own chance everywhere tested.
// - UV comes from GFS (models=ncep_gfs_global), since ECMWF IFS has none.
//
// timezone=auto makes every series start at the place's local midnight, as the plugin guide asks,
// and gives its UTC offset.

const http = require('../../lib/http');
const apparent = require('../../lib/apparent');
const instance = require('../../lib/instance');
const places = require('../../lib/places');
const { isNumber, num, first } = require('../../lib/values');

const BASE_URL = 'https://api.open-meteo.com/v1/forecast';
const HOUR = instance.HOUR;
const FORECAST_DAYS = 7;

// The ensemble behind ECMWF's chance of rain steps every 3 hours, on 00, 03, 06 ... UTC.
const ENSEMBLE_STEP = 3 * HOUR;

const CURRENT_FIELDS = [
  'temperature_2m', 'apparent_temperature', 'relative_humidity_2m', 'dew_point_2m', 'weather_code',
  'pressure_msl', 'cloud_cover', 'wind_speed_10m', 'wind_direction_10m', 'wind_gusts_10m',
];
const HOURLY_FIELDS = [
  'temperature_2m', 'apparent_temperature', 'relative_humidity_2m', 'dew_point_2m',
  'precipitation_probability', 'precipitation', 'weather_code', 'pressure_msl', 'cloud_cover',
  'wind_speed_10m', 'wind_direction_10m', 'wind_gusts_10m',
];
const DAILY_FIELDS = [
  'weather_code', 'temperature_2m_max', 'temperature_2m_min', 'sunrise', 'sunset',
  'precipitation_probability_max', 'precipitation_sum', 'wind_speed_10m_max', 'wind_gusts_10m_max',
];

// WMO weather interpretation codes (https://open-meteo.com/en/docs) onto the shared condition
// vocabulary, with a short (<= 12 characters) and a long (<= 32) phrase.
const WMO = {
  0: ['sun', 'Clear', 'Clear sky'],
  1: ['sun', 'Mainly clear', 'Mainly clear'],
  2: ['partly_cloudy', 'Some clouds', 'Partly cloudy'],
  3: ['cloudy', 'Overcast', 'Overcast'],
  45: ['cloudy', 'Fog', 'Fog'],
  48: ['cloudy', 'Rime fog', 'Depositing rime fog'],
  51: ['light_rain', 'Drizzle', 'Light drizzle'],
  53: ['light_rain', 'Drizzle', 'Moderate drizzle'],
  55: ['light_rain', 'Drizzle', 'Dense drizzle'],
  56: ['rain_and_snow', 'Icy drizzle', 'Light freezing drizzle'],
  57: ['rain_and_snow', 'Icy drizzle', 'Dense freezing drizzle'],
  61: ['light_rain', 'Light rain', 'Slight rain'],
  63: ['heavy_rain', 'Rain', 'Moderate rain'],
  65: ['heavy_rain', 'Heavy rain', 'Heavy rain'],
  66: ['rain_and_snow', 'Icy rain', 'Light freezing rain'],
  67: ['rain_and_snow', 'Icy rain', 'Heavy freezing rain'],
  71: ['light_snow', 'Light snow', 'Slight snowfall'],
  73: ['heavy_snow', 'Snow', 'Moderate snowfall'],
  75: ['heavy_snow', 'Heavy snow', 'Heavy snowfall'],
  77: ['light_snow', 'Snow grains', 'Snow grains'],
  80: ['light_rain', 'Showers', 'Slight rain showers'],
  81: ['heavy_rain', 'Showers', 'Moderate rain showers'],
  82: ['heavy_rain', 'Heavy shower', 'Violent rain showers'],
  85: ['light_snow', 'Snow shower', 'Slight snow showers'],
  86: ['heavy_snow', 'Snow showers', 'Heavy snow showers'],
  95: ['heavy_rain', 'Thunderstorm', 'Thunderstorm'],
  96: ['heavy_rain', 'Thunderstorm', 'Thunderstorm with slight hail'],
  99: ['heavy_rain', 'Thunderstorm', 'Thunderstorm with heavy hail'],
};

/**
 * A WMO weather code as a condition.
 *
 * @param {*} code WMO code.
 * @returns {{code: string, short: string, long: string}|null} The condition, or null without a code.
 */
function condition(code) {
  if (!isNumber(code)) {
    return null;
  }
  const entry = WMO[code];
  return entry ? { code: entry[0], short: entry[1], long: entry[2] }
    : { code: 'unknown', short: 'Unknown', long: 'Unknown' };
}

/**
 * The query both requests share.
 *
 * @param {{latitude: number, longitude: number}} coords Rounded coordinates.
 * @param {string} model Open-Meteo model id.
 * @returns {string} Query string, without the fields.
 */
function baseQuery(coords, model) {
  return BASE_URL
    + '?latitude=' + places.coordText(coords.latitude)
    + '&longitude=' + places.coordText(coords.longitude)
    + '&models=' + model
    + '&timezone=auto&timeformat=unixtime&forecast_days=' + FORECAST_DAYS;
}

/**
 * @param {{latitude: number, longitude: number}} coords Rounded coordinates.
 * @returns {string} The forecast request.
 */
function forecastUrl(coords) {
  return baseQuery(coords, 'ecmwf_ifs025')
    + '&temperature_unit=celsius&wind_speed_unit=kmh&precipitation_unit=mm'
    + '&current=' + CURRENT_FIELDS.join(',')
    + '&hourly=' + HOURLY_FIELDS.join(',')
    + '&daily=' + DAILY_FIELDS.join(',');
}

/**
 * @param {{latitude: number, longitude: number}} coords Rounded coordinates.
 * @returns {string} The UV request.
 */
function uvUrl(coords) {
  return baseQuery(coords, 'ncep_gfs_global') + '&hourly=uv_index&daily=uv_index_max';
}

/**
 * A lookup of a block's values by their timestamp.
 *
 * @param {Object} block An hourly or daily block ({time: [...], <field>: [...]}).
 * @returns {Function} (field, epochSec) => number|null.
 */
function byTime(block) {
  const index = {};
  const times = (block && Array.isArray(block.time)) ? block.time : [];
  times.forEach((time, i) => {
    index[time] = i;
  });
  return (field, time) => {
    const values = block && block[field];
    const i = index[time];
    return Array.isArray(values) && i !== undefined ? num(values[i]) : null;
  };
}

/**
 * The chance of rain for the hour starting at `time`. ECMWF's comes from its ensemble, which steps
 * every 3 hours: the bucket stamped on a 3-hour boundary holds that block's chance and the two in
 * between are a smooth blend. So the hour reads its own block's boundary (the first at or after the
 * hour's end), as the watchface does (openmeteo.js ensembleBlockSlice), falling back to the bucket
 * at the hour's end.
 *
 * @param {Function} at byTime lookup of the hourly block.
 * @param {number} time Epoch seconds the hour starts.
 * @returns {number|null} Percent.
 */
function ensembleChance(at, time) {
  const end = time + HOUR;
  const boundary = Math.ceil(end / ENSEMBLE_STEP) * ENSEMBLE_STEP;
  const block = at('precipitation_probability', boundary);
  return block !== null ? block : at('precipitation_probability', end);
}

/**
 * Normalize the two responses into a forecast (see lib/instance.js).
 *
 * Instants (temperature, humidity, dew point, pressure, cloud cover, wind speed and direction) are
 * read at their stamp. Open-Meteo stamps the precipitation amount, the gusts, the weather code and
 * GFS's UV at the END of the hour they cover, so the hour starting at T reads the bucket stamped
 * T + 1 h: read at T, every shower would land an hour late.
 *
 * @param {Object} main The forecast response.
 * @param {Object|null} uv The UV response, or null when it failed.
 * @returns {Object} Normalized forecast.
 */
function normalize(main, uv) {
  const times = main.hourly.time;
  const at = byTime(main.hourly);
  const uvAt = byTime(uv && uv.hourly);
  const hourly = {
    start: times[0],
    temperature: [],
    feelsLike: [],
    humidity: [],
    dewPoint: [],
    pressure: [],
    cloudCover: [],
    windSpeed: [],
    windDirection: [],
    windGust: [],
    precipitation: [],
    precipitationAmount: [],
    uvIndex: [],
    condition: [],
  };
  // The last bucket only closes the hour before it.
  for (let i = 0; i < times.length - 1; i += 1) {
    const time = times[i];
    const end = time + HOUR;
    const temperature = at('temperature_2m', time);
    const humidity = at('relative_humidity_2m', time);
    const windSpeed = at('wind_speed_10m', time);
    const feelsLike = at('apparent_temperature', time);
    hourly.temperature.push(temperature);
    hourly.feelsLike.push(first(feelsLike, apparent.apparentTemperature(temperature, humidity, windSpeed)));
    hourly.humidity.push(humidity);
    hourly.dewPoint.push(at('dew_point_2m', time));
    hourly.pressure.push(at('pressure_msl', time));
    hourly.cloudCover.push(at('cloud_cover', time));
    hourly.windSpeed.push(windSpeed);
    hourly.windDirection.push(at('wind_direction_10m', time));
    hourly.windGust.push(at('wind_gusts_10m', end));
    hourly.precipitation.push(ensembleChance(at, time));
    hourly.precipitationAmount.push(at('precipitation', end));
    hourly.uvIndex.push(uvAt('uv_index', end));
    hourly.condition.push(condition(at('weather_code', end)));
  }

  const days = main.daily || {};
  const dayAt = byTime(days);
  const uvDayAt = byTime(uv && uv.daily);
  const sunTime = (field, time) => {
    const value = dayAt(field, time);
    // Open-Meteo reports 0 for a sun that doesn't rise or set.
    return value ? value : null;
  };
  const dayTimes = Array.isArray(days.time) ? days.time : [];
  const daily = {
    start: dayTimes[0],
    high: dayTimes.map((time) => dayAt('temperature_2m_max', time)),
    low: dayTimes.map((time) => dayAt('temperature_2m_min', time)),
    condition: dayTimes.map((time) => condition(dayAt('weather_code', time))),
    precipitation: dayTimes.map((time) => dayAt('precipitation_probability_max', time)),
    precipitationAmount: dayTimes.map((time) => dayAt('precipitation_sum', time)),
    windSpeed: dayTimes.map((time) => dayAt('wind_speed_10m_max', time)),
    windGust: dayTimes.map((time) => dayAt('wind_gusts_10m_max', time)),
    uvIndex: dayTimes.map((time) => uvDayAt('uv_index_max', time)),
    sunrise: dayTimes.map((time) => sunTime('sunrise', time)),
    sunset: dayTimes.map((time) => sunTime('sunset', time)),
  };

  const now = main.current || {};
  const current = {
    temperature: num(now.temperature_2m),
    feelsLike: first(now.apparent_temperature, apparent.apparentTemperature(num(now.temperature_2m),
      num(now.relative_humidity_2m), num(now.wind_speed_10m))),
    humidity: num(now.relative_humidity_2m),
    dewPoint: num(now.dew_point_2m),
    pressure: num(now.pressure_msl),
    cloudCover: num(now.cloud_cover),
    windSpeed: num(now.wind_speed_10m),
    windDirection: num(now.wind_direction_10m),
    windGust: num(now.wind_gusts_10m),
    condition: condition(now.weather_code),
  };

  return {
    utcOffsetMin: Math.round((num(main.utc_offset_seconds) || 0) / 60),
    current,
    hourly,
    daily,
  };
}

/**
 * Whether a forecast response has what a forecast needs.
 *
 * @param {*} json Parsed response.
 * @returns {boolean} True when it has an hourly block with times and temperatures.
 */
function isUsable(json) {
  return Boolean(json && json.hourly && Array.isArray(json.hourly.time) && json.hourly.time.length > 1
    && Array.isArray(json.hourly.temperature_2m));
}

/**
 * Fetch and normalize the forecast for a place. A failed UV request only leaves UV out.
 *
 * @param {{latitude: number, longitude: number}} coords Rounded coordinates.
 * @returns {Promise<Object>} Normalized forecast.
 */
async function fetchForecast(coords) {
  const results = await Promise.all([
    http.getJson(forecastUrl(coords)),
    http.getJson(uvUrl(coords)).catch(() => null),
  ]);
  if (!isUsable(results[0])) {
    throw new Error('incomplete forecast');
  }
  return normalize(results[0], results[1]);
}

module.exports = {
  WMO,
  condition,
  forecastUrl,
  uvUrl,
  ensembleChance,
  normalize,
  fetchForecast,
};
