'use strict';
// slot-text.js wireKind: the kind a slot's item packs as. The bake packs by it
// (status-lines.js packLine) and the settings page counts a slot's bytes by it, so the two
// agree on which items carry text.
const test = require('node:test');
const assert = require('node:assert/strict');
const catalog = require('../../../src/pkjs/status-bars/domain/status-line-catalog.js');
const slotText = require('../../../src/pkjs/status-bars/domain/slot-text.js');

const K = catalog.KINDS;
const BASALT = { platform: 'basalt' };
const APLITE = { platform: 'aplite' };
/** The kind `code` packs as. */
const kindOf = (code, settings, env) => slotText.wireKind(code, catalog.byCode(code), settings, env);

test('most items pack as their catalog kind, whatever the settings', () => {
  ['temp', 'city', 'uv', 'steps', 'hr', 'sleep', 'date', 'phoneBattery', 'empty'].forEach((code) => {
    assert.equal(kindOf(code, { distanceUnits: 'imperial', batterySlotLook: 'text' }, BASALT),
      catalog.byCode(code).kind, code);
    assert.equal(kindOf(code, {}, APLITE), catalog.byCode(code).kind, code + ' on aplite');
  });
});

test('distance packs its unit: kilometres, or miles under imperial units', () => {
  assert.equal(kindOf('distance', {}, BASALT), K.LIVE_DISTANCE);
  assert.equal(kindOf('distance', { distanceUnits: 'metric' }, BASALT), K.LIVE_DISTANCE);
  assert.equal(kindOf('distance', { distanceUnits: 'imperial' }, BASALT), K.LIVE_DISTANCE_MI);
  assert.equal(kindOf('distance', null, BASALT), K.LIVE_DISTANCE);
});

test('the watch battery packs its Look: the drawn battery, or its charge as text (never on aplite)', () => {
  assert.equal(kindOf('battery', {}, BASALT), K.LIVE_BATTERY);
  assert.equal(kindOf('battery', { batterySlotLook: 'icon' }, BASALT), K.LIVE_BATTERY);
  assert.equal(kindOf('battery', { batterySlotLook: 'text' }, BASALT), K.LIVE_BATTERY_PCT);
  assert.equal(kindOf('battery', { batterySlotLook: 'text' }, APLITE), K.LIVE_BATTERY);
  assert.equal(catalog.kindHasText(kindOf('battery', { batterySlotLook: 'text' }, BASALT)), true,
    'the Text look can carry the days left');
  assert.equal(catalog.kindHasText(kindOf('battery', {}, BASALT)), false);
});

test('the calendar week is the watch\'s to draw, but for aplite, where the phone bakes it as text', () => {
  assert.equal(kindOf('week', {}, BASALT), K.LIVE_WEEK);
  assert.equal(kindOf('week', {}, undefined), K.LIVE_WEEK, 'an unknown watch draws it itself');
  assert.equal(kindOf('week', {}, APLITE), K.TEXT);
});
