// src/pkjs/page/weather/weather-sources-page.js — ES5. Where the weather comes from, on the
// settings page (Setup › Data sources): the note under the Weather picker that names the
// readings coming from Open-Meteo (weatherFillNote, a staticText's textFrom; its row is
// weather-sources-schema.js FILL_NOTE). They are the source plan's fills, by the phone's own
// rules: the readings the picked provider lacks (source-plan.js fills) that the watch draws
// (drawn-readings.js).
//
// Dual-context: a CommonJS module in the tests, a plain concatenated <script> in the settings
// page (scripts/build-config-page.js APP_FILES, after provider-readings.js, source-plan.js and
// drawn-readings.js, which it binds while its body runs; window.WeatherSourcesPage). At load it
// reads the page's html helpers (config-ui/lib/html.js, concatenated ahead of every app file).
(function () {
    var node = typeof require !== 'undefined';
    var PConf = (typeof global !== 'undefined' && global.PConf) ? global.PConf
        : (typeof window !== 'undefined' && window.PConf) ? window.PConf
        : null;
    var sourcePlan = node ? require('../../weather/domain/source-plan.js') : window.SourcePlan;
    var drawnReadings = node ? require('../../weather/domain/drawn-readings.js') : window.DrawnReadings;
    var html = node ? require('../../config-ui/lib/html.js') : PConf.html;

    // Each reading as a sentence names it (provider-readings.js READINGS).
    var WORDS = { temperature: 'temperature', dew: 'dew point', rain: 'rain', wind: 'wind',
        windDir: 'wind direction', uv: 'UV index', cloud: 'cloud cover', pressure: 'air pressure',
        condition: 'weather condition' };
    // Each weather service as a sentence names it: the Weather picker's names, DWD's short one.
    var NAMES = { dwd: 'DWD', metno: 'Met.no', openmeteo: 'Open-Meteo', openweathermap: 'OpenWeatherMap',
        tomorrowio: 'Tomorrow.io', wunderground: 'Weather Underground', yandex: 'Yandex Weather' };

    /**
     * The note under the Weather picker: which readings the watch draws that the picked
     * provider sends none of, and that they come from Open-Meteo. "Sends no", as the page's
     * other gap sentences say it (forecast-metrics.js gapSentence).
     * @param {Object} S Settings.
     * @param {Object} env Platform env.
     * @returns {string} HTML; '' while nothing comes from Open-Meteo
     */
    function fillNote(S, env) {
        var provider = S && S.provider;
        if (!Object.prototype.hasOwnProperty.call(NAMES, provider)) { return ''; }
        var drawn = drawnReadings.drawn(S, env || {});
        var filled = sourcePlan.fills(provider, drawn.indexOf('uv') !== -1, drawn);
        if (!filled.length) { return ''; }
        var words = filled.map(function (id) { return WORDS[id]; });
        return html.esc(NAMES[provider] + ' sends no ' + html.andList(words, 'or') + ', so '
            + (filled.length > 1 ? 'they come' : 'it comes') + ' from Open-Meteo.');
    }

    if (PConf && PConf.hintResolvers) {
        PConf.hintResolvers.register('weatherFillNote', fillNote);
    }

    var api = { WORDS: WORDS, NAMES: NAMES, fillNote: fillNote };
    if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
    if (typeof window !== 'undefined') { window.WeatherSourcesPage = api; }
})();
