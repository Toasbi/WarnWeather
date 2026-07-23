const test = require('node:test');
const assert = require('node:assert/strict');
const {
  applyReset,
  clearPollenForProvider,
  dedupeStatusSlot
} = require('../src/pkjs/settings/reset-status-defaults.js');

const ENV_BASALT = { color: true, round: false, platform: 'basalt', health: true, radar: true, hr: false };
const ENV_EMERY = { color: true, round: false, platform: 'emery', health: true, radar: true, hr: true };
const ENV_DIORITE = { color: false, round: false, platform: 'diorite', health: true, radar: true, hr: true };

function blob(extra) {
  return Object.assign({
    healthMode: 'all', radarProvider: 'disabled',
    statusForecastLeft: 'temp', statusForecastMid: 'city', statusForecastRight: 'aqi',
    statusRadarLeft: 'temp', statusRadarMid: 'wind', statusRadarRight: 'gust',
    statusTopLeft: 'week', statusTopMid: 'date', statusTopRight: 'sun',
    statusHealthLeft: 'steps', statusHealthMid: 'sleep', statusHealthRight: 'distance'
  }, extra || {});
}

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
  assert.equal(S.statusForecastRight, 'aqi', 'displaced health item -> slot default');
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

test('health re-enable restores hr on diorite (Pebble 2 is HR-capable)', () => {
  const S = blob({ healthMode: 'all', statusHealthLeft: 'empty', statusHealthMid: 'empty', statusHealthRight: 'empty' });
  applyReset(S, 'health', 'off', 'all', ENV_DIORITE);
  assert.equal(S.statusHealthRight, 'hr');
});

test('health re-enable restores steps/empty/sleep on a non-HR platform', () => {
  const S = blob({ healthMode: 'all', statusHealthLeft: 'empty', statusHealthMid: 'empty', statusHealthRight: 'empty' });
  applyReset(S, 'health', 'off', 'all', ENV_BASALT);
  assert.equal(S.statusHealthLeft, 'steps');
  assert.equal(S.statusHealthMid, 'empty');
  assert.equal(S.statusHealthRight, 'sleep');
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

test('switching weather provider keeps the tomorrow.io API key (never cleared on provider change)', () => {
  const S = blob({ provider: 'tomorrowio', tomorrowioApiKey: 'secret-key' });
  clearPollenForProvider(S, 'wunderground');
  assert.equal(S.tomorrowioApiKey, 'secret-key', 'the entered key survives switching to another provider');
  // ...and back again — still there (the field just hides via showWhen when unused).
  clearPollenForProvider(S, 'dwd');
  assert.equal(S.tomorrowioApiKey, 'secret-key');
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
