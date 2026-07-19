const test = require('node:test');
const assert = require('node:assert/strict');
const {
  applyReset,
  clearPollenForProvider,
  dedupeStatusSlot
} = require('../src/pkjs/settings/reset-status-defaults.js');

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

test('switching to any non-DWD provider clears pollen from all 12 status slots', () => {
  const slotKeys = [
    'statusForecastLeft', 'statusForecastMid', 'statusForecastRight',
    'statusRadarLeft', 'statusRadarMid', 'statusRadarRight',
    'statusTopLeft', 'statusTopMid', 'statusTopRight',
    'statusHealthLeft', 'statusHealthMid', 'statusHealthRight'
  ];
  ['wunderground', 'openweathermap', 'openmeteo', 'metno'].forEach(provider => {
    const S = { provider: provider, healthMode: 'all', radarProvider: 'disabled' };
    slotKeys.forEach(key => { S[key] = 'pollen'; });

    clearPollenForProvider(S, provider);

    slotKeys.forEach(key => assert.equal(S[key], 'empty', provider + ': ' + key));
    assert.equal(S.provider, provider, 'provider remains unchanged');
    assert.equal(S.healthMode, 'all', 'unrelated setting remains unchanged');
    assert.equal(S.radarProvider, 'disabled', 'unrelated setting remains unchanged');
  });
});

test('switching to DWD leaves pollen selections and unrelated slots unchanged', () => {
  const S = blob({
    provider: 'dwd',
    statusForecastLeft: 'pollen',
    statusForecastMid: 'wind',
    statusTopLeft: 'uv'
  });

  clearPollenForProvider(S, 'dwd');

  assert.equal(S.statusForecastLeft, 'pollen');
  assert.equal(S.statusForecastMid, 'wind');
  assert.equal(S.statusTopLeft, 'uv');
});

test('dedupeStatusSlot: a same-line sibling holding the new code reverts to empty', () => {
  const S = blob({ statusForecastLeft: 'temp', statusForecastMid: 'temp' }); // user just set Mid to temp
  dedupeStatusSlot(S, 'statusForecastMid');
  assert.equal(S.statusForecastLeft, 'empty', 'the other slot holding temp cleared');
  assert.equal(S.statusForecastMid, 'temp', 'the just-picked slot is untouched');
});

test('dedupeStatusSlot: a slot on a different bar holding the same code is left alone', () => {
  const S = blob({ statusForecastMid: 'temp', statusRadarLeft: 'temp' });
  dedupeStatusSlot(S, 'statusForecastMid');
  assert.equal(S.statusRadarLeft, 'temp', 'cross-bar duplicate allowed');
});

test('dedupeStatusSlot: picking empty never clears a sibling', () => {
  const S = blob({ statusForecastLeft: 'empty', statusForecastMid: 'empty' });
  dedupeStatusSlot(S, 'statusForecastMid');
  assert.equal(S.statusForecastLeft, 'empty');
});

test('dedupeStatusSlot: no sibling holds the code -> no change', () => {
  const S = blob({ statusForecastLeft: 'temp', statusForecastMid: 'city', statusForecastRight: 'sun' });
  dedupeStatusSlot(S, 'statusForecastMid');
  assert.equal(S.statusForecastLeft, 'temp');
  assert.equal(S.statusForecastRight, 'sun');
});
