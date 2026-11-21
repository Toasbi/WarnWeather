// test/shell/index-forecast-snapshots.test.js — the forecast snapshots through the REAL
// index.js: a settings save later in the same refresh slot sends the watch what the save
// changed without asking the provider again, and Force weather fetch asks it again, as its
// hint says (weather/domain/forecast-snapshot.js).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { HARNESS_NOW, bootIndex } = require('../helpers/index-harness.js');

const HOUR_MS = 60 * 60 * 1000;
// Open-Meteo's main call: one per fetch that asks Open-Meteo (the harness's provider).
const MAIN_REQUEST = /^https:\/\/api\.open-meteo\.com\/v1\/forecast\?.*models=ecmwf_ifs025/;

/**
 * Boot with a refresh due, let the first fetch finish, and return the harness.
 * @param {Object} t node:test context.
 * @returns {Object} Harness handles.
 */
function bootFetched(t) {
  const h = bootIndex(t, { store: { lastFetchSuccess: JSON.stringify({ time: new Date(HARNESS_NOW - 2 * HOUR_MS).toISOString() }) } });
  h.ready();
  h.advance(5 * 1000);
  assert.equal(h.count(/Successfully fetched weather/), 1, 'the boot fetch completed');
  assert.equal(h.requestsTo(MAIN_REQUEST), 1);
  return h;
}

test('a save in the same refresh slot re-renders from the slot\'s forecast, asking nobody', (t) => {
  const h = bootFetched(t);
  // A new main line changes what the watch draws (render signature): a forced fetch.
  h.saveSettings({ secondaryLine: 'cloud' });
  h.advance(5 * 1000);
  assert.equal(h.count(/Successfully fetched weather/), 2, 'the save\'s fetch completed');
  assert.equal(h.requestsTo(MAIN_REQUEST), 1, 'from the snapshot');
});

test('Force weather fetch asks the provider again in the same slot', (t) => {
  const h = bootFetched(t);
  h.saveSettings({ fetch: true });
  h.advance(5 * 1000);
  assert.equal(h.count(/Successfully fetched weather/), 2);
  assert.equal(h.requestsTo(MAIN_REQUEST), 2, 'a real re-fetch, as the toggle\'s hint says');
});
