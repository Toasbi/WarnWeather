// test/shell/index-reading-picks.test.js — a reading pick through the REAL index.js: the
// Provider serves the forecast, and the picked provider is asked for its
// reading after it. When the pick's provider fails, the fetch still succeeds, the reading the
// Provider's. Without a pick the Provider is asked alone.
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

test('a reading pick asks its provider after the Provider\'s, and one that fails fails nothing', (t) => {
  const h = fetched(t, { weatherSourceWind: 'dwd' });
  assert.equal(h.count(/Successfully fetched weather/), 1);
  const asked = h.xhrs.filter((u) => BRIGHT_SKY.test(u) || OPEN_METEO_MAIN.test(u));
  assert.ok(OPEN_METEO_MAIN.test(asked[0]), 'the Provider\'s Open-Meteo first: ' + asked.join(', '));
  assert.ok(asked.some((u) => BRIGHT_SKY.test(u)), 'then DWD, for the wind');
  assert.equal(h.requestsTo(OPEN_METEO_MAIN), 1);
});

test('without a pick the Provider\'s provider is asked alone', (t) => {
  const h = fetched(t, {});
  assert.equal(h.count(/Successfully fetched weather/), 1);
  assert.equal(h.requestsTo(BRIGHT_SKY), 0);
  assert.equal(h.requestsTo(OPEN_METEO_MAIN), 1);
});
