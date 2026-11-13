// src/pkjs/settings/forecast-hints.js — ES5, WebView. The Forecast tab's line resolvers,
// split out of blocks.js: the metric and line-style pickers' options (forecastMetric,
// lineStyleOptions) and the hints of every row a forecast line carries — the scale copy
// under its metric and style pickers (forecastMetricHint, lineStyleHint), its Visible
// values row (lineShowHint), the Wind graph scale row while a line shows Alert
// (windScaleHint) and its Draw from row (lineFromHint) — and the Forecast length row's options
// (forecastSpanOptions: the long span named by the hours it shows).
//
// It reads only the contract modules the bake reads (line-style.js, line-alert.js,
// draw-from.js, stripe-levels.js) and forecast-span-hours.js, nothing of blocks.js. Under
// Node blocks.js requires this file at its top, with the preview blocks and the when
// resolvers, so requiring blocks.js registers these resolvers too; the webview concatenates
// it after those five modules and ahead of blocks.js (scripts/build-config-page.js
// APP_FILES, pinned by test/config-page-bundle.test.js).
/* global PConf */
var PConf = (typeof global !== 'undefined' && global.PConf) ? global.PConf
    : (typeof window !== 'undefined' && window.PConf) ? window.PConf
    : (typeof PConf !== 'undefined' && PConf) ? PConf
    : { blocks: { register: function () {}, get: function () {} } };
