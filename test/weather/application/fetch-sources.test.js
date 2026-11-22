// test/weather/application/fetch-sources.test.js — one fetch's sources, run in the test world
// (test/helpers/provider-world.js): the Weather picker's provider fetches its own forecast,
// then each fill puts its reading on it (so far DWD's UV, from Open-Meteo's UV-only request),
// and each answer is kept as a forecast snapshot that a fetch soon after reuses.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const world = require('../../helpers/provider-world.js');
const providerReadings = require('../../../src/pkjs/weather/domain/provider-readings.js');
const providerFactory = require('../../../src/pkjs/weather/adapter/provider-factory.js');
const forecastModel = require('../../../src/pkjs/weather/domain/forecast-model.js');
const forecastSnapshot = require('../../../src/pkjs/weather/domain/forecast-snapshot.js');

const HOUR = 3600;
const MIN = 60 * 1000;
const QUARTER = 15 * MIN;
const UV_SENDERS = providerFactory.PROVIDER_IDS.filter((id) => providerReadings.serves(id, 'uv'));

/**
 * @param {Object} p A provider after its fetch.
 * @returns {string} Its forecast fields as JSON.
 */
function forecastOf(p) {
  const out = {};
  forecastModel.ADOPTED_KEYS.forEach((key) => { out[key] = p[key]; });
  return JSON.stringify(out);
}

/**
 * Fetches of one provider's sources in one world, its store kept between them, each with a
 * new instance (as after a settings save) unless `reuse` is set, each with the source ports
 * of a 15-minute update interval unless `refreshMs` names another. Each fetch's options are a
 * watch's that draws UV unless its own say otherwise; fetchUv follows the drawn readings, and
 * the sources follow the settings (the stored keys) with the fetch's own over them, as
 * fetch-options.js build sets them.
 * @param {string} id A provider id.
 * @param {Array<{at: (number|undefined), options: (Object|undefined), keys: (Object|undefined),
 *   lat: (number|undefined), country: (string|undefined), before: (function(Object, Function): void|undefined)}>}
 *   fetches When (ms after the world's now) and with what (the country the place's reverse
 *   geocode found); before(p, mod) runs on the instance first.
 * @param {{reuse: boolean, answers: function(string): boolean, refreshMs: number}} [opts] One
 *   instance for every fetch (a scheduled refresh); which requests the services answer; the
 *   update interval.
 * @returns {Array<{p: Object, outcome: string, failure: ?Object, requests: string[], forecast: string}>}
 *   Each fetch's instance, its outcome and own requests, and its forecast fields right after it.
 */
function fetchesOf(id, fetches, opts) {
  const o = opts || {};
  return world.inWorld({ platform: 'basalt' }, ({ mod, requests, setNow }) => {
    localStorage.setItem(mod('settings/domain/storage-keys.js').WU_API_KEY, 'stored-key');
    let p = null;
    return fetches.map((f) => {
      setNow(world.NOW_MS + (f.at || 0));
      const from = requests.length;
      const settings = Object.assign({}, world.KEYS, f.keys);
      if (!p || !o.reuse) {
        p = mod('weather/adapter/provider-factory.js').createProvider(id, settings);
      }
      const given = Object.assign({ drawn: ['uv'], dayPeakCodes: [] }, f.options);
      given.sources = Object.assign(mod('weather/domain/source-plan.js').sourcesOf(settings), given.sources);
      p.options = mod('weather/domain/fetch-options.js').defaults(
        Object.assign({ fetchUv: given.drawn.indexOf('uv') !== -1 }, given));
      p.countryCode = f.country || null;
      const ports = mod('weather/adapter/source-ports.js').create(() => Date.now(), o.refreshMs || QUARTER, settings,
        p.options);
      if (f.before) { f.before(p, mod); }
      const run = { p: p, outcome: 'pending', failure: null };
      mod('weather/application/fetch-sources.js').fetchSources(p, ports, f.lat || world.PLACE.lat, world.PLACE.lon,
        false, () => { run.outcome = 'ok'; }, (failure) => { run.outcome = 'failed'; run.failure = failure; });
      run.requests = requests.slice(from);
      run.forecast = forecastOf(p);
      return run;
    });
  }, { answers: o.answers });
}

/**
 * @param {string} request A recorded request ('GET <url>').
 * @returns {string} Its URL without the query.
 */
function endpoint(request) { return request.split(' ')[1].split('?')[0]; }

test('DWD\'s UV: Open-Meteo\'s UV-only request after DWD\'s own two, each hour the hour DWD\'s slot draws', () => {
  const [{ p, outcome, requests }] = fetchesOf('dwd', [{}]);
  assert.equal(outcome, 'ok');
  assert.deepEqual(requests.map(endpoint), ['https://api.brightsky.dev/weather',
    'https://api.brightsky.dev/current_weather', 'https://api.open-meteo.com/v1/forecast']);
  assert.match(requests[2], /hourly=uv_index&.*models=ncep_gfs_global/);
  assert.equal(p.startTime, world.HOUR0);
  for (let i = 0; i < 24; i += 1) {
    assert.equal(p.uvTrend[i], world.hourAt(world.HOUR0 + i * HOUR).uv, 'hour ' + i);
  }
  assert.equal(p.feeds.uv, 'openmeteo', 'the UV day record is Open-Meteo\'s, as when Open-Meteo is the provider');
});

test('DWD with UV not drawn asks nobody else and keeps no UV feed', () => {
  const [{ p, outcome, requests }] = fetchesOf('dwd', [{ options: { drawn: [] } }]);
  assert.equal(outcome, 'ok');
  assert.equal(requests.length, 2);
  assert.deepEqual(p.uvTrend, []);
  assert.equal(p.feeds.uv, 'dwd');
});

