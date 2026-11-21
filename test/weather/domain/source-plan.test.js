// test/weather/domain/source-plan.test.js — what a fetch asks for, in order: the forecast,
// which the fetch requires, from the Weather picker's provider (One provider) or the place's
// regional provider, then the Weather picker's, then Open-Meteo, each when the one before failed
// (By location); then, for the provider that served, Open-Meteo for each reading it lacks while
// the watch draws it: its UV-only request, and one request for the rest.
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
  return sourcePlan.forecastStep(Object.assign({ mode: 'one', provider: 'openweathermap', country: 'DE',
    keyed: ['openweathermap'] }, BERLIN, over)).providers;
}

// --- the forecast ---------------------------------------------------------------------------

test('the forecast is required, and One provider asks the Weather picker\'s alone, key or not', () => {
  assert.deepEqual(sourcePlan.forecastStep({ mode: 'one', provider: 'dwd', country: 'DE', keyed: [],
    lat: BERLIN.lat, lon: BERLIN.lon }), { ask: 'forecast', providers: ['dwd'], required: true });
  assert.deepEqual(asked({ keyed: [] }), ['openweathermap'], 'a missing key fails the fetch with its notice');
  assert.deepEqual(asked({ mode: 'reading' }), ['openweathermap'], 'any other mode is One provider for now');
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
  test(id + ': the UV from Open-Meteo only when it sends none and the fetch asks for it', () => {
    assert.deepEqual(sourcePlan.fillSteps(sourcePlan.allFrom(id), false, []), []);
    assert.deepEqual(sourcePlan.fillSteps(sourcePlan.allFrom(id), true, []), providerReadings.serves(id, 'uv') ? [] : [UV_FILL]);
  });
});

test('DWD is the provider that sends no UV, so its UV is filled', () => {
  assert.deepEqual(sourcePlan.fillSteps(sourcePlan.allFrom('dwd'), true, ALL_DRAWN), [UV_FILL]);
});

test('a provider the table does not know sends nothing it names, so its drawn UV is filled too', () => {
  assert.deepEqual(sourcePlan.fillSteps(sourcePlan.allFrom('interface'), true, []), [UV_FILL]);
});

test('every reading a provider lacks is UV or one the gap request brings', () => {
  providerFactory.PROVIDER_IDS.forEach((id) => {
    const lacks = providerReadings.READING_IDS.filter((r) => !providerReadings.serves(id, r));
    assert.deepEqual(lacks.filter((r) => r !== 'uv' && sourcePlan.GAP_READINGS.indexOf(r) === -1), [], id);
  });
});

test('Yandex\'s drawn readings come from one Open-Meteo request; those not drawn are not asked', () => {
  assert.deepEqual(sourcePlan.fillSteps(sourcePlan.allFrom('yandex'), true, ALL_DRAWN), [GAP_FILL(['dew', 'windDir', 'cloud', 'pressure'])]);
  assert.deepEqual(sourcePlan.fillSteps(sourcePlan.allFrom('yandex'), false, ['pressure', 'cloud']), [GAP_FILL(['cloud', 'pressure'])],
    'in the table\'s order');
  assert.deepEqual(sourcePlan.fillSteps(sourcePlan.allFrom('yandex'), true, ['uv']), [], 'Yandex sends its own UV');
  assert.deepEqual(sourcePlan.fillSteps(sourcePlan.allFrom('yandex'), true, []), [], 'nothing drawn');
});

test('a provider that sends a reading is never filled for it, drawn or not', () => {
  providerFactory.PROVIDER_IDS.forEach((id) => {
    const filled = sourcePlan.fills(id, true, ALL_DRAWN);
    assert.deepEqual(filled.filter((r) => providerReadings.serves(id, r)), [], id);
    assert.deepEqual(filled, providerReadings.READING_IDS.filter((r) => ALL_DRAWN.indexOf(r) !== -1
      && !providerReadings.serves(id, r)), id + ': every drawn reading it lacks');
  });
});

test('UV follows the fetch\'s own UV gate, not the drawn list', () => {
  assert.deepEqual(sourcePlan.fills('dwd', false, ['uv']), []);
  assert.deepEqual(sourcePlan.fills('dwd', true, []), ['uv']);
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
  const all = providerReadings.READING_IDS;
  assert.deepEqual(sourcePlan.partSteps(input, 'metno', [], all), [
    { provider: 'openmeteo', ask: 'forecast', readings: ['dew', 'uv'] },
    { provider: 'dwd', ask: 'forecast', readings: ['wind', 'pressure'] }]);
  assert.deepEqual(sourcePlan.partSteps(input, 'metno', [], all.filter((r) => r !== 'uv' && r !== 'dew')),
    [{ provider: 'dwd', ask: 'forecast', readings: ['wind', 'pressure'] }], 'a reading not in use asks nobody');
  assert.deepEqual(sourcePlan.partSteps(input, 'metno', ['dwd'], all),
    [{ provider: 'openmeteo', ask: 'forecast', readings: ['dew', 'uv'] }], 'a provider that failed this fetch');
  const dwdBase = Object.assign({}, PER_READING, { choices: { temperature: 'dwd', wind: 'dwd' } });
  assert.deepEqual(sourcePlan.partSteps(dwdBase, 'dwd', [], all),
    [{ provider: 'metno', ask: 'forecast', readings: ['dew', 'rain', 'windDir', 'uv', 'cloud', 'pressure', 'condition'] }],
    'the forecast\'s provider brings its own; Same as Weather is the Weather picker\'s');
  assert.deepEqual(sourcePlan.partSteps(dwdBase, 'metno', ['dwd'], all), [],
    'the temperature\'s provider failed: the Weather picker\'s brings everything');
  assert.deepEqual(sourcePlan.partSteps(Object.assign({}, input, { mode: 'auto' }), 'metno', [], all), []);
});

test('the fills follow each reading\'s own provider', () => {
  const feeds = Object.assign(sourcePlan.allFrom('yandex'), { cloud: 'dwd', uv: 'dwd' });
  assert.deepEqual(sourcePlan.fillSteps(feeds, true, ALL_DRAWN), [UV_FILL, GAP_FILL(['dew', 'windDir', 'pressure'])],
    'DWD\'s cloud cover is its own, its UV is filled, and Yandex\'s other gaps');
});
