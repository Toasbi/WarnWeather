// src/pkjs/forecast-span-hours.js — ES5. The Time span row's stored option and the long time
// span's label (Graphs > Forecast > Time span, emery only).
//
// THE STORED OPTION (CHOICES, storedHours, option): '12', '24' or '48'. One reading for the
// hours sent, the render signature and telemetry (forecast-span.js re-exports it), the Time
// span row's values (spanOptions) and the forecast preview's hour axis (preview-axis.js
// axisCadence), here because the settings page cannot load forecast-span.js.
//
// THE LABEL: the whole hours the watch will show for the picked weather provider and the
// graph's layout. "47 h" with OpenWeatherMap, "48 h" with Weather Underground, "58 h" with
// a full feed at the default layout, "66 h" with the High / low numbers On graph or Off. Only
// the label moves: the option's stored value stays '48' (CHOICES), so the wire, the fetch,
// telemetry and storage are unchanged.
//
// THE COUNT is the watch's (src/c/appendix/forecast_span.h forecast_span_whole): the hours
// whose bar is wholly on screen. Under the edge rule a feed the plot can hold is widened until
// its last hour's point sits on the last column, so it shows n - 1 whole hours; a full feed
// stays at the 3 px floor and runs past the edge. wholeHours() is that rule for the long class
// (27..68 hours); scripts/test-c.sh holds it to the watch's count for every n 27..68 on every
// plot width 145..200 (test/c/forecast_span_dump.c, scripts/check-forecast-span-lockstep.js).
//
// THE FEED (feedHours): the hours the provider's adapter delivers for the long span's request.
// OpenWeatherMap's One Call hourly list holds 48 hours (openweathermap.js); Weather
// Underground's 48-hour feed plus the hour in progress, 49 (wunderground.js,
// wu-current-hour-cache.js). Every other adapter reaches the full 68 (hourly-window.js
// MAX_FORECAST_HOURS: Open-Meteo's and Yandex's four days, Met.no's hourly tail, the DWD and
// Tomorrow.io windows), and so does an unknown id. getPayload sends what the adapter holds
// (provider.js payloadEntries), and the watch fits its grid to it.
//
// THE PLOT (plotWidth): W, from the plot's left edge to the screen's right edge. With the
// numbers On axis the plot starts past the label strip: the 198 px layer less the strip and its
// 2 px gap (bottom_view.h BOTTOM_VIEW_LABEL_STRIP_MIN_W / _LABEL_GAP). The strip is shared: the
// wider of the hi/lo label plus TEMP_LABEL_PAD (forecast_layer.c text_labels_refresh) and, while
// the health graph is in the view cycle, its widest step mark (health_graph_layer.c
// health_graph_compute), both in the graph label font: GOTHIC_24 with Larger graph fonts, else
// GOTHIC_18 (bottom_view.c bottom_view_label_font). The hi/lo labels are taken as two digits and
// the step mark as two digits and a '.' ("0.5", "1.5"): the common cases. So, with the health
// graph in the cycle (Health Status + Graph, the default), 174 px with Larger graph fonts and
// 179 px without, its mark the wider claim (22 px / 17 px); with none, 176 px / 180 px.
// With the numbers On graph or Off the forecast claims no strip and spans the whole 200 px screen,
// unless the health graph shares its view (a custom layout's top band over the body): it then
// keeps the health labels' strip so the two line up (forecast_layer.c forecast_update_proc,
// bottom_view_other_consumer_shown). The views can disagree there, so the label takes the
// forecast's first view in the cycle (healthGraph's `beside`), the Default view when that one
// shows it: the view the watch returns to.
// What only the watch knows moves W a little: a one-digit, negative or three-digit temperature,
// a step mark of whole thousands ("2") or of 10k steps and more ("10.5"), health data the watch
// does not have (Pebble Health off). Each moves the count by an hour or so (a "10.5" mark:
// three), never the short feeds' 47 / 48 (docs/adr/0004-forecast-span-is-the-data.md
// Amendment 4).
//
// Dual-context: a CommonJS module on the phone and in the tests, a plain concatenated
// <script> in the settings-page webview (scripts/build-config-page.js' APP_FILES, after
// view-cycle.js and forecast-axis.js, which it reads at load, and ahead of forecast-hints.js,
// whose forecastSpanOptions resolver reads window.ForecastSpanHours, and preview-axis.js, which
// binds it at load), which has no require().
(function () {
    var forecastAxis = (typeof require !== 'undefined')
        ? require('./forecast-axis.js') : window.ForecastAxis;
    // The view cycle the watch runs (resolveViewCycle): which views seat the health graph and
    // the forecast. view-cycle.js shares the webview's top-level scope as VIEW_CYCLE.
    var viewCycle = (typeof require !== 'undefined')
        ? require('./view-cycle.js') : window.VIEW_CYCLE;

    // The long span's full feed: hourly-window.js MAX_FORECAST_HOURS (test/forecast-span-hours
    // .test.js pins the two equal; hourly-window.js is phone-only, so the webview cannot read it).
    var FULL_HOURS = 68;
    // The feeds that stop short of it, by provider id (schema.js' Weather provider values).
    var PROVIDER_HOURS = {
        openweathermap: 48,
        wunderground: 49
    };
    // The plot's geometry, in px: the whole screen, and the forecast layer (LAYOUT_PAD_X 2 in
    // from its left edge) a strip starts in. Lockstep with test/c/forecast_span_test.c
    // EMERY_SCREEN_W / EMERY_W.
    var SCREEN_W = 200;
    var LAYER_W = 198;
    // bottom_view.h BOTTOM_VIEW_LABEL_STRIP_MIN_W and BOTTOM_VIEW_LABEL_GAP, forecast_layer.c
    // TEMP_LABEL_PAD.
    var STRIP_MIN_W = 15;
    var STRIP_GAP = 2;
    var LABEL_PAD = 2;
    // A digit's advance in the hi/lo labels' font (the digits are monospace), read from emery's
    // system fonts: GOTHIC_24 with Larger graph fonts, GOTHIC_18 without (forecast_span.h
    // FORECAST_LABEL_ADVANCE(true)).
    var DIGIT_W = { large: 9, small: 7 };
    var LABEL_DIGITS = 2;
    // The health graph's step mark (health_graph_layer.c step_mark_label): a '.' between two
    // digits ("0.5", "1.5"), the '.' 4 px in GOTHIC_24 and 3 px in GOTHIC_18 (emery's system
    // fonts). The mark reports no pad (health_graph_compute), so 22 px / 17 px.
    var DOT_W = { large: 4, small: 3 };
    var MARK_DIGITS = 2;
    // forecast_span.h's long class: the pitch in 1/256 px (slot_x.h SLOT_X_ONE), held to
    // FORECAST_SPAN_LONG_PITCH_MIN..MAX whole px, 1 px pads from FORECAST_SPAN_LONG_PAD_FROM.
    var SLOT_ONE = 256;
    var PITCH_MIN = 3;
    var PITCH_MAX = 8;
    var PAD_FROM = 6;
    // The stored values, the schema's options (test/forecast-span.test.js pins both). '48' is the
    // long span's token: the first cut stored the long span as '48', so the token stays and
    // nothing migrates. The row labels it with the whole hours the watch will show (spanOptions:
    // "58 h" at the default layout).
    var CHOICES = ['12', '24', '48'];
    // The span every watch draws by default, and the only one off emery: hourly-window.js
    // FORECAST_HOURS (test/forecast-span.test.js pins the two equal; the webview cannot read it).
    var DEFAULT_HOURS = 24;

    /**
     * The span the settings hold, whatever the watch: 12, 24 or 48 (the long span's token); 24
     * for an absent or unknown value.
     * @param {?Object} settings Clay settings.
     * @returns {number} The stored option.
     */
    function storedHours(settings) {
        var v = settings && settings.forecastHours;
        return CHOICES.indexOf(String(v)) !== -1 ? parseInt(v, 10) : DEFAULT_HOURS;
    }

    /**
     * The option this watch draws, for telemetry: categorical, not the hours sent. The stored
     * 12 / 24 / 48 on a span watch (48 = the long span, whatever its label), else 24.
     * @param {?Object} settings Clay settings.
     * @param {?Object} env config-ui/lib/platform.js computeEnv() result.
     * @returns {number} 12, 24 or 48.
     */
    function option(settings, env) {
        return (env && env.forecastSpan) ? storedHours(settings) : DEFAULT_HOURS;
    }

    /**
     * The whole hours a long feed shows: of `n` hourly entries (27..68) in a plot `w` px wide,
     * the ones whose bar ends on screen. forecast_span.h forecast_span(n, w) and
     * forecast_span_whole, integer for integer.
     * @param {number} n Hours the watch holds (27..68).
     * @param {number} w Plot width in px.
     * @returns {number} Whole hours on screen.
     */
    function wholeHours(n, w) {
        // The edge rule: the smallest pitch that puts hour n - 1's point on column w - 1.
        var pq = Math.floor(((w - 1) * SLOT_ONE + n - 2) / (n - 1));
        pq = Math.min(Math.max(pq, PITCH_MIN * SLOT_ONE), PITCH_MAX * SLOT_ONE);
        var px = Math.floor(pq / SLOT_ONE);
        var pad = px >= PAD_FROM ? 1 : 0;
        var bar = px - 1 - 2 * pad;
        // slot_x_count over the columns a bar can start its pad on and still end on screen.
        var shown = Math.floor(((w - pad - bar) * SLOT_ONE + pq - 1) / pq);
        return Math.min(shown, n);
    }

    /**
     * The hours the provider's feed delivers for the long span: 48 for OpenWeatherMap, 49 for
     * Weather Underground, else (an unknown or absent id too) the full 68.
     * @param {?Object} settings Clay settings (reads provider).
     * @returns {number} Hours the watch is sent.
     */
    function feedHours(settings) {
        var id = settings && settings.provider;
        return (typeof id === 'string' && Object.prototype.hasOwnProperty.call(PROVIDER_HOURS, id))
            ? PROVIDER_HOURS[id] : FULL_HOURS;
    }

    /**
     * Whether a compiled view seats the forecast graph: its body, or the top band's graph of
     * the forecast kind (view-cycle.js resolveForFit reads a kindless graph top the same way).
     * @param {?Object} spec A view of resolveViewCycle (null: a disabled slot).
     * @returns {boolean} True if the forecast draws on this view.
     */
    function seatsForecast(spec) {
        return Boolean(spec) && (spec.body === viewCycle.BODY_FC
            || (spec.top === viewCycle.TOP_GRAPH && !spec.topKind));
    }

    /**
     * Whether a compiled view seats the health graph: its body, or the top band's graph of
     * the health kind.
     * @param {?Object} spec A view of resolveViewCycle (null: a disabled slot).
     * @returns {boolean} True if the health graph draws on this view.
     */
    function seatsHealth(spec) {
        return Boolean(spec) && (spec.body === viewCycle.BODY_GRAPH
            || (spec.top === viewCycle.TOP_GRAPH && spec.topKind === viewCycle.TOP_KIND_HEALTH));
    }

    /**
     * Where the health graph stands to the forecast in the view cycle the watch runs for these
     * settings (view-cycle.js resolveViewCycle, which folds a health seat away unless Health is
     * Status + Graph): `shown`, some view seats it, so its step mark claims the shared strip
     * (main_window.c health_graph_renderable); `beside`, it shares the forecast's first view,
     * the Default view when that one shows the forecast.
     * @param {?Object} settings Clay settings (the layout and healthMode keys).
     * @param {?Object} [env] Platform env (config-ui platform.js computeEnv): a watch without
     *   health (env.health false) never draws the graph; no env, or no health fact, reads as
     *   capable.
     * @returns {{shown: boolean, beside: boolean}} The health graph's claim on the plot.
     */
    function healthGraph(settings, env) {
        var out = { shown: false, beside: false };
        if (env && env.health === false) { return out; }
        var cycle = viewCycle.resolveViewCycle(settings || {}, env || null);
        var home = null;
        for (var i = 0; i < cycle.length; i++) {
            if (seatsHealth(cycle[i])) { out.shown = true; }
            if (!home && seatsForecast(cycle[i])) { home = cycle[i]; }
        }
        out.beside = Boolean(home) && seatsHealth(home);
        return out;
    }

    /**
     * The forecast plot's width. On axis: the layer less the shared label strip, the wider of
     * a two-digit hi/lo label and, while the health graph is shown, its "0.5" step mark, in the
     * graph label font. On graph or Off: the whole screen, or the health mark's strip alone
     * when the health graph shares the forecast's view.
     * @param {?Object} settings Clay settings (reads forecastAxisNumbers, largeGraphFont,
     *   healthMode and the layout keys).
     * @param {?Object} [env] Platform env (reads health and platform).
     * @returns {number} Plot width in px.
     */
    function plotWidth(settings, env) {
        var large = Boolean((settings || {}).largeGraphFont);
        var digit = large ? DIGIT_W.large : DIGIT_W.small;
        var health = healthGraph(settings, env);
        var mark = health.shown ? MARK_DIGITS * digit + (large ? DOT_W.large : DOT_W.small) : 0;
        var axis = forecastAxis.numbers(settings) === forecastAxis.AXIS;
        if (!axis && !health.beside) { return SCREEN_W; }
        var label = axis ? LABEL_DIGITS * digit + LABEL_PAD : 0;
        return LAYER_W - Math.max(STRIP_MIN_W, label, mark) - STRIP_GAP;
    }

    /**
     * The long span's whole hours for these settings: the provider's feed in this layout.
     * @param {?Object} settings Clay settings.
     * @param {?Object} [env] Platform env.
     * @returns {number} Whole hours on screen.
     */
    function longHours(settings, env) {
        return wholeHours(feedHours(settings), plotWidth(settings, env));
    }

    /**
     * The Time span row's options: 12 h, 24 h and the long span named by its whole hours.
     * @param {?Object} settings Clay settings.
     * @param {?Object} [env] Platform env.
     * @returns {Array.<Array.<string>>} [label, value] pairs.
     */
    function spanOptions(settings, env) {
        return [
            ['12 h', CHOICES[0]],
            ['24 h', CHOICES[1]],
            [longHours(settings, env) + ' h', CHOICES[2]]
        ];
    }

    var api = {
        FULL_HOURS: FULL_HOURS,
        PROVIDER_HOURS: PROVIDER_HOURS,
        SCREEN_W: SCREEN_W,
        LAYER_W: LAYER_W,
        STRIP_MIN_W: STRIP_MIN_W,
        STRIP_GAP: STRIP_GAP,
        LABEL_PAD: LABEL_PAD,
        DIGIT_W: DIGIT_W,
        DOT_W: DOT_W,
        SLOT_ONE: SLOT_ONE,
        PITCH_MIN: PITCH_MIN,
        PITCH_MAX: PITCH_MAX,
        PAD_FROM: PAD_FROM,
        CHOICES: CHOICES,
        DEFAULT_HOURS: DEFAULT_HOURS,
        storedHours: storedHours,
        option: option,
        wholeHours: wholeHours,
        feedHours: feedHours,
        healthGraph: healthGraph,
        plotWidth: plotWidth,
        longHours: longHours,
        spanOptions: spanOptions
    };

    // Dual-context export — mirrors the tail of src/pkjs/forecast-axis.js.
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    if (typeof window !== 'undefined') {
        window.ForecastSpanHours = api;
    }
})();
