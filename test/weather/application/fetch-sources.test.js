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
    p.sources = o.noPorts ? null : mod('weather/adapter/weather-sources.js').create({ fetchIntervalMin: '15' });
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

// --- forecast snapshots -----------------------------------------------------------------
// Each source's answer is kept (forecast-snapshot.js): a fetch later in the same refresh slot
// reuses the provider's, and DWD's UV fill serves three hours.

const MIN = 60 * 1000;
const fetchOptions = require('../../../src/pkjs/weather/domain/fetch-options.js');
const forecastModel = require('../../../src/pkjs/weather/domain/forecast-model.js');

/**
 * Several fetches of one provider in one world, its store kept between them, each with a new
 * instance (as after a settings save) unless `reuse` is set.
 * @param {string} id A provider id.
 * @param {Array<{at: number, options: (Object|undefined), keys: (Object|undefined),
 *   lat: (number|undefined), before: (function(Object): void|undefined)}>} fetches When (ms
 *   after the world's now) and with what; before(p) runs on the instance first.
 * @param {{reuse: boolean}} [opts] One instance for every fetch (a scheduled refresh).
 * @returns {Array<{p: Object, outcome: string, requests: string[], forecast: string}>} Each
 *   fetch's instance, its own requests and its forecast fields right after it (forecastOf).
 */
function fetchesOf(id, fetches, opts) {
  const clock = { now: world.NOW_MS };
  return world.inWorld({ platform: 'basalt' }, ({ mod, requests }) => {
    localStorage.setItem(mod('settings/domain/storage-keys.js').WU_API_KEY, 'stored-key');
    let p = null;
    return fetches.map((f) => {
      clock.now = world.NOW_MS + f.at;
      const from = requests.length;
      if (!p || !(opts && opts.reuse)) {
        p = mod('weather/adapter/provider-factory.js').createProvider(id, Object.assign({}, KEYS, f.keys));
      }
      p.options = fetchOptions.defaults(Object.assign({ fetchUv: true, dayPeakCodes: [] }, f.options));
      p.sources = mod('weather/adapter/weather-sources.js').create({ fetchIntervalMin: '15' });
      if (f.before) { f.before(p); }
      let outcome = 'pending';
      mod('weather/application/fetch-sources.js').fetchSources(p, p.sources, f.lat || world.PLACE.lat,
        world.PLACE.lon, false, () => { outcome = 'ok'; }, (fail) => { outcome = 'failed ' + JSON.stringify(fail); });
      return { p: p, outcome: outcome, requests: requests.slice(from), forecast: forecastOf(p) };
    });
  }, { now: () => clock.now });
}

/**
 * @param {Object} p A provider after its fetch.
 * @returns {string} Its forecast fields as JSON.
 */
function forecastOf(p) {
  const out = {};
  forecastModel.ADOPTED_KEYS.forEach((key) => { out[key] = p[key]; });
  return JSON.stringify(out);
}

['dwd', 'openmeteo', 'metno', 'openweathermap', 'tomorrowio', 'wunderground', 'yandex'].forEach((id) => {
  test(id + ': a second fetch in the refresh slot asks nobody and holds the same forecast', () => {
    const [first, second] = fetchesOf(id, [{ at: 0 }, { at: 5 * MIN }]);
    assert.equal(first.outcome, 'ok');
    assert.ok(first.requests.length > 0);
    assert.equal(second.outcome, 'ok');
    assert.deepEqual(second.requests, []);
    assert.equal(second.forecast, first.forecast);
  });
});

test('the next refresh slot asks the provider again', () => {
  const [, next] = fetchesOf('metno', [{ at: 5 * MIN }, { at: 15 * MIN }]);
  assert.equal(next.requests.length, 1);
});

test('a refresh on the same instance takes the whole snapshot back, every field', () => {
  const scramble = (p) => {
    forecastModel.ADOPTED_KEYS.forEach((key) => { p[key] = Array.isArray(p[key]) ? [99] : 'stale'; });
  };
  const [first, second] = fetchesOf('openmeteo', [{ at: 0 }, { at: 5 * MIN, before: scramble }], { reuse: true });
  assert.deepEqual(second.requests, []);
  assert.equal(second.forecast, first.forecast);
});

