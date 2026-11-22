// test/weather/domain/source-plan.test.js — what a fetch asks for, in order: the forecast,
// which the fetch requires, from the Weather picker's provider; then each other provider a
// reading's row picks, for the readings it brings (the parts); then Open-Meteo for each reading
// the provider it came from lacks while the watch draws it: its UV-only request, and one request
// for the rest. Last, the calls a day the plan comes to.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const sourcePlan = require('../../../src/pkjs/weather/domain/source-plan.js');
const providerReadings = require('../../../src/pkjs/weather/domain/provider-readings.js');
const providerFactory = require('../../../src/pkjs/weather/adapter/provider-factory.js');

const UV_FILL = { provider: sourcePlan.FILL_PROVIDER, ask: 'uv', readings: ['uv'] };
const GAP_FILL = (readings) => ({ provider: sourcePlan.FILL_PROVIDER, ask: 'readings', readings: readings });
const ALL_DRAWN = ['dew', 'windDir', 'uv', 'cloud', 'pressure'];
const BERLIN = { lat: 52.52, lon: 13.405 };
const PARIS = { lat: 48.857, lon: 2.352 };

// --- the fills ------------------------------------------------------------------------------

providerFactory.PROVIDER_IDS.forEach((id) => {
  test(id + ': the UV from Open-Meteo only when it sends none and the watch draws it', () => {
    assert.deepEqual(sourcePlan.fillSteps(sourcePlan.allFrom(id), []), []);
    assert.deepEqual(sourcePlan.fillSteps(sourcePlan.allFrom(id), ['uv']), providerReadings.serves(id, 'uv') ? [] : [UV_FILL]);
  });
});

test('DWD is the provider that sends no UV, so its UV is filled', () => {
  assert.deepEqual(sourcePlan.fillSteps(sourcePlan.allFrom('dwd'), ALL_DRAWN), [UV_FILL]);
});

test('a provider the table does not know sends nothing it names, so its drawn UV is filled too', () => {
  assert.deepEqual(sourcePlan.fillSteps(sourcePlan.allFrom('interface'), ['uv']), [UV_FILL]);
});

test('every reading a provider lacks is drawn-only, and Open-Meteo\'s request for the others brings each but UV', () => {
  providerFactory.PROVIDER_IDS.forEach((id) => {
    const lacks = providerReadings.READING_IDS.filter((r) => !providerReadings.serves(id, r));
    assert.deepEqual(lacks.filter((r) => providerReadings.DRAWN_ONLY.indexOf(r) === -1), [], id);
  });
  const openmeteo = require('../../../src/pkjs/weather/adapter/providers/openmeteo.js');
  assert.deepEqual(Object.keys(openmeteo.FILL_FIELDS), providerReadings.DRAWN_ONLY.filter((r) => r !== 'uv'),
    'UV has its own request (fetchUvInto)');
});

test('Yandex\'s drawn readings come from one Open-Meteo request; those not drawn are not asked', () => {
  assert.deepEqual(sourcePlan.fillSteps(sourcePlan.allFrom('yandex'), ALL_DRAWN), [GAP_FILL(['dew', 'windDir', 'cloud', 'pressure'])]);
  assert.deepEqual(sourcePlan.fillSteps(sourcePlan.allFrom('yandex'), ['pressure', 'cloud']), [GAP_FILL(['cloud', 'pressure'])],
    'in the table\'s order');
  assert.deepEqual(sourcePlan.fillSteps(sourcePlan.allFrom('yandex'), ['uv']), [], 'Yandex sends its own UV');
  assert.deepEqual(sourcePlan.fillSteps(sourcePlan.allFrom('yandex'), []), [], 'nothing drawn');
});