test('a failed UV fill leaves the UV empty, names no UV feed, and fails nothing', () => {
  const [{ p, outcome }] = fetchesOf('dwd', [{ before: (provider) => { provider.uvTrend = [9, 9, 9]; } }],
    { answers: (url) => url.indexOf('hourly=uv_index') === -1 });
  assert.equal(outcome, 'ok', 'a fill never fails the fetch');
  assert.deepEqual(p.uvTrend, [], 'the last fetch\'s window does not survive against the new hours');
  assert.equal(p.feeds.uv, 'dwd', 'Open-Meteo sent no UV: DWD\'s empty one');
});

test('the UV fill reads the span: two days, three for 48 h, four for the long span or a day max', () => {
  const days = (options) => /&forecast_days=(\d)/.exec(fetchesOf('dwd', [{ options: options }])[0].requests[2])[1];
  assert.equal(days({}), '2');
  assert.equal(days({ forecastHours: 48 }), '3');
  assert.equal(days({ forecastHours: 68 }), '4');
  assert.equal(days({ dayPeakCodes: ['uv'] }), '4');
  assert.equal(fetchesOf('dwd', [{ options: { forecastHours: 48 } }])[0].p.uvTrend.length, 49, 'out to PEAK_HOURS');
  assert.equal(fetchesOf('dwd', [{ options: { forecastHours: 68 } }])[0].p.uvTrend.length, 68);
});

test('a provider that sends UV makes only its own requests, and its UV is its own feed', () => {
  UV_SENDERS.forEach((id) => {
    const [{ p, outcome, requests }] = fetchesOf(id, [{}]);
    assert.equal(outcome, 'ok', id);
    assert.equal(requests.length, providerReadings.requests(id, true), id + ':\n' + requests.join('\n'));
    assert.ok(p.uvTrend.length > 0, id + ' sends UV');
    assert.equal(p.feeds.uv, id);
  });
});

test('the anchor\'s failure fails the fetch, and no fill is asked', () => {
  const [{ outcome, failure, requests }] = fetchesOf('dwd', [{}],
    { answers: (url) => url.indexOf('api.brightsky.dev/weather') === -1 });
  assert.equal(outcome, 'failed');
  assert.deepEqual(failure, { stage: 'provider_data', code: 'dwd_forecast_status_503' });
  assert.equal(requests.length, 1);
});

test('an answer the rest of the fetch cannot use fails it, and is not kept for the next fetch', () => {
  const short = (p) => {
    const own = p.withProviderData;
    p.withProviderData = function (lat, lon, force, onSuccess, onFailure) {
      own.call(this, lat, lon, force, () => { this.tempTrend = this.tempTrend.slice(0, 10); onSuccess(); }, onFailure);
    };
  };
  const [first, second] = fetchesOf('metno', [{ before: short }, { at: MIN }]);
  assert.equal(first.outcome, 'failed');
  assert.deepEqual(first.failure, { stage: 'provider_data', code: 'invalid_data' });
  assert.equal(second.requests.length, 1, 'the next fetch asks Met.no again');
  assert.equal(second.outcome, 'ok');
});

// --- forecast snapshots -----------------------------------------------------------------

providerFactory.PROVIDER_IDS.forEach((id) => {
  test(id + ': a second fetch in the refresh slot asks nobody and holds the same forecast', () => {
    const [first, second] = fetchesOf(id, [{}, { at: 5 * MIN }]);
    assert.equal(first.outcome, 'ok');
    assert.ok(first.requests.length > 0);
    assert.equal(second.outcome, 'ok');
    assert.deepEqual(second.requests, []);
    assert.equal(second.forecast, first.forecast);
  });
});

test('the next refresh slot asks the provider again', () => {
  const [, next] = fetchesOf('metno', [{ at: 5 * MIN }, { at: QUARTER }]);
  assert.equal(next.requests.length, 1);
});

test('a refresh on the same instance takes the whole snapshot back, every field', () => {
  const scramble = (p) => {
    forecastModel.ADOPTED_KEYS.forEach((key) => { p[key] = Array.isArray(p[key]) ? [99] : 'stale'; });
  };
  const [first, second] = fetchesOf('openmeteo', [{}, { at: 5 * MIN, before: scramble }], { reuse: true });
  assert.deepEqual(second.requests, []);
  assert.equal(second.forecast, first.forecast);
});

test('a new key, a place two kilometres on, another span or UV turned off asks again', () => {
  const asked = (change) => fetchesOf('openweathermap', [{}, Object.assign({ at: 5 * MIN }, change)])[1]
    .requests.length;
  assert.equal(asked({ keys: { owmApiKey: 'a-new-key' } }), 1, 'a new key is tried at once');
  assert.equal(asked({ lat: world.PLACE.lat + 0.02 }), 1, 'two kilometres north');
  assert.equal(asked({ lat: world.PLACE.lat + 0.005 }), 0, 'a GPS fix 500 m off is the same place');
  assert.equal(asked({ options: { forecastHours: 68 } }), 1, 'the long span');
  assert.equal(asked({ options: { drawn: [] } }), 1, 'UV off');
  assert.equal(asked({ options: { windUnits: 'mph' } }), 0, 'the wind unit changes no answer');
});

