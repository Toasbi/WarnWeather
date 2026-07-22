// test/provider-factory.test.js
// Data-driven provider construction (Y1/G2/O4): adding a provider is a new
// table entry, not a dispatch edit, and construction is unit-testable apart
// from index.js's boot wiring.
const test = require('node:test');
const assert = require('node:assert/strict');
const providerFactory = require('../src/pkjs/provider-factory.js');

test('createProvider builds each known provider by id', () => {
  assert.equal(providerFactory.createProvider('wunderground', {}).id, 'wunderground');
  assert.equal(providerFactory.createProvider('dwd', {}).id, 'dwd');
  assert.equal(providerFactory.createProvider('openmeteo', {}).id, 'openmeteo');
  assert.equal(providerFactory.createProvider('openweathermap', { owmApiKey: 'KEY' }).id, 'openweathermap');
  assert.equal(providerFactory.createProvider('metno', {}).id, 'metno');
  assert.equal(providerFactory.createProvider('yandex', { yandexApiKey: 'KEY' }).id, 'yandex');
  assert.equal(providerFactory.createProvider('tomorrowio', { tomorrowioApiKey: 'KEY' }).id, 'tomorrowio');
});

test('createProvider passes the OWM API key from settings', () => {
  const p = providerFactory.createProvider('openweathermap', { owmApiKey: 'abc123' });
  assert.equal(p.apiKey, 'abc123');
});

test('createProvider passes the Yandex API key from settings', () => {
  const p = providerFactory.createProvider('yandex', { yandexApiKey: 'yk-999' });
  assert.equal(p.apiKey, 'yk-999');
});

test('createProvider builds tomorrowio and passes its API key from settings', () => {
  const p = providerFactory.createProvider('tomorrowio', { tomorrowioApiKey: 'tk-777' });
  assert.equal(p.id, 'tomorrowio');
  assert.equal(p.name, 'Tomorrow.io');
  assert.equal(p.apiKey, 'tk-777');
});

test('createProvider returns null for an unknown provider id', () => {
  assert.equal(providerFactory.createProvider('nope', {}), null);
});

test('isKnownProvider reflects the factory table', () => {
  assert.equal(providerFactory.isKnownProvider('dwd'), true);
  assert.equal(providerFactory.isKnownProvider('nope'), false);
});

test('DEFAULT_PROVIDER_ID is itself a known provider', () => {
  assert.equal(providerFactory.DEFAULT_PROVIDER_ID, 'wunderground');
  assert.equal(providerFactory.isKnownProvider(providerFactory.DEFAULT_PROVIDER_ID), true);
});
