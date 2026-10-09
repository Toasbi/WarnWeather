// src/pkjs/forecast-axis.js — ES5. The forecast graph's left axis options (BETA, emery only;
// Graphs > Forecast > Left axis (Beta)): THE one reading of the four settings, for the wire
// (clay-payload.js graphOptionsWord), the bake (forecast-series.js: the numbers' values), the
// render signature, telemetry, the settings page's gate (when-resolvers.js tempAxisLineDrawn)
// and the forecast preview, so they can never disagree.
//
// THE SETTINGS (owner, 2026-10-09: "axis line on/off; the numbers beside the graph, on it or
// off; an outline around them; let them include feels-like and dew point").
//   forecastAxisLine    true | false       the 1 px axis line along the plot's left edge.
//   forecastAxisNumbers 'beside' | 'graph' | 'off'
//                       the hi/lo temperature numbers: in the label strip left of the graph
//                       (today), beside the points they name on the graph, or none. On graph
//                       and Off give the strip's width to the graph.
//   forecastAxisOutline true | false       a 1 px ring in the background colour around the
//                       numbers on the graph (On graph only).
//   forecastAxisScale   true | false       the numbers name the temperature SCALE's ends: the
//                       lowest and highest value of the temperature and of every drawn
//                       feels-like or dew point line (the lines that share its axis), not only
//                       the air temperature's.
// An absent key or junk reads the shipped default (true / 'beside' / true / false), which is
// today's graph, so no migration is needed.
//
// DORMANT VALUES. The outline only matters On graph; the scale only while numbers are drawn
// and a feels-like or dew point line is (tempAxisLineDrawn). A dormant value is kept, but read
// as its default here, so the wire bits stay canonical (all zero exactly when the graph is
// today's) and a dormant flip resends nothing.
//
// THE WATCH. emery only. The wire bits ride the CLAY_LARGE_GRAPH_FONT int (bit 0 Larger graph
// fonts, bits 1-5 these; src/c/appendix/config.h GRAPH_OPT_*), which only emery's C reads. An
// UNKNOWN platform (no watchInfo) is capable, as everywhere on the Clay message, so a
// watchInfo hiccup cannot reset an emery's options; a KNOWN non-emery watch is sent nothing of
// this. The scale bake (TEMP_MIN / TEMP_MAX) changes only for a KNOWN emery: every platform
// prints those keys.
//
// Dual-context: a CommonJS module on the phone and in the tests, a plain concatenated
// <script> in the settings-page webview (scripts/build-config-page.js' APP_FILES, after
// line-style.js, which it reads at load, and ahead of preview-forecast.js and
// when-resolvers.js, which read window.ForecastAxis at theirs), which has no require().
(function () {
    var lineStyle = (typeof require !== 'undefined')
        ? require('./line-style.js') : window.LineStyle;

    // The settings keys (schema.js' Left axis card).
    var KEYS = {
        line: 'forecastAxisLine',
        numbers: 'forecastAxisNumbers',
        outline: 'forecastAxisOutline',
        scale: 'forecastAxisScale'
    };
    // The numbers' three places.
    var BESIDE = 'beside';
    var GRAPH = 'graph';
    var OFF = 'off';
    var NUMBERS = [BESIDE, GRAPH, OFF];
    // The CLAY_LARGE_GRAPH_FONT word's bits. Lockstep with src/c/appendix/config.h GRAPH_OPT_*
    // (test/forecast-axis.test.js). LARGE_FONT is Larger graph fonts' (clay-payload.js); the
    // rest are this module's, AXIS_MASK.
    var BIT = {
        LARGE_FONT: 0x01,
        LINE_OFF: 0x02,
        NUMS_GRAPH: 0x04,
        NUMS_OFF: 0x08,
        OUTLINE_OFF: 0x10,
        SCALE: 0x20
    };
    var AXIS_MASK = 0xFE;

    /**
     * The axis line's setting: shown unless stored exactly false.
     * @param {?Object} s Clay settings.
     * @returns {boolean}
     */
    function lineShown(s) {
        return (s || {})[KEYS.line] !== false;
    }

    /**
     * The numbers' setting: 'beside', 'graph' or 'off'; 'beside' for an absent or junk value.
     * @param {?Object} s Clay settings.
     * @returns {string}
     */
    function numbers(s) {
        var v = (s || {})[KEYS.numbers];
        return NUMBERS.indexOf(v) >= 0 ? v : BESIDE;
    }

    /**
     * The outline's setting: on unless stored exactly false.
     * @param {?Object} s Clay settings.
     * @returns {boolean}
     */
    function outline(s) {
        return (s || {})[KEYS.outline] !== false;
    }

    /**
     * The scale setting: on only when stored exactly true.
     * @param {?Object} s Clay settings.
     * @returns {boolean}
     */
    function scale(s) {
        return (s || {})[KEYS.scale] === true;
    }

    /**
     * Whether the watch is a KNOWN emery (the bake's and the settings page's test).
     * @param {?Object} env config-ui/lib/platform.js computeEnv() result.
     * @returns {boolean}
     */
    function isEmery(env) {
        return Boolean(env) && env.platform === 'emery';
    }

    /**
     * Whether the Clay word carries the options: emery, or an unknown platform (capable, the
     * Clay message's rule). False for a KNOWN non-emery watch.
     * @param {?Object} env config-ui/lib/platform.js computeEnv() result.
     * @returns {boolean}
     */
    function carried(env) {
        return !env || !env.platform || env.platform === 'emery';
    }

    /**
     * Whether a feels-like or dew point line is drawn: one of the forecast lines draws a
     * temperature-axis metric (line-style.js effectiveLineMetric). The Third and Fourth metric
     * lines (fourthLine / fifthLine) count only where the watch draws them (env.lineStyles:
     * when-resolvers.js hostLine's rule), so the settings gate, the wire and the preview agree.
     * @param {?Object} s Clay settings.
     * @param {?Object} env computeEnv() result (only its lineStyles is read).
     * @returns {boolean}
     */
    function tempAxisLineDrawn(s, env) {
        var lines = lineStyle.FORECAST_LINES;
        var styles = Boolean(env && env.lineStyles);
        for (var i = 0; i < lines.length; i++) {
            if (i >= 2 && !styles) { continue; }
            var m = lineStyle.effectiveLineMetric(s, lines[i].key);
            if (m && lineStyle.isTempAxisMetric(m)) { return true; }
        }
        return false;
    }

    /**
     * The options as drawn, dormant values read as their defaults; every option at its
     * default when `on` is false.
     * @param {?Object} s Clay settings.
     * @param {?Object} env computeEnv() result.
     * @param {boolean} on Whether the options apply at all.
     * @returns {{line: boolean, numbers: string, outline: boolean, scale: boolean}}
     */
    function effective(s, env, on) {
        var nums = on ? numbers(s) : BESIDE;
        return {
            line: !on || lineShown(s),
            numbers: nums,
            outline: nums !== GRAPH || outline(s),
            scale: on && nums !== OFF && scale(s) && tempAxisLineDrawn(s, env)
        };
    }

    /**
     * The options this watch draws: the stored ones on a known emery, else the defaults (the
     * settings preview's reading).
     * @param {?Object} s Clay settings.
     * @param {?Object} env computeEnv() result.
     * @returns {{line: boolean, numbers: string, outline: boolean, scale: boolean}}
     */
    function resolved(s, env) {
        return effective(s, env, isEmery(env));
    }

    /**
     * The options' bits of the CLAY_LARGE_GRAPH_FONT word (never bit 0, at most 0x3E): 0
     * exactly when the graph is today's, and for a known non-emery watch.
     * @param {?Object} s Clay settings.
     * @param {?Object} env computeEnv() result.
     * @returns {number}
     */
    function wireBits(s, env) {
        var a = effective(s, env, carried(env));
        return (a.line ? 0 : BIT.LINE_OFF)
            | (a.numbers === GRAPH ? BIT.NUMS_GRAPH : 0)
            | (a.numbers === OFF ? BIT.NUMS_OFF : 0)
            | (a.outline ? 0 : BIT.OUTLINE_OFF)
            | (a.scale ? BIT.SCALE : 0);
    }

    /**
     * Whether the bake puts the temperature scale's ends in TEMP_MIN / TEMP_MAX: a known emery
     * with the scale stored on. Deliberately blind to the numbers and the lines: with no line
     * drawn the scale's ends are the air's, and a numbers flip stays a Clay-only resend.
     * @param {?Object} s Clay settings.
     * @param {?Object} env computeEnv() result.
     * @returns {boolean}
     */
    function bakesScale(s, env) {
        return isEmery(env) && scale(s);
    }

    /**
     * The render signature's part (render-signature.js): 'scale' while the option changes
     * what TEMP_MIN / TEMP_MAX hold, else ''. Platform-free (every line counted), like the
     * stripe metrics: at most one redundant fetch on a watch that ignores it.
     * @param {?Object} s Clay settings.
     * @returns {string} '' or 'scale'.
     */
    function signature(s) {
        return (scale(s) && tempAxisLineDrawn(s, { lineStyles: true })) ? 'scale' : '';
    }

    var api = {
        KEYS: KEYS,
        BESIDE: BESIDE,
        GRAPH: GRAPH,
        OFF: OFF,
        NUMBERS: NUMBERS,
        BIT: BIT,
        AXIS_MASK: AXIS_MASK,
        lineShown: lineShown,
        numbers: numbers,
        outline: outline,
        scale: scale,
        isEmery: isEmery,
        carried: carried,
        tempAxisLineDrawn: tempAxisLineDrawn,
        resolved: resolved,
        wireBits: wireBits,
        bakesScale: bakesScale,
        signature: signature
    };

    // Dual-context export — mirrors the tail of src/pkjs/draw-from.js.
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    if (typeof window !== 'undefined') {
        window.ForecastAxis = api;
    }
})();
