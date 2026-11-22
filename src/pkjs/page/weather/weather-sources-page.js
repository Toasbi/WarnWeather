// src/pkjs/page/weather/weather-sources-page.js — ES5. Where the weather comes from, on the
// settings page (Setup › Data sources): the note under the Weather picker that names the
// readings coming from Open-Meteo (weatherFillNote, a staticText's textFrom; its row is
// weather-sources-schema.js FILL_NOTE), Per reading's row options (weatherReadingOptions), and
// the calls a day the choices come to (weatherCallsLine, at the interval the budget read-outs
// count with). The note's readings are the source plan's
// fills, by the phone's own rules: the readings the picked provider lacks (source-plan.js
// fills) that the watch draws (drawn-readings.js).
//
// Dual-context: a CommonJS module in the tests, a plain concatenated <script> in the settings
// page (scripts/build-config-page.js APP_FILES, after provider-readings.js, source-plan.js,
// drawn-readings.js and weather-words.js, which it binds while its body runs;
// window.WeatherSourcesPage). At load it reads the page's html helpers (config-ui/lib/html.js,
// concatenated ahead of every app file).
(function () {
    var node = typeof require !== 'undefined';
    var PConf = (typeof global !== 'undefined' && global.PConf) ? global.PConf
        : (typeof window !== 'undefined' && window.PConf) ? window.PConf
        : null;
    var sourcePlan = node ? require('../../weather/domain/source-plan.js') : window.SourcePlan;
    var providerReadings = node ? require('../../weather/domain/provider-readings.js') : window.ProviderReadings;
    var drawnReadings = node ? require('../../weather/domain/drawn-readings.js') : window.DrawnReadings;
    var words = node ? require('./weather-words.js') : window.WeatherWords;
    // The interval and the night pause the budget read-outs count with.
    var intervalBudget = node ? require('./budgets/interval-budget.js') : PConf.intervalBudget;
    var tomorrowioBudget = node ? require('./budgets/tomorrowio-budget.js') : PConf.tomorrowioBudget;
    var html = node ? require('../../config-ui/lib/html.js') : PConf.html;
    var WORDS = words.WORDS;
    var NAMES = words.NAMES;

    /**
     * A Per reading row's options: Same as Weather, then each provider that sends its reading,
     * in the Weather picker's order. A keyed provider stays listed but cannot be picked until
     * its key is stored: the key rows belong to the Weather and Rain radar pickers.
     * @param {Object} S Settings.
     * @param {Object} env Platform env (unused).
     * @param {{reading: string}} args The row's reading.
     * @returns {Array<Array>} [label, value, meta?] options.
     */
    function readingOptions(S, env, args) {
        var reading = args && args.reading;
        var keyed = sourcePlan.keyedOf(S);
        var out = [['Same as Weather', '']];
        Object.keys(NAMES).forEach(function (id) {
            if (!providerReadings.serves(id, reading)) { return; }
            var key = providerReadings.keySetting(id);
            out.push(key && keyed.indexOf(id) === -1
                ? [NAMES[id], id, { desc: 'Add its API key under Weather first', disabled: true }] : [NAMES[id], id]);
        });
        return out;
    }

    /**
     * The note under the Weather picker: which readings the watch draws that the picked
     * provider sends none of, and that they come from Open-Meteo. "Sends no", as the page's
     * other gap sentences say it (forecast-metrics.js gapSentence). In Per reading, of the
     * readings that follow the picker: a row's own pick sends its reading. None in By location,
     * whose provider follows the place the page does not know: the Weather from row's hint says
     * it.
     * @param {Object} S Settings.
     * @param {Object} env Platform env.
     * @returns {string} HTML; '' while nothing comes from Open-Meteo
     */
    function fillNote(S, env) {
        if (!S || S.weatherSourceMode === 'auto' || !Object.prototype.hasOwnProperty.call(NAMES, S.provider)) {
            return '';
        }
        var provider = S.provider;
        var drawn = drawnReadings.drawn(S, env || {});
        var feeds = sourcePlan.readingProviders({ mode: S.weatherSourceMode, provider: provider,
            choices: sourcePlan.choicesOf(S), keyed: sourcePlan.keyedOf(S) });
        var filled = sourcePlan.fillsOf(feeds, drawn);
        if (!filled.length) { return ''; }
        var words = filled.map(function (id) { return WORDS[id]; });
        return html.esc(NAMES[provider] + ' sends no ' + html.andList(words, 'or') + ', so '
            + (filled.length > 1 ? 'they come' : 'it comes') + ' from Open-Meteo.');
    }

    /**
     * The line at the end of Data sources: the calls a day the weather's choices come to while no
     * provider fails (source-plan.js callsPerDay), and each provider's share when more than one
     * is called, in the order the plan asks them: the forecast's provider first. It counts at the
     * update interval and the night pause the budget read-outs count with (interval-budget.js
     * readoutState and readoutInterval, tomorrowio-budget.js sleepHours), so its tomorrow.io share
     * is their figure where every reading tomorrow.io brings is drawn. By location counts the
     * regional provider of the stored country (holidayCountry), as the Weather picker's
     * "(Recommended)" marker does: the page does not know the place.
     * @param {Object} S Settings.
     * @param {Object} env Platform env.
     * @returns {string} HTML; '' for a provider the page does not know
     */
    function callsLine(S, env) {
        if (!S || !Object.prototype.hasOwnProperty.call(NAMES, S.provider)) { return ''; }
        var state = intervalBudget.readoutState(S, env);
        var drawn = drawnReadings.drawn(S, env || {});
        var input = { mode: S.weatherSourceMode, provider: S.provider, country: S.holidayCountry || null,
            choices: sourcePlan.choicesOf(S), keyed: sourcePlan.keyedOf(S) };
        var calls = sourcePlan.callsPerDay(input, drawn, intervalBudget.readoutInterval(state),
            tomorrowioBudget.sleepHours(state));
        var ids = Object.keys(calls).filter(function (id) { return calls[id] > 0; });
        var total = ids.reduce(function (sum, id) { return sum + calls[id]; }, 0);
        var text = 'About ' + Math.round(total) + ' weather calls a day';
        if (ids.length > 1) {
            text += ': ' + html.andList(ids.map(function (id) { return Math.round(calls[id]) + ' to ' + NAMES[id]; }));
        }
        return html.esc(text + '.');
    }

    if (PConf && PConf.hintResolvers) {
        PConf.hintResolvers.register('weatherFillNote', fillNote);
        PConf.hintResolvers.register('weatherCallsLine', callsLine);
    }
    if (PConf && PConf.optionsResolvers) {
        PConf.optionsResolvers.register('weatherReadingOptions', readingOptions);
    }

    var api = { fillNote: fillNote, readingOptions: readingOptions, callsLine: callsLine };
    if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
    if (typeof window !== 'undefined') { window.WeatherSourcesPage = api; }
})();
