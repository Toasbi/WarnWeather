// src/pkjs/weather/domain/source-plan.js — ES5, watch runtime and settings page.
//
// The source plan: what one fetch asks for, in order. First the forecast, which a fetch
// requires, from the Provider. Then each other provider a reading pick names, for the
// readings it brings (partSteps): a reading without a pick, the default, comes from the
// Provider. Each provider brings every reading it
// sends (provider-readings.js); a reading the one it came from lacks comes from Open-Meteo while
// the watch draws it (fillSteps): DWD's UV by Open-Meteo's UV-only request, Yandex's dew point,
// wind direction, cloud cover and air pressure by one request for all of them.
// weather/application/fetch-sources.js runs the steps; the settings page names the fills under
// the Provider and the calls a day the steps come to (callsPerDay) at the end of Data
// sources (page/weather/weather-sources-page.js), and the tomorrow.io budget counts its calls by
// the same rule (page/weather/budgets/tomorrowio-budget.js).
//
// What the watch draws is one list, `drawn`: the drawn-only readings it draws now
// (drawn-readings.js; the fetch options' drawn). A fetch asks for UV, and fills a reading, only
// while the list holds it.
//
// Dual-context like provider-readings.js: a CommonJS module on the phone and in the tests, a
// plain <script> on the settings page (scripts/build-config-page.js APP_FILES; window.SourcePlan).
(function () {
    var node = typeof require !== 'undefined';
    var providerReadings = node ? require('./provider-readings.js') : window.ProviderReadings;

    // Where a reading the anchor lacks comes from: keyless, worldwide, and it sends every reading.
    var FILL_PROVIDER = 'openmeteo';
    // How long the UV-only fill's answer serves (forecast-snapshot.js, its uv kind): UV forecasts
    // change slowly, so the fill asks Open-Meteo again only once this has passed.
    var UV_REUSE_MS = 3 * 60 * 60 * 1000;

    /**
     * The readings a fetch fills from Open-Meteo: those the watch draws that the provider each
     * came from lacks.
     * @param {Object<string, string>} feeds Each reading's provider (readingProviders, or the
     *   fetch's feeds).
     * @param {string[]} drawn The drawn-only readings the watch draws.
     * @returns {string[]} provider-readings.js READINGS ids, in its order
     */
    function fillsOf(feeds, drawn) {
        return providerReadings.READING_IDS.filter(function (id) {
            return drawn.indexOf(id) !== -1 && !providerReadings.serves(feeds[id], id);
        });
    }

    /**
     * The readings a fetch uses: a drawn-only reading while the watch draws it, every other
     * reading always. A part's provider is asked for these only (partSteps).
     * @param {string[]} drawn The drawn-only readings the watch draws.
     * @returns {string[]} READINGS ids, in their order.
     */
    function wanted(drawn) {
        return providerReadings.READING_IDS.filter(function (id) {
            return providerReadings.DRAWN_ONLY.indexOf(id) === -1 || drawn.indexOf(id) !== -1;
        });
    }

    /**
     * Every reading's provider one provider: what a forecast from it alone brings.
     * @param {*} provider A provider id.
     * @returns {Object<string, string>} reading id → provider id
     */
    function allFrom(provider) {
        var out = {};
        providerReadings.READING_IDS.forEach(function (id) { out[id] = provider; });
        return out;
    }

    /**
     * The setting that names a reading's provider: its row on Setup › Data sources.
     * @param {string} readingId A READINGS id.
     * @returns {string} e.g. 'weatherSourceWindDir'
     */
    function choiceKey(readingId) {
        return 'weatherSource' + readingId.charAt(0).toUpperCase() + readingId.slice(1);
    }

    /**
     * The readings the settings give a provider of their own.
     * @param {?Object} settings Clay settings.
     * @returns {Object<string, string>} reading id → provider id; none for '', which follows
     *   the Provider
     */
    function choicesOf(settings) {
        var out = {};
        providerReadings.READING_IDS.forEach(function (id) {
            var pick = settings && settings[choiceKey(id)];
            if (typeof pick === 'string' && pick) { out[id] = pick; }
        });
        return out;
    }

    /**
     * The providers whose API key the settings hold.
     * @param {?Object} settings Clay settings.
     * @returns {string[]} Provider ids.
     */
    function keyedOf(settings) {
        return Object.keys(providerReadings.PROVIDERS).filter(function (id) {
            var key = providerReadings.keySetting(id);
            return Boolean(key && settings && settings[key]);
        });
    }

    /**
     * Where the weather comes from, as the settings say it: the reading picks (choicesOf)
     * and the providers whose key is stored (keyedOf). The fetch options carry it
     * (fetch-options.js sources), and the engine adds the Provider and the
     * place (fetch-sources.js); the settings page adds the Provider (inputOf).
     * @param {?Object} settings Clay settings.
     * @returns {{choices: Object<string, string>, keyed: string[]}}
     */
    function sourcesOf(settings) {
        return { choices: choicesOf(settings), keyed: keyedOf(settings) };
    }

    /**
     * The plan's input on the settings page, which does not know the place: the settings'
     * sources and the Provider.
     * @param {?Object} settings Clay settings.
     * @returns {Object} readingProviders()'s input, without a place.
     */
    function inputOf(settings) {
        return Object.assign({ provider: settings ? settings.provider : undefined }, sourcesOf(settings));
    }

    /**
     * Whether a provider may be asked for the place: its key is stored, and it covers the place
     * where the place is known (the settings page does not know it).
     * @param {string} id A provider id.
     * @param {{keyed: string[], lat: (number|undefined), lon: (number|undefined)}} input The
     *   stored keys and the place.
     * @returns {boolean}
     */
    function askable(id, input) {
        var key = providerReadings.keySetting(id);
        return (!key || input.keyed.indexOf(id) !== -1)
            && (typeof input.lat !== 'number' || providerReadings.covers(id, input.lat, input.lon));
    }

    /**
     * Each reading's provider: its row's pick where that provider sends the reading and may be
     * asked (askable: a cleared key, or a pick outside its area, follows the Provider
     * again), else the Provider's.
     * @param {{provider: string, choices: (Object<string, string>|undefined), keyed: string[],
     *   lat: (number|undefined), lon: (number|undefined)}} input The Provider,
     *   the reading picks (choicesOf), the stored keys and the place (none on the settings
     *   page: askable).
     * @returns {Object<string, string>} Every reading's provider id.
     */
    function readingProviders(input) {
        var out = {};
        providerReadings.READING_IDS.forEach(function (id) {
            var pick = input.choices ? input.choices[id] : null;
            out[id] = pick && providerReadings.serves(pick, id) && askable(pick, input) ? pick : input.provider;
        });
        return out;
    }

    /**
     * Each reading's provider while no provider fails: the Provider's, which serves the
     * forecast, and each reading the fetch uses (wanted) its own (readingProviders), whether that
     * provider sends it or not: one it lacks is filled (fillSteps).
     * @param {Object} input readingProviders()'s input.
     * @param {string[]} drawn The drawn-only readings the watch draws.
     * @returns {Object<string, string>} reading id → provider id
     */
    function feedsOf(input, drawn) {
        var feeds = allFrom(input.provider);
        var byReading = readingProviders(input);
        wanted(drawn).forEach(function (id) { feeds[id] = byReading[id]; });
        return feeds;
    }

    /**
     * The parts: for each provider other than the Provider, the readings it brings
     * (feedsOf) that it sends, in READINGS order. fetch-sources.js asks a part's provider for its
     * whole forecast, once a fetch, and lays the part's readings on by time; when it fails, or
     * its hours do not line up, they stay the Provider's.
     * @param {Object} input readingProviders()'s input.
     * @param {string[]} drawn The drawn-only readings the watch draws.
     * @returns {Array<{provider: string, readings: string[]}>}
     */
    function partSteps(input, drawn) {
        var feeds = feedsOf(input, drawn);
        var steps = [];
        providerReadings.READING_IDS.forEach(function (id) {
            var provider = feeds[id];
            if (provider === input.provider || !providerReadings.serves(provider, id)) { return; }
            var step = steps.filter(function (s) { return s.provider === provider; })[0];
            if (!step) {
                step = { provider: provider, readings: [] };
                steps.push(step);
            }
            step.readings.push(id);
        });
        return steps;
    }

    /**
     * The fills for what the forecast and its parts brought.
     * @param {Object<string, string>} feeds Each reading's provider (the fetch's feeds).
     * @param {string[]} drawn The drawn-only readings the watch draws.
     * @returns {Array<{provider: string, ask: string, readings: string[]}>} In order. `ask` is
     *   what a step asks for: 'uv', Open-Meteo's UV-only request; 'readings', its request for
     *   the other readings. Either brings the `readings` it names, whose feed its provider
     *   becomes (fetch-sources.js feeds).
     */
    function fillSteps(feeds, drawn) {
        var steps = [];
        var filled = fillsOf(feeds, drawn);
        if (filled.indexOf('uv') !== -1) {
            steps.push({ provider: FILL_PROVIDER, ask: 'uv', readings: ['uv'] });
        }
        var rest = filled.filter(function (id) { return id !== 'uv'; });
        if (rest.length) {
            steps.push({ provider: FILL_PROVIDER, ask: 'readings', readings: rest });
        }
        return steps;
    }

    /**
     * The steps a refresh runs while no provider fails: the Provider's forecast, the
     * parts, and the fills for what they leave (feedsOf). `inHand`: the providers whose whole
     * forecast the refresh has, which a fill of theirs is laid on from instead of asked
     * (fetch-sources.js).
     * @param {Object} input readingProviders()'s input, the place left out where it is unknown.
     * @param {string[]} drawn The drawn-only readings the watch draws.
     * @returns {{parts: Array<Object>, fills: Array<Object>, inHand: string[]}}
     */
    function steadySteps(input, drawn) {
        var parts = partSteps(input, drawn);
        return { parts: parts, fills: fillSteps(feedsOf(input, drawn), drawn),
            inHand: [input.provider].concat(parts.map(function (step) { return step.provider; })) };
    }

    /**
     * The requests of a refresh's steps (refreshRequests). A provider's fetch makes its UV
     * request while the watch draws UV, as the fetch options' fetchUv says; a fill whose
     * provider's forecast is in hand asks nothing.
     * @param {{parts: Array<Object>, fills: Array<Object>, inHand: string[]}} steps
     *   steadySteps(): inHand starts with the Provider.
     * @param {string[]} drawn The drawn-only readings the watch draws.
     * @returns {Object<string, number>} provider id → requests
     */
    function requestsOf(steps, drawn) {
        var withUv = drawn.indexOf('uv') !== -1;
        var out = {};
        /**
         * @param {string} id A provider id.
         * @param {number} n Requests it makes.
         * @returns {void}
         */
        function add(id, n) { out[id] = (out[id] || 0) + n; }
        add(steps.inHand[0], providerReadings.requests(steps.inHand[0], withUv));
        steps.parts.forEach(function (step) { add(step.provider, providerReadings.requests(step.provider, withUv)); });
        steps.fills.forEach(function (step) {
            if (step.ask !== 'uv' && steps.inHand.indexOf(step.provider) === -1) { add(step.provider, 1); }
        });
        return out;
    }

    /**
     * The requests one refresh makes while no provider fails, by provider: the Provider's
     * provider, the parts (a part asks its provider's whole forecast) and Open-Meteo's request
     * for the other readings. The UV-only fill is left out: its answer serves for hours
     * (callsPerDay counts it). A forced fetch inside the refresh slot, which reuses its
     * snapshots, adds none.
     * @param {Object} input readingProviders()'s input, the place left out where it is unknown.
     * @param {string[]} drawn The drawn-only readings the watch draws.
     * @returns {Object<string, number>} provider id → requests
     */
    function refreshRequests(input, drawn) {
        return requestsOf(steadySteps(input, drawn), drawn);
    }

    /**
     * The refreshes a day: one each update interval, none in the Battery saver's window.
     * @param {number} intervalMin The update interval, minutes.
     * @param {number} pauseHours The Battery saver's window, whole hours (0 when it is off).
     * @returns {number}
     */
    function refreshesPerDay(intervalMin, pauseHours) {
        return (24 - pauseHours) * 60 / intervalMin;
    }

    /**
     * The calls a day the plan comes to while no provider fails, by provider: each refresh's
     * requests (refreshRequests), and the UV-only fill at the first refresh after its last
     * answer stopped serving (UV_REUSE_MS).
     * @param {Object} input readingProviders()'s input, the place left out where it is unknown.
     * @param {string[]} drawn The drawn-only readings the watch draws.
     * @param {number} intervalMin The update interval, minutes.
     * @param {number} pauseHours The Battery saver's window, whole hours.
     * @returns {Object<string, number>} provider id → calls a day, in the order the plan asks
     *   them: the Provider first
     */
    function callsPerDay(input, drawn, intervalMin, pauseHours) {
        var refreshes = refreshesPerDay(intervalMin, pauseHours);
        var steps = steadySteps(input, drawn);
        var perRefresh = requestsOf(steps, drawn);
        var out = {};
        Object.keys(perRefresh).forEach(function (id) { out[id] = perRefresh[id] * refreshes; });
        if (steps.fills.some(function (step) { return step.ask === 'uv' && steps.inHand.indexOf(step.provider) === -1; })) {
            // A refresh at exactly UV_REUSE_MS still reuses the answer (forecast-snapshot.js).
            var every = Math.floor(UV_REUSE_MS / (intervalMin * 60 * 1000)) + 1;
            out[FILL_PROVIDER] = (out[FILL_PROVIDER] || 0) + Math.ceil(refreshes / every);
        }
        return out;
    }

    // Every setting sourcesOf reads: the reading picks and the API keys (the tomorrow.io budget's
    // STATE_KEYS).
    var SETTINGS_KEYS = providerReadings.READING_IDS.map(choiceKey).concat(
        Object.keys(providerReadings.PROVIDERS).map(providerReadings.keySetting).filter(Boolean));

    var api = { FILL_PROVIDER: FILL_PROVIDER, UV_REUSE_MS: UV_REUSE_MS, SETTINGS_KEYS: SETTINGS_KEYS,
        allFrom: allFrom, fillsOf: fillsOf, choiceKey: choiceKey,
        choicesOf: choicesOf, keyedOf: keyedOf, sourcesOf: sourcesOf, inputOf: inputOf, askable: askable,
        readingProviders: readingProviders, feedsOf: feedsOf, partSteps: partSteps, fillSteps: fillSteps, wanted: wanted,
        refreshRequests: refreshRequests, refreshesPerDay: refreshesPerDay, callsPerDay: callsPerDay };
    if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
    if (typeof window !== 'undefined') { window.SourcePlan = api; }
})();
