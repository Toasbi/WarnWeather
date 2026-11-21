// test/weather/application/fetch-sources.test.js — one fetch's sources, run in the test world
// (test/helpers/provider-world.js): the Weather picker's provider fetches its own forecast,
// then each fill puts its reading on it. So far the one fill is DWD's UV, from Open-Meteo's
// UV-only request.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const world = require('../../helpers/provider-world.js');
const providerReadings = require('../../../src/pkjs/weather/domain/provider-readings.js');

const HOUR = 3600;
const KEYS = { owmApiKey: 'owm-test-key', tomorrowioApiKey: 'tio-test-key', yandexApiKey: 'ydx-test-key' };

/**
 * Run fetchSources for a provider, prepared as the fetch cycle prepares it, in the world.
 * @param {string} id A provider id.
 * @param {Object} options fetch-options overrides.
 * @param {Object} [opts]
 * @param {function(string): boolean} [opts.answers] Which requests the services answer.
 * @param {boolean} [opts.noPorts] Leave provider.sources null.
 * @param {function(Object, function(string): *): void} [opts.before] Runs on the provider first
 *   (with the module loader), e.g. to stand in a last fetch's series.
 * @returns {{p: Object, outcome: string, failure: ?Object, requests: string[]}} The anchor after it.
 */
function run(id, options, opts) {
  const o = opts || {};
  return world.inWorld({ platform: 'basalt' }, ({ mod, requests }) => {
    localStorage.setItem(mod('settings/domain/storage-keys.js').WU_API_KEY, 'stored-key');
    const p = mod('weather/adapter/provider-factory.js').createProvider(id, KEYS);
    p.options = mod('weather/domain/fetch-options.js').defaults(Object.assign({ dayPeakCodes: [] }, options));
    p.sources = o.noPorts ? null : mod('weather/adapter/weather-sources.js').create();
    if (o.before) { o.before(p, mod); }
    let outcome = 'pending';
    let failure = null;
    mod('weather/application/fetch-sources.js').fetchSources(p, p.sources, world.PLACE.lat, world.PLACE.lon, false,
      () => { outcome = 'ok'; }, (f) => { outcome = 'failed'; failure = f; });
    return { p: p, outcome: outcome, failure: failure, requests: requests };
  }, { answers: o.answers });
}

/**
 * @param {string} request A recorded request ('GET <url>').
 * @returns {string} Its URL without the query.
 */
function endpoint(request) { return request.split(' ')[1].split('?')[0]; }

test('DWD\'s UV: Open-Meteo\'s UV-only request after DWD\'s own two, each hour the hour DWD\'s slot draws', () => {
  const { p, outcome, requests } = run('dwd', { fetchUv: true });
  assert.equal(outcome, 'ok');
  assert.deepEqual(requests.map(endpoint), ['https://api.brightsky.dev/weather',
    'https://api.brightsky.dev/current_weather', 'https://api.open-meteo.com/v1/forecast']);
  assert.match(requests[2], /hourly=uv_index&.*models=ncep_gfs_global/);
  assert.equal(p.startTime, world.HOUR0);
  for (let i = 0; i < 24; i += 1) {
    assert.equal(p.uvTrend[i], world.hourAt(world.HOUR0 + i * HOUR).uv, 'hour ' + i);
  }
  assert.equal(p.uvFeedId, 'openmeteo', 'the UV day record is Open-Meteo\'s, as when Open-Meteo is the provider');
});

test('DWD with UV not drawn asks nobody else and keeps no UV feed', () => {
  const { p, outcome, requests } = run('dwd', { fetchUv: false });
  assert.equal(outcome, 'ok');
  assert.equal(requests.length, 2);
  assert.deepEqual(p.uvTrend, []);
  assert.equal(p.uvFeedId, null);
});

test('a failed UV fill leaves the UV empty and the fetch whole, on a reused instance too', () => {
  const refused = (url) => url.indexOf('hourly=uv_index') === -1;
  const { p, outcome } = run('dwd', { fetchUv: true }, {
    answers: refused,
    before: (provider) => { provider.uvTrend = [9, 9, 9]; }   // the last fetch's window
  });
  assert.equal(outcome, 'ok', 'a fill never fails the fetch');
  assert.deepEqual(p.uvTrend, [], 'the last fetch\'s window does not survive against the new hours');
});

test('the UV fill reads the span: two days, three for 48 h, four for the long span or a day max', () => {
  const days = (options) => /&forecast_days=(\d)/.exec(run('dwd', Object.assign({ fetchUv: true }, options))
    .requests[2])[1];
  assert.equal(days({}), '2');
  assert.equal(days({ forecastHours: 48 }), '3');
  assert.equal(days({ forecastHours: 68 }), '4');
  assert.equal(days({ dayPeakCodes: ['uv'] }), '4');
  assert.equal(run('dwd', { fetchUv: true, forecastHours: 48 }).p.uvTrend.length, 49, 'out to PEAK_HOURS');
  assert.equal(run('dwd', { fetchUv: true, forecastHours: 68 }).p.uvTrend.length, 68);
});

test('a provider that sends UV makes only its own requests, and its UV is its own feed', () => {
  ['openmeteo', 'metno', 'openweathermap', 'tomorrowio', 'wunderground', 'yandex'].forEach((id) => {
    const { p, outcome, requests } = run(id, { fetchUv: true });
    assert.equal(outcome, 'ok', id);
    assert.equal(requests.length, providerReadings.requests(id, true), id + ':\n' + requests.join('\n'));
    assert.ok(p.uvTrend.length > 0, id + ' sends UV');
    assert.equal(p.uvFeedId, null, id);
  });
});

test('the anchor\'s failure fails the fetch, and no fill is asked', () => {
  const { outcome, failure, requests } = run('dwd', { fetchUv: true },
    { answers: (url) => url.indexOf('api.brightsky.dev/weather') === -1 });
  assert.equal(outcome, 'failed');
  assert.deepEqual(failure, { stage: 'provider_data', code: 'dwd_forecast_status_503' });
  assert.equal(requests.length, 1);
});

test('a provider without sources fetches its own data alone', () => {
  const { p, outcome, requests } = run('dwd', { fetchUv: true }, { noPorts: true });
  assert.equal(outcome, 'ok');
  assert.equal(requests.length, 2);
  assert.deepEqual(p.uvTrend, []);
});
