const test = require('node:test');
const assert = require('node:assert/strict');
const {
  clearPollenForProvider,
  dedupeStatusSlot,
  resetCountdownDate,
  onDemandTick
} = require('../../../src/pkjs/page/status-bars/reset-status-defaults.js');

function todayValue() {
  const d = new Date();
  const pad2 = n => (n < 10 ? '0' : '') + n;
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

function blob(extra) {
  return Object.assign({
    healthMode: 'all', radarProvider: 'disabled', radarMode: 'off',
    statusForecastLeft: 'temp', statusForecastMid: 'city', statusForecastRight: 'aqi',
    statusRadarLeft: 'temp', statusRadarMid: 'wind', statusRadarRight: 'gust',
    statusTopLeft: 'week', statusTopMid: 'date', statusTopRight: 'sun',
    statusHealthLeft: 'steps', statusHealthMid: 'sleep', statusHealthRight: 'distance'
  }, extra || {});
}

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

test('dedupeStatusSlot: countdown may appear more than once on the same bar', () => {
  const S = blob({
    statusForecastLeft: 'countdown',
    statusForecastMid: 'countdown',
    statusForecastRight: 'countdown'
  });
  dedupeStatusSlot(S, 'statusForecastMid');
  assert.equal(S.statusForecastLeft, 'countdown');
  assert.equal(S.statusForecastMid, 'countdown');
  assert.equal(S.statusForecastRight, 'countdown');
});

test('dedupeStatusSlot: no sibling holds the code -> no change', () => {
  const S = blob({ statusForecastLeft: 'temp', statusForecastMid: 'city', statusForecastRight: 'sun' });
  dedupeStatusSlot(S, 'statusForecastMid');
  assert.equal(S.statusForecastLeft, 'temp');
  assert.equal(S.statusForecastRight, 'sun');
});

test('resetCountdownDate: selecting countdown over a stale stored date resets it to today', () => {
  const S = blob({ statusForecastLeft: 'countdown', statusForecastLeftCountdown: '2020-01-01' });
  resetCountdownDate(S, 'statusForecastLeft', 'temp', 'countdown');
  assert.equal(S.statusForecastLeftCountdown, todayValue());
});

test('resetCountdownDate: selecting countdown with no prior stored date sets today', () => {
  const S = blob({ statusForecastLeft: 'countdown' });
  resetCountdownDate(S, 'statusForecastLeft', 'temp', 'countdown');
  assert.equal(S.statusForecastLeftCountdown, todayValue());
});

test('resetCountdownDate: switching a slot away from countdown leaves its date field alone', () => {
  const S = blob({ statusForecastLeft: 'temp', statusForecastLeftCountdown: '2020-01-01' });
  resetCountdownDate(S, 'statusForecastLeft', 'countdown', 'temp');
  assert.equal(S.statusForecastLeftCountdown, '2020-01-01');
});

test('resetCountdownDate: switching between two non-countdown codes touches nothing', () => {
  const S = blob({ statusForecastLeft: 'city', statusForecastLeftCountdown: '2020-01-01' });
  resetCountdownDate(S, 'statusForecastLeft', 'temp', 'city');
  assert.equal(S.statusForecastLeftCountdown, '2020-01-01');
});

test('resetCountdownDate: already-countdown-to-countdown (no-op transition) leaves the date alone', () => {
  const S = blob({ statusForecastLeft: 'countdown', statusForecastLeftCountdown: '2020-01-01' });
  resetCountdownDate(S, 'statusForecastLeft', 'countdown', 'countdown');
  assert.equal(S.statusForecastLeftCountdown, '2020-01-01');
});

test('onDemandTick: a tick places the item on that side, off the bar\'s other side; an untick takes it off that side alone', () => {
  const S = { statusTopOnDemandLeftItems: 'bt,qt,snooze', statusTopOnDemandRightItems: 'battery,rain',
    statusForecastOnDemandRightItems: 'battery' };
  onDemandTick(S, 'statusTopOnDemandLeftItems', 'battery', true);
  assert.equal(S.statusTopOnDemandLeftItems, 'battery,bt,qt,snooze', 'in the priority order, not the tap order');
  assert.equal(S.statusTopOnDemandRightItems, 'rain', 'moved off the right');
  assert.equal(S.statusForecastOnDemandRightItems, 'battery', 'other bars keep it');
  onDemandTick(S, 'statusTopOnDemandLeftItems', 'battery', false);
  assert.equal(S.statusTopOnDemandLeftItems, 'bt,qt,snooze');
  assert.equal(S.statusTopOnDemandRightItems, 'rain', 'an untick moves nothing back');
  // Not a side list: nothing happens.
  const before = JSON.stringify(S);
  onDemandTick(S, 'statusTopLeft', 'battery', true);
  onDemandTick(S, 'statusTopLeft', 'rain', false);
  assert.equal(JSON.stringify(S), before);
});
