// src/pkjs/weather/application/fetch-sources.js — ES5, watch runtime.
//
// One fetch's weather sources: the source plan's steps (weather/domain/source-plan.js), onto
// the Weather picker's provider (the anchor, the instance the rest of the fetch chain reads:
// provider.js fetchWithCoordinates). The forecast comes from the first of the plan's candidates
// that serves it: the anchor's own answer, or another provider's put on the anchor (By
// location, Per reading). In Per reading the other readings' providers come next, each laid on
// by time. Then come the fills for what the readings' providers lack. Each step reuses its
// snapshot when one serves (weather/domain/forecast-snapshot.js), else asks and keeps a valid
// answer, and each provider's forecast is asked once a fetch. A forecast no provider serves
// fails the fetch; a part that fails falls back to the plan's fallback, the Weather picker's
// provider, and a fill that fails leaves its readings empty, as a reading a provider does not
// send is everywhere.
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
 * Whether a forecast holds hours of a reading: each of its series is a non-empty list.
 * @param {Object} forecast A provider.
 * @param {string} id A READINGS id whose keys are hourly series.
 * @returns {boolean}
 */
function holdsHours(forecast, id) {
    return providerReadings.keysOf(id).every(function (key) {
        return Array.isArray(forecast[key]) && forecast[key].length > 0;
    });
}

/**
 * Whether a fill brought one of its readings at least: an answer without one (Open-Meteo has no
 * dew point there) still brings the rest.
 * @param {Object} anchor The Weather picker's provider.
 * @param {{readings: string[]}} step The fill.
 * @returns {boolean}
 */
function fillHolds(anchor, step) {
    return step.readings.some(function (id) { return holdsHours(anchor, id); });
}

/**
 * A fill's request through its port: it clears the fill's readings on the anchor first, so what
 * the anchor holds afterwards is the fill's alone, and it always calls back.
 * @param {function(Object, Object, number, number, string[], Function): void} call Asks the port.
 * @returns {function(Object, Object, Object, number, number, boolean, Function): void} A run.
 */
function fillRun(call) {
    return function (ports, step, anchor, lat, lon, force, done) {
        providerReadings.keysOf(step.readings).forEach(function (key) { anchor[key] = []; });
        call(ports, anchor, lat, lon, step.readings, function () { done(null); });
    };
}