test('a provider that sends a reading is never filled for it, drawn or not', () => {
  providerFactory.PROVIDER_IDS.forEach((id) => {
    const filled = sourcePlan.fillsOf(sourcePlan.allFrom(id), ALL_DRAWN);
    assert.deepEqual(filled.filter((r) => providerReadings.serves(id, r)), [], id);
    assert.deepEqual(filled, providerReadings.READING_IDS.filter((r) => ALL_DRAWN.indexOf(r) !== -1
      && !providerReadings.serves(id, r)), id + ': every drawn reading it lacks');
  });
});

test('a reading is filled only while the watch draws it', () => {
  assert.deepEqual(sourcePlan.fillsOf(sourcePlan.allFrom('dwd'), []), []);
  assert.deepEqual(sourcePlan.fillsOf(sourcePlan.allFrom('dwd'), ['uv']), ['uv']);
});

// --- the reading rows ------------------------------------------------------------------------

const PICKS = { provider: 'metno', keyed: [], lat: BERLIN.lat, lon: BERLIN.lon };

test('each reading has its setting, and the stored picks name only the readings set to a provider', () => {
  assert.deepEqual(providerReadings.READING_IDS.map(sourcePlan.choiceKey), ['weatherSourceCurrentTemp',
    'weatherSourceCurrentFeels', 'weatherSourceCondition', 'weatherSourceTemperature', 'weatherSourceFeels',
    'weatherSourceDew', 'weatherSourceRainChance', 'weatherSourceRainAmount', 'weatherSourceWind', 'weatherSourceGust',
    'weatherSourceWindDir', 'weatherSourceUv', 'weatherSourceCloud', 'weatherSourcePressure']);
  assert.deepEqual(sourcePlan.choicesOf({ weatherSourceWind: 'dwd', weatherSourceUv: '', weatherSourceDew: 7 }),
    { wind: 'dwd' });
  assert.deepEqual(sourcePlan.choicesOf(null), {});
  assert.deepEqual(sourcePlan.keyedOf({ owmApiKey: 'k', tomorrowioApiKey: '', yandexApiKey: 'y' }),
    ['openweathermap', 'yandex']);
});

test('the settings say where the weather comes from: the picks and the stored keys', () => {
  assert.deepEqual(sourcePlan.sourcesOf({ weatherSourceWind: 'dwd', owmApiKey: 'k' }),
    { choices: { wind: 'dwd' }, keyed: ['openweathermap'] });
  assert.deepEqual(sourcePlan.sourcesOf(null), { choices: {}, keyed: [] });
  assert.deepEqual(sourcePlan.inputOf({ provider: 'dwd', weatherSourceRainAmount: 'metno' }),
    { provider: 'dwd', choices: { rainAmount: 'metno' }, keyed: [] }, 'the page\'s input: no place');
});

test('the settings the sources are read from are every key a read touches', () => {
  const read = new Set();
  const spy = new Proxy({}, { get: (target, k) => { if (typeof k === 'string') { read.add(k); } return undefined; } });
  sourcePlan.sourcesOf(spy);
  assert.deepEqual([...read].sort(), sourcePlan.SETTINGS_KEYS.slice().sort());
});

test('a reading\'s pick where it can bring it, else the Weather picker\'s', () => {
  const by = sourcePlan.readingProviders(Object.assign({}, PICKS, { keyed: ['tomorrowio'],
    choices: { temperature: 'dwd', wind: 'tomorrowio', uv: 'openweathermap', cloud: 'yandex', dew: 'nowhere' } }));
  assert.equal(by.temperature, 'dwd');
  assert.equal(by.wind, 'tomorrowio', 'a keyed provider with its key');
  assert.equal(by.uv, 'metno', 'OpenWeatherMap without its key');
  assert.equal(by.cloud, 'metno', 'Yandex sends no cloud cover');
  assert.equal(by.dew, 'metno', 'a provider the table does not know');
  assert.equal(by.rainChance, 'metno', 'no pick: the Weather picker\'s');
  assert.equal(by.gust, 'metno', 'the gusts are a reading of their own');
  const paris = sourcePlan.readingProviders(Object.assign({}, PICKS, PARIS, { choices: { wind: 'dwd' } }));
  assert.equal(paris.wind, 'metno', 'DWD outside its area');
  const page = sourcePlan.readingProviders({ provider: 'metno', keyed: [], choices: { wind: 'dwd' } });
  assert.equal(page.wind, 'dwd', 'the settings page knows no place: no area check');
});

