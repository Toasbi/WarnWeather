// src/pkjs/line-alert.js — ES5. A forecast line's Show [All | Alert]: the wind speed,
// wind gust and UV index lines (the graph metrics with Alert levels) can each be drawn
// whole (All) or only where the value reaches the metric's warn level (Alert). THE one
// reading of the setting and of the scale Alert puts the line on, for the bake
// (forecast-series.js), the render signature, telemetry and the settings page (the
// row's hint, the scale hints, the forecast preview), so they can never disagree.
//
// Phone-side only, by design: a sample below the warn level ships as wire byte 0, which
// the watch already draws as "no value" on the metric lines (forecast-series.js' WIRE
// INVARIANT, chart.c's zero_absent breaks the polyline into runs), and a sample at or
// above it is scaled from the band's bottom to its top (a line drawn as a stripe: its
// cell is shaded by the same place in the band, scalePercent). No watch code, no wire
// format.
// A watch without Alert settings (aplite: no WW_ON_DEMAND) hides the row and always
// draws All (alertsDrawn).
//
// THE SETTING. One key per metric (METRICS), holding 'all' or 'alert' (SHOW_ALL,
// SHOW_ALERT). The first build stored a switch there, true or false, which never
// shipped; showValue reads a dev phone's true as 'alert' and anything else as 'all', and
// the settings page writes the string back on its next Save (onbuild.js), no migration.
//
// THE BAND (alertBand). Bottom: the metric's warn level in the series' unit (km/h for
// wind and gusts, UV x 10 for UV). Top: the higher of the scale the line has with All
// (the Wind graph scale for wind and gusts, UV 11 for UV) and the metric's danger level,
// so the top never jumps as the levels or the scale move. Wind and gusts share one
// scale, so when BOTH are drawn with Alert they share one band: the lower warn level is
// the bottom, so the two lines stay comparable, and the top is the higher of the scale
// and the two danger levels. Only a band whose every level is one value at or above the
// scale (a danger level equal to its warn level, which the old text fields could store)
// has no range: its top is then one series unit above it (1 km/h, UV 0.1), next to the
// top the same pair one step apart gets (gusts 60/60 kph: 61, 60/61: 61), so nothing
// jumps there either. A line drawn All beside an Alert one keeps its own 0-based scale,
// and the Alert one its own band.
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

    // The metrics whose line has a Show row, each with its setting and its Alert levels'
    // key stem. `wind`: it rides the Wind graph scale. The keys keep the first build's
    // names (the switch was "Only alert"); only the stored type changed.
    var METRICS = {
        wind: { key: 'windLineOnlyAlert', stem: 'Wind', wind: true },
        gust: { key: 'gustLineOnlyAlert', stem: 'Gust', wind: true },
        uv: { key: 'uvLineOnlyAlert', stem: 'Uv', wind: false }
    };
    var METRIC_IDS = ['wind', 'gust', 'uv'];
    // The Show row's two values: every value (the default), or only where it reaches
    // the warn level.
    var SHOW_ALL = 'all';
    var SHOW_ALERT = 'alert';

    /**
     * @param {*} metric A graph metric id.
     * @returns {?Object} its METRICS entry; null for a metric without a Show row
     */
    function metaOf(metric) {
        return (typeof metric === 'string' && Object.prototype.hasOwnProperty.call(METRICS, metric))
            ? METRICS[metric] : null;
    }

    /**
     * @param {*} metric A graph metric id.
     * @returns {?string} its Show setting key, e.g. 'windLineOnlyAlert'; null for a
     *     metric without one
     */
    function settingKey(metric) {
        var meta = metaOf(metric);
        return meta ? meta.key : null;
    }

    /**
     * A stored Show value as the line draws it: 'alert' for 'alert', and for the true a
     * dev phone kept from the first build's switch; 'all' for anything else (absent,
     * 'all', that switch's false, junk).
     * @param {*} v The stored value.
     * @returns {string} SHOW_ALL or SHOW_ALERT.
     */
    function showValue(v) {
        return (v === SHOW_ALERT || v === true) ? SHOW_ALERT : SHOW_ALL;
    }

    /**
     * A metric line's Show choice (showValue of its key); 'all' for a metric without one.
     * @param {Object} settings Clay settings blob.
     * @param {*} metric A graph metric id.
     * @returns {string} SHOW_ALL or SHOW_ALERT.
     */
    function showOf(settings, metric) {
        var meta = metaOf(metric);
        return (meta && settings) ? showValue(settings[meta.key]) : SHOW_ALL;
    }

    /**
     * Whether a metric's line is set to Show: Alert (showOf).
     * @param {Object} settings Clay settings blob.
     * @param {*} metric A graph metric id.
     * @returns {boolean}
     */
    function onlyAlertOn(settings, metric) {
        return showOf(settings, metric) === SHOW_ALERT;
    }

    /**
     * Whether a watch draws a line's Show: Alert at all: every watch with Alert settings
     * (the config-UI env's onDemand, the WW_ON_DEMAND mirror). aplite has none, so the
     * page hides the row there and the line always draws All, whatever is stored. An env
     * without the fact (an unknown watch, a test's env) reads capable, as on-demand.js
     * facts() does.
     * @param {?Object} [env] config-ui platform.js computeEnv() facts.
     * @returns {boolean}
     */
    function alertsDrawn(env) {
        return !(env && env.onDemand === false);
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
     * The top of a metric's scale with Show: All, in the series' unit.
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
     * The band a drawn Show: Alert line is scaled over, in the series' unit (see the
     * header): null for a metric whose line shows All. `topDanger` names the metric whose
     * danger level tops the band, for the page's scale hints; null while the scale's own
     * top (or a no-range band's value + 1) is the top.
     * @param {Object} settings Clay settings blob.
     * @param {string} metric A graph metric id.
     * @param {string[]} drawn The metrics the watch draws (drawnMetrics).
     * @returns {?{bottom: number, top: number, topDanger: ?string}}
     */
    function alertBand(settings, metric, drawn) {
        if (!onlyAlertOn(settings, metric)) { return null; }
        var members = [metric];
        if (metaOf(metric).wind) {
            var other = metric === 'wind' ? 'gust' : 'wind';
            // In one fixed order, so the two lines' shared band is one and the same.
            if (drawn.indexOf(other) !== -1 && onlyAlertOn(settings, other)) { members = ['wind', 'gust']; }
        }
        var bottom = Infinity, highestDanger = -Infinity, dangerOf = null;
        for (var i = 0; i < members.length; i++) {
            var warn = levelInSeries(settings, members[i], 'warn');
            var danger = levelInSeries(settings, members[i], 'danger');
            if (warn < bottom) { bottom = warn; }
            if (danger > highestDanger) { highestDanger = danger; dangerOf = members[i]; }
        }
        // The higher of the scale's top and the danger level, so neither a level nor the
        // scale moving past the other makes the top jump.
        var top = scaleTop(settings, metric), topDanger = null;
        if (highestDanger > top) { top = highestDanger; topDanger = dangerOf; }
        // No range left only when every level is one value at or above the scale's top
        // (resolvedPair keeps danger >= warn): a danger level equal to its warn level, as
        // the old text fields could store. Keep a range to divide by: one series unit
        // above, next to the top the same pair one step apart gets (see the header).
        if (top <= bottom) { top = bottom + 1; topDanger = null; }
        return { bottom: bottom, top: top, topDanger: topDanger };
    }

    /**
     * Every drawn Show: Alert line's band, by metric. None on a watch without Alert
     * settings (alerts false: aplite), which draws every line All.
     * @param {Object} settings Clay settings blob.
     * @param {boolean} allLines The watch draws the Third and Fourth metric lines.
     * @param {boolean} [alerts] The watch draws Show: Alert (alertsDrawn); omitted reads
     *   true, a watch with Alert settings.
     * @returns {Object<string, {bottom: number, top: number, topDanger: ?string}>} {}
     *   when no drawn line shows Alert.
     */
    function alertBands(settings, allLines, alerts) {
        var out = {};
        if (alerts === false) { return out; }
        var drawn = drawnMetrics(settings, allLines);
        for (var i = 0; i < drawn.length; i++) {
            var band = alertBand(settings, drawn[i], drawn);
            if (band) { out[drawn[i]] = band; }
        }
        return out;
    }

    /**
     * A Show: Alert line's permille series: null where a sample does not reach the
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
     * Where one graph value sits on its line's scale, in percent: what a stripe cell is
     * shaded by (stripe-levels.js metricLevel), for the bake (forecast-series.js) and the
     * forecast preview alike. Rain chance and cloud cover are percentages already. A wind,
     * gust or UV value sits between 0 and the scale's top (scaleTop) on a line drawn All,
     * and between the band's bottom (the warn level) and its top on one drawn Alert, where
     * a sample below the warn level is null (the line's gap). Clamped to 0..100 and left
     * unrounded, so the stripe rounds it once.
     * @param {Object} settings Clay settings blob (windScale, windUnits, the Alert levels).
     * @param {string} metric 'precip_prob' | 'cloud' | 'wind' | 'gust' | 'uv'.
     * @param {*} v Series value (percent; km/h; UV x 10).
     * @param {?{bottom: number, top: number}} [band] The line's Show: Alert band (alertBand),
     *   or null for a line drawn All.
     * @returns {?number} Percent 0..100, or null below the warn level on an Alert line.
     */
    function scalePercent(settings, metric, v, band) {
        var n = Number(v) || 0;
        var pct;
        if (!metaOf(metric)) {
            pct = n;
        } else if (band) {
            if (!reachesWarn(settings, metric, n)) { return null; }
            pct = (n - band.bottom) / (band.top - band.bottom) * 100;
        } else {
            pct = n / scaleTop(settings, metric) * 100;
        }
        return pct < 0 ? 0 : (pct > 100 ? 100 : pct);
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
     * Where a step that starts at series value `v` starts, as the settings page prints
     * it: levelText of the smallest number N in the display unit such that every reading
     * shown as N or more (shownNumber) is at least `v`. In kph, and for UV (printed in
     * its tenths), that is levelText(v) itself. In mph and knots the number `v` converts
     * to can also show for a reading just below `v`, so N is then the next one up: the
     * gust stripe full from 86 km/h is "from 54 mph", since 85 km/h shows as 53 mph too.
     * @param {Object} settings Clay settings blob (windUnits).
     * @param {string} metric 'wind' | 'gust' | 'uv'.
     * @param {number} v Series value (whole km/h, or UV x 10), the first one in the step.
     * @returns {string}
     */
    function levelFromText(settings, metric, v) {
        var meta = metaOf(metric);
        if (!meta.wind) { return levelText(settings, metric, v); }
        var variant = thresholds.scaleVariant(meta.stem, settings);
        var perUnit = KMH_PER_WIND_UNIT[variant];
        if (perUnit === 1) { return levelText(settings, metric, v); }
        // The series comes in whole km/h, and the smallest one shown as n is
        // ceil((n - 0.5) * perUnit) (shownNumber rounds half up).
        var n = Math.round(v / perUnit);
        while (Math.ceil((n - 0.5) * perUnit) < v) { n += 1; }
        return n + ' ' + variant;
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
     * What the render signature signs: the drawn metrics set to Show: Alert, on a watch
     * that draws every line and has Alert settings (the bake's platform gates at worst
     * cost aplite one redundant fetch). A dev phone's stored true and the 'alert' its
     * next Save writes sign the same, so that Save forces no fetch. Each band's other inputs — the lines, windScale, windUnits and
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
        SHOW_ALL: SHOW_ALL,
        SHOW_ALERT: SHOW_ALERT,
        settingKey: settingKey,
        showValue: showValue,
        showOf: showOf,
        onlyAlertOn: onlyAlertOn,
        alertsDrawn: alertsDrawn,
        shownNumber: shownNumber,
        reachesWarn: reachesWarn,
        scaleTop: scaleTop,
        drawnMetrics: drawnMetrics,
        alertBand: alertBand,
        alertBands: alertBands,
        alertPermille: alertPermille,
        scalePercent: scalePercent,
        levelText: levelText,
        levelFromText: levelFromText,
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
