// src/pkjs/weather/adapter/source-ports.js — ES5, watch runtime.
//
// The ports the source plan runs through (weather/application/fetch-sources.js): what a fetch
// asks of providers other than the Weather picker's, and where every provider's last answer
// is kept (weather/adapter/forecast-snapshots.js). The fetch cycle (shell/fetch-cycle.js)
// gives a set to the provider before each fetch, beside its options; a provider without one
// fetches its own data alone and keeps nothing.

var openmeteo = require('./providers/openmeteo.js');
var forecastSnapshots = require('./forecast-snapshots.js');

/**
 * The sources one fetch may ask besides the Weather picker's provider.
 *
 * @param {?Object} settings Clay settings (fetchIntervalMin, the update interval).
 * @returns {{fillUv: function(Object, number, number, Function): void, now: function(): number,
 *   refreshMs: number, snapshots: {load: Function, save: Function}}} fillUv: Open-Meteo's
 *   UV-only request into a provider's uvTrend, aligned to its startTime (openmeteo.js
 *   fetchUvInto; it always calls back, a failure leaving the UV empty); now: the clock;
 *   refreshMs: the update interval, whose slot a forecast snapshot serves; snapshots: the
 *   store.
 */
function create(settings) {
    return {
        fillUv: openmeteo.fetchUvInto,
        now: function () { return Date.now(); },
        refreshMs: Number(settings && settings.fetchIntervalMin) * 60 * 1000,
        snapshots: forecastSnapshots
    };
}

module.exports = { create: create };
