// src/pkjs/graph-styles.js — ES5. Graph styles (Pebble Time 2): named sets of the forecast
// graph's settings, of which each screen's forecast graph draws one. The first goal is a
// forecast length per screen: 24 hours on one screen, the long span on another.
//
// THE MODEL. Style 1 is the flat keys every reader already reads (secondaryLine, barSource,
// forecastHours, the gc* colours ...), so an install without styles has one, its own graph,
// and nothing migrates. Styles 2 to 6 live in one hidden settings item, graphStyles, a JSON
// string: {"names": ["", "Long", ""], "styles": [null, {...}, null]}, each extra style
// an object of the GOVERNED keys' values (style 1's slot is always null: the flat keys hold
// it). A screen names its style in the per-view key viewStyle<i> ('1' to '6';
// view-cycle.js buildCustomCycle puts it on the view's spec as graphStyle, its index, and
// screens.js carries it on the forecast block). settingsFor(S, k) is THE reading of a style:
// the settings with style k's values laid over the flat keys, for every packer, preview and
// picture.
//
// THE WATCH'S SLOTS. The watch keeps three styles (WATCH_SLOTS: three records, a 2-bit code
// in the view word's ext bits 9-10), one per screen at most, while the phone keeps up to six
// to switch between. Only the styles the screens show reach the watch (see ONLY WHAT IS SHOWN
// COUNTS below), and three screens show three at most, so each gets a slot (slotsFor): a shown
// style 1 to 3 keeps its own slot, so a setup with three graphs or fewer sends what it sent
// before there could be more, and a shown style 4 to 6 takes a slot no shown style needs.
// wireCycle writes the slots into the views the watch is sent; graph-style-wire.js sends each
// record in its slot.
//
// WHAT A STYLE HOLDS (GOVERNED): everything in a graph's dialog (Graphs › Forecast) that draws
// the graph — the four lines' metric and style, the Draw from keys, the Main metric's fill, the
// rain bars (on/off, colour, Bars from), Day / night shading, Forecast length, Left axis values
// and the graph colours. What shapes the data the phone bakes stays ONE setting for every style
// (SHARED): the wind and pressure scales, the lines' Show: All | Alert, the left axis's
// scale option (it decides TEMP_MIN / TEMP_MAX) and Larger graph fonts, a watch-wide tier.
//
// THE UNION. The weather message carries five metric rows (ROWS): the trends SECOND..FIFTH,
// one per line, and a spare row no graph's own line is (line-style.js SPARE_LINE). So the
// shown styles draw at most five series between them, a series being a metric drawn as a line
// or as a stripe (the phone bakes a stripe's bytes differently, so a metric drawn both ways
// takes two rows), while each style keeps its four lines (TRENDS). assign() lays the shown
// styles' series into the rows, style by style and line by line: a series another style draws
// too reuses its row, any other takes its own line's row when that is free (so the first style
// keeps its own rows), else the first free one, the spare last. Each style's map then names
// the row each of its lines reads (src/c/appendix/graph_style.h). A sixth series is dropped
// (map 0), the last style's last lines first: the settings page keeps the shown styles within
// five.
//
// ONLY WHAT IS SHOWN COUNTS. The styles the screens' forecast graphs draw (stylesShown, off the
// views the watch runs) are the ones sent. While no screen shows a style other than the first,
// nothing changes on the wire: no records, today's bake (stylesSent is empty). The phone side
// of the wire (the records, the bake's settings) is weather/graph-style-wire.js.
//
// Dual-context: a CommonJS module on the phone and in the tests, a plain concatenated <script>
// in the settings-page webview (after view-cycle.js, line-style.js, line-alert.js, draw-from.js
// and forecast-axis.js, which it reads at load), which has no require().
(function () {
    var node = typeof require !== 'undefined';
    var VC = node ? require('./view-cycle.js') : window.VIEW_CYCLE;
    var lineStyle = node ? require('./line-style.js') : window.LineStyle;
    var lineAlert = node ? require('./line-alert.js') : window.LineAlert;
    var drawFrom = node ? require('./draw-from.js') : window.DrawFrom;
    var forecastAxis = node ? require('./forecast-axis.js') : window.ForecastAxis;

    // At most six styles to switch between; the screens show three of them at most.
    var MAX_STYLES = VC.GRAPH_STYLES;
    // The watch's style slots: three records and the view word's codes 0 to 2 (src/c/windows/
    // layout.h view_ext_graph_style), one per screen.
    var WATCH_SLOTS = VC.GRAPH_STYLE_SLOTS;
    // The view slots that name a style (viewStyle0..2: screens.js MAX_SCREENS).
    var SCREENS = 3;
    // A style's lines, each one of the trends SECOND..FIFTH (src/c/appendix/series.h).
    var TRENDS = lineStyle.FORECAST_LINES.length;
    // The weather message's metric rows: the four lines' trends and the spare
    // (src/c/appendix/graph_style.h GS_TREND_SPARE).
    var ROWS = lineStyle.BAKE_LINES.length;

    // The keys a style holds, named by the modules that own them: the four lines' metric and
    // style keys, the Main metric's fill, the rain bars, the Draw from keys, the shading, the
    // length, the Left axis values and every graph colour.
    var GOVERNED = [];
    lineStyle.FORECAST_LINES.forEach(function (line) { GOVERNED.push(line.key, line.styleKey); });
    GOVERNED = GOVERNED.concat(['secondaryLineFill', 'barSource', 'rainBarColor', drawFrom.BAR_KEYS.rain],
        drawFrom.ROWS.map(function (row) { return row.key; }),
        ['dayNightShading', 'forecastHours', forecastAxis.KEYS.numbers],
        lineStyle.graphColorKeys());

    // The keys every style shares, because the phone bakes them into the weather data (or, for
    // Larger graph fonts, because every graph on the watch reads it).
    var SHARED = ['windScale', 'pressureScale'].concat(
        lineAlert.METRIC_IDS.map(lineAlert.settingKey),
        [forecastAxis.KEYS.scale, 'largeGraphFont']);

    /**
     * @param {*} v A value.
     * @returns {boolean} whether it is a plain object (not null, not an array)
     */
    function isRecord(v) {
        return Boolean(v) && typeof v === 'object' && Object.prototype.toString.call(v) !== '[object Array]';
    }

    /**
     * @param {Object} o An object.
     * @param {string} k A key.
     * @returns {boolean} whether o holds k itself
     */
    function has(o, k) {
        return Object.prototype.hasOwnProperty.call(o, k);
    }

    /**
     * The graphStyles item read: the six names ('' when unnamed) and the styles, the first
     * always null (the flat keys hold it), another null when it does not exist. A malformed
     * item reads as no extra styles; an item stored before there were six reads its own.
     * @param {?Object} S Settings.
     * @returns {{names: string[], styles: Array<?Object>}}
     */
    function parse(S) {
        var raw = S && S.graphStyles, o = null;
        if (typeof raw === 'string' && raw) {
            try { o = JSON.parse(raw); } catch (e) { o = null; }
        } else if (isRecord(raw)) {
            o = raw;
        }
        var names = [], styles = [null];
        for (var k = 0; k < MAX_STYLES; k++) {
            names.push(isRecord(o) && o.names && typeof o.names[k] === 'string' ? o.names[k] : '');
            if (k > 0) { styles.push(isRecord(o) && o.styles && isRecord(o.styles[k]) ? o.styles[k] : null); }
        }
        return { names: names, styles: styles };
    }

    /**
     * @param {?Object} S Settings.
     * @param {number} k A style index (0 = the first).
     * @returns {boolean} whether style k exists (the first always does)
     */
    function exists(S, k) {
        return k === 0 || (k > 0 && k < MAX_STYLES && parse(S).styles[k] !== null);
    }

    /**
     * @param {?Object} S Settings.
     * @returns {number} how many styles exist, 1 to MAX_STYLES
     */
    function count(S) {
        var styles = parse(S).styles, n = 1;
        for (var k = 1; k < MAX_STYLES; k++) {
            if (styles[k]) { n++; }
        }
        return n;
    }

    /**
     * A style's name as the settings page shows it, where a style is "a graph": its own, else
     * "Graph <n>" (defaultName).
     * @param {?Object} S Settings.
     * @param {number} k A style index.
     * @returns {string}
     */
    function name(S, k) {
        return parse(S).names[k] || defaultName(k);
    }

    /**
     * The name a style has until it is renamed: "Graph <n>".
     * @param {number} k A style index.
     * @returns {string}
     */
    function defaultName(k) {
        return 'Graph ' + (k + 1);
    }

    /**
     * The settings as style k draws the graph: S with the style's own values of the governed
     * keys laid over the flat keys. The first style, and a style that does not exist, is S
     * itself. A governed key the style holds no value of reads as the first style's (the page
     * writes every governed key of a style).
     * @param {Object} S Settings.
     * @param {number} k A style index.
     * @returns {Object} S, or a copy with the style's values
     */
    function settingsFor(S, k) {
        var st = k > 0 ? parse(S).styles[k] : null;
        if (!st) { return S; }
        var out = Object.assign({}, S);
        GOVERNED.forEach(function (key) {
            if (Object.prototype.hasOwnProperty.call(st, key)) { out[key] = st[key]; }
        });
        return out;
    }

    /**
     * A style's values of the governed keys, as it draws the graph (settingsFor): the values a
     * copy of it starts from, and what the settings page compares a style against.
     * @param {Object} S Settings.
     * @param {number} k A style index.
     * @returns {Object<string, *>} governed key -> value (keys S lacks left out)
     */
    function valuesOf(S, k) {
        var Sk = settingsFor(S, k), out = {};
        GOVERNED.forEach(function (key) {
            if (has(Sk, key)) { out[key] = Sk[key]; }
        });
        return out;
    }

    /**
     * The graphStyles item as the settings store it: '' while it holds no extra style and no
     * name (what an install without styles has, so making a style and deleting it again
     * stores what was there before), else its JSON.
     * @param {{names: string[], styles: Array<?Object>}} o parse()'s shape.
     * @returns {string}
     */
    function stringify(o) {
        var empty = true;
        for (var k = 0; k < MAX_STYLES; k++) {
            if (o.names[k] || (k > 0 && o.styles[k])) { empty = false; }
        }
        return empty ? '' : JSON.stringify({ names: o.names, styles: o.styles });
    }

    /**
     * The graphStyles item with style k's values replaced: a copy of `values` (null deletes
     * the style and its name). The first style has no stored values (the flat keys hold it).
     * @param {?Object} S Settings.
     * @param {number} k A style index, 1 to MAX_STYLES - 1.
     * @param {?Object} values Its governed values, or null.
     * @returns {string} The item to store.
     */
    function withStyle(S, k, values) {
        var o = parse(S);
        if (k > 0 && k < MAX_STYLES) {
            o.styles[k] = values ? Object.assign({}, values) : null;
            if (!values) { o.names[k] = ''; }
        }
        return stringify(o);
    }

    /**
     * The graphStyles item with style k's name replaced ('' for the default name).
     * @param {?Object} S Settings.
     * @param {number} k A style index.
     * @param {string} label The name.
     * @returns {string} The item to store.
     */
    function withName(S, k, label) {
        var o = parse(S);
        if (k >= 0 && k < MAX_STYLES) { o.names[k] = String(label || ''); }
        return stringify(o);
    }

    /**
     * @param {?Object} S Settings.
     * @returns {number} the first style index without a style (1 to MAX_STYLES - 1), -1 with
     *   MAX_STYLES styles
     */
    function freeSlot(S) {
        var styles = parse(S).styles;
        for (var k = 1; k < MAX_STYLES; k++) {
            if (!styles[k]) { return k; }
        }
        return -1;
    }

    /**
     * Delete style k: its values and name go, and every screen that drew it draws the first
     * style. The other styles keep their slots (a later new style takes the free one).
     * Mutates S.
     * @param {Object} S Settings.
     * @param {number} k A style index, 1 to MAX_STYLES - 1.
     * @returns {number[]} the view slots that drew it (for an Undo)
     */
    function deleteStyle(S, k) {
        var moved = [];
        if (!(k > 0 && k < MAX_STYLES)) { return moved; }
        S.graphStyles = withStyle(S, k, null);
        for (var i = 0; i < SCREENS; i++) {
            if (S['viewStyle' + i] === String(k + 1)) {
                S['viewStyle' + i] = '1';
                moved.push(i);
            }
        }
        return moved;
    }
    /**
     * @param {?Object} v A compiled view.
     * @returns {boolean} whether it draws the forecast graph (the body, or the top band's graph)
     */
    function hasForecast(v) {
        return Boolean(v) && (v.body === VC.BODY_FC
            || (v.top === VC.TOP_GRAPH && (v.topKind || 0) === VC.TOP_KIND_FORECAST));
    }

    /**
     * A view cycle with each view's graph style as the watch draws it, still by style index:
     * dropped on a watch without styles (only emery has them: env.graphStyles) and where the
     * style does not exist. A view that changes is a copy; the rest are the cycle's own.
     * @param {?Object} S Settings.
     * @param {?Object} env Platform env.
     * @param {Array<?Object>} cycle view-cycle.js resolveViewCycle (or screensCycle) result.
     * @returns {Array<?Object>}
     */
    function drawnCycle(S, env, cycle) {
        var on = Boolean(env && env.graphStyles);
        var styles = parse(S).styles;
        return cycle.map(function (v) {
            if (!v || !v.graphStyle || (on && styles[v.graphStyle])) { return v; }
            var c = VC.cloneSpec(v);
            delete c.graphStyle;
            return c;
        });
    }

    /**
     * The styles a cycle's forecast graphs draw (drawnCycle's), ascending.
     * @param {Array<?Object>} drawn drawnCycle's result.
     * @returns {number[]}
     */
    function shownIn(drawn) {
        var out = [];
        drawn.forEach(function (v) {
            if (!hasForecast(v)) { return; }
            var k = v.graphStyle || 0;
            if (out.indexOf(k) === -1) { out.push(k); }
        });
        return out.sort(function (a, b) { return a - b; });
    }

    /**
     * The watch slot each shown style draws from (see THE WATCH'S SLOTS above): a style below
     * WATCH_SLOTS keeps its own, the others take the free ones in order. A style past the
     * slots (more shown than the watch keeps, which three screens cannot show) gets none.
     * @param {number[]} shown The shown styles, ascending (stylesShown).
     * @returns {Object<string, number>} style index -> slot
     */
    function slotsFor(shown) {
        var out = {}, taken = [], next = 0;
        shown.forEach(function (k) {
            if (k < WATCH_SLOTS) { out[k] = k; taken.push(k); }
        });
        shown.forEach(function (k) {
            if (k < WATCH_SLOTS) { return; }
            while (taken.indexOf(next) !== -1) { next++; }
            if (next < WATCH_SLOTS) { out[k] = next; taken.push(next); }
        });
        return out;
    }

    /**
     * A view cycle as the watch is sent it: each view's graph style as the watch draws it
     * (drawnCycle) in its watch slot (slotsFor), the first slot by no field at all. A view that
     * changes is a copy; the rest are the cycle's own.
     * @param {?Object} S Settings.
     * @param {?Object} env Platform env.
     * @param {Array<?Object>} cycle view-cycle.js resolveViewCycle (or screensCycle) result.
     * @returns {Array<?Object>}
     */
    function wireCycle(S, env, cycle) {
        var drawn = drawnCycle(S, env, cycle);
        var slots = slotsFor(shownIn(drawn));
        return drawn.map(function (v) {
            if (!v || !v.graphStyle || slots[v.graphStyle] === v.graphStyle) { return v; }
            var c = VC.cloneSpec(v);
            if (slots[v.graphStyle]) { c.graphStyle = slots[v.graphStyle]; } else { delete c.graphStyle; }
            return c;
        });
    }

    /**
     * The styles the screens' forecast graphs draw, off the views the watch runs
     * (resolveViewCycle, through drawnCycle), ascending. [0] on a watch without styles while a
     * screen shows the forecast; [] while none does.
     * @param {?Object} S Settings.
     * @param {?Object} env Platform env.
     * @returns {number[]}
     */
    function stylesShown(S, env) {
        return shownIn(drawnCycle(S, env, VC.resolveViewCycle(S || {}, env)));
    }

    /**
     * The styles whose records the watch is sent: every shown style while one of them is not
     * the first, else none (the watch then draws the first style's look, the flat tuples, on
     * every screen, as before graph styles).
     * @param {?Object} S Settings.
     * @param {?Object} env Platform env.
     * @returns {number[]} ascending
     */
    function stylesSent(S, env) {
        var shown = stylesShown(S, env);
        for (var i = 0; i < shown.length; i++) {
            if (shown[i] > 0) { return shown; }
        }
        return [];
    }

    /**
     * How many of a graph's lines the watch draws: all TRENDS where it draws the line styles (an
     * unknown watch too), else the first two (line-style.js firstDrawnLine's allLines).
     * @param {?Object} env Platform env.
     * @returns {number}
     */
    function linesDrawn(env) {
        return drawFrom.capable(env) ? TRENDS : 2;
    }

    /**
     * The series each line of a style draws on this watch: its effective metric (line-style.js
     * effectiveLineMetric: an off line or a repeat of an earlier line's pick draws nothing; so
     * does a line past the ones the watch draws, linesDrawn) and whether it draws it as a stripe,
     * which needs a watch that draws the line styles.
     * @param {Object} Sk A style's settings (settingsFor).
     * @param {?Object} env Platform env.
     * @returns {Array<?{metric: string, stripe: boolean}>} one per line SECOND..FIFTH
     */
    function seriesOf(Sk, env) {
        var drawn = linesDrawn(env), styled = drawn === TRENDS;
        return lineStyle.FORECAST_LINES.map(function (line, i) {
            var metric = i < drawn ? lineStyle.effectiveLineMetric(Sk, line.key) : null;
            if (!metric) { return null; }
            return { metric: metric, stripe: styled && lineStyle.isStripeStyle(Sk, line.styleKey) };
        });
    }

    /**
     * @param {Array<?Object>} rows The rows so far.
     * @param {{metric: string, stripe: boolean}} s A series.
     * @returns {number} the row that carries it, -1 when none does
     */
    function rowOf(rows, s) {
        for (var t = 0; t < rows.length; t++) {
            if (rows[t] && rows[t].metric === s.metric && rows[t].stripe === s.stripe) { return t; }
        }
        return -1;
    }

    /**
     * How many of the weather message's rows the styles' series take between them (THE
     * UNION): the distinct series their lines draw. More than ROWS do not fit.
     * @param {Object[]} list The styles' settings (settingsFor), one per style.
     * @param {?Object} env Platform env.
     * @returns {number}
     */
    function rowsNeeded(list, env) {
        var rows = [];
        list.forEach(function (Sk) {
            seriesOf(Sk, env).forEach(function (s) {
                if (s && rowOf(rows, s) === -1) { rows.push(s); }
            });
        });
        return rows.length;
    }

    /**
     * Lay the styles' series into the weather message's five rows (see THE UNION above), in
     * the order given: the first style keeps its own rows when it is in the list.
     * @param {Object} S Settings.
     * @param {?Object} env Platform env.
     * @param {number[]} styles Style indices, ascending.
     * @returns {{rows: Array<?{metric: string, stripe: boolean}>, maps: Object<string, number[]>}}
     *   rows: the series each row carries (null: none), ROWS of them, the spare last; maps: by
     *   style index, the row + 1 each of its lines SECOND..FIFTH reads, 0 for a line that is
     *   off or dropped.
     */
    function assign(S, env, styles) {
        var rows = [];
        var maps = {};
        for (var t = 0; t < ROWS; t++) { rows.push(null); }
        styles.forEach(function (k) {
            var series = seriesOf(settingsFor(S, k), env);
            maps[k] = series.map(function (s, j) {
                if (!s) { return 0; }
                // The row that carries the series already, else its own line's row while that
                // is free (so the first style's rows are its own), else the first free one.
                var row = rowOf(rows, s);
                if (row === -1) { row = rows[j] === null ? j : rows.indexOf(null); }
                if (row === -1) { return 0; }   // a sixth series: dropped
                rows[row] = s;
                return row + 1;
            });
        });
        return { rows: rows, maps: maps };
    }

    var api = {
        MAX_STYLES: MAX_STYLES,
        WATCH_SLOTS: WATCH_SLOTS,
        TRENDS: TRENDS,
        ROWS: ROWS,
        GOVERNED: GOVERNED,
        SHARED: SHARED,
        parse: parse,
        exists: exists,
        count: count,
        name: name,
        defaultName: defaultName,
        settingsFor: settingsFor,
        valuesOf: valuesOf,
        stringify: stringify,
        withStyle: withStyle,
        withName: withName,
        freeSlot: freeSlot,
        deleteStyle: deleteStyle,
        hasForecast: hasForecast,
        slotsFor: slotsFor,
        wireCycle: wireCycle,
        stylesShown: stylesShown,
        stylesSent: stylesSent,
        linesDrawn: linesDrawn,
        seriesOf: seriesOf,
        rowsNeeded: rowsNeeded,
        assign: assign
    };

    // Dual-context export — mirrors the tail of src/pkjs/line-style.js.
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    if (typeof window !== 'undefined') {
        window.GraphStyles = api;
    }
})();
