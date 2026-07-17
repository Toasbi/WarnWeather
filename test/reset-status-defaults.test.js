const test = require('node:test');
const assert = require('node:assert/strict');
const { applyReset } = require('../src/pkjs/settings/reset-status-defaults.js');

const ENV_BASALT = { color: true, round: false, platform: 'basalt', health: true, radar: true };
const ENV_EMERY = { color: true, round: false, platform: 'emery', health: true, radar: true };

function blob(extra) {
  return Object.assign({
    healthMode: 'all', radarProvider: 'disabled',
    statusForecastLeft: 'temp', statusForecastMid: 'city', statusForecastRight: 'sun',
    statusRadarLeft: 'temp', statusRadarMid: 'city', statusRadarRight: 'sun',
    statusTopLeft: 'empty', statusTopMid: 'date', statusTopRight: 'empty',
    statusHealthLeft: 'steps', statusHealthMid: 'empty', statusHealthRight: 'sleep'
  }, extra || {});
}

test('radar enable flip resets the radar line and displaces precip slots to defaults', () => {
  const S = blob({
    radarProvider: 'rainbow',                    // new value already applied by the engine
    statusRadarLeft: 'uv',                       // customized radar line
    statusForecastLeft: 'precip_prob'            // precip needs radar OFF
  });
  applyReset(S, 'radar', 'disabled', 'rainbow', ENV_BASALT);
  assert.equal(S.statusRadarLeft, 'temp', 'radar line back to catalog defaults');
  assert.equal(S.statusRadarMid, 'city');
  assert.equal(S.statusRadarRight, 'sun');
  assert.equal(S.statusForecastLeft, 'temp', 'precip slot resets to ITS slot default');
});

test('scan reset falls back to empty when the slot default is already a sibling pick', () => {
  const S = blob({
    radarProvider: 'rainbow',
    statusForecastLeft: 'precip_prob',
    statusForecastMid: 'temp'                    // sibling already holds forecast-left's default
  });
  applyReset(S, 'radar', 'disabled', 'rainbow', ENV_BASALT);
  assert.equal(S.statusForecastLeft, 'empty', 'default taken by sibling -> empty');
});

test('provider-to-provider change is not a flip: no reset', () => {
  const S = blob({ radarProvider: 'dwd', statusRadarLeft: 'uv' });
  applyReset(S, 'radar', 'rainbow', 'dwd', ENV_BASALT);
  assert.equal(S.statusRadarLeft, 'uv', 'customization preserved');
});

test('health off flip clears displaced health items everywhere', () => {
  const S = blob({
    healthMode: 'off',
    statusForecastRight: 'sleep',                // health item outside the health line
    statusHealthLeft: 'hr'                       // customized health line
  });
  applyReset(S, 'health', 'all', 'off', ENV_BASALT);
  assert.equal(S.statusForecastRight, 'sun', 'displaced health item -> slot default');
  // own-line defaults are health items, unavailable while off -> empty
  assert.equal(S.statusHealthLeft, 'empty');
  assert.equal(S.statusHealthRight, 'empty');
});

test('health re-enable restores the health line defaults (emery flavor on emery)', () => {
  const S = blob({ healthMode: 'all', statusHealthLeft: 'empty', statusHealthMid: 'empty', statusHealthRight: 'empty' });
  applyReset(S, 'health', 'off', 'all', ENV_EMERY);
  assert.equal(S.statusHealthLeft, 'steps');
  assert.equal(S.statusHealthMid, 'sleep');
  assert.equal(S.statusHealthRight, 'hr');
});

test('status<->all is not a flip', () => {
  const S = blob({ healthMode: 'status', statusHealthLeft: 'hr' });
  applyReset(S, 'health', 'all', 'status', ENV_EMERY);
  assert.equal(S.statusHealthLeft, 'hr');
});