test('DWD\'s UV fill serves three hours, from the hour DWD\'s new forecast starts', () => {
  const late = forecastSnapshot.UV_REUSE_MS + MIN;
  const [, later, after] = fetchesOf('dwd', [{}, { at: 2 * HOUR * 1000 }, { at: late }]);
  assert.deepEqual(later.requests.map(endpoint), ['https://api.brightsky.dev/weather',
    'https://api.brightsky.dev/current_weather'], 'two hours on: DWD again, the UV kept');
  assert.equal(later.p.startTime, world.HOUR0 + 2 * HOUR);
  for (let i = 0; i < 24; i += 1) {
    assert.equal(later.p.uvTrend[i], world.hourAt(world.HOUR0 + (i + 2) * HOUR).uv, 'hour ' + i);
  }
  assert.equal(later.p.feeds.uv, 'openmeteo', 'a reused fill names its feed too');
  assert.equal(after.requests.length, 3, 'past three hours the UV is asked again');
});

test('a UV fill that failed is not kept: the next fetch asks again', () => {
  let refuse = true;
  const runs = fetchesOf('dwd', [{}, { at: 20 * MIN, before: () => { refuse = false; } }],
    { answers: (url) => !(refuse && url.indexOf('uv_index') !== -1) });
  assert.deepEqual(runs.map((r) => r.requests.filter((q) => q.indexOf('uv_index') !== -1).length), [1, 1]);
});

test('a reused forecast sends the watch the same payload, byte for byte, and only the city and air quality are asked', () => {
  const watchInfo = { platform: 'basalt' };
  const runs = world.inWorld(watchInfo, ({ mod, requests, setNow }) => [0, 4 * MIN].map((at) => {
    setNow(world.NOW_MS + at);
    const from = requests.length;
    const run = world.fetchLikeTheCycle(mod, world.settingsFor(mod, 'dwd'), watchInfo);
    return { outcome: run.outcome, payload: JSON.stringify(run.payload),
      hosts: requests.slice(from).map((r) => new URL(r.split(' ')[1]).host) };
  }));
  assert.deepEqual(runs.map((r) => r.outcome), ['ok', 'ok']);
  assert.equal(runs[1].payload, runs[0].payload);
  assert.deepEqual(runs[1].hosts, ['geocode.arcgis.com', 'air-quality-api.open-meteo.com']);
});

test('a UV fill that brings nothing leaves no UV, whatever the anchor held before it', () => {
  // A stand-in for an anchor whose own answer left a UV window behind: the fill clears it
  // first, so a fill that brings nothing is a failed fill, and names no feed.
  const stale = (p) => {
    const own = p.withProviderData;
    p.withProviderData = function (lat, lon, force, onSuccess, onFailure) {
      own.call(this, lat, lon, force, () => { this.uvTrend = [5, 5, 5]; onSuccess(); }, onFailure);
    };
  };
  const [{ p, outcome }] = fetchesOf('dwd', [{ before: stale }],
    { answers: (url) => url.indexOf('hourly=uv_index') === -1 });
  assert.equal(outcome, 'ok');
  assert.deepEqual(p.uvTrend, []);
  assert.equal(p.feeds.uv, 'dwd');
});

/**
 * Make the instance's own answer come back after `during` ran, as if it ran in the network wait.
 * @param {function(Function): void} during Receives the world's mod().
 * @returns {function(Object, Function): void} A fetchesOf before().
 */
function whileAsking(during) {
  return (p, mod) => {
    const own = p.withProviderData;
    p.withProviderData = function (lat, lon, force, onSuccess, onFailure) {
      own.call(this, lat, lon, force, () => { during(mod); onSuccess(); }, onFailure);
    };
  };
}

/**
 * Change the stored snapshots, as damage in the phone's storage would.
 * @param {Function} mod The world's mod().
 * @param {function(Object): void} change Receives each stored snapshot.
 * @returns {void}
 */
function damage(mod, change) {
  const key = mod('settings/domain/storage-keys.js').FORECAST_SNAPSHOTS_KEY;
  const stored = JSON.parse(localStorage.getItem(key));
  stored.entries.forEach(change);
  localStorage.setItem(key, JSON.stringify(stored));
}

test('a drop while a source answers keeps nothing asked before it, so the fetch it forces asks again', () => {
  // Force weather fetch drops the store, and its fetch waits for one already on its way.
  const drop = whileAsking((mod) => { mod('weather/adapter/forecast-snapshots.js').clear(); });
  const [during, forced, after] = fetchesOf('dwd', [{ before: drop }, { at: MIN }, { at: 2 * MIN }]);
  assert.equal(during.outcome, 'ok', 'the fetch on its way still delivers');
  assert.equal(forced.requests.length, 3, 'the forced fetch asks DWD and the UV fill again');
  assert.deepEqual(after.requests, [], 'and keeps both answers');
});

test('a keep writes over the store as it is then, not as the fetch read it', () => {
  const saved = [];
  const kept = world.inWorld({ platform: 'basalt' }, ({ mod }) => {
    const snapshots = mod('weather/domain/forecast-snapshot.js');
    const p = mod('weather/adapter/provider-factory.js').createProvider('metno', world.KEYS);
    p.options = mod('weather/domain/fetch-options.js').defaults({ dayPeakCodes: [] });
    const standIn = (id) => {
      const s = mod('weather/adapter/provider-factory.js').createProvider(id, world.KEYS);
      s.options = p.options;
      s.startTime = world.HOUR0;
      return snapshots.snapshotOf(snapshots.queryOf({ provider: id, ask: 'forecast' }, s, world.PLACE.lat,
        world.PLACE.lon), s, world.NOW_MS);
    };
    const stores = [[standIn('tomorrowio')], [standIn('yandex')]];
    let loads = 0;
    const ports = { fillUv: (q, lat, lon, done) => done(), now: () => Date.now(), refreshMs: QUARTER,
      snapshots: { load: () => ({ entries: stores[Math.min(loads++, 1)], drops: 0 }),
        save: (snapshotsNow) => { saved.push(snapshotsNow); } } };
    mod('weather/application/fetch-sources.js').fetchSources(p, ports, world.PLACE.lat, world.PLACE.lon, false,
      () => {}, (f) => { throw new Error(JSON.stringify(f)); });
    return saved.map((s) => ({ providers: s.entries.map((e) => e.provider), drops: s.drops }));
  });
  assert.deepEqual(kept, [{ providers: ['metno', 'yandex'], drops: 0 }]);
});

