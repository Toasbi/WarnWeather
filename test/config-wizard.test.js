'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const W = require('../src/pkjs/settings/wizard.js');

test('countryFromTimezone: known zones map, unknown -> null', () => {
  assert.equal(W.countryFromTimezone('Europe/Berlin'), 'DE');
  assert.equal(W.countryFromTimezone('Europe/Oslo'), 'NO');
  assert.equal(W.countryFromTimezone('America/New_York'), 'US');
  assert.equal(W.countryFromTimezone('Antarctica/Troll'), null);
  assert.equal(W.countryFromTimezone(null), null);
});

test('countryFromLocale: region subtag or null', () => {
  assert.equal(W.countryFromLocale('de-DE'), 'DE');
  assert.equal(W.countryFromLocale('pt-BR'), 'BR');
  assert.equal(W.countryFromLocale('en'), null);
  assert.equal(W.countryFromLocale(''), null);
  assert.equal(W.countryFromLocale(null), null);
});

test('mapCountry: DE -> dwd, Nordic -> metno, else -> openmeteo/rainbow', () => {
  assert.deepEqual(W.mapCountry('DE'), { provider: 'dwd', radarProvider: 'dwd' });
  assert.deepEqual(W.mapCountry('NO'), { provider: 'metno', radarProvider: 'metno' });
  assert.deepEqual(W.mapCountry('SE'), { provider: 'metno', radarProvider: 'metno' });
  assert.deepEqual(W.mapCountry('US'), { provider: 'openmeteo', radarProvider: 'rainbow' });
  assert.deepEqual(W.mapCountry(null), { provider: 'openmeteo', radarProvider: 'rainbow' });
});

test('buildSteps: env gates radar and health', () => {
  assert.deepEqual(W.buildSteps({ radar: true, health: true }),
    ['welcome', 'layout', 'radar', 'health', 'done']);
  assert.deepEqual(W.buildSteps({ radar: false, health: false }),
    ['welcome', 'layout', 'done']);
  assert.deepEqual(W.buildSteps({ radar: true, health: false }),
    ['welcome', 'layout', 'radar', 'done']);
});

test('radarNearby: DWD only', () => {
  assert.equal(W.radarNearby('dwd'), true);
  assert.equal(W.radarNearby('metno'), false);
  assert.equal(W.radarNearby('rainbow'), false);
});

test('shouldShow: only on fresh, un-onboarded config', () => {
  assert.equal(W.shouldShow({}), true);
  assert.equal(W.shouldShow({ onboardingDone: true }), false);
  assert.equal(W.shouldShow({ provider: 'dwd' }), false);
  assert.equal(W.shouldShow(null), true);
});
