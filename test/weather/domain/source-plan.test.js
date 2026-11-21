// test/weather/domain/source-plan.test.js — what a fetch asks for, in order: the Weather
// picker's provider's own forecast, which the fetch requires, and Open-Meteo's UV-only request
// for a provider that sends no UV while the screens draw it.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const sourcePlan = require('../../../src/pkjs/weather/domain/source-plan.js');
const providerReadings = require('../../../src/pkjs/weather/domain/provider-readings.js');
const providerFactory = require('../../../src/pkjs/weather/adapter/provider-factory.js');

const OWN = (id) => ({ provider: id, ask: 'forecast', required: true });
const UV_FILL = { provider: sourcePlan.FILL_PROVIDER, ask: 'uv', feedField: 'uvFeedId' };

providerFactory.PROVIDER_IDS.forEach((id) => {
  test(id + ': its own forecast first, and the UV from Open-Meteo only when it sends none and UV is drawn', () => {
    assert.deepEqual(sourcePlan.plan({ provider: id, fetchUv: false }).steps, [OWN(id)]);
    assert.deepEqual(sourcePlan.plan({ provider: id, fetchUv: true }).steps,
      providerReadings.serves(id, 'uv') ? [OWN(id)] : [OWN(id), UV_FILL]);
  });
});

test('DWD is the provider that sends no UV, so its UV is filled', () => {
  assert.deepEqual(sourcePlan.plan({ provider: 'dwd', fetchUv: true }).steps, [OWN('dwd'), UV_FILL]);
});

test('a provider the table does not know sends nothing it names, so its drawn UV is filled too', () => {
  assert.deepEqual(sourcePlan.plan({ provider: 'interface', fetchUv: true }).steps, [OWN('interface'), UV_FILL]);
});