test('a stored forecast that does not hold one is asked for again, and the answer takes its place', () => {
  const short = (p, mod) => { damage(mod, (e) => { e.fields.tempTrend = e.fields.tempTrend.slice(0, 3); }); };
  const [first, damaged, next] = fetchesOf('metno', [{}, { at: MIN, before: short }, { at: 2 * MIN }]);
  assert.equal(damaged.outcome, 'ok');
  assert.equal(damaged.requests.length, 1, 'Met.no is asked again');
  assert.equal(damaged.forecast, first.forecast, 'every field from the new answer');
  assert.deepEqual(next.requests, [], 'which is kept');
});

test('a stored UV fill that holds no UV is asked for again', () => {
  const empty = (p, mod) => { damage(mod, (e) => { if (e.kind === 'uv') { e.fields.uvTrend = 'none'; } }); };
  const [, damaged] = fetchesOf('dwd', [{}, { at: MIN, before: empty }]);
  assert.equal(damaged.outcome, 'ok');
  assert.deepEqual(damaged.requests.map(endpoint), ['https://api.open-meteo.com/v1/forecast'],
    'DWD\'s forecast from its snapshot, the UV asked again');
  assert.equal(damaged.p.uvTrend.length, 49);
});

// --- the fill of the other readings a provider lacks -------------------------------------

const YANDEX_GAPS = ['dew', 'windDir', 'cloud', 'pressure'];
const { weightedCloudCover } = require('../../../src/pkjs/weather/domain/cloud-cover.js');

/**
 * @param {string} request A recorded request.
 * @returns {string[]} The hourly fields it asks for.
 */
function hourlyOf(request) { return new URL(request.split(' ')[1]).searchParams.get('hourly').split(','); }

test('Yandex\'s drawn readings come from one Open-Meteo request after its own, hour by hour', () => {
  const [{ p, outcome, requests }] = fetchesOf('yandex', [{ options: { drawn: YANDEX_GAPS } }]);
  assert.equal(outcome, 'ok');
  assert.equal(requests.length, 2, requests.join('\n'));
  assert.deepEqual(hourlyOf(requests[1]), ['dew_point_2m', 'wind_direction_10m', 'cloud_cover', 'cloud_cover_low',
    'cloud_cover_mid', 'cloud_cover_high', 'pressure_msl']);
  for (let i = 0; i < 24; i += 1) {
    const h = world.hourAt(p.startTime + i * HOUR);
    assert.equal(p.dewTrend[i], Math.round((h.dewC * 9 / 5 + 32) * 10) / 10, 'dew point, hour ' + i);
    assert.equal(p.windDirTrend[i], h.windDir % 360, 'wind direction, hour ' + i);
    assert.equal(p.cloudTrend[i], weightedCloudCover(h.cloudLow, h.cloudMid, h.cloudHigh, h.cloud), 'cloud, hour ' + i);
    assert.equal(p.pressureTrend[i], h.pressure, 'pressure, hour ' + i);
  }
});

test('only the drawn readings Yandex lacks are asked for', () => {
  const [{ p, requests }] = fetchesOf('yandex', [{ options: { drawn: ['cloud', 'uv'] } }]);
  assert.deepEqual(hourlyOf(requests[1]), ['cloud_cover', 'cloud_cover_low', 'cloud_cover_mid', 'cloud_cover_high']);
  assert.deepEqual([p.dewTrend, p.windDirTrend, p.pressureTrend], [[], [], []]);
  assert.equal(fetchesOf('yandex', [{}])[0].requests.length, 1, 'nothing drawn, nothing asked');
});

test('a gap request that fails leaves its readings empty and fails nothing', () => {
  const [{ p, outcome }] = fetchesOf('yandex', [{ options: { drawn: YANDEX_GAPS } }],
    { answers: (url) => url.indexOf('hourly=dew_point_2m') === -1 });
  assert.equal(outcome, 'ok');
  assert.deepEqual([p.dewTrend, p.windDirTrend, p.cloudTrend, p.pressureTrend], [[], [], [], []]);
});

test('a second fetch in the refresh slot asks nobody: the fill is kept with the forecast', () => {
  const both = { options: { drawn: YANDEX_GAPS } };
  const [first, second] = fetchesOf('yandex', [both, Object.assign({ at: 5 * MIN }, both)]);
  assert.deepEqual(second.requests, []);
  assert.equal(second.forecast, first.forecast);
  const [, fewer] = fetchesOf('yandex', [both, { at: 5 * MIN, options: { drawn: ['cloud'] } }]);
  assert.deepEqual(fewer.requests.map(hourlyOf), [['cloud_cover', 'cloud_cover_low', 'cloud_cover_mid', 'cloud_cover_high']],
    'other readings are another request');
});

test('a stored fill that holds none of its readings is asked for again', () => {
  const empty = (p, mod) => {
    damage(mod, (e) => { if (e.kind === 'readings') { Object.keys(e.fields).forEach((k) => { e.fields[k] = 'none'; }); } });
  };
  const runs = fetchesOf('yandex', [{ options: { drawn: YANDEX_GAPS } },
    { at: MIN, before: empty, options: { drawn: YANDEX_GAPS } }]);
  assert.deepEqual(runs[1].requests.map(endpoint), ['https://api.open-meteo.com/v1/forecast']);
  assert.equal(runs[1].p.cloudTrend.length, 24);
});

