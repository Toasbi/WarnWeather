// test/weather/domain/forecast-snapshot.test.js — when a provider's last answer serves a
// fetch: the same provider and request, a place close enough, while its kind serves it (a
// forecast: the rest of its refresh slot within the hour it was kept in, as it was kept; a UV
// fill: UV_REUSE_MS, re-anchored to the forecast it fills unless that leaves it short); and
// what is kept.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const snap = require('../../../src/pkjs/weather/domain/forecast-snapshot.js');
const fetchOptions = require('../../../src/pkjs/weather/domain/fetch-options.js');
const forecastModel = require('../../../src/pkjs/weather/domain/forecast-model.js');
const { fingerprint } = require('../../../src/pkjs/weather/domain/keys/key-fingerprint.js');

const HOUR = 3600;
const MIN_MS = 60 * 1000;
const QUARTER = 15 * MIN_MS;
const T0 = Date.UTC(2026, 5, 20, 8, 0, 0);   // on a slot and an hour boundary
const START = T0 / 1000;
const PLACE = { lat: 52.5214, lon: 13.4049 };

/**
 * @param {number} n Hours.
 * @param {number} from The first hour's value; each hour after adds 1.
 * @returns {number[]}
 */
function series(n, from) { return Array.from({ length: n }, (_, i) => from + i); }

/**
 * A provider as a fetch leaves it: options, a key, and 24 hours from START.
 * @param {Object} [over] {id, apiKey, options: fetch-options overrides}.
 * @returns {Object} The provider.
 */
function provider(over) {
  const o = over || {};
  const p = { id: o.id || 'openweathermap', apiKey: o.apiKey === undefined ? 'secret-key' : o.apiKey,
    options: fetchOptions.defaults(Object.assign({ fetchUv: true, dayPeakCodes: [] }, o.options)) };
  forecastModel.ADOPTED_KEYS.forEach((key) => { p[key] = null; });
  Object.assign(p, { startTime: START, currentTemp: 61, currentCondition: 'partly',
    tempTrend: series(24, 50), precipTrend: series(24, 0.1), rainTrend: series(24, 0), windTrend: series(49, 10),
    gustTrend: series(49, 20), pressureTrend: [], cloudTrend: series(24, 40), dewTrend: [], windDirTrend: [],
    feelsTrend: [], uvTrend: series(49, 1) });
  return p;
}

// The readings a readings fill asks for in these tests.
const GAPS = ['dew', 'cloud'];

/**
 * The plan step of a kind, for `p`: its own forecast, or Open-Meteo's fill.
 * @param {Object} p provider().
 * @param {string} kind 'forecast', 'uv' or 'readings'.
 * @returns {Object}
 */
function stepFor(p, kind) {
  if (kind === 'forecast') { return { provider: p.id, ask: 'forecast' }; }
  return kind === 'uv' ? { provider: 'openmeteo', ask: 'uv' } : { provider: 'openmeteo', ask: 'readings', readings: GAPS };
}

/**
 * The query of a fetch of `p` at a place.
 * @param {Object} p provider().
 * @param {string} [kind] 'forecast' (default), 'uv' or 'readings'.
 * @param {Object} [place] {lat, lon}; PLACE by default.
 * @returns {?Object}
 */
function queryFor(p, kind, place) {
  const at = place || PLACE;
  return snap.queryOf(stepFor(p, kind || 'forecast'), p, at.lat, at.lon);
}

/**
 * The snapshot of `p`, kept at `at`.
 * @returns {Object}
 */
function kept(p, at, kind) { return snap.snapshotOf(queryFor(p, kind), p, at); }

/**
 * The fields a fetch of `p` at `now` takes from `entries`, or null.
 * @returns {?Object}
 */
function reused(entries, p, now, opts) {
  const o = opts || {};
  return snap.reuse(entries, queryFor(p, o.kind, o.place), now, o.refreshMs === undefined ? QUARTER : o.refreshMs,
    o.anchor || p);
}

