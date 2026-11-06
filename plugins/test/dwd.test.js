'use strict';
const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const brightSky = require('../dwd/src/bright-sky');
const source = require('../dwd/src/source');
const manifest = require('../dwd/package.json');
const weatherFixture = require('./fixtures/bright-sky-freiburg-weather.json');
const currentFixture = require('./fixtures/bright-sky-freiburg-current.json');
const instance = require('../lib/instance');
const units = require('../lib/units');
const { sunTimes } = require('../lib/sun');
const { installHost, uninstallHost, weatherLocation } = require('./helpers/host');
const { validateEnvelope } = require('./helpers/validate');

const HOUR = 3600;
// The fixtures were recorded on 6 Nov 2026 (CET) for Freiburg, from local midnight for 7 days.
const MIDNIGHT = Date.UTC(2026, 10, 5, 23) / 1000;
const NOW_MS = (MIDNIGHT + 9.5 * HOUR) * 1000;
const DECLARED = manifest.pebble.plugin.sources[0].properties;
const FREIBURG = weatherLocation('home', 'Freiburg', 47.99, 7.85);
const C = brightSky.CONDITIONS;

afterEach(() => uninstallHost());

/**
 * Answer fetches from the Freiburg fixtures.
 *
 * @param {Object} [overrides] {weather, current}: a status number to answer with instead.
 * @returns {Function} url => {status, body}.
 */
function fixtures(overrides) {
  const pick = (value, body) => (typeof value === 'number' ? { status: value, body: null } : { status: 200, body });
  return (url) => (url.indexOf('/current_weather') !== -1
    ? pick(overrides && overrides.current, currentFixture)
    : pick(overrides && overrides.weather, weatherFixture));
}

/**
 * A Bright Sky record stamped `hours` after MIDNIGHT.
 *
 * @param {number} hours Hours after local midnight.
 * @param {Object} fields Its fields.
 * @returns {Object} Record.
 */
function record(hours, fields) {
  return Object.assign({ timestamp: new Date((MIDNIGHT + hours * HOUR) * 1000).toISOString() }, fields);
}

test('the area is Germany and the countries around it, all on Central European Time', () => {
  [[47.99, 7.85], [52.52, 13.41], [48.21, 16.37], [55.68, 12.57], [46.95, 7.45], [50.08, 14.44]].forEach((place) => {
    assert.equal(brightSky.covers({ latitude: place[0], longitude: place[1] }), true, place.join());
  });
  // London (GMT), Riga and Bucharest (UTC+2), Madrid (outside the box), Reykjavik.
  [[51.51, -0.13], [56.95, 24.11], [44.43, 26.1], [40.42, -3.7], [64.15, -21.94]].forEach((place) => {
    assert.equal(brightSky.covers({ latitude: place[0], longitude: place[1] }), false, place.join());
  });
});

test('Central European summer time by the EU rule', () => {
  const at = (iso) => brightSky.centralEuropeanOffset(Date.parse(iso));
  assert.equal(at('2026-03-29T00:59:59Z'), 60);
  assert.equal(at('2026-03-29T01:00:00Z'), 120);
  assert.equal(at('2026-07-01T12:00:00Z'), 120);
  assert.equal(at('2026-10-25T00:59:59Z'), 120);
  assert.equal(at('2026-10-25T01:00:00Z'), 60);
  assert.equal(at('2026-11-06T09:00:00Z'), 60);
  assert.equal(at('2027-03-28T01:00:00Z'), 120);
});

test('conditions: precipitation first, by type and amount, then fog, then the sky', () => {
  assert.equal(brightSky.classify('thunderstorm', 0.2, false, 90, 15), C.thunderstorm);
  assert.equal(brightSky.classify('hail', null, false, null, 10), C.hail);
  assert.equal(brightSky.classify('sleet', 0.5, false, 100, 1), C.sleet);
  assert.equal(brightSky.classify('snow', 0.4, false, 100, -2), C.lightSnow);
  assert.equal(brightSky.classify('snow', 1.5, false, 100, -2), C.snow);
  assert.equal(brightSky.classify('rain', 0.3, false, 100, 8), C.lightRain);
  assert.equal(brightSky.classify('rain', 4, false, 100, 8), C.rain);
  assert.equal(brightSky.classify('rain', 9, false, 100, 8), C.heavyRain);
  // An amount with no type: rain, or snow below freezing.
  assert.equal(brightSky.classify('dry', 0.5, false, 100, 4), C.lightRain);
  assert.equal(brightSky.classify(null, 0.5, false, 100, -1), C.lightSnow);
  assert.equal(brightSky.classify('dry', 0, true, 100, 4), C.fog);
  assert.equal(brightSky.classify('dry', 0, false, 10, 4), C.clear);
  assert.equal(brightSky.classify('dry', 0, false, 50, 4), C.partly);
  assert.equal(brightSky.classify('dry', 0, false, 80, 4), C.cloudy);
  assert.equal(brightSky.classify('dry', 0, false, 100, 4), C.overcast);
  assert.equal(brightSky.classify(null, null, false, null, null), null);
  Object.keys(C).forEach((key) => {
    assert.ok(C[key].short.length <= 12 && C[key].long.length <= 32, key);
  });
});

