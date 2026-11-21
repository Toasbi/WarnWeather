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

// Each kind of step (a plan step's `ask`): how it asks its source (run: it calls back with a
// failure value, or null once the source answered), and whether the anchor then holds what the
// kind brings (holds). A source's answer, or a stored snapshot, that does not hold it is none:
// `empty` is its failure code.
var ASKS = {
    forecast: {
        /**
         * The anchor's own request.
         * @param {Object} ports The source ports.
         * @param {Object} anchor The Weather picker's provider.
         * @param {number} lat Latitude.
         * @param {number} lon Longitude.
         * @param {boolean} force Whether this is a forced refresh.
         * @param {function(?Object): void} done Receives a failure value or null.
         * @returns {void}
         */
        run: function (ports, anchor, lat, lon, force, done) {
            anchor.withProviderData(lat, lon, force, function () {
                done(null);
            }, function (providerFailure) {
                done(providerFailure || failure('unknown_error'));
            });
        },
        /**
         * What the rest of the fetch can use (hasValidData: the core fields, a day's hours of
         * temperature and rain chance).
         * @param {Object} anchor The Weather picker's provider.
         * @returns {boolean}
         */
        holds: function (anchor) { return anchor.hasValidData(); },
        empty: 'invalid_data'
    },
    uv: {
        /**
         * Open-Meteo's UV-only request into the anchor's uvTrend, aligned to its startTime: it
         * always calls back, an answer it could not use leaving the UV empty. The UV is cleared
         * first, so what the anchor holds afterwards is the fill's alone.
         * @param {Object} ports The source ports.
         * @param {Object} anchor The Weather picker's provider.
         * @param {number} lat Latitude.
         * @param {number} lon Longitude.
         * @param {boolean} force Unused: a fill has no forced form.
         * @param {function(?Object): void} done Receives null.
         * @returns {void}
         */
        run: function (ports, anchor, lat, lon, force, done) {
            anchor.uvTrend = [];
            ports.fillUv(anchor, lat, lon, function () { done(null); });
        },
        /**
         * @param {Object} anchor The Weather picker's provider.
         * @returns {boolean} Whether it holds UV hours.
         */
        holds: function (anchor) { return Array.isArray(anchor.uvTrend) && anchor.uvTrend.length > 0; },
        empty: 'openmeteo_uv_empty'
    }
};

/**
 * The snapshots one fetch reads from, loaded once. A keep loads them again, since a source's
 * answer takes a network wait in which the store can change: Force weather fetch drops it, and
 * then nothing this fetch asked for before the drop is kept, so the fetch it forces asks again.
 * @param {Object} ports The source ports.
 * @returns {{entries: Object[], drops: number, keep: function(Object): void}}
 */
function storeOf(ports) {
    var loaded = ports.snapshots.load();
    var store = { entries: loaded.entries, drops: loaded.drops };
    /**
     * Keep a snapshot just taken, with the stored ones that still serve.
     * @param {Object} entry forecastSnapshot.snapshotOf().
     * @returns {void}
     */
    store.keep = function (entry) {
        var stored = ports.snapshots.load();
        if (stored.drops !== store.drops) { return; }
        store.entries = forecastSnapshot.remember(stored.entries, entry, ports.now(), ports.refreshMs);
        ports.snapshots.save({ entries: store.entries, drops: stored.drops });
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
    var ask = ASKS[step.ask];
    var query = forecastSnapshot.queryOf(step.provider, step.ask, anchor, lat, lon);
    var fields = forecastSnapshot.reuse(store.entries, query, ports.now(), ports.refreshMs, anchor);
    if (fields) {
        Object.assign(anchor, fields);
        // Only an answer that held is kept, so a snapshot that does not was damaged where it
        // was stored: the source is asked, and its answer replaces every field.
        if (ask.holds(anchor)) {
            done(null);
            return;
        }
    }
    ask.run(ports, anchor, lat, lon, force, function (stepFailure) {
        var outcome = stepFailure || (ask.holds(anchor) ? null : failure(ask.empty));
        if (!outcome && query) { store.keep(forecastSnapshot.snapshotOf(query, anchor, ports.now())); }
        done(outcome);
    });
}

/**
 * Run the plan's steps for the anchor, from snapshots where they serve.
 *
 * @param {Object} anchor The Weather picker's provider (provider.js), its options set for
 *   this fetch.
 * @param {{fillUv: function(Object, number, number, Function): void, now: function(): number,
 *   refreshMs: number, snapshots: {load: function(): {entries: Object[], drops: number},
 *   save: function({entries: Object[], drops: number}): void}}} ports The source ports.
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
