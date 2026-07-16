const test = require('node:test');
const assert = require('node:assert');
const catalog = require('../src/pkjs/status-line-catalog.js');

const ENV_EMERY = { color: true, round: false, platform: 'emery', health: true, radar: true };
const ENV_BASALT = { color: true, round: false, platform: 'basalt', health: true, radar: true };
const ENV_APLITE = { color: false, round: false, platform: 'aplite', health: false, radar: false };

test('LINES describes 4 lines in wire order with fixed slots', () => {
  assert.deepEqual(catalog.LINES.map(l => l.id), ['forecast', 'radar', 'top', 'health']);
  assert.deepEqual(catalog.LINES.map(l => l.wireKey),
    ['STATUS_LINE_1_UINT8', 'STATUS_LINE_2_UINT8', 'STATUS_LINE_3_UINT8', 'STATUS_LINE_4_UINT8']);
  assert.equal(catalog.LINES[0].fixedMid, 'city');
  assert.equal(catalog.LINES[0].slots[1], null);
  assert.equal(catalog.LINES[2].fixedMid, 'date');
  assert.equal(catalog.LINES[2].slots[1], null);
  assert.equal(catalog.LINES[1].fixedMid, undefined);
  assert.equal(catalog.LINES[3].fixedMid, undefined);
});

test('defaults preserve today\'s watchface', () => {
  assert.deepEqual(catalog.LINES[0].defaults,
    { statusForecastLeft: 'temp', statusForecastRight: 'sun' });
  assert.deepEqual(catalog.LINES[1].defaults,
    { statusRadarLeft: 'temp', statusRadarMid: 'city', statusRadarRight: 'sun' });
  assert.deepEqual(catalog.LINES[2].defaults,
    { statusTopLeft: 'empty', statusTopRight: 'empty' });
  assert.deepEqual(catalog.LINES[3].defaults,
    { statusHealthLeft: 'steps', statusHealthMid: 'empty', statusHealthRight: 'sleep' });
  assert.deepEqual(catalog.LINES[3].emeryDefaults,
    { statusHealthLeft: 'steps', statusHealthMid: 'sleep', statusHealthRight: 'hr' });
});

test('availability gating', () => {
  const s = { healthMode: 'all', radarProvider: 'rainbow' };
  assert.ok(catalog.itemAvailable(catalog.byCode('temp'), s, ENV_BASALT));
  assert.ok(catalog.itemAvailable(catalog.byCode('steps'), s, ENV_BASALT));
  assert.ok(!catalog.itemAvailable(catalog.byCode('steps'), s, ENV_APLITE));
  assert.ok(!catalog.itemAvailable(catalog.byCode('steps'), { healthMode: 'off' }, ENV_BASALT));
  assert.ok(catalog.itemAvailable(catalog.byCode('hr'), s, ENV_EMERY));
  assert.ok(!catalog.itemAvailable(catalog.byCode('hr'), s, ENV_BASALT));
  assert.ok(!catalog.itemAvailable(catalog.byCode('precip_prob'), s, ENV_BASALT));
  assert.ok(catalog.itemAvailable(catalog.byCode('precip_prob'),
    { radarProvider: 'disabled' }, ENV_BASALT));
  // 'date' is fixed-only: never offered in a dropdown.
  assert.ok(!catalog.itemAvailable(catalog.byCode('date'), s, ENV_BASALT));
});

test('precipitation probability is unavailable without settings', () => {
  const item = catalog.byCode('precip_prob');
  assert.ok(!catalog.itemAvailable(item, undefined, ENV_BASALT));
});

test('precipitation probability is unavailable without a radar provider', () => {
  const item = catalog.byCode('precip_prob');
  assert.ok(!catalog.itemAvailable(item, {}, ENV_BASALT));
});

test('slotOptions: empty first, sibling selections and excluded codes removed', () => {
  const s = {
    healthMode: 'all', radarProvider: 'rainbow',
    statusForecastLeft: 'temp', statusForecastRight: 'sun'
  };
  const opts = catalog.slotOptions(s, ENV_BASALT,
    { excludeKeys: ['statusForecastRight'], excludeCodes: ['city'] });
  const codes = opts.map(o => o[1]);
  assert.equal(codes[0], 'empty');
  assert.ok(codes.includes('temp'));       // own current value is NOT excluded
  assert.ok(!codes.includes('sun'));       // sibling's selection excluded
  assert.ok(!codes.includes('city'));      // excludeCodes honored
  assert.ok(!codes.includes('hr'));        // env gate (basalt)
  assert.ok(!codes.includes('precip_prob')); // radar on
  assert.ok(!codes.includes('date'));      // fixed-only
});

test('selectedCodes falls back to line defaults for missing keys', () => {
  const codes = catalog.selectedCodes({ statusRadarMid: 'wind' });
  assert.equal(codes.length, 10);
  assert.ok(codes.includes('wind'));  // stored value wins
  assert.ok(codes.includes('temp'));  // forecast-left default
  assert.ok(codes.includes('sun'));
});

test('resolveSelection maps invalid/unavailable to empty without touching storage', () => {
  const s = { healthMode: 'all', radarProvider: 'rainbow' };
  assert.equal(catalog.resolveSelection('hr', s, ENV_BASALT), 'empty');
  assert.equal(catalog.resolveSelection('hr', s, ENV_EMERY), 'hr');
  assert.equal(catalog.resolveSelection('nonsense', s, ENV_EMERY), 'empty');
  assert.equal(catalog.resolveSelection('empty', s, ENV_EMERY), 'empty');
});

test('allSlotKeys lists the 10 configurable slot settings', () => {
  assert.deepEqual(catalog.allSlotKeys(), [
    'statusForecastLeft', 'statusForecastRight',
    'statusRadarLeft', 'statusRadarMid', 'statusRadarRight',
    'statusTopLeft', 'statusTopRight',
    'statusHealthLeft', 'statusHealthMid', 'statusHealthRight'
  ]);
});
