// src/pkjs/weather/application/fetch-sources.js — ES5, watch runtime.
//
// One fetch's weather sources: the source plan (weather/domain/source-plan.js) for the
// Weather picker's provider, run in order. The anchor (that provider's instance, which the
// rest of the fetch chain reads: provider.js fetchWithCoordinates) fetches its own forecast
// first, and its failure fails the fetch. Each fill then puts its reading on the anchor,
// aligned to the anchor's hours; a fill that fails leaves its reading empty, as a reading a
// provider does not send is everywhere.
//
// The plan runs through ports (weather/adapter/weather-sources.js create), so this file
// touches no runtime.

var sourcePlan = require('../domain/source-plan.js');

// How each kind of fill runs, by the plan step's `ask`.
var FILLS = {
    // Open-Meteo's UV-only request into the anchor's uvTrend, aligned to its startTime.
    uv: function (ports, anchor, lat, lon, done) { ports.fillUv(anchor, lat, lon, done); }
};

/**
 * Fetch every source the plan names and put their readings on the anchor.
 *
 * @param {Object} anchor The Weather picker's provider (provider.js), its options set for
 *   this fetch.
 * @param {?{fillUv: function(Object, number, number, Function): void}} ports The sources'
 *   seams; null asks the anchor alone (a provider no fetch cycle prepared, as in a test).
 * @param {number} lat Latitude.
 * @param {number} lon Longitude.
 * @param {boolean} force Whether this is a forced refresh (the anchor's withProviderData).
 * @param {Function} onSuccess Called once every source has answered.
 * @param {Function} onFailure Called with the anchor's failure.
 * @returns {void}
 */
function fetchSources(anchor, ports, lat, lon, force, onSuccess, onFailure) {
    var plan = sourcePlan.plan({ provider: anchor.id, fetchUv: Boolean(anchor.options.fetchUv) });
    var fills = plan.steps.slice(1);
    anchor.withProviderData(lat, lon, force, function () {
        // The UV day record is kept per feed (day-peaks.js feedOf): the provider UV came from,
        // when that is not the anchor.
        anchor.uvFeedId = plan.readings.uv !== anchor.id ? plan.readings.uv : null;
        /**
         * Run fill i, then the ones after it.
         * @param {number} i The fill's index.
         * @returns {void}
         */
        function next(i) {
            if (i === fills.length || !ports) {
                onSuccess();
                return;
            }
            FILLS[fills[i].ask](ports, anchor, lat, lon, function () { next(i + 1); });
        }
        next(0);
    }, onFailure);
}

module.exports = { fetchSources: fetchSources };
