// src/pkjs/settings/preview-forecast.js — ES5, WebView. The forecast-graph
// preview block: the 12-hour sample scenario, the metric scales (including the
// pressure-curve mirror of the watch's), and the SVG that paints them. Its
// colours are not modelled here — line-style.js resolves every one of them from
// the same settings blob the watch is sent.
/* global PConf */
// The `.blocks` test is not redundant. config-ui's lib/color.js and lib/schema-walk.js
// each do `global.PConf = global.PConf || {}` to attach their own shard, and
// line-style.js pulls both in — so under Node, from the second preview file onwards,
// global.PConf EXISTS while carrying no block registry unless engine.js was loaded
// first. The page and every test do load it first; without the test, a require of
// this file on its own would pick that shard up and throw on the register below.
var PConf = (typeof global !== 'undefined' && global.PConf && global.PConf.blocks)
    ? global.PConf
    : (typeof window !== 'undefined' && window.PConf) ? window.PConf
    : (typeof PConf !== 'undefined' && PConf) ? PConf
    : { blocks: { register: function () {}, get: function () {} } };
(function () {
    // Dual-context pattern (see line-style.js): CommonJS modules under Node, the
    // matching window globals from files concatenated ahead of this one in the
    // webview, which has no require(). See scripts/build-config-page.js's APP_FILES.
    var svg = (typeof require !== 'undefined') ? require('./preview-svg.js') : window.PreviewSvg;
    var rect = svg.rect, txt = svg.txt, previewInk = svg.previewInk, svgFrame = svg.svgFrame;
    var previewRain = (typeof require !== 'undefined')
        ? require('./preview-rain.js') : window.PreviewRain;
    var rainBars = previewRain.rainBars, FALLBACK_PALETTE = previewRain.FALLBACK_PALETTE;
    // This is the reason the forecast preview is not a second implementation of the
    // graph-colour model: line-style.js resolves every colour the preview paints (and
    // resolve-ink.js the polarity predicate), from the same settings blob the watch is
    // sent. Both are in the page bundle ahead of this file.
    var lineStyle = (typeof require !== 'undefined')
        ? require('../line-style.js') : window.LineStyle;
    // The wind, gust and UV lines' scale and their Show: Alert band and gaps, from the
    // module the bake reads them through (in the page bundle ahead of this file).
    var lineAlert = (typeof require !== 'undefined')
        ? require('../line-alert.js') : window.LineAlert;
    // A stripe cell's level on its metric's own scale: the table the bake reads.
    var stripeLevels = (typeof require !== 'undefined')
        ? require('../stripe-levels.js') : window.StripeLevels;
    // Draw from / Bars from [Bottom | Top]: which lines and the bars hang from the top,
    // read as the wire reads it (in the page bundle ahead of this file).
    var drawFrom = (typeof require !== 'undefined')
        ? require('../draw-from.js') : window.DrawFrom;
    // The forecast's left axis options (BETA, emery): where the hi/lo numbers go and what
    // they name, read as the wire reads them (in the page bundle ahead of this file).
    var forecastAxis = (typeof require !== 'undefined')
        ? require('../forecast-axis.js') : window.ForecastAxis;
    var resolveInkLib = (typeof require !== 'undefined')
        ? require('../resolve-ink.js') : window.ResolveInk;
    var isLightPolarity = resolveInkLib.isLightPolarity;

    // 0xRRGGBB int -> uppercase '#RRGGBB'. line-style.js speaks ints; SVG wants strings.
    // The canonical converter, not a local copy: config-ui/lib/color.js is the page
    // bundle's single-source int<->hex and is concatenated ahead of every app file
    // (build-page.js emits LIB_PAGE_FILES first), so PConf.color is always there.
    var previewStripe = (typeof require !== 'undefined')
        ? require('./preview-stripe.js') : window.PreviewStripe;
    var hexColor = (typeof require !== 'undefined')
        ? require('../config-ui/lib/color.js').intToHex : PConf.color.intToHex;

    /**
     * Catmull-Rom-ish smoothing: a cubic Bezier path through every point.
     * @param {Array.<Array.<number>>} pts [x, y] vertices in draw order.
     * @param {function(number): number} [hold] Clamps each control point's y, so the
     *   curve (inside its control points' hull) never swings past a line's zero row.
     * @returns {string} SVG path data ('' for fewer than two points).
     */
    function smooth(pts, hold) {
        if (pts.length < 2) { return ''; }
        var h = hold || function (y) { return y; };
        var d = 'M' + pts[0][0] + ',' + pts[0][1];
        for (var i = 0; i < pts.length - 1; i++) {
            var p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
            d += ' C' + (p1[0] + (p2[0] - p0[0]) / 6) + ',' + h(p1[1] + (p2[1] - p0[1]) / 6) + ' ' + (p2[0] - (p3[0] - p1[0]) / 6) + ',' + h(p2[1] - (p3[1] - p1[1]) / 6) + ' ' + p2[0] + ',' + p2[1];
        }
        return d;
    }

    /**
     * The runs one line's polyline draws — the preview half of chart_runs.h's
     * chart_next_run, both held to test/c/chart_absent_test.c's LINE_RUN_VECTORS
     * (parsed by test/config-blocks.test.js). A segment between two samples draws
     * when both are readings, or on a joining line when one is: the line comes down
     * to a zero next to a reading. Two zeros in a row never draw. A run of one is a
     * lone reading no segment reaches (chart_render_line's small square).
     * @param {Array.<boolean>} absent Per sample: draws nothing on its own (byte 0).
     * @param {boolean} join A zero next to a reading is a vertex (CHART_ZERO_JOIN).
     * @returns {Array.<Array.<number>>} [start, length] per run, left to right.
     */
    function lineRuns(absent, join) {
        var n = absent.length, runs = [], i = 0, start;
        function drawn(k) {
            return join ? !(absent[k] && absent[k + 1]) : !(absent[k] || absent[k + 1]);
        }
        while (i < n) {
            while (i < n && absent[i] && !(i + 1 < n && drawn(i))) { i += 1; }
            if (i >= n) { break; }
            start = i;
            while (i + 1 < n && drawn(i)) { i += 1; }
            runs.push([start, i + 1 - start]);
            i += 1;
        }
        return runs;
    }

    /**
     * Is this line style one of the two stripes? line-style.js' own vocabulary test.
     * @param {string} style lineStyleValue output.
     * @returns {boolean} True for 'stripeTop' / 'stripeBottom'.
     */
    function isStripe(style) {
        return lineStyle.isStripeValue(style);
    }

    // The temperature-axis margins and hi/lo labels (src/c/appendix/temp_axis_pad.h),
    // mirrored: an anchored edge's margin is an eighth of the plot height, or from 64 rows on
    // its square over TEMP_AXIS_PAD_SQ_DIV (the share grows with the plot: an eighth at 64
    // rows, a quarter at 128), and the labels keep TEMP_LABEL_MIN_INK_GAP watch px of blank
    // rows between their ink. Both are the watch's numbers, held equal to the header's by
    // test/config-temp-axis-pad.test.js. WATCH_INSET_PX is the watch's temperature inset
    // (bottom_view.h BOTTOM_VIEW_PRIMARY_LINE_INSET_Y), the unit the preview scales watch px by.
    var TEMP_AXIS_PAD_SQ_DIV = 512;
    var TEMP_LABEL_MIN_INK_GAP = 11;
    var WATCH_INSET_PX = 7;
    // The hi/lo labels' digit cap, in preview units: about 0.7 em of their 8-unit font.
    var LABEL_CAP = 5.6;
    // The preview's curve inset in units: 12 units stand for the watch's WATCH_INSET_PX.
    var CURVE_INSET_PREV = 12;
    // The numbers on the graph (left axis BETA; temp_axis_pad.h THE NUMBERS ON THE GRAPH,
    // mirrored): watch px from a point's ink to its number's ink, and between the two
    // numbers' ink (test/config-temp-axis-pad.test.js holds both equal to the header's),
    // scaled to preview units like the label gap (CURVE_INSET_PREV units a WATCH_INSET_PX).
    var TEMP_LABEL_POINT_GAP = 2;
    var TEMP_LABEL_PART_GAP = 3;
    // The plot's left edge while the numbers claim no strip (On graph, Off): the watch's
    // collapsed inset (temp_axis_collapsed_inset: half the widest hour label plus 2 px),
    // against the label strip's 20 units.
    var PX0_COLLAPSED = 8;
    // A number's width per character of the 8-unit label font, in units.
    var NUMBER_CHAR_W = 4.6;

    /**
     * The side a number prefers beside sample i: +1 right, -1 left — temp_axis_pad.h
     * temp_label_side, mirrored. The side whose neighbour lies further from the point (a
     * missing reading, null, is open space, the furthest); a tie goes right; the first sample
     * prefers right and the last left.
     * @param {Array.<?number>} ys The line's y per sample (null: no reading).
     * @param {number} i The point's sample.
     * @returns {number} 1 or -1.
     */
    function numberSide(ys, i) {
        var dp = -1, dn = -1;
        if (i > 0) { dp = ys[i - 1] === null ? Infinity : Math.abs(ys[i - 1] - ys[i]); }
        if (i + 1 < ys.length) { dn = ys[i + 1] === null ? Infinity : Math.abs(ys[i + 1] - ys[i]); }
        return dn >= dp ? 1 : -1;
    }

    /**
     * One number beside its point — temp_axis_pad.h temp_label_beside, mirrored: its ink
     * TEMP_LABEL_POINT_GAP watch px clear of the point's ink on the preferred side if it fits,
     * else the other, else the preferred one; held inside the area; its ink (LABEL_CAP over
     * the baseline) centred on the point's y and held inside the area's rows.
     * @param {number} x0 The point's ink, left edge.
     * @param {number} x1 The point's ink, right edge.
     * @param {number} y The point's y.
     * @param {number} side 1 right, -1 left (numberSide).
     * @param {number} w The number's width.
     * @param {{left: number, right: number, top: number, bottom: number}} area Where its ink
     *   may go.
     * @returns {{x: number, base: number}} The text's left edge and baseline.
     */
    function numberBeside(x0, x1, y, side, w, area) {
        var gap = TEMP_LABEL_POINT_GAP * CURVE_INSET_PREV / WATCH_INSET_PX;
        var right = x1 + gap, left = x0 - gap - w;
        var fitsR = right + w <= area.right, fitsL = left >= area.left;
        var x = side > 0 ? ((fitsR || !fitsL) ? right : left) : ((fitsL || !fitsR) ? left : right);
        if (x + w > area.right) { x = area.right - w; }
        if (x < area.left) { x = area.left; }
        var base = y + LABEL_CAP / 2;
        if (base - LABEL_CAP < area.top) { base = area.top + LABEL_CAP; }
        if (base > area.bottom) { base = area.bottom; }
        return { x: x, base: base };
    }

    /**
     * The two numbers apart — temp_axis_pad.h temp_labels_part, mirrored (mutates both):
     * untouched when their ink, grown by TEMP_LABEL_PART_GAP, does not meet; else the lo
     * number right under the hi one; else the lo number on the area's last row and the hi
     * one right over it. When even that does not fit, the hi number keeps numberBeside's
     * place, inside the area.
     * @param {{x: number, base: number}} hi The hi number (numberBeside).
     * @param {number} wHi Its width.
     * @param {{x: number, base: number}} lo The lo number.
     * @param {number} wLo Its width.
     * @param {{left: number, right: number, top: number, bottom: number}} area The area.
     * @returns {boolean} False when even that does not fit: the lo number is not drawn.
     */
    function numbersPart(hi, wHi, lo, wLo, area) {
        var gap = TEMP_LABEL_PART_GAP * CURVE_INSET_PREV / WATCH_INSET_PX;
        if (lo.x >= hi.x + wHi + gap || hi.x >= lo.x + wLo + gap
            || lo.base - LABEL_CAP >= hi.base + gap || hi.base - LABEL_CAP >= lo.base + gap) {
            return true;
        }
        lo.base = hi.base + LABEL_CAP + gap;
        if (lo.base <= area.bottom) { return true; }
        lo.base = area.bottom;
        var lifted = lo.base - LABEL_CAP - gap;
        if (lifted - LABEL_CAP < area.top) { return false; }   // no room: hi stays put
        hi.base = lifted;
        return true;
    }

    /**
     * Where the numbers' ink may go — forecast_layer.c draw_axis_numbers' TempLabelArea,
     * mirrored: right of the axis column to the plot's right edge, from the first content row
     * under the top stripe band to the row over the zero line, shrunk on every side by the
     * outline's ring (one watch px) when it is drawn, so the ring never crosses the axis, a
     * band or the zero line.
     * @param {number} px0 The plot's left edge (the axis column).
     * @param {number} px1 The plot's right edge.
     * @param {number} top The first content row under the top stripe band.
     * @param {number} zero The zero line's row.
     * @param {boolean} outline Whether the numbers are outlined.
     * @returns {{left: number, right: number, top: number, bottom: number}}
     */
    function numbersArea(px0, px1, top, zero, outline) {
        var o = outline ? CURVE_INSET_PREV / WATCH_INSET_PX : 0;
        return { left: px0 + 1 + o, right: px1 - o, top: top + o, bottom: zero - 1 - o };
    }

    /**
     * Whether the lo number is drawn too — draw_axis_numbers' rule, mirrored: a flat range
     * (equal texts) draws the hi number alone; else both, kept apart by numbersPart, which
     * may still leave the lo one out. The preview's own sample never has a flat range, so
     * only the tests reach that case.
     * @param {string} hiText The hi number's text.
     * @param {string} loText The lo number's text.
     * @param {{x: number, base: number}} hi The hi number (numberBeside; numbersPart may move it).
     * @param {number} wHi Its width.
     * @param {{x: number, base: number}} lo The lo number (numbersPart may move it).
     * @param {number} wLo Its width.
     * @param {{left: number, right: number, top: number, bottom: number}} area numbersArea.
     * @returns {boolean} False when only the hi number is drawn.
     */
    function bothNumbers(hiText, loText, hi, wHi, lo, wLo, area) {
        return hiText !== loText && numbersPart(hi, wHi, lo, wLo, area);
    }

    /**
     * An anchored edge's share of a plot `units` preview units tall, in preview units:
     * temp_axis_pad.h temp_axis_margin, mirrored, the larger of its two terms. The eighth,
     * the floor, is linear, so it is taken in units as it always was (Math.floor(units / 8)).
     * The curve is not, so it is taken where the watch takes it, in watch rows: the plot goes
     * to whole watch px at the preview's scale (CURVE_INSET_PREV units per WATCH_INSET_PX, as
     * the inset and the label gap), the watch's integer square over TEMP_AXIS_PAD_SQ_DIV is
     * taken there, and the px it gives come back as units. The curve passes the eighth only
     * from 64 watch rows (about 110 units); the preview's own plots are at most 87 units (50
     * watch rows, about the watch's default view), so the preview keeps the flat eighth's
     * margins, as the watch does in plots that small.
     * @param {number} units The plot's height in preview units (>= 0).
     * @returns {number} The share, in preview units.
     */
    function anchorShare(units) {
        var eighth = Math.floor(units / 8);
        var rows = Math.floor(units * WATCH_INSET_PX / CURVE_INSET_PREV);
        var curve = Math.floor(rows * rows / TEMP_AXIS_PAD_SQ_DIV) * CURVE_INSET_PREV / WATCH_INSET_PX;
        return curve > eighth ? curve : eighth;
    }

    /**
     * The hi/lo labels' baselines, aligned with the temperature curve's extremes when there
     * is space — temp_axis_pad.h temp_labels_align, mirrored. Each label's ink (the cap above
     * its baseline) is centred on its row, moved only inward from today's baseline, and the
     * two keep the watch's minimum ink gap apart (scaled like the inset); else both keep
     * today's.
     *
     * The reach gate. On the watch, on an edge with no stripe band, today's label ink sits just
     * inside the row the curve reaches with today's margins (its inset row), so the label stays
     * put until the curve stops short of that row: an anchored edge's wider margin, or a
     * feels-like or dew point line widening the band. The preview's labels sit further out, in
     * the plot's corners beyond its inset rows, so there each one moves only once its extreme
     * lies inside `reachTop` / `reachBottom`, today's reach: with nothing anchored and no band
     * the labels stay where they always were, as the watch's do. The lo label sits on the
     * plot's floor on both, so its reach is always the inset row over it. The hi label's place
     * is fixed to the top of the graph on both, not to a top stripe band, so under a band there
     * is no gate (`reachTop` -Infinity, the watch's plain rule): the curve's top keeps its inset
     * below the band, which lies below the label's ink under any band, and the label follows
     * it, as basalt's does (its default view under one stripe: row 13 against the ink's centre
     * row 9; temp_axis_pad.h temp_labels_align).
     * @param {number} hiBase Today's hi baseline.
     * @param {number} loBase Today's lo baseline.
     * @param {number} curveTop The curve's highest y.
     * @param {number} curveBottom The curve's lowest y.
     * @param {number} reachTop The highest y the curve reaches with today's top margin, or
     *   -Infinity under a top stripe band (no gate).
     * @param {number} reachBottom The lowest y it reaches with today's bottom margin.
     * @returns {{hi: number, lo: number}} The baselines to draw.
     */
    function alignLabels(hiBase, loBase, curveTop, curveBottom, reachTop, reachBottom) {
        var hi = curveTop > reachTop ? Math.max(hiBase, curveTop + LABEL_CAP / 2) : hiBase;
        var lo = curveBottom < reachBottom ? Math.min(loBase, curveBottom + LABEL_CAP / 2) : loBase;
        if (lo - LABEL_CAP - hi >= TEMP_LABEL_MIN_INK_GAP * CURVE_INSET_PREV / WATCH_INSET_PX) {
            return { hi: hi, lo: lo };
        }
        return { hi: hiBase, lo: loBase };
    }

    /**
     * The temperature scale's range (temp_axis_pad.h THE SCALE, mirrored; owner, 2026-10-04:
     * "always fit all lines"): the lowest and highest value of the temperature and of every
     * feels-like or dew point line drawn, an hour with no reading (null) left out — the
     * watch's TEMP_AXIS_RANGE_NONE widened by temp_axis_range_widen. Its ends land on the
     * margin rows; min === max is a flat range, which sits mid-plot.
     * @param {number[]} temps The temperature sample (every hour a reading).
     * @param {Array.<Array.<?number>>} lines The drawn temperature-axis lines' samples.
     * @returns {{min: number, max: number}}
     */
    function tempAxisRange(temps, lines) {
        var all = [temps].concat(lines);
        var min = Infinity, max = -Infinity;
        for (var s = 0; s < all.length; s += 1) {
            for (var i = 0; i < all[s].length; i += 1) {
                var v = all[s][i];
                if (typeof v !== 'number') { continue; }
                if (v < min) { min = v; }
                if (v > max) { max = v; }
            }
        }
        return { min: min, max: max };
    }

    // Mirrors forecast-series.PRESSURE_SCALE_CURVE_HPA (+ curvePermille); a drift
    // test keeps the curves equal. Duplicated rather than imported because this file
    // is bundled into the config page, which has no access to the watch modules (the
    // wind scale, by contrast, lives in line-alert.js, which the page does load).
    var PRESSURE_CURVES = {
        low:  [[940, 0], [1010, 150], [1020, 850], [1060, 1000]],
        mid:  [[940, 0], [1005, 150], [1025, 850], [1060, 1000]],
        high: [[940, 0], [995, 200], [1035, 900], [1060, 1000]]
    };
    /**
     * Piecewise-linear interpolation over [x, y] breakpoints, clamped at both ends —
     * the pressurePermille mapping, mirrored.
     * @param {number} v Input value.
     * @param {Array.<Array.<number>>} pts Breakpoints, ascending in x.
     * @returns {number} Interpolated y (permille), rounded.
     */
    function pressureCurvePermille(v, pts) {
        if (v <= pts[0][0]) { return pts[0][1]; }
        for (var i = 1; i < pts.length; i += 1) {
            if (v <= pts[i][0]) {
                var x0 = pts[i - 1][0], y0 = pts[i - 1][1];
                return Math.round(y0 + (v - x0) * (pts[i][1] - y0) / (pts[i][0] - x0));
            }
        }
        return pts[pts.length - 1][1];
    }

    // A wind, gust or UV line drawn Visible values: Alert (owner, 2026-10-02: "when
    // enabling alert values only for a gust line, nothing shows in the preview anymore").
    // The preview's samples are a mild day that never reaches the seed warn levels, so such a
    // line would draw nothing; on Alert it draws alertSamples' instead.
    // Series units per sample unit: the bake's UV series is UV x 10, the sample the index.
    var SERIES_PER_SAMPLE = { wind: 1, gust: 1, uv: 10 };
    // How far from its warn level towards its band's top a sample on Alert peaks: past the
    // band scale's full-colour step (stripe-levels.js SCALES.band, 90 %), so a stripe shows
    // every step from the faintest up.
    var ALERT_PEAK_SHARE = 0.9;
    // Wind and gusts sharing one band: the wind peaks lower, this share of the way from its
    // warn level to the band's top, and wherever it draws the gust sits at least
    // SHARED_GUST_LIFT of the way from the wind up to that top, so the gust line runs clearly
    // above the wind's, as real gusts do, instead of on it: apart by at least a fifth of the
    // room the band leaves above the wind's warn level. (A wind warn level at the band's top
    // leaves none: the wind can only draw at the top there, and the gusts with it, as on
    // the watch.)
    var SHARED_WIND_PEAK_SHARE = 0.6;
    var SHARED_GUST_LIFT = 0.5;

    /**
     * The samples a Visible values: Alert line draws: each keeps its shape, redrawn against
     * the user's own levels. The lower half of its range goes under half the band's bottom:
     * the line's gaps, whatever the unit rounds. The upper half runs from the metric's warn
     * level to ALERT_PEAK_SHARE of the way up to the band's top (line-alert.js alertBand:
     * the higher of the usual top and the danger level). Wind and gusts sharing one band
     * keep gusts above the wind (SHARED_WIND_PEAK_SHARE, SHARED_GUST_LIFT). A metric
     * without a band keeps its very array.
     * @param {Object} state Live settings (windUnits, windScale, the Alert levels).
     * @param {Object<string, {bottom: number, top: number}>} bands line-alert.js alertBands.
     * @param {Object<string, number[]>} samples wind and gust (km/h) and uv (the index).
     * @returns {Object<string, number[]>} The samples to draw, by metric.
     */
    function alertSamples(state, bands, samples) {
        var shared = Boolean(bands.wind && bands.gust && samples.wind && samples.gust);
        var out = {};
        Object.keys(samples).forEach(function (id) {
            var vals = samples[id], band = bands[id];
            if (!band) { out[id] = vals; return; }
            var perUnit = SERIES_PER_SAMPLE[id];
            var hi = Math.max.apply(null, vals);
            var mid = (Math.min.apply(null, vals) + hi) / 2;
            // The metric's own warn level: the bottom of the band its line has alone.
            var warn = lineAlert.alertBand(state, id, [id]).bottom;
            var share = (shared && id === 'wind') ? SHARED_WIND_PEAK_SHARE : ALERT_PEAK_SHARE;
            var peak = warn + share * (band.top - warn);
            out[id] = vals.map(function (s) {
                if (s < mid) { return s / mid * band.bottom / 2 / perUnit; }
                // At least one series unit: 0 is no value on these lines, even at warn 0.
                var x = Math.max(warn + (s - mid) / (hi - mid) * (peak - warn), 1) / perUnit;
                // A stored warn level with decimals in mph, knots or UV can sit between two
                // shown numbers (line-alert.js shownNumber rounds): lift to the next one.
                for (var k = 0; k < 20 && !lineAlert.reachesWarn(state, id, x * perUnit); k += 1) {
                    x += 1 / perUnit;
                }
                return x;
            });
        });
        if (shared) {
            out.gust = out.gust.map(function (g, i) {
                var w = out.wind[i];
                // Where the wind draws, the gust a share of the room above it higher (the
                // wind's own rounding lift can leave it a hair past the top: no room).
                var lift = lineAlert.reachesWarn(state, 'wind', w)
                    ? SHARED_GUST_LIFT * Math.max(bands.gust.top - w, 0) : 0;
                return Math.max(g, w + lift);
            });
        }
        return out;
    }

    /**
     * The forecast-graph preview block: temp curve, up to three metric lines — each
     * in its selected style (thin/thick line, square dots, x marks); the main one
     * optionally filled — rain bars, night band, axis and legend — the same z-order
     * and geometry rules forecast_layer.c draws with.
     * Adapted from index.html:231-267's forecastSVG.
     * @param {Object} state Live settings (colours as hex strings).
     * @param {Object} env Config-UI environment facts ({ color, platform, … }).
     * @param {Object} [userData] Page userData; `palette` is the page-open snapshot.
     * @returns {string} SVG markup.
     */
    function forecastPreview(state, env, userData) {
        // The graph's colours, resolved by the SAME function whose answer the watch's Clay
        // wire packs (weather/graph-wire.js, over the connected watch's computeEnv)
        // and read off `state` — the LIVE settings object render() hands every block —
        // so a pick shows up the moment it is made, not on the next page open. What the
        // page supplies in place of a watchInfo:
        //   color:         the DISPLAY's capability; the resolver folds bw/bw-light in.
        //   themePolarity: TRUE unconditionally, even previewing aplite. The preview
        //                  shows the theme the user picked; the aplite light→dark fold
        //                  is a watch-render fact this preview has never modelled, and
        //                  wiring it in here would change what aplite users see.
        //   lineStyles:    the WW_LINE_STYLE mirror (stylesFrozen below), so a stored
        //                  stripe cannot switch the fill off on a watch that ignores it.
        // The other readings (draw-from.js, line-alert.js) take `env` itself.
        var caps = { color: !(env && !env.color), themePolarity: true,
            lineStyles: !(Boolean(env) && env.lineStyles === false) };
        var cx = lineStyle.renderContextFor(state, caps);
        var gc = lineStyle.resolveGraphColors(state, caps);
        // The EFFECTIVE colour flag: a colour display renders as colour only when the
        // theme isn't Black & White, so a bw/bw-light theme reuses the exact preview a
        // B&W watch gets. Same value the resolver gated the picks on, by construction.
        var isColor = cx.isColor;
        var ink = previewInk(cx.theme);
        var P = (userData && userData.palette) || FALLBACK_PALETTE;
        // Solid ('white'/Solid) rain-bar color, mirroring rain-tier.js buildPalette's
        // colorMode==='white' branch: DarkGray in light polarity (not black — a pure
        // white bar reads too flat on a white background), white in dark. Only used on
        // effectively-color displays (isColor); B&W/bw themes draw an OUTLINE instead
        // (see rainBars' `outline` param below) using ink.fg as the stroke color, which
        // this variable also equals there — same value, different role.
        var barFg = isColor ? (isLightPolarity(cx.theme) ? '#555555' : '#FFFFFF') : ink.fg;
        // The light colour theme keeps that interior and adds chart.c's theme_fg()
        // silhouette on top (BAR_OUTLINED is drawn in every theme but colour-dark).
        var barEdge = (isColor && isLightPolarity(cx.theme)) ? ink.fg : null;

        // One coherent 12-point scenario starting at noon (slot 0 = 12:00): an afternoon
        // shower that suppresses UV, UV gone overnight, temp dipping then rising toward dawn.
        var temps  = [24, 24, 22, 20, 18, 16, 15, 14, 14, 15, 17, 19];
        var precip = [20, 55, 80, 85, 60, 35, 20, 15, 12, 10, 14, 22];
        var wind   = [14, 16, 20, 24, 22, 19, 17, 16, 18, 22, 26, 24];
        var rain   = [0, 0.5, 6, 12, 4, 1, 0.3, 0, 0, 0, 0, 0];
        var gust   = [22, 25, 30, 34, 32, 28, 25, 24, 27, 31, 36, 33];
        var uv     = [8, 6, 4, 2, 1, 0, 0, 0, 0, 0, 1, 3];
        // Tracks temps a few degrees under through the shower (wind chill), then a degree
        // under the calm night low: the gap between the two curves is the story it tells,
        // and the night shows it dipping under the temperature's low.
        var feels  = [21, 21, 19, 17, 15, 14, 13, 13, 13, 14, 15, 17];
        // Climbs toward the temperature through the shower (the air saturates), then
        // settles a few degrees under the cool night temps: the lowest of the three, so
        // with a dew line on, its night low takes the bottom margin row and the temperature
        // curve sits above it.
        var dew    = [13, 14, 17, 18, 16, 14, 13, 12, 12, 12, 13, 13];
        // Falls into the shower (slots 2-4), dips to a below-floor low at slot 4 (984 hPa,
        // below the 'low' band's 990 floor — exercises the floor-clamp-not-skip dot
        // behavior below), then recovers as it clears — the same weather story the other
        // samples tell.
        var pressure = [1016, 1012, 1007, 1003, 984, 1004, 1007, 1010, 1012, 1013, 1014, 1015];
        // Cloud cover (%): thickening into the shower, overcast through it, then
        // breaking up overnight before the morning clouds return.
        var cloud  = [35, 60, 90, 100, 95, 75, 45, 20, 10, 15, 40, 65];

        // The frozen-styles gate: env.lineStyles is the WW_LINE_STYLE mirror
        // (platform.js). Previewing such a watch pins the pre-feature look —
        // its style pickers are hidden and the watch ignores the style bytes —
        // and it never draws the third-metric line. Only an explicit false
        // freezes: a hand-built preview env without the fact stays capable.
        var stylesFrozen = Boolean(env) && env.lineStyles === false;
        /**
         * The effective style for one line-style key: the frozen built-in on a
         * watch without WW_LINE_STYLE, else the stored pick (or its default) as
         * the bake resolves it — never a stripe on a metric that cannot be one
         * (line-style.js metricAllowsStripe), exactly as the watch draws it.
         * @param {string} styleKey secondaryLineStyle|thirdLineStyle|fourthLineStyle|fifthLineStyle.
         * @returns {string} 'line'|'bold'|'dots'|'x'|'stripeTop'|'stripeBottom'.
         */
        function styleFor(styleKey) {
            return stylesFrozen ? lineStyle.LINE_STYLE_DEFAULTS[styleKey]
                : lineStyle.lineStyleValue(state, styleKey);
        }
        // The ordered metric lines, modelled ONCE for the draw pass and the
        // legend: colours off the resolver, styles off the pickers, on-gates
        // from line-style.js' effectiveLineMetric — the same off/duplicate
        // rules the bake applies, so the preview matches the watch by
        // construction. Entries are named by the settings keys they read (the
        // one frozen vocabulary); the UI ordinals ("Third metric") are labels only.
        var LINES = [
            { key: 'secondaryLine', metric: state.secondaryLine, on: true,
              style: styleFor('secondaryLineStyle'), color: hexColor(gc.secondary) },
            { key: 'thirdLine', metric: state.thirdLine,
              on: Boolean(lineStyle.effectiveLineMetric(state, 'thirdLine')),
              style: styleFor('thirdLineStyle'), color: hexColor(gc.third) },
            { key: 'fourthLine', metric: state.fourthLine,
              on: !stylesFrozen && Boolean(lineStyle.effectiveLineMetric(state, 'fourthLine')),
              style: styleFor('fourthLineStyle'), color: hexColor(gc.fourth) },
            { key: 'fifthLine', metric: state.fifthLine,
              on: !stylesFrozen && Boolean(lineStyle.effectiveLineMetric(state, 'fifthLine')),
              style: styleFor('fifthLineStyle'), color: hexColor(gc.fifth) }
        ];
        var n = temps.length;
        var windMax = lineAlert.scaleTop(state, 'wind');
        var pCurve = PRESSURE_CURVES[state.pressureScale] || PRESSURE_CURVES.mid;
        // A wind, gust or UV line drawn Show: Alert: the band the bake maps it over, for
        // the lines this watch draws (the shared wind/gust band only where both draw), on
        // a watch with Alert settings (aplite draws every line All).
        var alertBands = lineAlert.alertBands(state, env);
        // Such a line draws its sample redrawn against the user's levels (alertSamples).
        var shown = alertSamples(state, alertBands, { wind: wind, gust: gust, uv: uv });
        // metric -> { sample series, full-scale max, fill? }. Color resolves per render.
        // feels and dew have no max: they ride the shared temperature axis
        // (lineStyle.isTempAxisMetric), so they map through yT like the temp curve
        // instead of a 0..max scale; pressure maps through its curve. `alert`: the
        // metric's Show: Alert band, or null; `perUnit`: series units per sample unit
        // there (SERIES_PER_SAMPLE).
        var METRIC = {
            precip_prob: { vals: precip, max: 100, fill: true },
            cloud: { vals: cloud, max: 100 },
            wind: { vals: shown.wind, max: windMax, perUnit: SERIES_PER_SAMPLE.wind },
            gust: { vals: shown.gust, max: windMax, perUnit: SERIES_PER_SAMPLE.gust },
            uv: { vals: shown.uv, max: 11, perUnit: SERIES_PER_SAMPLE.uv },
            pressure: { vals: pressure, curve: pCurve },
            feels: { vals: feels },
            dew: { vals: dew }
        };
        Object.keys(METRIC).forEach(function (k) {
            METRIC[k].id = k;
            METRIC[k].tempAxis = lineStyle.isTempAxisMetric(k);
            METRIC[k].alert = Object.prototype.hasOwnProperty.call(alertBands, k) ? alertBands[k] : null;
        });
        /**
         * Whether one sample of a metric shows on its line, its marks or its fill: the
         * watch's wire byte above 0 (forecast-series.js metricBytes). A zero-based metric's
         * zero, and a Show: Alert line's sample below the warn level, ship as byte 0 and draw
         * nothing; pressure, feels-like and dew point always draw. metricYRaw skips by it.
         * @param {Object} m METRIC entry.
         * @param {number} i Sample index.
         * @returns {boolean}
         */
        function sampleShown(m, i) {
            if (m.tempAxis || m.curve) { return true; }
            if (m.alert) {
                return lineAlert.alertPermille(state, m.id, [m.vals[i] * m.perUnit], m.alert)[0] !== null;
            }
            return Math.min(m.vals[i], m.max) > 0;
        }
        /**
         * Whether a line draws anything in the hours the preview draws: the watch's one scan
         * (temp_axis_pad.h temp_axis_any_above_zero), a value above 0. A stripe over its
         * n - 1 hour cells (a cell above level 0), any other style over its n hour ticks.
         * @param {Object} line LINES entry.
         * @returns {boolean} False for a line that is off or has nothing above 0.
         */
        function drawsAny(line) {
            var m = METRIC[line.metric];
            if (!line.on || !m) { return false; }
            var stripe = isStripe(line.style);
            for (var i = 0; i < (stripe ? n - 1 : n); i += 1) {
                if (stripe ? stripeLevel(m, i) > 0 : sampleShown(m, i)) { return true; }
            }
            return false;
        }
        // Only a line with a value above 0 takes part in the layout (temp_axis_pad.h): a
        // stripe with none takes no band (the plot grows into its rows, and the next stripe
        // on its edge closes up), a line with none anchors no edge. The rain bars likewise,
        // over their n - 1 hour columns.
        LINES.forEach(function (line) { line.drawn = drawsAny(line); });
        var rainDrawn = false;
        for (var ri = 0; ri < n - 1; ri += 1) {
            if (previewRain.barPermille(Math.round(rain[ri] * 10)) > 0) { rainDrawn = true; }
        }
        // Bottom stripes sit BELOW the plot's zero line, in their own band above the
        // hour axis (forecast_layer.c's stripe_band): the first flush under the zero
        // line, further ones 1 unit apart, and one free row over the ticks. The
        // plot's baseline PB lifts by it; AXIS_Y is where the ticks and labels hang.
        var STRIPE_H = 5, STRIPE_GAP = 1;
        var bottomStripes = 0;
        for (var bs = 0; bs < LINES.length; bs += 1) {
            if (LINES[bs].drawn && LINES[bs].style === 'stripeBottom') { bottomStripes += 1; }
        }
        var AXIS_Y = 94;
        var stripeBand = bottomStripes
            ? bottomStripes * STRIPE_H + (bottomStripes - 1) * STRIPE_GAP + 1 : 0;
        // Top stripes get a band of their own ABOVE the plot (forecast_layer.c's top_band):
        // stacked from the top edge, 2 free rows under the last. The plot — lines, fill,
        // bars — starts below it (PTL); the metric lines run up to it, the temperature
        // curve keeps its inset under it, as over the bottom edge, as the watch does. Only
        // the night shading runs on up through the band (PT).
        var topStripes = 0;
        for (var ts = 0; ts < LINES.length; ts += 1) {
            if (LINES[ts].drawn && LINES[ts].style === 'stripeTop') { topStripes += 1; }
        }
        var TOP_BAND_GAP = 2;
        var topBand = topStripes
            ? topStripes * STRIPE_H + (topStripes - 1) * STRIPE_GAP + TOP_BAND_GAP : 0;
        // The left axis options (BETA, forecast-axis.js resolved: every default off a known
        // emery, so every other preview is unchanged whatever is stored). With the numbers On
        // graph or Off the label strip goes to the graph, which then starts PX0_COLLAPSED in;
        // the zero line, the ticks, the vertices and the legend follow PX0. The axis line is
        // not modelled (no preview draws one).
        var ax = forecastAxis.resolved(state, env);
        var PX0 = ax.numbers === forecastAxis.BESIDE ? 20 : PX0_COLLAPSED;
        var PX1 = 197, PT = 4, PB = AXIS_Y - stripeBand;
        var PTL = PT + topBand;
        var MT = topBand ? PTL : PT + 3;   // where a full-height metric value lands
        var plotW = PX1 - PX0, plotH = PB - PTL;
        // One watch-faithful slot grid (chart.c): N hourly slots, one tick per slot. Slot 0 is
        // 12:00; hour = 12 + i. Line vertices sit ON the ticks (so a line spans the first tick to
        // the last), and rain bars / second-metric dots sit centred in the hour COLUMN between two
        // ticks — exactly how chart_render_line vs chart_render_bars place them on the watch.
        var pitch = plotW / (n - 1);
        var tickX = function (i) { return PX0 + i * pitch; };              // line vertex / hour tick x
        var gapCenter = function (i) { return PX0 + (i + 0.5) * pitch; };  // bar / dot column centre
        // The temperature axis (temp_axis_pad.h THE SCALE, mirrored; owner, 2026-10-04:
        // "always fit all lines"): the lowest and highest value of the temperature and of
        // every feels-like or dew point line drawn — whatever its style — land on the margin
        // rows, all three on one scale, so the gaps between the curves are real and no curve
        // runs past a margin: a feels-like peak over the air's high takes the top margin row
        // and the temperature curve sits under it (yT). The hi/lo LABELS name the actual
        // temperature's range, wherever its curve sits. A flat joint range gives no scale:
        // then, as on the watch, it sits mid-plot. Each line is gated on its own
        // LINES[i].on, not on bare effectiveLineMetric: previewing a watch without
        // WW_LINE_STYLE turns the third- and fourth-metric lines off while
        // effectiveLineMetric would still name their metric, and a line nobody draws must not
        // widen that range. Previewing aplite none widens it: the bake never sends a feels or
        // dew line there (forecast-series.js tempAxisLineDrawn) and the frozen fork has no
        // fit, so a stored pick leaves the temperature on its own range.
        var axisLines = [];
        var AXIS_SAMPLES = { feels: feels, dew: dew };
        LINES.forEach(function (line) {
            if (line.on && !stylesFrozen && lineStyle.isTempAxisMetric(line.metric)) {
                axisLines.push(AXIS_SAMPLES[line.metric]);
            }
        });
        var tLabelMin = Math.min.apply(null, temps), tLabelMax = Math.max.apply(null, temps);
        var axisRange = tempAxisRange(temps, axisLines);
        // 'Include feels-like & dew point' (left axis BETA): the numbers name the scale's ends,
        // as the bake puts them in TEMP_MIN / TEMP_MAX (forecast-series.js tempScaleRange).
        var scaleNums = ax.scale && axisLines.length > 0;
        if (scaleNums) {
            tLabelMin = Math.floor(axisRange.min);
            tLabelMax = Math.ceil(axisRange.max);
        }
        var tmin = axisRange.min, tmax = axisRange.max;
        // Configurable curve offset: the temp axis (temp + feels/dew via isTempAxisMetric
        // below) is inset symmetrically from the shared full-height band
        // ([MT .. PB], the mapping every other metric uses), mirroring the
        // watch's per-series inset_y (fixed 7 px — not a user setting). Scale:
        // the preview band (87 units) is taller than the watch plot; 7 watch px
        // = the preview's long-standing 12-unit bottom clearance over the axis
        // row (the top gains the same symmetric margin the watch actually draws).
        var curveInsetPrev = CURVE_INSET_PREV;
        // On an anchored edge (the rain bars' or a drawn amount line's with a value above 0:
        // draw-from.js forecastAnchors; none previewing aplite, whose margins are frozen) the
        // margin is at least the share (anchorShare: the eighth, or the curve past it) of the
        // band [MT, PB], the plot the metrics map into between the stripe bands —
        // temp_axis_pad.h temp_axis_margin, mirrored. Both edges start from the inset, the
        // top under a top stripe band too.
        var anchored = drawFrom.forecastAnchors(state, env, function (key) {
            if (key === 'bars') { return rainDrawn; }
            for (var li = 0; li < LINES.length; li += 1) {
                if (LINES[li].key === key) { return LINES[li].drawn; }
            }
            return false;
        });
        var share = anchorShare(PB - MT);
        var topMargin = curveInsetPrev, bottomMargin = curveInsetPrev;
        if (anchored.top && share > topMargin) { topMargin = share; }
        if (anchored.bottom && share > bottomMargin) { bottomMargin = share; }
        var ytop = MT + topMargin, ybot = PB - bottomMargin;
        // The rows a temperature-axis value is held inside (temp_axis_pad.h temp_axis_rows):
        // the plot's content rows, from where a full-height metric value lands (MT: under a
        // top stripe band, never into its gap) down to one watch row over the zero line. A
        // safety net, as on the watch: every value the range covers lies between the margin
        // rows, so only a smoothed stretch's control point could ever reach the plot's edge.
        var yTTop = MT, yTBottom = PB - CURVE_INSET_PREV / WATCH_INSET_PX;
        /**
         * A temperature-axis value's y: the scale through the margin rows (the net: held in
         * the plot).
         * @param {number} y An unheld y.
         * @returns {number} y inside [yTTop, yTBottom].
         */
        var holdT = function (y) { return Math.min(yTBottom, Math.max(yTTop, y)); };
        var yT = function (t) {
            return holdT(tmax > tmin ? ybot - (t - tmin) / (tmax - tmin) * (ybot - ytop) : (ybot + ytop) / 2);
        };
        var n0 = tickX(9), n1 = tickX(n - 1);       // night band: sunset 21:00 (slot 9) -> right edge
        var bw = 9;                                  // rain-bar / dot width

        // The graph strokes, as SVG colours. Every rule that used to be restated
        // here — the effective-colour gate, the per-polarity colours, gust's coupling to
        // the rain bars and the B&W arm's exactly-white→black readability flip — lives in
        // line-style.js and reaches the preview through `gc`.
        var mainFill = hexColor(gc.fill);
        var tempColor = isColor ? P.temp : ink.fg;
        var tempW = isColor ? 2.2 : 3;               // B&W: thick temp vs thin main line
        var mainW = isColor ? 1.6 : 1;
        var boldW = isColor ? 2.8 : 3;               // the 'bold' (3 px) line style

        // The night colours apply only on an effectively-colour preview. The WIRE carries
        // them either way (resolveNightColors has no isColor gate, deliberately), but a
        // B&W watch or a bw/bw-light theme discards all five night bytes and paints from
        // its own constants — so the preview, which shows the RENDER, must not use them.
        // The band being off suppresses them too, so a colour nothing paints stays out.
        var nightPicksApply = isColor && Boolean(state.dayNightShading);
        // The night hatch stroke, feeding the single `nh` pattern in the defs below.
        // Every night colour is stored concrete now, so the colour arm just paints what
        // the resolver hands back — DarkGray on an untouched blob, which is what the watch
        // draws (forecast_layer.c's night_over hatch), or whatever the user moved it to.
        // The translucent ink is the B&W arm, standing in for the theme foreground the
        // watch hatches with there.
        var nightHatchStroke = nightPicksApply ? hexColor(gc.night.hatch) : ink.rgba('0.30');
        /**
         * The night band: the hatch and its dusk/dawn lines, from the top of the graph
         * (PT) down to the zero line — up through a top stripe band too, as the watch's
         * night hatch runs on through it (forecast_layer.c's extend_top). The stripe
         * cells are drawn later and are opaque (preview-stripe.js cell), so the shading
         * shows only in a stripe's empty hours and its gaps.
         * @returns {string} SVG markup, or '' with the shading off.
         */
        function drawNightShading() {
            if (!state.dayNightShading) { return ''; }
            var boundary = nightPicksApply ? hexColor(gc.night.boundary) : ink.rgba('0.45');
            return '<rect x="' + n0 + '" y="' + PT + '" width="' + (n1 - n0) + '" height="' + (PB - PT) + '" fill="url(#nh)"></rect>'
                + '<line x1="' + n0 + '" y1="' + PT + '" x2="' + n0 + '" y2="' + PB + '" stroke="' + boundary + '" stroke-width="0.7"></line>'
                + '<line x1="' + n1 + '" y1="' + PT + '" x2="' + n1 + '" y2="' + PB + '" stroke="' + boundary + '" stroke-width="0.7"></line>';
        }
        function drawTempCurve() {
            return '<path d="' + smooth(temps.map(function (t, i) { return [tickX(i), yT(t)]; }))
                + '" fill="none" stroke="' + tempColor + '" stroke-width="' + tempW + '" stroke-linecap="round"></path>';
        }
        function drawAxis() {
            // One tick per hourly slot; a big tick + hour digit every 3rd slot (mirrors the watch's
            // big_every = 3). Hour = 12 + i (mod 24): 12, 15, 18, 21 over the noon→23:00 window,
            // folded to 12, 3, 6, 9 by the 12h axis setting (config.c config_axis_hour: 0 → 12).
            var out = '';
            for (var i = 0; i < n; i += 1) {
                var big = i % 3 === 0;
                out += '<line x1="' + tickX(i) + '" y1="' + AXIS_Y + '" x2="' + tickX(i) + '" y2="' + (AXIS_Y + (big ? 4 : 2)) + '" stroke="' + ink.rgba('0.32') + '" stroke-width="0.6"></line>';
                if (big) {
                    var h = (12 + i) % 24;
                    if (state.axisTimeFormat === '12h') { h = h % 12 || 12; }
                    out += txt(tickX(i), AXIS_Y + 11, 7.5, '#7C828D', 'middle', 600, String(h));
                }
            }
            return out;
        }
        /**
         * One metric value's y in column/tick i — THE value→y mapping. The
         * bar-aligned marks (skipZero true: a zero-based metric's zero is
         * genuinely "no data" and returns null, mirroring the watch's mark skip),
         * the line vertices and the area fill (skipZero false: a zero lands on the
         * baseline — the fill's contour drops to it over the gaps, like
         * chart_render_area's h = 0, and the line comes down to it next to a
         * reading, lineFor) all share it. Feels rides the
         * shared temperature axis (the joint scale via yT — a temperature has no
         * skippable zero, never a 0..max scale); pressure's piecewise absolute
         * curve draws EVERY reading — a deep low off the visible band is real
         * data clamped to the baseline, never a skippable zero, mirroring
         * forecast-series.pressurePermille's floor-clamp so the preview and
         * the watch don't diverge. A Show: Alert line maps over its band
         * (line-alert.js alertPermille, as the bake does): a sample below the
         * warn level is a gap like a zero, one at the bottom is lifted off it
         * by the bake's 2 ‰ floor (forecast-series.js BAND_FLOOR_PERMILLE).
         * This is the standing (Draw from: Bottom) y; metricY mirrors it for a line
         * that hangs from the top.
         * @param {Object} m METRIC entry.
         * @param {number} i Sample index.
         * @param {boolean} skipZero Null out a zero-based metric's zero.
         * @returns {?number} y, or null to skip the sample.
         */
        function metricYRaw(m, i, skipZero) {
            if (m.tempAxis) { return yT(m.vals[i]); }
            // The skip rule is sampleShown's (the one the layout's scan reads): a sample that
            // ships as byte 0 is a gap, or the baseline under a fill.
            if (!sampleShown(m, i)) { return skipZero ? null : PB; }
            if (m.alert) {
                var apm = lineAlert.alertPermille(state, m.id, [m.vals[i] * m.perUnit], m.alert)[0];
                return PB - Math.max(apm, 2) / 1000 * (PB - MT);
            }
            var pm = m.curve ? pressureCurvePermille(m.vals[i], m.curve) / 1000
                : Math.min(m.vals[i], m.max) / m.max;
            return PB - pm * (PB - MT);
        }
        /**
         * Whether a metric's line hangs from the top (Draw from: Top, draw-from.js
         * metricFromTop: never previewing aplite). Only the five amount metrics have the
         * setting; a temperature-axis curve never hangs. Only a drawn line or marks, or the
         * Main metric's fill, ever asks (stripes shade by level and keep their own
         * Top/Bottom), which is lineEdge's rule.
         * @param {string} metric A metric id.
         * @returns {boolean}
         */
        function hangs(metric) {
            var m = METRIC[metric];
            return Boolean(m) && !m.tempAxis && drawFrom.metricFromTop(state, metric, env);
        }
        /**
         * One metric value's y in column/tick i, as drawn: metricYRaw's, mirrored over
         * the plot box [PTL, PB] for a line that hangs from the top (the watch's mirror
         * over its content rows) — zero then lands on PTL, under a top stripe band or at
         * the plot's top, and full height at PB - (MT - PTL). A Visible values: Alert
         * line's below-warn PB and its 2 ‰ floor flip with it. The skipped sample and
         * the temperature axis are unchanged.
         * @param {Object} m METRIC entry.
         * @param {number} i Sample index.
         * @param {boolean} skipZero Null out a zero-based metric's zero.
         * @returns {?number} y, or null to skip the sample.
         */
        function metricY(m, i, skipZero) {
            var y = metricYRaw(m, i, skipZero);
            if (y === null || m.tempAxis) { return y; }
            return hangs(m.id) ? PTL + PB - y : y;
        }
        // Vertex computation for the main-metric FILL contour (the stroke takes the
        // same vertices run by run in lineFor, skipping two zeros in a row): one
        // point per sample, vertices on the hour ticks, zeros at the baseline.
        // Returns null for an unknown metric or fewer than 2 points (nothing to draw).
        function metricPoints(metric) {
            var m = METRIC[metric];
            if (!m) { return null; }
            var pts = [];
            for (var i = 0; i < m.vals.length; i += 1) {
                pts.push([tickX(i), metricY(m, i, false)]);
            }
            return pts.length >= 2 ? pts : null;
        }
        /**
         * The closed area path under a metric's curve — the `d` string both the day fill
         * and the night tint paint. Factored out so the tint re-draws the SAME geometry
         * rather than a second, drifting copy of it.
         * @param {string} metric precip_prob|cloud|wind|gust|uv|pressure|feels|dew
         * @returns {?string} SVG path data, or null when the metric has no curve.
         */
        function areaPathFor(metric) {
            var pts = metricPoints(metric);
            if (!pts) { return null; }
            // The fill closes on its line's zero edge: the plot's top for a hanging line.
            var edge = hangs(metric) ? PTL : PB;
            return smooth(pts) + ' L' + pts[pts.length - 1][0] + ',' + edge + ' L' + pts[0][0] + ',' + edge + ' Z';
        }
        // Whether the main metric draws a filled area at all — the resolver's own fill
        // flag, which is the authoritative gate (feels-like never fills: it rides the
        // temperature axis, so "below the line" has no meaningful zero, and the flag
        // stays false even for a settings blob still carrying a stale `true`). It is
        // resolved for state.secondaryLine, the only metric the preview ever fills.
        var fillsArea = gc.fillOn;
        /**
         * Main metric's area fill only (no stroke) — the resolved fill colour on colour
         * displays, a dithered stipple on B&W (mirrors the watch's 1-bit dither of the
         * GColorLightGray fill — not diagonal lines). Drawn separately from lineFor() so
         * the caller can place it beneath the rain bars, matching chart.c's z-order
         * (CHART_LAYER_AREA before CHART_LAYER_BARS in forecast_layer.c) — the bars paint
         * over the fill, not the other way around.
         * @param {string} metric The main metric — state.secondaryLine.
         * @returns {string} SVG markup
         */
        function areaFillFor(metric) {
            if (!fillsArea) { return ''; }
            var area = areaPathFor(metric);
            if (!area) { return ''; }
            return isColor
                ? '<path d="' + area + '" fill="' + mainFill + '" fill-opacity="0.25"></path>'
                : '<path d="' + area + '" fill="url(#fillhatch)"></path>';
        }
        /**
         * The night fill tint: the same area path re-drawn clipped to the night band, in
         * the resolved night-area base — the watch's night UNDERLAY, which re-shades the
         * filled area during the night hours.
         *
         * The gate is that underlay's, from forecast_layer.c: a night band and a filled
         * area to re-shade (`night_on && fill_on`) and colour only (`has_underlay =
         * !theme_is_bw()`, folded into nightPicksApply). Both polarities re-shade — light
         * used to be skipped unless the tint was an explicit pick, until NIGHT_AREA_COLORS
         * grew a light arm tuned on hardware.
         * @returns {string} SVG markup, or '' when nothing is tinted.
         */
        function nightFillTint() {
            if (!nightPicksApply || !fillsArea) { return ''; }
            var area = areaPathFor(state.secondaryLine);
            if (!area) { return ''; }
            // areaBase is the metric's hand-tuned night base, or the user's tint verbatim
            // once moved off it (nightAreaColorsFor); areaHatch/areaBoundary are the
            // watch's derived overlay, which the preview does not model.
            return '<path d="' + area + '" fill="' + hexColor(gc.night.areaBase)
                + '" fill-opacity="0.25" clip-path="url(#nightclip)"></path>';
        }
        /**
         * One metric as a line whose vertices sit on the hour ticks. A zero-based
         * metric's zero draws nothing on its own (sampleShown — the wire's byte 0),
         * but the line still comes down to the zero row at a zero next to a reading,
         * the vertex the fill's contour has there (metricY, skipZero false): the
         * stroke is one path per run of lineRuns (chart_runs.h), so two zeros in a
         * row stay a gap, a lone zero between readings is a dip and a lone reading
         * between zeros a peak. A floating metric (pressure, feels, dew) never has a
         * zero here, and would keep a plain gap (the watch's GAP lines). A lone
         * reading no segment reaches would be a small stroke-width square, mirroring
         * chart_render_line's run == 1 arm. The watch strokes straight segments; a
         * run with a zero vertex keeps its smoothed curve on the plot side of the zero
         * row (smooth's hold), so it never swings past it either. The fill (if any) is
         * drawn separately by areaFillFor() — see its doc comment for why.
         * @param {string} metric The metric the colour was resolved for.
         * @param {string} color Resolved stroke colour (hex).
         * @param {number} w Stroke width (mainW for 'line', boldW for 'bold').
         * @returns {string} SVG markup
         */
        var lineFor = function (metric, color, w) {
            var m = METRIC[metric];
            if (!m) { return ''; }
            var absent = [];
            for (var i = 0; i < m.vals.length; i += 1) { absent.push(!sampleShown(m, i)); }
            var runs = lineRuns(absent, !(m.tempAxis || m.curve)), out = '';
            // A temperature-axis curve's smoothed stretch is held inside the plot too
            // (holdT), the way the watch's straight segments are.
            var hold = m.tempAxis ? holdT : hangs(metric)
                ? function (y) { return Math.max(y, PTL); }
                : function (y) { return Math.min(y, PB); };
            for (var r = 0; r < runs.length; r += 1) {
                var run = [], zeroVertex = false;
                for (var k = runs[r][0]; k < runs[r][0] + runs[r][1]; k += 1) {
                    run.push([tickX(k), metricY(m, k, false)]);
                    if (absent[k]) { zeroVertex = true; }
                }
                if (run.length >= 2) {
                    out += '<path d="' + smooth(run, (zeroVertex || m.tempAxis) ? hold : null) + '" fill="none" stroke="' + color + '" stroke-width="' + w + '"></path>';
                } else {
                    // Lone reading between gaps: chart_render_line's run == 1
                    // small square. No series here reaches it (a zero-based line
                    // joins its zeros, a floating one has none), so this arm is
                    // pinned via lineRuns' GAP vectors and the C kernel's
                    // (test/c/chart_absent_test.c LINE_RUN_VECTORS).
                    out += rect(run[0][0] - w / 2, run[0][1] - w / 2, w, w, color);
                }
            }
            return out;
        };
        /**
         * A metric as bar-aligned squares centred in the hour column (same columns as
         * the rain bars) — the 'dots' style. Skips no-data samples (metricY skipZero).
         * @param {string} metric The metric the colour was resolved for.
         * @param {string} col Resolved mark colour (hex).
         * @returns {string} SVG markup
         */
        var barDotsFor = function (metric, col) {
            var m = METRIC[metric];
            if (!m) { return ''; }
            // Mirrors chart.c's dot cap: achromatic dots (theme foreground or either
            // gray) read heavier than a hue at the same size, so they get the short
            // cap; hued dots keep the tall one. Preview units, not watch px.
            var dh = (isColor && (col === ink.fg || col === '#AAAAAA' || col === '#555555'))
                ? 3 : 4;
            var out = '';
            for (var i = 0; i < n - 1; i += 1) {
                var cy = metricY(m, i, true);
                if (cy === null) { continue; }
                out += rect(gapCenter(i) - bw / 2, cy - dh / 2, bw, dh, col);
            }
            return out;
        };
        /**
         * A metric as little x marks centred in the hour column — the 'x' style
         * (chart.c's x arm of chart_draw_bar_marks). Two 1-px diagonals over an odd box.
         * @param {string} metric The metric the colour was resolved for.
         * @param {string} col Resolved mark colour (hex).
         * @returns {string} SVG markup
         */
        var barXFor = function (metric, col) {
            var m = METRIC[metric];
            if (!m) { return ''; }
            var out = '', arm = 2.4;
            for (var i = 0; i < n - 1; i += 1) {
                var cy = metricY(m, i, true);
                if (cy === null) { continue; }
                var cx = gapCenter(i);
                out += '<line x1="' + (cx - arm) + '" y1="' + (cy - arm) + '" x2="' + (cx + arm) + '" y2="' + (cy + arm) + '" stroke="' + col + '" stroke-width="1.1"></line>'
                    + '<line x1="' + (cx - arm) + '" y1="' + (cy + arm) + '" x2="' + (cx + arm) + '" y2="' + (cy - arm) + '" stroke="' + col + '" stroke-width="1.1"></line>';
            }
            return out;
        };
        // --- Stripes: chart.c's chart_render_stripe, mirrored -------------------
        // STRIPE_H / STRIPE_GAP (above) are the watch's FORECAST_STRIPE_H / _GAP,
        // scaled to this plot. The cells' line pattern keys off watch pixel columns:
        // here, as it always drew, 2 preview units a column from x 0 — near the watch's
        // scale (7 px an hour, 8 on emery), not its phase (preview-stripe.js cell).
        var STRIPE_UNIT = 2, STRIPE_ORIGIN = 0;
        /**
         * A metric value's stripe level, 0..4, as the bake picks it (forecast-series.js
         * stripeBytes): the value's place on its line's scale (line-alert.js
         * scalePercent — the Show: Alert band when the line has one), on the metric's
         * own scale (stripe-levels.js), read back from the wire byte the way the
         * watch's chart_stripe_level reads it. Only intensity metrics are ever stripes
         * (line-style.js metricAllowsStripe — styleFor never hands this a feels, dew or
         * pressure stripe).
         * @param {Object} m METRIC entry.
         * @param {number} i Sample index.
         * @returns {number} 0 (draws nothing) .. 4 (full colour).
         */
        function stripeLevel(m, i) {
            var pct = lineAlert.scalePercent(state, m.id, m.vals[i] * (m.perUnit || 1), m.alert);
            return previewStripe.levelOfByte(stripeLevels.metricByte(m.id, pct, Boolean(m.alert)));
        }
        // The cell look itself (tint + lines on colour, dither on B&W) is shared with
        // the radar preview's sky rows: preview-stripe.js, chart_stripe_fill_cell's mirror.
        /**
         * One metric as a stripe of hourly cells: along the plot's top edge, or in the
         * band below its zero line (stacked downward from a 1-unit gap).
         * Colour: the blended ramp. B&W: the theme foreground in one of four dither
         * densities (the `sd1`..`sd4` patterns below), as the watch dithers.
         * @param {string} metric The metric the colour was resolved for.
         * @param {string} color Resolved colour (hex).
         * @param {boolean} top Top edge (else bottom).
         * @param {number} slot 0 for the first stripe on that edge, 1 for the next...
         * @returns {string} SVG markup
         */
        function stripeFor(metric, color, top, slot) {
            var m = METRIC[metric];
            if (!m) { return ''; }
            var off = slot * (STRIPE_H + STRIPE_GAP);
            // Bottom: flush under the zero line — past its 0.7-unit stroke's half.
            var y = top ? PT + off : PB + 0.35 + off;
            var out = '';
            for (var i = 0; i < n - 1; i += 1) {
                var level = stripeLevel(m, i);
                if (!level) { continue; }
                out += previewStripe.cell(isColor, tickX(i), y, pitch, STRIPE_H, color, level,
                    ink.bg, 'sd', STRIPE_UNIT, STRIPE_ORIGIN);
            }
            return out;
        }

        /**
         * One metric line in its selected style — the style dispatch chart.c's
         * chart_render_line does on the watch. Stripes are drawn by the caller (they
         * sit under the bars), so they are not dispatched here.
         * @param {string} metric The metric the colour was resolved for.
         * @param {string} style 'line'|'bold'|'dots'|'x' (lineStyleValue output).
         * @param {string} color Resolved colour (hex).
         * @returns {string} SVG markup
         */
        function seriesFor(metric, style, color) {
            if (isStripe(style)) { return ''; }
            if (style === 'dots') { return barDotsFor(metric, color); }
            if (style === 'x') { return barXFor(metric, color); }
            return lineFor(metric, color, style === 'bold' ? boldW : mainW);
        }

        /**
         * The hi/lo numbers on the graph (left axis BETA, On graph): forecast_layer.c
         * draw_axis_numbers, mirrored. Each sits beside the point it names — the temperature
         * curve's highest and lowest sample or, with scaleNums, the highest and lowest of the
         * curve and every drawn feels-like / dew point line (the curve first, then line order:
         * a strictly higher or lower value replaces, so the earliest wins a tie) — at the
         * point's y, on numberSide's side, held inside the plot's content rows; numbersPart
         * keeps them apart, and equal texts draw one. The outline is an underlay <text> in the
         * background colour stroked 2 units wide (no paint-order: an old WebView ignores it),
         * the watch's 1 px ring in theme_bg.
         * @returns {string} SVG markup.
         */
        function drawNumbersOnGraph() {
            // The candidate series: their samples, their y per sample (null: no point there)
            // and each point's ink edges.
            var cands = [{ vals: temps, x: function (i) { return [tickX(i) - tempW / 2, tickX(i) + tempW / 2]; },
                marks: false }];
            if (scaleNums) {
                LINES.forEach(function (line) {
                    if (!line.on || stylesFrozen || !lineStyle.isTempAxisMetric(line.metric)) { return; }
                    var marks = line.style === 'dots' || line.style === 'x';
                    var w = line.style === 'bold' ? boldW : mainW;
                    cands.push({ vals: AXIS_SAMPLES[line.metric], marks: marks,
                        x: marks ? function (i) { return [gapCenter(i) - bw / 2, gapCenter(i) + bw / 2]; }
                            : function (i) { return [tickX(i) - w / 2, tickX(i) + w / 2]; } });
                });
            }
            var hi = null, lo = null;
            cands.forEach(function (c) {
                // A mark-style line draws its marks in the hour columns, n - 1 of them.
                c.ys = c.vals.map(function (v, i) {
                    return (v === null || (c.marks && i >= n - 1)) ? null : yT(v);
                });
                for (var i = 0; i < c.vals.length; i += 1) {
                    if (c.ys[i] === null) { continue; }
                    if (!hi || c.vals[i] > hi.v) { hi = { v: c.vals[i], i: i, c: c }; }
                    if (!lo || c.vals[i] < lo.v) { lo = { v: c.vals[i], i: i, c: c }; }
                }
            });
            if (!hi) { return ''; }
            var area = numbersArea(PX0, PX1, PTL, PB, ax.outline);
            var hiText = tLabelMax + '°', loText = tLabelMin + '°';
            var wHi = hiText.length * NUMBER_CHAR_W, wLo = loText.length * NUMBER_CHAR_W;
            var hx = hi.c.x(hi.i), lx = lo.c.x(lo.i);
            var hb = numberBeside(hx[0], hx[1], hi.c.ys[hi.i], numberSide(hi.c.ys, hi.i), wHi, area);
            var lb = numberBeside(lx[0], lx[1], lo.c.ys[lo.i], numberSide(lo.c.ys, lo.i), wLo, area);
            var both = bothNumbers(hiText, loText, hb, wHi, lb, wLo, area);
            /**
             * One number, over its outline when the option is on.
             * @param {{x: number, base: number}} b Where (numberBeside).
             * @param {string} t The text.
             * @returns {string} SVG markup.
             */
            function number(b, t) {
                var under = ax.outline
                    ? '<text x="' + b.x + '" y="' + b.base + '" font-size="8" fill="' + ink.bg + '" stroke="' + ink.bg
                        + '" stroke-width="2" stroke-linejoin="round" font-family="sans-serif" font-weight="600" text-anchor="start">'
                        + t + '</text>'
                    : '';
                return under + txt(b.x, b.base, 8, '#AEB4BD', 'start', 600, t);
            }
            return number(hb, hiText) + (both ? number(lb, loText) : '');
        }

        /**
         * A little legend-sized x glyph centred on (cx, cy).
         * @param {number} cx Centre x.
         * @param {number} cy Centre y.
         * @param {string} col Stroke colour (hex).
         * @returns {string} SVG markup
         */
        function legendX(cx, cy, col) {
            var a = 1.8;
            return '<line x1="' + (cx - a) + '" y1="' + (cy - a) + '" x2="' + (cx + a) + '" y2="' + (cy + a) + '" stroke="' + col + '" stroke-width="1.1"></line>'
                + '<line x1="' + (cx - a) + '" y1="' + (cy + a) + '" x2="' + (cx + a) + '" y2="' + (cy - a) + '" stroke="' + col + '" stroke-width="1.1"></line>';
        }
        /**
         * Legend strip below the chart. Lists only the shown series (Temp always; the metric
         * lines that are on; Rain if bars on), each with a glyph in the line's own style.
         * Color watch: hued glyph + label, with a 5-band gradient for Rain. B&W: white style
         * glyphs (thick line / thin line / dots / x / outline box).
         *
         * LAYOUT-FIRST: with three metric lines + Rain the entries can outgrow the
         * 200-unit frame, so the legend wraps onto further rows — and the frame
         * height follows the last row. Positions are computed before any markup so
         * the caller can size the background and viewBox from `height`.
         * @returns {{markup: string, height: number}} Legend markup + total frame height.
         */
        function drawLegend() {
            var LABEL = { precip_prob: 'Precip %', cloud: 'Cloud %', wind: 'Wind', gust: 'Gust', uv: 'UV', pressure: 'Pressure', feels: 'Feels', dew: 'Dew' };
            /**
             * One legend entry, glyph kind chosen by the line's style.
             * @param {string} style 'line'|'bold'|'dots'|'x'|'stripeTop'|'stripeBottom'.
             * @param {string} color Resolved colour (hex).
             * @param {string} label Legend label.
             * @returns {Object} Entry for the loops below.
             */
            function legendEntry(style, color, label) {
                if (isStripe(style)) { return { kind: 'stripe', color: color, label: label }; }
                if (style === 'dots') { return { kind: 'dots', color: color, label: label }; }
                if (style === 'x') { return { kind: 'x', color: color, label: label }; }
                return { kind: 'line', color: color, w: style === 'bold' ? boldW : mainW, label: label };
            }
            var entries = [];
            entries.push({ kind: 'line', color: tempColor, w: tempW, label: 'Temp' });
            for (var li = 0; li < LINES.length; li += 1) {
                if (LINES[li].on) {
                    entries.push(legendEntry(LINES[li].style, LINES[li].color,
                        LABEL[LINES[li].metric] || ''));
                }
            }
            if (state.barSource === 'rain') { entries.push({ kind: 'rain', label: 'Rain' }); }

            // Pass 1 — layout. Same width model the draw pass uses: glyph gw, 3-unit
            // gap, ~4.3 units per label character, 8-unit trailing gap. An entry that
            // would cross the right edge starts the next row (never the first in a
            // row, so an over-long single entry still renders).
            var ROW_H = 10, RIGHT_EDGE = 198, gy0 = AXIS_Y + 18;
            var x = PX0, row = 0, i, en;
            for (i = 0; i < entries.length; i += 1) {
                en = entries[i];
                en.gw = (en.kind === 'rain' && isColor && state.rainBarColor !== 'white')
                    ? P.rainTiers.length * 2.4 + 2 : 14;
                var w = en.gw + 3 + en.label.length * 4.3;
                if (x > PX0 && x + w > RIGHT_EDGE) { x = PX0; row += 1; }
                en.x = x;
                en.gy = gy0 + row * ROW_H;
                x = en.x + w + 8;
            }

            // Pass 2 — markup, at the computed positions.
            var out = '';
            for (i = 0; i < entries.length; i += 1) {
                en = entries[i];
                var ex = en.x, gy = en.gy;
                if (en.kind === 'line') {
                    out += '<line x1="' + ex + '" y1="' + gy + '" x2="' + (ex + 12) + '" y2="' + gy + '" stroke="' + en.color + '" stroke-width="' + en.w + '" stroke-linecap="round"></line>';
                } else if (en.kind === 'dots') {
                    out += rect(ex + 1, gy - 1.6, 3.2, 3.2, en.color) + rect(ex + 8, gy - 1.6, 3.2, 3.2, en.color);
                } else if (en.kind === 'x') {
                    out += legendX(ex + 2.6, gy, en.color) + legendX(ex + 9.6, gy, en.color);
                } else if (en.kind === 'stripe') {
                    // The ramp itself, weakest to strongest: what the cells mean.
                    for (var sl = 1; sl <= 4; sl += 1) {
                        out += previewStripe.cell(isColor, ex + (sl - 1) * 3, gy - 2, 3, 4,
                            en.color, sl, ink.bg, 'sd', STRIPE_UNIT, STRIPE_ORIGIN);
                    }
                } else if (isColor && state.rainBarColor !== 'white') {
                    for (var k = 0; k < P.rainTiers.length; k += 1) {
                        out += rect(ex + k * 2.4, gy - 3.5, 2.4, 7, P.rainTiers[k].color);
                    }
                } else if (isColor) {
                    // colour + Solid bars: a solid swatch, matching the solid bars (dims to
                    // DarkGray in the light theme, like the bars themselves — see barFg)
                    out += rect(ex, gy - 3.5, 12, 7, barFg);
                } else {
                    // B&W: outline box, matching the outlined silhouette bars
                    out += '<rect x="' + ex + '" y="' + (gy - 3.5) + '" width="12" height="7" fill="none" stroke="' + ink.fg + '" stroke-width="1"></rect>';
                }
                out += txt(ex + en.gw + 3, en.gy + 3, 7.5, '#AEB4BD', 'start', 600, en.label);
            }
            return { markup: out, height: gy0 + row * ROW_H + 6 };
        }

        /**
         * The four B&W stripe dither densities as 2x2 SVG patterns (`sd1`..`sd4`) —
         * chart.c's chart_stripe_dither_on: one pixel in four, a checkerboard, three
         * in four, solid. Only emitted when a B&W render actually draws a stripe.
         * @returns {string} SVG pattern defs, or ''.
         */
        function stripeDitherDefs() {
            var used = false;
            for (var k = 0; k < LINES.length; k += 1) {
                if (LINES[k].on && isStripe(LINES[k].style)) { used = true; }
            }
            if (isColor || !used) { return ''; }
            return previewStripe.ditherDefs(ink.fg, 'sd');
        }

        // The night clip is the one conditional def: it exists only when there is a tint
        // to clip. The hatch pattern is unconditional — its stroke, not its presence,
        // carries the night colour.
        var nightTint = nightFillTint();
        // Legend layout runs first: its row count sets the frame height, which the
        // background rect below needs before any chart markup is emitted.
        var legend = drawLegend();
        var e = '';
        e += rect(0, 0, 200, legend.height, ink.bg);
        e += '<defs>'
            + '<pattern id="nh" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="4" stroke="' + nightHatchStroke + '" stroke-width="0.7"></line></pattern>'
            + stripeDitherDefs()
            + '<pattern id="fillhatch" width="2" height="2" patternUnits="userSpaceOnUse"><rect width="1" height="1" fill="' + ink.rgba('0.55') + '" shape-rendering="crispEdges"></rect><rect x="1" y="1" width="1" height="1" fill="' + ink.rgba('0.55') + '" shape-rendering="crispEdges"></rect></pattern>'
            + (nightTint
                ? '<clipPath id="nightclip"><rect x="' + n0 + '" y="' + PTL + '" width="' + (n1 - n0) + '" height="' + (PB - PTL) + '"></rect></clipPath>'
                : '')
            + '</defs>';
        e += drawNightShading();
        e += '<line x1="' + PX0 + '" y1="' + PB + '" x2="' + PX1 + '" y2="' + PB + '" stroke="' + ink.rgba('0.20') + '" stroke-width="0.7"></line>';
        // Z-order matches forecast_layer.c: AREA fill, then BARS, then the LINE strokes —
        // so the bars paint over the (possibly dithered) area fill, and the lines paint over
        // the bars. See areaFillFor()'s doc comment.
        e += areaFillFor(state.secondaryLine);
        // The night tint sits on top of the day fill and under the bars — the watch's
        // night-area underlay, which re-shades the filled area during the night hours.
        e += nightTint;
        // Stripes: in their own band above the plot (top), over the night shading that
        // runs up through it — each cell that draws covers it — or in their own band
        // below the zero line (bottom) — forecast_layer.c's CHART_LAYER_STRIPE slots.
        // Stacked per edge in line order.
        var stripeSlots = { top: 0, bottom: 0 };
        for (var si = 0; si < LINES.length; si += 1) {
            if (LINES[si].drawn && isStripe(LINES[si].style)) {
                var sTop = LINES[si].style === 'stripeTop';
                e += stripeFor(LINES[si].metric, LINES[si].color, sTop,
                    stripeSlots[sTop ? 'top' : 'bottom']++);
            }
        }
        if (state.barSource === 'rain') {
            // White (or theme-flipped) when the setting says so OR effectively-B&W. The watch
            // draws every one of these bars BAR_OUTLINED: B&W as a theme_bg()-filled
            // silhouette, colour-light as the palette/Solid interior with the theme_fg()
            // silhouette over it (barEdge), colour-dark with no outline at all.
            var rainWhite = state.rainBarColor === 'white' || !isColor;
            // Bars from: Top hangs them from the plot's top (PTL: under a top stripe band),
            // the way the watch anchors them under its content's top row.
            var barsTop = drawFrom.barsFromTop(state, 'rain', env);
            for (var i = 0; i < n - 1; i += 1) {
                e += rainBars(rain[i], gapCenter(i) - bw / 2, bw, barsTop ? PTL : PB, plotH, rainWhite,
                    P.rainTiers, !isColor, barFg, ink.bg, barEdge, barsTop);
            }
        }
        for (var li = 0; li < LINES.length; li += 1) {
            if (LINES[li].on) {
                e += seriesFor(LINES[li].metric, LINES[li].style, LINES[li].color);
            }
        }
        e += drawTempCurve();
        // No status chrome (location / sunset / current-temp pill): the preview doesn't model it.
        // Hi/lo labels are the ACTUAL temperature range (TEMP_MIN/TEMP_MAX on the
        // wire), never the joint band the phone encodes on — the watch prints them as
        // text (forecast_layer.c text_labels_refresh) and a low the air never reached
        // would be a lie. Its curve fills the margins unless a feels-like or dew point line
        // reaches past it (yT). The one exception is emery's left axis option 'Include
        // feels-like & dew point' (scaleNums): then they name the scale's ends, which the
        // bake puts in TEMP_MIN/TEMP_MAX.
        // Where they go is the left axis option (BETA, ax.numbers): beside the graph (today),
        // on it (drawNumbersOnGraph) or nowhere.
        // Beside: where there is space each label's ink sits level with the curve's extreme
        // it names (alignLabels; never previewing aplite, whose labels are frozen). Today's
        // reach gates the lo label always and the hi label only without a top stripe band:
        // under one the watch's plain rule applies (see alignLabels).
        if (ax.numbers === forecastAxis.BESIDE) {
            var labels = stylesFrozen ? { hi: PT + 11, lo: PB - 1 }
                : alignLabels(PT + 11, PB - 1, yT(tLabelMax), yT(tLabelMin),
                    topBand ? -Infinity : MT + curveInsetPrev, PB - curveInsetPrev);
            e += txt(3, labels.hi, 8, '#AEB4BD', 'start', 600, tLabelMax + '°') + txt(3, labels.lo, 8, '#AEB4BD', 'start', 600, tLabelMin + '°');
        } else if (ax.numbers === forecastAxis.GRAPH) {
            e += drawNumbersOnGraph();
        }
        e += drawAxis();
        e += legend.markup;
        return svgFrame(e, legend.height);
    }

    PConf.blocks.register('forecastPreview', forecastPreview);

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = {
            forecastPreview: forecastPreview,
            TEMP_AXIS_PAD_SQ_DIV: TEMP_AXIS_PAD_SQ_DIV,
            TEMP_LABEL_MIN_INK_GAP: TEMP_LABEL_MIN_INK_GAP,
            WATCH_INSET_PX: WATCH_INSET_PX,
            LABEL_CAP: LABEL_CAP,
            CURVE_INSET_PREV: CURVE_INSET_PREV,
            TEMP_LABEL_POINT_GAP: TEMP_LABEL_POINT_GAP,
            TEMP_LABEL_PART_GAP: TEMP_LABEL_PART_GAP,
            PX0_COLLAPSED: PX0_COLLAPSED,
            NUMBER_CHAR_W: NUMBER_CHAR_W,
            numberSide: numberSide,
            numberBeside: numberBeside,
            numbersPart: numbersPart,
            numbersArea: numbersArea,
            bothNumbers: bothNumbers,
            anchorShare: anchorShare,
            alignLabels: alignLabels,
            tempAxisRange: tempAxisRange,
            alertSamples: alertSamples,
            pressureCurves: PRESSURE_CURVES,
            lineRuns: lineRuns
        };
    }
})();
