'use strict';
// The weather condition status slot's bake (status-lines.js iconFor and formatValue, through
// slot-text.js conditionLook and conditionText): the condition now, by day or night, as its
// name with its short form after the separator where the slot has the bytes (the watch swaps
// the short one in where the row would cut the name), the name alone or the short form where
// it does not, with the condition's glyph per the slot's Look.
const test = require('node:test');
const assert = require('node:assert/strict');
const catalog = require('../src/pkjs/status-line-catalog.js');
const lines = require('../src/pkjs/status-lines.js');
const C = require('../src/pkjs/weather/condition.js');
const { encodeSunEvents } = require('../src/pkjs/weather/sun-events.js');
const { decodeLine } = require('./helpers/status-line-bytes.js');

const SEP = catalog.ALT_SEP;
const LINE = catalog.lineById('forecast');
const BASALT = { platform: 'basalt', color: true };
const APLITE = { platform: 'aplite', color: false };

/**
 * SUN_EVENTS bytes for a sun event pair ahead of now: a sunset first (day now) or a sunrise
 * first (night now), 11 hours apart, or a polar pair (6 days apart), which reads the other way
 * round.
 * @param {boolean} night Night now.
 * @param {boolean} [polar] A polar pair.
 * @param {number} [aheadMs] How far ahead the first event is (negative: gone by).
 * @returns {number[]}
 */
function sun(night, polar, aheadMs) {
  const t = Math.floor(Date.now() / 1000) * 1000 + (aheadMs === undefined ? 3600000 : aheadMs);
  const gap = polar ? 6 * 86400000 : 40000000;
  // A polar night is a sunset then a sunrise; an ordinary night starts on the sunrise.
  const first = (night !== Boolean(polar)) ? 'sunrise' : 'sunset';
  const second = first === 'sunrise' ? 'sunset' : 'sunrise';
  return encodeSunEvents([{ type: first, date: new Date(t) }, { type: second, date: new Date(t + gap) }]);
}

/**
 * Bake the Forecast bar with the condition in every slot and read the three slots back.
 * @param {?string} cond CURRENT_CONDITION.
 * @param {Object} [over] Settings over the three condition slots.
 * @param {Object} [env] Platform env.
 * @param {boolean} [night] Night now.
 * @param {boolean} [polar] A polar sun event pair.
 * @returns {Array<{kind: number, icon: number, text: string}>}
 */
function bake(cond, over, env, night, polar) {
  const settings = Object.assign({ statusForecastLeft: 'condition', statusForecastMid: 'condition',
    statusForecastRight: 'condition' }, over || {});
  const payload = { CURRENT_CONDITION: cond, SUN_EVENTS: sun(Boolean(night), polar) };
  return decodeLine(lines.packLine(LINE, payload, settings, env || BASALT, null));
}

test('a sunny day: every slot carries the name and its short form, the line having the room', () => {
  const [left, mid, right] = bake('clear');
  assert.deepEqual(mid, { kind: catalog.KINDS.TEXT, icon: catalog.ICONS.COND_SUN, text: 'Sunny' + SEP + 'SUN' });
  assert.deepEqual(left, mid, 'an edge slot takes the middle\'s room where the line fits it');
  assert.deepEqual(right, left);
});

test('a clear night says Clear with the moon', () => {
  const [left, mid] = bake('clear', {}, BASALT, true);
  assert.equal(mid.text, 'Clear' + SEP + 'CLR');
  assert.equal(mid.icon, catalog.ICONS.COND_MOON);
  assert.equal(left.icon, catalog.ICONS.COND_MOON);
  assert.equal(bake('partly', {}, BASALT, true)[1].icon, catalog.ICONS.COND_MOON_CLOUD);
});

test('a sun event gone by since the forecast came flips it: the re-bake turns at sunset', () => {
  const bakeAt = (night, aheadMs) => decodeLine(lines.packLine(LINE,
    { CURRENT_CONDITION: 'clear', SUN_EVENTS: sun(night, false, aheadMs) },
    { statusForecastMid: 'condition' }, BASALT, null))[1];
  // Day when the forecast came, its sunset an hour ago: night now.
  assert.equal(bakeAt(false, -3600000).icon, catalog.ICONS.COND_MOON);
  assert.equal(bakeAt(false, -3600000).text, 'Clear' + SEP + 'CLR');
  // Night then, its sunrise gone by: day.
  assert.equal(bakeAt(true, -3600000).icon, catalog.ICONS.COND_SUN);
  // Both gone by (a sunset, then the next sunrise): day again.
  assert.equal(bakeAt(false, -50000000).icon, catalog.ICONS.COND_SUN);
  // A polar pair's events are no real sunset or sunrise: it never flips.
  const polar = decodeLine(lines.packLine(LINE, { CURRENT_CONDITION: 'clear', SUN_EVENTS: sun(true, true, -3600000) },
    { statusForecastMid: 'condition' }, BASALT, null))[1];
  assert.equal(polar.icon, catalog.ICONS.COND_MOON);
});