test('a gap fill that brings nothing leaves its readings empty, whatever the anchor held before it', () => {
  // A stand-in for an anchor whose own answer left series behind: the fill clears what it
  // asks for first.
  const stale = (p) => {
    const own = p.withProviderData;
    p.withProviderData = function (lat, lon, force, onSuccess, onFailure) {
      own.call(this, lat, lon, force, () => { this.dewTrend = [1, 2]; this.cloudTrend = [3, 4]; onSuccess(); }, onFailure);
    };
  };
  const [{ p, outcome }] = fetchesOf('yandex', [{ before: stale, options: { drawn: ['dew', 'cloud'] } }],
    { answers: (url) => url.indexOf('hourly=dew_point_2m') === -1 });
  assert.equal(outcome, 'ok');
  assert.deepEqual([p.dewTrend, p.cloudTrend], [[], []]);
});

// --- By location ----------------------------------------------------------------------------

const BY_LOCATION = { sources: { mode: 'auto' } };
const DWD_HOSTS = ['https://api.brightsky.dev/weather', 'https://api.brightsky.dev/current_weather'];

test('By location in Germany: DWD\'s forecast on the Weather picker\'s provider, then the fills for DWD', () => {
  const [{ p, outcome, requests, forecast }] = fetchesOf('openweathermap', [{ options: BY_LOCATION, country: 'DE' }]);
  assert.equal(outcome, 'ok');
  assert.deepEqual(requests.map(endpoint), DWD_HOSTS.concat(['https://api.open-meteo.com/v1/forecast']),
    'DWD\'s two, then its UV fill: OpenWeatherMap is not asked');
  assert.equal(p.id, 'openweathermap', 'the anchor stays the Weather picker\'s');
  assert.equal(p.feeds.temperature, 'dwd');
  assert.equal(p.feeds.uv, 'openmeteo');
  assert.equal(forecast, fetchesOf('dwd', [{}])[0].forecast, 'DWD\'s forecast, field for field');
});

test('By location: a provider that fails hands over to the next; its failure is recovered', () => {
  const [{ p, outcome, requests }] = fetchesOf('openweathermap', [{ options: BY_LOCATION, country: 'DE' }],
    { answers: (url) => url.indexOf('api.brightsky.dev') === -1 });
  assert.equal(outcome, 'ok');
  assert.equal(p.feeds.temperature, 'openweathermap');
  assert.deepEqual(p.recoveredFailure, { stage: 'provider_data', code: 'dwd_forecast_status_503' }, 'DWD\'s, the first');
  assert.ok(requests.some((r) => r.indexOf('api.openweathermap.org') !== -1));
  const [last] = fetchesOf('openweathermap', [{ options: BY_LOCATION, country: 'DE' }],
    { answers: (url) => url.indexOf('api.brightsky.dev') === -1 && url.indexOf('api.openweathermap.org') === -1 });
  assert.equal(last.p.feeds.temperature, 'openmeteo', 'Open-Meteo last');
});

test('By location: when every provider fails, the last one\'s failure fails the fetch', () => {
  const [{ outcome, failure, requests }] = fetchesOf('openweathermap', [{ options: BY_LOCATION, country: 'DE' }],
    { answers: () => false });
  assert.equal(outcome, 'failed');
  assert.equal(failure.code, 'openmeteo_status_503');
  assert.deepEqual(requests.map((r) => new URL(r.split(' ')[1]).host),
    ['api.brightsky.dev', 'api.openweathermap.org', 'api.open-meteo.com'], 'each once, in order');
});

test('By location skips a keyed Weather picker without its key, and asks the Weather picker without a country', () => {
  const [noKey] = fetchesOf('openweathermap', [{ options: BY_LOCATION, country: 'DE', keys: { owmApiKey: '' } }],
    { answers: (url) => url.indexOf('api.brightsky.dev') === -1 });
  assert.equal(noKey.p.feeds.temperature, 'openmeteo');
  assert.ok(noKey.requests.every((r) => r.indexOf('api.openweathermap.org') === -1));
  const [noCountry] = fetchesOf('openweathermap', [{ options: BY_LOCATION }]);
  assert.equal(noCountry.p.feeds.temperature, 'openweathermap');
  const [one] = fetchesOf('openweathermap', [{ country: 'DE' }]);
  assert.equal(one.p.feeds.temperature, 'openweathermap', 'One provider stays with the Weather picker');
});

test('By location: the regional provider\'s snapshot serves the next fetch in the slot', () => {
  const both = { options: BY_LOCATION, country: 'DE' };
  const [first, second] = fetchesOf('openweathermap', [both, Object.assign({ at: 5 * MIN }, both)]);
  assert.deepEqual(second.requests, []);
  assert.equal(second.forecast, first.forecast);
  assert.equal(second.p.feeds.temperature, 'dwd');
});

