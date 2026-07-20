'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
// Populate global.PConf registries (engine) then register the statusSlotDefault resolver (blocks).
require('../src/pkjs/config-ui/lib/schema-walk.js');
require('../src/pkjs/config-ui/lib/color.js');
require('../src/pkjs/config-ui/lib/show-when.js');
const E = require('../src/pkjs/config-ui/lib/engine.js');
const { deriveDefaults } = require('../src/pkjs/config-ui/lib/defaults.js');
require('../src/pkjs/settings/blocks.js');                 // registers statusSlotDefault
const SCHEMA = require('../src/pkjs/settings/schema.js');

const ENV_EMERY = { color: true, round: false, platform: 'emery', health: true, radar: true, themePolarity: true, hr: true };
const ENV_BASALT = { color: true, round: false, platform: 'basalt', health: true, radar: true, themePolarity: true, hr: false };

test('real schema hydrates the HR-aware status-slot default set', () => {
  const emery = E.hydrate(SCHEMA, {}, ENV_EMERY);
  assert.equal(emery.statusForecastLeft, 'temp');
  assert.equal(emery.statusForecastMid, 'city');
  assert.equal(emery.statusForecastRight, 'aqi');
  assert.equal(emery.statusRadarLeft, 'temp');
  assert.equal(emery.statusRadarMid, 'wind');
  assert.equal(emery.statusRadarRight, 'gust');
  assert.equal(emery.statusTopLeft, 'week');
  assert.equal(emery.statusTopMid, 'date');
  assert.equal(emery.statusTopRight, 'sun');
  assert.equal(emery.statusHealthLeft, 'steps');
  assert.equal(emery.statusHealthMid, 'sleep');
  assert.equal(emery.statusHealthRight, 'hr', 'emery is HR-capable');

  const basalt = E.hydrate(SCHEMA, {}, ENV_BASALT);
  assert.equal(basalt.statusHealthRight, 'distance', 'non-HR platform -> distance');
});

test('real schema battery/bluetooth/week base defaults', () => {
  const s = E.hydrate(SCHEMA, {}, ENV_BASALT);
  assert.equal(s.batteryLowOnly, true);
  assert.equal(s.btIcons, 'disconnected');
  assert.equal(s.weekStartDay, 'mon');
});

test('deriveDefaults omits the 12 defaultFrom status-slot keys from the seed', () => {
  const seeded = deriveDefaults(SCHEMA);
  const slotKeys = [
    'statusForecastLeft', 'statusForecastMid', 'statusForecastRight',
    'statusRadarLeft', 'statusRadarMid', 'statusRadarRight',
    'statusTopLeft', 'statusTopMid', 'statusTopRight',
    'statusHealthLeft', 'statusHealthMid', 'statusHealthRight'
  ];
  slotKeys.forEach(function (key) {
    assert.equal(seeded[key], undefined, key + ' must not be seeded (defaultFrom is resolved at hydrate time)');
  });
  // A known static-default key IS present, proving the omission above is specific
  // to defaultFrom items rather than a broken/empty schema.
  assert.equal(seeded.weekStartDay, 'mon');
  assert.equal(seeded.batteryLowOnly, true);
});
