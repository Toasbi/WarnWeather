// src/pkjs/settings/blocks.js — ES5, WebView. WarnWeather's threshold-sheet
// machinery (ranges, auto colors, the warn-look default, the two reset
// actions, the sheet/badge resolvers) and the small option/default/recommend
// resolvers. The BLOCK RENDERERS live one file per concern —
// preview-forecast.js, preview-radar.js, preview-diagnostics.js and
// preview-layout.js, over the shared preview-svg.js / preview-rain.js; under Node
// this file requires the four registering ones, so requiring blocks.js registers
// every block and not just its own (the webview concatenates every file instead —
// see scripts/build-config-page.js APP_FILES).
/* global PConf, COUNTRY_DEFAULTS, INJECTED_USERDATA */
var PConf = (typeof global !== 'undefined' && global.PConf) ? global.PConf
    : (typeof window !== 'undefined' && window.PConf) ? window.PConf
    : (typeof PConf !== 'undefined' && PConf) ? PConf
    : { blocks: { register: function () {}, get: function () {} } };
if (typeof require !== 'undefined') {
    require('./preview-forecast.js');
    require('./preview-radar.js');
    require('./preview-diagnostics.js');
    require('./preview-layout.js');
}
(function () {
    // Dual-context pattern (see line-style.js): CommonJS under Node, a
    // concatenated <script> global in the webview.
    var statusLineCatalog = (typeof require !== 'undefined')
        ? require('../status-line-catalog.js') : window.StatusLineCatalog;
    var tomorrowioBudget = (typeof require !== 'undefined')
        ? require('./tomorrowio-budget.js') : PConf.tomorrowioBudget;
    var rainbowBudget = (typeof require !== 'undefined')
        ? require('./rainbow-budget.js') : PConf.rainbowBudget;
    // The key status under a keyed provider (key-status.js, concatenated ahead of this
    // file): tomorrow.io's usage line registers into it.
    var keyStatus = (typeof require !== 'undefined')
        ? require('./key-status.js') : PConf.keyStatus;
    // The regional radar sources' areas (radar-coverage.js, concatenated ahead of this
    // file): the note under the Radar provider row.
    var radarCoverage = (typeof require !== 'undefined')
        ? require('../weather/radar-coverage.js') : window.RadarCoverage;
    // The update-interval ladder under every active budget guard, shared with onbuild.js's
    // save-time fit so the page and the save clamp can't drift apart.
    var intervalBudget = (typeof require !== 'undefined')
        ? require('./interval-budget.js') : PConf.intervalBudget;
    // Country → recommended-provider mapping (shared with the wizard).
    var CD = (typeof require !== 'undefined') ? require('./country-defaults.js') : COUNTRY_DEFAULTS;
    // The graph-colour vocabulary (key names, per-scope roles, the built-in table) —
    // the same module the watch's wire is packed from, so the row badges below preview
    // exactly what the graph draws. Same dual-context rule as the preview blocks:
    // scripts/build-config-page.js concatenates line-style.js AHEAD of this file, so
    // window.LineStyle exists by the time the page boots.
    var lineStyle = (typeof require !== 'undefined')
        ? require('../line-style.js') : window.LineStyle;
    // The wind, gust and UV lines' Show: Alert (line-alert.js): the band the bake scales
    // such a line over, so its hints name the levels the graph draws. Concatenated after
    // status-thresholds.js and line-style.js and ahead of this file.
    var lineAlert = (typeof require !== 'undefined')
        ? require('../line-alert.js') : window.LineAlert;
    // A stripe cell's level on its metric's own scale (stripe-levels.js), the table the
    // bake shades every stripe by: the stripe hints name its colour steps. Concatenated
    // ahead of this file.
    var stripeLevels = (typeof require !== 'undefined')
        ? require('../stripe-levels.js') : window.StripeLevels;
    // Draw from / Bars from [Bottom | Top] (draw-from.js): the Draw from rows' Top hint
    // and the Visible values: Alert scale hint's "Graph top" read it. Concatenated after
    // line-style.js and ahead of this file.
    var drawFrom = (typeof require !== 'undefined')
        ? require('../draw-from.js') : window.DrawFrom;
    // The theme vocabulary (polarity, B&W, whether the watch draws colour), concatenated
    // ahead of line-style.js and so of this file.
    var resolveInk = (typeof require !== 'undefined')
        ? require('../resolve-ink.js') : window.ResolveInk;
    // The page bundle's single-source int<->hex (config-ui/lib/color.js, concatenated
    // ahead of every app file), rather than a fourth local copy of the same six digits.
    var intToHex = (typeof require !== 'undefined')
        ? require('../config-ui/lib/color.js').intToHex : PConf.color.intToHex;
    // The rgb control's own value helpers (config-ui/lib/rgb-control.js, likewise
    // concatenated ahead of the app files): a badge previewing an rgb key parses the
    // stored "r,g,b" string with the same parser — fallbacks included — as the sliders
    // behind it, so the dot cannot show a colour the sheet would not open on.
    var rgbControl = (typeof require !== 'undefined')
        ? require('../config-ui/lib/rgb-control.js') : PConf.rgbControl;
    // The threshold contract (status-thresholds.js): the kinds, their seed pairs, the
    // colour and warn-look rules and the alert vocabulary — the module the watch's
    // blob is packed and its alerts baked from, so the sheets, badges and hints read
    // the numbers, colours and switches the watch uses.
    // scripts/build-config-page.js concatenates it AHEAD of this file.
    var thresholds = (typeof require !== 'undefined')
        ? require('../status-thresholds.js') : window.StatusThresholds;
    // The On demand contract (on-demand.js): which bar shows which item, and the Battery
    // item's warn level — the phone's own reading, concatenated ahead of this file.
    var onDemand = (typeof require !== 'undefined')
        ? require('../on-demand.js') : window.OnDemand;

        // Slot-dropdown options resolver: derives a status-line slot's option list from the
    // catalog (Tasks 2 + 17) — Empty first, availability-gated, sibling+excludeCodes filtered.
    PConf.optionsResolvers.register('statusSlot', function (S, env, args) {
        return statusLineCatalog.slotOptions(S, env, args);
    });

    // Full-date sample labels for the Date sheet's no-calendar picker, in the
    // user's effective day/month order — the same derivation the wire's Auto
    // format uses (clay-payload effectiveHolidayCountry: the configured holiday
    // country, 'US' when the key is absent). Values are date-format.js'
    // FULL_FORMAT_CODES; samples are a fixed 7 Sep 2026, not today's date — the
    // labels are format examples, and static strings keep the list deterministic
    // under test. ISO is the one order-blind format, so it reads the same in
    // both branches.
    PConf.optionsResolvers.register('dateFullFormatOptions', function (S) {
        var country = (S && Object.prototype.hasOwnProperty.call(S, 'holidayCountry'))
            ? S.holidayCountry : 'US';
        return country === 'US' ? [
            ['09.07.26', 'auto'],
            ['09.07.2026', 'long'],
            ['9.7.', 'noyear'],
            ['9/7/26', 'slash'],
            ['2026-09-07', 'iso'],
            ['Sep 7', 'text'],
            ['Sep 7, 2026', 'textyear']
        ] : [
            ['07.09.26', 'auto'],
            ['07.09.2026', 'long'],
            ['7.9.', 'noyear'],
            ['7/9/26', 'slash'],
            ['2026-09-07', 'iso'],
            ['7 Sep', 'text'],
            ['7. Sep 2026', 'textyear']
        ];
    });

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
     * @param {Object} [env] Platform env; `lineStyles` truthy = the watch draws the Third
     *   and Fourth metric lines (whose metrics can share a band); `onDemand` false = no
     *   Alert settings (aplite), so every line draws All.
     * @returns {?{bottom: string, top: string, full: string}} The three levels as
     *   printed ('UV 6', '40 kph'); null when the line is not drawn or shows All.
     */
    function alertScaleLevels(metric, S, env) {
        if (!S || !lineAlert.showsAlert(S, metric)) { return null; }
        var band = lineAlert.alertBands(S, Boolean(env && env.lineStyles),
            lineAlert.alertsDrawn(env))[metric];
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
     * @param {Object} [env] Platform env; `lineStyles` truthy = the watch draws the Third
     *   and Fourth metric lines; `onDemand` false = no Alert settings (aplite).
     * @returns {?string} The hint; null for "use the row's hintByValue" (no drawn wind
     *   or gust line shows Alert).
     */
    function windScaleHint(S, env) {
        if (!S) { return null; }
        var allLines = Boolean(env && env.lineStyles);
        var drawn = lineAlert.drawnMetrics(S, allLines);
        var bands = lineAlert.alertBands(S, allLines, lineAlert.alertsDrawn(env));
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

    /**
     * The AQI slot's Day max / Both hint while its source note applies: the by-value
     * hint the row's static hintByValue carries (args.hints, the same schema.js
     * dayMaxHints table, so the two cannot drift) closed on the source's note — WAQI
     * and Auto have no forecast to take a peak from (args.notes). A non-null answer
     * REPLACES hintByValue (engine renderRow), so this returns the whole text; null
     * for Now and whenever no note applies, so hintByValue answers.
     * @param {Object} S Live settings state.
     * @param {Object} env Platform env (unused).
     * @param {{value: string, hints: {max: string, both: string},
     *   notes: ?{key: string, fallback: string, byValue: Object}}} args The row's shown
     *   mode + dayMaxRows' copy.
     * @returns {?string} The hint with its note, or null for "use hintByValue".
     */
    function dayMaxHint(S, env, args) {
        if (args.value !== 'max' && args.value !== 'both') { return null; }
        var notes = args.notes;
        if (!notes || !args.hints) { return null; }
        var st = S || {};
        var note = copyOf(notes.byValue, st[notes.key] || notes.fallback);
        return note ? args.hints[args.value] + note : null;
    }
    PConf.hintResolvers.register('dayMaxHint', dayMaxHint);

    // Per-slot edit sheet: the pencil left of a slot dropdown opens the threshold sheet
    // for the slot's CURRENT value, when that value is a threshold kind. The catalog's
    // slot codes and the threshold contract's KINDS codes are the same vocabulary
    // ('wind', 'aqi', 'steps', ...), so the contract IS the mapping — no hand-copied
    // list to drift. env gate mirrors the sheets' own showWhen (aplite compiles the
    // highlight out).
    PConf.sheetResolvers.register('statusSlotEditSheet', function (S, env, args) {
        if (!env || !env.thresholds) { return null; }
        var code = S[args.messageKey];
        for (var i = 0; i < thresholds.KINDS.length; i++) {
            if (thresholds.KINDS[i].code === code) { return 'thresh' + thresholds.KINDS[i].key; }
        }
        return null;
    });

    // --- threshold sliders (the per-slot edit sheets' controls) ------------------

    /**
     * Normalize a stored color (0xRRGGBB int or '#RRGGBB' string) to '#RRGGBB' —
     * the inline-styled zones/chips/dots must never interpolate an unvetted
     * string into HTML.
     * @param {*} v Stored color value.
     * @param {number} fallbackInt Default 0xRRGGBB when v is unset/garbage.
     * @returns {string} '#RRGGBB' (uppercase).
     */
    function colorHexOf(v, fallbackInt) {
        if (typeof v === 'number' && isFinite(v)) { return intToHex(v); }
        if (typeof v === 'string' && /^#?[0-9A-Fa-f]{6}$/.test(v)) {
            return '#' + v.replace('#', '').toUpperCase();
        }
        return colorHexOf(fallbackInt, 0xFF0000);
    }

    /**
     * @param {string} hex '#RRGGBB'.
     * @returns {{r: number, g: number, b: number}} Channel values.
     */
    function hexRgb(hex) {
        return {
            r: parseInt(hex.slice(1, 3), 16),
            g: parseInt(hex.slice(3, 5), 16),
            b: parseInt(hex.slice(5, 7), 16)
        };
    }

    /**
     * Soft glow tint for a knob's shadow (the same .35 alpha the brand knobs use
     * in shell.html).
     * @param {string} hex '#RRGGBB'.
     * @returns {string} rgba() string.
     */
    function glowOf(hex) {
        var c = hexRgb(hex);
        return 'rgba(' + c.r + ',' + c.g + ',' + c.b + ',0.35)';
    }

    /**
     * Readable text color on a chip filled with the given color.
     * @param {string} hex '#RRGGBB'.
     * @returns {string} Dark ink on light fills, white on dark fills.
     */
    function chipTextOn(hex) {
        var c = hexRgb(hex);
        return (c.r * 299 + c.g * 587 + c.b * 114) / 1000 > 150 ? '#20232A' : '#FFFFFF';
    }

    /**
     * Ceil a value onto a step grid, guarding float-division noise (3 / 0.5
     * landing on 5.999…).
     * @param {number} v Value.
     * @param {number} step Step size (> 0).
     * @returns {number} Smallest step multiple >= v.
     */
    function ceilToStep(v, step) {
        return Math.ceil(Math.round((v / step) * 1e6) / 1e6) * step;
    }

    // Per-kind slider geometry, in the kind's DISPLAY unit (the unit
    // status-thresholds.js compares against at bake/pack time), keyed by the
    // contract's scaleVariant — the same key its seed table uses, so the slider and
    // the seeds cannot read the unit and AQI-scale pickers apart. Looked up per render
    // (rangeOf) so the General-tab unit pickers reshape the scales live. fixedMax
    // marks the naturally-bounded kinds (no inline scale-max editor). The SEED pairs
    // are not here: they live in the contract (status-thresholds.js SEEDS /
    // seedPair) — the one table the phone bake resolves a blank pair against too, so
    // the slider can never preview numbers the watch does not use.
    var THRESHOLD_RANGES = {
        Wind: {
            kph: {min: 0, max: 120, step: 5, unit: 'kph'},
            mph: {min: 0, max: 75, step: 5, unit: 'mph'},
            kn: {min: 0, max: 65, step: 5, unit: 'kn'}
        },
        Gust: {
            kph: {min: 0, max: 160, step: 5, unit: 'kph'},
            mph: {min: 0, max: 100, step: 5, unit: 'mph'},
            kn: {min: 0, max: 85, step: 5, unit: 'kn'}
        },
        Aqi: {
            us: {min: 0, max: 300, step: 10, unit: ''},
            eu: {min: 0, max: 150, step: 5, unit: ''}
        },
        Pollen: {'': {min: 0, max: 3, step: 0.5, unit: '', fixedMax: true}},
        // The slot displays the rounded integer index, so whole steps; 12 covers
        // every real-world reading (extremes clamp against the top like any kind).
        Uv: {'': {min: 0, max: 12, step: 1, unit: '', fixedMax: true}},
        Steps: {'': {min: 0, max: 20000, step: 250, unit: ''}},
        Sleep: {'': {min: 0, max: 12, step: 0.5, unit: 'h', fixedMax: true}},
        Distance: {
            km: {min: 0, max: 20, step: 0.5, unit: 'km'},
            mi: {min: 0, max: 12, step: 0.5, unit: 'mi'}
        }
    };

    /**
     * A kind's slider geometry for the unit and scale the settings select.
     * @param {string} stem Kind key stem with a THRESHOLD_RANGES entry.
     * @param {Object} S Live settings state.
     * @returns {{min: number, max: number, step: number, unit: string,
     *     fixedMax: (boolean|undefined)}} The geometry (shared: read, never mutate).
     */
    function rangeOf(stem, S) {
        return THRESHOLD_RANGES[stem][thresholds.scaleVariant(stem, S)];
    }

    /**
     * Range resolver for the threshold sliders (engine item.rangeFrom): per-kind
     * geometry + fixed direction + live colors. The scale max honors the stored
     * per-kind override and always grows to fit the stored thresholds, so a pair
     * entered under another unit (or by the old text UI) can never strand a thumb
     * off the track.
     * @param {Object} S Live settings state.
     * @param {Object} env Platform env.
     * @param {{keyStem: string, chips: ({warn: string, danger: string}|undefined)}} args
     *     Kind key stem, e.g. 'Steps', and the chips' words from the group's voice
     *     (schema.js GOAL_VOICE / ALERT_VOICE); without them the slider says Warn /
     *     Danger (range-control.js).
     * @returns {Object} Config the engine merges over the schema item.
     */
    function thresholdRangeCfg(S, env, args) {
        var stem = args.keyStem;
        var base = rangeOf(stem, S || {});
        var max = base.max;
        if (!base.fixedMax) {
            var override = thresholds.parseThreshold(S['thresh' + stem + 'Max']);
            if (override !== null && override > base.min) { max = ceilToStep(override, base.step); }
            var warn = thresholds.parseThreshold(S['thresh' + stem + 'Warn']);
            var danger = thresholds.parseThreshold(S['thresh' + stem + 'Danger']);
            if (warn !== null && warn > max) { max = ceilToStep(warn, base.step); }
            if (danger !== null && danger > max) { max = ceilToStep(danger, base.step); }
            // The pair the phone actually holds on must sit on the scale too
            // (resolvedPair: the stored pair when it is ordered, else the seed).
            // With a blank pair and a stored scale max below the seed — the
            // slider's max editor is live while the highlight is off, and older
            // installs kept a Max from before OFF stopped blanking the pair — the
            // slider would clamp the seed it previews to that max while the bake
            // uses the real seed: two readings of one rule.
            var held = thresholds.resolvedPair(stem, S || {});
            if (held.warn !== null && held.warn > max) { max = ceilToStep(held.warn, base.step); }
            if (held.danger !== null && held.danger > max) { max = ceilToStep(held.danger, base.step); }
        }
        // A null warn color (warn look 'none') draws the slider's warn pieces in a
        // neutral gray: the zone still shows WHERE warn spans, while the copy +
        // warn look make clear the watch draws no box there.
        var warnDisplay = thresholdDisplayColor(S, stem, 'Warn', env);
        var warnColor = warnDisplay === null ? '#8A8E97' : warnDisplay;
        var dangerColor = thresholdDisplayColor(S, stem, 'Danger', env);
        var chips = args.chips || {};
        // Seeds from the contract's table: what a blank pair means on the phone.
        var seed = thresholds.seedPair(stem, S || {});
        return {
            min: base.min, max: max, step: base.step, minSpan: base.step,
            // Direction axis retired (status-thresholds.js): every kind's value
            // rises toward the pair. The engine's 'below' rendering stays a
            // dormant library feature no item sets.
            dir: 'above',
            unit: base.unit,
            seedWarn: seed.warn, seedDanger: seed.danger,
            maxEditable: !base.fixedMax,
            warnColor: warnColor, dangerColor: dangerColor,
            warnGlow: glowOf(warnColor), dangerGlow: glowOf(dangerColor),
            dangerText: chipTextOn(dangerColor),
            // Chip/aria wording, the voice's: goal kinds celebrate (Close / Goal),
            // weather warns.
            warnLabel: chips.warn,
            dangerLabel: chips.danger
        };
    }
    PConf.rangeResolvers.register('thresholdRange', thresholdRangeCfg);

    // Picking feels-like or dew point as the main metric clears "Area fill": both map
    // against the temperature axis, not a 0..max scale, so their "below the line"
    // is the arbitrary joint-band floor rather than a zero the fill can mean anything
    // against. The toggle's showWhen hides the row for them; this writes the stored
    // value false so the settings blob agrees with what the watch renders (and with
    // the preview). Switching to any other metric leaves the value alone — the user
    // re-enables the fill themselves, the same as any other toggle.
    PConf.onChange.register('forecastMetricFill', function (S, oldValue, newValue) {
        if (lineStyle.isTempAxisMetric(newValue)) { S.secondaryLineFill = false; }
    });

    // The night tint follows the fill at RESOLVE time (line-style.js' graphNightTint),
    // so nothing is written into the tint key when a fill is picked — the page stays a
    // pure editor and "did the user pick this tint?" keeps a straight answer. The two
    // display surfaces that have to show the CASCADED colour rather than the stored one
    // are the row badge (graphColorSwatch below) and the in-sheet swatch, which reads
    // the display resolver registered next to it.

    // The temp slot's "Both" mode and its degree sign are mutually exclusive:
    // "-12/-10" is already 7 of an edge slot's 8 bytes and the sign is two more.
    // Whichever the user just picked wins, so neither choice is ever refused --
    // the other simply steps aside. Both rows share this hook; the key says which
    // one moved. status-lines.js gates the pair independently, for a settings blob
    // written before this existed.
    PConf.onChange.register('tempUnitExclusive', function (S, oldValue, newValue, env, key) {
        if (key === 'tempSlotDisplay') {
            if (newValue === 'both') { S.tempSlotUnit = false; }
        } else if (newValue) {
            if (S.tempSlotDisplay === 'both') { S.tempSlotDisplay = 'actual'; }
        }
    });

    // A kind's warn look default (thresh<K>WarnLook's defaultFrom): the contract's
    // warnLookDefault — fill on a colour watch, outline on a B&W one, outline for the
    // goal kinds — so the page shows exactly what the packer resolves an unset key
    // to. The key stays unset in the phone store: defaultFrom items are never
    // seeded, and the item's sticky: false keeps a save from writing this value.
    PConf.defaultsResolvers.register('warnLookDefault', function (env, args) {
        return thresholds.warnLookDefault(args && args.keyStem, env ? env.color : undefined);
    });

    // The warn look's hint (thresh<K>WarnLook's hintFrom), for the SELECTED look,
    // from the group voice's look copy the row passes as `copy` (schema.js
    // GOAL_VOICE / ALERT_VOICE `look`):
    //  - a B&W watch or B&W day theme: its `bw` set — the box is drawn in the text
    //    colour, the pickers are hidden, and a fill is the danger (reached-goal) fill;
    //  - a colour day theme with a B&W night theme (Theme switching on): the row's
    //    own hint (`base`, its hintByValue) plus the `night` note for that look — by
    //    day the box is in the picked colour, at night a fill matches danger;
    //  - a colour screen where Fill's two colours resolve to the SAME one (a goal
    //    kind's defaults are both the goal green; a warn pick can equal danger): the
    //    `sameColor` note too — that fill IS the danger / reached-goal box;
    //  - otherwise null — the row's own hintByValue.
    // A look a set has no line for (none) falls back the same way. The watch still
    // draws what was picked (status_row.c).
    PConf.hintResolvers.register('warnLookHint', function (S, env, args) {
        var copy = args && args.copy;
        if (!copy) { return null; }
        var value = args.value;
        var st = S || {};
        // By DAY: the case the colour pickers are hidden for (schema.js
        // COLOR_THEME_WHEN) and every highlight is drawn in the text colour.
        if (!resolveInk.drawsColor(env, st.theme)) {
            var bwText = copy.bw && copy.bw[value];
            return typeof bwText === 'string' ? bwText : null;
        }
        var base = copy.base && copy.base[value];
        if (typeof base !== 'string') { return null; }
        var parts = [base];
        var note = copy.night && copy.night[value];
        if (st.themeAuto === true && resolveInk.isBwTheme(st.themeNight) && typeof note === 'string') {
            parts.push(note);
        }
        if (value === 'fill' && args.keyStem && typeof copy.sameColor === 'string') {
            var warnHex = thresholdDisplayColor(st, args.keyStem, 'Warn', env);
            var dangerHex = thresholdDisplayColor(st, args.keyStem, 'Danger', env);
            if (warnHex && dangerHex && String(warnHex).toUpperCase() === String(dangerHex).toUpperCase()) {
                parts.push(copy.sameColor);
            }
        }
        return parts.length > 1 ? parts.join(' ') : null;
    });

    /**
     * The colour the page DRAWS for a kind's warn/danger pieces (slider zones, badge
     * dots, the colour pickers' swatches) — what the watch draws by day: the theme's
     * text colour on a B&W watch or B&W day theme (every highlight is in the text
     * colour there), else the contract's colour rule (status-thresholds.js
     * thresholdColor — the one the packer and the on-open heal use too). So an unset
     * colour previews its auto value, and a black or white pick previews what the
     * watch turns it into (the text colour; the goal green for a goal kind).
     * @param {Object} S Live settings state.
     * @param {string} stem Kind key stem, e.g. 'Steps'.
     * @param {string} which 'Warn' | 'Danger'.
     * @param {Object} [env] Platform env (env.color false on a B&W watch).
     * @returns {?string} '#RRGGBB', or null for a warn look of 'none'.
     */
    function thresholdDisplayColor(S, stem, which, env) {
        // WARN with the look 'none' draws no box (bold only) — report null so
        // callers render their neutral no-box state instead of a color.
        if (which === 'Warn' && S['thresh' + stem + 'WarnLook'] === 'none') {
            return null;
        }
        return intToHex(resolveInk.drawsColor(env, S.theme)
            ? thresholds.thresholdColor(S, stem, which) : thresholds.textColor(S));
    }
    // The warn and danger pickers paint the same resolution (engine.js' displayFrom
    // hook), not the raw stored value: after a reset stores the schema's unset '', or
    // a pick the watch resolves differently (a goal kind's black or white is its
    // green), the swatch still shows what the watch draws. Clicking a swatch still
    // writes the pick under the picker's own key.
    /**
     * @param {Object} S Live settings state.
     * @param {Object} env Platform env.
     * @param {{keyStem: string, which: string}} args The picker's kind and colour.
     * @returns {?string} '#RRGGBB' to paint, or null to fall back to the stored value.
     */
    PConf.displayResolvers.register('thresholdColor', function (S, env, args) {
        if (!S || !args || !args.keyStem) { return null; }
        return thresholdDisplayColor(S, args.keyStem, args.which, env);
    });

    // Reset-to-defaults for one threshold kind (the small button beside the slider's
    // label). Returns true so the engine re-renders.
    PConf.actions = PConf.actions || {};
    PConf.actions.resetThresholds = function (stem, S, env, defaultOf) {
        if (!stem || !S || !THRESHOLD_RANGES[stem] || !defaultOf) { return false; }
        var goal = thresholds.isGoalKind(stem);
        // Every key with a schema default lands on it THROUGH the engine's resolver —
        // mirrored literals drift when the schema changes (see resetStatusSlots
        // below). The result is exactly a fresh install: a goal kind's stored
        // toggle OFF (its switch rides this group's header, so resetting the goals
        // switches it off too), the blank pair (= the kind's seed, resolved live — a
        // wind pair follows windUnits again), the cleared Max, the goal-vs-weather
        // colours and the platform's warn look are all schema defaults. A weather
        // colour's default is unset, which the pickers and zones already show as
        // what the watch draws (thresholdDisplayColor), and the next open's heal
        // stores. A weather kind's highlight switch is NOT in this group — it is
        // the slot sheet's Highlight row — so its levels reset leaves it alone, as
        // it leaves Bold.
        var keys = ['Warn', 'Danger', 'Max', 'WarnColor', 'DangerColor', 'WarnLook'];
        if (goal) { keys.unshift('On'); }
        for (var d = 0; d < keys.length; d++) {
            S['thresh' + stem + keys[d]] = defaultOf('thresh' + stem + keys[d]);
        }
        // The first-run wizard's defaults-policy table has no row for any of these
        // keys (its threshold rows are Bold modes and a weather kind's highlight
        // switch, both outside this group), so the schema defaults ARE the
        // out-of-box state and nothing else lands here.
        return true;
    };

    // Reset-to-default for ONE graph-colour sheet (the button on its "Colors"
    // sub-header — one sheet per metric, plus the night band). The KEY LIST comes from
    // the schema through data-action-arg, so this file needs no copy of it and cannot
    // drift; every key lands on its schema default THROUGH the engine's resolver, never
    // a mirrored literal (the drift rule the resetThresholds comment above states) —
    // which is what makes it correct now that a default is a concrete colour rather
    // than a sentinel. Each sheet lists BOTH polarities: leaving the hidden one tuned
    // would resurrect old picks on the next theme switch.
    /**
     * @param {string} arg Comma-separated key list (the button's data-action-arg).
     * @param {Object} S Live settings state (mutated in place).
     * @param {Object} env Platform env (unused — the keys are platform-independent).
     * @param {function(string): *} defaultOf The engine's stored-shape schema default
     *     resolver (defaultAsStored).
     * @returns {boolean} true so the engine re-renders with the restored state.
     */
    PConf.actions.resetGraphColors = function (arg, S, env, defaultOf) {
        if (!arg || !S || !defaultOf) { return false; }
        var keys = String(arg).split(',');
        for (var i = 0; i < keys.length; i++) {
            if (keys[i]) { S[keys[i]] = defaultOf(keys[i]); }
        }
        return true;
    };

    // The night tint a metric's filled area is actually painted in, as a hex string for
    // the two display surfaces below. line-style.js owns the rule (the user's own pick,
    // else the fill colour they chose, else the metric's hand-tuned built-in) and hands
    // back null for that last arm, so the built-in is filled in here. Written as a
    // fallback ARGUMENT rather than `graphNightTint(...) || default`: GColorBlack is
    // 0x000000 and would fail a truthiness test.
    /**
     * @param {Object} S Live settings state.
     * @param {string} metric A metric id (line-style.js' graphColorKey vocabulary).
     * @param {string} suffix 'Dark'|'Light' — the polarity being edited.
     * @returns {string} '#RRGGBB' (uppercase).
     */
    function graphNightTintHex(S, metric, suffix) {
        return colorHexOf(lineStyle.graphNightTint(S, metric, suffix),
            lineStyle.graphColorDefault(metric, 'Night', suffix, S));
    }

    // The night-tint picker inside a metric's colour sheet paints the CASCADED colour
    // (engine.js' displayFrom hook), not the value stored under its own key: with the
    // page-side carry gone, a tint the user has not claimed sits on its built-in while
    // the graph draws the fill colour, and a picker showing the built-in would be a
    // stale swatch. Clicking the shown swatch still writes it — that pins the tint as a
    // real pick, which is exactly what a deliberate click means.
    /**
     * @param {Object} S Live settings state.
     * @param {Object} env Platform env (unused — the cascade is platform-independent).
     * @param {Object} args displayFrom.args — {scope, suffix} plus the merged messageKey.
     * @returns {?string} '#RRGGBB' to paint, or null to fall back to the stored value.
     */
    PConf.displayResolvers.register('graphNightTint', function (S, env, args) {
        if (!lineStyle || !S || !args || !args.scope || !args.suffix) { return null; }
        return graphNightTintHex(S, args.scope, args.suffix);
    });

    // Row badge for the Graph-colors card (schema.js' GRAPH_COLOR_ROWS): the preview
    // between a row's label and its Edit button.
    //
    // ONE DOT PER PICKER in that row's sheet — three for a metric (line, fill, night
    // tint), one for feels (which never fills, so line-style hands it no fill or tint
    // key) and two for the night band — so the badge is the row's whole colour state
    // rather than a sample of it, and the dot count also says how many pickers are
    // behind Edit. The threshold badge shows two dots for the same reason: a threshold
    // kind owns exactly two colours.
    //
    // The last dot of a multi-dot row is drawn as a ring purely so several chips read
    // as several colours instead of one bar; unlike the threshold badge's ring — the
    // watch's own outline (a warn look) against its fill — it carries no meaning of
    // its own.
    //
    // Polarity: the sheet's pickers gate on the RAW `theme` value, so the badge must
    // fold nothing either — hence themePolarity true even when a B&W-polarity watch is
    // being previewed (the same choice, for the same reason, as the forecast preview's
    // caps). The env.color guard is belt-and-braces behind the row's COLOR capability.
    /**
     * @param {Object} S Live settings state (colors as '#RRGGBB').
     * @param {Object} env Platform env; env.color gates the whole card.
     * @param {Object} args editBadgeFrom.args — {scope}, the row's identity (a `sheet`
     *     row has no messageKey for the engine to merge in).
     * @returns {?{label: string, dots: Object[]}} The badge, or null to render none.
     */
    PConf.badgeResolvers.register('graphColorSwatch', function (S, env, args) {
        if (!lineStyle || !env || !env.color || !args || !args.scope) { return null; }
        var scope = args.scope;
        var sfx = lineStyle.renderContextFor(S, {color: true, themePolarity: true}).suffix;
        var roles = lineStyle.graphColorRoles(scope);
        var dots = [], i;
        for (i = 0; i < roles.length; i++) {
            dots.push({
                // The colour that row's picker will show as highlighted; the built-in
                // stands in until the key is written. That is the STORED colour for
                // every role but the night tint, which cascades from the fill at resolve
                // time — so it goes through graphNightTintHex above, the same helper the
                // sheet's own swatch reaches via the 'graphNightTint' displayResolver.
                color: roles[i] === 'Night'
                    ? graphNightTintHex(S, scope, sfx)
                    : colorHexOf(S[lineStyle.graphColorKey(scope, roles[i], sfx)],
                        lineStyle.graphColorDefault(scope, roles[i], sfx, S)),
                ring: roles.length > 1 && i === roles.length - 1
            });
        }
        return {label: 'Edit', dots: dots};
    });

    // Row badge for a `sheet` row whose sheet holds ONE rgb control — schema.js'
    // Nighttime card, whose "Color" row opens the dim-backlight sliders. It reports a
    // `chip`, not `dots`: the engine prints that as the full swatch-and-hex readout the
    // sheet itself shows above the sliders (html.js swatchReadout, one builder for both),
    // so the row names the colour it is set to instead of hinting at it with a 9px pip.
    // The graph rows keep dots because each of them previews two or three colours at
    // once and three readouts would not fit a row — chip is the ONE-colour shape.
    //
    // The hex is derived, not stored: the value is the control's "r,g,b" wire string,
    // parsed by rgb-control.js' own parser so an unset or bruised value (blank, two
    // channels, 300) badges exactly the colour the sliders would open on rather than a
    // second reading of the format.
    /**
     * @param {Object} S Live settings state.
     * @param {Object} env Platform env — unused: the row that carries this badge owns
     *     the hardware gate (and the sheet repeats it), so a badge is only ever asked
     *     for where the colour applies.
     * @param {Object} args editBadgeFrom.args — {key, defaultValue}: the rgb key this
     *     row previews (a `sheet` row has no messageKey of its own to merge in) and
     *     that key's schema default, for a value the parser rejects.
     * @returns {?{label: string, ariaNote: string, chip: string}} The badge, or null
     *     when the row named no key to preview.
     */
    PConf.badgeResolvers.register('rgbSwatch', function (S, env, args) {
        if (!rgbControl || !args || !args.key) { return null; }
        var hex = rgbControl.rgbHex(rgbControl.parseRgb(S ? S[args.key] : null,
            {defaultValue: args.defaultValue}));
        // The readout is aria-hidden (it is a preview, and its hex would be read out a
        // character at a time), so ariaNote stays the announcement of the colour — the
        // same string now printed on the row and above the sheet's sliders.
        return {label: 'Edit', ariaNote: hex, chip: hex};
    });

    // Reset-to-defaults for the whole status-bar card (the inline text button closing the
    // Status slots tab's intro — schema.js introAction): every slot of every bar back to its
    // platform-aware default (the same statusSlotDefault seed a fresh install gets,
    // hrDefaults flavor included), and every other covered key back to ITS SCHEMA
    // DEFAULT, resolved through the engine — no value is mirrored here, because
    // mirrored literals drift when the schema changes: the wind arrow's hardcoded
    // false outlived the schema flipping it to true, and the non-uniform "Show
    // unit" defaults only ever escaped the same fate because a test pinned them.
    // Covered alongside the slots: the master Bold row, each kind's Bold mode
    // (their sheets carry no reset of their own), the per-kind display options
    // (the temp slot's Temp/Feels/Both and the day-max kinds' Now/Alert/Both pills
    // with the rows shaping their pair and UV's tomorrow mark, the wind/gust
    // direction arrows), the date formats and the Show-unit toggles
    // (the Alert levels group's own reset deliberately covers only the levels),
    // each weather kind's slot Highlight switch (a slot-sheet row, like Bold — a
    // goal kind's rides its Goals header and that group's reset), each bar's two Alerts
    // sides (on-demand.js DEFAULTS' eight side lists — each bar's read-only Alerts row in
    // this card shows them; the Alerts tab's reset restores them too), and, on aplite
    // only (a watch without On demand), the Watch Status Bar's other rows: 'Show battery
    // below 10%' (batteryLowOnly), the quiet-time icon (showQt), the bluetooth vibration
    // (vibe) and icon (btIcons) — elsewhere those keys belong to the Alert settings card.
    // Deliberately untouched: thresholds, colors, warn looks and scale maxes (every sheet
    // has its own reset button), the On demand items' own settings (the Alert settings
    // card's reset, resetOnDemand below), and the countdown companion dates (inert once a
    // slot leaves 'countdown'). Silent beyond the re-render, like resetThresholds above —
    // the engine has no shared toast for [data-action] buttons.
    /**
     * @param {*} arg Unused (the engine passes the button's data-action-arg).
     * @param {Object} S Live settings state (mutated in place).
     * @param {Object} env Platform env (env.hr picks the health-bar flavor).
     * @param {function(string): *} defaultOf The engine's stored-shape schema
     *     default resolver (defaultAsStored).
     * @returns {boolean} true so the engine re-renders with the restored state.
     */
    PConf.actions.resetStatusSlots = function (arg, S, env, defaultOf) {
        if (!S || !defaultOf) { return false; }
        var slotKeys = statusLineCatalog.allSlotKeys();
        for (var i = 0; i < slotKeys.length; i++) {
            S[slotKeys[i]] = statusLineCatalog.slotDefault(slotKeys[i], env);
        }
        var schemaKeys = ['statusBoldAll', 'tempSlotDisplay',
            // How the temp slot prints its pair in Both mode (separator preset,
            // custom separator text, spacing, which value leads).
            'tempSlotSeparator', 'tempSlotSeparatorCustom', 'tempSlotSeparatorSpaced',
            'tempSlotOrder',
            'dateSlotMonthFormat',
            'windSlotDirection', 'gustSlotDirection']
            // ...and every day-max kind's mode, pair and tomorrow-mark rows (UV,
            // wind, gusts, AQI), from the catalog's one table.
            .concat(statusLineCatalog.dayMaxSettingKeys());
        // The Watch Status Bar's own toggles exist only where On demand does not.
        if (env && env.onDemand === false) {
            schemaKeys.push('batteryLowOnly', 'showQt', 'vibe', 'btIcons');
        }
        // Every bar's On demand sides: the items placed there.
        schemaKeys = schemaKeys.concat(onDemandListKeys());
        // dateSlotFullFormat is the one key here whose fresh-install value is
        // COUNTRY-derived, not the schema default: the wizard writes
        // mapCountry().dateSlotFullFormat ('slash' for US installs). Resetting
        // it through defaultOf would hand a US install the dotted '09.07.26'
        // no fresh install ever shows — so it resets through the same
        // derivation the wizard applies (country-defaults.js, the one home
        // for that rule).
        S.dateSlotFullFormat = CD.mapCountry(S.holidayCountry).dateSlotFullFormat;
        // The six "Show unit" keys come from the catalog's table — the same
        // list the baker and renderSignature derive from.
        for (var u = 0; u < statusLineCatalog.UNIT_TOGGLES.length; u++) {
            schemaKeys.push(statusLineCatalog.UNIT_TOGGLES[u].key);
        }
        for (var k = 0; k < thresholds.KINDS.length; k++) {
            var kd = thresholds.KINDS[k];
            schemaKeys.push('thresh' + kd.key + 'BoldMode');
            if (thresholds.isWeatherKind(kd)) { schemaKeys.push('thresh' + kd.key + 'On'); }
        }
        for (var n = 0; n < schemaKeys.length; n++) {
            S[schemaKeys[n]] = defaultOf(schemaKeys[n]);
        }
        return true;
    };

    /**
     * The eight side lists (on-demand.js itemsKey), in BARS × SIDES order: where each item
     * shows, which both resets restore.
     * @returns {string[]} The keys.
     */
    function onDemandListKeys() {
        var keys = [];
        for (var b = 0; b < onDemand.BARS.length; b++) {
            for (var sd = 0; sd < onDemand.SIDES.length; sd++) {
                keys.push(onDemand.itemsKey(onDemand.BARS[b].bar, onDemand.SIDES[sd]));
            }
        }
        return keys;
    }

    // Reset-to-defaults for the Alert settings card (the inline text button closing its intro
    // on the Alerts tab — schema.js ON_DEMAND_INTRO): the items' own settings back to their
    // schema defaults, via the engine's resolver like resetStatusSlots above — the Battery
    // item's warn level and Look, the Bluetooth item's Show and vibration, the rain alert's
    // window and look, each metric alert's Look, Days and tomorrow mark (the contract's
    // ALERT_KINDS, the five the card lists) — and where each item shows: the eight side
    // lists its sheets' Shows on grids write (the status card's reset restores those too, as
    // its bars' Alerts rows show them). Deliberately untouched: the levels, warn looks and
    // colours (each sheet's Alert levels header has its own reset, which also serves the
    // slots' highlight).
    /**
     * @param {*} arg Unused (the engine passes the button's data-action-arg).
     * @param {Object} S Live settings state (mutated in place).
     * @param {Object} env Platform env (unused).
     * @param {function(string): *} defaultOf The engine's stored-shape schema
     *     default resolver (defaultAsStored).
     * @returns {boolean} true so the engine re-renders with the restored state.
     */
    PConf.actions.resetOnDemand = function (arg, S, env, defaultOf) {
        if (!S || !defaultOf) { return false; }
        var keys = ['batteryLowLevel', 'batteryLowDisplay', 'btIcons', 'vibe',
            'rainCountdownHorizon', 'rainAlertDisplay'];
        for (var k = 0; k < thresholds.ALERT_KINDS.length; k++) {
            var stem = thresholds.ALERT_KINDS[k].key;
            keys.push('alert' + stem + 'Display', 'alert' + stem + 'Days',
                'alert' + stem + 'NextDayMark');
        }
        keys = keys.concat(onDemandListKeys());
        for (var n = 0; n < keys.length; n++) {
            S[keys[n]] = defaultOf(keys[n]);
        }
        return true;
    };

    /**
     * The warn pip of a threshold badge, in the watch's own language: the kind's
     * warn look decides the shape — no pip for 'none' (the watch draws no box at
     * warn), a ring for 'outline', a filled dot for 'fill' — painted in the warn
     * colour (the theme text colour while it is auto). The look is the contract's
     * resolution (warnLookFor), so an unset key previews the platform default.
     * @param {Object} S Live settings state.
     * @param {Object} env Platform env (env.color picks the default look).
     * @param {string} stem Kind key stem, e.g. 'Uv'.
     * @returns {?{color: string, ring: (boolean|undefined)}} The pip, or null for none.
     */
    function warnPip(S, env, stem) {
        var look = thresholds.warnLookFor(S, stem, env ? env.color : undefined);
        if (look === 'none') { return null; }
        var color = thresholdDisplayColor(S, stem, 'Warn', env);
        if (color === null) { return null; }
        return look === 'outline' ? {color: color, ring: true} : {color: color};
    }

    /**
     * The badge dots of an enabled kind: the warn pip (warnPip — absent for the
     * 'none' look) then the danger dot (danger always fills).
     * @param {Object} S Live settings state.
     * @param {Object} env Platform env.
     * @param {string} stem Kind key stem.
     * @returns {Object[]} Ordered dot list.
     */
    function levelDots(S, env, stem) {
        var pip = warnPip(S, env, stem);
        var danger = {color: thresholdDisplayColor(S, stem, 'Danger', env)};
        return pip ? [pip, danger] : [danger];
    }

    /**
     * The pencil badge of one threshold kind's slot: the warn pip + danger-color
     * dot (levelDots) while the kind's highlight is ENABLED (the contract's
     * kindConfig — the rule the watch actually packs with), plus the bold 'B'.
     * (The Alert settings card's rows badge the alert instead — alertLevelBadge.)
     * @param {Object} S Live settings state.
     * @param {Object} env Platform env (callers gate on env.thresholds; env.color
     *     picks the default warn look).
     * @param {number} kindIndex Index into the contract's KINDS.
     * @returns {Object} Badge state for the engine's editBadgeFrom.
     */
    function penStateForKind(S, env, kindIndex) {
        var key = thresholds.KINDS[kindIndex].key;
        var enabled = thresholds.kindConfig(S, kindIndex).enabled;
        // EFFECTIVE always-bold, not the stored ladder alone: the Watch-tab
        // master row packs every kind's bold cell as always at wire time
        // (status-wire.js buildSettingsBlob) without touching the stored
        // per-kind values, and the badge previews what the watch will
        // actually render — so the master lights every slot's B.
        var boldAlways = (S.statusBoldAll === 'all'
            || S['thresh' + key + 'BoldMode'] === 'always');
        var notes = [];
        if (enabled) { notes.push('highlighting on'); }
        if (boldAlways) { notes.push('always bold'); }
        return {
            // The sheet-trigger BUTTON label. The slot sheet configures the whole
            // slot (bold + thresholds), not just the warn/goal pair, so the button
            // says what it does rather than naming one section.
            // A disabled kind still gets the labeled button — it just badges no
            // dots and adds no aria note, since there is no state to preview.
            label: 'Edit',
            ariaNote: notes.join(', '),
            bold: boldAlways,
            // The watch's own language: warn in its look, danger FILLED.
            dots: enabled ? levelDots(S, env, key) : []
        };
    }

    // Pencil badge (engine item.editBadgeFrom): when the slot's current value is an
    // ENABLED threshold kind, the pencil gains a warn-color ring + danger-color dot,
    // and a 'B' when the slot prints always-bold. Same env gate + code→kind mapping
    // as the sheet resolver above.
    PConf.badgeResolvers.register('thresholdPenState', function (S, env, args) {
        if (!env || !env.thresholds) { return null; }
        var code = S[args.messageKey];
        for (var i = 0; i < thresholds.KINDS.length; i++) {
            if (thresholds.KINDS[i].code === code) { return penStateForKind(S, env, i); }
        }
        return null;
    });

    /**
     * The contract's metric alert behind an Alert settings card row, found by the row's key
     * stem (the schema builds each row's sheet and keys from it).
     * @param {*} keyStem Kind key stem, e.g. 'Uv'.
     * @returns {?{code: string, key: string}} Its ALERT_KINDS entry, or null for a
     *     stem with no metric alert.
     */
    function alertKindOf(keyStem) {
        for (var i = 0; i < thresholds.ALERT_KINDS.length; i++) {
            if (thresholds.ALERT_KINDS[i].key === keyStem) { return thresholds.ALERT_KINDS[i]; }
        }
        return null;
    }

    // What every Alerts-tab row reads while its item is ticked on no side of a bar that
    // exists (on-demand.js placedAnywhere): the item cannot show anywhere.
    var NOT_PLACED = 'Not in any status bar';
    // The bars by their short names, in the page's order (the Status bars tab's): the
    // rows' "where it shows" and the Shows on grids.
    var PAGE_BARS = [['top', 'Watch bar'], ['forecast', 'Forecast bar'], ['health', 'Health bar'],
        ['radar', 'Radar bar']];

    /**
     * Where an alert shows, for its Alerts-tab row: each bar edge it sits on, in the
     * page's bar order — "Watch bar, left", "Watch bar, left · Forecast bar, right" — read
     * the way the watch places it (on-demand.js sideOf: a tick on a bar that exists).
     * @param {Object} S Live settings state.
     * @param {string} code An on-demand.js ITEMS code.
     * @param {Object} env Platform env.
     * @returns {string} The placement, or '' when it shows nowhere.
     */
    function placementText(S, code, env) {
        var out = [];
        PAGE_BARS.forEach(function (b) {
            var side = onDemand.sideOf(S || {}, b[0], code, env);
            if (side) { out.push(b[1] + ', ' + side); }
        });
        return out.join(' · ');
    }

    /**
     * A row's live text followed by where its alert shows.
     * @param {string} text The row's own text.
     * @param {Object} S Live settings state.
     * @param {string} code The item's code.
     * @param {Object} env Platform env.
     * @returns {string} "<text> · <placement>".
     */
    function withPlacement(text, S, code, env) {
        var where = placementText(S, code, env);
        return where ? text + ' · ' + where : text;
    }

    /**
     * The Alert settings card row's badge for a metric alert (editBadgeFrom, args.keyStem):
     * the colours the watch draws that alert in, while its item is placed on a bar (no
     * dots at all otherwise) — the warn pip in the kind's warn look (no pip for 'none', a
     * ring for 'outline', a dot for 'fill' — warnPip, shared with the slot pencil) and a
     * dot in the danger colour (the filled box). No 'B': bold is how a SLOT prints, not
     * part of the alert. The placement decides, not the slot's Highlight switch: the
     * entries take the kind's colours either way.
     * @param {Object} S Live settings state.
     * @param {Object} env Platform env.
     * @param {{keyStem: string}} args The row's alert, by its kind's key stem.
     * @returns {?Object} Badge state, or null where the alert cannot exist (aplite,
     *     a stem with no metric alert).
     */
    function alertLevelBadge(S, env, args) {
        if (!env || !env.thresholds) { return null; }
        var metric = alertKindOf(args && args.keyStem);
        if (!metric) { return null; }
        var st = S || {};
        if (!onDemand.placedAnywhere(st, metric.code, env)) {
            return {label: 'Edit', ariaNote: 'not in any status bar', dots: []};
        }
        return {label: 'Edit', ariaNote: '', dots: levelDots(st, env, metric.key)};
    }
    PConf.badgeResolvers.register('alertLevelBadge', alertLevelBadge);

    /**
     * The Alert settings card's Rain row badge (editBadgeFrom): the Edit button every row
     * carries, and no dots — rain draws in the radar's colours and never boxes. Only the
     * aria note follows the placement.
     * @param {Object} S Live settings state.
     * @param {Object} env Platform env.
     * @returns {Object} Badge state.
     */
    function rainAlertBadge(S, env) {
        return {label: 'Edit', ariaNote: onDemand.placedAnywhere(S, 'rain', env) ? '' : 'not in any status bar',
            dots: []};
    }
    PConf.badgeResolvers.register('rainAlertBadge', rainAlertBadge);

    /**
     * The badge of an Alert settings card row with no colours to preview (Battery,
     * Bluetooth, Quiet time, Sleep): the Edit button alone.
     * @returns {Object} Badge state.
     */
    function onDemandBadge() {
        return {label: 'Edit', ariaNote: '', dots: []};
    }
    PConf.badgeResolvers.register('onDemandBadge', onDemandBadge);

    /**
     * The Alerts-tab row's summary for a metric alert: "Not in any status bar" while its
     * item is ticked on no bar, else the kind's levels and where it shows, e.g. "Warn 40
     * kph · Danger 60 kph · Forecast bar, right" (args.levelsOnly: the levels alone, for
     * a slot dialog's row). The pair is the resolved one (the stored pair, else the seed — what the
     * watch judges with), in the unit the kind's slider shows, so the row reads the
     * numbers its sheet opens on. A Days other than the default follows by the label its
     * sheet offers it under ("Warn 6 · Danger 8 · Today"); the default adds nothing. The
     * Days is the contract's reading (alertDays), so an unknown value reads as the
     * default the phone bakes with. Only numbers, the range table's unit label and the
     * schema's option label are interpolated (the engine prints hints as raw HTML).
     * @param {Object} S Live settings state.
     * @param {Object} env Platform env.
     * @param {{keyStem: string, days: Array<Array<string>>}} args The row's kind key
     *     stem, e.g. 'Wind', and the Days options (schema.js ALERT_DAYS_OPTIONS).
     * @returns {?string} The hint, or null where the levels do not exist (aplite,
     *     a stem with no metric alert) — the engine then falls back to the static hint.
     */
    function alertLevelsHint(S, env, args) {
        if (!env || !env.thresholds) { return null; }
        var metric = alertKindOf(args && args.keyStem);
        if (!metric) { return null; }
        var st = S || {};
        var levelsOnly = Boolean(args && args.levelsOnly);
        if (!levelsOnly && !onDemand.placedAnywhere(st, metric.code, env)) { return NOT_PLACED; }
        var pair = thresholds.resolvedPair(metric.key, st);
        var unit = rangeOf(metric.key, st).unit;
        var suffix = unit ? ' ' + unit : '';
        var text = 'Warn ' + pair.warn + suffix + ' · Danger ' + pair.danger + suffix;
        // A slot dialog's "Alert levels and colors" row (levelsOnly) says the levels
        // alone: they drive the slot's highlight wherever the alert is placed.
        if (levelsOnly) { return text; }
        var days = thresholds.alertDays(st, metric.code);
        var daysLabel = days === thresholds.alertDays(null, metric.code) ? null : optionLabel(args.days, days);
        return withPlacement(daysLabel ? text + ' · ' + daysLabel : text, st, metric.code, env);
    }
    PConf.hintResolvers.register('alertLevelsHint', alertLevelsHint);

    /**
     * The label of a stored value in a [label, value] option list.
     * @param {Array<Array<string>>} options The list.
     * @param {*} value The stored value.
     * @returns {?string} Its label, or null when the list has no such value.
     */
    function optionLabel(options, value) {
        for (var i = 0; i < (options || []).length; i++) {
            if (options[i][1] === String(value)) { return options[i][0]; }
        }
        return null;
    }

    /**
     * Whether the radar fetches nothing (radar mode 'off', the schema default 'graph'
     * for an absent key): the rain alert then cannot show.
     * @param {Object} S Live settings state.
     * @returns {boolean}
     */
    function radarOff(S) {
        return ((S && S.radarMode) || 'graph') === 'off';
    }

    /**
     * The Alert settings card's Rain row hint: "Turn on the rain radar (Radar tab)" while the
     * radar is off (that comes first: no tick helps then), "Not in any status bar" while
     * Rain is ticked on no bar, else its time window and look by the labels its sheet
     * offers them under, e.g. "Within 60 min · Text". The lists come from the schema
     * through args (one copy of each); the look and the defaults come from the contract
     * (rainAlert), so a window outside the list (a legacy '0') reads as the default
     * window and an unknown look as the look the watch then draws.
     * @param {Object} S Live settings state.
     * @param {Object} env Platform env.
     * @param {{windows: Array<Array<string>>, looks: Array<Array<string>>}} args The
     *     sheet's option lists (schema.js RAIN_WINDOW_OPTIONS, RAIN_LOOK_OPTIONS).
     * @returns {string} The hint.
     */
    function rainAlertHint(S, env, args) {
        var st = S || {};
        if (radarOff(st)) { return 'Turn on the rain radar (Watchface › Views)'; }
        if (!onDemand.placedAnywhere(st, 'rain', env)) { return NOT_PLACED; }
        var rain = thresholds.rainAlert(st);
        var a = args || {};
        // The window by its long label — the stored pick, not its parse — and the
        // contract's default window for one outside the list.
        return withPlacement((optionLabel(a.windows, st.rainCountdownHorizon)
                || optionLabel(a.windows, thresholds.rainAlert(null).horizonMin))
            + ' · ' + optionLabel(a.looks, rain.look), st, 'rain', env);
    }
    PConf.hintResolvers.register('rainAlertHint', rainAlertHint);

    /**
     * Whether a placed item cannot show, wherever it is placed: Rain while the radar is
     * off, Pollen off the DWD provider.
     * @param {Object} S Live settings state.
     * @param {string} code An on-demand.js ITEMS code.
     * @returns {?string} Why it cannot show, or null when it can.
     */
    function onDemandBlocked(S, code) {
        if (code === 'rain' && radarOff(S)) { return 'Needs the rain radar (Watchface › Views)'; }
        if (code === 'pollen' && (!S || S.provider !== 'dwd')) { return 'DWD provider only'; }
        return null;
    }

    /**
     * The rows of an item's Shows on grid (schema.js showsOnRows; a checklist): one per
     * status bar the watch draws (on-demand.js barExists, the rule the Status slots tab's
     * bar gates RADAR_BAR_WHEN / HEALTH_BAR_WHEN state), in the page's order. Each row
     * names its two side lists in meta.keys (Left, Right), the lists its ticks read and
     * write (reset-status-defaults.js onDemandTick). Like those gates, it ignores the
     * layout: a bar no view draws still gets its row. While the item
     * cannot show at all (onDemandBlocked: Rain with the radar off, Pollen off DWD) the
     * rows go inert and keep their ticks; the Rain sheet's box says why, and Pollen's card
     * row (so its sheet) is gone off DWD.
     * @param {Object} S Live settings state.
     * @param {Object} env Platform env.
     * @param {{code: string, bars: string[], names: Object<string, string>}} args The item,
     *     the bars in the page's order and their names.
     * @returns {Array<Array>} [label, value, meta] options.
     */
    function onDemandBars(S, env, args) {
        var a = args || {};
        var inert = onDemandBlocked(S, a.code) !== null;
        var out = [];
        (a.bars || []).forEach(function (bar) {
            var reason = null;
            if (!onDemand.barExists(S, bar, env)) {
                // A bar this watch can never draw (no radar or health on aplite-class
                // hardware) has no row; one whose view is merely off is shown inert, with
                // the reason, so the grid always lists the same bars.
                reason = barOffReason(S, bar, env);
                if (reason === null) { return; }
            }
            var meta = {keys: onDemand.SIDES.map(function (side) { return onDemand.itemsKey(bar, side); })};
            if (inert || reason) { meta.disabled = true; }
            if (reason) { meta.desc = reason; }
            out.push([(a.names || {})[bar] || bar, bar, meta]);
        });
        return out;
    }

    /**
     * Why a bar is not drawn, for its inert Shows on row: its view is off, or shows no
     * bar in its mode. null for a bar this watch cannot draw at all (no row then).
     * @param {Object} S Live settings state.
     * @param {string} bar An on-demand.js BARS bar.
     * @param {Object} env Platform env.
     * @returns {?string} The reason.
     */
    function barOffReason(S, bar, env) {
        var st = S || {};
        if (bar === 'radar') {
            if (env && env.radar === false) { return null; }
            return (st.radarMode || 'graph') === 'off' ? 'Radar view is off' : 'Rain alert only has no radar bar';
        }
        if (bar === 'health') {
            if (env && env.health === false) { return null; }
            return (st.healthMode || 'all') === 'off' ? 'Health view is off' : 'Status slots only has no health bar';
        }
        return null;
    }
    PConf.optionsResolvers.register('onDemandBars', onDemandBars);

    /**
     * A bar's read-only Alerts row on the Status slots tab (its hint): per side, the icons
     * of the placed items that can show, in priority order (the Alert settings card's), each
     * side one unbreakable run ("Left" + icons, "Right" + icons; shell.html .ico-run), so a
     * narrow phone wraps between the sides, never inside one; then args.where on a line of
     * its own, where they are set up (a link to the Alerts tab). Each icon carries its
     * item's name (role img), so a screen reader reads "Left Bluetooth Rain Right Battery".
     * Blocked items (Rain with the radar off, Pollen off DWD) are left out, as the watch
     * leaves them out; when every placed item is blocked the row says so. With nothing
     * placed, the pointer alone. The names are on-demand.js ITEMS constants, never
     * settings: the engine prints a hint as raw HTML.
     * @param {Object} S Live settings state.
     * @param {Object} env Platform env (unused).
     * @param {{bar: string, where: string}} args The bar (an on-demand.js BARS bar) and the
     *     schema's pointer HTML.
     * @returns {string} The hint HTML.
     */
    function onDemandBarIcons(S, env, args) {
        var runs = [], placed = false;
        onDemand.SIDES.forEach(function (side) {
            var icons = '';
            onDemand.parse((S || {})[onDemand.itemsKey(args.bar, side)]).forEach(function (code) {
                placed = true;
                if (onDemandBlocked(S, code) !== null) { return; }
                var item = onDemand.ITEMS[onDemand.itemIndex(code)];
                var svg = PConf.icons ? PConf.icons.get(item.icon) : null;
                if (svg) {
                    icons += '<span class="lbl-ico" role="img" aria-label="' + item.label + '">' + svg + '</span>';
                }
            });
            if (icons) { runs.push('<span class="ico-run">' + (side === 'left' ? 'Left ' : 'Right ') + icons + '</span>'); }
        });
        if (!placed) { return args.where; }
        return runs.length ? runs.join(' ') : 'None of the alerts placed here can show.';
    }
    PConf.hintResolvers.register('onDemandBarIcons', onDemandBarIcons);

    /**
     * Whether a bar that shows the Battery item also shows the watch battery in a slot
     * (the Watch battery glyph or its percentage, any position): the watch then leaves the
     * item out while that slot stays visible (status_on_demand.c battery_slots), whatever
     * the item's Look.
     * @param {Object} S Live settings state.
     * @param {Object} env Platform env.
     * @returns {boolean}
     */
    function batteryBesideSlot(S, env) {
        var positions = [['Left', 'left'], ['Mid', 'mid'], ['Right', 'right']];
        for (var b = 0; b < onDemand.BARS.length; b++) {
            var bar = onDemand.BARS[b];
            if (onDemand.sideOf(S, bar.bar, 'battery', env) === null) { continue; }
            for (var p = 0; p < positions.length; p++) {
                var slotKey = bar.prefix + positions[p][0];
                var code = statusLineCatalog.resolveSelection(S[slotKey], S, env,
                    {slotKey: slotKey, position: positions[p][1]});
                if (code === 'battery' || code === 'batteryPct') { return true; }
            }
        }
        return false;
    }

    /**
     * The Battery row's live text: "At 10% or below" (the warn level the watch is sent,
     * on its charge step — on-demand.js batteryLevel), " · Icon + value" for that Look,
     * and " · Hidden while a battery slot shows the charge" while a bar it is ticked on
     * shows the watch battery in a slot. The item stays ticked either way.
     * @param {Object} S Live settings state.
     * @param {Object} env Platform env.
     * @returns {string} The hint.
     */
    function onDemandBatteryText(S, env) {
        var st = S || {};
        if (!onDemand.placedAnywhere(st, 'battery', env)) { return NOT_PLACED; }
        var text = 'At ' + onDemand.batteryLevel(st, env) + '% or below';
        if (onDemand.batteryShowsValue(st)) { text += ' · Icon + value'; }
        if (batteryBesideSlot(st, env)) { text += ' · Hidden while a battery slot shows the charge'; }
        return withPlacement(text, st, 'battery', env);
    }
    PConf.hintResolvers.register('onDemandBatteryText', onDemandBatteryText);

    // The Bluetooth row's rule per btIcons value (the Show row's choice).
    var BT_SHOW_TEXT = {disconnected: 'When disconnected', connected: 'When connected',
        both: 'Always', none: 'Never'};

    /**
     * The Bluetooth row's live text: when the icon shows (by btIcons), plus
     * " · Vibrates on disconnect" while vibe is on — also while the item is ticked on no
     * bar, because the vibration does not depend on the tick.
     * @param {Object} S Live settings state.
     * @param {Object} env Platform env.
     * @returns {string} The hint.
     */
    function onDemandBluetoothText(S, env) {
        var st = S || {};
        var vibe = st.vibe === true ? ' · Vibrates on disconnect' : '';
        if (!onDemand.placedAnywhere(st, 'bt', env)) { return NOT_PLACED + vibe; }
        return withPlacement((BT_SHOW_TEXT[st.btIcons] || BT_SHOW_TEXT.disconnected) + vibe, st, 'bt', env);
    }
    PConf.hintResolvers.register('onDemandBluetoothText', onDemandBluetoothText);

    /**
     * A settings-less item's live text (Quiet time): its rule, or "Not in any status
     * bar".
     * @param {Object} S Live settings state.
     * @param {Object} env Platform env.
     * @param {{code: string, text: string}} args The item and its rule.
     * @returns {string} The hint.
     */
    function onDemandPlainText(S, env, args) {
        return onDemand.placedAnywhere(S, args.code, env) ? withPlacement(args.text, S, args.code, env) : NOT_PLACED;
    }
    PConf.hintResolvers.register('onDemandPlainText', onDemandPlainText);

    /**
     * @param {*} hour A stored hour ('0'..'23').
     * @param {number} fallback The hour for an unparseable value.
     * @returns {string} e.g. '7:00'
     */
    function hourText(hour, fallback) {
        var h = parseInt(hour, 10);
        return (isNaN(h) ? fallback : h) + ':00';
    }

    /**
     * The Sleep row's live text: the Battery saver's hours (the phone's IS_SLEEPING
     * window, which the Z's follow), or where to switch the saver on.
     * @param {Object} S Live settings state.
     * @param {Object} env Platform env.
     * @returns {string} The hint.
     */
    function onDemandSleepText(S, env) {
        var st = S || {};
        if (!onDemand.placedAnywhere(st, 'snooze', env)) { return NOT_PLACED; }
        if (st.sleepNightEnabled === false) { return 'Battery saver is off (Watchface › Theme & night)'; }
        return withPlacement('During the Battery saver hours, ' + hourText(st.sleepStartHour, 0) + '–'
            + hourText(st.sleepEndHour, 7), st, 'snooze', env);
    }
    PConf.hintResolvers.register('onDemandSleepText', onDemandSleepText);

    /**
     * The layout preset's hint for 'Weather only', whose Default view differs per radar
     * mode (view-cycle.js buildViewCycle): the schema's text for the stored radarMode,
     * an absent one read as the radio's default ('graph'). Every other preset answers
     * null, so its row keeps the static hintByValue.
     * @param {Object} S Live settings state.
     * @param {Object} env Platform env (unused).
     * @param {{value: string, byRadar: Object}} args The row's shown preset + the
     *     per-radarMode texts (schema.js).
     * @returns {?string} The hint, or null for the static one.
     */
    function weatherOnlyHint(S, env, args) {
        if (!args || args.value !== 'weatherOnly' || !args.byRadar) { return null; }
        var mode = (S && S.radarMode) || 'graph';
        var text = args.byRadar[mode];
        if (!text) { return null; }
        // "Flick to health" only while a Health view exists to flick to: the health
        // bar or graph (healthMode 'status' / 'all', the schema default) on a watch
        // with health sensors. 'slot' puts health in the status slots and adds no view,
        // so the Weather-only cycle is then its Default view alone (view-cycle.js).
        var healthMode = (S && S.healthMode) || 'all';
        var flick = (healthMode === 'status' || healthMode === 'all')
            && !(env && env.health === false);
        return flick ? text + ' Flick to health.' : text;
    }
    PConf.hintResolvers.register('weatherOnlyHint', weatherOnlyHint);

    var viewCycleLib = (typeof require !== 'undefined')
        ? require('../view-cycle.js') : window.VIEW_CYCLE;

    // layoutPreset options resolver: compactDense is offered once EITHER a health
    // status row OR any radar view is capable — the same radarRow/healthRow gates the
    // compiler, the editor and the sheet gates fold by (view-cycle.js capabilities;
    // both radar modes build dense radar cycles since the CAL2_RF_D/CAL2_HR_D fold).
    // Custom is offered on every non-aplite platform (aplite is frozen-lean and folds
    // custom to compactCal on the wire; a stored 'custom' lies dormant there —
    // dormantValues). Unknown platform ('' when watchInfo is missing) is treated as
    // capable, matching the payload's own gate.
    PConf.optionsResolvers.register('layoutPresetOptions', function (S, env) {
        var base = [['Full calendar', 'fullCal'], ['Compact calendar', 'compactCal']];
        var caps = viewCycleLib.capabilities(S);
        if (caps.radarRow || caps.healthRow) {
            base.push(['Compact calendar (dense)', 'compactDense']);
        }
        base.push(['No calendar', 'noCal']);
        // Weather only and Custom need a view without top bar (and Weather only the
        // radar): not on aplite, where a stored value lies dormant (dormantValues).
        if (!env || env.platform !== 'aplite') {
            base.push(['Weather only', 'weatherOnly']);
            base.push(['Custom (Beta)', 'custom']);
        }
        return base;
    });

    // Entering Custom seeds the per-view keys ONCE from the preset being left, so the
    // editor opens showing exactly what the watch shows and an untouched session
    // compiles back byte-identical (nothing transmits). Re-picking a preset later
    // leaves the keys stored (dormant) — re-entering Custom restores the user's work.
    // Seeding is ALL the pick does: the editor opens only through the dedicated Edit
    // row (the schema's data-action="openViewEditor" button), never automatically.
    PConf.onChange.register('layoutPresetChanged', function (S, oldValue, newValue) {
        if (newValue !== 'custom') { return; }
        viewCycleLib.seedCustomKeys(S, oldValue);
    });

    // Platform-aware slot default (Approach A single-source): a status slot's fresh-install
    // default comes from the catalog, HR-aware. Consumed by engine.hydrate / resolveRowItem
    // via item.defaultFrom. Mirrors the statusSlot options resolver above.
    PConf.defaultsResolvers.register('statusSlotDefault', function (env, args) {
        return statusLineCatalog.slotDefault(args.slotKey, env);
    });

    PConf.defaultsResolvers.register('todayDate', function () {
        return PConf.engine.formatDateValue(new Date());
    });

    // ---- rate-limit info blocks (tomorrow.io, Rainbow own key) + budget-guard interval resolver ----

    /**
     * A whole number with thousands commas ("5,000"), formatted by hand:
     * Number.prototype.toLocaleString is unreliable in old Android WebViews.
     *
     * @param {number} n Non-negative integer.
     * @returns {string} The number with a comma every three digits.
     */
    function withThousands(n) {
        return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    }

    /**
     * The derived sleep->cadence unlock line for a budget module, or ''. Names the
     * fastest ladder step that does NOT fit at the current pause, and the pause that
     * would unlock it — only when some pause can, and it is longer than the current one.
     *
     * @param {Object} B Budget module (INTERVAL_LADDER/fits/minSleepHoursFor).
     * @param {Object} state Settings state.
     * @param {number} sleep Current night pause in hours.
     * @param {string} qualifier Text after "N-minute updates" (e.g. ' with radar'), or ''.
     * @returns {string} '<br>…' or ''.
     */
    function unlockRuleHtml(B, state, sleep, qualifier) {
        for (var i = 0; i < B.INTERVAL_LADDER.length; i += 1) {
            var min = parseInt(B.INTERVAL_LADDER[i][1], 10);
            if (!B.fits(state, min)) {
                var need = B.minSleepHoursFor(state, min);
                if (need !== null && need > sleep) {
                    return '<br>' + min + '-minute updates' + qualifier
                        + ' need a night pause of ≥ ' + need + ' h — widen the pause to unlock faster updates.';
                }
                return '';
            }
        }
        return '';
    }

    /**
     * The interval a budget read-out computes with: the one Save will store (interval-budget.js
     * fitInterval), not the raw stored value. With a "Fit update interval" guard on, a stored
     * interval the budget no longer affords (radar picked on the Radar tab, the interval set on
     * General) is replaced at Save; warning "over budget" about it would contradict the toggle.
     *
     * @param {Object} state Settings state.
     * @returns {number} Minutes.
     */
    function readoutInterval(state) {
        return parseInt(intervalBudget.fitInterval(state, state.fetchIntervalMin), 10) || 15;
    }

    /**
     * Rate-limit info block under the tomorrow.io key field: free-tier limits,
     * the user's projected usage at the current settings, a ✓/✗ verdict, the
     * derived sleep->cadence unlock rule, and (near the hourly ceiling) a
     * same-hour-save heads-up. Recomputes on every render, so it reacts to
     * fetchIntervalMin / sleep window / provider / radarProvider / guard changes.
     *
     * @param {Object} state Settings state.
     * @param {Object} env Platform env (unused).
     * @returns {string} Block HTML, or '' when no tomorrow.io budget is in play.
     */
    function tomorrowioBudgetBlock(state, env) {
        var B = tomorrowioBudget;
        var cpc = B.callsPerCycle(state);
        if (cpc === 0) { return ''; }
        var interval = readoutInterval(state);
        var sleep = B.sleepHours(state);
        var daily = Math.round(B.dailyCalls(state, interval));
        var ok = B.fits(state, interval);
        // radarOn is specifically "does tomorrow.io radar add calls" — NOT whether radar
        // is enabled at all. A user can run weather on tomorrow.io while radar stays on
        // another provider (Rainbow by default), so only mention radar when it actually
        // counts against this budget; never print "radar off" (it reads as "radar disabled").
        var radarOn = state.radarProvider === 'tomorrowio' && (state.radarMode || 'graph') !== 'off';
        var settingsBits = 'every ' + interval + ' min, '
            + (sleep > 0 ? 'night pause ' + sleep + ' h' : 'no night pause')
            + (radarOn ? ', incl. radar' : '');
        var verdict = ok
            ? '<b>~' + daily + ' calls/day ✓</b>'
            : '<b style="color:#FF6A52">~' + daily + ' calls/day ✗ over budget</b>';
        var html = '<b>Free plan: ' + B.LIMIT_DAY + ' calls/day, ' + B.LIMIT_HOUR + '/hour.</b> '
            + 'Your settings: ' + settingsBits + ' → ' + verdict + '.';
        html += unlockRuleHtml(B, state, sleep, radarOn ? ' with radar' : '');
        if (B.hourlyCalls(state, interval) >= B.LIMIT_HOUR - 1) {
            html += '<br>At this rate a settings-save refetch in the same hour may delay one cycle — harmless.';
        }
        // Return bare content: the engine's renderBlock wraps this in .blockrow, which
        // already supplies padding, colour and its own bottom divider. Wrapping in .static
        // here would nest a second bordered/padded row and paint a stray divider line.
        return html;
    }
    PConf.blocks.register('tomorrowioBudget', tomorrowioBudgetBlock);

    /**
     * Tomorrow.io's usage on the key status line under the Weather provider row
     * (key-status.js, the source's `usage`): the calls a day the current settings come to,
     * the read-out's own figure, against the free plan's daily limit — "~96 of 500 calls a
     * day". A projection: the phone does not count the calls it makes.
     * @param {Object} state Settings state.
     * @returns {?string} The line, or null when no tomorrow.io call is made.
     */
    function tomorrowioUsageLine(state) {
        var B = tomorrowioBudget;
        if (B.callsPerCycle(state) === 0) { return null; }
        return '~' + Math.round(B.dailyCalls(state, readoutInterval(state))) + ' of ' + B.LIMIT_DAY + ' calls a day';
    }
    if (keyStatus) { keyStatus.registerUsage('tomorrowio', tomorrowioUsageLine); }

    /**
     * Monthly-usage info block under the Rainbow API key field ("Rainbow (own key)"'s key
     * sheet): the free plan's monthly ceiling, the user's projected month at the
     * current settings, a ✓/✗ verdict and the derived sleep->cadence unlock rule. Unlike tomorrow.io's block
     * there is no "with radar" qualifier (every Rainbow call is a radar call) and no
     * hourly heads-up (Rainbow documents no hourly limit). Recomputes on every render.
     *
     * @param {Object} state Settings state.
     * @param {Object} env Platform env (unused).
     * @returns {string} Block HTML, or '' when no own-key Rainbow budget is in play.
     */
    function rainbowBudgetBlock(state, env) {
        var B = rainbowBudget;
        if (B.callsPerCycle(state) === 0) { return ''; }
        var interval = readoutInterval(state);
        var sleep = B.sleepHours(state);
        var monthly = Math.round(B.monthlyCalls(state, interval));
        var settingsBits = 'every ' + interval + ' min, '
            + (sleep > 0 ? 'night pause ' + sleep + ' h' : 'no night pause');
        // "5,000" like the hints around this read-out (RAINBOW_KEY_HINT, RAINBOW_BUDGET_HINT).
        var verdict = B.fits(state, interval)
            ? '<b>~' + withThousands(monthly) + ' calls/month ✓</b>'
            : '<b style="color:#FF6A52">~' + withThousands(monthly) + ' calls/month ✗ over budget</b>';
        // Bare content, no .static wrapper: same .blockrow rule as tomorrowioBudgetBlock.
        return '<b>Free plan: ' + withThousands(B.LIMIT_MONTH) + ' calls/month.</b> '
            + 'Your settings: ' + settingsBits + ' → ' + verdict + '.'
            + unlockRuleHtml(B, state, sleep, '');
    }
    PConf.blocks.register('rainbowBudget', rainbowBudgetBlock);

    /**
     * Rainbow's usage on the key status line under the Radar provider row (key-status.js,
     * the "Rainbow (own key)" source's `usage`): the calls a month the current settings
     * come to, the read-out's own figure, against the free plan's monthly limit — "~2,976
     * of 5,000 calls a month". A projection: the phone does not count the calls it makes.
     * @param {Object} state Settings state.
     * @returns {?string} The line, or null when no call is billed to the user's key.
     */
    function rainbowUsageLine(state) {
        var B = rainbowBudget;
        if (B.callsPerCycle(state) === 0) { return null; }
        return '~' + withThousands(Math.round(B.monthlyCalls(state, readoutInterval(state))))
            + ' of ' + withThousands(B.LIMIT_MONTH) + ' calls a month';
    }
    if (keyStatus) { keyStatus.registerUsage('rainbow', rainbowUsageLine); }

    // Update-interval ladder for fetchIntervalMin: the entries that fit every active
    // budget guard (tomorrow.io, Rainbow own key) — the intersection. A guard is active
    // while its "Fit update interval" toggle is on and its provider makes calls; with
    // none active (or its toggle off) the full ladder passes through, and the info
    // block shows the red warning instead. If the stored interval drops out, the
    // engine's resolveRowItem snaps it to the item default ('15') — but only while the
    // row renders (General tab), so onbuild.js's onSubmit applies the same fit, from the
    // same interval-budget.js, at save time for a change made on another tab (the radar
    // provider/mode, on the Radar tab).
    PConf.optionsResolvers.register('fetchIntervalBudget', function (S) {
        return intervalBudget.fittingOptions(S || {});
    });

    // "(Recommended)" markers on the weather + radar provider dropdowns: the option matching the
    // country-derived best pick (holidayCountry, the wizard's own source) is flagged. Same mapping
    // the wizard applies on a fresh install, so the dropdown hint and the wizard can't disagree.
    // A country's Rainbow pick is 'rainbow', "Rainbow (limited)": the radar that needs no key.
    PConf.recommendResolvers.register('recommendedWeatherProvider', function (S) {
        return CD.mapCountry(S && S.holidayCountry).provider;
    });
    PConf.recommendResolvers.register('recommendedRadarProvider', function (S) {
        return CD.mapCountry(S && S.holidayCountry).radarProvider;
    });

    /**
     * The amber note under the Radar provider row (its staticText's textFrom): the picked
     * source's missing key (key-status.js keyMissingNote), else — for DWD or Met.no — the
     * last update's location outside that source's area, or for DWD inside it with no
     * radar data from DWD (its 404s in a row) (radar-coverage.js note, from the phone's
     * record userData.radarCoverage). '' when neither: no note.
     * @param {Object} S Live settings state.
     * @param {Object} env Platform env.
     * @param {Object} args The row's key-status args (RADAR_KEY_ARGS).
     * @returns {string} The note (plain text), or ''.
     */
    function radarProviderNote(S, env, args) {
        var ud = (typeof INJECTED_USERDATA !== 'undefined' && INJECTED_USERDATA) || {};
        return keyStatus.keyMissingNote(S, env, args)
            || radarCoverage.note((S || {}).radarProvider, ud.radarCoverage);
    }
    PConf.hintResolvers.register('radarProviderNote', radarProviderNote);

    // ---- The Graphs tab's line rows and dialogs ----

    /**
     * A forecast line's nav-row summary: its metric and style by the labels their pickers
     * show, ", filled" for the Main metric's area fill — "Precipitation % · Thin line,
     * filled" — or "Off". The style is the one the watch draws (line-style.js
     * lineStyleValue: a stored stripe on a metric that cannot be one draws as a line), and
     * a watch without style pickers (env.lineStyles false) names the metric alone.
     * @param {Object} S Live settings state.
     * @param {Object} env Platform env.
     * @param {{lineKey: string, main: boolean}} args The line's picker key; whether it is
     *     the Main metric (the one line that fills).
     * @returns {string} The summary.
     */
    function lineSummary(S, env, args) {
        var st = S || {}, a = args || {};
        var metric = st[a.lineKey];
        if (!metric || metric === 'off') { return 'Off'; }
        var name = optionLabel(FORECAST_METRICS, metric) || String(metric);
        if (env && env.lineStyles === false) { return name; }
        var style = lineStyle.lineStyleValue(st, a.lineKey + 'Style');
        var text = name + ' · ' + (optionLabel(LINE_STYLE_OPTIONS, style) || style);
        var fills = a.main && st.secondaryLineFill !== false && !lineStyle.isTempAxisMetric(metric)
            && !lineStyle.isStripeValue(style);
        return fills ? text + ', filled' : text;
    }
    PConf.hintResolvers.register('lineSummary', lineSummary);

    /**
     * A forecast line's colour swatch (its nav row, and the colours row in its dialog):
     * the line colour of its metric in the theme being edited, as the Graph colors
     * dialog's row would preview it. None for a line that is off, on a B&W watch or
     * theme.
     * @param {Object} S Live settings state.
     * @param {Object} env Platform env.
     * @param {{lineKey: string}} args The line's picker key.
     * @returns {?Object} Badge state, or null.
     */
    function lineSwatch(S, env, args) {
        var st = S || {};
        var metric = st[(args || {}).lineKey];
        if (!lineStyle || !env || !env.color || !metric || metric === 'off') { return null; }
        if (st.theme === 'bw' || st.theme === 'bw-light') { return null; }
        var sfx = lineStyle.renderContextFor(st, {color: true, themePolarity: true}).suffix;
        var color = colorHexOf(st[lineStyle.graphColorKey(metric, 'Line', sfx)],
            lineStyle.graphColorDefault(metric, 'Line', sfx, st));
        return {label: 'Edit', dots: [{color: color}]};
    }
    PConf.badgeResolvers.register('lineSwatch', lineSwatch);

    /**
     * The colours row in a line's dialog opens the Graph colors sheet of the metric the
     * line draws (args.sheets: schema.js GRAPH_COLOR_SHEETS); none for a line that is off.
     * @param {Object} S Live settings state.
     * @param {Object} env Platform env (unused).
     * @param {{messageKey: string, sheets: Object}} args The line's picker key and the
     *     metric → sheet table.
     * @returns {?string} The sheet id, or null.
     */
    function lineColorSheet(S, env, args) {
        var a = args || {};
        var entry = (a.sheets || {})[(S || {})[a.messageKey]];
        return entry ? entry.sheetId : null;
    }
    PConf.sheetResolvers.register('lineColorSheet', lineColorSheet);

    /**
     * That row's label: "<Metric> colors", the title of the sheet it opens.
     * @param {Object} S Live settings state.
     * @param {Object} env Platform env (unused).
     * @param {{lineKey: string, sheets: Object}} args As lineColorSheet.
     * @returns {?string} The label, or null for the static one.
     */
    function lineColorLabel(S, env, args) {
        var a = args || {};
        var entry = (a.sheets || {})[(S || {})[a.lineKey]];
        return entry ? entry.label + ' colors' : null;
    }
    PConf.hintResolvers.register('lineColorLabel', lineColorLabel);

    /**
     * Whether the page draws in colour: a colour watch under a colour theme.
     * @param {Object} S Live settings state.
     * @param {Object} env Platform env.
     * @returns {boolean}
     */
    function colorThemeOn(S, env) {
        var theme = (S || {}).theme;
        return Boolean(env && env.color !== false) && theme !== 'bw' && theme !== 'bw-light';
    }

    /**
     * The Bars row's info text: what the bars show, then how they scale — the colour
     * note on a colour theme, the B&W legend otherwise (args, schema.js SCALE_NOTE /
     * BW_LEGEND). Only while the bars are on; null (the row's hintByValue) otherwise.
     * @param {Object} S Live settings state.
     * @param {Object} env Platform env.
     * @param {{value: string, colorNote: string, bwNote: string}} args The row's value
     *     and the two notes.
     * @returns {?string} The hint, or null.
     */
    function barScaleHint(S, env, args) {
        var a = args || {};
        if (a.value !== 'rain') { return null; }
        return 'Adds bars that represent the rain amount in one hour. '
            + (colorThemeOn(S, env) ? a.colorNote : a.bwNote);
    }
    PConf.hintResolvers.register('barScaleHint', barScaleHint);

    /**
     * The Radar color row's info text: the colour's own words (args.hints), then the bar
     * scale note.
     * @param {Object} S Live settings state.
     * @param {Object} env Platform env (unused).
     * @param {{value: string, hints: Object, note: string}} args The row's value, its
     *     per-value hints and the note.
     * @returns {string} The hint.
     */
    function radarColorHint(S, env, args) {
        var a = args || {};
        var own = (a.hints || {})[a.value] || '';
        return own ? own + '<br>' + a.note : a.note;
    }
    PConf.hintResolvers.register('radarColorHint', radarColorHint);

    /**
     * A weather alert's levels slider's info text: its scale hint (args.hint) and the card
     * on its default levels for the unit or AQI scale in effect (args.cards, schema.js
     * ALERT_LEVEL_CARDS: each card's showWhen picks it, the same predicates the cards
     * carried as their own rows).
     * @param {Object} S Live settings state.
     * @param {Object} env Platform env.
     * @param {{hint: string, cards: Array<{text: string, showWhen: (Object|undefined)}>}} args
     * @returns {?string} The hint, or null for the static one.
     */
    function levelInfo(S, env, args) {
        var a = args || {}, ctx = Object.assign({}, S || {}), parts = [], i;
        ctx.env = env || {};
        if (a.hint) { parts.push(a.hint); }
        for (i = 0; i < (a.cards || []).length; i++) {
            if (!a.cards[i].showWhen || PConf.showWhen.evaluate(a.cards[i].showWhen, ctx)) {
                parts.push(a.cards[i].text);
                break;
            }
        }
        return parts.length ? parts.join('<br>') : null;
    }
    PConf.hintResolvers.register('levelInfo', levelInfo);

    // Reset-to-defaults for EVERY graph colour (the Graph colors dialog's link): each
    // metric's sheet keeps its own reset (resetGraphColors, its key list in the button's
    // arg); this one walks the full key set line-style.js hands out, so it cannot miss a
    // row the schema adds. Each key lands on its schema default through the engine.
    /**
     * @param {string} arg Unused.
     * @param {Object} S Live settings state (mutated in place).
     * @param {Object} env Platform env (unused).
     * @param {function(string): *} defaultOf The engine's stored-shape default resolver.
     * @returns {boolean} true so the engine re-renders.
     */
    PConf.actions.resetAllGraphColors = function (arg, S, env, defaultOf) {
        if (!S || !defaultOf || !lineStyle) { return false; }
        var scopes = FORECAST_METRICS.map(function (m) { return m[1]; }).concat(['night']);
        scopes.forEach(function (scope) {
            lineStyle.graphColorRoles(scope).forEach(function (role) {
                ['Dark', 'Light'].forEach(function (sfx) {
                    var key = lineStyle.graphColorKey(scope, role, sfx);
                    var d = defaultOf(key);
                    if (typeof d !== 'undefined') { S[key] = d; }
                });
            });
        });
        return true;
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = {
            radarProviderNote: radarProviderNote,
            placementText: placementText,
            onDemandBars: onDemandBars,
            lineSummary: lineSummary,
            lineSwatch: lineSwatch,
            lineColorSheet: lineColorSheet,
            lineColorLabel: lineColorLabel,
            barScaleHint: barScaleHint,
            radarColorHint: radarColorHint,
            levelInfo: levelInfo,
            tomorrowioBudgetBlock: tomorrowioBudgetBlock,
            tomorrowioUsageLine: tomorrowioUsageLine,
            rainbowBudgetBlock: rainbowBudgetBlock,
            rainbowUsageLine: rainbowUsageLine,
            thresholdRangeCfg: thresholdRangeCfg,
            forecastMetricHint: forecastMetricHint,
            lineStyleHint: lineStyleHint,
            lineShowHint: lineShowHint,
            lineFromHint: lineFromHint,
            windScaleHint: windScaleHint,
            STRIPE_SCALE: STRIPE_SCALE
        };
    }
})();
