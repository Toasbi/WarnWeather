// src/pkjs/provider-factory.js
//
// Data-driven weather-provider construction. The PROVIDER_FACTORIES table maps
// a Clay provider id to a builder that constructs the provider from settings
// (e.g. the OpenWeatherMap API key). Adding a provider is a new table entry —
// no dispatch switch to edit (Open/Closed), and construction is testable apart
// from index.js's boot wiring.

var WundergroundProvider = require('./weather/wunderground.js');
var OpenWeatherMapProvider = require('./weather/openweathermap.js');
var DwdProvider = require('./weather/dwd.js');
var OpenMeteoProvider = require('./weather/openmeteo.js').OpenMeteoProvider;
var MetnoProvider = require('./weather/metno.js').MetnoProvider;
var YandexProvider = require('./weather/yandex.js').YandexProvider;

var DEFAULT_PROVIDER_ID = 'wunderground';

var PROVIDER_FACTORIES = {
    openweathermap: function(settings) { return new OpenWeatherMapProvider(settings.owmApiKey); },
    dwd: function(settings) { return new DwdProvider(); },
    openmeteo: function(settings) { return new OpenMeteoProvider(); },
    metno: function(settings) { return new MetnoProvider(); },
    yandex: function(settings) { return new YandexProvider(settings.yandexApiKey); },
    wunderground: function(settings) { return new WundergroundProvider(); }
};

/**
 * Whether a Clay provider id has a registered factory.
 *
 * @param {string} providerId Clay provider id.
 * @returns {boolean} True when the id maps to a known provider.
 */
function isKnownProvider(providerId) {
    return Object.prototype.hasOwnProperty.call(PROVIDER_FACTORIES, providerId);
}

/**
 * Construct the weather provider for a Clay provider id, using settings for
 * provider-specific arguments (e.g. the OWM API key). Unknown ids are not
 * handled here — the caller decides how to correct and persist a fallback.
 *
 * @param {string} providerId Clay provider id.
 * @param {Object} settings Clay settings.
 * @returns {Object|null} New provider instance, or null when the id is unknown.
 */
function createProvider(providerId, settings) {
    if (!isKnownProvider(providerId)) {
        return null;
    }
    return PROVIDER_FACTORIES[providerId](settings);
}

module.exports = {
    DEFAULT_PROVIDER_ID: DEFAULT_PROVIDER_ID,
    isKnownProvider: isKnownProvider,
    createProvider: createProvider
};
