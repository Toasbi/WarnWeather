// test/index-fetch-options.test.js
// The index.js -> provider.options wiring (design C1): fetch() builds this
// fetch's knobs as ONE value (fetch-options.build, from the stored Clay
// settings) and hands it to the provider before any request URL is built.
// The other boot suites run on the harness's default slot selection and never
// tell two selections apart, so a fetch() that stopped building the options
// (every provider then runs on fetch-options' DEFAULTS) or built them after the
// first request would stay green there. This boots the REAL index.js three
// times: a UV slot, no UV/AQI selection, and an Open-Meteo/US AQI slot, and
// reads the difference off the requests Open-Meteo is sent.
const test = require('node:test');
const assert = require('node:assert/strict');
const { HARNESS_NOW, bootIndex } = require('./helpers/index-harness.js');
const statusCatalog = require('../src/pkjs/status-line-catalog.js');

const HOUR_MS = 60 * 60 * 1000;
const OPEN_METEO = /^https:\/\/api\.open-meteo\.com\/v1\/forecast\?/;
const UV_REQUEST = /^https:\/\/api\.open-meteo\.com\/v1\/forecast\?.*hourly=uv_index/;
// The gust/feels aux call (best_match): its window widens to four days only
// while a gust slot shows its day max (options.dayPeakCodes).
const AUX_REQUEST = /^https:\/\/api\.open-meteo\.com\/v1\/forecast\?.*current=apparent_temperature/;
// Either AQI feed: WAQI with a build-injected token, Open-Meteo without one.
const AQI_REQUEST = /^https:\/\/(api\.waqi\.info|air-quality-api\.open-meteo\.com)\//;

/** A last-success marker two hours old, so the boot tick finds a refresh due. */
function staleSuccess() {
  return { lastFetchSuccess: JSON.stringify({ time: new Date(HARNESS_NOW - 2 * HOUR_MS).toISOString() }) };
}

/**
 * No UV and no AQI anywhere, plus `over`: every configurable status slot
 * 'empty' and no forecast line on UV. The stored blob is read over the schema
 * defaults (claySettings.read), and those select UV twice (the radar line's
 * left slot and the third forecast line) and AQI once (the forecast line's
 * right slot) — so "none" has to be spelled out key by key.
 *
 * @param {Object} [over] Settings applied on top.
 * @returns {Object} Clay settings for bootIndex.
 */
function noUvNoAqi(over) {
  const s = { secondaryLine: 'off', thirdLine: 'off', fourthLine: 'off' };
  statusCatalog.allSlotKeys().forEach((k) => { s[k] = 'empty'; });
  return Object.assign(s, over || {});
}

/**
 * Boot index.js with `settings` and let the first fetch complete.
 *
 * @param {Object} t node:test context.
 * @param {Object} settings Clay settings merged over the harness base.
 * @returns {Object} Harness handles.
 */
function bootAndFetch(t, settings) {
  const h = bootIndex(t, { settings, store: staleSuccess() });
  h.ready();
  h.advance(5 * 1000);
  assert.equal(h.count(/Successfully fetched weather/), 1, 'the boot fetch completed');
  assert.equal(h.uncaught.length, 0);
  assert.ok(h.requestsTo(OPEN_METEO) >= 2, 'Open-Meteo answered the main and aux calls');
  return h;
}

test('a UV status slot sends Open-Meteo\'s UV request', (t) => {
  const h = bootAndFetch(t, noUvNoAqi({ statusRadarLeft: 'uv' }));
  assert.equal(h.requestsTo(UV_REQUEST), 1, 'options.fetchUv reached the provider: hourly=uv_index requested');
});

test('no UV and no AQI selection spends neither request', (t) => {
  const h = bootAndFetch(t, noUvNoAqi());
  assert.equal(h.requestsTo(UV_REQUEST), 0, 'no hourly=uv_index request');
  assert.equal(h.requestsTo(AQI_REQUEST), 0, 'no AQI request');
  // fetch-options' fail-safe default (dayPeakCodes null = every metric wanted)
  // would widen the aux call to four days; the settings-built value has no
  // day-max slot at all.
  const aux = h.xhrs.filter((u) => AUX_REQUEST.test(u));
  assert.equal(aux.length, 1);
  assert.match(aux[0], /&forecast_days=2(&|$)/, 'options.dayPeakCodes came from the settings, not the defaults');
});

test('an AQI slot asks the AQI feed in the stored source and scale', (t) => {
  const h = bootAndFetch(t, noUvNoAqi({ statusForecastRight: 'aqi', aqiSource: 'openmeteo', aqiScale: 'us' }));
  assert.equal(h.requestsTo(UV_REQUEST), 0, 'the AQI selection alone asks for no UV');
  const aqi = h.xhrs.filter((u) => AQI_REQUEST.test(u));
  assert.equal(aqi.length, 1, 'options.fetchAqi reached the provider');
  assert.match(aqi[0], /^https:\/\/air-quality-api\.open-meteo\.com\/.*hourly=us_aqi/,
    'options.aqiSource/aqiScale came from the settings (the defaults are WAQI / european)');
});