test('a day\'s condition: its worst precipitation, else its usual sky and phrase', () => {
  assert.equal(brightSky.summarize([C.clear, C.lightRain, C.partly, C.snow, null]), C.snow);
  assert.equal(brightSky.summarize([C.fog, C.overcast, C.overcast, C.clear]), C.overcast);
  assert.equal(brightSky.summarize([C.clear, C.clear, C.partly]), C.clear);
  assert.equal(brightSky.summarize([null, null]), null);
});

test('each hour pairs its own record with the next one, by timestamp', () => {
  const data = brightSky.normalize([
    record(0, { temperature: 5, dew_point: 2, relative_humidity: null, wind_speed: 10, cloud_cover: 100, condition: 'dry' }),
    record(1, { temperature: 6, dew_point: 2, precipitation: 0.6, precipitation_probability: 70, wind_gust_speed: 30, condition: 'rain' }),
    // No record stamped 02:00: hour 2 has no instants and hour 1 no interval readings.
    record(3, { temperature: 8, precipitation: 3.1, precipitation_probability: 90, wind_gust_speed: 45, condition: 'rain' }),
  ], null, MIDNIGHT, 60, { latitude: 47.99, longitude: 7.85 });
  const h = data.hourly;
  assert.equal(h.start, MIDNIGHT);
  assert.equal(h.temperature.length, 7 * 24);
  assert.deepEqual(h.temperature.slice(0, 4), [5, 6, null, 8]);
  // Hour 0 (00:00-01:00) is what the 01:00 record reports for the hour before it.
  assert.equal(h.precipitationAmount[0], 0.6);
  assert.equal(h.precipitation[0], 70);
  assert.equal(h.windGust[0], 30);
  assert.equal(h.condition[0], C.lightRain);
  // Hour 1's closing record is missing: nothing is shifted into its place.
  assert.equal(h.precipitationAmount[1], null);
  assert.equal(h.precipitationAmount[2], 3.1);
  assert.equal(h.condition[2], C.rain);
  // Humidity from the dew point when the record has none, and feels like from it.
  assert.equal(h.humidity[0], 81);
  assert.ok(typeof h.feelsLike[0] === 'number');
  assert.equal(h.temperature[100], null);
});

test('days need half their hours for highs and lows, most of them for a total', () => {
  const records = [];
  for (let hour = 0; hour <= 36; hour += 1) {
    records.push(record(hour, { temperature: hour % 24, precipitation: 0.5, condition: 'rain', cloud_cover: 100 }));
  }
  const data = brightSky.normalize(records, null, MIDNIGHT, 60, { latitude: 47.99, longitude: 7.85 });
  assert.equal(data.daily.high[0], 23);
  assert.equal(data.daily.low[0], 0);
  assert.equal(data.daily.precipitationAmount[0], 12);
  // Day 2 has 13 hours: highs and lows, but too few for a total.
  assert.equal(data.daily.high[1], 12);
  assert.equal(data.daily.precipitationAmount[1], null);
  assert.equal(data.daily.high[2], null);
  assert.equal(data.daily.condition[0], C.lightRain);
  const sun = sunTimes((MIDNIGHT + 12 * HOUR) * 1000, 47.99, 7.85);
  assert.equal(data.daily.sunrise[0], sun.rise);
  assert.equal(data.daily.sunset[0], sun.set);
  assert.equal(data.daily.sunrise.length, 7);
});

test('the observation: the shortest wind window it has, precipitation scaled to an hour', () => {
  const current = brightSky.normalizeCurrent({
    temperature: 3, dew_point: 1, relative_humidity: null, wind_speed_30: 12, wind_speed_60: 15,
    wind_gust_speed_60: 30, wind_direction_10: 200, precipitation_10: 0.5, cloud_cover: 100, condition: 'rain',
  });
  assert.equal(current.windSpeed, 12);
  assert.equal(current.windGust, 30);
  assert.equal(current.windDirection, 200);
  assert.equal(current.humidity, 87);
  assert.equal(current.condition, C.rain);
  assert.deepEqual(brightSky.normalizeCurrent(null), {});
});

