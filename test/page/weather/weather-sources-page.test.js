// test/page/weather/weather-sources-page.test.js — the note under the Weather picker (Setup ›
// Data sources): the readings the watch draws that the picked provider has none of, which come
// from Open-Meteo (the source plan's fills, by the phone's own rules), and nothing otherwise;
// the reading rows; and the weather calls a day at the section's end (the plan's count).
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
const { NOTHING_PLACED, NOTHING_DRAWN } = require('../../helpers/on-demand.js');
const { bootGeneratedPage } = require('../../helpers/page-harness.js');

const BASALT = platform.computeEnv({ platform: 'basalt' });
// No slot shows UV (a fresh install's radar bar and Watch bar do) and no alert is placed.
const NONE = NOTHING_DRAWN;

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

test('the Weather picker opens the section', () => {
  const card = schema.tabs.find((t) => t.id === 'setup').sections.find((s) => s.id === 'dataSources');
  assert.equal(card.items[0].messageKey, 'provider');
});

test('the reading rows: one per reading after the Weather picker\'s, each the providers that send it', () => {
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
    assert.equal(row.showWhen, undefined, 'always shown');
    assert.equal(row.defaultValue, '');
    assert.deepEqual(row.optionsFrom, { resolver: 'weatherReadingOptions', args: { reading: reading } });
    assert.equal(row.options, undefined, 'the page builds the list');
  });
});

test('a reading row lists Same as Weather and the providers that send its reading; a keyed one needs its key', () => {
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

test('the note names only what follows the Weather picker', () => {
  const S = { provider: 'yandex', secondaryLine: 'cloud', statusForecastMid: 'pressure' };
  assert.equal(note(S), 'Yandex Weather sends no cloud cover or air pressure, so they come from Open-Meteo.');
  assert.equal(note(Object.assign({}, S, { weatherSourceCloud: 'dwd' })),
    'Yandex Weather sends no air pressure, so it comes from Open-Meteo.', 'DWD brings the cloud cover');
  assert.equal(note(Object.assign({}, S, { weatherSourceCloud: 'dwd', weatherSourcePressure: 'metno' })), '');
});

test('every provider and reading has its words', () => {
  const words = require('../../../src/pkjs/page/weather/weather-words.js');
  providerFactory.PROVIDER_IDS.forEach((id) => { assert.ok(words.NAMES[id], id); });
  providerReadings.READING_IDS.forEach((id) => { assert.ok(words.WORDS[id], id); });
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

// --- the weather calls line at the end of Data sources ---------------------------------------

/**
 * The line on a basalt, every 15 minutes with no night pause unless `intervalMin` and
 * `pauseHours` say otherwise (a pause from 22:00 when it is 9 hours).
 * @param {Object} over Settings over NONE.
 * @param {number} [intervalMin] The update interval.
 * @param {number} [pauseHours] The Battery saver's window: 0 or 9.
 * @returns {string}
 */
function calls(over, intervalMin, pauseHours) {
  const pause = pauseHours ? { sleepNightEnabled: true, sleepStartHour: '22', sleepEndHour: '7' }
    : { sleepNightEnabled: false };
  return page.callsLine(Object.assign({ fetchIntervalMin: String(intervalMin || 15) }, pause, NONE, over), BASALT);
}

test('the calls line counts each update\'s requests, and the UV fill every few hours', () => {
  assert.equal(calls({ provider: 'openmeteo' }), 'About 192 weather calls a day.', 'its two requests every update');
  assert.equal(calls({ provider: 'openmeteo', secondaryLine: 'uv' }), 'About 288 weather calls a day.',
    'and its UV request while UV is drawn');
  assert.equal(calls({ provider: 'dwd', secondaryLine: 'uv' }),
    'About 200 weather calls a day: 192 to DWD and 8 to Open-Meteo.');
  assert.equal(calls({ provider: 'dwd', secondaryLine: 'uv' }, 60, 9),
    'About 34 weather calls a day: 30 to DWD and 4 to Open-Meteo.', 'hourly, paused 9 hours a night');
  assert.equal(calls({ provider: 'yandex', yandexApiKey: 'k', secondaryLine: 'cloud' }),
    'About 192 weather calls a day: 96 to Yandex Weather and 96 to Open-Meteo.', 'the gap request every update');
  assert.equal(calls({ provider: 'constructor' }), '', 'a stored value the table does not know');
});

test('the calls line counts every provider a reading in use comes from', () => {
  assert.equal(calls({ provider: 'metno', weatherSourceTemperature: 'dwd',
    weatherSourceRain: 'openmeteo' }), 'About 480 weather calls a day: 96 to Met.no, 192 to DWD and 192 to Open-Meteo.',
  'the Weather picker\'s provider first, then the parts in the readings\' order');
  assert.equal(calls({ provider: 'metno', weatherSourceWind: 'tomorrowio' }),
    'About 96 weather calls a day.', 'a keyed pick without its key follows the Weather picker');
});

test('the line closes Data sources under the Update interval, at the interval Save stores and the night pause', () => {
  const card = schema.tabs.find((t) => t.id === 'setup').sections.find((s) => s.id === 'dataSources');
  assert.deepEqual(card.items[card.items.length - 1],
    { type: 'staticText', joinPrevious: true, textFrom: { resolver: 'weatherCallsLine' } });
  assert.equal(card.items[card.items.length - 2].messageKey, 'fetchIntervalMin');
  const line = global.PConf.hintResolvers.get('weatherCallsLine');
  const S = Object.assign({}, NONE, { provider: 'tomorrowio', tomorrowioApiKey: 'k', radarProvider: 'tomorrowio',
    radarMode: 'graph', fetchIntervalMin: '5', tomorrowioFitBudget: true, sleepNightEnabled: false });
  assert.equal(line(S, BASALT), 'About 96 weather calls a day.',
    'tomorrow.io\'s weather and radar every 5 minutes break its free plan: Save stores 15');
  assert.equal(line(Object.assign({}, S, { tomorrowioFitBudget: false }), BASALT), 'About 288 weather calls a day.');
  assert.equal(line(Object.assign({}, S, { sleepNightEnabled: true, sleepStartHour: '22', sleepEndHour: '7' }), BASALT),
    'About 180 weather calls a day.', 'paused 9 hours a night, 5 minutes fits the plan');
  assert.equal(line(Object.assign({}, S, { radarEnabled: false }), BASALT), 'About 288 weather calls a day.',
    'the radar off: Save stores no radar mode that calls tomorrow.io, so 5 minutes fits');
});
