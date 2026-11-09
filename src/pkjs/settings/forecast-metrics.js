// src/pkjs/settings/forecast-metrics.js — ES5. The forecast graph's eight metrics in picker
// order, each by the name its pickers show (forecast-hints.js forecastMetric, the Lines card's
// summaries in blocks.js, schema.js' Graph colors rows, the five-metric limit's words) and by
// the words a sentence names it with (the templates' words, wizard-forecast.js THE WORDS). One
// table: a metric added here is named everywhere the page names one (line-style.js
// GRAPH_METRICS holds the same eight, test/line-style.test.js).
//
// Dual-context: a CommonJS module in the tests, a plain concatenated <script> in the settings-page
// webview (scripts/build-config-page.js APP_FILES, ahead of graph-styles-page.js, forecast-hints.js,
// blocks.js and wizard-forecast.js, which bind window.ForecastMetrics while their bodies run),
// which has no require(). It reads nothing.
(function () {
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
     * The metric pickers' options in picker order.
     * @returns {Array<Array<string>>} [label, id] pairs
     */
    function options() {
        return METRICS.map(function (m) { return [m.label, m.id]; });
    }

    var api = { METRICS: METRICS, label: label, words: words, options: options };

    // Dual-context export — mirrors the tail of src/pkjs/forecast-axis.js.
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    if (typeof window !== 'undefined') {
        window.ForecastMetrics = api;
    }
})();
