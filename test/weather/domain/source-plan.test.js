// test/weather/domain/source-plan.test.js — what a fetch asks for, in order: the Weather
// picker's provider's own forecast, which the fetch requires, then Open-Meteo for each reading
// that provider lacks while the watch draws it: its UV-only request, and one request for the
// rest.
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

const ALL_DRAWN = ['dew', 'windDir', 'uv', 'cloud', 'pressure'];
const GAP_FILL = (readings) => ({ provider: sourcePlan.FILL_PROVIDER, ask: 'readings', readings: readings });

test('every reading a provider lacks is UV or one the gap request brings', () => {
  providerFactory.PROVIDER_IDS.forEach((id) => {
    const lacks = providerReadings.READING_IDS.filter((r) => !providerReadings.serves(id, r));
    assert.deepEqual(lacks.filter((r) => r !== 'uv' && sourcePlan.GAP_READINGS.indexOf(r) === -1), [], id);
  });
});

test('Yandex\'s drawn readings come from one Open-Meteo request; those not drawn are not asked', () => {
  assert.deepEqual(sourcePlan.plan({ provider: 'yandex', fetchUv: true, drawn: ALL_DRAWN }).steps,
    [OWN('yandex'), GAP_FILL(['dew', 'windDir', 'cloud', 'pressure'])]);
  assert.deepEqual(sourcePlan.plan({ provider: 'yandex', fetchUv: false, drawn: ['pressure', 'cloud'] }).steps,
    [OWN('yandex'), GAP_FILL(['cloud', 'pressure'])], 'in the table\'s order');
  assert.deepEqual(sourcePlan.plan({ provider: 'yandex', fetchUv: true, drawn: ['uv'] }).steps, [OWN('yandex')],
    'Yandex sends its own UV');
  assert.deepEqual(sourcePlan.plan({ provider: 'yandex', fetchUv: true }).steps, [OWN('yandex')], 'nothing drawn');
});

test('a provider that sends a reading is never filled for it, drawn or not', () => {
  providerFactory.PROVIDER_IDS.forEach((id) => {
    const filled = sourcePlan.fills(id, true, ALL_DRAWN);
    assert.deepEqual(filled.filter((r) => providerReadings.serves(id, r)), [], id);
    assert.deepEqual(filled, providerReadings.READING_IDS.filter((r) => ALL_DRAWN.indexOf(r) !== -1
      && !providerReadings.serves(id, r)), id + ': every drawn reading it lacks');
  });
  assert.deepEqual(sourcePlan.plan({ provider: 'dwd', fetchUv: true, drawn: ALL_DRAWN }).steps, [OWN('dwd'), UV_FILL],
    'DWD lacks UV alone');
});

test('UV follows the fetch\'s own UV gate, not the drawn list', () => {
  assert.deepEqual(sourcePlan.fills('dwd', false, ['uv']), []);
  assert.deepEqual(sourcePlan.fills('dwd', true, []), ['uv']);
});
