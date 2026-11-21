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

test('By location names no reading: the page does not know the place, and the row\'s hint says it', () => {
  assert.equal(note({ provider: 'yandex', secondaryLine: 'cloud', weatherSourceMode: 'auto' }), '');
  assert.equal(note({ provider: 'yandex', secondaryLine: 'cloud', weatherSourceMode: 'one' }),
    'Yandex Weather sends no cloud cover, so it comes from Open-Meteo.');
});

test('the Weather from row opens the section: One provider by default, hints for the other two', () => {
  const card = schema.tabs.find((t) => t.id === 'setup').sections.find((s) => s.id === 'dataSources');
  const row = card.items[0];
  assert.equal(row.messageKey, 'weatherSourceMode');
  assert.equal(card.items[1].messageKey, 'provider', 'right above the Weather picker');
  assert.equal(row.type, 'segmented');
  assert.equal(row.defaultValue, 'one');
  assert.deepEqual(row.options, [['One provider', 'one'], ['By location', 'auto'], ['Per reading', 'reading']]);
  assert.deepEqual(Object.keys(row.hintByValue), ['auto', 'reading']);
  assert.match(row.hintByValue.auto, /DWD in Germany, Met\.no in the Nordic countries/);
  assert.match(row.hintByValue.reading, /^Each reading below can come from its own provider\./);
});

test('Per reading\'s rows: one per reading after the Weather picker\'s, each the providers that send it', () => {
  const sourcePlan = require('../../../src/pkjs/weather/domain/source-plan.js');
  const card = schema.tabs.find((t) => t.id === 'setup').sections.find((s) => s.id === 'dataSources');
  const keys = providerReadings.READING_IDS.map(sourcePlan.choiceKey);
  const rows = card.items.filter((i) => keys.indexOf(i.messageKey) !== -1);
  assert.deepEqual(rows.map((r) => r.messageKey), keys, 'in the table\'s order');
  assert.deepEqual(rows.map((r) => r.label), ['Temperature', 'Dew point', 'Rain', 'Wind', 'Wind direction', 'UV index',
    'Cloud cover', 'Air pressure', 'Weather condition']);
  const first = card.items.indexOf(rows[0]);
  assert.equal(card.items[first - 1].type, 'sheet', 'right after the Weather picker\'s key row');
  rows.forEach((row, i) => {
    const reading = providerReadings.READING_IDS[i];
    assert.deepEqual(row.showWhen, { key: 'weatherSourceMode', eq: 'reading' });
    assert.equal(row.defaultValue, '');
    assert.deepEqual(row.optionsFrom, { resolver: 'weatherReadingOptions', args: { reading: reading } });
    assert.equal(row.options, undefined, 'the page builds the list');
  });
});

test('a Per reading row lists Same as Weather and the providers that send its reading; a keyed one needs its key', () => {
  const PC = global.PConf;
  assert.equal(PC.optionsResolvers.get('weatherReadingOptions'), page.readingOptions, 'registered');
  providerReadings.READING_IDS.forEach((reading) => {
    const options = page.readingOptions({}, BASALT, { reading: reading });
    assert.deepEqual(options[0], ['Same as Weather', '']);
    assert.deepEqual(options.slice(1).map((o) => o[1]),
      ['dwd', 'metno', 'openmeteo', 'openweathermap', 'tomorrowio', 'wunderground', 'yandex']
        .filter((id) => providerReadings.serves(id, reading)), reading + ': the providers that send it');
    options.slice(1).forEach((o) => {
      assert.equal(Boolean(o[2] && o[2].disabled), Boolean(providerReadings.keySetting(o[1])),
        reading + ': ' + o[1] + ' inert without its key');
    });
  });
  const wind = page.readingOptions({ tomorrowioApiKey: 'k' }, BASALT, { reading: 'wind' });
  assert.deepEqual(wind.find((o) => o[1] === 'tomorrowio'), ['Tomorrow.io', 'tomorrowio'], 'with its key stored');
  assert.deepEqual(wind.find((o) => o[1] === 'openweathermap'),
    ['OpenWeatherMap', 'openweathermap', { desc: 'Add its API key under Weather first', disabled: true }]);
  assert.equal(page.readingOptions({}, BASALT, { reading: 'cloud' }).some((o) => o[1] === 'yandex'), false,
    'Yandex sends no cloud cover');
});

test('in Per reading the note names only what follows the Weather picker', () => {
  const S = { provider: 'yandex', weatherSourceMode: 'reading', secondaryLine: 'cloud', statusForecastMid: 'pressure' };
  assert.equal(note(S), 'Yandex Weather sends no cloud cover or air pressure, so they come from Open-Meteo.');
  assert.equal(note(Object.assign({}, S, { weatherSourceCloud: 'dwd' })),
    'Yandex Weather sends no air pressure, so it comes from Open-Meteo.', 'DWD brings the cloud cover');
  assert.equal(note(Object.assign({}, S, { weatherSourceCloud: 'dwd', weatherSourcePressure: 'metno' })), '');
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
