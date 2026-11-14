'use strict';

// The Deutscher Wetterdienst's open data through Bright Sky (https://brightsky.dev): keyless, for
// Germany and the countries around it. Per place, /weather gives one record per hour (observations for
// the hours already past, DWD MOSMIX forecasts after) and /current_weather the latest observation.
//
// Bright Sky has no time zones, sunrise or UV. The area served is all Central European Time, so the
// place's offset is CET/CEST by the EU rule, and sunrise and sunset are worked out (lib/sun.js).
// UV isn't served.
//
// The record quirks are the ones the WarnWeather watchface handles (src/pkjs/weather/adapter/providers/dwd.js):
// forecast records have no relative humidity but always a dew point; precipitation, its chance and
// gusts cover the hour BEFORE a record's timestamp; the current observation reports wind only as
// 10/30/60-minute means.

const http = require('../../lib/http');
const apparent = require('../../lib/apparent');
const sun = require('../../lib/sun');
const instance = require('../../lib/instance');
const places = require('../../lib/places');
const { isNumber, num, first } = require('../../lib/values');

const BASE_URL = 'https://api.brightsky.dev';
const HOUR = instance.HOUR;
const DAY = instance.DAY;
const DAYS = 7;

/** Bright Sky's own default: the nearest DWD station within 50 km. */
const MAX_DIST_M = 50000;

/**
 * Germany and the countries around it (the Benelux east of 5°E, Denmark, Switzerland, Austria,
 * Czechia, western Poland): every place in it keeps Central European Time, which is what lets the
 * plugin work out the local day without a time zone database. The UK and anything east of it on
 * UTC+2 stay outside.
 */
const AREA = { south: 45.5, north: 56.0, west: 5.0, east: 17.5 };

/** The daytime hours a day's condition summarizes: 07:00 to 21:00 local. */
const DAYTIME = [7, 21];

const CONDITIONS = {
  clear: { code: 'sun', short: 'Clear', long: 'Clear' },
  partly: { code: 'partly_cloudy', short: 'Some clouds', long: 'Partly cloudy' },
  cloudy: { code: 'cloudy', short: 'Cloudy', long: 'Mostly cloudy' },
  overcast: { code: 'cloudy', short: 'Overcast', long: 'Overcast' },
  fog: { code: 'cloudy', short: 'Fog', long: 'Fog' },
  lightRain: { code: 'light_rain', short: 'Light rain', long: 'Light rain' },
  rain: { code: 'heavy_rain', short: 'Rain', long: 'Rain' },
  heavyRain: { code: 'heavy_rain', short: 'Heavy rain', long: 'Heavy rain' },
  sleet: { code: 'rain_and_snow', short: 'Sleet', long: 'Sleet' },
  lightSnow: { code: 'light_snow', short: 'Light snow', long: 'Light snow' },
  snow: { code: 'heavy_snow', short: 'Snow', long: 'Snow' },
  hail: { code: 'heavy_rain', short: 'Hail', long: 'Hail' },
  thunderstorm: { code: 'heavy_rain', short: 'Thunderstorm', long: 'Thunderstorm' },
};

// A day's condition: its most severe precipitation, else the sky most of its daytime hours had.
const SEVERITY = ['heavy_rain', 'rain_and_snow', 'heavy_snow', 'light_snow', 'light_rain'];
const SKIES = ['cloudy', 'partly_cloudy', 'sun'];

/**
 * Whether Bright Sky serves a place here.
 *
 * @param {{latitude: number, longitude: number}} coords Coordinates.
 * @returns {boolean} True inside AREA.
 */
function covers(coords) {
  return coords.latitude >= AREA.south && coords.latitude <= AREA.north
    && coords.longitude >= AREA.west && coords.longitude <= AREA.east;
}

/**
 * Midnight UTC on the last Sunday of a month.
 *
 * @param {number} year Year.
 * @param {number} month Month, 0-11.
 * @returns {number} Epoch ms.
 */
