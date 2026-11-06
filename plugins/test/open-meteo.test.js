'use strict';
const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const openMeteo = require('../open-meteo/src/open-meteo');
const apparent = require('../lib/apparent');
const units = require('../lib/units');
const source = require('../open-meteo/src/source');
const build = require('../scripts/build');
const forecastFixture = require('./fixtures/open-meteo-freiburg-forecast.json');
const uvFixture = require('./fixtures/open-meteo-freiburg-uv.json');
const { installHost, uninstallHost, weatherLocation } = require('./helpers/host');
const { validateEnvelope } = require('./helpers/validate');

const HOUR = 3600;
// The fixtures were recorded on 6 Nov 2026 for Freiburg (CET): local midnight is 23:00 UTC before.
const MIDNIGHT = forecastFixture.hourly.time[0];
const NOW_MS = (MIDNIGHT + 9.5 * HOUR) * 1000;
// The shapes the built pbw declares (the build writes them from the plugin's SERVES).
const DECLARED = build.buildArtifacts('open-meteo').appinfo.plugin.sources[0].properties;
const FREIBURG = weatherLocation('home', 'Freiburg', 47.99, 7.85);

afterEach(() => uninstallHost());

/**
 * Answer fetches from the Freiburg fixtures.
 *
 * @param {Object} [overrides] {forecast, uv}: a status number or a body to answer with instead.
 * @returns {Function} url => {status, body}.
 */
function fixtures(overrides) {
  const pick = (value, body) => (typeof value === 'number' ? { status: value, body: null } : { status: 200, body: value || body });
  return (url) => {
    if (url.indexOf('ncep_gfs_global') !== -1) {
      return pick(overrides && overrides.uv, uvFixture);
    }
    return pick(overrides && overrides.forecast, forecastFixture);
  };
}

/**
 * A small synthetic forecast response: `hours` hourly buckets from MIDNIGHT.
 *
 * @param {number} hours Buckets.
 * @param {Function} hourly (field, i) => value, for the hourly fields set.
 * @returns {Object} Response.
 */
function response(hours, hourly) {
  const time = Array.from({ length: hours }, (unused, i) => MIDNIGHT + i * HOUR);
  const block = { time };
  ['temperature_2m', 'apparent_temperature', 'relative_humidity_2m', 'dew_point_2m', 'precipitation_probability',
    'precipitation', 'weather_code', 'pressure_msl', 'cloud_cover', 'wind_speed_10m', 'wind_direction_10m',
    'wind_gusts_10m'].forEach((field) => {
    block[field] = time.map((unused, i) => hourly(field, i));
  });
  return {
    utc_offset_seconds: 3600,
    current: { temperature_2m: 5, apparent_temperature: null, relative_humidity_2m: 80, wind_speed_10m: 10, weather_code: 3 },
    hourly: block,
    daily: { time: [MIDNIGHT], temperature_2m_max: [9], temperature_2m_min: [1], weather_code: [61], sunrise: [0], sunset: [MIDNIGHT + 16 * HOUR] },
  };
}

test('interval readings are read from the bucket that closes their hour', () => {
  const data = openMeteo.normalize(response(8, (field, i) => {
    if (field === 'precipitation') { return i === 5 ? 2.4 : 0; }
    if (field === 'wind_gusts_10m') { return i * 10; }
    if (field === 'weather_code') { return i === 5 ? 63 : 0; }
    return i;
  }), { hourly: { time: Array.from({ length: 8 }, (u, i) => MIDNIGHT + i * HOUR), uv_index: [0, 0, 0, 1, 2, 3, 4, 5] } });
  // The 2.4 mm stamped 05:00 fell between 04:00 and 05:00.
  assert.deepEqual(data.hourly.precipitationAmount, [0, 0, 0, 0, 2.4, 0, 0]);
  assert.equal(data.hourly.condition[4].code, 'heavy_rain');
  assert.equal(data.hourly.condition[5].code, 'sun');
  assert.deepEqual(data.hourly.windGust, [10, 20, 30, 40, 50, 60, 70]);
  assert.deepEqual(data.hourly.uvIndex, [0, 0, 1, 2, 3, 4, 5]);
  // Instants stay at their stamp; the last bucket only closes the hour before it.
  assert.deepEqual(data.hourly.temperature, [0, 1, 2, 3, 4, 5, 6]);
});