test('the requests: local midnight for seven days, the nearest station within 50 km', () => {
  const url = brightSky.weatherUrl({ latitude: 47.99, longitude: 7.85 }, MIDNIGHT);
  assert.equal(url, 'https://api.brightsky.dev/weather?lat=47.99&lon=7.85&date=2026-11-05T23%3A00%3A00.000Z'
    + '&last_date=2026-11-12T23%3A00%3A00.000Z&max_dist=50000');
  assert.equal(brightSky.currentUrl({ latitude: 47.99, longitude: 7.85 }),
    'https://api.brightsky.dev/current_weather?lat=47.99&lon=7.85&max_dist=50000');
});

test('end to end: Freiburg\'s week, nothing the app would drop', async () => {
  const host = installHost({ locations: [FREIBURG], respond: fixtures() });
  const answer = await host.run(source.createSource({ now: () => NOW_MS }), { category: 'weather', item: 'location' });
  assert.equal(answer.error, undefined);
  const envelope = answer.data;
  assert.deepEqual(validateEnvelope(envelope, DECLARED).dropped, []);
  assert.equal(host.requests.length, 2);

  const p = envelope.instances[0].properties;
  const records = weatherFixture.weather;
  assert.equal(p.utc_offset.numericValue.value, 60);
  assert.equal(p.hourly_temperature.series.start, MIDNIGHT);
  assert.equal(p.hourly_temperature.series.numericValue.values.length, instance.HOURLY_HOURS);
  assert.equal(p.hourly_temperature.series.numericValue.values[10], records[10].temperature);
  assert.equal(p.hourly_precipitation_amount.series.numericValue.values[10], records[11].precipitation);
  assert.equal(p.temperature.numericValue.value, currentFixture.weather.temperature);
  assert.deepEqual(p.daily_high.series.numericValue.values.length, 7);
  assert.ok(p.daily_high.series.numericValue.values.every((value) => typeof value === 'number'));
  assert.equal(p.sunrise.timestamp.value, sunTimes((MIDNIGHT + 12 * HOUR) * 1000, 47.99, 7.85).rise);
  // Rainy hours in the fixture come out as rain.
  const codes = p.hourly_condition_code.series.longText.values;
  const amounts = p.hourly_precipitation_amount.series.numericValue.values;
  amounts.forEach((amount, i) => {
    if (amount >= 0.1) {
      assert.ok(/rain|snow/.test(codes[i]), i + ': ' + codes[i]);
    }
  });
  assert.ok(amounts.some((amount) => amount > 0), 'the fixture has rain');
  // No UV: DWD doesn't have it, so it isn't served or declared.
  assert.equal(p.uv_index, undefined);
  assert.equal(DECLARED.uv_index, undefined);
  assert.deepEqual(Object.keys(p).sort(), Object.keys(DECLARED).sort());
});

test('places outside the area are left to the Pebble app\'s own weather', async () => {
  const host = installHost({
    locations: [weatherLocation('london', 'London', 51.51, -0.13), FREIBURG],
    respond: fixtures(),
  });
  const answer = await host.run(source.createSource({ now: () => NOW_MS }), { category: 'weather', item: 'location' });
  assert.deepEqual(answer.data.instances.map((item) => item.instanceId), ['home']);
  assert.ok(host.requests.every((url) => url.indexOf('lat=47.99') !== -1));
});

test('with no place in the area it says so, without a request', async () => {
  const host = installHost({ locations: [weatherLocation('london', 'London', 51.51, -0.13)], respond: fixtures() });
  const answer = await host.run(source.createSource({ now: () => NOW_MS }), { category: 'weather', item: 'location' });
  assert.deepEqual(answer.error, { code: 'PLUGIN_UNAVAILABLE', message: 'DWD weather covers Germany and the countries around it only.' });
  assert.equal(host.requests.length, 0);
});

test('a missing observation leaves the forecast hour in its place; no forecast fails the place', async () => {
  let host = installHost({ locations: [FREIBURG], respond: fixtures({ current: 500 }) });
  let answer = await host.run(source.createSource({ now: () => NOW_MS }), { category: 'weather', item: 'location' });
  const p = answer.data.instances[0].properties;
  assert.equal(p.temperature.numericValue.value, units.round(weatherFixture.weather[9].temperature, 1));
  uninstallHost();

  host = installHost({ locations: [FREIBURG], respond: fixtures({ weather: 404 }) });
  answer = await host.run(source.createSource({ now: () => NOW_MS }), { category: 'weather', item: 'location' });
  assert.deepEqual(answer.error, { code: 'PLUGIN_UNAVAILABLE', message: 'Could not reach Bright Sky (DWD).' });
});