// Each kind of step (a plan step's `ask`): how it asks (run: it calls back with a failure value,
// or null once answered), whether the instance then holds what the kind brings (holds), and the
// failure an answer, or a stored snapshot, that does not hold it is (empty).
var ASKS = {
    forecast: {
        /**
         * A provider's own request, onto its instance.
         * @param {Object} ports The source ports.
         * @param {Object} step The plan step.
         * @param {Object} provider The provider asked.
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
         * @param {Object} provider The provider asked.
         * @returns {boolean}
         */
        holds: function (provider) { return provider.hasValidData(); },
        empty: 'invalid_data'
    },
    // Open-Meteo's UV-only request into the anchor's uvTrend, aligned to its startTime.
    uv: {
        run: fillRun(function (ports, anchor, lat, lon, readings, done) { ports.fillUv(anchor, lat, lon, done); }),
        holds: fillHolds,
        empty: 'fill_empty'
    },
    // Open-Meteo's one request for the other readings the anchor lacks that the watch draws.
    readings: {
        run: fillRun(function (ports, anchor, lat, lon, readings, done) {
            ports.fillReadings(anchor, lat, lon, readings, done);
        }),
        holds: fillHolds,
        empty: 'fill_empty'
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
 * Run some items one after another.
 * @param {Array} items The items.
 * @param {function(*, Function): void} each Runs one, then calls its second argument.
 * @param {Function} done Called once every item has run.
 * @returns {void}
 */
function inTurn(items, each, done) {
    var i = 0;
    /**
     * Run the next item, or finish.
     * @returns {void}
     */
    function next() {
        if (i === items.length) {
            done();
            return;
        }
        i += 1;
        each(items[i - 1], next);
    }
    next();
}

/**
 * Keep a failure as the anchor's recovered one, the first a fetch met (reported to telemetry
 * once, never a notice: shell/fetch-cycle.js).
 * @param {Object} run The fetch (fetchSources).
 * @param {?Object} stepFailure A failure value, or none.
 * @returns {void}
 */
function recover(run, stepFailure) {
    if (stepFailure && !run.anchor.recoveredFailure) { run.anchor.recoveredFailure = stepFailure; }
}

/**
 * One plan step on one instance: its snapshot when one serves, else its own answer, kept. A
 * forecast is asked of the provider's instance, a fill onto the anchor.
 * @param {Object} run The fetch (fetchSources).
 * @param {{provider: string, ask: string, readings: (string[]|undefined)}} step The plan step.
 * @param {Object} target The instance the step's fields land on.
 * @param {function(?Object): void} done Receives a failure value or null.
 * @returns {void}
 */
function ask(run, step, target, done) {
    var kind = ASKS[step.ask];
    var query = forecastSnapshot.queryOf(step, target, run.lat, run.lon);
    var fields = forecastSnapshot.reuse(run.store.entries, query, run.ports.now(), run.ports.refreshMs, target);
    if (fields) {
        Object.assign(target, fields);
        // Only an answer that held is kept, so a snapshot that does not was damaged where it
        // was stored: the source is asked, and its answer replaces every field.
        if (kind.holds(target, step)) {
            done(null);
            return;
        }
    }
    kind.run(run.ports, step, target, run.lat, run.lon, run.force, function (stepFailure) {
        var outcome = stepFailure || (kind.holds(target, step) ? null : failure(kind.empty));
        if (!outcome && query) { run.store.keep(forecastSnapshot.snapshotOf(query, target, run.ports.now())); }
        done(outcome);
    });
}

/**
 * A provider's forecast this fetch, asked once: the instance holding it, or null once it failed.
 * The forecast step asks the Weather picker's own on the anchor; any later ask takes an
 * instance of its own, so the forecast on the anchor stays. Each provider asked joins the
 * anchor's answers.
 * @param {Object} run The fetch (fetchSources).
 * @param {string} id The provider.
 * @param {boolean} onAnchor Whether the Weather picker's provider answers on the anchor.
 * @param {function(?Object, ?Object): void} done Receives the instance, or null, and the
 *   failure of a provider asked now.
 * @returns {void}
 */
function forecastOf(run, id, onAnchor, done) {
    if (Object.prototype.hasOwnProperty.call(run.forecasts, id)) {
        done(run.forecasts[id], null);
        return;
    }
    var target = onAnchor && id === run.anchor.id ? run.anchor : run.ports.providerFor(id);
    ask(run, { provider: id, ask: 'forecast' }, target, function (stepFailure) {
        run.forecasts[id] = stepFailure ? null : target;
        run.anchor.answers.push({ id: id, apiKey: target.apiKey, name: target.name, shortName: target.shortName,
            failure: stepFailure });
        done(run.forecasts[id], stepFailure);
    });
}

/**
 * The forecast: its candidates in turn until one serves, its answer put on the anchor. A
 * fetch a later candidate saved keeps the first failure as the recovered one; when every
 * candidate fails, the last one's failure fails the fetch.
 * @param {Object} run The fetch (fetchSources).
 * @param {string[]} candidates sourcePlan.candidates().
 * @param {function(string): void} onServed Receives the provider that served.
 * @param {function(Object): void} onFailure Receives the last candidate's failure.
 * @returns {void}
 */
function serveForecast(run, candidates, onServed, onFailure) {
    var firstFailure = null;
    /**
     * Ask candidate i, then the next while it fails.
     * @param {number} i Its index.
     * @returns {void}
     */
    function attempt(i) {
        forecastOf(run, candidates[i], true, function (served, stepFailure) {
            if (served) {
                if (served !== run.anchor) {
                    forecastModel.adoptForecast(run.anchor, served);
                    recover(run, served.recoveredFailure);
                }
                recover(run, firstFailure);
                onServed(candidates[i]);
                return;
            }
            firstFailure = firstFailure || stepFailure;
            if (i + 1 < candidates.length) {
                attempt(i + 1);
                return;
            }
            onFailure(stepFailure);
        });
    }
    attempt(0);
}

/**
 * Per reading's parts, in order: each part's readings are laid on the anchor by time
 * (forecast-model.js adoptReadings) from the first of its provider and its fallback whose
 * forecast lines up, their feed that provider. A failed provider is the recovered failure.
 * @param {Object} run The fetch (fetchSources).
 * @param {Array<{provider: string, fallback: string, readings: string[]}>} parts
 *   sourcePlan.partSteps().
 * @param {Function} done Called once every part has run.
 * @returns {void}
 */
function layParts(run, parts, done) {
    inTurn(parts, function (part, next) {
        var keys = providerReadings.keysOf(part.readings);
        inTurn([part.provider, part.fallback], function (id, tryNext) {
            forecastOf(run, id, false, function (forecast, stepFailure) {
                recover(run, stepFailure);
                if (!forecast || !forecastModel.adoptReadings(run.anchor, forecast, keys)) {
                    tryNext();
                    return;
                }
                part.readings.forEach(function (reading) { run.anchor.feeds[reading] = id; });
                next();
            });
        }, next);
    }, done);
}

/**
 * The fills, in order. One that brings its readings names its provider as their feed; one
 * that fails leaves them empty.
 * @param {Object} run The fetch (fetchSources).
 * @param {Object[]} fills sourcePlan.fillSteps().
 * @param {Function} done Called once every fill has run.
 * @returns {void}
 */
function fill(run, fills, done) {
    inTurn(fills, function (step, next) {
        ask(run, step, run.anchor, function (stepFailure) {
            if (!stepFailure) {
                step.readings.forEach(function (id) { run.anchor.feeds[id] = step.provider; });
            }
            next();
        });
    }, done);
}

/**
 * Run the plan's steps for the anchor, from snapshots where they serve: the forecast from the
 * first candidate that serves it, Per reading's parts, then the fills for what came.
 *
 * @param {Object} anchor The Weather picker's provider (provider.js), its options set for
 *   this fetch and its countryCode for this place.
 * @param {{fillUv: function(Object, number, number, Function): void,
 *   fillReadings: function(Object, number, number, string[], Function): void,
 *   providerFor: function(string): Object, now: function(): number,
 *   refreshMs: number, snapshots: {load: function(): {entries: Object[], drops: number},
 *   save: function({entries: Object[], drops: number}): void}}} ports The source ports.
 * @param {number} lat Latitude.
 * @param {number} lon Longitude.
 * @param {boolean} force Whether this is a forced refresh (withProviderData).
 * @param {Function} onSuccess Called once every step has run: the anchor holds a valid forecast,
 *   its feeds name the provider each reading came from and its answers each provider asked.
 * @param {Function} onFailure Called with the forecast's failure: the last answer's.
 * @returns {void}
 */
function fetchSources(anchor, ports, lat, lon, force, onSuccess, onFailure) {
    var options = anchor.options;
    // Each reading's feed, the provider its series came from (day-peaks.js feedOf keeps the
    // day records by it): the one that served the forecast, a part's or a fill's for what it
    // brings.
    anchor.feeds = null;
    // Each provider this fetch asked for its forecast, in turn, with the key its request carried,
    // its names and its failure or null (shell/fetch-cycle.js records each keyed one's answer to
    // its key, and names the provider whose failure fails the fetch).
    anchor.answers = [];
    // forecasts: each provider asked this fetch, by id (forecastOf).
    var run = { anchor: anchor, ports: ports, store: storeOf(ports), lat: lat, lon: lon, force: force,
        forecasts: {} };
    var input = Object.assign({ provider: anchor.id, country: anchor.countryCode || null, lat: Number(lat),
        lon: Number(lon) }, options.sources);
    serveForecast(run, sourcePlan.candidates(input), function (served) {
        anchor.feeds = sourcePlan.allFrom(served);
        layParts(run, sourcePlan.partSteps(input, served, options.drawn), function () {
            fill(run, sourcePlan.fillSteps(anchor.feeds, options.drawn), onSuccess);
        });
    }, onFailure);
}

module.exports = { fetchSources: fetchSources };