(function () {
    // Dual-context pattern (see line-style.js): CommonJS under Node, the concatenated
    // <script> globals in the webview, all of which precede this file.
    // The graph's line vocabulary (line-style.js): the temperature-axis metrics, which
    // metrics can be a stripe, the style a picker resolves to and the metric it draws.
    var lineStyle = (typeof require !== 'undefined')
        ? require('../line-style.js') : window.LineStyle;
    // The wind, gust and UV lines' Show: Alert (line-alert.js): the band the bake scales
    // such a line over, so its hints name the levels the graph draws.
    var lineAlert = (typeof require !== 'undefined')
        ? require('../line-alert.js') : window.LineAlert;
    // A stripe cell's level on its metric's own scale (stripe-levels.js), the table the
    // bake shades every stripe by: the stripe hints name its colour steps, written at load.
    var stripeLevels = (typeof require !== 'undefined')
        ? require('../stripe-levels.js') : window.StripeLevels;
    // Draw from / Bars from [Bottom | Top] (draw-from.js): the Draw from rows' Top hint
    // and the Visible values: Alert scale hint's "The graph top is" read it.
    var drawFrom = (typeof require !== 'undefined')
        ? require('../draw-from.js') : window.DrawFrom;
    // Names as a sentence lists them (config-ui/lib/html.js, concatenated ahead of every app file).
    var andList = (typeof require !== 'undefined')
        ? require('../config-ui/lib/html.js').andList : PConf.html.andList;
    // The long time span's whole hours for the picked provider and layout
    // (forecast-span-hours.js): the Forecast length row's third label.
    var forecastSpanHours = (typeof require !== 'undefined')
        ? require('../forecast-span-hours.js') : window.ForecastSpanHours;
    // Graph styles (graph-styles-page.js, Pebble Time 2): the shown styles draw at most five
    // series between them, so a pick that would make a sixth is greyed out (limitOptions).
    var graphStylesPage = (typeof require !== 'undefined')
        ? require('./graph-styles-page.js') : window.GraphStylesPage;

    // The eight graph metrics in picker order (forecast-metrics.js, their one table) — one list
    // feeds every forecast picker — and the ones each weather service leaves out (gapOf).
    var forecastMetrics = (typeof require !== 'undefined') ? require('./forecast-metrics.js') : window.ForecastMetrics;
    var FORECAST_METRICS = forecastMetrics.options();
    // Metric picker options, shaped by self-describing args from the schema:
    // `off` leads with an Off row, `exclude` names the sibling picker keys
    // whose CURRENT pick is withheld (a collision left in a stored value is
    // display-snapped by the engine — a later pick turns the later line off).
    // Every picker offers the temperature-axis metrics (feels, dew) — each line
    // has its own curve-inset byte — except on aplite: the temp-axis line inset
    // is not compiled there, so they would render misaligned with the
    // temperature curve.
    PConf.optionsResolvers.register('forecastMetric', function (S, env, args) {
        var a = args || {};
        var exclude = a.exclude || [];
        var out = a.off ? [['Off', 'off']] : [];
        for (var i = 0; i < FORECAST_METRICS.length; i += 1) {
            var opt = FORECAST_METRICS[i];
            if (lineStyle.isTempAxisMetric(opt[1])
                && env && env.platform === 'aplite') { continue; }
            var taken = false;
            for (var j = 0; j < exclude.length; j += 1) {
                if (S && opt[1] === S[exclude[j]]) { taken = true; break; }
            }
            if (!taken) { out.push(opt); }
        }
        // args.key names the picker's line: with graph styles, a metric that would make the
        // shown styles draw a sixth series is greyed out (graph-styles-page.js limitOptions).
        return a.key ? graphStylesPage.limitOptions(out, S, env, a.key) : out;
    });

    // The six line styles in picker order — line-style.js' LINE_STYLE_KINDS vocabulary.
    var LINE_STYLE_OPTIONS = [
        ['Thin line', 'line'], ['Thick line', 'bold'], ['Square dots', 'dots'], ['× marks', 'x'],
        ['Stripe at top', 'stripeTop'], ['Stripe at bottom', 'stripeBottom']
    ];
    // One line's style options: the two stripes only while the line's metric can be
    // one (line-style.js metricAllowsStripe — the rule the bake resolves by), so the
    // engine's display-snap shows a stored stripe on any other metric as the style the
    // watch actually draws. args.metricKey names the metric picker it sits under.
    // With graph styles a style that would make the shown styles draw a sixth series (a line
    // turned stripe is a series of its own) is greyed out (graph-styles-page.js limitOptions).
    PConf.optionsResolvers.register('lineStyleOptions', function (S, env, args) {
        var metricKey = (args || {}).metricKey;
        var metric = S ? S[metricKey] : undefined;
        var out = [];
        for (var i = 0; i < LINE_STYLE_OPTIONS.length; i += 1) {
            if (lineStyle.metricAllowsStripe(metric) || !lineStyle.isStripeValue(LINE_STYLE_OPTIONS[i][1])) {
                out.push(LINE_STYLE_OPTIONS[i]);
            }
        }
        return metricKey ? graphStylesPage.limitOptions(out, S, env, metricKey + 'Style') : out;
    });

    // The Forecast length row's options (emery only): 12 h, 24 h and the long span labelled with
    // the whole hours the watch will show, which follow the weather provider's feed and the
    // plot the layout leaves: where the Left axis values sit and Larger graph fonts
    // (forecast-span-hours.js spanOptions). The values stay '12', '24' and '48', so a relabel
    // never touches the stored setting.
    PConf.optionsResolvers.register('forecastSpanOptions', forecastSpanHours.spanOptions);

    // ---- The forecast line hints: how a metric's value reads on the graph ----
    // The scale lives on the LINE-STYLE picker, because the style decides how a value
    // is shown: a curve or its marks by HEIGHT, a stripe by COLOUR STRENGTH. The
    // metric pickers keep only notes true of the metric whatever its style — except on
    // a watch without style pickers (env.lineStyles false: aplite, the schema's
    // LINE_STYLES_WHEN gate), where the metric picker adds the height wording, so the
    // scale is explained there too. No hint restates a metric's or a style's name, a
    // default look or 'Off'. The wind scale is named, not placed ("below"): with wind
    // and gusts both picked, its row sits under the first of them only; the pressure
    // scale row always sits below its (single) pressure line.
    var HEIGHT_SCALE = {
        precip_prob: 'Half height is a 50% chance of rain, full height is 100%.',
        cloud: 'Half height is half the sky covered, full height is overcast.',
        wind: 'The height follows the Wind graph scale setting.',
        gust: 'The height follows the Wind graph scale setting.',
        uv: 'Half height is UV 5.5, full height is UV 11 (extreme).',
        pressure: 'Shows sea-level pressure. The height follows the Pressure graph scale below.',
        feels: 'Uses the same scale as the temperature curve.',
        dew: 'Uses the same scale as the temperature curve.'
    };
    /**
     * A stripe scale's four colour steps as whole-percent ranges, e.g. '1–10%, 11–30%,
     * 31–60% and 61–100%', written from stripe-levels.js SCALES so the hint cannot drift
     * from the table the bake shades by.
     * @param {string} scale 'rain' | 'cloud'.
     * @returns {string} The ranges.
     */
    function stripeStepsText(scale) {
        var starts = stripeLevels.SCALES[scale], parts = [];
        for (var i = 0; i < starts.length; i += 1) {
            parts.push(starts[i] + '–' + (i + 1 < starts.length ? starts[i + 1] - 1 : 100) + '%');
        }
        return andList(parts);
    }

    /**
     * The first series value (a whole km/h, or UV x 10 — the steps the series come in) a
     * wind, gust or UV stripe draws at a colour step, on a line scaled from `bottom` to
     * `top`: the band scale's start for that step (stripe-levels.js percentFrom) up the
     * span, rounded up to a whole series step.
     * @param {number} level Colour step 1..4 (4 = full colour).
     * @param {number} bottom The line's scale bottom, series units.
     * @param {number} top The line's scale top, series units.
     * @returns {number} Series value.
     */
    function stripeStepValue(level, bottom, top) {
        return Math.ceil(bottom + (top - bottom) * stripeLevels.percentFrom('band', level) / 100 - 1e-9);
    }

    // A stripe cell's colour strength steps with the value, on the metric's own scale
    // (stripe-levels.js: four steps above an empty cell), so the copy names where the
    // steps sit instead of a height. Keyed by exactly the metrics a stripe can show
    // (line-style.js STRIPE_METRIC_IDS — a test holds the two lists equal).
    var UV_TOP = lineAlert.UV_FULL_SCALE_TENTHS;
    var STRIPE_SCALE = {
        precip_prob: 'The color gets stronger in four steps: ' + stripeStepsText('rain') + ' chance of rain.',
        cloud: 'The color gets stronger in four steps: ' + stripeStepsText('cloud') + ' of the sky covered.',
        wind: 'The color strength follows the Wind graph scale setting, with full color from 90% of its top.',
        gust: 'The color strength follows the Wind graph scale setting, with full color from 90% of its top.',
        uv: 'The color steps up at ' + lineAlert.levelText({}, 'uv', stripeStepValue(2, 0, UV_TOP))
            + ' and ' + stripeStepValue(3, 0, UV_TOP) / 10 + ', with full color from '
            + lineAlert.levelText({}, 'uv', stripeStepValue(4, 0, UV_TOP)) + '.'
    };
    // What the metric picker says whatever the style.
    var METRIC_NOTES = {
        gust: 'Shows the hourly peak.',
        dew: 'The closer it runs to the temperature, the more humid it feels.'
    };
    // What the style adds after its line's scale. Thin and Thick say it all.
    var STYLE_NOTES = {
        dots: 'The dots line up with the rain bars.',
        x: 'The marks line up with the rain bars.',
        stripeTop: 'The stripe has one cell per hour.',
        stripeBottom: 'The stripe has one cell per hour. It sits under the zero line, where bars and lines never cover it.'
    };

    /**
     * One entry of a copy table, OWN keys only — a stored value like 'constructor'
     * must not print an Object.prototype function.
     * @param {Object} table Copy table.
     * @param {*} key Lookup key.
     * @returns {string} The entry, or '' when absent.
     */
    function copyOf(table, key) {
        return (typeof key === 'string' && Object.prototype.hasOwnProperty.call(table, key))
            ? table[key] : '';
    }

    /**
     * Sentences joined with one space, empty ones dropped.
     * @param {string[]} parts Sentences, '' for none.
     * @returns {string} The hint, '' when every part is empty.
     */
    function joinHint(parts) {
        var out = [];
        for (var i = 0; i < parts.length; i += 1) {
            if (parts[i]) { out.push(parts[i]); }
        }
        return out.join(' ');
    }

    /**
     * The scale of a drawn line on Show: Alert (line-alert.js; the row reads "Visible
     * values") as the page prints it: the band the bake maps it over — its bottom (the
     * warn level, or with wind and gusts both on Alert the lower of the two) and its top
     * (the higher of the line's usual top and the danger level) — and, for a stripe, the
     * first reading drawn in full colour (90 % up the band, stripe-levels.js). THE one
     * reading of the band for the page's Alert scale copy: the style hint
     * (alertScaleCopy) and the UV line's Visible values hint (lineShowHint).
     * @param {string} metric The line's metric.
     * @param {Object} [S] Live settings state.
     * @param {Object} [env] Platform env, as line-alert.js alertBands reads it: `lineStyles`
     *   = the watch draws the Third and Fourth metric lines (whose metrics can share a
     *   band); `onDemand` false = no Alerts tab (aplite), so every line draws All.
     * @returns {?{bottom: string, top: string, full: string}} The three levels as
     *   printed ('UV 6', '40 kph'); null when the line is not drawn or shows All.
     */
    function alertScaleLevels(metric, S, env) {
        if (!S || !lineAlert.showsAlert(S, metric)) { return null; }
        var band = lineAlert.alertBands(S, env)[metric];
        if (!band) { return null; }
        return {
            bottom: lineAlert.levelText(S, metric, band.bottom),
            top: lineAlert.levelText(S, metric, band.top),
            // The first reading, as the slot shows it, from which every one is full colour
            // (levelFromText: in mph and knots one up from the converted value when a
            // reading just below the step shows the same number).
            full: lineAlert.levelFromText(S, metric, stripeStepValue(4, band.bottom, band.top))
        };
    }

    /**
     * The scale of a line drawn Show: Alert, as the style hint gives it (alertScaleLevels):
     * the band's bottom and top as numbers; drawn as a stripe, where its faintest colour
     * starts (the bottom) and where full colour does. Replaces the metric's usual scale
     * copy, whose anchors ("Half height is UV 5.5") no longer hold there. A line that
     * hangs from the top (Draw from: Top, draw-from.js metricFromTop) starts at the
     * graph's top, so its start is named "The graph top" there; "full height" is a length and
     * reads the same both ways.
     * @param {string} metric The line's metric.
     * @param {boolean} stripe The line is drawn as a stripe (colour strength, not height).
     * @param {Object} [S] Live settings state.
     * @param {Object} [env] Platform env (see alertScaleLevels); `lineStyles` false =
     *   nothing hangs from the top either.
     * @returns {string} The scale sentence, '' when the line does not show Alert.
     */
    function alertScaleCopy(metric, stripe, S, env) {
        var levels = alertScaleLevels(metric, S, env);
        if (!levels) { return ''; }
        if (stripe) {
            return 'The color starts faint at ' + levels.bottom + ' and is full from ' + levels.full + '.';
        }
        return (drawFrom.metricFromTop(S, metric, env) ? 'The graph top is ' : 'The graph bottom is ')
            + levels.bottom + ' and full height is ' + levels.top + '.';
    }

    /**
     * A metric picker's hint: the metric's own note, and — only on a watch without
     * style pickers — its height scale after it (a Show: Alert line's band instead).
     * @param {string} metric The picker's shown metric (or 'off').
     * @param {Object} [env] Platform env; `lineStyles` truthy = style pickers exist
     *   (the same truthy test as the schema's {env: 'lineStyles'} row gate).
     * @param {Object} [S] Live settings state (the Show rows).
     * @returns {string} The hint, '' for none.
     */
    function forecastMetricHint(metric, env, S) {
        var gap = forecastMetrics.gapOf((S || {}).provider);
        var note = joinHint([copyOf(METRIC_NOTES, metric),
            gap && gap.metrics.indexOf(metric) >= 0 ? gap.note : '']);
        if (env && env.lineStyles) { return note; }
        return joinHint([note,
            alertScaleCopy(metric, false, S, env) || copyOf(HEIGHT_SCALE, metric)]);
    }

    /**
     * A line-style picker's hint: its line's scale as this style shows it (a Show:
     * Alert line's band instead), then the style's own note.
     * @param {string} metric The metric of the line this picker styles.
     * @param {string} style The picker's shown style.
     * @param {Object} [S] Live settings state (the Show rows).
     * @param {Object} [env] Platform env (see alertScaleCopy).
     * @returns {string} The hint, '' for none.
     */
    function lineStyleHint(metric, style, S, env) {
        if (!metric || metric === 'off') { return ''; }
        var stripe = lineStyle.isStripeValue(style);
        return joinHint([alertScaleCopy(metric, stripe, S, env)
            || copyOf(stripe ? STRIPE_SCALE : HEIGHT_SCALE, metric),
            copyOf(STYLE_NOTES, style)]);
    }

    // The Visible values row's hint per metric and value (the owner's wording,
    // 2026-10-01): All's whole sentence, and the start of Alert's, ahead of "your warn
    // level (40 kph)". `scale`: Alert's hint closes on the scale the line then runs over
    // (showAlertScale; owner, 2026-10-02) — the UV line's only, as wind and gusts have
    // the Wind graph scale row for theirs (windScaleHint).
    var SHOW_HINTS = {
        wind: { all: 'The line is always visible, calm hours included.',
            alert: 'Draws wind only in the hours when it reaches' },
        gust: { all: 'The line is always visible, calm hours included.',
            alert: 'Draws gusts only in the hours when they reach' },
        uv: { all: 'The line is always visible, low-UV hours included.',
            alert: 'Draws UV only in the hours when it reaches', scale: true }
    };

    /**
     * Whether a metric's drawn line is a stripe on this watch: it has style pickers
     * (env.lineStyles, as forecastMetricHint reads it) and the picker that draws the
     * metric (line-style.js effectiveLineMetric: never a repeat) resolves to a stripe
     * (isStripeStyle, the style the bake draws).
     * @param {Object} S Live settings state.
     * @param {string} metric A graph metric id.
     * @param {Object} [env] Platform env.
     * @returns {boolean}
     */
    function drawnAsStripe(S, metric, env) {
        if (!env || !env.lineStyles) { return false; }
        for (var i = 0; i < lineStyle.FORECAST_LINES.length; i += 1) {
            var line = lineStyle.FORECAST_LINES[i];
            if (lineStyle.effectiveLineMetric(S, line.key) === metric) {
                return lineStyle.isStripeStyle(S, line.styleKey);
            }
        }
        return false;
    }

    /**
     * The sentence a Visible values: Alert hint closes on (SHOW_HINTS `scale`): the scale
     * the drawn line then runs over (alertScaleLevels). By height from the band's bottom
     * to its top, edge to edge — the edges swapped while the line hangs from the top
     * (Draw from: Top, draw-from.js metricFromTop); as a stripe (which keeps its own edge),
     * its colour from faint at the band's bottom to full at the reading the style hint
     * names full colour from.
     * @param {Object} S Live settings state.
     * @param {Object} [env] Platform env (see alertScaleLevels).
     * @param {string} metric The row's metric.
     * @returns {string} The sentence, '' when the line is not drawn on Alert.
     */
    function showAlertScale(S, env, metric) {
        var levels = alertScaleLevels(metric, S, env);
        if (!levels) { return ''; }
        if (drawnAsStripe(S, metric, env)) {
            return 'The stripe\'s color then runs from faint at ' + levels.bottom
                + ' to full at ' + levels.full + '.';
        }
        var fromTop = drawFrom.metricFromTop(S, metric, env);
        return 'The graph then runs from ' + levels.bottom + (fromTop ? ' at the top' : ' at the bottom')
            + ' to ' + levels.top + (fromTop ? ' at the bottom.' : ' at the top.');
    }

    /**
     * The Visible values row's hint (internally the Show row: line-alert.js), for the
     * selected value only: All draws the whole line, Alert only where the value reaches
     * the warn level, named in the unit the Alert levels are set in — on the UV line
     * followed by the scale it then runs over (showAlertScale). The value reads the
     * way the bake reads it (line-alert.js showValue: anything but 'alert' is All).
     * @param {Object} S Live settings state.
     * @param {Object} env Platform env (the scale's: which lines and styles it draws).
     * @param {{value: *, metric: string}} args The row's shown value and its metric.
     * @returns {string} The hint, '' for a metric without one.
     */
    function lineShowHint(S, env, args) {
        var copy = copyOf(SHOW_HINTS, args.metric);
        if (!copy) { return ''; }
        if (lineAlert.showValue(args.value) !== lineAlert.SHOW_ALERT) { return copy.all; }
        var hint = copy.alert + ' your warn level (' + lineAlert.warnText(S || {}, args.metric) + ').';
        return copy.scale ? joinHint([hint, showAlertScale(S, env, args.metric)]) : hint;
    }

    // The metrics the Wind graph scale row is about: the wind speed and gust lines.
    var WIND_METRICS = { wind: true, gust: true };

    /**
     * The Wind graph scale row's hint while a drawn wind or gust line shows Alert. Such a
     * line runs from its warn level up to its band's top (line-alert.js alertBand): the
     * higher of the scale's value and the danger level. So the hint says first where the
     * picked scale goes up to, which moves with every pick, then in one short sentence what
     * Alert does to the line: "The scale goes up to 30 kph. With Alert, the line runs from
     * your warn level, 60 kph, to your danger level, 90 kph." While the scale is above the
     * danger level, the line tops out at the scale: "... With Alert, the line starts at your
     * warn level, 60 kph." Wind and gusts both on Alert share one band, from the lower warn
     * level: "the lines run from 40 kph to your gust danger level, 90 kph". One on Alert
     * beside one on All names the Alert one: "the gust line runs ...". Without the row's
     * usual note on what the value emphasizes, which compares the scales of a 0-based line.
     * Reads the stored scale, like the bake.
     * @param {Object} S Live settings state.
     * @param {Object} [env] Platform env (see alertScaleLevels).
     * @returns {?string} The hint; null for "use the row's hintByValue" (no drawn wind
     *   or gust line shows Alert).
     */
    function windScaleHint(S, env) {
        if (!S) { return null; }
        var drawn = lineAlert.drawnMetrics(S, env);
        var bands = lineAlert.alertBands(S, env);
        var lines = [], alert = null, i, m;
        for (i = 0; i < drawn.length; i += 1) {
            m = drawn[i];
            if (!Object.prototype.hasOwnProperty.call(WIND_METRICS, m)) { continue; }
            lines.push({ metric: m, band: bands[m] || null });
            // The line on Alert (the first, when both are: they share one band).
            if (bands[m] && !alert) { alert = lines[lines.length - 1]; }
        }
        if (!alert) { return null; }
        var shared = lines.length === 2 && Boolean(lines[0].band) && Boolean(lines[1].band);
        var subject = lines.length === 1 ? 'the line runs' : shared ? 'the lines run'
            : 'the ' + alert.metric + ' line runs';
        var from = lineAlert.levelText(S, alert.metric, alert.band.bottom);
        // A shared band starts at the lower warn level of the two.
        var start = shared ? from : 'your warn level, ' + from;
        var lead = 'The scale goes up to '
            + lineAlert.levelText(S, alert.metric, lineAlert.scaleTop(S, alert.metric)) + '. With Alert, ';
        if (!alert.band.topDanger) {
            return lead + subject.replace(/ runs?$/, shared ? ' start' : ' starts') + ' at ' + start + '.';
        }
        return lead + subject + ' from ' + start + (shared ? ' to your ' + alert.band.topDanger + ' ' : ', to your ')
            + 'danger level, ' + lineAlert.levelText(S, alert.metric, alert.band.top) + '.';
    }

    PConf.hintResolvers.register('forecastMetricHint', function (S, env, args) {
        return forecastMetricHint(args.value, env, S);
    });
    // The Wind graph scale row: null (its hintByValue) unless a drawn wind or gust line
    // shows Alert.
    PConf.hintResolvers.register('windScaleHint', function (S, env) {
        return windScaleHint(S, env);
    });
    // args.metricKey names the metric picker this style picker sits under.
    PConf.hintResolvers.register('lineStyleHint', function (S, env, args) {
        return lineStyleHint(S ? S[args.metricKey] : undefined, args.value, S, env);
    });
    PConf.hintResolvers.register('lineShowHint', lineShowHint);

    // The Draw from row's Top hint: one line, or the wind and the gust line together
    // (draw-from.js windLineFrom moves both). Bottom, the default, has none.
    var LINE_FROM_TOP_HINT = 'The higher the value, the further down the line reaches.';
    var LINES_FROM_TOP_HINT = 'Both lines reach further down the stronger the wind.';

    /**
     * The Draw from row's hint, for the selected value only: none for Bottom; for Top
     * what hanging means, said of both lines while the row's key moves two drawn lines
     * (a wind and a gust line, draw-from.js linesSharing).
     * @param {Object} S Live settings state.
     * @param {Object} env Platform env (draw-from.js capable).
     * @param {{value: *, key: string}} args The row's shown value and its key.
     * @returns {string} The hint, '' for none.
     */
    function lineFromHint(S, env, args) {
        if (drawFrom.value(args.value) !== drawFrom.TOP) { return ''; }
        return drawFrom.linesSharing(S || {}, args.key, env) >= 2
            ? LINES_FROM_TOP_HINT : LINE_FROM_TOP_HINT;
    }
    PConf.hintResolvers.register('lineFromHint', lineFromHint);

    // The line styles' picker vocabulary, for the Graphs tab's line summaries (blocks.js
    // lineSummary), which load after this file; the metrics' is forecast-metrics.js.
    PConf.forecastLineOptions = {styles: LINE_STYLE_OPTIONS};

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = {
            forecastMetricHint: forecastMetricHint,
            lineStyleHint: lineStyleHint,
            lineShowHint: lineShowHint,
            lineFromHint: lineFromHint,
            windScaleHint: windScaleHint,
            STRIPE_SCALE: STRIPE_SCALE
        };
    }
})();
