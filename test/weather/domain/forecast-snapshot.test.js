// test/weather/domain/forecast-snapshot.test.js — when a provider's last answer serves a
// fetch: the same provider, place and request, from the same refresh slot (a UV fill: the
// last 3 hours), re-anchored to the new fetch's first hour unless that leaves it short.
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

/**
 * A provider as a fetch leaves it: options, a key, and 24 hours from START.
 * @param {Object} [over] Fields over the defaults (options: fetch-options overrides).
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

/**
 * @param {number} n Hours.
 * @param {number} from The first hour's value; each hour after adds 1.
 * @returns {number[]}
 */
function series(n, from) { return Array.from({ length: n }, (_, i) => from + i); }

/**
 * A snapshot of a provider, kept at `at`.
 * @param {Object} p provider().
 * @param {number} at Epoch ms.
 * @param {string} [kind] 'forecast' (default) or 'uv'.
 * @returns {Object} The snapshot.
 */
function kept(p, at, kind) {
  const k = kind || 'forecast';
  return snap.snapshotOf(snap.queryOf(k === 'uv' ? 'openmeteo' : p.id, k, p, 52.5214, 13.4049), p, at);
}

/**
 * The snapshot a fetch at `now` finds for provider `p`.
 * @returns {?Object}
 */
function found(entries, p, now, opts) {
  const o = opts || {};
  const k = o.kind || 'forecast';
  return snap.find(entries, snap.queryOf(k === 'uv' ? 'openmeteo' : p.id, k, p, o.lat || 52.5214, o.lon || 13.4049),
    now, o.refreshMs === undefined ? QUARTER : o.refreshMs);
}

test('a query keeps the place to two decimals and what the answer depends on, the key only as a fingerprint', () => {
  const q = snap.queryOf('openweathermap', 'forecast', provider(), '52.5249', 13.4051);
  assert.deepEqual(q.place, { lat: 52.52, lon: 13.41 });
  assert.deepEqual(q.request, { hours: 24, peaks: [], uv: true, feels: true, formula: 'provider',
    key: fingerprint('secret-key') });
  assert.equal(JSON.stringify(q).indexOf('secret-key'), -1, 'the key itself is never kept');
  assert.deepEqual(snap.queryOf('openmeteo', 'uv', provider({ options: { dayPeakCodes: ['uv', 'wind'] } }), 1, 2).request,
    { hours: 24, peaks: ['uv'] }, 'a UV fill depends on its hours and the UV day max alone');
});

test('a forecast serves the rest of its refresh slot, and only that', () => {
  const p = provider();
  const entries = [kept(p, T0 + 2 * MIN_MS)];
  assert.ok(found(entries, p, T0 + 2 * MIN_MS), 'at once');
  assert.ok(found(entries, p, T0 + QUARTER - 1), 'until the slot ends');
  assert.equal(found(entries, p, T0 + QUARTER), null, 'the next slot asks again');
  assert.equal(found(entries, p, T0 + MIN_MS), null, 'a clock that went back asks again');
  assert.ok(found(entries, p, T0 + 20 * MIN_MS, { refreshMs: 30 * MIN_MS }), 'the slot of the interval now');
  [NaN, 0, -1].forEach((ms) => {
    assert.equal(found(entries, p, T0 + 3 * MIN_MS, { refreshMs: ms }), null, 'no interval, no reuse: ' + ms);
  });
});

test('another provider, kind, place, key, span, day max, series or formula asks again', () => {
  const p = provider();
  const entries = [kept(p, T0)];
  const now = T0 + MIN_MS;
  assert.equal(found(entries, provider({ id: 'tomorrowio' }), now), null, 'provider');
  assert.equal(found(entries, p, now, { kind: 'uv' }), null, 'kind');
  assert.equal(found(entries, p, now, { lat: 52.5351 }), null, 'a place 1.5 km on');
  assert.ok(found(entries, p, now, { lat: 52.5181 }), 'a GPS fix 300 m off is the same place');
  assert.equal(found(entries, provider({ apiKey: 'new-key' }), now), null, 'a new key is tried at once');
  assert.equal(found(entries, provider({ options: { forecastHours: 68 } }), now), null, 'the span');
  assert.equal(found(entries, provider({ options: { dayPeakCodes: ['gust'] } }), now), null, 'a day max');
  assert.equal(found(entries, provider({ options: { fetchUv: false } }), now), null, 'UV');
  assert.equal(found(entries, provider({ options: { fetchFeels: false } }), now), null, 'the feels-like');
  assert.equal(found(entries, provider({ options: { feelsFormula: 'steadman' } }), now), null, 'the formula');
  assert.ok(found(entries, provider({ options: { windUnits: 'mph' } }), now), 'the wind unit: the answer is the same');
});

