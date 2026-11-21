// src/pkjs/weather/domain/source-plan.js — ES5, watch runtime and settings page.
//
// The source plan: what one fetch asks for, in order. First the forecast, which a fetch
// requires (forecastStep): from the Weather picker's provider in One provider, the Weather from
// row's default; By location asks the place's regional provider first, then the Weather
// picker's, then Open-Meteo, each only when the one before failed (candidates); Per reading,
// the temperature's provider, then the Weather picker's. In Per reading the other readings'
// providers are asked next, each for the readings it brings (partSteps). Each provider brings
// every reading it sends (provider-readings.js); a reading the one it came from lacks comes from
// Open-Meteo while the watch draws it (fillSteps): DWD's UV by Open-Meteo's UV-only request,
// Yandex's dew point, wind direction, cloud cover and air pressure by one request for all of
// them. weather/application/fetch-sources.js runs the steps; the settings page names the fills
// under the Weather picker (page/weather/weather-sources-page.js).
//
// Dual-context like provider-readings.js: a CommonJS module on the phone and in the tests, a
// plain <script> on the settings page (scripts/build-config-page.js APP_FILES, after
// country-defaults.js, whose COUNTRY_DEFAULTS global it reads; window.SourcePlan).
(function () {
    var node = typeof require !== 'undefined';
    var providerReadings = node ? require('./provider-readings.js') : window.ProviderReadings;
    var countryDefaults = node ? require('../../settings/domain/country-defaults.js') : COUNTRY_DEFAULTS;

    // Where a reading the anchor lacks comes from: keyless, worldwide, and it sends every reading.
    var FILL_PROVIDER = 'openmeteo';
    // The readings Open-Meteo's one gap request brings (openmeteo.js fetchReadingsInto). UV
    // has a request of its own. Every reading a provider lacks is one of these or UV
    // (test/weather/domain/source-plan.test.js).
    var GAP_READINGS = ['dew', 'windDir', 'cloud', 'pressure'];

    /**
     * The readings a fetch fills from Open-Meteo: those the provider each came from lacks that
     * the watch draws. UV follows the fetch's own UV gate, so no fetch asks for UV its options
     * leave out.
     * @param {Object<string, string>} feeds Each reading's provider (readingProviders, or the
     *   fetch's feeds).
     * @param {boolean} fetchUv Whether the fetch asks for UV (the fetch options' fetchUv).
     * @param {string[]} drawn What the watch draws of the readings only some screens draw
     *   (drawn-readings.js; the fetch options' drawn).
     * @returns {string[]} provider-readings.js READINGS ids, in its order
     */
    function fillsOf(feeds, fetchUv, drawn) {
        return providerReadings.READING_IDS.filter(function (id) {
            if (providerReadings.serves(feeds[id], id)) { return false; }
            return id === 'uv' ? Boolean(fetchUv) : GAP_READINGS.indexOf(id) !== -1 && drawn.indexOf(id) !== -1;
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
     * The readings a fetch fills for one provider's forecast (fillsOf).
     * @param {*} provider The provider every reading came from.
     * @param {boolean} fetchUv Whether the fetch asks for UV.
     * @param {string[]} drawn What the watch draws.
     * @returns {string[]} READINGS ids
     */
    function fills(provider, fetchUv, drawn) {
        return fillsOf(allFrom(provider), fetchUv, drawn);
    }

    /**
     * The setting that names a reading's provider in Per reading.
     * @param {string} readingId A READINGS id.
     * @returns {string} e.g. 'weatherSourceWindDir'
     */
    function choiceKey(readingId) {
        return 'weatherSource' + readingId.charAt(0).toUpperCase() + readingId.slice(1);
    }

    /**
     * The readings the settings give a provider of their own in Per reading.
     * @param {?Object} settings Clay settings.
     * @returns {Object<string, string>} reading id → provider id; none for '', which follows
     *   the Weather picker
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
     * Whether a provider can bring a reading: it sends it, its key is stored, and it covers
     * the place where the place is known (the settings page does not know it).
     * @param {string} id A provider id.
     * @param {string} readingId A READINGS id.
     * @param {{keyed: string[], lat: (number|undefined), lon: (number|undefined)}} input The
     *   stored keys and the place.
     * @returns {boolean}
     */
    function usable(id, readingId, input) {
        var key = providerReadings.keySetting(id);
        return providerReadings.serves(id, readingId) && (!key || input.keyed.indexOf(id) !== -1)
            && (typeof input.lat !== 'number' || providerReadings.covers(id, input.lat, input.lon));
    }

    /**
     * Each reading's provider: in Per reading its row's pick where that provider can bring it
     * (usable: a cleared key, or a pick outside its area, follows the Weather picker again),
     * else the Weather picker's; in the other modes the Weather picker's.
     * @param {{mode: string, provider: string, choices: (Object<string, string>|undefined),
     *   keyed: string[], lat: (number|undefined), lon: (number|undefined)}} input The Weather
     *   from row's mode, the Weather picker's provider, the reading rows' picks (choicesOf),
     *   the stored keys and the place.
     * @returns {Object<string, string>} Every reading's provider id.
     */
    function readingProviders(input) {
        var out = {};
        providerReadings.READING_IDS.forEach(function (id) {
            var pick = input.mode === 'reading' && input.choices ? input.choices[id] : null;
            out[id] = pick && usable(pick, id, input) ? pick : input.provider;
        });
        return out;
    }

    /**
     * The regional provider a country picks, by the setup wizard's map (country-defaults.js
     * mapCountry: Germany DWD, the Met.no countries Met.no). The map's pick for everyone else
     * is no region of strength: null then, and for no country (the geocode found none).
     * @param {?string} country ISO alpha-2 code (the stored holidayCountry), or alpha-3 (the
     *   reverse geocode's: country-defaults.js alpha2).
     * @returns {?string} A provider id.
     */
    function regionalFor(country) {
        var cc = countryDefaults.alpha2(country);
        if (!cc) { return null; }
        var pick = countryDefaults.mapCountry(cc).provider;
        return pick === countryDefaults.mapCountry(null).provider ? null : pick;
    }

    /**
     * The providers that may serve the forecast, in the order they are asked: each only when
     * the one before failed. One provider: the Weather picker's alone, as before the Weather
     * from row, key or not (a missing key fails the fetch with its notice). By location
     * ('auto'): the place's regional provider, the Weather picker's, then Open-Meteo, each
     * that covers the place and has its key, once. Per reading ('reading'): the temperature's
     * provider, then the Weather picker's: the forecast starts where the temperature does.
     * @param {{mode: string, provider: string, country: ?string, lat: number, lon: number,
     *   keyed: string[]}} input The Weather from row's mode, the Weather picker's provider, the
     *   place and its country, and the providers whose key is stored.
     * @returns {string[]} Provider ids, never none.
     */
    function candidates(input) {
        if (input.mode === 'reading') {
            var base = readingProviders(input).temperature;
            return base === input.provider ? [base] : [base, input.provider];
        }
        if (input.mode !== 'auto') { return [input.provider]; }
        var out = [];
        [regionalFor(input.country), input.provider, FILL_PROVIDER].forEach(function (id) {
            var key = providerReadings.keySetting(id);
            if (id && out.indexOf(id) === -1 && providerReadings.covers(id, input.lat, input.lon)
                && (!key || input.keyed.indexOf(id) !== -1)) {
                out.push(id);
            }
        });
        return out;
    }

    /**
     * The forecast step, which every fetch requires.
     * @param {Object} input candidates()'s input.
     * @returns {{ask: string, providers: string[], required: boolean}} `providers`: who is
     *   asked, in order (candidates).
     */
    function forecastStep(input) {
        return { ask: 'forecast', providers: candidates(input), required: true };
    }

    /**
     * Per reading's parts: for each provider other than the one that served the forecast, the
     * readings it brings that the watch uses, in READINGS order. None in the other modes, and
     * none for a provider that failed this fetch: its readings stay with the forecast's, the
     * Weather picker's then (candidates). fetch-sources.js asks a part's provider for its whole
     * forecast and lays the part's readings on by time; a part that fails falls back to the
     * Weather picker's provider.
     * @param {Object} input readingProviders()'s input.
     * @param {string} served The provider that served the forecast.
     * @param {string[]} failed The providers that failed this fetch.
     * @param {string[]} wanted The readings the watch uses.
     * @returns {Array<{provider: string, ask: string, readings: string[]}>}
     */
    function partSteps(input, served, failed, wanted) {
        if (input.mode !== 'reading') { return []; }
        var byReading = readingProviders(input);
        var steps = [];
        providerReadings.READING_IDS.forEach(function (id) {
            var provider = byReading[id];
            if (provider === served || failed.indexOf(provider) !== -1 || wanted.indexOf(id) === -1) { return; }
            var step = steps.filter(function (s) { return s.provider === provider; })[0];
            if (!step) {
                step = { provider: provider, ask: 'forecast', readings: [] };
                steps.push(step);
            }
            step.readings.push(id);
        });
        return steps;
    }

    /**
     * The fills for what the forecast and its parts brought.
     * @param {Object<string, string>} feeds Each reading's provider (the fetch's feeds).
     * @param {boolean} fetchUv Whether the fetch asks for UV.
     * @param {string[]} drawn What the watch draws (fills).
     * @returns {Array<{provider: string, ask: string, readings: string[]}>} In order. `ask` is
     *   what a step asks for: 'uv', Open-Meteo's UV-only request; 'readings', Open-Meteo's gap
     *   request. Either brings the `readings` it names, whose feed its provider becomes
     *   (fetch-sources.js feeds).
     */
    function fillSteps(feeds, fetchUv, drawn) {
        var steps = [];
        var filled = fillsOf(feeds, fetchUv, drawn);
        if (filled.indexOf('uv') !== -1) {
            steps.push({ provider: FILL_PROVIDER, ask: 'uv', readings: ['uv'] });
        }
        var gaps = filled.filter(function (id) { return id !== 'uv'; });
        if (gaps.length) {
            steps.push({ provider: FILL_PROVIDER, ask: 'readings', readings: gaps });
        }
        return steps;
    }

    var api = { FILL_PROVIDER: FILL_PROVIDER, GAP_READINGS: GAP_READINGS, regionalFor: regionalFor,
        candidates: candidates, forecastStep: forecastStep, allFrom: allFrom, fillsOf: fillsOf, fills: fills,
        choiceKey: choiceKey, choicesOf: choicesOf, keyedOf: keyedOf, readingProviders: readingProviders,
        partSteps: partSteps, fillSteps: fillSteps };
    if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
    if (typeof window !== 'undefined') { window.SourcePlan = api; }
})();
