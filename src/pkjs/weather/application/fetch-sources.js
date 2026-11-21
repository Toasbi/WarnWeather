// src/pkjs/weather/application/fetch-sources.js — ES5, watch runtime.
//
// One fetch's weather sources: the source plan (weather/domain/source-plan.js) for the
// Weather picker's provider, run in order. The anchor (that provider's instance, which the
// rest of the fetch chain reads: provider.js fetchWithCoordinates) gets its own forecast
// first, and its failure fails the fetch. Each fill then puts its reading on the anchor,
// aligned to the anchor's hours; a fill that fails leaves its reading empty, as a reading a
// provider does not send is everywhere.
//
// Each source's answer is kept as a forecast snapshot (weather/domain/forecast-snapshot.js):
// a fetch later in the same refresh slot reuses the anchor's instead of asking again, and
// DWD's UV fill is reused for 3 hours.
//
// The plan runs through ports (weather/adapter/source-ports.js create), so this file
// touches no runtime.

var sourcePlan = require('../domain/source-plan.js');
var forecastSnapshot = require('../domain/forecast-snapshot.js');

var HOUR_MS = 3600 * 1000;

/**
 * The fields of a snapshot a source may reuse for this fetch, re-anchored to `startEpoch`.
 * @param {Object} ports The sources' seams.
 * @param {Object} query forecastSnapshot.queryOf().
 * @param {number} startEpoch The hour the fetch starts at, epoch seconds.
 * @returns {?Object} The fields, or null: ask the source.
 */
function reusable(ports, query, startEpoch) {
    var entry = forecastSnapshot.find(ports.snapshots.load(), query, ports.now(), ports.refreshMs);
    return entry ? forecastSnapshot.reanchored(entry, startEpoch) : null;
}

/**
 * Keep what a source just answered.
 * @param {Object} ports The sources' seams.
 * @param {Object} query forecastSnapshot.queryOf().
 * @param {Object} anchor The provider the answer landed on.
 * @returns {void}
 */
function keep(ports, query, anchor) {
    var now = ports.now();
    ports.snapshots.save(forecastSnapshot.remember(ports.snapshots.load(),
        forecastSnapshot.snapshotOf(query, anchor, now), now));
}

// How each kind of fill runs, by the plan step's `ask`.
var FILLS = {
    // Open-Meteo's UV-only request into the anchor's uvTrend, aligned to its startTime.
    uv: function (ports, step, anchor, lat, lon, done) {
        var query = forecastSnapshot.queryOf(step.provider, 'uv', anchor, lat, lon);
        var fields = reusable(ports, query, anchor.startTime);
        if (fields) {
            anchor.uvTrend = fields.uvTrend;
            done();
            return;
        }
        ports.fillUv(anchor, lat, lon, function () {
            if (anchor.uvTrend.length) { keep(ports, query, anchor); }
            done();
        });
    }
};

/**
 * The anchor's own forecast: this refresh slot's snapshot when one matches, else its own
 * request (withProviderData), kept as the slot's snapshot.
 * @param {Object} anchor The Weather picker's provider.
 * @param {?Object} ports The sources' seams; null: always its own request, kept nowhere.
 * @param {number} lat Latitude.
 * @param {number} lon Longitude.
 * @param {boolean} force Whether this is a forced refresh (the anchor's withProviderData).
 * @param {Function} onSuccess Called once the anchor holds its forecast.
 * @param {Function} onFailure Called with the anchor's failure.
 * @returns {void}
 */
function ownForecast(anchor, ports, lat, lon, force, onSuccess, onFailure) {
    var query = ports ? forecastSnapshot.queryOf(anchor.id, 'forecast', anchor, lat, lon) : null;
    var fields = query ? reusable(ports, query, Math.floor(ports.now() / HOUR_MS) * 3600) : null;
    if (fields) {
        Object.keys(fields).forEach(function (key) { anchor[key] = fields[key]; });
        onSuccess();
        return;
    }
    anchor.withProviderData(lat, lon, force, function () {
        if (query) { keep(ports, query, anchor); }
        onSuccess();
    }, onFailure);
}

/**
 * Fetch every source the plan names, or reuse its snapshot, and put their readings on the
 * anchor.
 *
 * @param {Object} anchor The Weather picker's provider (provider.js), its options set for
 *   this fetch.
 * @param {?{fillUv: Function, now: function(): number, refreshMs: number,
 *   snapshots: {load: function(): Object[], save: function(Object[]): void}}} ports The
 *   sources' seams; null asks the anchor alone and keeps nothing (a provider no fetch
 *   cycle prepared, as in a test).
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
    ownForecast(anchor, ports, lat, lon, force, function () {
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
            FILLS[fills[i].ask](ports, fills[i], anchor, lat, lon, function () { next(i + 1); });
        }
        next(0);
    }, onFailure);
}

module.exports = { fetchSources: fetchSources };