test('a UV fill serves three hours, whatever the slot', () => {
  const p = provider({ id: 'dwd', apiKey: '' });
  const entries = [kept(p, T0, 'uv')];
  assert.ok(found(entries, p, T0 + 3 * HOUR * 1000, { kind: 'uv' }), 'three hours on');
  assert.equal(found(entries, p, T0 + 3 * HOUR * 1000 + 1, { kind: 'uv' }), null, 'then it asks again');
  assert.ok(found(entries, p, T0 + HOUR * 1000, { kind: 'uv', refreshMs: NaN }), 'the interval does not matter');
});

test('re-anchoring drops the hours already past, and gives up when a series would come up short', () => {
  const p = provider();
  const e = kept(p, T0);
  assert.deepEqual(snap.reanchored(e, START), e.fields, 'the same hour: as kept');
  assert.equal(snap.reanchored(e, START + HOUR), null, 'an hour on, the 24-hour series would be 23');
  const uv = kept(provider({ id: 'dwd', apiKey: '' }), T0, 'uv');
  const later = snap.reanchored(uv, START + 2 * HOUR);
  assert.equal(later.uvTrend.length, 47);
  assert.equal(later.uvTrend[0], p.uvTrend[2], 'entry 0 is the hour the new fetch starts at');
  const long = kept(provider({ id: 'dwd', apiKey: '', options: { forecastHours: 68 } }), T0, 'uv');
  long.fields.uvTrend = series(68, 0);
  assert.equal(snap.reanchored(long, START + HOUR), null, 'the long span would lose its last hour');
  assert.equal(snap.reanchored(e, START - HOUR), null, 'an hour before it');
  assert.equal(snap.reanchored(e, START + 1800), null, 'off the hour grid');
  const empty = Object.assign(kept(p, T0), {});
  empty.fields = Object.assign({}, e.fields, { tempTrend: series(30, 50), precipTrend: series(30, 0),
    cloudTrend: series(30, 40), windTrend: series(49, 1), gustTrend: series(49, 1), rainTrend: series(30, 0) });
  const shifted = snap.reanchored(empty, START + HOUR);
  assert.equal(shifted.startTime, START + HOUR);
  assert.equal(shifted.tempTrend[0], 51);
  assert.deepEqual(shifted.dewTrend, [], 'a series the provider does not send stays empty');
  assert.equal(shifted.currentTemp, 61, 'the values of the moment stay as they were');
});

test('a new snapshot replaces its provider\'s and kind\'s; six at most, none older than six hours', () => {
  const ids = ['dwd', 'openmeteo', 'metno', 'openweathermap', 'tomorrowio', 'wunderground', 'yandex'];
  let entries = [];
  ids.forEach((id, i) => { entries = snap.remember(entries, kept(provider({ id: id }), T0 + i * MIN_MS), T0 + i * MIN_MS); });
  assert.deepEqual(entries.map((e) => e.provider), ids.slice(1).reverse(), 'the newest six, newest first');
  entries = snap.remember(entries, kept(provider({ id: 'metno' }), T0 + 10 * MIN_MS), T0 + 10 * MIN_MS);
  assert.equal(entries.filter((e) => e.provider === 'metno').length, 1, 'one per provider and kind');
  assert.equal(entries[0].at, T0 + 10 * MIN_MS);
  const uv = snap.remember(entries, kept(provider({ id: 'dwd' }), T0, 'uv'), T0 + 11 * MIN_MS);
  assert.equal(uv.length, 6);
  const late = T0 + 6 * HOUR * 1000 + 6 * MIN_MS;   // wunderground's, kept at 5 past, is 6 h 1 min old
  assert.deepEqual(snap.remember(uv, kept(provider({ id: 'yandex' }), late), late).map((e) => e.provider),
    ['yandex', 'metno'], 'past six hours they go; metno was kept at 10 past');
});

test('a stored value of another version, or a snapshot that cannot be read, serves nothing', () => {
  const e = kept(provider(), T0);
  assert.deepEqual(snap.entriesOf(snap.stored([e])), [e]);
  assert.deepEqual(snap.entriesOf(JSON.parse(JSON.stringify(snap.stored([e])))), [e], 'through JSON');
  assert.deepEqual(snap.entriesOf({ v: 2, entries: [e] }), [], 'another version');
  [null, 'x', {}, { v: 1 }, { v: 1, entries: 'x' }].forEach((v) => { assert.deepEqual(snap.entriesOf(v), []); });
  const broken = [
    Object.assign({}, e, { kind: 'constructor' }),
    Object.assign({}, e, { at: 'soon' }),
    Object.assign({}, e, { place: { lat: '52.52', lon: 13.4 } }),
    Object.assign({}, e, { fields: Object.assign({}, e.fields, { tempTrend: undefined }) })
  ];
  delete broken[3].fields.tempTrend;
  assert.deepEqual(snap.entriesOf(snap.stored(broken.concat([e]))), [e]);
});
