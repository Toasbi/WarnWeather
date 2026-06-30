const test = require('node:test');
const assert = require('node:assert/strict');
const color = require('../lib/color.js');
const platform = require('../lib/platform.js');
const defaults = require('../lib/defaults.js');

const FIXTURE = { tabs: [ { id: 't', label: 'T', sections: [ { title: 'S', items: [
  { type: 'select', messageKey: 'mode', defaultValue: 'a', options: [['A','a'],['B','b']] },
  { type: 'toggle', messageKey: 'flag', defaultValue: false },
  { type: 'color',  messageKey: 'tint', defaultValue: 0xFF0055 },
  { type: 'staticText' }
] } ] } ] };

test('color int<->hex round-trips; no padStart trap at 0', () => {
  [0, 0xFFFFFF, 0x0055AA, 0xFF0055].forEach((n) =>
    assert.equal(color.hexToInt(color.intToHex(n)), n, 'round-trip ' + n));
  assert.equal(color.intToHex(0), '#000000');
  assert.equal(color.intToHex(0x0055AA), '#0055AA');
});

test('isColorPlatform: 1-bit set is b&w, others (and unknown) color', () => {
  ['aplite','diorite','flint'].forEach((p) => assert.equal(platform.isColorPlatform(p), false, p));
  ['basalt','chalk','emery'].forEach((p) => assert.equal(platform.isColorPlatform(p), true, p));
  assert.equal(platform.isColorPlatform(''), true);
});

test('isHealthPlatform: only aplite lacks health; others (and unknown) have it', () => {
  assert.equal(platform.isHealthPlatform('aplite'), false);
  ['basalt','chalk','diorite','emery','flint'].forEach((p) => assert.equal(platform.isHealthPlatform(p), true, p));
  assert.equal(platform.isHealthPlatform(''), true);
});

test('computeEnv from watchInfo', () => {
  assert.deepEqual(platform.computeEnv({ platform: 'flint' }), { color: false, round: false, platform: 'flint', health: true });
  assert.deepEqual(platform.computeEnv({ platform: 'chalk' }), { color: true, round: true, platform: 'chalk', health: true });
  assert.deepEqual(platform.computeEnv({ platform: 'aplite' }), { color: false, round: false, platform: 'aplite', health: false });
  assert.deepEqual(platform.computeEnv(null), { color: true, round: false, platform: '', health: true });
});

test('deriveDefaults/deriveColorKeys are schema-driven (colors as ints)', () => {
  assert.deepEqual(defaults.deriveDefaults(FIXTURE), { mode: 'a', flag: false, tint: 0xFF0055 });
  assert.deepEqual(defaults.deriveColorKeys(FIXTURE), ['tint']);
});
