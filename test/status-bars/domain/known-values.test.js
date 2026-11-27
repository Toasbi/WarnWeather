'use strict';
// The plugin values WarnWeather knows (known-values.js): their names, the ones it supports (those
// with a start) and the Look and the icon a slot starts on for each. How the Value row lists them
// is plugin-value-page.test.js'.
const test = require('node:test');
const assert = require('node:assert/strict');
const known = require('../../../src/pkjs/status-bars/domain/known-values.js');
const pluginValues = require('../../../src/pkjs/status-bars/domain/plugin-values.js');

/** Values each read from a plugin known for them, which WarnWeather supports. */
const SUPPORTED = [['phone', 'phone_state', 'wifi'], ['weather', 'location', 'precipitation'],
  ['calendar', 'event', 'starts_at'], ['muninn', 'stats', 'batteryLife'], ['home', 'room_lights', 'on'],
  ['weather', 'netatmo', 'pressure'], ['weather', 'netatmo', 'temperature'], ['finance', 'stock', 'price'],
  ['tide', 'spot', 'next_high'], ['tide', 'spot', 'state']];

test('a value is known by its source\'s category and item and its property, all three', () => {
  assert.equal(known.nameOf('weather', 'location', 'precipitation'), 'Chance of precipitation');
  assert.equal(known.nameOf('garden', 'bed', 'precipitation'), null, 'another source\'s');
  assert.equal(known.nameOf('weather', 'location', 'hasOwnProperty'), null, 'no name of the table\'s own');
  assert.equal(known.nameOf('muninn', 'stats', 'daysRemaining'), 'Days left', 'a raw value with a name of its own');
  assert.equal(known.startOf('muninn', 'stats', 'daysRemaining'), null, 'which the Watch battery slot shows');
  SUPPORTED.forEach((v) => assert.notEqual(known.startOf(...v), null, v.join('/')));
});

test('supports names the values WarnWeather supports, by all three parts', () => {
  SUPPORTED.forEach((v) => assert.equal(known.supports(...v), true, v.join('/')));
  assert.equal(known.supports('muninn', 'stats', 'daysRemaining'), false, 'a raw value with a name of its own');
  assert.equal(known.supports('garden', 'bed', 'precipitation'), false, 'another source\'s');
  assert.equal(known.supports('weather', 'location', 'hasOwnProperty'), false, 'nothing of the table\'s own');
});

test('none of what changes by the minute, nor what WarnWeather draws itself, is supported', () => {
  [['phone', 'phone_state', 'battery_level'], ['music', 'track', 'title'],
    ['weather', 'location', 'temperature'], ['weather', 'location', 'condition'], ['weather', 'location', 'uv_index'],
    ['weather', 'location', 'wind_speed'], ['weather', 'location', 'sunrise'],
    ['weather', 'netatmo', 'wind_speed'], ['weather', 'netatmo', 'noise'], ['weather', 'netatmo', 'rain']].forEach((v) =>
    assert.equal(known.startOf(...v), null, v.join('/')));
});

test('a weather station\'s own readings are supported, and a share price, the owner\'s call', () => {
  assert.equal(known.nameOf('weather', 'netatmo', 'temperature'), 'Temperature');
  assert.equal(known.nameOf('weather', 'netatmo', 'co2'), 'CO\u2082');
  assert.equal(known.nameOf('weather', 'netatmo', 'rain_1h'), 'Rain in the last hour');
  assert.equal(known.nameOf('weather', 'netatmo', 'battery'), 'Module battery', 'a raw value: the module\'s, not the watch\'s');
  assert.equal(known.startOf('weather', 'netatmo', 'battery'), null);
  assert.equal(known.nameOf('finance', 'stock', 'price'), 'Share price');
  assert.equal(known.nameOf('finance', 'stock', 'day_change_percent'), 'Today\'s change in %');
  assert.equal(known.nameOf('finance', 'stock', 'day_change'), 'Today\'s change', 'raw, in money');
});

test('Tide\'s times are named as its estimates, and start beside the tide; its level changes too often', () => {
  assert.match(known.nameOf('tide', 'spot', 'next_high'), /^Next high tide .*estimate/);
  assert.match(known.nameOf('tide', 'spot', 'next_low'), /^Next low tide .*estimate/);
  ['next_high', 'next_low', 'state'].forEach((p) =>
    assert.deepEqual(known.startOf('tide', 'spot', p), { look: 'both', icon: 'tide' }, p));
  assert.equal(known.nameOf('tide', 'spot', 'level'), 'Tide level');
  assert.equal(known.startOf('tide', 'spot', 'level'), null, 'a raw value: a percent or so every four minutes');
});

test('each start is a Look and an icon the slot has, and an icon alone only one that turns', () => {
  Object.keys(known.SUPPORTED).map((key) => key.split('/')).forEach((v) => {
    assert.equal(v.length, 3, v.join('/'));
    const start = known.startOf(...v);
    assert.ok(start.look === undefined || pluginValues.LOOKS.includes(start.look), v.join('/'));
    assert.ok(start.icon === undefined || Object.keys(pluginValues.ICON_FORMS).includes(start.icon), v.join('/'));
    assert.ok(start.look !== 'icon' || pluginValues.turns(start.icon), v.join('/'));
  });
  assert.deepEqual(known.startOf('phone', 'phone_state', 'wifi'), { look: 'icon', icon: 'wifi' });
  assert.deepEqual(known.startOf('weather', 'location', 'precipitation'), { look: undefined, icon: undefined },
    'the text alone, where any slot starts');
});
