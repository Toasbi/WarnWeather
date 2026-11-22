// test/page/weather/weather-words.test.js — the words the settings page names the weather with:
// a sentence names each provider as the Weather picker does (its label, or DWD's short one), in
// the picker's order, and names every reading.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const words = require('../../../src/pkjs/page/weather/weather-words.js');
const { PROVIDER_OPTIONS } = require('../../../src/pkjs/page/weather/weather-sources-schema.js');
const providerReadings = require('../../../src/pkjs/weather/domain/provider-readings.js');

test('a sentence names each provider as the Weather picker does, in its order', () => {
  assert.deepEqual(Object.keys(words.NAMES).map((id) => [id, words.NAMES[id]]),
    PROVIDER_OPTIONS.map((o) => [o[1], (o[2] && o[2].short) || o[0]]));
});

test('every reading has its words', () => {
  assert.deepEqual(Object.keys(words.WORDS), providerReadings.READING_IDS);
});