test('each hour\'s chance of rain is its 3-hour ensemble block\'s', () => {
  // MIDNIGHT is 23:00 UTC, so the 3-hour UTC boundaries are buckets 1, 4, 7, ...
  const data = openMeteo.normalize(response(9, (field, i) => (field === 'precipitation_probability' ? i * 10 : 0)), null);
  assert.deepEqual(data.hourly.precipitation.slice(0, 7), [10, 40, 40, 40, 70, 70, 70]);
  // Past the last boundary in the response, the hour reads the bucket that closes it.
  assert.equal(data.hourly.precipitation[7], 80);
});

test('weather codes become the shared conditions, each phrase short enough for the watch', () => {
  assert.deepEqual(openMeteo.condition(61), { code: 'light_rain', short: 'Light rain', long: 'Slight rain' });
  assert.deepEqual(openMeteo.condition(999), { code: 'unknown', short: 'Unknown', long: 'Unknown' });
  assert.equal(openMeteo.condition(null), null);
  const codes = ['sun', 'partly_cloudy', 'cloudy', 'light_rain', 'heavy_rain', 'light_snow', 'heavy_snow', 'rain_and_snow'];
  Object.keys(openMeteo.WMO).forEach((code) => {
    const entry = openMeteo.WMO[code];
    assert.ok(codes.indexOf(entry[0]) !== -1, code);
    assert.ok(entry[1].length <= 12, entry[1]);
    assert.ok(entry[2].length <= 32, entry[2]);
  });
});

test('a missing feels like is worked out; a sun that never rises is left out', () => {
  const data = openMeteo.normalize(response(3, (field) => (field === 'apparent_temperature' ? null : 5)), null);
  // The current block in response(): 5 °C, 80 %, 10 km/h. Every hourly field reads 5.
  assert.equal(data.current.feelsLike, apparent.apparentTemperature(5, 80, 10));
  assert.equal(data.hourly.feelsLike[0], apparent.apparentTemperature(5, 5, 5));
  assert.deepEqual(data.daily.sunrise, [null]);
  assert.deepEqual(data.daily.uvIndex, [null]);
  assert.equal(data.utcOffsetMin, 60);
});

test('the requests: ECMWF for the forecast, GFS for UV, rounded coordinates, local midnight', () => {
  const coords = { latitude: 47.99, longitude: 7.85 };
  const forecast = openMeteo.forecastUrl(coords);
  assert.match(forecast, /^https:\/\/api\.open-meteo\.com\/v1\/forecast\?latitude=47\.99&longitude=7\.85&/);
  assert.match(forecast, /models=ecmwf_ifs025/);
  assert.match(forecast, /timezone=auto/);
  assert.match(openMeteo.uvUrl(coords), /models=ncep_gfs_global.*hourly=uv_index&daily=uv_index_max$/);
});

test('UV failing leaves the rest of the forecast; a broken forecast fails the place', async () => {
  installHost({ respond: fixtures({ uv: 503 }) });
  const data = await openMeteo.fetchForecast({ latitude: 47.99, longitude: 7.85 });
  assert.ok(data.hourly.uvIndex.every((value) => value === null));
  assert.equal(data.hourly.temperature[0], forecastFixture.hourly.temperature_2m[0]);
  uninstallHost();
  installHost({ respond: fixtures({ forecast: { hourly: { time: [] } } }) });
  await assert.rejects(openMeteo.fetchForecast({ latitude: 47.99, longitude: 7.85 }), /incomplete forecast/);
});

test('end to end: one instance per weather location, in order, nothing the app would drop', async () => {
  const host = installHost({
    locations: [FREIBURG, weatherLocation('here', 'Current location', null, null)],
    position: { latitude: 48.21, longitude: 7.62 },
    units: { temperature: '°C', wind_speed: 'km/h', pressure: 'hPa', precipitation: 'mm', clock: '24h', locale: 'de-DE' },
    respond: fixtures(),
  });
  const answer = await host.run(source.createSource({ now: () => NOW_MS }), { category: 'weather', item: 'location' });
  assert.equal(answer.error, undefined);
  const envelope = answer.data;
  assert.deepEqual(envelope.instances.map((instance) => instance.instanceId), ['home', 'here']);
  assert.equal(host.requests.length, 4);
  assert.deepEqual(host.subscriptions, ['preferences/weather_location', 'preferences/units']);
  assert.equal(envelope.validUntilMs, NOW_MS + 30 * 60 * 1000);
  assert.deepEqual(validateEnvelope(envelope, DECLARED).dropped, []);

  const p = envelope.instances[0].properties;
  const hours = forecastFixture.hourly;
  assert.equal(p.name.shortText.text, 'Freiburg');
  assert.equal(p.hourly_temperature.series.start, MIDNIGHT);
  assert.equal(p.hourly_temperature.series.numericValue.values[9], hours.temperature_2m[9]);
  assert.equal(p.hourly_precipitation_amount.series.numericValue.values[12], hours.precipitation[13]);
  assert.equal(p.hourly_condition_code.series.longText.values[12], openMeteo.condition(hours.weather_code[13]).code);
  assert.equal(p.hourly_uv_index.series.numericValue.values[11], units.round(uvFixture.hourly.uv_index[12], 1));
  assert.equal(p.temperature.numericValue.value, forecastFixture.current.temperature_2m);
  assert.equal(p.daily_high.series.numericValue.values.length, 7);
  assert.equal(p.sunrise.timestamp.value, forecastFixture.daily.sunrise[0]);
  // Every property of the vocabulary is there: Open-Meteo has them all.
  assert.deepEqual(Object.keys(p).sort(), Object.keys(DECLARED).sort());
});

