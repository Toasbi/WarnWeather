// test/weather/domain/provider-readings.test.js — the table of what each provider serves
// (provider-readings.js) against the code it describes: the mapped-key vocabulary, the provider
// factory, and each adapter's own mapping and requests. Every provider fetches from
// test/helpers/provider-world.js, where only its own hosts answer (DWD's UV from Open-Meteo is
// refused, so DWD shows what it sends itself), with UV and the feels-like asked for.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const world = require('../../helpers/provider-world.js');
const readings = require('../../../src/pkjs/weather/domain/provider-readings.js');
const forecastModel = require('../../../src/pkjs/weather/domain/forecast-model.js');
const providerFactory = require('../../../src/pkjs/weather/adapter/provider-factory.js');

// The hosts each provider asks.
const HOSTS = {
  dwd: ['api.brightsky.dev'],
  openmeteo: ['api.open-meteo.com'],
  metno: ['api.met.no'],
  openweathermap: ['api.openweathermap.org'],
  tomorrowio: ['api.tomorrow.io'],
  wunderground: ['api.weather.com', 'www.wunderground.com'],
  yandex: ['api.weather.yandex.ru']
};

/**
 * One fetch of a provider's own data (withProviderData) in the world.
 * @param {string} id A provider id.
 * @param {boolean} withUv Whether the fetch asks for UV.
 * @returns {{provider: Object, outcome: string, requests: string[]}} The instance after it.
 */
function fetchOwn(id, withUv) {
  const own = (url) => HOSTS[id].indexOf(new URL(url).host) !== -1;
  return world.inWorld({ platform: 'basalt' }, ({ mod, requests }) => {
    // A key Weather Underground fetched before, so it asks only for the weather.
    localStorage.setItem(mod('settings/domain/storage-keys.js').WU_API_KEY, 'stored-key');
    const provider = mod('weather/adapter/provider-factory.js').createProvider(id, world.KEYS);
    provider.options = mod('weather/domain/fetch-options.js').defaults({ fetchUv: withUv, fetchFeels: true, dayPeakCodes: [] });
    let outcome = 'pending';
    provider.withProviderData(world.PLACE.lat, world.PLACE.lon, false,
      () => { outcome = 'ok'; }, (f) => { outcome = 'failed ' + JSON.stringify(f); });
    return { provider: provider, outcome: outcome, requests: requests.filter((r) => own(r.split(' ')[1])) };
  }, { answers: own });
}

/**
 * @param {*} value A field of a provider after its fetch.
 * @returns {boolean} Whether it holds a reading: a series with a non-zero number, or a value.
 */
function holdsReading(value) {
  if (Array.isArray(value)) { return value.some((x) => typeof x === 'number' && isFinite(x) && x !== 0); }
  return value !== null && value !== undefined;
}

test('every key a forecast keeps belongs to exactly one reading; startTime and the sun times to none', () => {
  const keys = [].concat.apply([], readings.READINGS.map((r) => r.keys));
  assert.equal(new Set(keys).size, keys.length, 'no key in two readings');
  assert.deepEqual(keys.slice().sort(),
    forecastModel.ADOPTED_KEYS.filter((k) => k !== 'startTime' && k !== 'sunTimes').sort(),
    'the feels-like inputs, which no forecast keeps, belong to none');
  assert.deepEqual(readings.READING_IDS, readings.READINGS.map((r) => r.id));
});

test('the table has a row for every provider the factory builds, and no other', () => {
  assert.deepEqual(Object.keys(readings.PROVIDERS).sort(), providerFactory.PROVIDER_IDS.slice().sort());
});

providerFactory.PROVIDER_IDS.forEach((id) => {
  test(id + ' sends exactly the readings its row lists', () => {
    const { provider, outcome } = fetchOwn(id, true);
    assert.equal(outcome, 'ok');
    const sent = readings.READING_IDS.filter((reading) => readings.keysOf(reading)
      .filter((k) => forecastModel.ADOPTED_KEYS.indexOf(k) !== -1)   // the fields the instance keeps
      .every((k) => holdsReading(provider[k])));
    assert.deepEqual(sent, readings.PROVIDERS[id].readings);
    readings.READING_IDS.forEach((r) => { assert.equal(readings.serves(id, r), sent.indexOf(r) !== -1, r); });
  });

  test(id + ' makes the requests its row counts, with and without UV', () => {
    [false, true].forEach((withUv) => {
      const { outcome, requests } = fetchOwn(id, withUv);
      assert.equal(outcome, 'ok');
      assert.equal(requests.length, readings.requests(id, withUv), 'UV ' + (withUv ? 'on' : 'off') + ':\n'
        + requests.join('\n'));
    });
  });

  test(id + ' takes its API key from the setting its row names', () => {
    const key = readings.keySetting(id);
    const settings = {};
    if (key) { settings[key] = 'the-key'; }
    assert.equal(providerFactory.createProvider(id, settings).apiKey, key ? 'the-key' : undefined);
  });
});

test('the settings page\'s key rows name the same key settings as the table, for the same providers', () => {
  const pageRows = require('../../../src/pkjs/page/weather/keys/key-sources.js').provider.sources;
  const keyed = providerFactory.PROVIDER_IDS.filter((id) => readings.keySetting(id));
  assert.deepEqual(Object.keys(pageRows).sort(), keyed.sort());
  keyed.forEach((id) => { assert.equal(pageRows[id].keyField, readings.keySetting(id), id); });
});

test('DWD covers Germany and its neighbours only; the others cover everywhere', () => {
  assert.equal(readings.covers('dwd', 52.52, 13.405), true, 'Berlin');
  assert.equal(readings.covers('dwd', 47.37, 8.54), true, 'Zurich');
  assert.equal(readings.covers('dwd', 55.68, 12.57), true, 'Copenhagen');
  assert.equal(readings.covers('dwd', 59.91, 10.75), false, 'Oslo, north of the box');
  assert.equal(readings.covers('dwd', 44.49, 11.34), false, 'Bologna, south of it');
  assert.equal(readings.covers('dwd', 48.86, 2.35), false, 'Paris, west of it');
  assert.equal(readings.covers('dwd', 47.50, 19.04), false, 'Budapest, east of it');
  providerFactory.PROVIDER_IDS.filter((id) => !readings.PROVIDERS[id].area).forEach((id) => {
    assert.equal(readings.covers(id, -33.87, 151.21), true, id + ' in Sydney');
  });
});

test('a provider the table does not know serves nothing and covers nothing', () => {
  ['', 'constructor', 'toString', undefined, null].forEach((id) => {
    assert.equal(readings.serves(id, 'temperature'), false);
    assert.equal(readings.keySetting(id), null);
    assert.equal(readings.covers(id, 52.52, 13.405), false);
    assert.equal(readings.requests(id, true), 0);
  });
  assert.deepEqual(readings.keysOf('humidity'), []);
});
