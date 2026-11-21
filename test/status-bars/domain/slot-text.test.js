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
  assert.equal(kindOf('battery', { batterySlotLook: 'nope' }, BASALT), K.LIVE_BATTERY, 'an unknown look is the Icon look');
  // Text and Icon + text both print the charge: the text's kind (the icon id tells them apart,
  // status-lines.js iconFor).
  ['text', 'both'].forEach((look) => {
    assert.equal(kindOf('battery', { batterySlotLook: look }, BASALT), K.LIVE_BATTERY_PCT, look);
    assert.equal(kindOf('battery', { batterySlotLook: look }, APLITE), K.LIVE_BATTERY, look + ' on aplite');
    assert.equal(catalog.kindHasText(kindOf('battery', { batterySlotLook: look }, BASALT)), true,
      look + ': the text can carry the days left');
  });
  assert.equal(catalog.kindHasText(kindOf('battery', {}, BASALT)), false);
});

test('the watch battery\'s Look reads its three values, the Icon look for anything else and on aplite', () => {
  assert.equal(slotText.batteryLook({}, BASALT), 'icon');
  assert.equal(slotText.batteryLook(null, BASALT), 'icon');
  assert.equal(slotText.batteryLook({ batterySlotLook: 'icon' }, BASALT), 'icon');
  assert.equal(slotText.batteryLook({ batterySlotLook: 'text' }, BASALT), 'text');
  assert.equal(slotText.batteryLook({ batterySlotLook: 'both' }, BASALT), 'both');
  assert.equal(slotText.batteryLook({ batterySlotLook: 'Both' }, BASALT), 'icon', 'stored values, not labels');
  assert.equal(slotText.batteryLook({ batterySlotLook: 'both' }), 'both', 'an unknown watch is not aplite');
  ['icon', 'text', 'both'].forEach((look) => {
    assert.equal(slotText.batteryLook({ batterySlotLook: look }, APLITE), 'icon', look + ' on aplite');
  });
});

test('the calendar week is the watch\'s to draw, but for aplite, where the phone bakes it as text', () => {
  assert.equal(kindOf('week', {}, BASALT), K.LIVE_WEEK);
  assert.equal(kindOf('week', {}, undefined), K.LIVE_WEEK, 'an unknown watch draws it itself');
  assert.equal(kindOf('week', {}, APLITE), K.TEXT);
});
