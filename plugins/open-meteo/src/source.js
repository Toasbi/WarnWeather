'use strict';

// The Open-Meteo plugin's weather/location source: every property of the shared vocabulary.

const vocabulary = require('../../lib/vocabulary');
const weatherSource = require('../../lib/weather-source');
const openMeteo = require('./open-meteo');

/** Every standard and extended property: Open-Meteo has them all. */
const SERVES = vocabulary.ALL.slice();

/**
 * The source handler.
 *
 * @param {Object} [overrides] Options to replace (tests pass a clock).
 * @returns {Function} (request, respond) => Promise<void>.
 */
function createSource(overrides) {
  return weatherSource.createWeatherSource(Object.assign({
    tag: 'open-meteo',
    label: 'Open-Meteo',
    host: 'api.open-meteo.com',
    serves: SERVES,
    fetchForecast: openMeteo.fetchForecast,
  }, overrides));
}

module.exports = { SERVES, createSource };
