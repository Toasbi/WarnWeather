'use strict';
// The weather condition status slot's bake (status-lines.js conditionSlot / conditionText): the
// condition now, by day or night, as its name with its short form after the separator where the
// slot has the bytes (the watch swaps the short one in where the row would cut the name), the
// name alone or the short form where it does not, with the condition's glyph per the slot's Look.
const test = require('node:test');
const assert = require('node:assert/strict');
const catalog = require('../src/pkjs/status-line-catalog.js');
const lines = require('../src/pkjs/status-lines.js');

const SEP = '\u001f';
const LINE = catalog.lineById('forecast');
const BASALT = { platform: 'basalt', color: true };
const APLITE = { platform: 'aplite', color: false };

/**
 * SUN_EVENTS bytes for a pair starting on a sunset (day now) or a sunrise (night now).
 * @param {boolean} night Whether it is night.
 * @returns {number[]}
 */
function sun(night) {
  const t = 1780315200;
  const bytes = [night ? 0 : 1];
  [t, t + 40000].forEach((v) => { for (let i = 0; i < 4; i++) { bytes.push((v >> (8 * i)) & 0xff); } });
  return bytes;
}

/**
 * Bake the Forecast bar with the condition in every slot and read the three slots back.
 * @param {?string} cond CURRENT_CONDITION.
 * @param {Object} [over] Settings over the three condition slots.
 * @param {Object} [env] Platform env.
 * @param {boolean} [night] Night now.
 * @returns {Array<{kind: number, icon: number, text: string}>}
 */
function bake(cond, over, env, night) {
  const settings = Object.assign({ statusForecastLeft: 'condition', statusForecastMid: 'condition',
    statusForecastRight: 'condition' }, over || {});
  const payload = { CURRENT_CONDITION: cond, SUN_EVENTS: sun(Boolean(night)) };
  const bytes = lines.packLine(LINE, payload, settings, env || BASALT, null);
  const out = [];
  let i = 0;
  while (i < bytes.length) {
    const len = bytes[i + 2];
    out.push({ kind: bytes[i], icon: bytes[i + 1], text: Buffer.from(bytes.slice(i + 3, i + 3 + len)).toString('utf8') });
    i += 3 + len;
  }
  return out;
}

test('a sunny day: the middle slot carries the name and its short form, the edges the name', () => {
  const [left, mid, right] = bake('clear');
  assert.deepEqual(mid, { kind: catalog.KINDS.TEXT, icon: catalog.ICONS.COND_SUN, text: 'Sunny' + SEP + 'SUN' });
  assert.deepEqual(left, { kind: catalog.KINDS.TEXT, icon: catalog.ICONS.COND_SUN, text: 'Sunny' });
  assert.deepEqual(right, left);
});

test('a clear night says Clear with the moon', () => {
  const [left, mid] = bake('clear', {}, BASALT, true);
  assert.equal(mid.text, 'Clear' + SEP + 'CLR');
  assert.equal(mid.icon, catalog.ICONS.COND_MOON);
  assert.equal(left.icon, catalog.ICONS.COND_MOON);
  assert.equal(bake('partly', {}, BASALT, true)[1].icon, catalog.ICONS.COND_MOON_CLOUD);
});

test('a name too long for an edge slot arrives there as its short form', () => {
  const [left, mid] = bake('partly');
  assert.equal(mid.text, 'Partly cloudy' + SEP + 'PCLD');
  assert.equal(left.text, 'PCLD');
  assert.equal(left.icon, catalog.ICONS.COND_SUN_CLOUD);
  assert.equal(bake('thunder')[0].text, 'TSTM');
  assert.equal(bake('freezing')[1].text, 'Freezing rain' + SEP + 'FZRA');
  assert.equal(bake('lightrain')[2].text, 'RAIN', 'light rain keeps the plain short form');
  assert.equal(bake('cloudy')[0].text, 'Cloudy', 'a name that fits an edge slot stays whole there');
});

test('a short form no shorter than the name rides with nothing', () => {
  assert.equal(bake('rain')[1].text, 'Rain');
  assert.equal(bake('snow')[1].text, 'Snow');
  assert.equal(bake('fog')[1].text, 'Fog');
});

test('Look: Text bakes the text-only id, Icon the glyph with no text', () => {
  const text = bake('partly', { conditionSlotLook: 'text' });
  text.forEach((s) => assert.equal(s.icon, catalog.ICONS.COND_TEXT));
  assert.equal(text[1].text, 'Partly cloudy' + SEP + 'PCLD');
  const icon = bake('partly', { conditionSlotLook: 'icon' });
  icon.forEach((s) => {
    assert.equal(s.icon, catalog.ICONS.COND_SUN_CLOUD);
    assert.equal(s.text, '');
  });
  assert.deepEqual(bake('snow', { conditionSlotLook: 'junk' })[1].icon, catalog.ICONS.COND_SNOW, 'junk reads as Icon + text');
});

test('no condition known: -- with the text-only id, in every look', () => {
  ['both', 'text', 'icon'].forEach((look) => [null, undefined, 'nope'].forEach((cond) => {
    bake(cond, { conditionSlotLook: look }).forEach((s) => {
      assert.equal(s.text, '--', look + ' ' + cond);
      assert.equal(s.icon, catalog.ICONS.COND_TEXT, look + ' ' + cond);
    });
  }));
});

test('aplite: text only, with no short form riding along (its lean row reads none)', () => {
  const [left, mid] = bake('partly', { conditionSlotLook: 'icon' }, APLITE);
  assert.deepEqual(mid, { kind: catalog.KINDS.TEXT, icon: catalog.ICONS.COND_TEXT, text: 'PCLD' });
  assert.equal(left.text, 'PCLD');
  assert.equal(bake('clear', {}, APLITE)[1].text, 'Sunny');
  assert.equal(bake('drizzle', {}, APLITE)[1].text, 'Drizzle');
});

test('every condition fits every slot, by day and by night', () => {
  const C = require('../src/pkjs/weather/condition.js');
  Object.keys(C.CONDITIONS).forEach((id) => [false, true].forEach((night) => {
    const [left, mid] = bake(id, {}, BASALT, night);
    assert.ok(Buffer.byteLength(mid.text) <= catalog.CAPS.MID_TEXT_MAX, id);
    assert.ok(Buffer.byteLength(left.text) <= catalog.CAPS.EDGE_TEXT_MAX, id);
    assert.equal(left.text.indexOf(SEP), -1, id + ': an edge slot carries one form');
  }));
});

test('formatValue reads the full name, and the bake reads CURRENT_CONDITION through SOURCE_KEYS', () => {
  assert.equal(lines.formatValue('condition', { CURRENT_CONDITION: 'hail', SUN_EVENTS: sun(false) }, {}), 'Hail');
  assert.equal(lines.formatValue('condition', {}, {}), '--');
  assert.ok(lines.SOURCE_KEYS.indexOf('CURRENT_CONDITION') !== -1);
  assert.ok(lines.SOURCE_KEYS.indexOf('SUN_EVENTS') !== -1);
});