test('a new key, a new place, another span or UV turned off asks again', () => {
  const asked = (change) => fetchesOf('openweathermap', [{ at: 0 }, Object.assign({ at: 5 * MIN }, change)])[1]
    .requests.length;
  assert.equal(asked({ keys: { owmApiKey: 'a-new-key' } }), 1, 'a new key is tried at once');
  assert.equal(asked({ lat: world.PLACE.lat + 0.02 }), 1, 'two kilometres north');
  assert.equal(asked({ options: { forecastHours: 68 } }), 1, 'the long span');
  assert.equal(asked({ options: { fetchUv: false } }), 1, 'UV off');
  assert.equal(asked({ options: { windUnits: 'mph' } }), 0, 'the wind unit changes no answer');
});

test('DWD\'s UV fill serves three hours, from the hour DWD\'s new forecast starts', () => {
  const [, later, after] = fetchesOf('dwd', [{ at: 0 }, { at: 2 * 60 * MIN }, { at: 3 * 60 * MIN + MIN }]);
  assert.deepEqual(later.requests.map(endpoint), ['https://api.brightsky.dev/weather',
    'https://api.brightsky.dev/current_weather'], 'two hours on: DWD again, the UV kept');
  assert.equal(later.p.startTime, world.HOUR0 + 2 * HOUR);
  for (let i = 0; i < 24; i += 1) {
    assert.equal(later.p.uvTrend[i], world.hourAt(world.HOUR0 + (i + 2) * HOUR).uv, 'hour ' + i);
  }
  assert.equal(after.requests.length, 3, 'past three hours the UV is asked again');
});

test('a UV fill that failed is not kept: the next fetch asks again', () => {
  const clock = { now: world.NOW_MS };
  let refuse = true;
  const counts = world.inWorld({ platform: 'basalt' }, ({ mod, requests }) => [0, 20 * MIN].map((at) => {
    clock.now = world.NOW_MS + at;
    const from = requests.length;
    const p = mod('weather/adapter/provider-factory.js').createProvider('dwd', {});
    p.options = fetchOptions.defaults({ fetchUv: true, dayPeakCodes: [] });
    p.sources = mod('weather/adapter/weather-sources.js').create({ fetchIntervalMin: '15' });
    mod('weather/application/fetch-sources.js').fetchSources(p, p.sources, world.PLACE.lat, world.PLACE.lon, false,
      () => {}, (f) => { throw new Error(JSON.stringify(f)); });
    refuse = false;
    return requests.slice(from).filter((r) => r.indexOf('uv_index') !== -1).length;
  }), { now: () => clock.now, answers: (url) => !(refuse && url.indexOf('uv_index') !== -1) });
  assert.deepEqual(counts, [1, 1]);
});

test('a reused forecast sends the watch the same payload, byte for byte, and only the city and air quality are asked', () => {
  const clock = { now: world.NOW_MS };
  const runs = world.inWorld({ platform: 'basalt' }, ({ mod, requests }) => [0, 4 * MIN].map((at) => {
    clock.now = world.NOW_MS + at;
    const from = requests.length;
    const settings = Object.assign(mod('settings/adapter/clay-settings.js')
      .getDefaults({ white: 0xFFFFFF, folly: 0xFF0055, holiday: 0x0055FF }), { provider: 'dwd' });
    const watchInfo = { platform: 'basalt' };
    const outbox = mod('wire/adapter/outbox.js');
    let sent = null;
    outbox.sendWeather = (payload, onAck) => { sent = payload; onAck(); };
    const p = mod('weather/adapter/provider-factory.js').createProvider('dwd', settings);
    p.options = fetchOptions.build(settings, watchInfo, { waqiToken: '' });
    p.sources = mod('weather/adapter/weather-sources.js').create(settings);
    const render = mod('weather/application/render-payload.js');
    p.fetchWithCoordinates(world.PLACE.lat, world.PLACE.lon, () => {}, (f) => { throw new Error(JSON.stringify(f)); },
      false, { IS_SLEEPING: false }, (payload) => render.toRenderPayload(payload, settings, watchInfo, new Date(), null));
    return { payload: JSON.stringify(sent), hosts: requests.slice(from).map((r) => new URL(r.split(' ')[1]).host) };
  }), { now: () => clock.now });
  assert.equal(runs[1].payload, runs[0].payload);
  assert.deepEqual(runs[1].hosts, ['geocode.arcgis.com', 'air-quality-api.open-meteo.com']);
});
