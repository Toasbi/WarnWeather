// src/pkjs/weather/domain/source-plan.js — ES5, watch runtime and settings page.
//
// The source plan: what one fetch asks for, in order. First the forecast, which a fetch
// requires (forecastStep): from the Weather picker's provider in One provider, the Weather from
// row's default; By location asks the place's regional provider first, then the Weather
// picker's, then Open-Meteo, each only when the one before failed (candidates). The provider
// that served sends every reading it sends (provider-readings.js); a reading it lacks comes
// from Open-Meteo while the watch draws it (fillSteps): DWD's UV by Open-Meteo's UV-only
// request, Yandex's dew point, wind direction, cloud cover and air pressure by one request for
// all of them. weather/application/fetch-sources.js runs the steps; the settings page names the
// fills under the Weather picker (page/weather/weather-sources-page.js).
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
     * The readings a fetch fills from Open-Meteo: those the provider lacks that the watch
     * draws. UV follows the fetch's own UV gate, so no fetch asks for UV its options leave out.
     * @param {*} provider The Weather picker's provider id.
     * @param {boolean} fetchUv Whether the fetch asks for UV (the fetch options' fetchUv).
     * @param {string[]} drawn What the watch draws of the readings only some screens draw
     *   (drawn-readings.js; the fetch options' drawn).
     * @returns {string[]} provider-readings.js READINGS ids, in its order
     */
    function fills(provider, fetchUv, drawn) {
        return providerReadings.READING_IDS.filter(function (id) {
            if (providerReadings.serves(provider, id)) { return false; }
            return id === 'uv' ? Boolean(fetchUv) : GAP_READINGS.indexOf(id) !== -1 && drawn.indexOf(id) !== -1;
        });
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
     * that covers the place and has its key, once.
     * @param {{mode: string, provider: string, country: ?string, lat: number, lon: number,
     *   keyed: string[]}} input The Weather from row's mode, the Weather picker's provider, the
     *   place and its country, and the providers whose key is stored.
     * @returns {string[]} Provider ids, never none.
     */
    function candidates(input) {
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
     * The fills for the provider that served the forecast.
     * @param {*} provider That provider's id.
     * @param {boolean} fetchUv Whether the fetch asks for UV.
     * @param {string[]} drawn What the watch draws (fills).
     * @returns {Array<{provider: string, ask: string, feedField: (string|undefined),
     *   readings: (string[]|undefined)}>} In order. `ask` is what a step asks for: 'uv',
     *   Open-Meteo's UV-only request, whose provider becomes the UV's feed (feedField: the
     *   day record's key, day-peaks.js feedOf); 'readings', Open-Meteo's gap request for the
     *   `readings` it names.
     */
    function fillSteps(provider, fetchUv, drawn) {
        var steps = [];
        var filled = fills(provider, fetchUv, drawn);
        if (filled.indexOf('uv') !== -1) {
            steps.push({ provider: FILL_PROVIDER, ask: 'uv', feedField: 'uvFeedId' });
        }
        var gaps = filled.filter(function (id) { return id !== 'uv'; });
        if (gaps.length) {
            steps.push({ provider: FILL_PROVIDER, ask: 'readings', readings: gaps });
        }
        return steps;
    }

    var api = { FILL_PROVIDER: FILL_PROVIDER, GAP_READINGS: GAP_READINGS, regionalFor: regionalFor,
        candidates: candidates, forecastStep: forecastStep, fills: fills, fillSteps: fillSteps };
    if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
    if (typeof window !== 'undefined') { window.SourcePlan = api; }
})();
