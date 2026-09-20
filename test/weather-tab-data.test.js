// test/weather-tab-data.test.js — the Weather tab's provider parsers against
// compact fixture responses: unit conversion at the adapter boundary
// (m/s→km/h, pop→%), icon normalization, and the daily strip's sourcing
// (provider daily array vs client-side aggregation).
const test = require('node:test');
const assert = require('node:assert/strict');
const data = require('../src/pkjs/settings/weather-tab-data.js');

const NOON = new Date(2026, 8, 20, 12, 0, 0).getTime();
const DAY0 = new Date(2026, 8, 20, 0, 0, 0).getTime();

test('Open-Meteo parser: hourly series + provider daily, unixtime seconds → ms', () => {
  const hours = [NOON / 1000, NOON / 1000 + 3600];
  const fixture = {
    hourly: {
      time: hours,
      temperature_2m: [18.2, 17.9],
      precipitation: [0.4, 0],
      precipitation_probability: [55, 20],
      wind_speed_10m: [12, 14],
      wind_gusts_10m: [24, 28],
      wind_direction_10m: [225, 230],
      relative_humidity_2m: [62, 65],
      dew_point_2m: [10.4, 10.6],
      pressure_msl: [1015.2, 1015.0],
      weather_code: [61, 3]
    },
    daily: {
      time: [DAY0 / 1000 - 86400, DAY0 / 1000, DAY0 / 1000 + 86400],
      weather_code: [3, 61, 0],
      temperature_2m_max: [20, 21, 19],
      temperature_2m_min: [12, 13, 11],
      precipitation_sum: [0, 5, 0],
      precipitation_probability_max: [10, 80, 5],
      sunshine_duration: [3600, 7200, 28800]
    }
  };
  const out = data.parsers.openmeteo(fixture, NOON);
  assert.equal(out.hourly.time[0], NOON);
  assert.equal(out.hourly.temp[0], 18.2);
  assert.equal(out.hourly.prob[1], 20);
  assert.equal(out.hourly.icon[0], 'rain');
  assert.equal(out.hourly.icon[1], 'cloudy');
  assert.equal(out.daily.length, 2, 'yesterday is dropped');
  assert.equal(out.daily[0].tmax, 21);
  assert.equal(out.daily[0].sunshineH, 2);
  assert.equal(out.daily[1].icon, 'clear');
  assert.equal(data.parsers.openmeteo({ hourly: { time: [] } }, NOON), null);
});

test('Brightsky parser: DWD units pass through, daily aggregates client-side', () => {
  const rows = [];
  for (let h = 0; h < 30; h += 1) {
    rows.push({
      timestamp: new Date(DAY0 + h * 3600000).toISOString(),
      temperature: 10 + h % 24,
      precipitation: h === 15 ? 1.2 : 0,
      precipitation_probability: h === 15 ? 70 : null,
      wind_speed: 12,
      wind_gust_speed: 30,
      wind_direction: 200,
      relative_humidity: 60,
      dew_point: 9,
      pressure_msl: 1013,
      sunshine: h >= 9 && h < 17 ? 45 : 0,
      icon: h === 15 ? 'rain' : 'partly-cloudy-day'
    });
  }
  const out = data.parsers.dwd({ weather: rows }, NOON);
  assert.equal(out.hourly.wind[0], 12, 'Brightsky wind is already km/h');
  assert.equal(out.hourly.rh[0], 60);
  assert.equal(out.hourly.icon[15], 'rain');
  assert.ok(out.daily.length >= 1);
  assert.equal(out.daily[0].icon, 'rain');
  assert.equal(out.daily[0].sunshineH, 6);
  assert.equal(data.parsers.dwd({ weather: [] }, NOON), null);
});

test('OWM parser: m/s → km/h, pop 0..1 → %, its own daily array', () => {
  const fixture = {
    hourly: [{
      dt: NOON / 1000,
      temp: 18, humidity: 60, dew_point: 10, pressure: 1015,
      wind_speed: 5, wind_gust: 10, wind_deg: 180,
      pop: 0.4, rain: { '1h': 0.6 }, weather: [{ id: 500 }]
    }],
    daily: [{
      dt: NOON / 1000,
      temp: { min: 12, max: 21 }, pop: 0.8, rain: 5.1, weather: [{ id: 802 }]
    }]
  };
  const out = data.parsers.openweathermap(fixture, NOON);
  assert.equal(out.hourly.wind[0], 18, '5 m/s = 18 km/h');
  assert.equal(out.hourly.gust[0], 36);
  assert.equal(out.hourly.prob[0], 40);
  assert.equal(out.hourly.rain[0], 0.6);
  assert.equal(out.hourly.icon[0], 'rain');
  assert.equal(out.daily[0].probMax, 80);
  assert.equal(out.daily[0].icon, 'partly');
  assert.equal(out.daily[0].sunshineH, null, 'OWM has no sunshine duration');
});

test('tomorrow.io parser: m/s → km/h, weatherCode mapping, aggregated daily', () => {
  const intervals = [];
  for (let h = 0; h < 26; h += 1) {
    intervals.push({
      startTime: new Date(DAY0 + h * 3600000).toISOString(),
      values: {
        temperature: 15 + (h % 24) / 2,
        precipitationIntensity: 0,
        precipitationProbability: 15,
        windSpeed: 4, windGust: 8, windDirection: 300,
        humidity: 55, dewPoint: 8, pressureSeaLevel: 1011,
        weatherCode: 1101
      }
    });
  }
  const out = data.parsers.tomorrowio({ data: { timelines: [{ intervals: intervals }] } }, NOON);
  assert.equal(Math.round(out.hourly.wind[0] * 10) / 10, 14.4, '4 m/s = 14.4 km/h');
  assert.equal(out.hourly.icon[0], 'partly');
  assert.ok(out.daily.length >= 1);
  assert.equal(out.daily[0].icon, 'partly');
  assert.equal(data.parsers.tomorrowio({ data: { timelines: [] } }, NOON), null);
});
