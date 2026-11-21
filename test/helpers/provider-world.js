// test/helpers/provider-world.js — one fixed morning in Berlin, answered the way each weather
// service answers it. Every request a weather fetch makes (the seven forecast providers, the
// city lookup, DWD's UV from Open-Meteo, air quality, DWD's pollen) gets a response in that
// service's own shape and units, all built from one set of hourly readings, so two providers
// asked about the same hour describe the same weather.
//
// The provider pins (provider-pins.js) fetch through it end to end. Each answer follows the
// request it gets (the hours a URL asks for, Yandex's days), as the services do. A request
// no service here knows gets a 404 and is marked, so a new request shows up in the pins.
'use strict';
const path = require('path');

const HOUR = 3600;
// 10:20 in Berlin (CEST, UTC+2): a summer morning before a midday shower.
const NOW_MS = Date.UTC(2026, 5, 20, 8, 20, 0);
const NOW = NOW_MS / 1000;
// 00:00 GMT of that day, where Open-Meteo's GMT days start.
const DAY0 = Date.UTC(2026, 5, 20) / 1000;
// Berlin's offset that day, for the answers that speak local time (Yandex's days, OWM's
// timezone_offset). Fixed here, so the answers do not depend on the host's zone.
const BERLIN_OFFSET = 2 * HOUR;
const PLACE = { lat: 52.52, lon: 13.405 };

// One value per UTC hour, repeated every day.
const TEMP_C = [11.6, 11.2, 10.9, 10.7, 11.0, 12.1, 13.6, 15.2, 16.8, 18.1, 19.2, 20.0,
  20.6, 20.9, 20.8, 20.3, 19.5, 18.4, 17.0, 15.6, 14.4, 13.4, 12.6, 12.0];
const RAIN_MM = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.1, 0.6, 1.8, 3.2, 1.1, 0.2, 0, 0, 0, 0, 0, 0, 0, 0];
const CHANCE = [5, 5, 5, 5, 5, 10, 10, 15, 20, 30, 55, 75, 90, 95, 70, 40, 20, 10, 10, 5, 5, 5, 5, 5];
const WIND_KMH = [7, 6, 6, 5, 6, 8, 10, 12, 15, 18, 21, 24, 26, 25, 22, 19, 16, 13, 11, 9, 8, 8, 7, 7];
const CLOUD = [20, 25, 30, 35, 30, 25, 30, 40, 55, 70, 85, 95, 100, 100, 90, 70, 55, 45, 35, 30,
  25, 20, 20, 20];
const HUMIDITY = [82, 84, 86, 87, 86, 83, 78, 72, 66, 61, 60, 64, 72, 80, 78, 70, 64, 62, 63, 66,
  70, 74, 77, 80];
const UV = [0, 0, 0, 0, 0.1, 0.4, 1.0, 2.0, 3.3, 4.6, 5.7, 6.4, 6.6, 6.2, 5.3, 4.1, 2.8, 1.6, 0.7,
  0.2, 0, 0, 0, 0];
const PRESSURE_STEP = [0, 0.3, 0.6, 0.9, 1.2, 1.5, 1.8, 2.1, 1.8, 1.5, 1.2, 0.9];
const AQI_STEP = [0, 2, 4, 6, 8, 10, 12, 14, 16, 14, 12, 10];

/**
 * @param {Array} list Values per hour.
 * @param {number} i Hour index (may be negative).
 * @returns {*} The list's value for that hour, repeating.
 */
function cycled(list, i) {
  return list[((i % list.length) + list.length) % list.length];
}

/**
 * @param {number} x A number.
 * @returns {number} x to one decimal.
 */
function round1(x) { return Math.round(x * 10) / 10; }

/**
 * @param {number} x A number.
 * @returns {number} x to two decimals.
 */
function round2(x) { return Math.round(x * 100) / 100; }

/**
 * @param {number} c Degrees Celsius.
 * @returns {number} The same in °F, to one decimal.
 */
