// src/pkjs/weather/adapter/source-ports.js — ES5, watch runtime.
//
// The source ports: what the steps of a fetch's source plan run through
// (weather/application/fetch-sources.js). They ask providers other than the Weather picker's,
// and keep every provider's last answer (weather/adapter/forecast-snapshots.js). The fetch
// cycle builds a set for each fetch (shell/fetch-cycle.js prepareFetch), with its own clock
// and update interval, and hands it to fetchWithCoordinates.

var openmeteo = require('./providers/openmeteo.js');
var forecastSnapshots = require('./forecast-snapshots.js');
var providerFactory = require('./provider-factory.js');

/**
 * The source ports of one fetch.
 *
 * @param {function(): number} now The fetch cycle's clock, epoch ms.
 * @param {number} refreshMs The update interval in ms, whose refresh slot a forecast snapshot
 *   serves.
 * @param {?Object} settings The Clay settings: the API keys a provider is built with.
 * @param {Object} options This fetch's options (fetch-options.js), which every provider it
 *   asks reads.
 * @returns {{fillUv: function(Object, number, number, Function): void,
 *   fillReadings: function(Object, number, number, string[], Function): void,
 *   providerFor: function(string): Object, now: function(): number,
 *   refreshMs: number, snapshots: {load: Function, save: Function}}} fillUv: Open-Meteo's
 *   UV-only request into a provider's uvTrend, aligned to its startTime (openmeteo.js
 *   fetchUvInto; it always calls back, a failure leaving the UV empty); fillReadings:
 *   Open-Meteo's one request for the other readings a provider lacks, aligned the same way
 *   (fetchReadingsInto); providerFor: a new instance of another provider, with its key and
 *   this fetch's options; snapshots: the store.
 */
function create(now, refreshMs, settings, options) {
    var stored = settings || {};
    return {
        fillUv: openmeteo.fetchUvInto,
        fillReadings: openmeteo.fetchReadingsInto,
        providerFor: function (id) {
            var provider = providerFactory.createProvider(id, stored);
            provider.options = options;
            return provider;
        },
        now: now,
        refreshMs: refreshMs,
        snapshots: forecastSnapshots
    };
}

module.exports = { create: create };
