'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vocabulary = require('../lib/vocabulary');

// The `weather/location` names the plugin guide documents (Weather, under Categories). Renaming
// one breaks every watchface and the Pebble app's weather provider that read it.
const GUIDE_NAMES = [
  'name', 'temperature', 'feels_like', 'high', 'low', 'condition', 'condition_code', 'uv_index',
  'precipitation', 'humidity', 'wind_speed', 'wind_direction', 'utc_offset', 'sunrise', 'sunset',
  'hourly_temperature', 'hourly_condition', 'hourly_condition_code', 'daily_high', 'daily_low',
  'daily_condition', 'daily_condition_code', 'daily_precipitation', 'daily_sunrise', 'daily_sunset',
];

test('the standard names are exactly the guide\'s', () => {
  assert.deepEqual(Object.keys(vocabulary.STANDARD).sort(), GUIDE_NAMES.slice().sort());
});

test('extended names never shadow a standard one', () => {
  Object.keys(vocabulary.EXTENDED).forEach((name) => {
    assert.equal(Object.prototype.hasOwnProperty.call(vocabulary.STANDARD, name), false, name);
  });
});

test('every property has a known kind, a scope and (outside place) a field', () => {
  const scopes = ['place', 'current', 'today', 'hourly', 'daily'];
  vocabulary.ALL.forEach((name) => {
    const definition = vocabulary.PROPERTIES[name];
    assert.ok(vocabulary.KINDS[definition.kind], name + ' kind');
    assert.ok(scopes.indexOf(definition.scope) !== -1, name + ' scope');
    if (definition.scope !== 'place') {
      assert.equal(typeof definition.field, 'string', name + ' field');
    }
  });
});

test('series are exactly the hourly_* and daily_* names, declared as series shapes', () => {
  vocabulary.ALL.forEach((name) => {
    const series = /^(hourly|daily)_/.test(name);
    assert.equal(vocabulary.isSeries(name), series, name);
    vocabulary.shapesOf(name).forEach((shape) => {
      assert.equal(shape.indexOf('series.') === 0, series, name + ' ' + shape);
    });
  });
});

test('shapes match the guide where it names them, and what the app\'s weather provider reads', () => {
  assert.deepEqual(vocabulary.shapesOf('temperature'), ['shortText', 'longText', 'numericValue']);
  assert.deepEqual(vocabulary.shapesOf('condition_code'), ['longText']);
  assert.deepEqual(vocabulary.shapesOf('daily_condition_code'), ['series.longText']);
  assert.deepEqual(vocabulary.shapesOf('utc_offset'), ['numericValue']);
  assert.deepEqual(vocabulary.shapesOf('daily_sunrise'), ['series.timestamp', 'series.shortText']);
  assert.ok(vocabulary.shapesOf('wind_speed').indexOf('numericValue') !== -1);
  assert.ok(vocabulary.shapesOf('hourly_temperature').indexOf('series.numericValue') !== -1);
});

test('declare() keeps the given order and rejects an unknown name', () => {
  assert.deepEqual(Object.keys(vocabulary.declare(['sunset', 'name'])), ['sunset', 'name']);
  assert.throws(() => vocabulary.declare(['nope']), /unknown property nope/);
});
