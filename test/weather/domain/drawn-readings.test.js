// test/weather/domain/drawn-readings.test.js — which of the readings only some screens draw the
// watch draws: a forecast line (the shown graph styles' union on an emery sent their records),
// a status slot or a placed alert, and the wind and gust slots' arrows for the wind direction.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { NOTHING_PLACED, NOTHING_DRAWN, placeOn } = require('../../helpers/on-demand.js');
const drawnReadings = require('../../../src/pkjs/weather/domain/drawn-readings.js');
const providerReadings = require('../../../src/pkjs/weather/domain/provider-readings.js');
const platform = require('../../../src/pkjs/config-ui/lib/platform.js');

const BASALT = platform.computeEnv({ platform: 'basalt' });
const APLITE = platform.computeEnv({ platform: 'aplite' });
const EMERY = platform.computeEnv({ platform: 'emery' });
// No slot shows UV (a fresh install's radar bar and Watch bar do) and no alert is placed.
const NONE = NOTHING_DRAWN;

/**
 * @param {Object} over Settings over NONE.
 * @param {Object} [env] Platform env; a basalt by default.
 * @returns {string[]} What the watch draws.
 */
function drawn(over, env) { return drawnReadings.drawn(Object.assign({}, NONE, over), env || BASALT); }

test('the readings are provider-readings.js\'s, in its order; none drawn with nothing on screen', () => {
  assert.deepEqual(drawnReadings.READING_IDS,
    providerReadings.READING_IDS.filter((id) => drawnReadings.READING_IDS.indexOf(id) !== -1));
  assert.deepEqual(drawn({}), []);
  assert.deepEqual(drawnReadings.drawn(null, BASALT), [], 'no settings stored');
});

test('a forecast line draws its metric, the third and fourth metric lines only where the watch draws them', () => {
  assert.deepEqual(drawn({ secondaryLine: 'cloud', thirdLine: 'pressure' }), ['cloud', 'pressure']);
  assert.deepEqual(drawn({ fourthLine: 'cloud', fifthLine: 'uv' }), ['uv', 'cloud']);
  assert.deepEqual(drawn({ fourthLine: 'cloud', fifthLine: 'uv' }, APLITE), [], 'aplite draws two lines');
  assert.deepEqual(drawn({ thirdLine: 'cloud' }, APLITE), ['cloud']);
  assert.deepEqual(drawn({ secondaryLine: 'dew' }), ['dew']);
  assert.deepEqual(drawn({ secondaryLine: 'dew' }, APLITE), [], 'nor a temperature-axis line');
  assert.deepEqual(drawn({ secondaryLine: 'off', thirdLine: 'wind' }), []);
});

test('a status slot or a placed alert shows its metric', () => {
  assert.deepEqual(drawn({ statusForecastMid: 'dew', statusForecastRight: 'pressure' }), ['dew', 'pressure']);
  assert.deepEqual(drawn({ statusForecastMid: 'uv' }), ['uv']);
  assert.deepEqual(drawnReadings.drawn(placeOn(NONE, 'forecast', 'left', 'uv'), BASALT), ['uv'], 'the UV alert');
  assert.deepEqual(drawnReadings.drawn(placeOn(NONE, 'forecast', 'left', 'uv'), APLITE), [],
    'aplite has no On demand');
});

test('the wind and gust slots draw the wind direction where it is on, never on aplite', () => {
  const arrow = (over, env) => drawn(over, env).indexOf('windDir') !== -1;
  assert.equal(arrow({ statusTopMid: 'wind', windSlotDirection: true }), true);
  assert.equal(arrow({ statusTopMid: 'gust', gustSlotDirection: true }), true);
  assert.equal(arrow({ statusTopMid: 'wind', windSlotDirection: false, gustSlotDirection: true }), false,
    'the gust\'s arrow without a gust slot');
  assert.equal(arrow({ windSlotDirection: true }), false, 'no wind slot');
  assert.equal(arrow({ statusTopMid: 'wind', windSlotDirection: true }, APLITE), false);
});

test('on an emery sent graph styles\' records, a line of any shown style draws its metric', () => {
  const S = Object.assign({}, NONE, { layoutPreset: 'custom', radarMode: 'graph', healthMode: 'off', viewCount: '2',
    secondaryLine: 'precip_prob', thirdLine: 'off', fourthLine: 'off', fifthLine: 'off',
    graphStyles: JSON.stringify({ names: ['', 'Long'], styles: [null, { secondaryLine: 'precip_prob',
      thirdLine: 'pressure', fourthLine: 'off', fifthLine: 'off' }] }),
    viewTop0: 'cal', viewBody0: 'forecast', viewStyle0: '1', viewTop1: 'none', viewBody1: 'forecast', viewStyle1: '2' });
  const pressure = (settings) => drawnReadings.drawn(settings, EMERY).indexOf('pressure') !== -1;
  assert.equal(pressure(S), true, 'the second style\'s line');
  assert.equal(pressure(Object.assign({}, S, { viewStyle1: '1' })), false, 'no screen shows the second style');
});