function fahrenheit(c) { return round1(c * 9 / 5 + 32); }

/**
 * @param {number} kmh A speed in km/h.
 * @returns {number} The same in m/s, to one decimal.
 */
function metresPerSecond(kmh) { return round1(kmh / 3.6); }

/**
 * @param {number} kmh A speed in km/h.
 * @returns {number} The same in mph, to two decimals.
 */
function milesPerHour(kmh) { return round2(kmh / 1.609344); }

/**
 * @param {number} t Epoch seconds.
 * @returns {string} t as an ISO time, as most services stamp their hours.
 */
function iso(t) { return new Date(t * 1000).toISOString().replace('.000Z', 'Z'); }

/**
 * The weather in the hour that starts at `t`.
 * @param {number} t An hour's start, epoch seconds.
 * @returns {Object} Its readings in metric units, and its kind of weather.
 */
function hourAt(t) {
  const i = Math.round((t - DAY0) / HOUR);
  const day = Math.floor(i / 24);
  const tempC = round1(cycled(TEMP_C, i) + day * 0.4);
  const windKmh = cycled(WIND_KMH, i);
  const rainMm = cycled(RAIN_MM, i);
  const cloud = cycled(CLOUD, i);
  let sky;
  if (rainMm >= 2) { sky = 'rain'; }
  else if (rainMm > 0) { sky = 'lightrain'; }
  else if (cloud >= 90) { sky = 'cloudy'; }
  else if (cloud >= 50) { sky = 'mostly'; }
  else if (cloud >= 25) { sky = 'partly'; }
  else { sky = 'clear'; }
  return {
    tempC: tempC,
    feelsC: round1(tempC - windKmh / 12),
    dewC: round1(tempC - 6 + cycled([0, 0.2, 0.4, 0.6, 0.8], i)),
    humidity: cycled(HUMIDITY, i),
    rainMm: rainMm,
    chance: cycled(CHANCE, i),
    windKmh: windKmh,
    gustKmh: Math.round(windKmh * 1.7 + 3),
    windDir: (((210 + i * 9) % 360) + 360) % 360,
    uv: cycled(UV, i),
    pressure: round1(1008.6 + cycled(PRESSURE_STEP, i) + day * 1.1),
    cloud: cloud,
    cloudLow: Math.round(cloud * 0.5),
    cloudMid: Math.round(cloud * 0.4),
    cloudHigh: Math.round(cloud * 0.8),
    aqi: 18 + cycled(AQI_STEP, i),
    sky: sky
  };
}

// Each service's code for the kinds of weather the readings above have.
const CODES = {
  wmo: { clear: 0, partly: 2, mostly: 3, cloudy: 3, lightrain: 61, rain: 63 },
  brightsky: { clear: 'clear-day', partly: 'partly-cloudy-day', mostly: 'cloudy', cloudy: 'cloudy',
    lightrain: 'rain', rain: 'rain' },
  metno: { clear: 'clearsky_day', partly: 'partlycloudy_day', mostly: 'cloudy', cloudy: 'cloudy',
    lightrain: 'lightrain', rain: 'rain' },
  owm: { clear: 800, partly: 802, mostly: 803, cloudy: 804, lightrain: 500, rain: 501 },
  tomorrow: { clear: 1000, partly: 1101, mostly: 1102, cloudy: 1001, lightrain: 4200, rain: 4001 },
  wu: { clear: 32, partly: 30, mostly: 28, cloudy: 26, lightrain: 11, rain: 12 },
  yandex: { clear: 'CLEAR', partly: 'PARTLY_CLOUDY', mostly: 'CLOUDY', cloudy: 'OVERCAST',
    lightrain: 'LIGHT_RAIN', rain: 'RAIN' }
};

const HOUR0 = Math.floor(NOW / HOUR) * HOUR;

/**
 * @param {string} url A request URL.
 * @returns {URLSearchParams} Its query.
 */
function query(url) {
  return new URL(url).searchParams;
}

