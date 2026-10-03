// src/pkjs/settings/forecast-hints.js — ES5, WebView. The Forecast tab's line resolvers,
// split out of blocks.js: the metric and line-style pickers' options (forecastMetric,
// lineStyleOptions) and the hints of every row a forecast line carries — the scale copy
// under its metric and style pickers (forecastMetricHint, lineStyleHint), its Visible
// values row (lineShowHint), the Wind graph scale row while a line shows Alert
// (windScaleHint) and its Draw from row (lineFromHint).
//
// It reads only the contract modules the bake reads (line-style.js, line-alert.js,
// draw-from.js, stripe-levels.js), nothing of blocks.js. Under Node blocks.js requires
// this file at its top, with the preview blocks and the when resolvers, so requiring
// blocks.js registers these resolvers too; the webview concatenates it after those four
// modules and ahead of blocks.js (scripts/build-config-page.js APP_FILES, pinned by
// test/config-page-bundle.test.js).
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
    // and the Visible values: Alert scale hint's "Graph top" read it.
    var drawFrom = (typeof require !== 'undefined')
        ? require('../draw-from.js') : window.DrawFrom;

    // The eight graph metrics in picker order — one list feeds every forecast picker.
    var FORECAST_METRICS = [
        ['Precipitation %', 'precip_prob'], ['Cloud cover %', 'cloud'], ['Wind speed', 'wind'], ['Wind gusts', 'gust'],
        ['UV Index', 'uv'], ['Air pressure (hPa)', 'pressure'], ['Feels-like temperature', 'feels'],
        ['Dew point', 'dew']
    ];
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
        return out;
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
    PConf.optionsResolvers.register('lineStyleOptions', function (S, env, args) {
        var metric = S ? S[(args || {}).metricKey] : undefined;
        if (lineStyle.metricAllowsStripe(metric)) { return LINE_STYLE_OPTIONS.slice(); }
        var out = [];
        for (var i = 0; i < LINE_STYLE_OPTIONS.length; i += 1) {
            if (!lineStyle.isStripeValue(LINE_STYLE_OPTIONS[i][1])) { out.push(LINE_STYLE_OPTIONS[i]); }
        }
        return out;
    });

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
        precip_prob: 'Half height = 50% chance of rain, full height = 100%.',
        cloud: 'Half height = half the sky covered, full height = overcast.',
        wind: 'Scaled by the Wind graph scale setting.',
        gust: 'Scaled by the Wind graph scale setting.',
        uv: 'Half height = UV 5.5, full height = UV 11 (extreme).',
        pressure: 'Sea-level pressure, scaled by the pressure graph scale below.',
        feels: 'Drawn on the same scale as the temperature curve.',
        dew: 'Drawn on the same scale as the temperature curve.'
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
        return parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1];
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
        precip_prob: 'Four colour steps: ' + stripeStepsText('rain') + ' chance of rain.',
        cloud: 'Four colour steps: ' + stripeStepsText('cloud') + ' of the sky covered.',
        wind: 'Colour strength follows the Wind graph scale setting, full colour from 90% of its top.',
        gust: 'Colour strength follows the Wind graph scale setting, full colour from 90% of its top.',
        uv: 'Colour steps up at ' + lineAlert.levelText({}, 'uv', stripeStepValue(2, 0, UV_TOP))
            + ' and ' + stripeStepValue(3, 0, UV_TOP) / 10 + ', full colour from '
            + lineAlert.levelText({}, 'uv', stripeStepValue(4, 0, UV_TOP)) + '.'
    };
    // What the metric picker says whatever the style.
    var METRIC_NOTES = {
        cloud: 'Not available with Yandex.',
        gust: 'The hourly peak.',
        dew: 'The closer it runs to the temperature, the more humid it feels.'
    };
    // What the style adds after its line's scale. Thin and Thick say it all.
    var STYLE_NOTES = {
        dots: 'Aligned to the rain bars.',
        x: 'Aligned to the rain bars.',
        stripeTop: 'One cell per hour.',
        stripeBottom: 'One cell per hour. Below the zero line, where bars and lines never cover it.'
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
     *   band); `onDemand` false = no Alert settings (aplite), so every line draws All.
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
     * copy, whose anchors ("Half height = UV 5.5") no longer hold there. A line that
     * hangs from the top (Draw from: Top, draw-from.js metricFromTop) starts at the
     * graph's top, so its start is named "Graph top" there; "full height" is a length and
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
            return 'Faintest colour = ' + levels.bottom + ', full colour from ' + levels.full + '.';
        }
        return (drawFrom.metricFromTop(S, metric, env) ? 'Graph top = ' : 'Graph bottom = ')
            + levels.bottom + ', full height = ' + levels.top + '.';
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
        var note = copyOf(METRIC_NOTES, metric);
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
            alert: 'Draws wind only where it reaches' },
        gust: { all: 'The line is always visible, calm hours included.',
            alert: 'Draws gusts only where they reach' },
        uv: { all: 'The line is always visible, low-UV hours included.',
            alert: 'Draws UV only where it reaches', scale: true }
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
            return 'The stripe\'s colour then runs from faint at ' + levels.bottom
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
        var hint = copy.alert + ' your warn level (' + lineAlert.warnText(S || {}, args.metric)
            + '), so the line is only visible when you actually care.';
        return copy.scale ? joinHint([hint, showAlertScale(S, env, args.metric)]) : hint;
    }

    // The Wind graph scale row's hint while a drawn wind or gust line shows Alert: such
    // a line runs from its warn level up to its band's top (line-alert.js alertBand),
    // the higher of the scale's value and the danger level, so the row's own "Tops out at
    // 50 kph — typical winds sit mid-graph" no longer holds. Each line's start of the
    // sentence, for when the drawn wind and gust lines top out at different values, and
    // its name in "your gust danger level".
    var WIND_LINE_TOPS = {
        wind: { lead: 'Wind tops out at ', tail: 'wind at ', danger: 'wind' },
        gust: { lead: 'Gusts top out at ', tail: 'gusts at ', danger: 'gust' }
    };

    /**
     * The Wind graph scale row's hint while a drawn wind or gust line shows Alert: where
     * each drawn wind and gust line tops out (an Alert line at its band's top, an All
     * line at the scale's value) and, where a danger level is that top, whose — without
     * the row's usual note on what the value emphasizes, which compares the scales of a
     * 0-based line. Every drawn wind and gust line on Alert (one top, shared): "Tops out
     * at 90 kph, your gust danger level, while Visible values is set to Alert." (without
     * the danger clause while the scale's own value is the top). One on Alert beside one
     * on All: "Tops out at 70 kph." for one top; "Wind tops out at 30 kph, gusts at 90
     * kph, your gust danger level." for two. Reads the stored scale, like the bake.
     * @param {Object} S Live settings state.
     * @param {Object} [env] Platform env (see alertScaleLevels).
     * @returns {?string} The hint; null for "use the row's hintByValue" (no drawn wind
     *   or gust line shows Alert).
     */
    function windScaleHint(S, env) {
        if (!S) { return null; }
        var drawn = lineAlert.drawnMetrics(S, env);
        var bands = lineAlert.alertBands(S, env);
        var lines = [], anyAlert = false, i, m;
        for (i = 0; i < drawn.length; i += 1) {
            m = drawn[i];
            if (!Object.prototype.hasOwnProperty.call(WIND_LINE_TOPS, m)) { continue; }
            lines.push({ metric: m, band: bands[m] || null,
                top: lineAlert.levelText(S, m, bands[m] ? bands[m].top : lineAlert.scaleTop(S, m)) });
            if (bands[m]) { anyAlert = true; }
        }
        if (!anyAlert) { return null; }
        // The line on Alert (the first, when both are: they share one band).
        var alert = lines[0].band ? lines[0] : lines[1];
        var danger = alert.band.topDanger
            ? ', your ' + WIND_LINE_TOPS[alert.band.topDanger].danger + ' danger level' : '';
        if (lines.length === 1 || (lines[0].band && lines[1].band)) {
            return 'Tops out at ' + alert.top + (danger ? danger + ',' : '')
                + ' while Visible values is set to Alert.';
        }
        // One on Alert beside one on All.
        var plain = lines[0].band ? lines[1] : lines[0];
        if (plain.top === alert.top) { return 'Tops out at ' + alert.top + '.'; }
        return WIND_LINE_TOPS[plain.metric].lead + plain.top + ', '
            + WIND_LINE_TOPS[alert.metric].tail + alert.top + danger + '.';
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
    var LINE_FROM_TOP_HINT = 'The higher the value, the further down it reaches.';
    var LINES_FROM_TOP_HINT = 'Both reach further down the stronger the wind.';

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

    // The two picker vocabularies, for the Graphs tab's line summaries (blocks.js
    // lineSummary, resetAllGraphColors), which load after this file.
    PConf.forecastLineOptions = {metrics: FORECAST_METRICS, styles: LINE_STYLE_OPTIONS};

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