test('a polar pair reads the other way round: polar night has the moon, polar day the sun', () => {
  assert.equal(bake('clear', {}, BASALT, true, true)[1].icon, catalog.ICONS.COND_MOON);
  assert.equal(bake('clear', {}, BASALT, true, true)[1].text, 'Clear' + SEP + 'CLR');
  assert.equal(bake('clear', {}, BASALT, false, true)[1].icon, catalog.ICONS.COND_SUN);
  const noEvents = decodeLine(lines.packLine(LINE, { CURRENT_CONDITION: 'clear' },
    { statusForecastMid: 'condition' }, BASALT, null))[1];
  assert.equal(noEvents.icon, catalog.ICONS.COND_SUN, 'no sun events: day');
});

test('a name too long for an edge slot arrives there as its short form where the line is full', () => {
  // The middle's long name leaves the line no room for a second one: 22 + 22 + 8 > 48 bytes.
  const [left, mid] = bake('partly');
  assert.equal(mid.text, 'Partly cloudy' + SEP + 'PCLDY');
  assert.equal(left.text, 'PCLDY');
  assert.equal(left.icon, catalog.ICONS.COND_SUN_CLOUD);
  assert.equal(bake('thunder')[0].text, 'Thunderstorm' + SEP + 'TSTM', 'a shorter one leaves room for the left');
  assert.equal(bake('thunder')[2].text, 'TSTM', 'and none for the right');
  assert.equal(bake('freezing')[1].text, 'Freezing rain' + SEP + 'FZRA');
  assert.equal(bake('lightrain')[2].text, 'RAIN', 'light rain keeps the plain short form');
  assert.equal(bake('cloudy')[0].text, 'Cloudy' + SEP + 'CLDY', 'a name that fits takes its short form along');
});

// The owner's, 2026-11-14: beside an empty middle, or a short one, a side slot has the room for
// the whole name, so it gets the name with its short form (the watch swaps the short one in
// where the row cannot hold the name, and keeps a middle's text whole).
test('beside an empty or a short middle an edge slot gets the whole name with its short form', () => {
  const edges = (mid, over, env) => {
    const settings = Object.assign({ statusForecastLeft: 'condition', statusForecastMid: mid,
      statusForecastRight: 'condition' }, over || {});
    return decodeLine(lines.packLine(LINE, { CURRENT_CONDITION: 'partly', CURRENT_TEMP: 12,
      CITY: 'Mönchengladbach-Ost', SUN_EVENTS: sun(false) }, settings, env || BASALT, null));
  };
  const both = 'Partly cloudy' + SEP + 'PCLDY';
  let [left, mid, right] = edges('empty');
  assert.deepEqual([left.text, mid.text, right.text], [both, '', both], 'an empty middle: both edges, 47 bytes');
  [left, mid, right] = edges('temp');
  assert.deepEqual([left.text, right.text], [both, 'PCLDY'], 'a short middle: room for one, the left one');
  [left, mid, right] = edges('city');
  assert.deepEqual([left.text, right.text], ['PCLDY', 'PCLDY'], 'a long middle: no room');
  assert.ok(lines.packLine(LINE, { CURRENT_CONDITION: 'partly', SUN_EVENTS: sun(false) },
    { statusForecastLeft: 'condition', statusForecastMid: 'empty', statusForecastRight: 'condition' }, BASALT, null)
    .length <= catalog.CAPS.LINE_MAX, 'the line stays within its cap');
  // Full: the whole name with nothing to swap in; Short: the short form alone.
  assert.equal(edges('empty', { conditionSlotName: 'full' })[0].text, 'Partly cloudy');
  assert.equal(edges('empty', { conditionSlotName: 'short' })[0].text, 'PCLDY');
  // The Icon look has no name to widen, and aplite's lean row reads one form in an edge's 8 bytes.
  assert.equal(edges('empty', { conditionSlotLook: 'icon' })[0].text, '');
  assert.equal(edges('empty', {}, APLITE)[0].text, 'PCLDY');
});

test('a short form no shorter than the name rides with nothing', () => {
  assert.equal(bake('rain')[1].text, 'Rain');
  assert.equal(bake('snow')[1].text, 'Snow');
  assert.equal(bake('fog')[1].text, 'Fog');
});

test('Look: Text bakes the text-only id, Icon the glyph with no text', () => {
  const text = bake('partly', { conditionSlotLook: 'text' });
  text.forEach((s) => assert.equal(s.icon, catalog.ICONS.COND_TEXT));
  assert.equal(text[1].text, 'Partly cloudy' + SEP + 'PCLDY');
  const icon = bake('partly', { conditionSlotLook: 'icon' });
  icon.forEach((s) => {
    assert.equal(s.icon, catalog.ICONS.COND_SUN_CLOUD);
    assert.equal(s.text, '');
  });
  assert.deepEqual(bake('snow', { conditionSlotLook: 'junk' })[1].icon, catalog.ICONS.COND_SNOW, 'junk reads as Icon + text');
});