/**
 * Open-Meteo's GMT hours for a request's forecast_days, from 00:00 GMT today.
 * @param {string} url The request.
 * @returns {number[]} Epoch seconds.
 */
function openMeteoTimes(url) {
  const days = Number(query(url).get('forecast_days')) || 7;
  const out = [];
  for (let k = 0; k < days * 24; k += 1) { out.push(DAY0 + k * HOUR); }
  return out;
}

// Open-Meteo stamps a preceding-hour value (rain, chance, gusts, GFS's UV) at the END of the
// hour it covers: the bucket at T describes the hour starting at T - 1 h.
const before = (t) => hourAt(t - HOUR);

const SERVICES = [
  {
    // ArcGIS reverse geocode (provider.js withCityName).
    match: (url) => url.indexOf('https://geocode.arcgis.com/') === 0,
    answer: () => ({ address: { Match_addr: 'Berlin', District: 'Mitte', City: 'Berlin',
      Region: 'Berlin', CountryCode: 'DEU' } })
  },
  {
    // Bright Sky's hourly records, from `date` to `last_date` inclusive. Precipitation, its
    // chance and the gust cover the hour BEFORE a record's stamp.
    match: (url) => url.indexOf('https://api.brightsky.dev/weather?') === 0,
    answer: (url) => {
      const q = query(url);
      const from = Date.parse(q.get('date')) / 1000;
      const to = Date.parse(q.get('last_date')) / 1000;
      const weather = [];
      for (let t = from; t <= to; t += HOUR) {
        const h = hourAt(t);
        const prev = before(t);
        weather.push({
          timestamp: iso(t), source_id: 240960, temperature: h.tempC, dew_point: h.dewC,
          relative_humidity: null, pressure_msl: h.pressure, cloud_cover: h.cloud,
          wind_speed: h.windKmh, wind_direction: h.windDir, wind_gust_speed: prev.gustKmh,
          precipitation: prev.rainMm, precipitation_probability: prev.chance,
          condition: prev.rainMm > 0 ? 'rain' : 'dry', icon: CODES.brightsky[prev.sky]
        });
      }
      return { weather: weather, sources: [{ id: 240960, station_name: 'BERLIN-TEMPELHOF' }] };
    }
  },
  {
    // Bright Sky's latest observation.
    match: (url) => url.indexOf('https://api.brightsky.dev/current_weather?') === 0,
    answer: () => {
      const h = hourAt(HOUR0);
      return { weather: { timestamp: iso(NOW - 20 * 60), source_id: 240960, temperature: h.tempC,
        dew_point: h.dewC, relative_humidity: h.humidity, cloud_cover: h.cloud,
        wind_speed_10: h.windKmh, wind_direction_10: h.windDir, wind_gust_speed_10: h.gustKmh,
        precipitation_60: 0, condition: 'dry', icon: CODES.brightsky[h.sky] } };
    }
  },
  {
    // Open-Meteo's main forecast (ECMWF IFS, which leaves the gusts null).
    match: (url) => url.indexOf('https://api.open-meteo.com/v1/forecast?') === 0
      && query(url).get('hourly').indexOf('temperature_2m') === 0,
    answer: (url) => {
      const time = openMeteoTimes(url);
      const now = hourAt(HOUR0);
      return {
        latitude: 52.5, longitude: 13.4, utc_offset_seconds: 0, timezone: 'GMT',
        current: { time: NOW - 5 * 60, interval: 900, temperature_2m: fahrenheit(now.tempC),
          weather_code: CODES.wmo[now.sky] },
        hourly: {
          time: time,
          temperature_2m: time.map((t) => fahrenheit(hourAt(t).tempC)),
          precipitation_probability: time.map((t) => before(t).chance),
          precipitation: time.map((t) => before(t).rainMm),
          windspeed_10m: time.map((t) => hourAt(t).windKmh),
          windgusts_10m: time.map(() => null),
          pressure_msl: time.map((t) => hourAt(t).pressure),
          cloud_cover: time.map((t) => hourAt(t).cloud),
          cloud_cover_low: time.map((t) => hourAt(t).cloudLow),
          cloud_cover_mid: time.map((t) => hourAt(t).cloudMid),
          cloud_cover_high: time.map((t) => hourAt(t).cloudHigh)
        }
      };
    }
  },
  {
    // Open-Meteo's best_match call for the derived fields.
    match: (url) => url.indexOf('https://api.open-meteo.com/v1/forecast?') === 0
      && query(url).get('hourly').indexOf('windgusts_10m') === 0,
    answer: (url) => {
      const time = openMeteoTimes(url);
      const now = hourAt(HOUR0);
      return {
        current: { time: NOW - 5 * 60, interval: 900, apparent_temperature: fahrenheit(now.feelsC),
          dew_point_2m: fahrenheit(now.dewC), wind_speed_10m: now.windKmh },
        hourly: {
          time: time,
          windgusts_10m: time.map((t) => before(t).gustKmh),
          apparent_temperature: time.map((t) => fahrenheit(hourAt(t).feelsC)),
          dew_point_2m: time.map((t) => fahrenheit(hourAt(t).dewC)),
          wind_direction_10m: time.map((t) => hourAt(t).windDir)
        }
      };
    }
  },
  {
    // Open-Meteo's UV (GFS: the mean of the hour ending at the stamp).
    match: (url) => url.indexOf('https://api.open-meteo.com/v1/forecast?') === 0
      && query(url).get('hourly') === 'uv_index',
    answer: (url) => {
      const time = openMeteoTimes(url);
      return { hourly: { time: time, uv_index: time.map((t) => before(t).uv) } };
    }
  },
  {
    // Open-Meteo's air quality, in the scale the URL asks for.
    match: (url) => url.indexOf('https://air-quality-api.open-meteo.com/v1/air-quality?') === 0,
    answer: (url) => {
      const time = openMeteoTimes(url);
      const field = query(url).get('hourly');
      const hourly = { time: time };
      hourly[field] = time.map((t) => hourAt(t).aqi + (field === 'us_aqi' ? 12 : 0));
      return { hourly: hourly };
    }
  },
  {
    // WAQI's station reading (only with a token).
    match: (url) => url.indexOf('https://api.waqi.info/') === 0,
    answer: () => ({ status: 'ok', data: { aqi: 31 } })
  },
  {
    // DWD's pollen forecast for the place: today and tomorrow, local dates.
    match: (url) => url.indexOf('https://maps.dwd.de/geoserver/dwd/Pollenflug/wfs?') === 0,
    answer: () => ({ type: 'FeatureCollection', features: [
      { properties: { FORECAST_DATE: '2026-06-20T00:00:00Z', POLLENINT: 2 } },
      { properties: { FORECAST_DATE: '2026-06-20T00:00:00Z', POLLENINT: 4 } },
      { properties: { FORECAST_DATE: '2026-06-21T00:00:00Z', POLLENINT: 3 } }
    ] })
  },
  {
    // Met.no's /complete: hourly for 60 hours from this hour, then every 6 hours on the
    // 00/06/12/18 UTC grid. next_1_hours covers the hour that STARTS at the stamp.
    match: (url) => url.indexOf('https://api.met.no/weatherapi/locationforecast/2.0/complete?') === 0,
    answer: () => {
      const stamps = [];
      for (let k = 0; k < 60; k += 1) { stamps.push(HOUR0 + k * HOUR); }
      let t = Math.ceil((stamps[stamps.length - 1] + HOUR) / (6 * HOUR)) * 6 * HOUR;
      for (; t <= DAY0 + 9 * 24 * HOUR; t += 6 * HOUR) { stamps.push(t); }
      const timeseries = stamps.map((stamp, idx) => {
        const h = hourAt(stamp);
        const hourly = idx < 60;
        let sixRain = 0;
        let sixChance = 0;
        for (let k = 0; k < 6; k += 1) {
          sixRain += hourAt(stamp + k * HOUR).rainMm;
          sixChance = Math.max(sixChance, hourAt(stamp + k * HOUR).chance);
        }
        const data = {
          instant: { details: {
            air_pressure_at_sea_level: h.pressure, air_temperature: h.tempC,
            cloud_area_fraction: h.cloud, cloud_area_fraction_high: h.cloudHigh,
            cloud_area_fraction_low: h.cloudLow, cloud_area_fraction_medium: h.cloudMid,
            dew_point_temperature: h.dewC, relative_humidity: h.humidity,
            ultraviolet_index_clear_sky: h.uv, wind_from_direction: h.windDir,
            wind_speed: metresPerSecond(h.windKmh),
            wind_speed_of_gust: metresPerSecond(before(stamp).gustKmh)
          } },
          next_6_hours: { summary: { symbol_code: CODES.metno[h.sky] },
            details: { precipitation_amount: round1(sixRain), probability_of_precipitation: sixChance } }
        };
        if (hourly) {
          data.next_1_hours = { summary: { symbol_code: CODES.metno[h.sky] },
            details: { precipitation_amount: h.rainMm, probability_of_precipitation: h.chance } };
        }
        return { time: iso(stamp), data: data };
      });
      return { type: 'Feature', properties: { meta: { updated_at: iso(HOUR0 - HOUR) },
        timeseries: timeseries } };
    }
  },
  {
    // OpenWeatherMap One Call 3.0, units=imperial: 48 hours from this hour, 8 days.
    match: (url) => url.indexOf('https://api.openweathermap.org/data/3.0/onecall?') === 0,
    answer: () => {
      const now = hourAt(HOUR0);
      const hourly = [];
      for (let k = 0; k < 48; k += 1) {
        const t = HOUR0 + k * HOUR;
        const h = hourAt(t);
        const entry = { dt: t, temp: fahrenheit(h.tempC), feels_like: fahrenheit(h.feelsC),
          pressure: Math.round(h.pressure), humidity: h.humidity, dew_point: fahrenheit(h.dewC),
          uvi: h.uv, clouds: h.cloud, visibility: 10000, wind_speed: milesPerHour(h.windKmh),
          wind_deg: h.windDir, wind_gust: milesPerHour(h.gustKmh),
          weather: [{ id: CODES.owm[h.sky] }], pop: h.chance / 100 };
        if (h.rainMm > 0) { entry.rain = { '1h': h.rainMm }; }
        hourly.push(entry);
      }
      const daily = [];
      for (let d = 0; d < 8; d += 1) {
        daily.push({ dt: DAY0 + d * 86400 + 10 * HOUR, sunrise: DAY0 + d * 86400 + 2 * HOUR + 43 * 60,
          sunset: DAY0 + d * 86400 + 19 * HOUR + 33 * 60 + d * 60 });
      }
      return { lat: PLACE.lat, lon: PLACE.lon, timezone: 'Europe/Berlin', timezone_offset: BERLIN_OFFSET,
        current: { dt: NOW, temp: fahrenheit(now.tempC), feels_like: fahrenheit(now.feelsC),
          pressure: Math.round(now.pressure), humidity: now.humidity, dew_point: fahrenheit(now.dewC),
          uvi: now.uv, clouds: now.cloud, wind_speed: milesPerHour(now.windKmh), wind_deg: now.windDir,
          weather: [{ id: CODES.owm[now.sky] }] },
        hourly: hourly, daily: daily };
    }
  },
  {
    // tomorrow.io Timelines, metric, hourly from startTime to endTime.
    match: (url) => url.indexOf('https://api.tomorrow.io/v4/timelines?') === 0,
    answer: (url) => {
      const q = query(url);
      const from = Date.parse(q.get('startTime')) / 1000;
      const to = Date.parse(q.get('endTime')) / 1000;
      const intervals = [];
      for (let t = from; t <= to; t += HOUR) {
        const h = hourAt(t);
        intervals.push({ startTime: iso(t), values: {
          temperature: h.tempC, temperatureApparent: h.feelsC, dewPoint: h.dewC, humidity: h.humidity,
          windSpeed: metresPerSecond(h.windKmh), windGust: metresPerSecond(h.gustKmh),
          windDirection: h.windDir, uvIndex: Math.round(h.uv), pressureSeaLevel: h.pressure,
          cloudCover: h.cloud, precipitationProbability: h.chance, precipitationIntensity: h.rainMm,
          weatherCode: CODES.tomorrow[h.sky] } });
      }
      return { data: { timelines: [{ timestep: '1h', startTime: iso(from), endTime: iso(to),
        intervals: intervals }] } };
    }
  },
  {
    // wunderground.com's page, whose config carries the API key.
    match: (url) => url === 'https://www.wunderground.com/',
    answer: () => '<html><script>var c = {"API_KEY":"e1f10a1e78da46f5b10a1e78da96f525"};</script></html>'
  },
  {
    // The Weather Company's current observation, units=e.
    match: (url) => url.indexOf('https://api.weather.com/v3/wx/observations/current?') === 0,
    answer: () => {
      const h = hourAt(HOUR0);
      return { temperature: Math.round(fahrenheit(h.tempC)), temperatureFeelsLike: Math.round(fahrenheit(h.feelsC)),
        relativeHumidity: h.humidity, windSpeed: Math.round(milesPerHour(h.windKmh)),
        windDirection: h.windDir, iconCode: CODES.wu[h.sky] };
    }
  },
  {
    // The Weather Company's 48 hours, units=e, rounded up past the hour in progress.
    match: (url) => url.indexOf('https://api.weather.com/v1/geocode/') === 0,
    answer: () => {
      const forecasts = [];
      for (let k = 1; k <= 48; k += 1) {
        const t = HOUR0 + k * HOUR;
        const h = hourAt(t);
        forecasts.push({ class: 'fod_short_range_hourly', fcst_valid: t, temp: Math.round(fahrenheit(h.tempC)),
          feels_like: Math.round(fahrenheit(h.feelsC)), dewpt: Math.round(fahrenheit(h.dewC)), rh: h.humidity,
          pop: h.chance, qpf: round2(h.rainMm / 25.4), wspd: Math.round(milesPerHour(h.windKmh)),
          gust: h.gustKmh > 25 ? Math.round(milesPerHour(h.gustKmh)) : null, wdir: h.windDir,
          uv_index: Math.round(h.uv), mslp: round2(h.pressure / 33.8639), clds: h.cloud,
          icon_code: CODES.wu[h.sky] });
      }
      return { metadata: { units: 'e' }, forecasts: forecasts };
    }
  },
  {
    // Yandex's GraphQL: `now`, and the local days its query asks for, from local midnight.
    match: (url, method) => url === 'https://api.weather.yandex.ru/graphql/query' && method === 'POST',
    answer: (url, method, body) => {
      const text = JSON.parse(body).query;
      const days = Number(/days\(limit: (\d+)\)/.exec(text)[1]);
      const midnight = Math.floor((NOW + BERLIN_OFFSET) / 86400) * 86400 - BERLIN_OFFSET;
      const now = hourAt(HOUR0);
      const forecastDays = [];
      for (let d = 0; d < days; d += 1) {
        const hours = [];
        for (let k = 0; k < 24; k += 1) {
          const t = midnight + d * 86400 + k * HOUR;
          const h = hourAt(t);
          hours.push({ timestamp: String(t), temperature: Math.round(fahrenheit(h.tempC)),
            feelsLike: Math.round(fahrenheit(h.feelsC)), precProbability: h.chance / 100, prec: h.rainMm,
            windSpeed: h.windKmh, windGust: h.gustKmh, uvIndex: Math.round(h.uv) });
        }
        forecastDays.push({ hours: hours });
      }
      const nowBlock = { temperature: Math.round(fahrenheit(now.tempC)), feelsLike: Math.round(fahrenheit(now.feelsC)) };
      if (text.indexOf(' condition }') !== -1) { nowBlock.condition = CODES.yandex[now.sky]; }
      return { data: { weatherByPoint: { now: nowBlock, forecast: { days: forecastDays } } } };
    }
  }
];

