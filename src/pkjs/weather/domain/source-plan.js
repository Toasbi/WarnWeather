// src/pkjs/weather/domain/source-plan.js — ES5, watch runtime and settings page.
//
// The source plan: which provider serves each reading of one fetch, and what the fetch asks
// for, in order. The Weather picker's provider (the anchor, the instance the rest of the
// fetch reads) serves every reading it sends (provider-readings.js). A reading it lacks comes
// from Open-Meteo while the screens draw it; for now that is DWD's UV, by Open-Meteo's
// UV-only request. weather/application/fetch-sources.js runs the plan.
//
// Dual-context like provider-readings.js: a CommonJS module on the phone and in the tests, a
// plain <script> on the settings page once it lists it (window.SourcePlan).
(function () {
    var providerReadings = typeof require !== 'undefined'
        ? require('./provider-readings.js') : window.ProviderReadings;

    // Where a reading the anchor lacks comes from: keyless, worldwide, and it sends every reading.
    var FILL_PROVIDER = 'openmeteo';

    /**
     * Plan one fetch. A provider the table does not know (a test's stand-in) is taken to send
     * every reading, and nothing is filled for it.
     * @param {{provider: string, fetchUv: boolean}} input The Weather picker's provider id, and
     *   whether the screens draw UV (fetch options' fetchUv).
     * @returns {{anchor: string, readings: Object<string, ?string>,
     *   steps: Array<{provider: string, ask: string, readings: string[]}>}} Each reading's
     *   provider (null: none, as it is not drawn), and the requests in order: the anchor's
     *   forecast first ('forecast'), then the fills ('uv': Open-Meteo's UV-only request).
     */
    function plan(input) {
        var anchor = input.provider;
        var known = Object.prototype.hasOwnProperty.call(providerReadings.PROVIDERS, anchor);
        var byReading = {};
        var own = [];
        providerReadings.READING_IDS.forEach(function (id) {
            var sent = !known || providerReadings.serves(anchor, id);
            byReading[id] = sent ? anchor : null;
            if (sent) { own.push(id); }
        });
        var steps = [{ provider: anchor, ask: 'forecast', readings: own }];
        if (byReading.uv === null && input.fetchUv) {
            byReading.uv = FILL_PROVIDER;
            steps.push({ provider: FILL_PROVIDER, ask: 'uv', readings: ['uv'] });
        }
        return { anchor: anchor, readings: byReading, steps: steps };
    }

    var api = { FILL_PROVIDER: FILL_PROVIDER, plan: plan };
    if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
    if (typeof window !== 'undefined') { window.SourcePlan = api; }
})();