function lastSunday(year, month) {
  const lastDay = new Date(Date.UTC(year, month + 1, 0));
  return Date.UTC(year, month, lastDay.getUTCDate() - lastDay.getUTCDay());
}

/**
 * Central European Time's offset at a moment: summer time from 01:00 UTC on the last Sunday in
 * March to 01:00 UTC on the last Sunday in October.
 *
 * @param {number} ms Epoch ms.
 * @returns {number} 120 in summer, else 60 (minutes east of UTC).
 */
function centralEuropeanOffset(ms) {
  const year = new Date(ms).getUTCFullYear();
  const start = lastSunday(year, 2) + HOUR * 1000;
  const end = lastSunday(year, 9) + HOUR * 1000;
  return ms >= start && ms < end ? 120 : 60;
}

/**
 * The condition for an hour (or the current observation).
 *
 * @param {string|null} type Bright Sky's condition for the hour: dry, fog, rain, sleet, snow, hail,
 *   thunderstorm.
 * @param {number|null} amount Precipitation in the hour, mm.
 * @param {boolean} fog Fog at the hour's start.
 * @param {number|null} cloudCover Percent.
 * @param {number|null} temperature °C, to tell snow from rain when only an amount is known.
 * @returns {{code: string, short: string, long: string}|null} The condition, or null without data.
 */
function classify(type, amount, fog, cloudCover, temperature) {
  let kind = type;
  if ((!kind || kind === 'dry' || kind === 'fog') && isNumber(amount) && amount >= 0.1) {
    kind = isNumber(temperature) && temperature <= 0 ? 'snow' : 'rain';
  }
  switch (kind) {
    case 'thunderstorm':
      return CONDITIONS.thunderstorm;
    case 'hail':
      return CONDITIONS.hail;
    case 'sleet':
      return CONDITIONS.sleet;
    case 'snow':
      return isNumber(amount) && amount >= 1 ? CONDITIONS.snow : CONDITIONS.lightSnow;
    case 'rain':
      if (!isNumber(amount) || amount < 2.5) {
        return CONDITIONS.lightRain;
      }
      return amount >= 7.6 ? CONDITIONS.heavyRain : CONDITIONS.rain;
    default:
      break;
  }
  if (fog || kind === 'fog') {
    return CONDITIONS.fog;
  }
  if (!isNumber(cloudCover)) {
    return null;
  }
  if (cloudCover < 25) {
    return CONDITIONS.clear;
  }
  if (cloudCover < 75) {
    return CONDITIONS.partly;
  }
  return cloudCover < 95 ? CONDITIONS.cloudy : CONDITIONS.overcast;
}

/**
 * A day's condition from its daytime hours.
 *
 * @param {Array} conditions The hours' conditions (null for a missing one).
 * @returns {{code: string, short: string, long: string}|null} The day's condition.
 */
function summarize(conditions) {
  const present = conditions.filter(Boolean);
  for (let i = 0; i < SEVERITY.length; i += 1) {
    const hit = present.find((condition) => condition.code === SEVERITY[i]);
    if (hit) {
      return hit;
    }
  }
  let sky = [];
  SKIES.forEach((code) => {
    const hours = present.filter((condition) => condition.code === code);
    if (hours.length > sky.length) {
      sky = hours;
    }
  });
  // Within that sky, the phrase most of its hours had (an early fog doesn't name an overcast day).
  let best = null;
  let bestCount = 0;
  sky.forEach((condition) => {
    const count = sky.filter((other) => other.short === condition.short).length;
    if (count > bestCount) {
      best = condition;
      bestCount = count;
    }
  });
  return best;
}

/**
 * @param {number[]} values Values (nulls allowed).
 * @param {Function} pick Math.max or Math.min.
 * @param {number} [least] Readings needed for an answer (default 1).
 * @returns {number|null} The extreme, or null with too few readings.
 */
function extreme(values, pick, least) {
  const present = values.filter(isNumber);
  return present.length >= (least || 1) ? pick.apply(null, present) : null;
}

