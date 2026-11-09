// src/pkjs/settings/wizard-forecast.js — ES5, WebView. The setup wizard's forecast step, as data:
// its looks for the forecast graph, how a graph reads as one of them, its length (emery) and its
// preview. Pure: the settings, the watch and the defaults come in as arguments; wizard.js does the
// DOM and the writes.
//
// THE LOOKS. Each is a full set of the graph settings it governs (governed): the four lines'
// metrics and styles, the Main metric's fill, the rain bars and their colour, every Draw from key,
// Day / night shading, and on emery where the high and low go. They are the owner's graph looks
// (2026-11-08) and the settings page's templates: New graph starts a graph from one of them
// (graph-styles-page.js). Each lays its own values over the graph's defaults as the theme starts
// them (engine themedDefaults), and each has the night shading on. Classic is the ForecasWatch2
// graph: the rain chance as a thin line over a shaded area, the rain bars in the colour the theme
// starts them on (Multicolor on a dark theme, Solid on a light one, as 2.6's Classic), the high
// and low beside the axis. Clean adds the clouds as a stripe along the top, with Solid bars in
// every theme and the high and low on the graph; it is the graph of the Clean and Weathergraph
// screens (screen-presets.js), and the look a fresh install's setup starts on where its graph is
// none of them (FIRST_RUN). Stripes is Classic with the clouds and the rain chance as stripes
// along the top (the rain chance moves from its line into its stripe: a metric shows once per
// graph) and Solid bars hanging from the top (the owner's, 2026-11-09). A graph that is none of them
// when setup opens is kept as one more record, "Your own", first. The 144 px watches keep the left axis in every look (the owner's, 2026-11-07: emery's
// numbers On graph do not fit their image), so only emery's copy says where the high and low go.
//
// THE LENGTH (emery, the one watch with a Forecast length). Each look starts on a length of its
// own (LOOKS span: Classic and Stripes 24 hours, Clean the long span), which the step's
// Forecast length picker then changes (the owner's, 2026-11-07). "Your own" keeps the length it
// was set up with. The length is no part of a look: any length reads as the look its graph is.
//
// THE KEYS are the graph styles' (graph-styles.js GOVERNED, one list) less the length, which the
// step's own picker sets, and the graph colours, which a look leaves as they are.
//
// HOW A GRAPH READS. Through the readings the watch's own modules give (reading): a line's style
// only while the line draws, a Draw from key only while a drawn line reads it (draw-from.js
// rowLine; a dormant Top is kept and never compared), the bars' edge only while they draw, and
// the bars' colour, the fill and the Left axis values as the wire reads them. A look writes the
// Draw from keys only of the lines it draws, so trying one never drops a dormant Top.
//
// Dual-context: a CommonJS module in the tests, a plain concatenated <script> in the settings-page
// webview (scripts/build-config-page.js' APP_FILES, after every module it binds below and ahead of
// wizard.js), which has no require().
(function () {
    // Dual-context (see line-style.js): CommonJS modules under Node, the window globals of the files
    // concatenated ahead of this one in the page.
    var node = typeof require !== 'undefined';
    var lineStyle = node ? require('../line-style.js') : window.LineStyle;
    var drawFrom = node ? require('../draw-from.js') : window.DrawFrom;
    var forecastAxis = node ? require('../forecast-axis.js') : window.ForecastAxis;
    var resolveInk = node ? require('../resolve-ink.js') : window.ResolveInk;
    var themeFlip = node ? require('../theme-flip.js') : window.ThemeFlip;
    var graphStyles = node ? require('../graph-styles.js') : window.GraphStyles;
    var spanHours = node ? require('../forecast-span-hours.js') : window.ForecastSpanHours;
    var forecastSample = node ? require('./forecast-sample.js') : window.ForecastSample;
    var previewForecast = node ? require('./preview-forecast.js') : window.PreviewForecast;
    var svgLib = node ? require('./preview-svg.js') : window.PreviewSvg;
    var screenFrame = node ? require('./screen-frame.js') : window.ScreenFrame;

    // The governed keys, named by the modules that own them.
    var FILL = 'secondaryLineFill';
    var BARS = 'barSource';
    var BAR_COLOR = 'rainBarColor';
    var BAR_FROM = drawFrom.BAR_KEYS.rain;
    var AXIS_NUMBERS = forecastAxis.KEYS.numbers;
    var FROM_KEYS = drawFrom.ROWS.map(function (row) { return row.key; });
    // A line's style key -> its metric key.
    var LINE_OF_STYLE = {};
    lineStyle.FORECAST_LINES.forEach(function (line) { LINE_OF_STYLE[line.styleKey] = line.key; });
    // The graph styles' governed keys (THE KEYS above) less the length and the colours.
    var COLOR_KEYS = lineStyle.graphColorKeys();
    var KEYS = graphStyles.GOVERNED.filter(function (k) {
        return k !== 'forecastHours' && COLOR_KEYS.indexOf(k) === -1;
    });

    // What every look sets: the rain chance as a thin line over a shaded area, the other lines
    // off, the rain bars and the night shading.
    var BASE = { secondaryLine: 'precip_prob', secondaryLineStyle: 'line', secondaryLineFill: true,
        thirdLine: 'off', fourthLine: 'off', fifthLine: 'off', barSource: 'rain', dayNightShading: true };
    /**
     * A look's values: BASE with its own over it.
     * @param {Object<string, *>} own The look's own values.
     * @returns {Object<string, *>}
     */
    function lookValues(own) { return Object.assign({}, BASE, own); }
    // In the picker's order. `span` is the Forecast length a look starts on (emery): '48' is the
    // long span's stored option ("66 h" with the high and low on the graph).
    var LOOKS = [
        { id: 'classic', label: 'Classic', span: '24', over: lookValues({ forecastAxisNumbers: 'axis' }) },
        { id: 'clean', label: 'Clean', span: '48', over: lookValues({ thirdLine: 'cloud', thirdLineStyle: 'stripeTop',
            rainBarColor: 'white', forecastAxisNumbers: 'graph' }) },
        { id: 'stripes', label: 'Stripes', span: '24', over: lookValues({ secondaryLine: 'cloud', secondaryLineStyle: 'stripeTop',
            thirdLine: 'precip_prob', thirdLineStyle: 'stripeTop', rainBarColor: 'white', rainBarFrom: drawFrom.TOP,
            forecastAxisNumbers: 'axis' }) }
    ];
    // The look a fresh install's setup starts on where its graph, the defaults, is none of them
    // (wizard.js openWizard).
    var FIRST_RUN = 'clean';
    var OWN = { id: 'own', label: 'Your own' };

    // Forecast length (emery only): the schema's Other row of a graph's dialog (Graphs › Forecast). Setup shows its
    // hints, the long span's shortened to this.
    var SPAN_DESC = {
        '48': 'Shows as many hours as your weather service forecasts and the graph can fit, in narrow columns.'
    };

    /**
     * A look's description: one sentence under the picker, and on emery a second that says where
     * the high and low go (the 144 px watches keep the left axis in every look). Solid bars are
     * solid only where the watch colours them: a black-and-white watch outlines its bars.
     * @param {string} id A look's id, or 'own'.
     * @param {?Object} env Platform env.
     * @returns {string}
     */
    function describe(id, env) {
        var where = forecastAxis.isEmery(env)
            ? ' The high and low go ' + (id === 'clean' ? 'on the graph.' : 'beside the axis.') : '';
        var solid = env && env.color ? 'solid ' : '';
        if (id === 'classic') {
            return 'Draws the graph the way ForecasWatch2 does: the temperature, the rain chance as a shaded area, '
                + 'and rain bars.' + where;
        }
        if (id === 'clean') {
            return 'Shows the temperature, the rain chance as a shaded area, the clouds as a stripe along the top, and '
                + solid + 'rain bars.' + where;
        }
        if (id === 'stripes') {
            return 'Shows the temperature, the clouds and the rain chance as stripes along the top, and ' + solid
                + 'rain bars that hang from the top.' + where;
        }
        return 'Keeps your graph as it is now.';
    }

    // The preview's frame height in viewBox units: the tallest legend's (two rows: the
    // temperature, four lines and the rain bars), so a look never moves the controls under it.
    var FRAME_H = 128;

    /**
     * The keys the looks govern on this watch: not where the high and low go off emery, nor the
     * bars' colour on a black-and-white watch, which outlines its bars. Each is dormant there.
     * @param {?Object} env Platform env.
     * @returns {string[]}
     */
    function governed(env) {
        return KEYS.filter(function (k) {
            if (k === AXIS_NUMBERS) { return forecastAxis.isEmery(env); }
            if (k === BAR_COLOR) { return Boolean(env && env.color); }
            return true;
        });
    }

    /**
     * One governed setting as the watch reads it from `s` ('' for one that reads nothing there).
     * @param {string} k A governed key.
     * @param {Object} s Settings.
     * @param {?Object} env Platform env.
     * @returns {*}
     */
    function reading(k, s, env) {
        if (LINE_OF_STYLE[k]) {
            return lineStyle.effectiveLineMetric(s, LINE_OF_STYLE[k]) ? lineStyle.lineStyleValue(s, k) : '';
        }
        if (FROM_KEYS.indexOf(k) !== -1) { return drawFrom.rowLine(s, k, env) ? drawFrom.value(s[k]) : ''; }
        if (k === BAR_FROM) { return s[BARS] === 'rain' ? drawFrom.value(s[k]) : ''; }
        if (k === FILL) { return Boolean(s[k]); }
        if (k === AXIS_NUMBERS) { return forecastAxis.numbers(s); }
        if (k === BAR_COLOR) { return resolveInk.barColorMode(s[k], s.theme); }
        return s[k];
    }

    /**
     * Whether the settings draw the graph a set of values stands for: every key in it read alike.
     * @param {Object} S Settings.
     * @param {Object<string, *>} values A look's values.
     * @param {?Object} env Platform env.
     * @returns {boolean}
     */
    function same(S, values, env) {
        var target = Object.assign({}, S, values);
        return Object.keys(values).every(function (k) { return reading(k, S, env) === reading(k, target, env); });
    }

    /**
     * The settings a look writes: the defaults of every governed key with the look's own values
     * over them, less the Draw from keys none of its drawn lines reads.
     * @param {{over: Object}} look A LOOKS entry.
     * @param {Object} S Settings.
     * @param {?Object} env Platform env.
     * @param {Object} defaults The defaults as the theme starts them (engine themedDefaults).
     * @returns {Object<string, *>}
     */
    function valuesOf(look, S, env, defaults) {
        var out = {};
        governed(env).forEach(function (k) {
            out[k] = Object.prototype.hasOwnProperty.call(look.over, k) ? look.over[k] : defaults[k];
        });
        var drawn = Object.assign({}, S, out);
        FROM_KEYS.forEach(function (k) {
            if (!drawFrom.rowLine(drawn, k, env)) { delete out[k]; }
        });
        return out;
    }

    /**
     * The graph as the settings hold it: its governed settings and its Forecast length (spanOf).
     * Setup keeps the one it opened on as "Your own" when it is none of the looks.
     * @param {Object} S Settings.
     * @param {?Object} env Platform env.
     * @returns {{values: Object<string, *>, span: string}}
     */
    function state(S, env) {
        var values = {};
        governed(env).forEach(function (k) { values[k] = S[k]; });
        return { values: values, span: spanOf(S) };
    }

    /**
     * The step's looks as records the picker lists: "Your own" first when there is one. Each
     * carries the Forecast length it starts on (span), which only emery has (wizard.js pickLook).
     * @param {Object} S Settings.
     * @param {?Object} env Platform env.
     * @param {Object} defaults The defaults as the theme starts them.
     * @param {?{values: Object<string, *>, span: string}} own "Your own" (state() when setup
     *   opened), or null.
     * @returns {Array.<{id: string, label: string, desc: string, values: Object, span: string}>}
     */
    function looks(S, env, defaults, own) {
        var out = LOOKS.map(function (look) {
            return { id: look.id, label: look.label, desc: describe(look.id, env), values: valuesOf(look, S, env, defaults),
                span: look.span || defaults.forecastHours };
        });
        if (own) {
            out.unshift({ id: OWN.id, label: OWN.label, desc: describe(OWN.id, env), values: own.values, span: own.span });
        }
        return out;
    }

    /**
     * The Forecast length the settings hold, as the picker's value: '12', '24' or '48' (an absent
     * or unknown value reads '24', as the phone reads it).
     * @param {Object} S Settings.
     * @returns {string}
     */
    function spanOf(S) {
        return String(spanHours.storedHours(S));
    }

    /**
     * The record the settings draw now.
     * @param {Object} S Settings.
     * @param {Array.<Object>} records looks().
     * @param {?Object} env Platform env.
     * @returns {?Object} The record, or null.
     */
    function current(S, records, env) {
        for (var i = 0; i < records.length; i += 1) {
            if (same(S, records[i].values, env)) { return records[i]; }
        }
        return null;
    }

    /**
     * Convert "Your own"'s values the way a theme pick converts the settings (theme-flip.js, which
     * leaves keys a partial blob lacks alone), so it stays the graph it was.
     * @param {Object} own "Your own"'s values; changed in place.
     * @param {string} oldTheme The theme before.
     * @param {string} newTheme The theme picked.
     * @returns {void}
     */
    function followTheme(own, oldTheme, newTheme) {
        themeFlip.applyThemeConvert(own, oldTheme, newTheme);
    }

    /**
     * The preview: the settings page's forecast graph, drawn from the sample weather over the
     * hours the watch shows (a span of N hours, N + 1 points), at one frame height, in the frame
     * every screen picture shares (screen-frame.js): a margin of the graph's own ground all round,
     * so its card's round corners clip none of it.
     * @param {Object} S Settings.
     * @param {?Object} env Platform env.
     * @param {?Object} userData Page userData (the palette snapshot).
     * @returns {string} SVG markup.
     */
    function previewSvg(S, env, userData) {
        var hours = spanHours.shownHours(S, env);
        var drawn = previewForecast.forecastPreview(S, env, userData, {
            sample: forecastSample.sample(hours + 1, S.temperatureUnits), minHeight: FRAME_H, bleed: false });
        var body = svgLib.unframe(drawn);
        // The graph's ground is the one its own background rect paints (preview-forecast.js
        // forecastPreview: the picked theme's, a light one white).
        return body ? screenFrame.svg(200, body.h, svgLib.previewInk(S.theme || 'dark').bg, body.inner, 'wiz-graph-scr')
            : drawn;
    }

    var api = {
        KEYS: KEYS,
        LOOKS: LOOKS,
        FIRST_RUN: FIRST_RUN,
        SPAN_DESC: SPAN_DESC,
        FRAME_H: FRAME_H,
        describe: describe,
        governed: governed,
        same: same,
        state: state,
        looks: looks,
        spanOf: spanOf,
        spanOptions: spanHours.spanOptions,
        current: current,
        followTheme: followTheme,
        previewSvg: previewSvg
    };

    // Dual-context export — mirrors the tail of src/pkjs/forecast-axis.js.
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    if (typeof window !== 'undefined') {
        window.WizardForecast = api;
    }
})();