test('two places at one spot share a fetch; a second request within the hour fetches nothing', async () => {
  const host = installHost({
    locations: [FREIBURG, weatherLocation('here', 'Current location', null, null)],
    position: { latitude: 47.991, longitude: 7.849 },
    respond: fixtures(),
  });
  const handler = source.createSource({ now: () => NOW_MS });
  const first = await host.run(handler, { category: 'weather', item: 'location' });
  assert.equal(first.data.instances.length, 2);
  assert.equal(host.requests.length, 2);
  const again = await host.run(handler, { category: 'weather', item: 'location' });
  assert.equal(again.data.instances.length, 2);
  assert.equal(host.requests.length, 2);
});

test('while Open-Meteo is down a recent forecast stands in, retried in five minutes', async () => {
  let down = false;
  const working = fixtures();
  const host = installHost({ locations: [FREIBURG], respond: (url) => (down ? { status: 503, body: null } : working(url)) });
  await host.run(source.createSource({ now: () => NOW_MS }), { category: 'weather', item: 'location' });
  down = true;
  const later = NOW_MS + 45 * 60 * 1000;
  const answer = await host.run(source.createSource({ now: () => later }), { category: 'weather', item: 'location' });
  assert.equal(answer.data.instances.length, 1);
  assert.equal(answer.data.validUntilMs, later + 5 * 60 * 1000);
});

test('errors: unreachable, refused host, refused location, wrong item', async () => {
  let host = installHost({ locations: [FREIBURG], respond: () => ({ status: 503, body: null }) });
  let answer = await host.run(source.createSource({ now: () => NOW_MS }), { category: 'weather', item: 'location' });
  assert.deepEqual(answer.error, { code: 'PLUGIN_UNAVAILABLE', message: 'Could not reach Open-Meteo.' });
  uninstallHost();

  host = installHost({
    locations: [FREIBURG],
    respond: () => Object.assign(new Error('blocked'), { name: 'NotAllowedError' }),
  });
  answer = await host.run(source.createSource({ now: () => NOW_MS }), { category: 'weather', item: 'location' });
  assert.equal(answer.error.code, 'PERMISSION_DENIED');
  uninstallHost();

  host = installHost({ locations: [], position: Object.assign(new Error('refused'), { code: 1 }), respond: fixtures() });
  answer = await host.run(source.createSource({ now: () => NOW_MS }), { category: 'weather', item: 'location' });
  assert.equal(answer.error.code, 'PERMISSION_DENIED');
  assert.equal(host.requests.length, 0);

  answer = await host.run(source.createSource({ now: () => NOW_MS }), { category: 'weather', item: 'hour' });
  assert.equal(answer.error.code, 'INVALID_REQUEST');
});

test('a request for some properties, in imperial units', async () => {
  const host = installHost({
    locations: [FREIBURG],
    units: { temperature: '°F', wind_speed: 'mph', pressure: 'inHg', precipitation: 'in', clock: '12h' },
    respond: fixtures(),
  });
  const answer = await host.run(source.createSource({ now: () => NOW_MS }),
    { category: 'weather', item: 'location', properties: ['temperature', 'wind_speed', 'sunset'] });
  const p = answer.data.instances[0].properties;
  assert.deepEqual(Object.keys(p), ['temperature', 'wind_speed', 'sunset']);
  assert.equal(p.temperature.numericValue.unit, '°F');
  assert.equal(p.wind_speed.numericValue.unit, 'mph');
  assert.match(p.sunset.shortText.text, /^\d{1,2}:\d\d PM$/);
});
