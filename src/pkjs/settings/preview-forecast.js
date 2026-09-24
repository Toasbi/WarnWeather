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
     * @returns {string} SVG path data ('' for fewer than two points).
     */
    function smooth(pts) {
        if (pts.length < 2) { return ''; }
        var d = 'M' + pts[0][0] + ',' + pts[0][1];
        for (var i = 0; i < pts.length - 1; i++) {
            var p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
            d += ' C' + (p1[0] + (p2[0] - p0[0]) / 6) + ',' + (p1[1] + (p2[1] - p0[1]) / 6) + ' ' + (p2[0] - (p3[0] - p1[0]) / 6) + ',' + (p2[1] - (p3[1] - p1[1]) / 6) + ' ' + p2[0] + ',' + p2[1];
        }
        return d;
    }

    /**
     * Split [x, y] vertices on null-y gaps into contiguous runs — the preview
     * half of chart_runs.h's chart_next_run (host-pinned by
     * test/c/chart_absent_test.c; this side by test/config-blocks.test.js).
     * A lone vertex stays its own run: the caller draws chart_render_line's
     * run == 1 small square for it.
     * @param {Array.<Array.<?number>>} pts [x, y|null] vertices in draw order.
     * @returns {Array.<Array.<Array.<number>>>} Runs of gap-free vertices.
     */
    function splitRuns(pts) {
        var runs = [], run = [];
        for (var i = 0; i < pts.length; i += 1) {
            if (pts[i][1] === null) {
                if (run.length) { runs.push(run); run = []; }
            } else {
                run.push(pts[i]);
            }
        }
        if (run.length) { runs.push(run); }
        return runs;
    }

    /**
     * Is this line style one of the two stripes?
     * @param {string} style lineStyleValue output.
     * @returns {boolean} True for 'stripeTop' / 'stripeBottom'.
     */
    function isStripe(style) {
        return style === 'stripeTop' || style === 'stripeBottom';
    }

    // Mirrors forecast-series.PRESSURE_SCALE_CURVE_HPA (+ curvePermille); a drift
    // test keeps the curves equal. Duplicated rather than imported because this file
    // is bundled into the config page, which has no access to the watch modules
    // (same reason windMax below restates WIND_SCALE_KMH).
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
        // The graph's colours, resolved by the SAME function that packs the watch's
        // Clay wire (line-style.resolveLineStyle is the watchInfo adapter over this one)
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
        // Tracks temps a few degrees under (wind chill through the shower + the
        // breezy night) — the gap between the two curves is the story it tells.
        var feels  = [21, 21, 19, 17, 15, 13, 12, 11, 11, 12, 15, 17];
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
         * watch without WW_LINE_STYLE, else the stored pick (or its default).
         * @param {string} styleKey secondaryLineStyle|thirdLineStyle|fourthLineStyle.
         * @returns {string} 'line'|'bold'|'dots'|'x'|'stripeTop'|'stripeBottom'.
         */
        function styleFor(styleKey) {
            return stylesFrozen ? lineStyle.LINE_STYLE_DEFAULTS[styleKey]
                : lineStyle.lineStyleValue(state, styleKey);
        }
        // The ordered metric lines, modelled ONCE for the draw pass and the
        // legend: colours off the resolver, styles off the pickers, on-gates
        // from line-style.js' effectiveLineMetric — the same off/duplicate/ban
        // rules the bake applies, so the preview matches the watch by
        // construction. Entries are named by the settings keys they read (the
        // one frozen vocabulary); the UI ordinals ("Third metric") are labels only.
        var LINES = [
            { metric: state.secondaryLine, on: true,
              style: styleFor('secondaryLineStyle'), color: hexColor(gc.secondary) },
            { metric: state.thirdLine,
              on: Boolean(lineStyle.effectiveLineMetric(state, 'thirdLine')),
              style: styleFor('thirdLineStyle'), color: hexColor(gc.third) },
            { metric: state.fourthLine,
              on: !stylesFrozen && Boolean(lineStyle.effectiveLineMetric(state, 'fourthLine')),
              style: styleFor('fourthLineStyle'), color: hexColor(gc.fourth) },
            { metric: state.fifthLine,
              on: !stylesFrozen && Boolean(lineStyle.effectiveLineMetric(state, 'fifthLine')),
              style: styleFor('fifthLineStyle'), color: hexColor(gc.fifth) }
        ];
        // Bottom stripes sit BELOW the plot's zero line, in their own band above the
        // hour axis (forecast_layer.c's stripe_band): the first flush under the zero
        // line, further ones 1 unit apart, and one free row over the ticks. The
        // plot's baseline PB lifts by it; AXIS_Y is where the ticks and labels hang.
        var STRIPE_H = 5, STRIPE_GAP = 1;
        var bottomStripes = 0;
        for (var bs = 0; bs < LINES.length; bs += 1) {
            if (LINES[bs].on && LINES[bs].style === 'stripeBottom') { bottomStripes += 1; }
        }
        var AXIS_Y = 94;
        var stripeBand = bottomStripes
            ? bottomStripes * STRIPE_H + (bottomStripes - 1) * STRIPE_GAP + 1 : 0;
        var n = temps.length, PX0 = 20, PX1 = 197, PT = 4, PB = AXIS_Y - stripeBand;
        var plotW = PX1 - PX0, plotH = PB - PT;
        // One watch-faithful slot grid (chart.c): N hourly slots, one tick per slot. Slot 0 is
        // 12:00; hour = 12 + i. Line vertices sit ON the ticks (so a line spans the first tick to
        // the last), and rain bars / second-metric dots sit centred in the hour COLUMN between two
        // ticks — exactly how chart_render_line vs chart_render_bars place them on the watch.
        var pitch = plotW / (n - 1);
        var tickX = function (i) { return PX0 + i * pitch; };              // line vertex / hour tick x
        var gapCenter = function (i) { return PX0 + (i + 0.5) * pitch; };  // bar / dot column centre
        // Joint temp∪feels axis (mirrors forecast-series.applyForecastSeries): with
        // feels on either line both curves rescale against the union band so the gap
        // between them is real, and the band is padded on whichever side feels
        // overshoots the temperature so that curve lands clear of the plot edge
        // instead of flat against it (FEELS_EDGE_CLEARANCE_PERMILLE = 40 ‰ there —
        // pad = ceil(span * 40/960)). The hi/lo LABELS are not this band: they stay
        // the actual temperature range, which is why tmin/tmax and tLabelMin/Max part
        // company here.
        var feelsOn = state.secondaryLine === 'feels' || state.thirdLine === 'feels';
        var tLabelMin = Math.min.apply(null, temps), tLabelMax = Math.max.apply(null, temps);
        var tmin = tLabelMin, tmax = tLabelMax;
        if (feelsOn) {
            var jMin = Math.min(tmin, Math.min.apply(null, feels));
            var jMax = Math.max(tmax, Math.max.apply(null, feels));
            var jPad = Math.max(1, Math.ceil((jMax - jMin) * 40 / 960));
            tmin = jMin < tLabelMin ? jMin - jPad : jMin;
            tmax = jMax > tLabelMax ? jMax + jPad : jMax;
        }
        // Configurable curve offset: the temp axis (temp + feels via tempAxis
        // below) is inset symmetrically from the shared full-height band
        // ([PT+3 .. PB], the mapping every other metric uses), mirroring the
        // watch's per-series inset_y (fixed 7 px — not a user setting). Scale:
        // the preview band (87 units) is taller than the watch plot; 7 watch px
        // = the preview's long-standing 12-unit bottom clearance over the axis
        // row (the top gains the same symmetric margin the watch actually draws).
        var curveInsetPrev = 12;
        var ytop = PT + 3 + curveInsetPrev, ybot = PB - curveInsetPrev;
        var yT = function (t) { return ybot - (t - tmin) / (tmax - tmin || 1) * (ybot - ytop); };
        var n0 = tickX(9), n1 = tickX(n - 1);       // night band: sunset 21:00 (slot 9) -> right edge
        var bw = 9;                                  // rain-bar / dot width

        var windMax = state.windScale === 'low' ? 30 : (state.windScale === 'high' ? 70 : 50);
        var pCurve = PRESSURE_CURVES[state.pressureScale] || PRESSURE_CURVES.mid;
        // metric -> { sample series, full-scale max, fill? }. Color resolves per render.
        // Only pressure sets `min` (a non-zero floor); every other metric defaults to 0.
        // feels has neither: it rides the shared temperature axis (tempAxis), so it
        // maps through yT like the temp curve instead of a 0..max scale.
        var METRIC = {
            precip_prob: { vals: precip, max: 100, fill: true },
            cloud: { vals: cloud, max: 100 },
            wind: { vals: wind, max: windMax },
            gust: { vals: gust, max: windMax },
            uv: { vals: uv, max: 11 },
            pressure: { vals: pressure, curve: pCurve },
            feels: { vals: feels, tempAxis: true }
        };
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
         * One metric value's y in column/tick i — THE value→y mapping. The line
         * vertices, the bar-aligned marks (both skipZero true: a zero-based
         * metric's zero is genuinely "no data" and returns null, mirroring the
         * watch's zero_absent metric-line layers) and the area fill (skipZero
         * false: the fill's contour drops to the baseline over the gaps, like
         * chart_render_area's h = 0) all share it. Feels rides the
         * shared temperature axis (joint band via yT — a temperature has no
         * skippable zero, never a 0..max scale); pressure's piecewise absolute
         * curve draws EVERY reading — a deep low off the visible band is real
         * data clamped to the baseline, never a skippable zero, mirroring
         * forecast-series.pressurePermille's floor-clamp so the preview and
         * the watch don't diverge.
         * @param {Object} m METRIC entry.
         * @param {number} i Sample index.
         * @param {boolean} skipZero Null out a zero-based metric's zero.
         * @returns {?number} y, or null to skip the sample.
         */
        function metricY(m, i, skipZero) {
            if (m.tempAxis) { return yT(m.vals[i]); }
            var pm;
            if (m.curve) {
                pm = pressureCurvePermille(m.vals[i], m.curve) / 1000;
            } else {
                var v = Math.min(m.vals[i], m.max);
                if (skipZero && v <= 0) { return null; }
                if (v < 0) { v = 0; }
                pm = v / m.max;
            }
            return PB - pm * (PB - PT - 3);
        }
        // Vertex computation for the main-metric FILL contour (the stroke gaps its
        // zeros in lineFor instead): one point per sample, vertices on the hour
        // ticks, zeros at the baseline. Returns null for an unknown metric or
        // fewer than 2 points (nothing to draw).
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
         * @param {string} metric precip_prob|wind|gust|uv|pressure|feels
         * @returns {?string} SVG path data, or null when the metric has no curve.
         */
        function areaPathFor(metric) {
            var pts = metricPoints(metric);
            if (!pts) { return null; }
            return smooth(pts) + ' L' + pts[pts.length - 1][0] + ',' + PB + ' L' + pts[0][0] + ',' + PB + ' Z';
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
         * metric's zeros draw nothing (metricY skipZero — the metric lines'
         * zero_absent flag in chart.c), so the stroke breaks into one path per
         * contiguous run of non-zero samples; a lone sample between gaps becomes a
         * small stroke-width square, mirroring chart_render_line's run == 1 arm.
         * Band-scaled metrics (pressure, feels) never null, so they stay one path.
         * The fill (if any) is drawn separately by areaFillFor() — see its doc
         * comment for why.
         * @param {string} metric The metric the colour was resolved for.
         * @param {string} color Resolved stroke colour (hex).
         * @param {number} w Stroke width (mainW for 'line', boldW for 'bold').
         * @returns {string} SVG markup
         */
        var lineFor = function (metric, color, w) {
            var m = METRIC[metric];
            if (!m) { return ''; }
            var pts = [];
            for (var i = 0; i < m.vals.length; i += 1) {
                pts.push([tickX(i), metricY(m, i, true)]);
            }
            var runs = splitRuns(pts), out = '';
            for (var r = 0; r < runs.length; r += 1) {
                var run = runs[r];
                if (run.length >= 2) {
                    out += '<path d="' + smooth(run) + '" fill="none" stroke="' + color + '" stroke-width="' + w + '"></path>';
                } else {
                    // Lone reading between gaps: chart_render_line's run == 1
                    // small square. The fixed demo series never produce a lone
                    // run, so this arm is pinned via splitRuns (below) and the
                    // C kernel's run == 1 case (test/c/chart_absent_test.c).
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
         * A metric value's stripe level, 0..4: the watch's chart_stripe_level on the
         * wire byte (0..250), so a cell shades exactly where the watch's does.
         * @param {Object} m METRIC entry.
         * @param {number} i Sample index.
         * @returns {number} 0 (draws nothing) .. 4 (full colour).
         */
        function stripeLevel(m, i) {
            var y = metricY(m, i, true);
            if (y === null) { return 0; }
            var b = Math.round((PB - y) / (PB - PT - 3) * 250);
            return previewStripe.levelOfByte(b);
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
            if (!m || m.tempAxis) { return ''; }
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
            var LABEL = { precip_prob: 'Precip %', cloud: 'Cloud %', wind: 'Wind', gust: 'Gust', uv: 'UV', pressure: 'Pressure', feels: 'Feels' };
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
                ? '<clipPath id="nightclip"><rect x="' + n0 + '" y="' + PT + '" width="' + (n1 - n0) + '" height="' + (PB - PT) + '"></rect></clipPath>'
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
        // Stripes: over the fill and night band, under the bars and the lines (top),
        // or in their own band below the zero line (bottom) — forecast_layer.c's
        // CHART_LAYER_STRIPE slots. Stacked per edge in line order.
        var stripeSlots = { top: 0, bottom: 0 };
        for (var si = 0; si < LINES.length; si += 1) {
            if (LINES[si].on && isStripe(LINES[si].style)) {
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
            for (var i = 0; i < n - 1; i += 1) {
                e += rainBars(rain[i], gapCenter(i) - bw / 2, bw, PB, plotH, rainWhite, P.rainTiers, !isColor, barFg, ink.bg, barEdge);
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
        // wire), never the padded scaling band — the watch prints them as text
        // (forecast_layer.c text_labels_refresh) and a low the air never reached
        // would be a lie. With feels off the two are identical.
        e += txt(3, PT + 11, 8, '#AEB4BD', 'start', 600, tLabelMax + '°') + txt(3, PB - 1, 8, '#AEB4BD', 'start', 600, tLabelMin + '°');
        e += drawAxis();
        e += legend.markup;
        return svgFrame(e, legend.height);
    }

    PConf.blocks.register('forecastPreview', forecastPreview);

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = {
            forecastPreview: forecastPreview,
            pressureCurves: PRESSURE_CURVES,
            splitRuns: splitRuns
        };
    }
})();