test('another provider\'s answer replaces every field of the anchor: one it lacks is gone, never left from before', () => {
  const WeatherProvider = require('../../../src/pkjs/weather/adapter/provider.js');
  const fetchOptions = require('../../../src/pkjs/weather/domain/fetch-options.js');
  const { testPorts } = require('../../helpers/source-ports.js');
  const hours = (v) => new Array(24).fill(v);
  /**
   * A provider whose answer is a day of hours, with or without the temperature now.
   * @param {string} id Its id.
   * @param {boolean} withNow Whether its answer holds currentTemp.
   * @returns {Object}
   */
  const answering = (id, withNow) => Object.assign(new WeatherProvider(), { id: id,
    withProviderData(lat, lon, force, ok) {
      Object.assign(this, { tempTrend: hours(60), precipTrend: hours(0), startTime: 3600 });
      if (withNow) { this.currentTemp = 61; } else { delete this.currentTemp; }
      ok();
    } });
  // The anchor holds the last fetch's forecast, the temperature now among it, and fails now.
  const anchor = Object.assign(new WeatherProvider(), { id: 'openweathermap', countryCode: 'DE', currentTemp: 99,
    tempTrend: hours(1), precipTrend: hours(1), startTime: 1,
    withProviderData(lat, lon, force, ok, fail) { fail({ stage: 'provider_data', code: 'owm_status_503' }); } });
  anchor.options = fetchOptions.defaults({ sources: { mode: 'auto', choices: {}, keyed: ['openweathermap'] } });
  const ports = Object.assign(testPorts(), {
    providerFor: (id) => Object.assign(answering(id, id !== 'dwd'), { options: anchor.options }) });
  let outcome = null;
  require('../../../src/pkjs/weather/application/fetch-sources.js').fetchSources(anchor, ports, 52.52, 13.405, false,
    () => { outcome = 'ok'; }, (f) => { outcome = f; });
  assert.equal(outcome, 'ok');
  assert.equal(anchor.feeds.temperature, 'openmeteo', 'DWD\'s answer without the temperature now is none');
  assert.equal(anchor.currentTemp, 61, 'Open-Meteo\'s, not the last fetch\'s');
});

// --- Per reading ----------------------------------------------------------------------------

const sourcePlan = require('../../../src/pkjs/weather/domain/source-plan.js');
const METNO_HOST = 'https://api.met.no/weatherapi/locationforecast/2.0/complete';
const OWM_HOST = 'https://api.openweathermap.org/data/3.0/onecall';
/**
 * A fetch's options in Per reading.
 * @param {Object<string, string>} picks Reading id → provider id.
 * @param {Object} [more] More options.
 * @returns {Object}
 */
const perReading = (picks, more) => Object.assign({ sources: { mode: 'reading', choices: picks } }, more);

test('Per reading: the forecast from the temperature\'s provider, another reading\'s provider laid on', () => {
  const [{ p, outcome, requests }] = fetchesOf('metno', [{ options: perReading({ wind: 'dwd' }) }]);
  assert.equal(outcome, 'ok');
  assert.deepEqual(requests.map(endpoint), [METNO_HOST].concat(DWD_HOSTS), 'Met.no, then DWD for the wind');
  const dwd = fetchesOf('dwd', [{}])[0].p;
  const metno = fetchesOf('metno', [{}])[0].p;
  assert.deepEqual(p.windTrend, dwd.windTrend, 'the wind and its gusts are DWD\'s');
  assert.deepEqual(p.gustTrend, dwd.gustTrend);
  assert.deepEqual(p.tempTrend, metno.tempTrend, 'the rest is Met.no\'s');
  assert.deepEqual(p.cloudTrend, metno.cloudTrend);
  assert.deepEqual(p.feeds, Object.assign(sourcePlan.allFrom('metno'), { wind: 'dwd' }));
});

test('Per reading: the Weather picker\'s own readings are asked on an instance of their own, beside the temperature\'s', () => {
  const WeatherProvider = require('../../../src/pkjs/weather/adapter/provider.js');
  const fetchOptions = require('../../../src/pkjs/weather/domain/fetch-options.js');
  const { testPorts } = require('../../helpers/source-ports.js');
  const hours = (v) => new Array(24).fill(v);
  /**
   * A provider whose answer is a day of hours of its own values.
   * @param {string} id Its id.
   * @param {number} temp Its temperature.
   * @param {number} wind Its wind.
   * @returns {Object}
   */
  const answering = (id, temp, wind) => Object.assign(new WeatherProvider(), { id: id,
    withProviderData(lat, lon, force, ok) {
      Object.assign(this, { tempTrend: hours(temp), precipTrend: hours(0), windTrend: hours(wind), startTime: 3600,
        currentTemp: temp });
      ok();
    } });
  const anchor = answering('metno', 50, 5);
  anchor.options = fetchOptions.defaults({ drawn: [], sources: { mode: 'reading', choices: { temperature: 'dwd' },
    keyed: [] } });
  const ports = Object.assign(testPorts(), {
    providerFor: (id) => Object.assign(id === 'dwd' ? answering('dwd', 70, 7) : answering(id, 50, 5),
      { options: anchor.options }) });
  let outcome = null;
  require('../../../src/pkjs/weather/application/fetch-sources.js').fetchSources(anchor, ports, 52.52, 13.405, false,
    () => { outcome = 'ok'; }, (f) => { outcome = f; });
  assert.equal(outcome, 'ok');
  assert.deepEqual(anchor.tempTrend, hours(70), 'the temperature stays DWD\'s');
  assert.deepEqual(anchor.windTrend, hours(5), 'the wind is the Weather picker\'s');
  assert.deepEqual([anchor.feeds.temperature, anchor.feeds.wind], ['dwd', 'metno']);
});

test('Per reading: a reading\'s provider that fails hands it to the Weather picker\'s provider', () => {
  const [{ p, outcome, requests }] = fetchesOf('openweathermap', [{ options: perReading({ temperature: 'metno', wind: 'dwd' }) }],
    { answers: (url) => url.indexOf('api.brightsky.dev') === -1 });
  assert.equal(outcome, 'ok');
  assert.equal(p.feeds.temperature, 'metno');
  assert.equal(p.feeds.wind, 'openweathermap', 'the Weather picker\'s, asked once for every reading it brings');
  assert.equal(requests.filter((r) => r.indexOf(OWM_HOST) !== -1).length, 1);
  assert.deepEqual(p.recoveredFailure, { stage: 'provider_data', code: 'dwd_forecast_status_503' });
  const owm = fetchesOf('openweathermap', [{}])[0].p;
  assert.deepEqual(p.windTrend, owm.windTrend);
});

