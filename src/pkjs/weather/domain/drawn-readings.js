// src/pkjs/weather/domain/drawn-readings.js — ES5, watch runtime and settings page.
//
// The readings only some screens draw, and whether the watch draws each now: UV, the dew point,
// the wind direction, the cloud cover and the air pressure (provider-readings.js READINGS). A
// forecast line draws a metric (line-style.js firstDrawnLine, THE walk over the lines; on a
// watch sent graph styles' records, the union of the shown styles' rows: graph-styles.js
// assign), a status slot or a placed alert shows one (shown), and the wind and gust slots draw
// the wind's direction as an arrow where it is on (status-lines.js arrowSector). The
// temperature, the rain, the wind and the condition are in every forecast every provider
// sends.
//
// The fetch options carry the list (fetch-options.js drawn, and fetchUv: whether it holds UV).
// The source plan asks for a reading on it, and fills one its provider lacks, only while it is
// drawn (source-plan.js wanted, fillSteps); the settings page names the readings that come from
// Open-Meteo by the same rule (page/weather/weather-sources-page.js).
//
// Dual-context: a CommonJS module on the phone and in the tests, a plain <script> on the
// settings page (scripts/build-config-page.js APP_FILES, after the four modules it reads;
// window.DrawnReadings).
(function () {
    var node = typeof require !== 'undefined';
    var lineStyle = node ? require('../../forecast-graphs/domain/line-style.js') : window.LineStyle;
    var graphStyles = node ? require('../../forecast-graphs/domain/graph-styles.js') : window.GraphStyles;
    var statusCatalog = node ? require('../../status-bars/domain/status-line-catalog.js') : window.StatusLineCatalog;
    var statusThresholds = node ? require('../../alerts/domain/status-thresholds.js') : window.StatusThresholds;

    /**
     * Whether a forecast line the watch draws shows a metric. On a watch sent graph styles'
     * records, the rows of the shown styles' union (graph-style-wire.js weatherSettings bakes
     * the same rows); else the settings' own lines, the third and fourth metric lines only
     * where the watch draws them. A temperature-axis line (feels like, dew point) is never
     * drawn on aplite (forecast-series.js tempAxisLineDrawn).
     * @param {Object} settings Clay settings.
     * @param {Object} env Platform env (config-ui/lib/platform.js computeEnv).
     * @param {string} metric A line metric ('uv', 'dew', 'cloud', 'pressure', ...).
     * @returns {boolean}
     */
    function lineDraws(settings, env, metric) {
        if (env.platform === 'aplite' && lineStyle.TEMP_AXIS_METRIC_IDS.indexOf(metric) !== -1) { return false; }
        var styles = graphStyles.stylesSent(settings, env);
        if (styles.length) {
            return graphStyles.assign(settings, env, styles).rows.some(function (row) {
                return Boolean(row) && row.metric === metric;
            });
        }
        return lineStyle.firstDrawnLine(settings, env.lineStyles !== false,
            function (m) { return m === metric; }) !== null;
    }

    /**
     * Whether the watch wants a metric outside the forecast lines: a status slot shows it
     * (status-line-catalog.js selectedCodes, the bars the bake sends), or its alert is placed
     * (status-thresholds.js alertOn). A placed alert needs its metric with no slot showing it.
     * @param {Object} settings Clay settings.
     * @param {string} code A status item code ('uv', 'aqi', 'dew', 'pressure', ...).
     * @param {Object} env Platform env.
     * @returns {boolean}
     */
    function shown(settings, code, env) {
        return statusThresholds.alertOn(settings, code, env)
            || statusCatalog.selectedCodes(settings, env).indexOf(code) !== -1;
    }

    /**
     * Whether a wind or gust slot draws its arrow: the slot is shown and its Direction is on.
     * Never on aplite, whose status row draws no arrow.
     * @param {Object} settings Clay settings.
     * @param {Object} env Platform env.
     * @returns {boolean}
     */
    function arrowDrawn(settings, env) {
        if (env.platform === 'aplite') { return false; }
        var codes = statusCatalog.selectedCodes(settings, env);
        return (Boolean(settings.windSlotDirection) && codes.indexOf('wind') !== -1)
            || (Boolean(settings.gustSlotDirection) && codes.indexOf('gust') !== -1);
    }

    // Each reading only some screens draw, in the order of provider-readings.js READINGS, and
    // when the watch draws it.
    var RULES = [
        { id: 'dew', drawn: function (s, env) { return lineDraws(s, env, 'dew') || shown(s, 'dew', env); } },
        { id: 'windDir', drawn: arrowDrawn },
        { id: 'uv', drawn: function (s, env) { return lineDraws(s, env, 'uv') || shown(s, 'uv', env); } },
        { id: 'cloud', drawn: function (s, env) { return lineDraws(s, env, 'cloud'); } },
        { id: 'pressure', drawn: function (s, env) { return lineDraws(s, env, 'pressure') || shown(s, 'pressure', env); } }
    ];

    /**
     * The readings only some screens draw that the watch draws now.
     * @param {?Object} settings Clay settings; none draw nothing.
     * @param {Object} env Platform env.
     * @returns {string[]} provider-readings.js READINGS ids, in its order
     */
    function drawn(settings, env) {
        if (!settings) { return []; }
        return RULES.filter(function (rule) { return rule.drawn(settings, env); })
            .map(function (rule) { return rule.id; });
    }

    var api = {
        READING_IDS: RULES.map(function (rule) { return rule.id; }),
        drawn: drawn,
        shown: shown
    };
    if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
    if (typeof window !== 'undefined') { window.DrawnReadings = api; }
})();
