'use strict';

// The DWD plugin's weather/location source: the shared vocabulary without UV, which DWD's open
// data through Bright Sky doesn't have. Places outside Germany and the countries around it are
// left out.

const vocabulary = require('../../lib/vocabulary');
const weatherSource = require('../../lib/weather-source');
const brightSky = require('./bright-sky');

/** Every standard and extended property but the UV index. */
const SERVES = vocabulary.ALL.filter((name) => !/(^|_)uv_index$/.test(name));

/**
 * The source handler.
 *
 * @param {Object} [overrides] Options to replace (tests pass a clock).
 * @returns {Function} (request, respond) => Promise<void>.
 */
function createSource(overrides) {
  return weatherSource.createWeatherSource(Object.assign({
    tag: 'dwd',
    label: 'Bright Sky (DWD)',
    host: 'api.brightsky.dev',
    serves: SERVES,
    covers: brightSky.covers,
    outsideMessage: 'DWD weather covers Germany and the countries around it only.',
    fetchForecast: brightSky.fetchForecast,
  }, overrides));
}

module.exports = { SERVES, createSource };