/**
 * The /weather request for a place, from local midnight through DAYS days. last_date is inclusive,
 * so the record that closes the last hour comes too.
 *
 * @param {{latitude: number, longitude: number}} coords Rounded coordinates.
 * @param {number} midnight Local midnight, epoch seconds.
 * @returns {string} URL.
 */
function weatherUrl(coords, midnight) {
  const iso = (sec) => encodeURIComponent(new Date(sec * 1000).toISOString());
  return BASE_URL + '/weather'
    + '?lat=' + places.coordText(coords.latitude)
    + '&lon=' + places.coordText(coords.longitude)
    + '&date=' + iso(midnight)
    + '&last_date=' + iso(midnight + DAYS * DAY)
    + '&max_dist=' + MAX_DIST_M;
}

/**
 * @param {{latitude: number, longitude: number}} coords Rounded coordinates.
 * @returns {string} The /current_weather request.
 */
function currentUrl(coords) {
  return BASE_URL + '/current_weather'
    + '?lat=' + places.coordText(coords.latitude)
    + '&lon=' + places.coordText(coords.longitude)
    + '&max_dist=' + MAX_DIST_M;
}

/**
 * The latest observation as the forecast's current block. Its wind is a 10/30/60-minute mean,
 * the shortest one present taken; its precipitation intensity likewise, scaled to an hour.
 *
 * @param {Object|null} record The /current_weather `weather` record.
 * @returns {Object} The current block (empty without an observation).
 */
function normalizeCurrent(record) {
  if (!record) {
    return {};
  }
  const temperature = num(record.temperature);
  const dewPoint = num(record.dew_point);
  const humidity = first(record.relative_humidity, apparent.humidityFromDewPoint(temperature, dewPoint));
  const windSpeed = first(record.wind_speed_10, record.wind_speed_30, record.wind_speed_60);
  let intensity = null;
  if (isNumber(record.precipitation_60)) {
    intensity = record.precipitation_60;
  } else if (isNumber(record.precipitation_30)) {
    intensity = record.precipitation_30 * 2;
  } else if (isNumber(record.precipitation_10)) {
    intensity = record.precipitation_10 * 6;
  }
  return {
    temperature,
    dewPoint,
    humidity,
    pressure: num(record.pressure_msl),
    cloudCover: num(record.cloud_cover),
    windSpeed,
    windGust: first(record.wind_gust_speed_10, record.wind_gust_speed_30, record.wind_gust_speed_60),
    windDirection: first(record.wind_direction_10, record.wind_direction_30, record.wind_direction_60),
    feelsLike: apparent.apparentTemperature(temperature, humidity, windSpeed),
    condition: classify(record.condition || null, intensity, record.condition === 'fog',
      num(record.cloud_cover), temperature),
  };
}

/**
 * Normalize the records into a forecast (see lib/instance.js).
 *
 * Each hour pairs two records BY TIMESTAMP, as the watchface does: the one stamped at the hour's
 * start gives its instants, the one stamped at its end the precipitation, its chance and the gusts
 * that hour had. A record Bright Sky skips leaves that hour's readings null rather than shifting
 * every later hour.
 *
 * @param {Object[]} records /weather records.
 * @param {Object|null} current /current_weather record.
 * @param {number} midnight Local midnight, epoch seconds.
 * @param {number} offsetMin UTC offset, minutes.
 * @param {{latitude: number, longitude: number}} coords Coordinates, for sunrise and sunset.
 * @returns {Object} Normalized forecast.
 */