/**
 * How the services above answer one request.
 * @param {string} method 'GET' or 'POST'.
 * @param {string} url The request URL.
 * @param {string} [body] The request body.
 * @returns {{status: number, text: string, known: boolean}} The HTTP answer.
 */
function respond(method, url, body) {
  for (let s = 0; s < SERVICES.length; s += 1) {
    if (SERVICES[s].match(url, method)) {
      const answer = SERVICES[s].answer(url, method, body);
      return { status: 200, text: typeof answer === 'string' ? answer : JSON.stringify(answer), known: true };
    }
  }
  return { status: 404, text: '', known: false };
}

const SRC = path.resolve(__dirname, '../../src/pkjs') + path.sep;

/**
 * Run `fn` in this world: the pinned clock, an empty localStorage, a Pebble that names
 * `watchInfo`, an XMLHttpRequest the services above answer at once, and every src/pkjs module
 * loaded afresh, so nothing carries over from another run. Each request is recorded as
 * '<method> <url>' (and its body), with a line under it when no service answers it.
 * @param {Object} watchInfo getActiveWatchInfo()'s answer.
 * @param {function({mod: function(string): *, requests: string[]}): *} fn Gets the module
 *   loader (a path under src/pkjs) and the requests so far; its result is returned.
 * @param {{answers: function(string): boolean, now: function(): number}} [opts] answers(url)
 *   false refuses a request with a 503 (a service that is down); now() moves the clock (epoch
 *   ms; NOW_MS when absent). The services answer for NOW_MS whatever the clock says.
 * @returns {*} fn's result.
 */
