// src/pkjs/settings/wizard-forecast.js — ES5, WebView. The setup wizard's forecast step, as data:
// its looks for the forecast graph, how a graph reads as one of them, its length (emery) and its
// preview. Pure: the settings, the watch and the defaults come in as arguments; wizard.js does the
// DOM and the writes.
//
// THE LOOKS. Each is a full set of the graph settings it governs (governed): the four lines'
// metrics and styles, the Main metric's fill, the rain bars and their colour, every Draw from key,
// and on emery where the high and low go. Classic is the graph's defaults as the theme starts them
// (engine themedDefaults: the bars Solid on the light themes), a fresh install's graph; the others
// lay their own values over those. Stripes is the showcase look: cloud cover and the chance of
// rain as stripes along the top, Solid rain bars hanging from under them, feels-like as a second
// curve, UV as dots. Clean leaves out the UV dots and, on emery, writes the high and low on the
// graph instead of beside an axis, so the graph runs the screen's whole width. A graph that is
// none of them when setup opens is kept as one more record, "Your own", first.
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
    var spanHours = node ? require('../forecast-span-hours.js') : window.ForecastSpanHours;
    var forecastSample = node ? require('./forecast-sample.js') : window.ForecastSample;
    var previewForecast = node ? require('./preview-forecast.js') : window.PreviewForecast;

    // The governed keys, named by the modules that own them.
    var FILL = 'secondaryLineFill';
    var BARS = 'barSource';
    var BAR_COLOR = 'rainBarColor';
    var BAR_FROM = drawFrom.BAR_KEYS.rain;
    var AXIS_NUMBERS = forecastAxis.KEYS.numbers;
    var FROM_KEYS = drawFrom.ROWS.map(function (row) { return row.key; });
    // A line's style key -> its metric key.
    var LINE_OF_STYLE = {};
    var KEYS = [];
    lineStyle.FORECAST_LINES.forEach(function (line) {
        LINE_OF_STYLE[line.styleKey] = line.key;
        KEYS.push(line.key, line.styleKey);
    });
    KEYS = KEYS.concat([FILL, BARS, BAR_COLOR], FROM_KEYS, [BAR_FROM, AXIS_NUMBERS]);

    var LOOKS = [
        { id: 'classic', label: 'Classic', over: {} },
        { id: 'stripes', label: 'Stripes', over: {
            secondaryLine: 'uv', secondaryLineStyle: 'dots', secondaryLineFill: false,
            thirdLine: 'cloud', thirdLineStyle: 'stripeTop', fourthLine: 'precip_prob', fourthLineStyle: 'stripeTop',
            fifthLine: 'feels', fifthLineStyle: 'line', rainBarColor: 'white', rainBarFrom: 'top' } },
        { id: 'clean', label: 'Clean', over: { thirdLine: 'off', forecastAxisNumbers: 'graph' } }
    ];
    var OWN = { id: 'own', label: 'Your own' };

    /**
     * A look's description: one sentence under the picker, two lines on a 320 px phone. Clean says
     * where the high and low go only where the watch draws them there (emery).
     * @param {string} id A look's id, or 'own'.
     * @param {?Object} env Platform env.
     * @returns {string}
     */
    function describe(id, env) {
        if (id === 'classic') { return 'The temperature, rain chance as a shaded area, UV as dots and rain bars.'; }
        if (id === 'stripes') { return 'Clouds and rain chance as stripes along the top, rain bars hanging below.'; }
        if (id === 'clean') {
            return forecastAxis.isEmery(env)
                ? 'The temperature, rain chance and rain bars; the high and low on the graph.'
                : 'Just the temperature, rain chance and rain bars.';
        }
        return 'Your graph, as you set it up in Settings.';
    }

    // Forecast length (emery only): the schema's Graphs › Forecast › Other row, its hints shortened.
    var SPAN_DESC = {
        '12': 'The next 12 hours, in wider columns.',
        '24': 'The next 24 hours.',
        '48': 'As far ahead as your weather service forecasts and the graph fits, in narrow columns.'
    };

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
     * The graph settings as they are: the values of "Your own".
     * @param {Object} S Settings.
     * @param {?Object} env Platform env.
     * @returns {Object<string, *>}
     */
    function snapshot(S, env) {
        var out = {};
        governed(env).forEach(function (k) { out[k] = S[k]; });
        return out;
    }

    /**
     * The step's looks as records the picker lists: "Your own" first when there is one.
     * @param {Object} S Settings.
     * @param {?Object} env Platform env.
     * @param {Object} defaults The defaults as the theme starts them.
     * @param {?Object} own "Your own"'s values (snapshot), or null.
     * @returns {Array.<{id: string, label: string, desc: string, values: Object}>}
     */
    function looks(S, env, defaults, own) {
        var out = LOOKS.map(function (look) {
            return { id: look.id, label: look.label, desc: describe(look.id, env), values: valuesOf(look, S, env, defaults) };
        });
        if (own) { out.unshift({ id: OWN.id, label: OWN.label, desc: describe(OWN.id, env), values: own }); }
        return out;
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
     * hours the watch shows (a span of N hours, N + 1 points), at one frame height, filling its card.
     * @param {Object} S Settings.
     * @param {?Object} env Platform env.
     * @param {?Object} userData Page userData (the palette snapshot).
     * @returns {string} SVG markup.
     */
    function previewSvg(S, env, userData) {
        var hours = spanHours.shownHours(S, env);
        return previewForecast.forecastPreview(S, env, userData, {
            sample: forecastSample.sample(hours + 1, S.temperatureUnits), minHeight: FRAME_H, bleed: false });
    }

    var api = {
        KEYS: KEYS,
        LOOKS: LOOKS,
        SPAN_DESC: SPAN_DESC,
        FRAME_H: FRAME_H,
        governed: governed,
        same: same,
        snapshot: snapshot,
        looks: looks,
        current: current,
        followTheme: followTheme,
        spanOptions: spanHours.spanOptions,
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