test('Per reading: when the temperature\'s provider fails, the Weather picker\'s brings everything', () => {
  const [{ p, outcome, requests }] = fetchesOf('metno', [{ options: perReading({ temperature: 'dwd', wind: 'dwd' }) }],
    { answers: (url) => url.indexOf('api.brightsky.dev') === -1 });
  assert.equal(outcome, 'ok');
  assert.deepEqual(p.feeds, sourcePlan.allFrom('metno'));
  assert.equal(requests.filter((r) => r.indexOf('api.brightsky.dev') !== -1).length, 1, 'DWD is asked once');
});

test('Per reading: a reading the Weather picker\'s provider lacks is filled; one a part brings is not', () => {
  const [{ p, requests }] = fetchesOf('yandex', [{ options: perReading({ wind: 'dwd', cloud: 'dwd' },
    { drawn: ['cloud', 'dew'] }) }]);
  assert.deepEqual(requests.map(endpoint), ['https://api.weather.yandex.ru/graphql/query'].concat(DWD_HOSTS,
    ['https://api.open-meteo.com/v1/forecast']));
  assert.deepEqual(hourlyOf(requests[3]), ['dew_point_2m'], 'Yandex\'s dew point; DWD brought the cloud cover');
  assert.deepEqual([p.feeds.cloud, p.feeds.dew, p.feeds.wind], ['dwd', 'openmeteo', 'dwd']);
  assert.equal(p.cloudTrend.length, 24);
});

test('Per reading: a second fetch in the slot takes every provider\'s forecast from its snapshot', () => {
  const each = { options: perReading({ temperature: 'dwd', uv: 'openmeteo' }) };
  const [first, second] = fetchesOf('metno', [each, Object.assign({ at: 5 * MIN }, each)]);
  assert.ok(first.requests.length >= 3);
  assert.deepEqual(second.requests, []);
  assert.equal(second.forecast, first.forecast);
  assert.deepEqual(second.p.feeds, first.p.feeds);
});

test('Per reading: a second fetch in the slot asks nobody, though the first asked every provider', () => {
  const each = { options: perReading({ temperature: 'dwd', rain: 'metno', wind: 'openweathermap', cloud: 'tomorrowio',
    pressure: 'wunderground', condition: 'yandex', dew: 'openmeteo' }, { drawn: ['cloud', 'pressure', 'dew'] }) };
  const [first, second] = fetchesOf('dwd', [each, Object.assign({ at: 5 * MIN }, each)]);
  assert.deepEqual(Object.keys(first.p.answers.reduce((ids, a) => Object.assign(ids, { [a.id]: true }), {})).sort(),
    Object.keys(providerReadings.PROVIDERS).sort(), 'the first fetch asked all seven');
  assert.deepEqual(second.requests, [], 'every snapshot kept');
  assert.equal(second.forecast, first.forecast);
});

test('Per reading: a provider that failed this fetch is not asked again as a fallback', () => {
  const [{ p, outcome, requests }] = fetchesOf('openweathermap', [{ options: perReading({ temperature: 'metno', wind: 'dwd' }) }],
    { answers: (url) => url.indexOf('api.brightsky.dev') === -1 && url.indexOf('api.openweathermap.org') === -1 });
  assert.equal(outcome, 'ok', 'Met.no\'s forecast stands');
  assert.equal(requests.filter((r) => r.indexOf(OWM_HOST) !== -1).length, 1, 'OpenWeatherMap once, for its own part');
  assert.deepEqual(p.feeds, sourcePlan.allFrom('metno'), 'every reading stays Met.no\'s');
});

// ---- The calls a day: the source plan's count (source-plan.js callsPerDay, the settings page's
// calls line) against a day of updates through the engine itself.

const HOSTS = { 'api.brightsky.dev': 'dwd', 'api.open-meteo.com': 'openmeteo', 'api.met.no': 'metno',
  'api.openweathermap.org': 'openweathermap', 'api.tomorrow.io': 'tomorrowio', 'api.weather.com': 'wunderground',
  'www.wunderground.com': 'wunderground', 'api.weather.yandex.ru': 'yandex' };

/**
 * A day of updates every `intervalMin` minutes on one instance, counted by provider.
 * @param {string} id The Weather picker's provider.
 * @param {Object} options Fetch options over the day's.
 * @param {number} intervalMin The update interval.
 * @param {string} [country] The country the place's reverse geocode names.
 * @returns {Object<string, number>} provider id → requests
 */
function dayOf(id, options, intervalMin, country) {
  const fetches = [];
  for (let at = 0; at < 24 * HOUR * 1000; at += intervalMin * MIN) {
    fetches.push({ at: at, options: options, country: country });
  }
  const out = {};
  fetchesOf(id, fetches, { reuse: true, refreshMs: intervalMin * MIN }).forEach((run) => {
    assert.equal(run.outcome, 'ok');
    run.requests.forEach((request) => {
      const provider = HOSTS[new URL(request.split(' ')[1]).host];
      out[provider] = (out[provider] || 0) + 1;
    });
  });
  return out;
}

/**
 * The plan's count for the same day.
 * @param {string} id The Weather picker's provider.
 * @param {Object} options The fetch options dayOf() was given.
 * @param {number} intervalMin The update interval.
 * @param {string} [country] The country.
 * @returns {Object<string, number>}
 */
