// src/pkjs/line-alert.js — ES5. A forecast line's "Only alert": the wind speed, wind
// gust and UV index lines (the graph metrics with Alert levels) can each be drawn only
// where the value reaches the metric's warn level. THE one reading of the setting and
// of the scale it puts the line on, for the bake (forecast-series.js), the render
// signature, and the settings page (the row's hint, the style hint's scale, the
// forecast preview), so the three can never disagree.
//
// Phone-side only, by design: a sample below the warn level ships as wire byte 0, which
// the watch already draws as "no value" on the metric lines (forecast-series.js' WIRE
// INVARIANT, chart.c's zero_absent breaks the polyline into runs), and a sample at or
// above it is scaled from the band's bottom to its top. No watch code, no wire format.
//
// THE BAND (alertBand). Bottom: the metric's warn level in the series' unit (km/h for
// wind and gusts, UV x 10 for UV). Top: the scale the line has without the setting (the
// Wind graph scale for wind and gusts, UV 11 for UV). Wind and gusts share one scale, so
// when BOTH are drawn with "Only alert" they share one band: the lower warn level is the
// bottom, so the two lines stay comparable. A warn level at or above the top leaves no
// usable range: the top is then the highest danger level of the band's metrics, else
// that warn level + 50 %. A line drawn normally beside an "Only alert" one keeps its own
// 0-based scale, and the "Only alert" one its own bottom.
//
// Dual-context: a CommonJS module on the phone and in the tests, a plain concatenated
// <script> in the settings-page webview (scripts/build-config-page.js' APP_FILES, after
// status-thresholds.js and line-style.js, which it reads at load), which has no require().
(function () {
    var thresholds = (typeof require !== 'undefined')
        ? require('./status-thresholds.js') : window.StatusThresholds;
    var lineStyle = (typeof require !== 'undefined')
        ? require('./line-style.js') : window.LineStyle;

    // windScale -> the km/h value at the top of the graph. Wind and gusts share it, so a
    // gust line always reads as >= the wind line. forecast-series.js re-exports it (the
    // settings page's scale hints read it there at build time).
    var WIND_SCALE_KMH = { low: 30, mid: 50, high: 70 };
    // UV full scale in the series' unit, tenths (UV x 10): UV 11 maps to the graph top.
    var UV_FULL_SCALE_TENTHS = 110;
    // A wind unit (status-thresholds' scaleVariant) -> km/h per unit. Mirrors
    // wire-units.js' MPH_TO_KMH / KNOTS_TO_KMH, which the page does not load; a test
    // holds the two equal, and shownNumber to wire-units' slot reading.
    var KMH_PER_WIND_UNIT = { kph: 1, mph: 1.60934, kn: 1.852 };

    // The metrics a line can draw "Only alert", each with its setting and its Alert
    // levels' key stem. `wind`: it rides the Wind graph scale.
    var METRICS = {
        wind: { key: 'windLineOnlyAlert', stem: 'Wind', wind: true },
        gust: { key: 'gustLineOnlyAlert', stem: 'Gust', wind: true },
        uv: { key: 'uvLineOnlyAlert', stem: 'Uv', wind: false }
    };
    var METRIC_IDS = ['wind', 'gust', 'uv'];

    /**
     * @param {*} metric A graph metric id.
     * @returns {?Object} its METRICS entry; null for a metric without "Only alert"
     */
    function metaOf(metric) {
        return (typeof metric === 'string' && Object.prototype.hasOwnProperty.call(METRICS, metric))
            ? METRICS[metric] : null;
    }

    /**
     * @param {*} metric A graph metric id.
     * @returns {?string} its "Only alert" setting key, e.g. 'windLineOnlyAlert'; null
     *     for a metric without one
     */
    function settingKey(metric) {
        var meta = metaOf(metric);
        return meta ? meta.key : null;
    }

    /**
     * Whether a metric's line is set to "Only alert" (stored true; absent reads off).
     * @param {Object} settings Clay settings blob.
     * @param {*} metric A graph metric id.
     * @returns {boolean}
     */
    function onlyAlertOn(settings, metric) {
        var meta = metaOf(metric);
        return Boolean(meta) && Boolean(settings) && settings[meta.key] === true;
    }

    /**
     * How many series units one display unit is: km/h per wind unit for wind and
     * gusts, 10 for UV (the series carries UV x 10).
     * @param {Object} settings Clay settings blob (windUnits).
     * @param {string} metric 'wind' | 'gust' | 'uv'.
     * @returns {number}
     */
    function seriesPerDisplayUnit(settings, metric) {
        var meta = metaOf(metric);
        if (!meta.wind) { return 10; }
        return KMH_PER_WIND_UNIT[thresholds.scaleVariant(meta.stem, settings)];
    }

    /**
     * The number a series value shows as, in the metric's display unit, rounded the way
     * the slot and the alert read it (wire-units.js DAY_MAX_READERS: kph passes through,
     * mph and knots round, UV rounds the tenths to a whole index), so the line gaps
     * exactly where the alert would not fire.
     * @param {Object} settings Clay settings blob (windUnits).
     * @param {string} metric 'wind' | 'gust' | 'uv'.
     * @param {number} v Series value (km/h, or UV x 10).
     * @returns {number}
     */
    function shownNumber(settings, metric, v) {
        if (!metaOf(metric).wind) { return Math.round(v / 10); }
        var perUnit = seriesPerDisplayUnit(settings, metric);
        return perUnit === 1 ? v : Math.round(v / perUnit);
    }

    /**
     * A metric's level (the resolved Alert levels pair: stored when usable, else the
     * seed) in the series' unit.
     * @param {Object} settings Clay settings blob.
     * @param {string} metric 'wind' | 'gust' | 'uv'.
     * @param {string} which 'warn' | 'danger'.
     * @returns {number}
     */
    function levelInSeries(settings, metric, which) {
        var pair = thresholds.resolvedPair(metaOf(metric).stem, settings);
        return pair[which] * seriesPerDisplayUnit(settings, metric);
    }

    /**
     * Whether one sample reaches the metric's warn level: its shown number at or above
     * warn, the alert's own test (status-wire.js levelOf). A zero never does: on these
     * zero-based lines zero means "nothing" (wire byte 0), whatever the warn level.
     * @param {Object} settings Clay settings blob.
     * @param {string} metric 'wind' | 'gust' | 'uv'.
     * @param {number} v Series value (km/h, or UV x 10).
     * @returns {boolean}
     */
    function reachesWarn(settings, metric, v) {
        if (!(v > 0)) { return false; }
        var warn = thresholds.resolvedPair(metaOf(metric).stem, settings).warn;
        return shownNumber(settings, metric, v) >= warn;
    }

    /**
     * The top of a metric's scale without "Only alert", in the series' unit.
     * @param {Object} settings Clay settings blob (windScale).
     * @param {string} metric 'wind' | 'gust' | 'uv'.
     * @returns {number}
     */
    function scaleTop(settings, metric) {
        if (!metaOf(metric).wind) { return UV_FULL_SCALE_TENTHS; }
        var scale = settings && settings.windScale;
        return Object.prototype.hasOwnProperty.call(WIND_SCALE_KMH, scale)
            ? WIND_SCALE_KMH[scale] : WIND_SCALE_KMH.mid;
    }

    /**
     * The metrics the watch draws: each forecast line's effective metric (line-style.js
     * effectiveLineMetric — off and repeat-of-an-earlier-line draw nothing), the Third
     * and Fourth metric lines only on a watch that carries them (WW_LINE_STYLE, not
     * aplite).
     * @param {Object} settings Clay settings blob.
     * @param {boolean} allLines The watch draws the Third and Fourth metric lines.
     * @returns {string[]} Drawn metric ids, in line order.
     */
    function drawnMetrics(settings, allLines) {
        var out = [];
        for (var i = 0; i < lineStyle.FORECAST_LINES.length; i++) {
            if (i >= 2 && !allLines) { break; }
            var m = lineStyle.effectiveLineMetric(settings, lineStyle.FORECAST_LINES[i].key);
            if (m) { out.push(m); }
        }
        return out;
    }

    /**
     * The band a drawn "Only alert" line is scaled over, in the series' unit (see the
     * header): null for a metric that is not set to "Only alert".
     * @param {Object} settings Clay settings blob.
     * @param {string} metric A graph metric id.
     * @param {string[]} drawn The metrics the watch draws (drawnMetrics).
     * @returns {?{bottom: number, top: number}}
     */
    function alertBand(settings, metric, drawn) {
        if (!onlyAlertOn(settings, metric)) { return null; }
        var members = [metric];
        if (metaOf(metric).wind) {
            var other = metric === 'wind' ? 'gust' : 'wind';
            if (drawn.indexOf(other) !== -1 && onlyAlertOn(settings, other)) { members.push(other); }
        }
        var bottom = Infinity, highestWarn = -Infinity, highestDanger = -Infinity;
        for (var i = 0; i < members.length; i++) {
            var warn = levelInSeries(settings, members[i], 'warn');
            var danger = levelInSeries(settings, members[i], 'danger');
            if (warn < bottom) { bottom = warn; }
            if (warn > highestWarn) { highestWarn = warn; }
            if (danger > highestDanger) { highestDanger = danger; }
        }
        var top = scaleTop(settings, metric);
        if (top <= highestWarn) {
            top = highestDanger > highestWarn ? highestDanger : highestWarn * 1.5;
        }
        // A warn level at or below zero cannot leave top <= bottom above, but a stored
        // pair can hold anything: keep a range to divide by.
        if (top <= bottom) { top = bottom + 1; }
        return { bottom: bottom, top: top };
    }

    /**
     * Every drawn "Only alert" line's band, by metric.
     * @param {Object} settings Clay settings blob.
     * @param {boolean} allLines The watch draws the Third and Fourth metric lines.
     * @returns {Object<string, {bottom: number, top: number}>} {} when none is on.
     */
    function alertBands(settings, allLines) {
        var drawn = drawnMetrics(settings, allLines);
        var out = {};
        for (var i = 0; i < drawn.length; i++) {
            var band = alertBand(settings, drawn[i], drawn);
            if (band) { out[drawn[i]] = band; }
        }
        return out;
    }

    /**
     * An "Only alert" line's permille series: null where a sample does not reach the
     * warn level (the gap, wire byte 0), else its place in the band, 0..1000. The caller
     * floors the non-null values off zero (forecast-series.js metricBytes) so a sample
     * exactly at the bottom still draws.
     * @param {Object} settings Clay settings blob.
     * @param {string} metric 'wind' | 'gust' | 'uv'.
     * @param {Array.<*>} values Series values (km/h, or UV x 10).
     * @param {{bottom: number, top: number}} band alertBand's answer.
     * @returns {Array.<?number>}
     */
    function alertPermille(settings, metric, values, band) {
        var span = band.top - band.bottom;
        return (values || []).map(function (raw) {
            var v = Number(raw) || 0;
            if (!reachesWarn(settings, metric, v)) { return null; }
            var pm = Math.round((v - band.bottom) / span * 1000);
            return pm < 0 ? 0 : (pm > 1000 ? 1000 : pm);
        });
    }

    /**
     * A series-unit value as the settings page prints it: the wind units' whole number
     * plus its unit ('40 kph'), or the UV index ('UV 6', one decimal where it has one).
     * @param {Object} settings Clay settings blob (windUnits).
     * @param {string} metric 'wind' | 'gust' | 'uv'.
     * @param {number} v Series value (km/h, or UV x 10).
     * @returns {string}
     */
    function levelText(settings, metric, v) {
        var meta = metaOf(metric);
        if (!meta.wind) { return 'UV ' + Math.round(v) / 10; }
        var variant = thresholds.scaleVariant(meta.stem, settings);
        return Math.round(v / KMH_PER_WIND_UNIT[variant]) + ' ' + variant;
    }

    /**
     * A metric's warn level as the settings page prints it (levelText): '40 kph', 'UV 6'.
     * @param {Object} settings Clay settings blob (windUnits, the Alert levels pair).
     * @param {string} metric 'wind' | 'gust' | 'uv'.
     * @returns {string}
     */
    function warnText(settings, metric) {
        return levelText(settings, metric, levelInSeries(settings, metric, 'warn'));
    }

    /**
     * What the render signature signs: the drawn metrics set to "Only alert", on a watch
     * that draws every line (the bake's platform gate at worst costs aplite one
     * redundant fetch). Each band's other inputs — the lines, windScale, windUnits and
     * the resolved Alert levels pairs — are signed on their own.
     * @param {Object} settings Clay settings blob.
     * @returns {string} e.g. 'wind,uv'; '' for none.
     */
    function signature(settings) {
        var drawn = drawnMetrics(settings, true);
        var out = [];
        for (var i = 0; i < drawn.length; i++) {
            if (onlyAlertOn(settings, drawn[i])) { out.push(drawn[i]); }
        }
        return out.join(',');
    }

    var api = {
        WIND_SCALE_KMH: WIND_SCALE_KMH,
        UV_FULL_SCALE_TENTHS: UV_FULL_SCALE_TENTHS,
        KMH_PER_WIND_UNIT: KMH_PER_WIND_UNIT,
        METRIC_IDS: METRIC_IDS,
        settingKey: settingKey,
        onlyAlertOn: onlyAlertOn,
        shownNumber: shownNumber,
        reachesWarn: reachesWarn,
        scaleTop: scaleTop,
        drawnMetrics: drawnMetrics,
        alertBand: alertBand,
        alertBands: alertBands,
        alertPermille: alertPermille,
        levelText: levelText,
        warnText: warnText,
        signature: signature
    };

    // Dual-context export — mirrors the tail of src/pkjs/line-style.js.
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    if (typeof window !== 'undefined') {
        window.LineAlert = api;
    }
})();
