// src/pkjs/weather/application/fetch-sources.js — ES5, watch runtime.
//
// One fetch's weather sources: the source plan's steps (weather/domain/source-plan.js), onto
// the Weather picker's provider (the anchor, the instance the rest of the fetch chain reads:
// provider.js fetchWithCoordinates). The forecast comes from the first of the forecast step's
// providers that serves it: the anchor's own answer, or another provider's put on the anchor
// (By location). Then come the fills for that provider. Each step reuses its source's forecast
// snapshot when one serves (weather/domain/forecast-snapshot.js), else asks the source and
// keeps a valid answer. A forecast no provider serves fails the fetch; a fill that fails leaves
// its reading empty, as a reading a provider does not send is everywhere.
//
// The steps run through the source ports (weather/adapter/source-ports.js create, which the
// fetch cycle hands the provider: shell/fetch-cycle.js prepareFetch), so this file touches no
// runtime.

var sourcePlan = require('../domain/source-plan.js');
var forecastSnapshot = require('../domain/forecast-snapshot.js');
var providerReadings = require('../domain/provider-readings.js');
var forecastModel = require('../domain/forecast-model.js');

/**
 * A failure value, in the shape every fetch stage reports (weather/adapter/http.js failure).
 * @param {string} code The failure code.
 * @returns {{stage: string, code: string}}
 */
function failure(code) {
    return { stage: 'provider_data', code: code };
}

/**
 * Clear a fill's readings on the anchor first, so what it holds afterwards is the fill's alone.
 * @param {Object} anchor The Weather picker's provider.
 * @param {string[]} readings provider-readings.js READINGS ids whose keys are hourly series.
 * @returns {void}
 */
function clearReadings(anchor, readings) {
    readings.forEach(function (id) {
        providerReadings.keysOf(id).forEach(function (key) { anchor[key] = []; });
    });
}

/**
 * Whether the anchor holds hours of a reading: each of its series is a non-empty list.
 * @param {Object} anchor The Weather picker's provider.
 * @param {string} id A READINGS id whose keys are hourly series.
 * @returns {boolean}
 */
function holdsHours(anchor, id) {
    return providerReadings.keysOf(id).every(function (key) {
        return Array.isArray(anchor[key]) && anchor[key].length > 0;
    });
}