test('the parts: each other provider once, with the readings in use it brings', () => {
  const input = Object.assign({}, PICKS, { choices: { wind: 'dwd', uv: 'openmeteo', pressure: 'dwd', dew: 'openmeteo' } });
  const part = (provider, readings) => ({ provider: provider, readings: readings });
  assert.deepEqual(sourcePlan.partSteps(input, ALL_DRAWN), [part('openmeteo', ['dew', 'uv']),
    part('dwd', ['wind', 'pressure'])]);
  assert.deepEqual(sourcePlan.partSteps(input, ['windDir', 'cloud', 'pressure']),
    [part('dwd', ['wind', 'pressure'])], 'a reading the watch does not draw asks nobody');
  assert.deepEqual(sourcePlan.partSteps(Object.assign({}, PICKS, { choices: { temperature: 'metno' } }), ALL_DRAWN), [],
    'a pick of the Weather picker\'s own provider is no part');
  assert.deepEqual(sourcePlan.partSteps(Object.assign({}, PICKS, { choices: {} }), ALL_DRAWN), []);
});

test('a reading follows its own provider while nothing fails, sent or not; a part asks only for what it sends', () => {
  const dwdPicker = Object.assign({}, PICKS, { provider: 'dwd', choices: { temperature: 'metno', rainChance: 'metno',
    wind: 'metno', condition: 'metno' } });
  const feeds = sourcePlan.feedsOf(dwdPicker, ['uv']);
  assert.equal(feeds.uv, 'dwd', 'UV follows the Weather picker\'s DWD, which sends none: it is filled');
  assert.equal(feeds.temperature, 'metno');
  assert.equal(feeds.cloud, 'dwd', 'a reading the watch does not draw stays the Weather picker\'s');
  assert.deepEqual(sourcePlan.partSteps(dwdPicker, ['uv']), [{ provider: 'metno',
    readings: ['condition', 'temperature', 'rainChance', 'wind'] }], 'no part asks DWD for UV it lacks');
  assert.deepEqual(sourcePlan.fillSteps(feeds, ['uv']), [UV_FILL]);
});

test('a fill from a provider whose forecast the refresh holds asks nothing', () => {
  const yandex = page({ provider: 'yandex', keyed: ['yandex'], choices: { rainAmount: 'openmeteo' } });
  assert.deepEqual(sourcePlan.refreshRequests(yandex, ['uv', 'cloud']), { yandex: 1, openmeteo: 3 },
    'the rain part\'s forecast brings the cloud cover');
  const dwd = page({ provider: 'dwd', choices: { rainChance: 'openmeteo' } });
  assert.deepEqual(sourcePlan.callsPerDay(dwd, ['uv'], 15, 0), { dwd: 192, openmeteo: 288 },
    'and DWD\'s UV: no UV-only fill');
});

test('the fills follow each reading\'s own provider', () => {
  const feeds = Object.assign(sourcePlan.allFrom('yandex'), { cloud: 'dwd', uv: 'dwd' });
  assert.deepEqual(sourcePlan.fillSteps(feeds, ALL_DRAWN), [UV_FILL, GAP_FILL(['dew', 'windDir', 'pressure'])],
    'DWD\'s cloud cover is its own, its UV is filled, and Yandex\'s other gaps');
});

// --- the calls a day ------------------------------------------------------------------------
// test/weather/application/fetch-sources.test.js runs a day of updates through the engine
// against these counts.

