// test/shell/index-weather-from.test.js — Weather from through the REAL index.js: By location
// reads the place's country off the reverse geocode (ArcGIS names it by its alpha-3 code) and
// asks Germany's DWD first; when DWD fails, the Weather picker's provider serves and the fetch
// succeeds. One provider asks the Weather picker's alone, as before the row.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { HARNESS_NOW, bootIndex } = require('../helpers/index-harness.js');

const HOUR_MS = 60 * 60 * 1000;
const BRIGHT_SKY = /^https:\/\/api\.brightsky\.dev\//;
const OPEN_METEO_MAIN = /^https:\/\/api\.open-meteo\.com\/v1\/forecast\?.*models=ecmwf_ifs025/;

/**
 * Boot with a refresh due (the harness's Berlin, Open-Meteo picked), let the fetch finish.
 * @param {Object} t node:test context.
 * @param {Object} settings Settings over the harness's.
 * @returns {Object} Harness handles.
 */
function fetched(t, settings) {
  const h = bootIndex(t, { settings: settings,
    store: { lastFetchSuccess: JSON.stringify({ time: new Date(HARNESS_NOW - 2 * HOUR_MS).toISOString() }) } });
  h.ready();
  h.advance(5 * 1000);
  return h;
}

test('By location in Germany asks DWD first, and the Weather picker\'s provider serves when it fails', (t) => {
  const h = fetched(t, { weatherSourceMode: 'auto' });
  assert.equal(h.count(/Successfully fetched weather/), 1);
  const asked = h.xhrs.filter((u) => BRIGHT_SKY.test(u) || OPEN_METEO_MAIN.test(u));
  assert.ok(BRIGHT_SKY.test(asked[0]), 'DWD first: ' + asked.join(', '));
  assert.ok(asked.some((u) => OPEN_METEO_MAIN.test(u)), 'then Open-Meteo, the Weather picker\'s');
});

test('One provider asks the Weather picker\'s provider alone', (t) => {
  const h = fetched(t, { weatherSourceMode: 'one' });
  assert.equal(h.count(/Successfully fetched weather/), 1);
  assert.equal(h.requestsTo(BRIGHT_SKY), 0);
  assert.equal(h.requestsTo(OPEN_METEO_MAIN), 1);
});

test('By location keeps the country last found near the place while the reverse geocode fails', (t) => {
  const { healthyNetwork } = require('../helpers/index-harness.js');
  const h = bootIndex(t, { settings: { weatherSourceMode: 'auto' },
    network: (url) => (/geocode\.arcgis\.com/.test(url) ? { status: 503, body: '' } : healthyNetwork(url)),
    store: { lastFetchSuccess: JSON.stringify({ time: new Date(HARNESS_NOW - 2 * HOUR_MS).toISOString() }),
      lastCity: JSON.stringify({ name: 'Mitte', lat: 52.52, lon: 13.405, country: 'DEU' }) } });
  h.ready();
  h.advance(5 * 1000);
  const asked = h.xhrs.filter((u) => BRIGHT_SKY.test(u) || OPEN_METEO_MAIN.test(u));
  assert.ok(BRIGHT_SKY.test(asked[0]), 'DWD first, as in Germany: ' + asked.join(', '));
});

