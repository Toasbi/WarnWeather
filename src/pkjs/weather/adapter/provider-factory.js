// src/pkjs/weather/adapter/provider-factory.js
//
// Data-driven weather-provider construction: PROVIDER_CONSTRUCTORS maps a Clay provider id to
// its adapter, and each is built with the API key from the setting the provider table names
// (weather/domain/provider-readings.js keySetting; a keyless adapter takes no argument).
// Adding a provider is a new entry here and a row in the table, with no dispatch to edit
// (Open/Closed), and construction is testable apart from index.js's boot wiring.

var WundergroundProvider = require('./providers/wunderground.js');
var OpenWeatherMapProvider = require('./providers/openweathermap.js');
var DwdProvider = require('./providers/dwd.js');
var OpenMeteoProvider = require('./providers/openmeteo.js').OpenMeteoProvider;
var MetnoProvider = require('./providers/metno.js').MetnoProvider;
var YandexProvider = require('./providers/yandex.js').YandexProvider;
var TomorrowIoProvider = require('./providers/tomorrowio.js').TomorrowIoProvider;
var providerReadings = require('../domain/provider-readings.js');

var DEFAULT_PROVIDER_ID = 'wunderground';

var PROVIDER_CONSTRUCTORS = {
    openweathermap: OpenWeatherMapProvider,
    dwd: DwdProvider,
    openmeteo: OpenMeteoProvider,
    metno: MetnoProvider,
    yandex: YandexProvider,
    tomorrowio: TomorrowIoProvider,
    wunderground: WundergroundProvider
};

/**
 * Whether a Clay provider id has a registered constructor.
 *
 * @param {string} providerId Clay provider id.
 * @returns {boolean} True when the id maps to a known provider.
 */
function isKnownProvider(providerId) {
    return Object.prototype.hasOwnProperty.call(PROVIDER_CONSTRUCTORS, providerId);
}

/**
 * Construct the weather provider for a Clay provider id, with its API key from the settings.
 * Unknown ids are not handled here — the caller decides how to correct and persist a
 * fallback.
 *
 * @param {string} providerId Clay provider id.
 * @param {Object} settings Clay settings.
 * @returns {Object|null} New provider instance, or null when the id is unknown.
 */
function createProvider(providerId, settings) {
    if (!isKnownProvider(providerId)) {
        return null;
    }
    var keySetting = providerReadings.keySetting(providerId);
    return new PROVIDER_CONSTRUCTORS[providerId](keySetting ? settings[keySetting] : undefined);
}

module.exports = {
    DEFAULT_PROVIDER_ID: DEFAULT_PROVIDER_ID,
    // Every registered provider id (tests walk them all).
    PROVIDER_IDS: Object.keys(PROVIDER_CONSTRUCTORS),
    isKnownProvider: isKnownProvider,
    createProvider: createProvider
};
