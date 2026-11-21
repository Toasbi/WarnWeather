// test/weather/domain/source-plan.test.js — what a fetch asks for, in order: the forecast,
// which the fetch requires, from the Weather picker's provider (One provider) or the place's
// regional provider, then the Weather picker's, then Open-Meteo, each when the one before failed
// (By location); then, for the provider that served, Open-Meteo for each reading it lacks while
// the watch draws it: its UV-only request, and one request for the rest. Last, the calls a day
// the plan comes to.
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
const OSLO = { lat: 59.91, lon: 10.75 };
const PARIS = { lat: 48.857, lon: 2.352 };

/**
 * The forecast's providers for a fetch.
 * @param {Object} over Input over One provider at Berlin with OpenWeatherMap's key stored.
 * @returns {string[]}
 */
function asked(over) {
  return sourcePlan.candidates(Object.assign({ mode: 'one', provider: 'openweathermap', country: 'DE',
    keyed: ['openweathermap'] }, BERLIN, over));
}

// --- the forecast ---------------------------------------------------------------------------

test('One provider asks the Weather picker\'s alone, key or not', () => {
  assert.deepEqual(asked({ provider: 'dwd', keyed: [] }), ['dwd']);
  assert.deepEqual(asked({ keyed: [] }), ['openweathermap'], 'a missing key fails the fetch with its notice');
  assert.deepEqual(asked({ mode: 'sideways' }), ['openweathermap'], 'any other value is One provider');
});

test('By location: the country\'s regional provider, the Weather picker\'s, then Open-Meteo', () => {
  assert.deepEqual(asked({ mode: 'auto' }), ['dwd', 'openweathermap', 'openmeteo'], 'Germany: DWD');
  assert.deepEqual(asked(Object.assign({ mode: 'auto', country: 'NO' }, OSLO)), ['metno', 'openweathermap', 'openmeteo'],
    'Norway: Met.no');
  assert.deepEqual(asked(Object.assign({ mode: 'auto', country: 'FR' }, PARIS)), ['openweathermap', 'openmeteo'],
    'France has no regional provider');
  assert.deepEqual(asked({ mode: 'auto', country: null }), ['openweathermap', 'openmeteo'], 'no country: none');
});

test('By location asks each provider once, only where it covers the place and has its key', () => {
  assert.deepEqual(asked({ mode: 'auto', provider: 'dwd' }), ['dwd', 'openmeteo'], 'the Weather picker is the regional one');
  assert.deepEqual(asked({ mode: 'auto', provider: 'openmeteo' }), ['dwd', 'openmeteo']);
  assert.deepEqual(asked({ mode: 'auto', keyed: [] }), ['dwd', 'openmeteo'], 'OpenWeatherMap without its key');
  assert.deepEqual(asked(Object.assign({ mode: 'auto', country: 'DE' }, PARIS)), ['openweathermap', 'openmeteo'],
    'a German country code for a place outside DWD\'s area');
  assert.deepEqual(asked(Object.assign({ mode: 'auto', provider: 'dwd', country: 'FR' }, PARIS)), ['openmeteo'],
    'DWD as the Weather picker outside its area');
});