// Each kind of step (a plan step's `ask`): how it asks its source (run: it calls back with a
// failure value, or null once the source answered), and whether the anchor then holds what the
// kind brings (holds). A source's answer, or a stored snapshot, that does not hold it is none:
// `empty` is its failure code.
var ASKS = {
    forecast: {
        /**
         * A provider's own request.
         * @param {Object} ports The source ports.
         * @param {Object} step The plan step.
         * @param {Object} provider The provider asked: the anchor, or another provider's
         *   instance (By location).
         * @param {number} lat Latitude.
         * @param {number} lon Longitude.
         * @param {boolean} force Whether this is a forced refresh.
         * @param {function(?Object): void} done Receives a failure value or null.
         * @returns {void}
         */
        run: function (ports, step, provider, lat, lon, force, done) {
            provider.withProviderData(lat, lon, force, function () {
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
         * @param {Object} step The plan step.
         * @param {Object} anchor The Weather picker's provider.
         * @param {number} lat Latitude.
         * @param {number} lon Longitude.
         * @param {boolean} force Unused: a fill has no forced form.
         * @param {function(?Object): void} done Receives null.
         * @returns {void}
         */
        run: function (ports, step, anchor, lat, lon, force, done) {
            clearReadings(anchor, step.readings);
            ports.fillUv(anchor, lat, lon, function () { done(null); });
        },
        /**
         * @param {Object} anchor The Weather picker's provider.
         * @returns {boolean} Whether it holds UV hours.
         */
        holds: function (anchor) { return holdsHours(anchor, 'uv'); },
        empty: 'openmeteo_uv_empty'
    },
    readings: {
        /**
         * Open-Meteo's one request for the other readings the anchor lacks that the watch
         * draws (the step's `readings`), aligned to its startTime: it always calls back. They
         * are cleared first, like the UV.
         * @param {Object} ports The source ports.
         * @param {{readings: string[]}} step The plan step.
         * @param {Object} anchor The Weather picker's provider.
         * @param {number} lat Latitude.
         * @param {number} lon Longitude.
         * @param {boolean} force Unused: a fill has no forced form.
         * @param {function(?Object): void} done Receives null.
         * @returns {void}
         */
        run: function (ports, step, anchor, lat, lon, force, done) {
            clearReadings(anchor, step.readings);
            ports.fillReadings(anchor, lat, lon, step.readings, function () { done(null); });
        },
        /**
         * @param {Object} anchor The Weather picker's provider.
         * @param {{readings: string[]}} step The plan step.
         * @returns {boolean} Whether it holds hours of one of them at least: an answer without
         *   one (Open-Meteo has no dew point there) still brings the rest.
         */
        holds: function (anchor, step) {
            return step.readings.some(function (id) { return holdsHours(anchor, id); });
        },
        empty: 'openmeteo_readings_empty'
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
 * Put another provider's forecast on the anchor, as adoptMapped would: every field its answer
 * adopted (one it lacks is deleted, so hasValidData judges the anchor as it would the
 * provider), and a failure it recovered from, which telemetry reports once (provider.js
 * recoveredFailure).
 * @param {Object} anchor The Weather picker's provider.
 * @param {Object} source The provider that answered.
 * @returns {void}
 */
function adopt(anchor, source) {
    forecastModel.ADOPTED_KEYS.forEach(function (key) {
        if (Object.prototype.hasOwnProperty.call(source, key)) { anchor[key] = source[key]; }
        else { delete anchor[key]; }
    });
    if (source.recoveredFailure && !anchor.recoveredFailure) { anchor.recoveredFailure = source.recoveredFailure; }
}

/**
 * One plan step: its source's snapshot when one serves, else the source's own answer, kept.
 * What the step brings lands on the anchor. A forecast is asked of `source`, the instance of
 * the provider that answers (the anchor itself while it is the Weather picker's), and put on
 * the anchor (adopt); a fill is asked onto the anchor.
 * @param {Object} store storeOf().
 * @param {Object} ports The source ports.
 * @param {{provider: string, ask: string, readings: (string[]|undefined)}} step The plan step.
 * @param {Object} anchor The Weather picker's provider.
 * @param {Object} source The provider asked: the anchor, or another provider's instance.
 * @param {number} lat Latitude.
 * @param {number} lon Longitude.
 * @param {boolean} force Whether this is a forced refresh.
 * @param {function(?Object): void} done Receives a failure value or null.
 * @returns {void}
 */
function runStep(store, ports, step, anchor, source, lat, lon, force, done) {
    var ask = ASKS[step.ask];
    var query = forecastSnapshot.queryOf(step, source, lat, lon);
    var fields = forecastSnapshot.reuse(store.entries, query, ports.now(), ports.refreshMs, anchor);
    if (fields) {
        Object.assign(anchor, fields);
        // Only an answer that held is kept, so a snapshot that does not was damaged where it
        // was stored: the source is asked, and its answer replaces every field.
        if (ask.holds(anchor, step)) {
            done(null);
            return;
        }
    }
    ask.run(ports, step, source, lat, lon, force, function (stepFailure) {
        if (!stepFailure && source !== anchor) { adopt(anchor, source); }
        var outcome = stepFailure || (ask.holds(anchor, step) ? null : failure(ask.empty));
        if (!outcome && query) { store.keep(forecastSnapshot.snapshotOf(query, anchor, ports.now())); }
        done(outcome);
    });
}

/**
 * The forecast step: its providers in turn until one serves. A fetch a later provider saved
 * keeps the first failure as the anchor's recovered one (reported to telemetry once, never a
 * notice: shell/fetch-cycle.js); when every provider fails, the last one's failure fails the
 * fetch.
 * @param {Object} store storeOf().
 * @param {Object} ports The source ports (providerFor: another provider's instance).
 * @param {{ask: string, providers: string[]}} step sourcePlan.forecastStep().
 * @param {Object} anchor The Weather picker's provider.
 * @param {number} lat Latitude.
 * @param {number} lon Longitude.
 * @param {boolean} force Whether this is a forced refresh.
 * @param {function(string): void} onServed Receives the provider that served.
 * @param {function(Object): void} onFailure Receives the last provider's failure.
 * @returns {void}
 */
function runForecast(store, ports, step, anchor, lat, lon, force, onServed, onFailure) {
    var firstFailure = null;
    /**
     * Ask provider i, then the next while it fails.
     * @param {number} i Its index in step.providers.
     * @returns {void}
     */
    function attempt(i) {
        var id = step.providers[i];
        var source = id === anchor.id ? anchor : ports.providerFor(id);
        runStep(store, ports, { provider: id, ask: step.ask }, anchor, source, lat, lon, force, function (stepFailure) {
            if (!stepFailure) {
                if (firstFailure && !anchor.recoveredFailure) { anchor.recoveredFailure = firstFailure; }
                onServed(id);
                return;
            }
            firstFailure = firstFailure || stepFailure;
            if (i + 1 < step.providers.length) {
                attempt(i + 1);
                return;
            }
            onFailure(stepFailure);
        });
    }
    attempt(0);
}

/**
 * The fills, in order. A fill that fails leaves its readings empty, as a reading a provider
 * does not send is everywhere; one that brings them names its provider as their feed.
 * @param {Object} store storeOf().
 * @param {Object} ports The source ports.
 * @param {Object[]} steps sourcePlan.fillSteps().
 * @param {Object} anchor The Weather picker's provider.
 * @param {number} lat Latitude.
 * @param {number} lon Longitude.
 * @param {boolean} force Whether this is a forced refresh.
 * @param {Function} onDone Called once every fill has run.
 * @returns {void}
 */
function runFills(store, ports, steps, anchor, lat, lon, force, onDone) {
    /**
     * Run fill i, then the ones after it.
     * @param {number} i The fill's index.
     * @returns {void}
     */
    function next(i) {
        if (i === steps.length) {
            onDone();
            return;
        }
        runStep(store, ports, steps[i], anchor, anchor, lat, lon, force, function (stepFailure) {
            if (!stepFailure) {
                steps[i].readings.forEach(function (id) { anchor.feeds[id] = steps[i].provider; });
            }
            next(i + 1);
        });
    }
    next(0);
}

/**
 * Run the plan's steps for the anchor, from snapshots where they serve: the forecast from the
 * first provider that serves it, then the fills for that provider.
 *
 * @param {Object} anchor The Weather picker's provider (provider.js), its options set for
 *   this fetch and its countryCode for this place.
 * @param {{fillUv: function(Object, number, number, Function): void,
 *   fillReadings: function(Object, number, number, string[], Function): void,
 *   providerFor: function(string): Object, keyed: string[], now: function(): number,
 *   refreshMs: number, snapshots: {load: function(): {entries: Object[], drops: number},
 *   save: function({entries: Object[], drops: number}): void}}} ports The source ports.
 * @param {number} lat Latitude.
 * @param {number} lon Longitude.
 * @param {boolean} force Whether this is a forced refresh (withProviderData).
 * @param {Function} onSuccess Called once every step has run: the anchor holds a valid forecast,
 *   and its feeds name the provider each reading came from.
 * @param {Function} onFailure Called with the forecast's failure.
 * @returns {void}
 */
function fetchSources(anchor, ports, lat, lon, force, onSuccess, onFailure) {
    var options = anchor.options;
    var store = storeOf(ports);
    // Each reading's feed, the provider its series came from (day-peaks.js feedOf keeps the
    // day records by it): the one that served the forecast, a fill's for what it brings.
    anchor.feeds = null;
    var forecast = sourcePlan.forecastStep({ mode: options.sourceMode, provider: anchor.id,
        country: anchor.countryCode || null, lat: Number(lat), lon: Number(lon), keyed: ports.keyed });
    runForecast(store, ports, forecast, anchor, lat, lon, force, function (served) {
        anchor.feeds = {};
        providerReadings.READING_IDS.forEach(function (id) { anchor.feeds[id] = served; });
        runFills(store, ports, sourcePlan.fillSteps(served, Boolean(options.fetchUv), options.drawn || []),
            anchor, lat, lon, force, onSuccess);
    }, onFailure);
}

module.exports = { fetchSources: fetchSources };
