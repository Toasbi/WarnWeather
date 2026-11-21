// src/pkjs/weather/application/fetch-sources.js — ES5, watch runtime.
//
// One fetch's weather sources: the source plan's steps (weather/domain/source-plan.js), run in
// order onto the Weather picker's provider (the anchor, the instance the rest of the fetch
// chain reads: provider.js fetchWithCoordinates). Each step reuses its source's forecast
// snapshot when one serves (weather/domain/forecast-snapshot.js), else asks the source and
// keeps a valid answer. A required step that fails fails the fetch; any other leaves its
// reading empty, as a reading a provider does not send is everywhere.
//
// The steps run through the source ports (weather/adapter/source-ports.js create, which the
// fetch cycle hands the provider: shell/fetch-cycle.js prepareFetch), so this file touches no
// runtime.

var sourcePlan = require('../domain/source-plan.js');
var forecastSnapshot = require('../domain/forecast-snapshot.js');

/**
 * A failure value, in the shape every fetch stage reports (weather/adapter/http.js failure).
 * @param {string} code The failure code.
 * @returns {{stage: string, code: string}}
 */
function failure(code) {
    return { stage: 'provider_data', code: code };
}

// How each kind of step asks its source: it calls back with a failure value, or null once the
// anchor holds what the step brings.
var ASK = {
    /**
     * The anchor's own request, and only an answer the rest of the fetch can use
     * (hasValidData: the core fields, a day's hours of temperature and rain chance).
     * @param {Object} ports The source ports.
     * @param {Object} anchor The Weather picker's provider.
     * @param {number} lat Latitude.
     * @param {number} lon Longitude.
     * @param {boolean} force Whether this is a forced refresh.
     * @param {function(?Object): void} done Receives a failure value or null.
     * @returns {void}
     */
    forecast: function (ports, anchor, lat, lon, force, done) {
        anchor.withProviderData(lat, lon, force, function () {
            done(anchor.hasValidData() ? null : failure('invalid_data'));
        }, function (providerFailure) {
            done(providerFailure || failure('unknown_error'));
        });
    },
    /**
     * Open-Meteo's UV-only request into the anchor's uvTrend, aligned to its startTime: it always
     * calls back, an answer it could not use leaving the UV empty. The UV is cleared first, so
     * what the anchor holds afterwards is the fill's alone.
     * @param {Object} ports The source ports.
     * @param {Object} anchor The Weather picker's provider.
     * @param {number} lat Latitude.
     * @param {number} lon Longitude.
     * @param {boolean} force Unused: a fill has no forced form.
     * @param {function(?Object): void} done Receives a failure value or null.
     * @returns {void}
     */
    uv: function (ports, anchor, lat, lon, force, done) {
        anchor.uvTrend = [];
        ports.fillUv(anchor, lat, lon, function () {
            done(anchor.uvTrend.length ? null : failure('openmeteo_uv_empty'));
        });
    }
};

/**
 * The snapshots one fetch reads from: loaded once, and loaded again before each keep, since a
 * source's answer takes a network wait in which the store can change (Force weather fetch
 * drops it).
 * @param {Object} ports The source ports.
 * @returns {{entries: Object[], keep: function(Object): void}}
 */
function storeOf(ports) {
    var store = { entries: ports.snapshots.load() };
    store.keep = function (entry) {
        store.entries = forecastSnapshot.remember(ports.snapshots.load(), entry, ports.now(), ports.refreshMs);
        ports.snapshots.save(store.entries);
    };
    return store;
}

/**
 * One plan step: its source's snapshot when one serves, else the source's own answer, kept.
 * @param {Object} store storeOf().
 * @param {Object} ports The source ports.
 * @param {{provider: string, ask: string}} step The plan step.
 * @param {Object} anchor The Weather picker's provider.
 * @param {number} lat Latitude.
 * @param {number} lon Longitude.
 * @param {boolean} force Whether this is a forced refresh.
 * @param {function(?Object): void} done Receives a failure value or null.
 * @returns {void}
 */
function runStep(store, ports, step, anchor, lat, lon, force, done) {
    var query = forecastSnapshot.queryOf(step.provider, step.ask, anchor, lat, lon);
    var fields = forecastSnapshot.reuse(store.entries, query, ports.now(), ports.refreshMs, anchor);
    if (fields) {
        Object.assign(anchor, fields);
        done(null);
        return;
    }
    ASK[step.ask](ports, anchor, lat, lon, force, function (stepFailure) {
        if (!stepFailure && query) { store.keep(forecastSnapshot.snapshotOf(query, anchor, ports.now())); }
        done(stepFailure);
    });
}

/**
 * Run the plan's steps for the anchor, from snapshots where they serve.
 *
 * @param {Object} anchor The Weather picker's provider (provider.js), its options set for
 *   this fetch.
 * @param {{fillUv: function(Object, number, number, Function): void, now: function(): number,
 *   refreshMs: number, snapshots: {load: function(): Object[], save: function(Object[]): void}}}
 *   ports The source ports.
 * @param {number} lat Latitude.
 * @param {number} lon Longitude.
 * @param {boolean} force Whether this is a forced refresh (the anchor's withProviderData).
 * @param {Function} onSuccess Called once every step has run: the anchor holds a valid forecast.
 * @param {Function} onFailure Called with a required step's failure.
 * @returns {void}
 */
function fetchSources(anchor, ports, lat, lon, force, onSuccess, onFailure) {
    var steps = sourcePlan.plan({ provider: anchor.id, fetchUv: Boolean(anchor.options.fetchUv) }).steps;
    var store = storeOf(ports);
    // The UV day record is kept per feed (day-peaks.js feedOf): the anchor's own unless a fill
    // brings its UV.
    anchor.uvFeedId = null;
    /**
     * Run step i, then the ones after it.
     * @param {number} i The step's index.
     * @returns {void}
     */
    function next(i) {
        if (i === steps.length) {
            onSuccess();
            return;
        }
        runStep(store, ports, steps[i], anchor, lat, lon, force, function (stepFailure) {
            if (stepFailure && steps[i].required) {
                onFailure(stepFailure);
                return;
            }
            if (!stepFailure && steps[i].feedField) { anchor[steps[i].feedField] = steps[i].provider; }
            next(i + 1);
        });
    }
    next(0);
}

module.exports = { fetchSources: fetchSources };
