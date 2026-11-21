'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const CD = require('../../../src/pkjs/settings/domain/country-defaults.js');

test('countryFromTimezone: known zones map, unknown -> null', () => {
  assert.equal(CD.countryFromTimezone('Europe/Berlin'), 'DE');
  assert.equal(CD.countryFromTimezone('Europe/Oslo'), 'NO');
  assert.equal(CD.countryFromTimezone('America/New_York'), 'US');
  assert.equal(CD.countryFromTimezone('Antarctica/Troll'), null);
  assert.equal(CD.countryFromTimezone(null), null);
});

test('countryFromLocale: region subtag or null', () => {
  assert.equal(CD.countryFromLocale('de-DE'), 'DE');
  assert.equal(CD.countryFromLocale('pt-BR'), 'BR');
  assert.equal(CD.countryFromLocale('en'), null);
  assert.equal(CD.countryFromLocale(''), null);
  assert.equal(CD.countryFromLocale(null), null);
});

test('mapCountry: providers + units + week-start + date format by country (US imperial, else metric)', () => {
  assert.deepEqual(CD.mapCountry('DE'), { provider: 'dwd', radarProvider: 'dwd', temperatureUnits: 'c', windUnits: 'kph', distanceUnits: 'metric', weekStartDay: 'mon', dateSlotFullFormat: 'auto' });
  assert.deepEqual(CD.mapCountry('NO'), { provider: 'metno', radarProvider: 'metno', temperatureUnits: 'c', windUnits: 'kph', distanceUnits: 'metric', weekStartDay: 'mon', dateSlotFullFormat: 'auto' });
  assert.deepEqual(CD.mapCountry('SE'), { provider: 'metno', radarProvider: 'metno', temperatureUnits: 'c', windUnits: 'kph', distanceUnits: 'metric', weekStartDay: 'mon', dateSlotFullFormat: 'auto' });
  assert.deepEqual(CD.mapCountry('US'), { provider: 'openmeteo', radarProvider: 'rainbow', temperatureUnits: 'f', windUnits: 'mph', distanceUnits: 'imperial', weekStartDay: 'sun', dateSlotFullFormat: 'slash' });
  assert.deepEqual(CD.mapCountry('GB'), { provider: 'openmeteo', radarProvider: 'rainbow', temperatureUnits: 'c', windUnits: 'kph', distanceUnits: 'metric', weekStartDay: 'mon', dateSlotFullFormat: 'auto' });
  assert.deepEqual(CD.mapCountry(null), { provider: 'openmeteo', radarProvider: 'rainbow', temperatureUnits: 'c', windUnits: 'kph', distanceUnits: 'metric', weekStartDay: 'mon', dateSlotFullFormat: 'auto' });
});

test('alpha2: a code mapCountry reads, from the reverse geocode\'s alpha-3 too', () => {
  assert.equal(CD.alpha2('DE'), 'DE');
  assert.equal(CD.alpha2('de'), 'DE');
  assert.equal(CD.alpha2('DEU'), 'DE');
  assert.equal(CD.alpha2('FRA'), null, 'a country with the pick for everyone else needs no entry');
  [null, undefined, '', 'D', 'DEUT', 42].forEach((code) => assert.equal(CD.alpha2(code), null, String(code)));
});

test('every country mapCountry picks a provider of its own for has its alpha-3 code', () => {
  // Every country the settings page offers (Holiday country's list).
  const schema = require('../../../src/pkjs/page/settings/schema.js');
  let countries = null;
  (function walk(o) {
    if (!o || typeof o !== 'object' || countries) { return; }
    if (Array.isArray(o)) { o.forEach(walk); return; }
    if (o.messageKey === 'holidayCountry') { countries = o.options.map((opt) => opt[1]).filter((cc) => cc !== 'none'); return; }
    Object.keys(o).forEach((k) => walk(o[k]));
  })(schema);
  assert.ok(countries.length > 100, 'the country list');
  const everyoneElse = CD.mapCountry(null).provider;
  const own = countries.filter((cc) => CD.mapCountry(cc).provider !== everyoneElse).sort();
  assert.deepEqual(own, ['DE', 'DK', 'FI', 'IS', 'NO', 'SE']);
  assert.deepEqual(['DEU', 'NOR', 'SWE', 'DNK', 'FIN', 'ISL'].map(CD.alpha2).sort(), own,
    'the reverse geocode names each by its alpha-3 code (ALPHA3)');
});