function inWorld(watchInfo, fn, opts) {
  const answers = (opts && opts.answers) || (() => true);
  const clock = (opts && opts.now) || (() => NOW_MS);
  const saved = { Date: global.Date, localStorage: global.localStorage, Pebble: global.Pebble,
    XMLHttpRequest: global.XMLHttpRequest, log: console.log };
  const RealDate = saved.Date;
  class PinnedDate extends RealDate {
    constructor(...args) { if (args.length === 0) { super(clock()); } else { super(...args); } }
    static now() { return clock(); }
  }
  const store = {};
  const requests = [];
  global.Date = PinnedDate;
  global.localStorage = {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    clear: () => { Object.keys(store).forEach((k) => { delete store[k]; }); },
    key: (i) => { const ks = Object.keys(store); return i >= 0 && i < ks.length ? ks[i] : null; },
    get length() { return Object.keys(store).length; }
  };
  global.Pebble = { getActiveWatchInfo: () => watchInfo };
  global.XMLHttpRequest = function WorldXhr() {
    const xhr = this;
    xhr.open = (method, url) => { xhr.method = method; xhr.url = url; };
    xhr.setRequestHeader = () => {};
    xhr.send = (body) => {
      const line = xhr.method + ' ' + xhr.url;
      requests.push(body ? line + ' ' + body : line);
      const answer = answers(xhr.url) ? respond(xhr.method, xhr.url, body) : { status: 503, text: '', known: true };
      if (!answer.known) { requests.push('  ^ no service answers this request'); }
      xhr.status = answer.status;
      xhr.responseText = answer.text;
      xhr.onload();
    };
  };
  console.log = () => {};
  const purge = () => {
    Object.keys(require.cache).forEach((k) => { if (k.indexOf(SRC) === 0) { delete require.cache[k]; } });
  };
  purge();
  try {
    return fn({ mod: (name) => require(SRC + name), requests: requests });
  } finally {
    purge();
    global.Date = saved.Date;
    global.localStorage = saved.localStorage;
    global.Pebble = saved.Pebble;
    global.XMLHttpRequest = saved.XMLHttpRequest;
    console.log = saved.log;
  }
}

module.exports = { NOW_MS, PLACE, HOUR0, hourAt, respond, inWorld };
