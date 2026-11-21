// src/pkjs/weather/adapter/weather-sources.js — ES5, watch runtime.
//
// The ports the source plan runs through (weather/application/fetch-sources.js): what a fetch
// asks of providers other than the Weather picker's. The fetch cycle (shell/fetch-cycle.js)
// gives a set to the provider before each fetch, beside its options; a provider without one
// fetches only its own data.

var openmeteo = require('./providers/openmeteo.js');

/**
 * The sources one fetch may ask besides the Weather picker's provider.
 *
 * @returns {{fillUv: function(Object, number, number, Function): void}} fillUv: Open-Meteo's
 *   UV-only request into a provider's uvTrend, aligned to its startTime (openmeteo.js
 *   fetchUvInto; it always calls back, a failure leaving the UV empty).
 */
function create() {
    return { fillUv: openmeteo.fetchUvInto };
}

module.exports = { create: create };
