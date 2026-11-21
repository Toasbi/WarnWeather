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
 * of a 15-minute update interval.
 * @param {string} id A provider id.
 * @param {Array<{at: (number|undefined), options: (Object|undefined), keys: (Object|undefined),
 *   lat: (number|undefined), before: (function(Object): void|undefined)}>} fetches When (ms
 *   after the world's now) and with what; before(p) runs on the instance first.
 * @param {{reuse: boolean, answers: function(string): boolean}} [opts] One instance for every
 *   fetch (a scheduled refresh); which requests the services answer.
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
      if (!p || !o.reuse) {
        p = mod('weather/adapter/provider-factory.js').createProvider(id, Object.assign({}, world.KEYS, f.keys));
      }
      p.options = mod('weather/domain/fetch-options.js').defaults(Object.assign({ fetchUv: true, dayPeakCodes: [] }, f.options));
      const ports = mod('weather/adapter/source-ports.js').create(() => Date.now(), QUARTER);
      if (f.before) { f.before(p); }
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
  assert.equal(p.uvFeedId, 'openmeteo', 'the UV day record is Open-Meteo\'s, as when Open-Meteo is the provider');
});

test('DWD with UV not drawn asks nobody else and keeps no UV feed', () => {
  const [{ p, outcome, requests }] = fetchesOf('dwd', [{ options: { fetchUv: false } }]);
  assert.equal(outcome, 'ok');
  assert.equal(requests.length, 2);
  assert.deepEqual(p.uvTrend, []);
  assert.equal(p.uvFeedId, null);
});

test('a failed UV fill leaves the UV empty, names no UV feed, and fails nothing', () => {
  const [{ p, outcome }] = fetchesOf('dwd', [{ before: (provider) => { provider.uvTrend = [9, 9, 9]; } }],
    { answers: (url) => url.indexOf('hourly=uv_index') === -1 });
  assert.equal(outcome, 'ok', 'a fill never fails the fetch');
  assert.deepEqual(p.uvTrend, [], 'the last fetch\'s window does not survive against the new hours');
  assert.equal(p.uvFeedId, null, 'Open-Meteo sent no UV');
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
    assert.equal(p.uvFeedId, null, id);
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
  assert.equal(asked({ options: { fetchUv: false } }), 1, 'UV off');
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
  assert.equal(later.p.uvFeedId, 'openmeteo', 'a reused fill names its feed too');
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
  assert.equal(p.uvFeedId, null);
});

test('a keep reads the store again: what was dropped while the source answered stays dropped', () => {
  // Force weather fetch can drop the store while a fetch waits for its source. The keep after
  // that wait must not write back what the fetch read before it.
  const saved = [];
  const kept = world.inWorld({ platform: 'basalt' }, ({ mod }) => {
    const snapshots = mod('weather/domain/forecast-snapshot.js');
    const p = mod('weather/adapter/provider-factory.js').createProvider('metno', world.KEYS);
    p.options = mod('weather/domain/fetch-options.js').defaults({ dayPeakCodes: [] });
    const stand = mod('weather/adapter/provider-factory.js').createProvider('tomorrowio', world.KEYS);
    stand.options = p.options;
    Object.assign(stand, { startTime: world.HOUR0 });
    const before = snapshots.snapshotOf(snapshots.queryOf('tomorrowio', 'forecast', stand, world.PLACE.lat,
      world.PLACE.lon), stand, world.NOW_MS);
    let loads = 0;
    const ports = { fillUv: (q, lat, lon, done) => done(), now: () => Date.now(), refreshMs: QUARTER,
      snapshots: { load: () => (loads++ === 0 ? [before] : []), save: (entries) => { saved.push(entries); } } };
    mod('weather/application/fetch-sources.js').fetchSources(p, ports, world.PLACE.lat, world.PLACE.lon, false,
      () => {}, (f) => { throw new Error(JSON.stringify(f)); });
    return saved[0].map((e) => e.provider);
  });
  assert.deepEqual(kept, ['metno']);
});
