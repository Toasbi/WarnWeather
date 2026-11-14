'use strict';
// The data sources' credits their terms ask for, where the page shows their data and in
// Setup › Privacy & data sources (the store listing points there).
const test = require('node:test');
const assert = require('node:assert/strict');
const schema = require('../src/pkjs/page/settings/schema.js');
const walk = require('../src/pkjs/config-ui/lib/schema-walk.js');

/** @returns {Object[]} Every item of the schema. */
function items() {
  const out = [];
  walk.eachItem(schema, (item) => { out.push(item); });
  return out;
}
const byKey = (key) => items().find((i) => i.messageKey === key);

test('Tomorrow.io is credited wherever it can be picked', () => {
  assert.match(byKey('provider').hintByValue.tomorrowio, /Powered by <a [^>]*tomorrow\.io[^>]*>Tomorrow\.io<\/a>/);
  assert.match(byKey('radarSource').hintByValue.tomorrowio, /Powered by <a [^>]*tomorrow\.io[^>]*>Tomorrow\.io<\/a>/);
});

test('the air quality sources and the place search name their data', () => {
  const aqi = byKey('aqiSource').hintByValue;
  assert.match(aqi.openmeteo, /Copernicus Atmosphere Monitoring Service/);
  assert.match(aqi.waqi, /World Air Quality Index Project and the environmental agencies/);
  assert.match(aqi.auto, /Copernicus/);
  assert.match(aqi.auto, /World Air Quality Index Project/);
  assert.match(byKey('location').hint, /Search by <a [^>]*locationiq\.com[^>]*>LocationIQ\.com<\/a>/);
});

test('Setup lists the privacy summary and every data source with its licence', () => {
  const setup = schema.tabs.find((t) => t.id === 'setup');
  const texts = items().filter((i) => i.type === 'staticText' && typeof i.text === 'string').map((i) => i.text).join('\n');
  ['Open-Meteo.com', 'MET Norway', 'Deutscher Wetterdienst', 'OpenWeather', 'Tomorrow.io', 'Weather Underground',
    'Yandex Weather', 'Rainbow.ai', 'Copernicus Atmosphere Monitoring Service', 'World Air Quality Index Project',
    'powered by Esri', 'LocationIQ.com', 'GeoNames', 'Nager.Date', 'CC BY 4.0', '&copy; OpenWeather',
    'never sends your location'].forEach((name) => assert.ok(texts.indexOf(name) !== -1, name));
  assert.ok(setup.sections.some((s) => s.id === 'privacy'), 'the card sits in Setup');
});

test('the telemetry switch sits in Setup › Privacy & data sources, above what it sends, not in Misc', () => {
  const setup = schema.tabs.find((t) => t.id === 'setup');
  const privacy = setup.sections.find((s) => s.id === 'privacy');
  assert.equal(privacy.items[0].messageKey, 'telemetryEnabled', 'the card opens with the switch');
  assert.equal(privacy.items[0].defaultValue, true);
  const misc = setup.sections.find((s) => s.id === 'about');
  assert.ok(!misc.items.some((i) => i.messageKey === 'telemetryEnabled'), 'no longer in Misc');
});
