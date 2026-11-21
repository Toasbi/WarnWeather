// src/pkjs/weather/domain/source-plan.js — ES5, watch runtime and settings page.
//
// The source plan: what one fetch asks for, in order. The Weather picker's provider (the
// anchor, the instance the rest of the fetch reads) fetches its own forecast first, and a
// fetch without it fails. It serves every reading it sends (provider-readings.js); a reading
// it lacks comes from Open-Meteo while the watch draws it (fills): DWD's UV by Open-Meteo's
// UV-only request, Yandex's dew point, wind direction, cloud cover and air pressure by one
// request for all of them. weather/application/fetch-sources.js runs the steps; the settings
// page names the fills under the Weather picker (page/weather/weather-sources-page.js).
//
// Dual-context like provider-readings.js: a CommonJS module on the phone and in the tests, a
// plain <script> on the settings page (scripts/build-config-page.js APP_FILES,
// window.SourcePlan).
(function () {
    var providerReadings = typeof require !== 'undefined'
        ? require('./provider-readings.js') : window.ProviderReadings;

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
     * Plan one fetch.
     * @param {{provider: string, fetchUv: boolean, drawn: (string[]|undefined)}} input The
     *   Weather picker's provider id, whether the fetch asks for UV, and what the watch draws
     *   (fills).
     * @returns {{steps: Array<{provider: string, ask: string, required: (boolean|undefined),
     *   feedField: (string|undefined), readings: (string[]|undefined)}>}} The requests in
     *   order. `ask` is what a step asks for: 'forecast', the anchor's own forecast, which the
     *   fetch requires; 'uv', Open-Meteo's UV-only request, whose provider becomes the anchor's
     *   UV feed (feedField: the day record's key, day-peaks.js feedOf); 'readings', Open-Meteo's
     *   gap request for the `readings` it names.
     */
    function plan(input) {
        var steps = [{ provider: input.provider, ask: 'forecast', required: true }];
        var filled = fills(input.provider, input.fetchUv, input.drawn || []);
        if (filled.indexOf('uv') !== -1) {
            steps.push({ provider: FILL_PROVIDER, ask: 'uv', feedField: 'uvFeedId' });
        }
        var gaps = filled.filter(function (id) { return id !== 'uv'; });
        if (gaps.length) {
            steps.push({ provider: FILL_PROVIDER, ask: 'readings', readings: gaps });
        }
        return { steps: steps };
    }

    var api = { FILL_PROVIDER: FILL_PROVIDER, GAP_READINGS: GAP_READINGS, fills: fills, plan: plan };
    if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
    if (typeof window !== 'undefined') { window.SourcePlan = api; }
})();
