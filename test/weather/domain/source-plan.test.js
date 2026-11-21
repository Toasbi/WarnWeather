// test/weather/domain/source-plan.test.js — which provider serves each reading of a fetch, and
// what the fetch asks for: the Weather picker's provider serves what it sends, and DWD's UV
// comes from Open-Meteo's UV-only request while the screens draw it.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const sourcePlan = require('../../../src/pkjs/weather/domain/source-plan.js');
const providerReadings = require('../../../src/pkjs/weather/domain/provider-readings.js');

Object.keys(providerReadings.PROVIDERS).forEach((id) => {
  test(id + ' without UV drawn: its own forecast alone, each reading it sends its own', () => {
    const plan = sourcePlan.plan({ provider: id, fetchUv: false });
    assert.equal(plan.anchor, id);
    assert.deepEqual(plan.steps, [{ provider: id, ask: 'forecast', readings: providerReadings.PROVIDERS[id].readings }]);
    providerReadings.READING_IDS.forEach((reading) => {
      assert.equal(plan.readings[reading], providerReadings.serves(id, reading) ? id : null, reading);
    });
  });
});

test('DWD with UV drawn: its UV from Open-Meteo\'s UV-only request, after its own forecast', () => {
  const plan = sourcePlan.plan({ provider: 'dwd', fetchUv: true });
  assert.deepEqual(plan.steps, [
    { provider: 'dwd', ask: 'forecast', readings: providerReadings.PROVIDERS.dwd.readings },
    { provider: 'openmeteo', ask: 'uv', readings: ['uv'] }
  ]);
  assert.equal(plan.readings.uv, 'openmeteo');
  assert.equal(plan.readings.temperature, 'dwd');
});

test('a provider that sends UV gets no fill with UV drawn', () => {
  ['openmeteo', 'metno', 'openweathermap', 'tomorrowio', 'wunderground', 'yandex'].forEach((id) => {
    const plan = sourcePlan.plan({ provider: id, fetchUv: true });
    assert.equal(plan.steps.length, 1, id);
    assert.equal(plan.readings.uv, id, id);
  });
});

test('Yandex\'s other gaps stay empty: only UV is filled so far', () => {
  const plan = sourcePlan.plan({ provider: 'yandex', fetchUv: true });
  ['dew', 'windDir', 'cloud', 'pressure'].forEach((reading) => { assert.equal(plan.readings[reading], null, reading); });
});

test('a provider the table does not know is taken to send everything, with nothing filled', () => {
  const plan = sourcePlan.plan({ provider: 'interface', fetchUv: true });
  assert.deepEqual(plan.steps, [{ provider: 'interface', ask: 'forecast', readings: providerReadings.READING_IDS }]);
  providerReadings.READING_IDS.forEach((reading) => { assert.equal(plan.readings[reading], 'interface'); });
});