test('a query keeps the place to three decimals, and what the answer depends on, the key only as a fingerprint', () => {
  const q = snap.queryOf({ provider: 'openweathermap', ask: 'forecast' }, provider(), '52.52491', 13.40512);
  assert.deepEqual(q.place, { lat: 52.525, lon: 13.405 });
  assert.deepEqual(q.request, { hours: 24, peaks: [], uv: true, feels: true, formula: 'provider',
    key: fingerprint('secret-key') });
  assert.equal(JSON.stringify(q).indexOf('secret-key'), -1, 'the key itself is never kept');
  assert.deepEqual(snap.queryOf({ provider: 'openmeteo', ask: 'uv' },
    provider({ options: { dayPeakCodes: ['uv', 'wind', 'aqi'] } }), 1, 2).request,
    { hours: 24, peaks: ['uv'] }, 'a UV fill depends on its hours and the UV day max alone');
  assert.deepEqual(snap.queryOf({ provider: 'dwd', ask: 'forecast' },
    provider({ options: { dayPeakCodes: ['gust', 'aqi', 'uv'] } }), 1, 2).request.peaks,
    ['uv', 'gust'], 'the day maxima of the series a forecast keeps, air quality not among them');
  assert.deepEqual(snap.queryOf({ provider: 'openmeteo', ask: 'readings', readings: ['dew', 'pressure'] },
    provider({ options: { forecastHours: 68, dayPeakCodes: ['uv'] } }), 1, 2).request,
    { hours: 68, readings: ['dew', 'pressure'] }, 'a readings fill depends on its hours and its readings alone');
  ['', null, true, 'north'].forEach((lat) => {
    assert.equal(snap.queryOf({ provider: 'dwd', ask: 'forecast' }, provider(), lat, 13.4), null,
      'no place: ' + JSON.stringify(lat));
  });
});

test('every fetch option either changes the request or is one no answer depends on', () => {
  const base = provider();
  const changed = { fetchUv: false, fetchAqi: true, fetchPollen: true, fetchFeels: false, feelsFormula: 'steadman',
    dayPeakCodes: ['wind'], windUnits: 'mph', aqiScale: 'us', aqiSource: 'openmeteo', aqicnToken: 'x', forecastHours: 68,
    drawn: ['cloud'], sources: { mode: 'auto', choices: { wind: 'dwd' }, keyed: ['yandex'] } };
  assert.deepEqual(Object.keys(changed).sort(), Object.keys(fetchOptions.defaults()).sort(),
    'every option has a changed value here');
  Object.keys(changed).forEach((key) => {
    const over = {};
    over[key] = changed[key];
    const same = JSON.stringify(queryFor(base).request) === JSON.stringify(queryFor(provider({ options: over })).request);
    assert.equal(same, snap.ANSWER_NEUTRAL.indexOf(key) !== -1, key);
  });
});

test('a forecast serves the rest of its refresh slot, within the hour it was kept in', () => {
  const p = provider();
  const entries = [kept(p, T0 + 2 * MIN_MS)];
  assert.ok(reused(entries, p, T0 + 2 * MIN_MS), 'at once');
  assert.ok(reused(entries, p, T0 + QUARTER - 1), 'until the slot ends');
  assert.equal(reused(entries, p, T0 + QUARTER), null, 'the next slot asks again');
  assert.equal(reused(entries, p, T0 + MIN_MS), null, 'a clock that went back asks again');
  assert.ok(reused(entries, p, T0 + 20 * MIN_MS, { refreshMs: 30 * MIN_MS }), 'the slot of the interval now');
  const twoHours = { refreshMs: 2 * HOUR * 1000 };
  assert.ok(reused(entries, p, T0 + HOUR * 1000 - 1, twoHours), 'a longer slot: the rest of the hour');
  assert.equal(reused(entries, p, T0 + HOUR * 1000, twoHours), null,
    'the next hour asks again: a new answer would start an hour on');
  [NaN, 0, -1].forEach((ms) => {
    assert.equal(reused(entries, p, T0 + 3 * MIN_MS, { refreshMs: ms }), null, 'no interval, no reuse: ' + ms);
  });
});

