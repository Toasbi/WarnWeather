// src/pkjs/draw-from.js — ES5. Draw from / Bars from [Bottom | Top]: where a forecast
// line of an amount metric, the forecast's rain bars and the radar graph's rain bars
// start. Bottom (the default) stands them on the graph's bottom, as always; Top hangs
// them from the top of the graph, a bigger value reaching further down. THE one reading
// of the six settings, for the wire (line-style.js buildLineStyleBytes, weather/
// palette-wire.js buildPaletteTuples), telemetry and the settings page (the rows' hints,
// the Visible values: Alert scale hint, the forecast and radar previews), so they can
// never disagree.
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
// and the lines sharing its axis keep a margin of at least the plot's height squared over
// TEMP_AXIS_PAD_SQ_DIV, a share that grows with the plot (src/c/appendix/temp_axis_pad.h);
// forecastAnchors is that reading for the settings preview, which supplies the data half
// (its samples). The watch reads the bars' edge off
// the palette flag below and a line's off its style byte: bit 5 for the edge, and bit 6
// (FLOAT_BIT) on a drawn line that anchors nothing, its metric having no zero to stand on
// (pressure, feels-like, dew point: every metric without a Draw from key).
//
// THE WIRE (Clay message only; no new tuple, no new length). A line's flag is bit 5 of
// its own style byte (CLAY_LINE_STYLE_UINT8 [11], [12], [13], [15]; persist.h
// LINE_STYLE_FROM_TOP), its float bit bit 6 (persist.h LINE_STYLE_FLOATING): the encoder's
// bytes never reach either (kinds 0-3, width 0/1/3 in bits 2-4), and the watch's decode of
// the style reads only bits 0-4. A chart's bar flag is bit 7 of
// byte [1] of its palette blob (BAR_PALETTE_UINT8, RADAR_PALETTE_UINT8): stop 0's
// threshold, which rain-tier.js always starts at 0, so the watch reads the flag as a
// negative stop-0 threshold (palette.h palette_from_top) and its renderer clamps that
// stop to the zero row as it always has. With every key on Bottom (or on aplite, which
// never gets a bit) both tuples are byte-identical to the build before this setting, save
// the float bit on a drawn pressure, feels-like or dew point line.
//
// Settings-derived and never baked: forecast-series.js reads none of it, so the keys stay
// out of render-signature.js and a flip is a Clay-only resend, no weather fetch.
//
// Dual-context: a CommonJS module on the phone and in the tests, a plain concatenated
// <script> in the settings-page webview (scripts/build-config-page.js' APP_FILES, after
// line-style.js, which it reads at load, and ahead of the previews and blocks.js, which
// read it at theirs), which has no require().
(function () {
    var lineStyle = (typeof require !== 'undefined')
        ? require('./line-style.js') : window.LineStyle;

    // The two values.
    var BOTTOM = 'bottom';
    var TOP = 'top';
    // persist.h LINE_STYLE_FROM_TOP: bit 5 of a non-stripe line's style byte.
    var LINE_BIT = 0x20;
    // persist.h LINE_STYLE_FLOATING: bit 6 of a non-stripe line's style byte.
    var FLOAT_BIT = 0x40;
    // palette.h: bit 7 of a palette blob's byte [1] (stop 0's threshold, its bit 15).
    var PALETTE_BIT = 0x80;
    // A line metric -> its setting key. Wind and gusts share one (see the header).
    var LINE_KEYS = {
        precip_prob: 'precipLineFrom',
        cloud: 'cloudLineFrom',
        wind: 'windLineFrom',
        gust: 'windLineFrom',
        uv: 'uvLineFrom'
    };
    // The metrics with a key: exactly line-style.js STRIPE_METRIC_IDS (a test holds the
    // two equal).
    var METRIC_IDS = ['precip_prob', 'cloud', 'wind', 'gust', 'uv'];
    // The settings page's Draw from rows, one per key, with the metrics each one flips.
    var ROWS = [
        { key: 'precipLineFrom', metrics: ['precip_prob'] },
        { key: 'cloudLineFrom', metrics: ['cloud'] },
        { key: 'windLineFrom', metrics: ['wind', 'gust'] },
        { key: 'uvLineFrom', metrics: ['uv'] }
    ];
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
     * @param {*} rowKey A Draw from key.
     * @returns {?{key: string, metrics: string[]}} Its ROWS entry; null for any other key.
     */
    function rowOf(rowKey) {
        for (var i = 0; i < ROWS.length; i++) {
            if (ROWS[i].key === rowKey) { return ROWS[i]; }
        }
        return null;
    }

    /**
     * Whether a watch draws anything from the top: every watch with line styles (the
     * WW_LINE_STYLE mirror). Only an explicit lineStyles false (aplite) is incapable, so
     * an unknown watch reads capable, as line-style.js capsForWatch(null) reads basalt.
     * @param {?Object} [caps] line-style.js capsForWatch() caps, or the settings page's
     *   platform env (both carry `lineStyles`).
     * @returns {boolean}
     */
    function capable(caps) {
        return !(caps && caps.lineStyles === false);
    }

    /**
     * Whether a metric's lines are set to hang from the top on this watch: its key reads
     * Top. Says nothing about whether such a line is drawn, or is a stripe (lineFromTop).
     * @param {Object} settings Clay settings blob.
     * @param {*} metric A graph metric id.
     * @param {?Object} [caps] Caps or page env (capable).
     * @returns {boolean}
     */
    function metricFromTop(settings, metric, caps) {
        var key = settingKey(metric);
        return capable(caps) && key !== null && value((settings || {})[key]) === TOP;
    }

    /**
     * Whether one forecast line hangs from the top, as the wire sends it: the watch draws
     * line styles, the line is drawn (not off, not a repeat of an earlier picker's
     * metric), its metric has a key, it is not drawn as a stripe, and that key reads Top.
     * @param {Object} settings Clay settings blob.
     * @param {string} lineKey secondaryLine|thirdLine|fourthLine|fifthLine.
     * @param {?Object} [caps] Caps or page env (capable).
     * @returns {boolean}
     */
    function lineFromTop(settings, lineKey, caps) {
        var metric = lineStyle.effectiveLineMetric(settings, lineKey);
        return metric !== null
            && !lineStyle.isStripeStyle(settings || {}, lineKey + 'Style')
            && metricFromTop(settings, metric, caps);
    }

    /**
     * The drawn metric of one forecast line, when it is drawn as a line or marks (not a
     * stripe) on a watch that draws line styles; null otherwise.
     * @param {Object} settings Clay settings blob.
     * @param {string} lineKey secondaryLine|thirdLine|fourthLine|fifthLine.
     * @param {?Object} [caps] Caps or page env (capable).
     * @returns {?string}
     */
    function drawnLineMetric(settings, lineKey, caps) {
        if (!capable(caps)) { return null; }
        var metric = lineStyle.effectiveLineMetric(settings, lineKey);
        return metric !== null && !lineStyle.isStripeStyle(settings || {}, lineKey + 'Style')
            ? metric : null;
    }

    /**
     * The edge of the forecast graph one line anchors (see the header): BOTTOM while a drawn
     * amount line stands on it, TOP while it hangs; null for a line that anchors none (not
     * drawn, a stripe, a metric without a zero to stand on, or a watch without line styles).
     * @param {Object} settings Clay settings blob.
     * @param {string} lineKey secondaryLine|thirdLine|fourthLine|fifthLine.
     * @param {?Object} [caps] Caps or page env (capable).
     * @returns {?string} TOP, BOTTOM or null.
     */
    function lineAnchor(settings, lineKey, caps) {
        var metric = drawnLineMetric(settings, lineKey, caps);
        if (metric === null || settingKey(metric) === null) { return null; }
        return metricFromTop(settings, metric, caps) ? TOP : BOTTOM;
    }

    /**
     * Whether one forecast line floats, as the wire sends it (FLOAT_BIT): it is drawn as a
     * line or marks, but its metric has no Draw from key (pressure, feels-like, dew point),
     * so it anchors no edge.
     * @param {Object} settings Clay settings blob.
     * @param {string} lineKey secondaryLine|thirdLine|fourthLine|fifthLine.
     * @param {?Object} [caps] Caps or page env (capable).
     * @returns {boolean}
     */
    function lineFloats(settings, lineKey, caps) {
        var metric = drawnLineMetric(settings, lineKey, caps);
        return metric !== null && settingKey(metric) === null;
    }

    /**
     * The anchored edges of the forecast graph (see the header): the rain bars' edge while
     * barSource draws them, and each drawn amount line's, each only while it has a value above
     * 0 (`hasValue`; the watch's one scan, temp_axis_pad.h temp_axis_any_above_zero). Nothing
     * on a watch without line styles (aplite keeps its frozen margins).
     * @param {Object} settings Clay settings blob.
     * @param {?Object} [caps] Caps or page env (capable).
     * @param {function(string): boolean} [hasValue] Whether an element has a value above 0 in
     *   the hours drawn: called with 'bars' for the rain bars, else with the line's key
     *   (secondaryLine|thirdLine|fourthLine|fifthLine). Absent, every element has one.
     * @returns {{top: boolean, bottom: boolean}}
     */
    function forecastAnchors(settings, caps, hasValue) {
        var s = settings || {};
        var out = { top: false, bottom: false };
        var has = hasValue || function () { return true; };
        if (!capable(caps)) { return out; }
        if (s.barSource === 'rain' && has('bars')) {
            out[barsFromTop(s, 'rain', caps) ? TOP : BOTTOM] = true;
        }
        for (var i = 0; i < lineStyle.FORECAST_LINES.length; i++) {
            var key = lineStyle.FORECAST_LINES[i].key;
            var edge = lineAnchor(s, key, caps);
            if (edge !== null && has(key)) { out[edge] = true; }
        }
        return out;
    }

    /**
     * How many drawn lines, not stripes, read one Draw from key on this watch: 2 for
     * windLineFrom with a wind and a gust line both drawn as lines, else 0 or 1. The
     * page's Top hint speaks of both lines then.
     * @param {Object} settings Clay settings blob.
     * @param {string} rowKey A Draw from key.
     * @param {?Object} [caps] Caps or page env (capable).
     * @returns {number}
     */
    function linesSharing(settings, rowKey, caps) {
        if (!capable(caps)) { return 0; }
        var s = settings || {};
        var count = 0;
        for (var i = 0; i < lineStyle.FORECAST_LINES.length; i++) {
            var line = lineStyle.FORECAST_LINES[i];
            var metric = lineStyle.effectiveLineMetric(s, line.key);
            if (metric !== null && settingKey(metric) === rowKey
                    && !lineStyle.isStripeStyle(s, line.styleKey)) {
                count += 1;
            }
        }
        return count;
    }

    /**
     * Whether a chart's rain bars hang from the top on this watch: its Bars from key
     * reads Top. Independent of barSource and radarMode (see the header).
     * @param {Object} settings Clay settings blob.
     * @param {string} chart 'rain' (the forecast's bars) | 'radar' (the radar graph's).
     * @param {?Object} [caps] Caps or page env (capable).
     * @returns {boolean}
     */
    function barsFromTop(settings, chart, caps) {
        return capable(caps) && owns(BAR_KEYS, chart)
            && value((settings || {})[BAR_KEYS[chart]]) === TOP;
    }

    /**
     * A packed line-style byte with its Top flag (LINE_BIT) set when `on`, and its float
     * bit (FLOAT_BIT) when `floats`.
     * @param {number} byte line-style.js lineStyleByte output.
     * @param {boolean} on The line hangs from the top (lineFromTop).
     * @param {boolean} [floats] The line anchors no edge (lineFloats).
     * @returns {number}
     */
    function styleByte(byte, on, floats) {
        return (on ? (byte | LINE_BIT) : byte) | (floats ? FLOAT_BIT : 0);
    }

    /**
     * A packed palette blob with its Bars from: Top flag (PALETTE_BIT in byte [1]) set
     * when `on`: a marked copy, the blob itself otherwise.
     * @param {number[]} blob rain-tier.js buildPackedPalette output (3 B per stop).
     * @param {boolean} on The chart's bars hang from the top (barsFromTop).
     * @returns {number[]}
     */
    function markPalette(blob, on) {
        if (!on || !blob || blob.length < 2) { return blob; }
        var out = blob.slice();
        out[1] = out[1] | PALETTE_BIT;
        return out;
    }

    var api = {
        BOTTOM: BOTTOM,
        TOP: TOP,
        LINE_BIT: LINE_BIT,
        FLOAT_BIT: FLOAT_BIT,
        PALETTE_BIT: PALETTE_BIT,
        LINE_KEYS: LINE_KEYS,
        METRIC_IDS: METRIC_IDS,
        ROWS: ROWS,
        BAR_KEYS: BAR_KEYS,
        value: value,
        settingKey: settingKey,
        rowOf: rowOf,
        capable: capable,
        metricFromTop: metricFromTop,
        lineFromTop: lineFromTop,
        lineAnchor: lineAnchor,
        lineFloats: lineFloats,
        forecastAnchors: forecastAnchors,
        linesSharing: linesSharing,
        barsFromTop: barsFromTop,
        styleByte: styleByte,
        markPalette: markPalette
    };

    // Dual-context export — mirrors the tail of src/pkjs/line-alert.js.
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    if (typeof window !== 'undefined') {
        window.DrawFrom = api;
    }
})();
