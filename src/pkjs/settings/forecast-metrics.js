// src/pkjs/settings/forecast-metrics.js — ES5. The forecast graph's eight metrics in picker
// order, each by the name its pickers show (forecast-hints.js forecastMetric, the Lines card's
// summaries in blocks.js, schema.js' Graph colors rows, the five-metric limit's words) and by
// the words a sentence names it with (the templates' words, wizard-forecast.js THE WORDS). One
// table: a metric added here is named everywhere the page names one (line-style.js
// GRAPH_METRICS holds the same eight, test/line-style.test.js).
//
// The metrics each weather service leaves out (GAPS) are here too: the metric pickers say so
// (forecast-hints.js forecastMetricHint), and so does Add a screen's picked screen (screen-presets.js
// explain).
//
// Dual-context: a CommonJS module in the tests, a plain concatenated <script> in the settings-page
// webview (scripts/build-config-page.js APP_FILES, ahead of graph-styles-page.js, forecast-hints.js,
// blocks.js and wizard-forecast.js, which bind window.ForecastMetrics while their bodies run),
// which has no require(). At load it reads the page's html helpers (config-ui/lib/html.js,
// concatenated ahead of every app file).
(function () {
    // Names as a sentence lists them.
    var html = typeof require !== 'undefined' ? require('../config-ui/lib/html.js') : window.PConf.html;
    var METRICS = [
        { id: 'precip_prob', label: 'Precipitation %', words: 'rain chance' },
        { id: 'cloud', label: 'Cloud cover %', words: 'clouds' },
        { id: 'wind', label: 'Wind speed', words: 'wind' },
        { id: 'gust', label: 'Wind gusts', words: 'gusts' },
        { id: 'uv', label: 'UV Index', words: 'UV index' },
        { id: 'pressure', label: 'Air pressure (hPa)', words: 'air pressure' },
        { id: 'feels', label: 'Feels-like temperature', words: 'feels-like temperature' },
        { id: 'dew', label: 'Dew point', words: 'dew point' }
    ];

    // The metrics a weather service doesn't send, by its id: `who` names it in a sentence, `note`
    // is the metric picker's hint while it is the service. Met.no sends rain chance and gusts for
    // the Nordics only.
    var GAPS = {
        yandex: { metrics: ['cloud', 'pressure', 'dew'], who: 'Yandex', note: 'Not available with Yandex.' },
        metno: { metrics: ['precip_prob', 'gust'], who: 'Met.no outside the Nordics',
            note: 'Not available with Met.no outside the Nordics.' }
    };

    /**
     * A metric by its id.
     * @param {*} id A metric id.
     * @returns {?{id: string, label: string, words: string}}
     */
    function byId(id) {
        for (var i = 0; i < METRICS.length; i++) {
            if (METRICS[i].id === id) { return METRICS[i]; }
        }
        return null;
    }

    /**
     * A metric as its pickers name it ("Precipitation %"); the id itself for one the table lacks.
     * @param {*} id A metric id.
     * @returns {string}
     */
    function label(id) {
        var m = byId(id);
        return m ? m.label : String(id);
    }

    /**
     * A metric as a sentence names it ("rain chance"); the id itself for one the table lacks.
     * @param {*} id A metric id.
     * @returns {string}
     */
    function words(id) {
        var m = byId(id);
        return m ? m.words : String(id);
    }

    /**
     * The metrics a weather service doesn't send (GAPS), OWN keys only: a stored value like
     * 'constructor' finds none.
     * @param {*} provider A weather service's id (the `provider` setting).
     * @returns {?{metrics: string[], who: string, note: string}}
     */
    function gapOf(provider) {
        return typeof provider === 'string' && Object.prototype.hasOwnProperty.call(GAPS, provider) ? GAPS[provider] : null;
    }

    /**
     * What a graph's metrics miss with a weather service, as a sentence says it: "Yandex sends no
     * clouds or air pressure."
     * @param {*} provider A weather service's id.
     * @param {string[]} ids The metrics a graph draws.
     * @returns {string} '' when the service sends them all
     */
    function gapSentence(provider, ids) {
        var gap = gapOf(provider);
        var missed = gap ? ids.filter(function (id) { return gap.metrics.indexOf(id) !== -1; }).map(words) : [];
        return missed.length ? gap.who + ' sends no ' + html.andList(missed, 'or') + '.' : '';
    }

    /**
     * The metric pickers' options in picker order.
     * @returns {Array<Array<string>>} [label, id] pairs
     */
    function options() {
        return METRICS.map(function (m) { return [m.label, m.id]; });
    }

    var api = { METRICS: METRICS, label: label, words: words, options: options, gapOf: gapOf, gapSentence: gapSentence };

    // Dual-context export — mirrors the tail of src/pkjs/forecast-axis.js.
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    if (typeof window !== 'undefined') {
        window.ForecastMetrics = api;
    }
})();
