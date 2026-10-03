// src/pkjs/draw-from.js — ES5. Draw from / Bars from [Bottom | Top]: where a forecast
// line of an amount metric, the forecast's rain bars and the radar graph's rain bars
// start. Bottom (the default) stands them on the graph's bottom, as always; Top hangs
// them from the top of the graph, a bigger value reaching further down. THE one reading
// of the six settings, for the wire (weather/graph-wire.js, which encodes it), telemetry
// and the settings page (which picker a Draw from row sits under, the rows' hints, the
// Visible values: Alert scale hint, the forecast and radar previews), so they can never
// disagree.
//
// THE SETTINGS. One key per amount metric with a real zero (line-style.js
// STRIPE_METRIC_IDS: rain chance, clouds, wind, gusts, UV), except that wind speed and
// wind gusts share one (windLineFrom): they share the Wind graph scale and, on Visible
// values: Alert, one band, and drawn in opposite directions they would cross in a gale.
// Plus one key per chart's rain bars. Each holds 'bottom' or 'top'; only the exact string
// 'top' means Top, so an absent key or junk reads Bottom and no migration is needed. Not
// for temperature, feels-like, dew point or pressure, nor for health: they never hang.
//
// PER METRIC, NOT PER LINE. The choice follows its metric from picker to picker (as the
// Visible values row and the graph colours do). A line hangs only while the watch draws
// line styles (WW_LINE_STYLE: not aplite), the line is drawn (line-style.js
// effectiveLineMetric) and is not a stripe (a stripe keeps its own Top/Bottom). A stored
// Top on a line that is not drawn, or now a stripe, lies dormant: kept, but sent as
// Bottom, and back the moment the line draws as a line again. The bars' flag is a pure
// function of its key (and the watch), independent of barSource and radarMode: inert
// while those bars are off, and toggling them never changes the palette bytes.
//
// THE ANCHORED EDGES (owner, 2026-10-02). Whatever is drawn from an edge of the forecast
// graph anchors it: the rain bars (while barSource draws them) and every drawn amount line,
// its marks or the Main metric's fill (not a stripe, which keeps a band of its own), but only
// while it has a value above 0 in the hours the graph draws: an all-zero one draws nothing
// and the graph lays out as if it were not there. On an anchored edge the temperature curve
// and the lines sharing its axis keep a margin of at least an eighth of the plot, or from 64
// rows on its height squared over TEMP_AXIS_PAD_SQ_DIV, a share that grows with the plot
// (src/c/appendix/temp_axis_pad.h); forecastAnchors is that reading for the settings preview,
// which supplies the data half (its samples). The watch reads the bars' edge off their
// palette and a line's off its style byte: a Top bit for the edge, and a float bit on a
// drawn line that anchors nothing, its metric having no zero to stand on (pressure,
// feels-like, dew point: every metric without a Draw from key). lineEdge is that reading
// of one line, for the wire and the page alike. The bits and where they ride:
// weather/graph-wire.js.
//
// THE WATCH. Every reading takes the watch as `env`, config-ui platform.js computeEnv()
// facts (the phone's of the connected watch, or the settings page's own); only its
// `lineStyles` is read, and only an explicit false (aplite) is incapable (capable).
//
// Settings-derived and never baked: forecast-series.js reads none of it, so the keys stay
// out of render-signature.js and a flip is a Clay-only resend, no weather fetch.
//
// Dual-context: a CommonJS module on the phone and in the tests, a plain concatenated
// <script> in the settings-page webview (scripts/build-config-page.js' APP_FILES, after
// line-style.js, which it reads at load, and ahead of the previews and forecast-hints.js,
// which read it at theirs), which has no require().
(function () {
    var lineStyle = (typeof require !== 'undefined')
        ? require('./line-style.js') : window.LineStyle;

    // The two values.
    var BOTTOM = 'bottom';
    var TOP = 'top';
    // lineEdge's answer for a drawn line that anchors no edge (see the header).
    var FLOAT = 'float';
    // The keys, one settings-page Draw from row each, with the metrics each one flips.
    // Wind and gusts share one (see the header). The metrics are exactly line-style.js
    // STRIPE_METRIC_IDS, in its order (a test holds the two equal).
    var ROWS = [
        { key: 'precipLineFrom', metrics: ['precip_prob'] },
        { key: 'cloudLineFrom', metrics: ['cloud'] },
        { key: 'windLineFrom', metrics: ['wind', 'gust'] },
        { key: 'uvLineFrom', metrics: ['uv'] }
    ];
    // A line metric -> its setting key, read off ROWS.
    var LINE_KEYS = {};
    for (var r = 0; r < ROWS.length; r++) {
        for (var m = 0; m < ROWS[r].metrics.length; m++) {
            LINE_KEYS[ROWS[r].metrics[m]] = ROWS[r].key;
        }
    }
    // A chart -> its Bars from key.
    var BAR_KEYS = { rain: 'rainBarFrom', radar: 'radarBarFrom' };

    /**
     * @param {Object} table A lookup table.
     * @param {*} key A key.
     * @returns {boolean} Whether `key` is one of the table's OWN keys (a stored value
     *   like 'constructor' must not reach an Object.prototype member).
     */
    function owns(table, key) {
        return typeof key === 'string' && Object.prototype.hasOwnProperty.call(table, key);
    }

    /**
     * A stored value as the graph reads it: Top only for the exact string 'top'.
     * @param {*} v The stored value.
     * @returns {string} TOP or BOTTOM.
     */
    function value(v) {
        return v === TOP ? TOP : BOTTOM;
    }

    /**
     * @param {*} metric A graph metric id.
     * @returns {?string} Its Draw from key, e.g. 'windLineFrom' for gusts; null for a
     *   metric without one (temperature, feels-like, dew point, pressure, junk).
     */
    function settingKey(metric) {
        return owns(LINE_KEYS, metric) ? LINE_KEYS[metric] : null;
    }

    /**
     * Whether a watch draws anything from the top: every watch with line styles (the
     * WW_LINE_STYLE mirror). Only an explicit lineStyles false (aplite) is incapable, so
     * an unknown watch reads capable, as computeEnv(null) does.
     * @param {?Object} [env] config-ui platform.js computeEnv() facts (`lineStyles`).
     * @returns {boolean}
     */
    function capable(env) {
        return !(env && env.lineStyles === false);
    }

    /**
     * Whether a metric's lines are set to hang from the top on this watch: its key reads
     * Top. Says nothing about whether such a line is drawn, or is a stripe (lineEdge).
     * @param {Object} settings Clay settings blob.
     * @param {*} metric A graph metric id.
     * @param {?Object} [env] Platform env (capable).
     * @returns {boolean}
     */
    function metricFromTop(settings, metric, env) {
        var key = settingKey(metric);
        return capable(env) && key !== null && value((settings || {})[key]) === TOP;
    }

    /**
     * The edge one forecast line is drawn from, as the wire sends it (graph-wire.js
     * styleByte): for a line the watch draws as a line or marks (it draws line styles, the
     * line is not off, not a repeat of an earlier picker's metric, not a stripe), its
     * metric's key's TOP or BOTTOM, or FLOAT for a metric without a key (pressure,
     * feels-like, dew point), which anchors no edge. Null for every other line: not drawn,
     * a stripe (it keeps its own Top/Bottom), or a watch without line styles.
     * @param {Object} settings Clay settings blob.
     * @param {string} lineKey secondaryLine|thirdLine|fourthLine|fifthLine.
     * @param {?Object} [env] Platform env (capable).
     * @returns {?string} TOP, BOTTOM, FLOAT or null.
     */
    function lineEdge(settings, lineKey, env) {
        var s = settings || {};
        var metric = lineStyle.effectiveLineMetric(s, lineKey);
        if (!capable(env) || metric === null || lineStyle.isStripeStyle(s, lineKey + 'Style')) {
            return null;
        }
        var key = settingKey(metric);
        return key === null ? FLOAT : value(s[key]);
    }

    /**
     * @param {?string} edge A lineEdge answer.
     * @returns {boolean} Whether it anchors an edge of the graph: TOP or BOTTOM.
     */
    function anchors(edge) {
        return edge === TOP || edge === BOTTOM;
    }

    /**
     * The anchored edges of the forecast graph (see the header): the rain bars' edge while
     * barSource draws them, and each drawn amount line's, each only while it has a value above
     * 0 (`hasValue`; the watch's one scan, temp_axis_pad.h temp_axis_any_above_zero). Nothing
     * on a watch without line styles (aplite keeps its frozen margins).
     * @param {Object} settings Clay settings blob.
     * @param {?Object} [env] Platform env (capable).
     * @param {function(string): boolean} [hasValue] Whether an element has a value above 0 in
     *   the hours drawn: called with 'bars' for the rain bars, else with the line's key
     *   (secondaryLine|thirdLine|fourthLine|fifthLine). Absent, every element has one.
     * @returns {{top: boolean, bottom: boolean}}
     */
    function forecastAnchors(settings, env, hasValue) {
        var s = settings || {};
        var out = { top: false, bottom: false };
        var has = hasValue || function () { return true; };
        if (!capable(env)) { return out; }
        if (s.barSource === 'rain' && has('bars')) {
            out[barsFromTop(s, 'rain', env) ? TOP : BOTTOM] = true;
        }
        for (var i = 0; i < lineStyle.FORECAST_LINES.length; i++) {
            var key = lineStyle.FORECAST_LINES[i].key;
            var edge = lineEdge(s, key, env);
            if (anchors(edge) && has(key)) { out[edge] = true; }
        }
        return out;
    }

    /**
     * The forecast lines that read one Draw from key on this watch, in line order: each
     * drawn from an edge (lineEdge TOP or BOTTOM) by a metric with that key.
     * @param {Object} settings Clay settings blob.
     * @param {string} rowKey A Draw from key.
     * @param {?Object} [env] Platform env (capable).
     * @returns {string[]} Line keys (secondaryLine|thirdLine|fourthLine|fifthLine).
     */
    function linesOfRow(settings, rowKey, env) {
        var out = [];
        for (var i = 0; i < lineStyle.FORECAST_LINES.length; i++) {
            var key = lineStyle.FORECAST_LINES[i].key;
            if (anchors(lineEdge(settings, key, env))
                && settingKey(lineStyle.effectiveLineMetric(settings, key)) === rowKey) {
                out.push(key);
            }
        }
        return out;
    }

    /**
     * The line a Draw from key's row sits under on the settings page: the first line that
     * reads the key (linesOfRow), so the row follows its metric from picker to picker and
     * hides while no line reads it (a stored Top lies dormant then).
     * @param {Object} settings Clay settings blob.
     * @param {string} rowKey A Draw from key.
     * @param {?Object} [env] Platform env (capable).
     * @returns {?string} A line key, or null.
     */
    function rowLine(settings, rowKey, env) {
        var lines = linesOfRow(settings, rowKey, env);
        return lines.length ? lines[0] : null;
    }

    /**
     * How many drawn lines, not stripes, read one Draw from key on this watch: 2 for
     * windLineFrom with a wind and a gust line both drawn as lines, else 0 or 1. The
     * page's Top hint speaks of both lines then.
     * @param {Object} settings Clay settings blob.
     * @param {string} rowKey A Draw from key.
     * @param {?Object} [env] Platform env (capable).
     * @returns {number}
     */
    function linesSharing(settings, rowKey, env) {
        return linesOfRow(settings, rowKey, env).length;
    }

    /**
     * Whether a chart's rain bars hang from the top on this watch: its Bars from key
     * reads Top. Independent of barSource and radarMode (see the header).
     * @param {Object} settings Clay settings blob.
     * @param {string} chart 'rain' (the forecast's bars) | 'radar' (the radar graph's).
     * @param {?Object} [env] Platform env (capable).
     * @returns {boolean}
     */
    function barsFromTop(settings, chart, env) {
        return capable(env) && owns(BAR_KEYS, chart)
            && value((settings || {})[BAR_KEYS[chart]]) === TOP;
    }

    var api = {
        BOTTOM: BOTTOM,
        TOP: TOP,
        FLOAT: FLOAT,
        ROWS: ROWS,
        BAR_KEYS: BAR_KEYS,
        value: value,
        settingKey: settingKey,
        capable: capable,
        metricFromTop: metricFromTop,
        lineEdge: lineEdge,
        forecastAnchors: forecastAnchors,
        rowLine: rowLine,
        linesSharing: linesSharing,
        barsFromTop: barsFromTop
    };

    // Dual-context export — mirrors the tail of src/pkjs/line-alert.js.
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    if (typeof window !== 'undefined') {
        window.DrawFrom = api;
    }
})();