function normalize(records, current, midnight, offsetMin, coords) {
  const byEpoch = {};
  records.forEach((record) => {
    const epoch = Math.floor(Date.parse(record.timestamp) / 1000);
    if (isFinite(epoch)) {
      byEpoch[epoch] = record;
    }
  });
  const hourly = {
    start: midnight,
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
    condition: [],
  };
  for (let i = 0; i < DAYS * 24; i += 1) {
    const time = midnight + i * HOUR;
    const own = byEpoch[time] || null;
    const next = byEpoch[time + HOUR] || null;
    const temperature = num(own && own.temperature);
    const dewPoint = num(own && own.dew_point);
    const humidity = first(own && own.relative_humidity, apparent.humidityFromDewPoint(temperature, dewPoint));
    const windSpeed = num(own && own.wind_speed);
    const cloudCover = num(own && own.cloud_cover);
    const amount = num(next && next.precipitation);
    hourly.temperature.push(temperature);
    hourly.feelsLike.push(apparent.apparentTemperature(temperature, humidity, windSpeed));
    hourly.humidity.push(humidity);
    hourly.dewPoint.push(dewPoint);
    hourly.pressure.push(num(own && own.pressure_msl));
    hourly.cloudCover.push(cloudCover);
    hourly.windSpeed.push(windSpeed);
    hourly.windDirection.push(num(own && own.wind_direction));
    hourly.windGust.push(num(next && next.wind_gust_speed));
    hourly.precipitation.push(num(next && next.precipitation_probability));
    hourly.precipitationAmount.push(amount);
    hourly.condition.push(own || next
      ? classify((next && next.condition) || null, amount, Boolean(own && own.condition === 'fog'),
        cloudCover, temperature)
      : null);
  }

  const daily = {
    start: midnight,
    high: [],
    low: [],
    condition: [],
    precipitation: [],
    precipitationAmount: [],
    windSpeed: [],
    windGust: [],
    sunrise: [],
    sunset: [],
  };
  for (let d = 0; d < DAYS; d += 1) {
    const from = d * 24;
    const hours = (field) => hourly[field].slice(from, from + 24);
    const amounts = hours('precipitationAmount').filter(isNumber);
    const times = sun.sunTimes((midnight + d * DAY + 12 * HOUR) * 1000, coords.latitude, coords.longitude);
    // Half a day of readings or more, or the day's extremes could be an hour's.
    daily.high.push(extreme(hours('temperature'), Math.max, 12));
    daily.low.push(extreme(hours('temperature'), Math.min, 12));
    daily.condition.push(summarize(hourly.condition.slice(from + DAYTIME[0], from + DAYTIME[1])));
    daily.precipitation.push(extreme(hours('precipitation'), Math.max));
    daily.precipitationAmount.push(amounts.length >= 18
      ? Math.round(amounts.reduce((sum, value) => sum + value, 0) * 10) / 10 : null);
    daily.windSpeed.push(extreme(hours('windSpeed'), Math.max));
    daily.windGust.push(extreme(hours('windGust'), Math.max));
    daily.sunrise.push(times ? times.rise : null);
    daily.sunset.push(times ? times.set : null);
  }

  return { utcOffsetMin: offsetMin, current: normalizeCurrent(current), hourly, daily };
}

/**
 * Fetch and normalize the forecast for a place. A failed /current_weather only leaves the
 * observation out: the hour now falls in stands in for it.
 *
 * @param {{latitude: number, longitude: number}} coords Rounded coordinates.
 * @param {number} nowMs Now, epoch ms.
 * @returns {Promise<Object>} Normalized forecast.
 */
async function fetchForecast(coords, nowMs) {
  const offsetMin = centralEuropeanOffset(nowMs);
  const midnight = instance.localMidnight(Math.floor(nowMs / 1000), offsetMin);
  const results = await Promise.all([
    http.getJson(weatherUrl(coords, midnight)),
    http.getJson(currentUrl(coords)).catch(() => null),
  ]);
  const weather = results[0];
  if (!weather || !Array.isArray(weather.weather) || !weather.weather.length) {
    throw new Error('no forecast');
  }
  return normalize(weather.weather, results[1] && results[1].weather, midnight, offsetMin, coords);
}

module.exports = {
  AREA,
  CONDITIONS,
  covers,
  centralEuropeanOffset,
  classify,
  summarize,
  weatherUrl,
  currentUrl,
  normalizeCurrent,
  normalize,
  fetchForecast,
};