test('Name: Auto swaps in the short form, Full never sends one, Short sends it alone', () => {
  const auto = bake('partly');
  const full = bake('partly', { conditionSlotName: 'full' });
  const short = bake('partly', { conditionSlotName: 'short' });
  assert.equal(auto[1].text, 'Partly cloudy' + SEP + 'PCLDY', 'Auto (the default): name and short form');
  assert.equal(full[1].text, 'Partly cloudy', 'Full: the name with nothing to swap in');
  assert.equal(full[0].text, 'Partly cloudy', 'Full: the name in an edge slot too, where the line has the room');
  assert.equal(bake('cloudy', { conditionSlotName: 'full' })[0].text, 'Cloudy', 'Full: a name that fits stays whole');
  short.forEach((slot) => assert.equal(slot.text, 'PCLDY', 'Short: every slot'));
  assert.equal(bake('cloudy', { conditionSlotName: 'short' })[0].text, 'CLDY', 'Short: even where the name fits');
  assert.equal(bake('partly', { conditionSlotName: 'junk' })[1].text, auto[1].text, 'junk reads as Auto');
  // The name follows the Look: the Icon look prints no name at all.
  bake('partly', { conditionSlotName: 'full', conditionSlotLook: 'icon' }).forEach((slot) => assert.equal(slot.text, ''));
  // aplite reads no short form either way: the name where it fits, else the short form, and
  // the short form alone under Short.
  assert.equal(bake('clear', { conditionSlotName: 'short' }, APLITE)[1].text, 'SUN');
  assert.equal(bake('clear', { conditionSlotName: 'full' }, APLITE)[1].text, 'Sunny');
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
  assert.deepEqual(mid, { kind: catalog.KINDS.TEXT, icon: catalog.ICONS.COND_TEXT, text: 'PCLDY' });
  assert.equal(left.text, 'PCLDY');
  assert.equal(bake('clear', {}, APLITE)[1].text, 'Sunny');
  assert.equal(bake('drizzle', {}, APLITE)[1].text, 'Drizzle');
});

test('every condition arrives whole in every slot, by day and by night', () => {
  // packLine cuts a text to its slot's cap, so a form that did not fit would arrive cut.
  Object.keys(C.CONDITIONS).forEach((id) => [false, true].forEach((night) => {
    const n = C.names(id, night);
    const [left, mid] = bake(id, {}, BASALT, night);
    assert.ok([n.full + SEP + n.short, n.full].indexOf(mid.text) !== -1, id + ': ' + mid.text);
    assert.ok([n.full + SEP + n.short, n.full, n.short].indexOf(left.text) !== -1, id + ': an edge slot\'s forms, whole');
  }));
});

test('the bake reads CURRENT_CONDITION and SUN_EVENTS through SOURCE_KEYS', () => {
  assert.ok(lines.SOURCE_KEYS.indexOf('CURRENT_CONDITION') !== -1);
  assert.ok(lines.SOURCE_KEYS.indexOf('SUN_EVENTS') !== -1);
});

// The city slot draws the current weather's glyph before its name (citySlotIcon, on unless
// switched off): the glyph's id with the city's bit, so the watch keeps it the city's slot.
test('City: the current weather glyph with the city bit, unless switched off or on aplite', () => {
  const bakeCity = (cond, over, env, night) => decodeLine(lines.packLine(LINE,
    { CITY: 'Berlin', CURRENT_CONDITION: cond, SUN_EVENTS: sun(Boolean(night)) },
    Object.assign({ statusForecastLeft: 'city' }, over || {}), env || BASALT, null))[0];
  const day = bakeCity('partly');
  assert.equal(day.text, 'Berlin');
  assert.equal(day.icon, catalog.CITY_GLYPH | catalog.ICONS.COND_SUN_CLOUD, 'on by default, every install');
  assert.equal(bakeCity('partly', {}, BASALT, true).icon, catalog.CITY_GLYPH | catalog.ICONS.COND_MOON_CLOUD,
    'the night glyph at night');
  assert.equal(bakeCity('partly', { citySlotIcon: false }).icon, catalog.ICONS.NONE, 'switched off: no glyph');
  assert.equal(bakeCity(null).icon, catalog.ICONS.NONE, 'no condition known: no glyph');
  assert.equal(bakeCity('partly', {}, APLITE).icon, catalog.ICONS.NONE, 'aplite draws none');
  assert.ok(catalog.CITY_GLYPH > catalog.ICONS.COND_WIND, 'the bit sits above every id');
});