test('a country\'s regional provider is the setup wizard\'s pick, unless that is the pick for everyone else', () => {
  assert.equal(sourcePlan.regionalFor('DE'), 'dwd');
  ['NO', 'SE', 'DK', 'FI', 'IS'].forEach((cc) => assert.equal(sourcePlan.regionalFor(cc), 'metno', cc));
  ['FR', 'US', 'GB', null, '', 'none'].forEach((cc) => assert.equal(sourcePlan.regionalFor(cc), null, String(cc)));
  assert.equal(sourcePlan.regionalFor('DEU'), 'dwd', 'the reverse geocode\'s alpha-3 code');
  assert.equal(sourcePlan.regionalFor('nor'), 'metno');
  assert.equal(sourcePlan.regionalFor('FRA'), null);
});

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
  assert.deepEqual(Object.keys(openmeteo.GAP_FIELDS), providerReadings.DRAWN_ONLY.filter((r) => r !== 'uv'),
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

// --- Per reading -----------------------------------------------------------------------------

const PER_READING = { mode: 'reading', provider: 'metno', keyed: [], lat: BERLIN.lat, lon: BERLIN.lon };

test('each reading has its setting, and the stored picks name only the readings set to a provider', () => {
  assert.deepEqual(providerReadings.READING_IDS.map(sourcePlan.choiceKey), ['weatherSourceTemperature',
    'weatherSourceDew', 'weatherSourceRain', 'weatherSourceWind', 'weatherSourceWindDir', 'weatherSourceUv',
    'weatherSourceCloud', 'weatherSourcePressure', 'weatherSourceCondition']);
  assert.deepEqual(sourcePlan.choicesOf({ weatherSourceWind: 'dwd', weatherSourceUv: '', weatherSourceDew: 7 }),
    { wind: 'dwd' });
  assert.deepEqual(sourcePlan.choicesOf(null), {});
  assert.deepEqual(sourcePlan.keyedOf({ owmApiKey: 'k', tomorrowioApiKey: '', yandexApiKey: 'y' }),
    ['openweathermap', 'yandex']);
});

test('Per reading: a reading\'s pick where it can bring it, else the Weather picker\'s', () => {
  const by = sourcePlan.readingProviders(Object.assign({}, PER_READING, { keyed: ['tomorrowio'],
    choices: { temperature: 'dwd', wind: 'tomorrowio', uv: 'openweathermap', cloud: 'yandex', dew: 'nowhere' } }));
  assert.equal(by.temperature, 'dwd');
  assert.equal(by.wind, 'tomorrowio', 'a keyed provider with its key');
  assert.equal(by.uv, 'metno', 'OpenWeatherMap without its key');
  assert.equal(by.cloud, 'metno', 'Yandex sends no cloud cover');
  assert.equal(by.dew, 'metno', 'a provider the table does not know');
  assert.equal(by.rain, 'metno', 'no pick: the Weather picker\'s');
  const paris = sourcePlan.readingProviders(Object.assign({}, PER_READING, PARIS, { choices: { wind: 'dwd' } }));
  assert.equal(paris.wind, 'metno', 'DWD outside its area');
  const page = sourcePlan.readingProviders({ mode: 'reading', provider: 'metno', keyed: [], choices: { wind: 'dwd' } });
  assert.equal(page.wind, 'dwd', 'the settings page knows no place: no area check');
  const one = sourcePlan.readingProviders(Object.assign({}, PER_READING, { mode: 'one', choices: { wind: 'dwd' } }));
  assert.deepEqual(one, sourcePlan.allFrom('metno'), 'the other modes leave the picks alone');
});

test('Per reading: the forecast from the temperature\'s provider, then the Weather picker\'s', () => {
  assert.deepEqual(sourcePlan.candidates(Object.assign({}, PER_READING, { choices: { temperature: 'dwd' } })),
    ['dwd', 'metno']);
  assert.deepEqual(sourcePlan.candidates(Object.assign({}, PER_READING, { choices: {} })), ['metno']);
});

test('Per reading\'s parts: each other provider once, with the readings in use it brings, in the table\'s order', () => {
  const input = Object.assign({}, PER_READING, { choices: { wind: 'dwd', uv: 'openmeteo', pressure: 'dwd', dew: 'openmeteo' } });
  assert.deepEqual(sourcePlan.partSteps(input, 'metno', [], ALL_DRAWN), [
    { provider: 'openmeteo', readings: ['dew', 'uv'] },
    { provider: 'dwd', readings: ['wind', 'pressure'] }]);
  assert.deepEqual(sourcePlan.partSteps(input, 'metno', [], ['windDir', 'cloud', 'pressure']),
    [{ provider: 'dwd', readings: ['wind', 'pressure'] }], 'a reading the watch does not draw asks nobody');
  assert.deepEqual(sourcePlan.partSteps(input, 'metno', ['dwd'], ALL_DRAWN),
    [{ provider: 'openmeteo', readings: ['dew', 'uv'] }], 'a provider that failed this fetch');
  const dwdBase = Object.assign({}, PER_READING, { choices: { temperature: 'dwd', wind: 'dwd' } });
  assert.deepEqual(sourcePlan.partSteps(dwdBase, 'dwd', [], ALL_DRAWN),
    [{ provider: 'metno', readings: ['dew', 'rain', 'windDir', 'uv', 'cloud', 'pressure', 'condition'] }],
    'the forecast\'s provider brings its own; Same as Weather is the Weather picker\'s');
  assert.deepEqual(sourcePlan.partSteps(dwdBase, 'metno', ['dwd'], ALL_DRAWN), [],
    'the temperature\'s provider failed: the Weather picker\'s brings everything');
  assert.deepEqual(sourcePlan.partSteps(Object.assign({}, input, { mode: 'auto' }), 'metno', [], ALL_DRAWN), []);
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
const ON_PAGE = { mode: 'one', provider: 'openmeteo', country: null, keyed: [] };
const page = (over) => Object.assign({}, ON_PAGE, over);

test('a fetch uses a drawn-only reading while the watch draws it, the others always', () => {
  assert.deepEqual(sourcePlan.wanted([]), ['temperature', 'rain', 'wind', 'condition']);
  assert.deepEqual(sourcePlan.wanted(['cloud', 'uv']), ['temperature', 'rain', 'wind', 'uv', 'cloud', 'condition']);
  assert.deepEqual(providerReadings.DRAWN_ONLY, drawnReadings.READING_IDS,
    'the drawn-only readings are the ones drawn-readings.js has a rule for');
});

test('without the place (the settings page), By location keeps the regional provider; a missing key still drops one', () => {
  assert.deepEqual(sourcePlan.candidates(page({ mode: 'auto', provider: 'metno', country: 'DE' })),
    ['dwd', 'metno', 'openmeteo']);
  assert.deepEqual(sourcePlan.candidates(page({ mode: 'auto', provider: 'tomorrowio', country: 'US' })), ['openmeteo']);
  assert.deepEqual(sourcePlan.candidates(page({ mode: 'auto', provider: 'tomorrowio', country: 'US',
    keyed: ['tomorrowio'] })), ['tomorrowio', 'openmeteo']);
});

test('a refresh asks the forecast\'s provider, each part\'s and the fill request; the UV-only fill is counted apart', () => {
  assert.deepEqual(sourcePlan.refreshRequests(page({}), ['uv']), { openmeteo: 3 }, 'its own UV request');
  assert.deepEqual(sourcePlan.refreshRequests(page({}), []), { openmeteo: 2 });
  assert.deepEqual(sourcePlan.refreshRequests(page({ provider: 'dwd' }), ['uv']), { dwd: 2 });
  assert.deepEqual(sourcePlan.refreshRequests(page({ provider: 'yandex', keyed: ['yandex'] }), ['cloud', 'dew']),
    { yandex: 1, openmeteo: 1 }, 'one request for every reading it lacks');
  assert.deepEqual(sourcePlan.refreshRequests(page({ mode: 'auto', provider: 'openmeteo', country: 'NO' }), []),
    { metno: 1 }, 'By location: the regional provider; a fallback costs a call only when it fails');
  assert.deepEqual(sourcePlan.refreshRequests(page({ mode: 'reading', provider: 'metno',
    choices: { temperature: 'dwd', wind: 'dwd', rain: 'openmeteo' } }), []),
  { dwd: 2, openmeteo: 2, metno: 1 }, 'Per reading: one fetch for each provider a reading in use comes from');
  assert.deepEqual(sourcePlan.refreshRequests(page({ mode: 'reading', provider: 'metno', choices: {} }), ALL_DRAWN),
    sourcePlan.refreshRequests(page({ provider: 'metno' }), ALL_DRAWN), 'Same as Weather everywhere: One provider');
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
