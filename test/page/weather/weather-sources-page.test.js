// test/page/weather/weather-sources-page.test.js — the note under the Weather picker (Setup ›
// Data sources): the readings the watch draws that the picked provider has none of, which come
// from Open-Meteo (the source plan's fills, by the phone's own rules), and nothing otherwise.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
require('../../../src/pkjs/config-ui/lib/schema-walk.js');
require('../../../src/pkjs/lib/color.js');
require('../../../src/pkjs/config-ui/lib/engine.js');
const page = require('../../../src/pkjs/page/weather/weather-sources-page.js');
const schema = require('../../../src/pkjs/page/settings/schema.js');
const providerFactory = require('../../../src/pkjs/weather/adapter/provider-factory.js');
const providerReadings = require('../../../src/pkjs/weather/domain/provider-readings.js');
const platform = require('../../../src/pkjs/config-ui/lib/platform.js');
const { NOTHING_PLACED } = require('../../helpers/on-demand.js');
const { bootGeneratedPage } = require('../../helpers/page-harness.js');

const BASALT = platform.computeEnv({ platform: 'basalt' });
// No slot shows UV (a fresh install's radar bar and Watch bar do) and no alert is placed.
const NONE = Object.assign({ statusRadarLeft: 'empty', statusRadarMid: 'empty', statusRadarRight: 'empty',
  statusTopLeft: 'empty' }, NOTHING_PLACED);

/**
 * @param {Object} over Settings over NONE.
 * @returns {string} The note on a basalt.
 */
function note(over) { return page.fillNote(Object.assign({}, NONE, over), BASALT); }

test('the note names what the watch draws that the provider has none of', () => {
  assert.equal(note({ provider: 'yandex', secondaryLine: 'cloud', statusForecastMid: 'pressure' }),
    'Yandex Weather sends no cloud cover or air pressure, so they come from Open-Meteo.');
  assert.equal(note({ provider: 'yandex', secondaryLine: 'dew', thirdLine: 'cloud', statusForecastMid: 'pressure' }),
    'Yandex Weather sends no dew point, cloud cover or air pressure, so they come from Open-Meteo.');
  assert.equal(note({ provider: 'dwd', secondaryLine: 'uv' }), 'DWD sends no UV index, so it comes from Open-Meteo.');
  assert.equal(note({ provider: 'yandex', statusTopMid: 'wind', windSlotDirection: true }),
    'Yandex Weather sends no wind direction, so it comes from Open-Meteo.');
});

test('no note while nothing comes from Open-Meteo', () => {
  assert.equal(note({ provider: 'yandex' }), '', 'nothing it lacks is drawn');
  assert.equal(note({ provider: 'dwd', secondaryLine: 'cloud' }), '', 'DWD sends cloud cover');
  providerFactory.PROVIDER_IDS.filter((id) => providerReadings.READING_IDS.every((r) => providerReadings.serves(id, r)))
    .forEach((id) => {
      assert.equal(note({ provider: id, secondaryLine: 'uv', thirdLine: 'cloud', statusForecastMid: 'dew' }), '', id);
    });
  assert.equal(note({ provider: 'constructor', secondaryLine: 'uv' }), '', 'a stored value the table does not know');
  assert.equal(page.fillNote(null, BASALT), '');
});

test('every provider and reading has its words', () => {
  providerFactory.PROVIDER_IDS.forEach((id) => { assert.ok(page.NAMES[id], id); });
  providerReadings.READING_IDS.forEach((id) => { assert.ok(page.WORDS[id], id); });
});

test('the note sits under the Weather row, ahead of its key note, and shows on the page', () => {
  const card = schema.tabs.find((t) => t.id === 'setup').sections.find((s) => s.id === 'dataSources');
  const at = card.items.findIndex((i) => i.textFrom && i.textFrom.resolver === 'weatherFillNote');
  assert.equal(card.items[at - 1].messageKey, 'provider');
  assert.equal(card.items[at + 1].textFrom.resolver, 'keyMissingNote');
  assert.equal(card.items[at].joinPrevious, true);
  const p = bootGeneratedPage(Object.assign({ provider: 'yandex', yandexApiKey: 'k', secondaryLine: 'cloud' }, NONE),
    'basalt');
  p.clickTab('setup');
  assert.ok(p.scroll.innerHTML.indexOf('Yandex Weather sends no cloud cover, so it comes from Open-Meteo.') !== -1,
    'rendered on Setup');
});
