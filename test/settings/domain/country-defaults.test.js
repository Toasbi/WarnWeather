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
