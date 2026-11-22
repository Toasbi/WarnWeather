// src/pkjs/weather/domain/source-plan.js — ES5, watch runtime and settings page.
//
// The source plan: what one fetch asks for, in order. First the forecast, which a fetch
// requires, from the Provider. Then each other provider a reading pick names, for the
// readings it brings (partSteps): a reading without a pick, the default, comes from the
// Provider. Each provider brings every reading it sends (provider-readings.js); a reading the
// one it came from lacks comes from Open-Meteo while the watch draws it (fillSteps): DWD's UV
// by Open-Meteo's UV-only request, Yandex's dew point, wind direction, cloud cover and air
// pressure by one request for all of them. weather/application/fetch-sources.js runs the steps.
// The settings page names the fills under the Provider, and the calls a day the steps come to
// (callsPerDay) under it and at the end of Data sources (page/weather/weather-sources-page.js);
// the tomorrow.io budget counts its calls by the same rule (page/weather/budgets/tomorrowio-budget.js).
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
     * @param {Object<string, string>} feeds Each reading's provider (feedsOf, or the fetch's
     *   feeds).
     * @param {string[]} drawn The drawn-only readings the watch draws.
     * @returns {string[]} provider-readings.js READINGS ids, in its order
     */
    function fillsOf(feeds, drawn) {
        return providerReadings.READING_IDS.filter(function (id) {
            return drawn.indexOf(id) !== -1 && !providerReadings.serves(feeds[id], id);
        });
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
     * The providers whose API key the settings hold. A key of blanks is none: the providers
     * trim theirs, as the page's key status does.
     * @param {?Object} settings Clay settings.
     * @returns {string[]} Provider ids.
     */
    function keyedOf(settings) {
        return Object.keys(providerReadings.PROVIDERS).filter(function (id) {
            var key = providerReadings.keySetting(id);
            var value = key && settings ? settings[key] : null;
            return typeof value === 'string' && value.trim() !== '';
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
     * @returns {Object} feedsOf()'s input, without a place.
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
     * Each reading's provider while no provider fails: its row's pick where the fetch uses the
     * reading (a drawn-only one while the watch draws it) and the pick sends it and may be asked
     * (askable: a cleared key, or a pick outside its area, follows the Provider again); else
     * the Provider's, which serves the forecast, whether it sends the reading or not: one it
     * lacks is filled (fillSteps).
     * @param {{provider: string, choices: (Object<string, string>|undefined), keyed: string[],
     *   lat: (number|undefined), lon: (number|undefined)}} input The Provider, the reading
     *   picks (choicesOf), the stored keys and the place (none on the settings page: askable).
     * @param {string[]} drawn The drawn-only readings the watch draws.
     * @returns {Object<string, string>} Every reading's provider id.
     */
    function feedsOf(input, drawn) {
        var out = {};
        providerReadings.READINGS.forEach(function (reading) {
            var id = reading.id;
            var pick = input.choices ? input.choices[id] : null;
            var used = !reading.drawnOnly || drawn.indexOf(id) !== -1;
            out[id] = used && pick && providerReadings.serves(pick, id) && askable(pick, input) ? pick : input.provider;
        });
        return out;
    }

    /**
     * The parts: each provider the feeds name besides the Provider, with the readings it brings,
     * in READINGS order. fetch-sources.js asks a part's provider for its whole forecast, once a
     * fetch, and lays the part's readings on by time; when it fails, or its hours do not line
     * up, they stay the Provider's.
     * @param {Object<string, string>} feeds Each reading's provider (feedsOf).
     * @param {string} provider The Provider.
     * @returns {Array<{provider: string, readings: string[]}>}
     */
    function partSteps(feeds, provider) {
        var steps = [];
        providerReadings.READING_IDS.forEach(function (id) {
            if (feeds[id] === provider) { return; }
            var step = steps.filter(function (s) { return s.provider === feeds[id]; })[0];
            if (!step) {
                step = { provider: feeds[id], readings: [] };
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
     * The steps a refresh runs while no provider fails: `asked`, the providers it asks for their
     * whole forecast (the Provider, then each part's), and the fills for what they leave. A fill
     * whose provider is asked is laid on from its forecast instead of asked (fetch-sources.js).
     * @param {Object} input feedsOf()'s input, the place left out where it is unknown.
     * @param {string[]} drawn The drawn-only readings the watch draws.
     * @returns {{asked: string[], fills: Array<Object>}}
     */
    function steadySteps(input, drawn) {
        var feeds = feedsOf(input, drawn);
        var parts = partSteps(feeds, input.provider);
        return { asked: [input.provider].concat(parts.map(function (step) { return step.provider; })),
            fills: fillSteps(feeds, drawn) };
    }

    /**
     * Whether a fill asks a request of its own: one whose provider the refresh asks for its
     * forecast is laid on from it.
     * @param {{asked: string[]}} steps steadySteps().
     * @param {{provider: string}} step A fill.
     * @returns {boolean}
     */
    function asksApart(steps, step) {
        return steps.asked.indexOf(step.provider) === -1;
    }

    /**
     * The requests of a refresh's steps (refreshRequests): each provider asked for its forecast,
     * whose fetch makes its UV request while the watch draws UV (the fetch options' fetchUv),
     * and the fill request that asks apart.
     * @param {{asked: string[], fills: Array<Object>}} steps steadySteps().
     * @param {string[]} drawn The drawn-only readings the watch draws.
     * @returns {Object<string, number>} provider id → requests
     */
    function requestsOf(steps, drawn) {
        var withUv = drawn.indexOf('uv') !== -1;
        var out = {};
        steps.asked.forEach(function (id) { out[id] = providerReadings.requests(id, withUv); });
        steps.fills.forEach(function (step) {
            if (step.ask !== 'uv' && asksApart(steps, step)) { out[step.provider] = (out[step.provider] || 0) + 1; }
        });
        return out;
    }

    /**
     * The requests one refresh makes while no provider fails, by provider: the Provider, the
     * parts (a part asks its provider's whole forecast) and Open-Meteo's request for the other
     * readings. The UV-only fill is left out: its answer serves for hours (callsPerDay counts
     * it). A forced fetch inside the refresh slot, which reuses its snapshots, adds none.
     * @param {Object} input feedsOf()'s input, the place left out where it is unknown.
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
     * @param {Object} input feedsOf()'s input, the place left out where it is unknown.
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
        if (steps.fills.some(function (step) { return step.ask === 'uv' && asksApart(steps, step); })) {
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
        fillsOf: fillsOf, choiceKey: choiceKey, choicesOf: choicesOf, keyedOf: keyedOf, sourcesOf: sourcesOf,
        inputOf: inputOf, askable: askable, feedsOf: feedsOf, partSteps: partSteps, fillSteps: fillSteps,
        refreshRequests: refreshRequests, refreshesPerDay: refreshesPerDay, callsPerDay: callsPerDay };
    if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
    if (typeof window !== 'undefined') { window.SourcePlan = api; }
})();
