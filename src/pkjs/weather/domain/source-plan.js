// src/pkjs/weather/domain/source-plan.js — ES5, watch runtime and settings page.
//
// The source plan: what one fetch asks for, in order. The Weather picker's provider (the
// anchor, the instance the rest of the fetch reads) fetches its own forecast first, and a
// fetch without it fails. It serves every reading it sends (provider-readings.js); a reading
// it lacks comes from Open-Meteo while the screens draw it. For now that is DWD's UV, by
// Open-Meteo's UV-only request. weather/application/fetch-sources.js runs the steps.
//
// Dual-context like provider-readings.js: a CommonJS module on the phone and in the tests, a
// plain <script> on the settings page once it lists it (window.SourcePlan).
(function () {
    var providerReadings = typeof require !== 'undefined'
        ? require('./provider-readings.js') : window.ProviderReadings;

    // Where a reading the anchor lacks comes from: keyless, worldwide, and it sends every reading.
    var FILL_PROVIDER = 'openmeteo';

    /**
     * Plan one fetch.
     * @param {{provider: string, fetchUv: boolean}} input The Weather picker's provider id, and
     *   whether the screens draw UV (fetch options' fetchUv).
     * @returns {{steps: Array<{provider: string, ask: string, required: (boolean|undefined),
     *   feedField: (string|undefined)}>}} The requests in order. `ask` is what a step asks
     *   for: 'forecast', the anchor's own forecast, which the fetch requires; 'uv', Open-Meteo's
     *   UV-only request, whose provider becomes the anchor's UV feed (feedField: the day
     *   record's key, day-peaks.js feedOf).
     */
    function plan(input) {
        var steps = [{ provider: input.provider, ask: 'forecast', required: true }];
        if (input.fetchUv && !providerReadings.serves(input.provider, 'uv')) {
            steps.push({ provider: FILL_PROVIDER, ask: 'uv', feedField: 'uvFeedId' });
        }
        return { steps: steps };
    }

    var api = { FILL_PROVIDER: FILL_PROVIDER, plan: plan };
    if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
    if (typeof window !== 'undefined') { window.SourcePlan = api; }
})();