test('another provider, kind, key, span, day max, series or formula asks again; a place nearby does not', () => {
  const p = provider();
  const entries = [kept(p, T0)];
  const now = T0 + MIN_MS;
  assert.equal(reused(entries, provider({ id: 'tomorrowio' }), now), null, 'provider');
  assert.equal(reused(entries, p, now, { kind: 'uv' }), null, 'kind');
  assert.ok(reused(entries, p, now, { place: { lat: 52.5303, lon: 13.4049 } }), 'a GPS fix 1 km off');
  assert.equal(reused(entries, p, now, { place: { lat: 52.5394, lon: 13.4049 } }), null, '2 km off is another place');
  assert.equal(reused(entries, provider({ apiKey: 'new-key' }), now), null, 'a new key is tried at once');
  assert.equal(reused(entries, provider({ options: { forecastHours: 68 } }), now), null, 'the span');
  assert.equal(reused(entries, provider({ options: { dayPeakCodes: ['gust'] } }), now), null, 'a day max');
  assert.equal(reused(entries, provider({ options: { fetchUv: false } }), now), null, 'UV');
  assert.equal(reused(entries, provider({ options: { fetchFeels: false } }), now), null, 'the feels-like');
  assert.equal(reused(entries, provider({ options: { feelsFormula: 'steadman' } }), now), null, 'the formula');
});

test('a UV fill serves UV_REUSE_MS, whatever the slot, aligned to the forecast it fills', () => {
  assert.equal(snap.UV_REUSE_MS, 3 * HOUR * 1000, 'three hours: UV forecasts change slowly');
  const p = provider({ id: 'dwd', apiKey: '' });
  const entries = [kept(p, T0, 'uv')];
  assert.ok(reused(entries, p, T0 + snap.UV_REUSE_MS, { kind: 'uv' }), 'until it ends');
  assert.equal(reused(entries, p, T0 + snap.UV_REUSE_MS + 1, { kind: 'uv' }), null, 'then it asks again');
  const later = reused(entries, p, T0 + 2 * HOUR * 1000, { kind: 'uv', refreshMs: NaN,
    anchor: Object.assign({}, p, { startTime: START + 2 * HOUR }) });
  assert.equal(later.uvTrend.length, 47);
  assert.equal(later.uvTrend[0], p.uvTrend[2], 'entry 0 is the hour the new forecast starts at');
});

test('a forecast is reused as it was kept; a UV fill drops the hours past, unless that leaves it short', () => {
  const p = provider();
  const e = kept(p, T0);
  assert.deepEqual(reused([e], p, T0 + 5 * MIN_MS), e.fields, 'as kept');
  const startingAt = (startTime, at) => kept(Object.assign(provider(), { startTime: startTime }), at);
  assert.deepEqual(reused([startingAt(START + HOUR, T0 + 5 * MIN_MS)], p, T0 + 10 * MIN_MS).startTime, START + HOUR,
    'a feed with no bucket for the hour now starts at the next one, and so would a new answer');
  assert.deepEqual(reused([startingAt(START + 1800, T0 + 40 * MIN_MS)], p, T0 + 50 * MIN_MS,
    { refreshMs: HOUR * 1000 }).startTime, START + 1800, 'buckets on the half hour (India, +5:30)');
  const uvOf = provider({ id: 'dwd', apiKey: '' });
  const shifted = reused([kept(uvOf, T0, 'uv')], uvOf, T0 + 70 * MIN_MS,
    { kind: 'uv', anchor: { startTime: START + HOUR } });
  assert.equal(shifted.uvTrend[0], uvOf.uvTrend[1], 'a fill takes the hour its new forecast starts at');
  assert.equal(shifted.uvTrend.length, 48);
  const long = kept(provider({ id: 'dwd', apiKey: '', options: { forecastHours: 68 } }), T0, 'uv');
  long.fields.uvTrend = series(68, 0);
  assert.equal(reused([long], provider({ id: 'dwd', apiKey: '', options: { forecastHours: 68 } }), T0 + HOUR * 1000,
    { kind: 'uv', anchor: { startTime: START + HOUR } }), null, 'the long span would lose its last hour');
  assert.equal(reused([long], provider({ id: 'dwd', apiKey: '', options: { forecastHours: 68 } }), T0 + HOUR * 1000,
    { kind: 'uv', anchor: { startTime: START + 1800 } }), null, 'off the hour grid');
});