function plannedDay(id, options, intervalMin, country) {
  const o = Object.assign({ drawn: ['uv'] }, options);
  const input = Object.assign({ provider: id, country: country || null }, sourcePlan.sourcesOf(world.KEYS), o.sources);
  return sourcePlan.callsPerDay(input, o.drawn, intervalMin, 0);
}

test('a day of updates asks each provider what the source plan counts', () => {
  [
    ['dwd', { drawn: ['uv'] }, 15],
    ['dwd', { drawn: ['uv'] }, 60],
    ['openmeteo', { drawn: ['uv'] }, 15],
    ['openmeteo', { drawn: [] }, 30],
    ['yandex', { drawn: ['uv', 'cloud', 'dew'] }, 15],
    ['metno', { sources: { mode: 'auto' }, drawn: ['uv'] }, 15, 'DEU'],
    ['tomorrowio', perReading({ temperature: 'dwd', rain: 'openmeteo', wind: 'yandex' }, { drawn: ['uv'] }), 15],
    ['wunderground', perReading({ uv: 'openmeteo', cloud: 'metno' }, { drawn: ['cloud'] }), 10],
    ['metno', perReading({ pressure: 'dwd' }), 15],
    // DWD sends no UV: no part asks it for the UV that follows it, Open-Meteo's fill brings it.
    ['dwd', perReading({ temperature: 'metno', rain: 'metno', wind: 'metno', condition: 'metno' }), 15],
    // Yandex's cloud cover comes from the Open-Meteo forecast the rain part already holds.
    ['yandex', perReading({ rain: 'openmeteo' }, { drawn: ['uv', 'cloud'] }), 15]
  ].forEach(([id, options, intervalMin, country]) => {
    assert.deepEqual(dayOf(id, options, intervalMin, country), plannedDay(id, options, intervalMin, country),
      id + ' ' + JSON.stringify(options) + ' every ' + intervalMin + ' min');
  });
});

// ---- What the fetch tells the fetch cycle: each provider asked, and what it recovered from.

test('the anchor names each provider asked for its forecast, its key and its failure, once each', () => {
  const [one] = fetchesOf('openweathermap', [{}]);
  assert.deepEqual(one.p.answers.map((a) => [a.id, a.apiKey, a.failure]), [['openweathermap', 'owm-test-key', null]]);
  const [byLocation] = fetchesOf('openweathermap', [{ options: BY_LOCATION, country: 'DE' }],
    { answers: (url) => url.indexOf('api.brightsky.dev') === -1 });
  assert.deepEqual(byLocation.p.answers.map((a) => [a.id, Boolean(a.failure)]), [['dwd', true], ['openweathermap', false]]);
  assert.equal(byLocation.p.answers[0].name, 'Brightsky (Deutscher Wetterdienst)', 'its own name, for the notice');
  const [parts] = fetchesOf('metno', [{ options: perReading({ wind: 'tomorrowio', rain: 'tomorrowio', cloud: 'dwd' },
    { drawn: ['cloud'] }) }]);
  assert.deepEqual(parts.p.answers.map((a) => [a.id, a.apiKey]), [['metno', undefined], ['tomorrowio', 'tio-test-key'],
    ['dwd', undefined]], 'the forecast\'s provider, then each part\'s, each once');
});

/**
 * A fetch on fake providers whose answers are a day of hours each (By location's helper's
 * shape): Per reading, the temperature from DWD, the wind from Yandex.
 * @param {Object} yandex What Yandex's answer adds to its day.
 * @returns {Object} The anchor (Met.no) after the fetch.
 */
function yandexPartFetch(yandex) {
  const WeatherProvider = require('../../../src/pkjs/weather/adapter/provider.js');
  const fetchOptions = require('../../../src/pkjs/weather/domain/fetch-options.js');
  const { testPorts } = require('../../helpers/source-ports.js');
  const hours = (v) => new Array(24).fill(v);
  const answering = (id, more) => Object.assign(new WeatherProvider(), { id: id,
    withProviderData(lat, lon, force, ok) {
      Object.assign(this, { tempTrend: hours(60), precipTrend: hours(0), windTrend: hours(9), startTime: 3600,
        currentTemp: 60 }, more);
      ok();
    } });
  const anchor = answering('metno', {});
  anchor.options = fetchOptions.defaults({ drawn: [], sources: { mode: 'reading',
    choices: { temperature: 'dwd', wind: 'yandex' }, keyed: ['yandex'] } });
  const ports = Object.assign(testPorts(), {
    providerFor: (id) => Object.assign(answering(id, id === 'yandex' ? yandex : {}), { options: anchor.options }) });
  require('../../../src/pkjs/weather/application/fetch-sources.js').fetchSources(anchor, ports, 52.52, 13.405, false,
    () => {}, (f) => { throw new Error('the fetch failed: ' + JSON.stringify(f)); });
  return anchor;
}

test('a part whose hours do not line up falls back, and is the recovered failure', () => {
  const anchor = yandexPartFetch({ startTime: 3600 + 1800 });
  assert.equal(anchor.feeds.wind, 'metno', 'the wind falls back to the Weather picker\'s');
  assert.deepEqual(anchor.recoveredFailure, { stage: 'provider_data', code: 'yandex_hours_misaligned' });
});

test('a part\'s own recovered failure is the fetch\'s, as the forecast provider\'s is', () => {
  const refused = { stage: 'provider_data', code: 'yandex_condition_rejected' };
  const anchor = yandexPartFetch({ recoveredFailure: refused });
  assert.equal(anchor.feeds.wind, 'yandex');
  assert.deepEqual(anchor.recoveredFailure, refused);
});