const drawnReadings = require('../../../src/pkjs/weather/domain/drawn-readings.js');
// The settings page's input: no place, and what the settings hold.
const ON_PAGE = { provider: 'openmeteo', keyed: [] };
const page = (over) => Object.assign({}, ON_PAGE, over);

test('a fetch uses a drawn-only reading while the watch draws it, the others always', () => {
  const always = ['currentTemp', 'currentFeels', 'condition', 'temperature', 'feels', 'rainChance', 'rainAmount', 'wind',
    'gust'];
  assert.deepEqual(sourcePlan.wanted([]), always);
  assert.deepEqual(sourcePlan.wanted(['cloud', 'uv']), always.concat(['uv', 'cloud']));
  assert.deepEqual(providerReadings.DRAWN_ONLY, drawnReadings.READING_IDS,
    'the drawn-only readings are the ones drawn-readings.js has a rule for');
});

test('a refresh asks the Weather picker\'s provider, each part\'s and the fill request; the UV-only fill is counted apart', () => {
  assert.deepEqual(sourcePlan.refreshRequests(page({}), ['uv']), { openmeteo: 3 }, 'its own UV request');
  assert.deepEqual(sourcePlan.refreshRequests(page({}), []), { openmeteo: 2 });
  assert.deepEqual(sourcePlan.refreshRequests(page({ provider: 'dwd' }), ['uv']), { dwd: 2 });
  assert.deepEqual(sourcePlan.refreshRequests(page({ provider: 'yandex', keyed: ['yandex'] }), ['cloud', 'dew']),
    { yandex: 1, openmeteo: 1 }, 'one request for every reading it lacks');
  assert.deepEqual(sourcePlan.refreshRequests(page({ provider: 'metno',
    choices: { temperature: 'dwd', wind: 'dwd', rainAmount: 'openmeteo' } }), []),
  { metno: 1, dwd: 2, openmeteo: 2 }, 'one fetch for each provider a reading in use comes from');
  assert.deepEqual(sourcePlan.refreshRequests(page({ provider: 'metno', choices: {} }), ALL_DRAWN),
    sourcePlan.refreshRequests(page({ provider: 'metno' }), ALL_DRAWN), 'Same as Weather everywhere: the provider alone');
});

test('a day is the update interval\'s refreshes outside the Battery saver\'s window', () => {
  assert.equal(sourcePlan.refreshesPerDay(15, 0), 96);
  assert.equal(sourcePlan.refreshesPerDay(5, 0), 288);
  assert.equal(sourcePlan.refreshesPerDay(60, 0), 24);
  assert.equal(sourcePlan.refreshesPerDay(15, 9), 60, '22:00 to 7:00');
  assert.deepEqual(sourcePlan.callsPerDay(page({ provider: 'metno' }), ['uv'], 15, 9), { metno: 60 });
});

test('the UV-only fill asks at the first refresh after its last answer stopped serving', () => {
  assert.equal(sourcePlan.UV_REUSE_MS, 3 * 60 * 60 * 1000, 'three hours (forecast-snapshot.js serves it as long)');
  const uvCalls = (intervalMin, pauseHours) =>
    sourcePlan.callsPerDay(page({ provider: 'dwd' }), ['uv'], intervalMin, pauseHours).openmeteo;
  assert.equal(uvCalls(15, 0), 8, 'every 13th refresh: one at exactly three hours still reuses it');
  assert.equal(uvCalls(60, 0), 6, 'every fourth hour');
  assert.equal(uvCalls(5, 0), 8);
  assert.equal(uvCalls(60, 9), 4, 'fifteen hours awake');
  assert.deepEqual(sourcePlan.callsPerDay(page({ provider: 'dwd' }), ['uv'], 15, 0), { dwd: 192, openmeteo: 8 });
  assert.deepEqual(sourcePlan.callsPerDay(page({ provider: 'dwd' }), [], 15, 0), { dwd: 192 }, 'UV not drawn');
});