test('a readings fill keeps its readings, serves as a forecast does and only for the same readings', () => {
  const p = Object.assign(provider({ id: 'yandex', apiKey: '' }), { dewTrend: series(24, 30) });
  const e = kept(p, T0 + 2 * MIN_MS, 'readings');
  assert.deepEqual(Object.keys(e.fields), ['dewTrend', 'cloudTrend'], 'the series of its readings alone');
  assert.ok(reused([e], p, T0 + QUARTER - 1, { kind: 'readings' }), 'the rest of the slot');
  assert.equal(reused([e], p, T0 + QUARTER, { kind: 'readings' }), null, 'the next slot asks again');
  assert.equal(reused([e], p, T0 + HOUR * 1000, { kind: 'readings', refreshMs: 2 * HOUR * 1000 }), null,
    'the next hour asks again');
  const dewOnly = snap.queryOf({ provider: 'openmeteo', ask: 'readings', readings: ['dew'] }, p, PLACE.lat, PLACE.lon);
  assert.equal(snap.reuse([e], dewOnly, T0 + 3 * MIN_MS, QUARTER, p), null, 'other readings are another request');
  assert.equal(reused([e], p, T0 + 3 * MIN_MS, { kind: 'readings', anchor: Object.assign({}, p, { startTime: START + HOUR }) }),
    null, 'a forecast an hour on would leave its 24 hours short');
});

test('a new snapshot replaces its provider\'s and kind\'s; only those that can still serve stay, six at most', () => {
  const ids = ['dwd', 'openmeteo', 'metno', 'openweathermap', 'tomorrowio', 'wunderground', 'yandex'];
  const hour = 60 * MIN_MS;
  let entries = [];
  ids.forEach((id, i) => {
    entries = snap.remember(entries, kept(provider({ id: id }), T0 + i * MIN_MS), T0 + i * MIN_MS, hour);
  });
  assert.deepEqual(entries.map((e) => e.provider), ids.slice(1).reverse(), 'the newest six, newest first');
  assert.equal(entries.length, snap.MAX_ENTRIES);
  entries = snap.remember(entries, kept(provider({ id: 'metno' }), T0 + 10 * MIN_MS), T0 + 10 * MIN_MS, hour);
  assert.equal(entries.filter((e) => e.provider === 'metno').length, 1, 'one per provider and kind');
  const uv = snap.remember(entries, kept(provider({ id: 'dwd' }), T0 + 11 * MIN_MS, 'uv'), T0 + 11 * MIN_MS, hour);
  const next = T0 + hour + 5 * MIN_MS;
  assert.deepEqual(snap.remember(uv, kept(provider({ id: 'yandex' }), next), next, hour).map((e) => e.kind + ' ' + e.provider),
    ['forecast yandex', 'uv openmeteo'], 'in the next slot the forecasts can no longer serve; the UV fill still can');
});

test('a stored value of another version, or a snapshot that cannot be read, serves nothing', () => {
  const e = kept(provider(), T0);
  const NONE = { entries: [], drops: 0 };
  assert.deepEqual(snap.fromStored(snap.toStored({ entries: [e], drops: 2 })), { entries: [e], drops: 2 });
  assert.deepEqual(snap.fromStored(JSON.parse(JSON.stringify(snap.toStored({ entries: [e], drops: 2 })))),
    { entries: [e], drops: 2 }, 'through JSON');
  assert.deepEqual(snap.fromStored({ v: 2, entries: [e], drops: 2 }), NONE, 'another version');
  [null, 'x', {}, { v: 1 }, { v: 1, entries: 'x' }].forEach((v) => { assert.deepEqual(snap.fromStored(v), NONE); });
  assert.deepEqual(snap.fromStored({ v: 1, entries: [e] }), { entries: [e], drops: 0 }, 'never dropped');
  ['2', NaN, null].forEach((drops) => {
    assert.equal(snap.fromStored({ v: 1, entries: [], drops: drops }).drops, 0, 'a count that is no number');
  });
  const fill = kept(provider(), T0, 'readings');
  const broken = [
    Object.assign({}, fill, { request: { hours: 24, readings: 'dew' } }),
    Object.assign({}, fill, { request: { hours: 24, readings: ['dew', 'sunshine'] } }),
    Object.assign({}, fill, { fields: { dewTrend: [] } }),
    Object.assign({}, e, { kind: 'constructor' }),
    Object.assign({}, e, { at: 'soon' }),
    Object.assign({}, e, { place: { lat: '52.52', lon: 13.4 } }),
    Object.assign({}, e, { fields: Object.assign({}, e.fields) })
  ];
  delete broken[6].fields.tempTrend;
  assert.deepEqual(snap.fromStored(snap.toStored({ entries: broken.concat([e, fill]), drops: 0 })).entries, [e, fill]);
});
