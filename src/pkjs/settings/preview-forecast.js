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
     * The forecast-graph preview block: temp curve, main metric line (optionally
     * filled), second metric as bar-aligned squares, rain bars, night band, axis and
     * legend — the same z-order and geometry rules forecast_layer.c draws with.
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
        var caps = { color: !(env && !env.color), themePolarity: true };
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

        var n = temps.length, PX0 = 20, PX1 = 197, PT = 4, PB = 100;
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
        // the preview band (93 units) is taller than the watch plot; 7 watch px
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
            wind: { vals: wind, max: windMax },
            gust: { vals: gust, max: windMax },
            uv: { vals: uv, max: 11 },
            pressure: { vals: pressure, curve: pCurve },
            feels: { vals: feels, tempAxis: true }
        };
        // The three graph strokes, as SVG colours. Every rule that used to be restated
        // here — the effective-colour gate, the per-polarity colours, gust's coupling to
        // the rain bars and the B&W arm's exactly-white→black readability flip — lives in
        // line-style.js and reaches the preview through `gc`.
        // mainColor is the secondary line (and its area fill), dotColor the second
        // metric's squares; the resolver keys them off state.secondaryLine/state.thirdLine,
        // which is exactly how they are drawn below.
        var mainColor = hexColor(gc.secondary);
        var dotColor = hexColor(gc.third);
        var mainFill = hexColor(gc.fill);
        var tempColor = isColor ? P.temp : ink.fg;
        var tempW = isColor ? 2.2 : 3;               // B&W: thick temp vs thin main line
        var mainW = isColor ? 1.6 : 1;

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
            // big_every = 3). Hour = 12 + i (mod 24): 12, 15, 18, 21 over the noon→23:00 window.
            var out = '';
            for (var i = 0; i < n; i += 1) {
                var big = i % 3 === 0;
                out += '<line x1="' + tickX(i) + '" y1="' + PB + '" x2="' + tickX(i) + '" y2="' + (PB + (big ? 4 : 2)) + '" stroke="' + ink.rgba('0.32') + '" stroke-width="0.6"></line>';
                if (big) { out += txt(tickX(i), 111, 7.5, '#7C828D', 'middle', 600, String((12 + i) % 24)); }
            }
            return out;
        }
        // Shared vertex computation for the main-metric line/fill: one point per sample,
        // vertices on the hour ticks. Zero values stay in the series at the baseline
        // (matching the watch's chart_render_line) rather than breaking it. Returns null
        // for an unknown metric or fewer than 2 points (nothing to draw).
        function metricPoints(metric) {
            var m = METRIC[metric];
            if (!m) { return null; }
            var pts = [];
            for (var i = 0; i < m.vals.length; i += 1) {
                var pm;
                if (m.tempAxis) {
                    // Feels-like: the shared temperature axis (joint band via yT),
                    // pixel-aligned with the temp curve — never a 0..max scale.
                    pts.push([tickX(i), yT(m.vals[i])]);
                    continue;
                }
                if (m.curve) {
                    // Pressure: the piecewise absolute curve (mirrors pressurePermille).
                    pm = pressureCurvePermille(m.vals[i], m.curve) / 1000;
                } else {
                    var v = Math.min(m.vals[i], m.max);
                    if (v < 0) { v = 0; }
                    pm = v / m.max;
                }
                pts.push([tickX(i), PB - pm * (PB - PT - 3)]);
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
         * Main metric: one continuous line whose vertices sit on the hour ticks, so it spans the
         * first tick to the last. The fill (if any) is drawn separately by areaFillFor() — see
         * its doc comment for why.
         * @param {string} metric The main metric — state.secondaryLine, which is the
         *   metric mainColor was resolved for.
         * @returns {string} SVG markup
         */
        var lineFor = function (metric) {
            var pts = metricPoints(metric);
            if (!pts) { return ''; }
            var d = smooth(pts);
            return '<path d="' + d + '" fill="none" stroke="' + mainColor + '" stroke-width="' + mainW + '"></path>';
        };
        /**
         * Second metric: bar-aligned squares centred in the hour column (same columns as the rain
         * bars). For a zero-based metric (min defaults to 0) a value of 0 is genuinely "no data"
         * and is skipped, mirroring the watch's bar-dots. Pressure is the one metric with a
         * non-zero `min` (its band floor): a reading at or below it is real data (e.g. a deep
         * low off the visible band), not an absent hour, so it's clamped to the baseline and
         * drawn instead of skipped — mirrors forecast-series.pressurePermille's floor-clamp so
         * the preview and the watch don't diverge.
         * @param {string} metric The second metric — state.thirdLine, which is the
         *   metric dotColor was resolved for.
         * @returns {string} SVG markup
         */
        var barDotsFor = function (metric) {
            var m = METRIC[metric];
            if (!m) { return ''; }
            var col = dotColor;
            // Mirrors chart.c's dot cap: achromatic dots (theme foreground or either
            // gray) read heavier than a hue at the same size, so they get the short
            // cap; hued dots keep the tall one. Preview units, not watch px.
            var dh = (isColor && (col === ink.fg || col === '#AAAAAA' || col === '#555555'))
                ? 3 : 4;
            var out = '';
            for (var i = 0; i < n - 1; i += 1) {
                var pm, cy;
                if (m.tempAxis) {
                    // Feels-like: every reading is real data on the shared temp axis
                    // (a temperature has no skippable zero), mapped through yT.
                    cy = yT(m.vals[i]);
                } else if (m.curve) {
                    // Pressure: the piecewise absolute curve draws EVERY reading (a
                    // deep low is real data, never a skippable zero).
                    pm = pressureCurvePermille(m.vals[i], m.curve) / 1000;
                    cy = PB - pm * (PB - PT - 3);
                } else {
                    var v = Math.min(m.vals[i], m.max);
                    if (v <= 0) { continue; }   // zero-based metric: genuine zero, skip
                    pm = v / m.max;
                    cy = PB - pm * (PB - PT - 3);
                }
                out += rect(gapCenter(i) - bw / 2, cy - dh / 2, bw, dh, col);
            }
            return out;
        };

        /**
         * Legend strip below the chart. Lists only the shown series (Temp always; main metric;
         * second metric if on; Rain if bars on). Color watch: hued glyph + label, with a 5-band
         * gradient for Rain. B&W: white style glyphs (thick line / thin line / dots / outline box).
         * @returns {string} SVG markup
         */
        function drawLegend() {
            var LABEL = { precip_prob: 'Precip %', wind: 'Wind', gust: 'Gust', uv: 'UV', pressure: 'Pressure', feels: 'Feels' };
            var entries = [];
            entries.push({ kind: 'line', color: tempColor, w: tempW, label: 'Temp' });
            entries.push({ kind: 'line', color: mainColor, w: mainW, label: LABEL[state.secondaryLine] || '' });
            if (state.thirdLine && state.thirdLine !== 'off' && state.thirdLine !== state.secondaryLine) {
                entries.push({ kind: 'dots', color: dotColor, label: LABEL[state.thirdLine] || '' });
            }
            if (state.barSource === 'rain') { entries.push({ kind: 'rain', label: 'Rain' }); }

            var gy = 118, ty = 121, out = '', x = PX0;
            for (var i = 0; i < entries.length; i += 1) {
                var en = entries[i], gw = 14;
                if (en.kind === 'line') {
                    out += '<line x1="' + x + '" y1="' + gy + '" x2="' + (x + 12) + '" y2="' + gy + '" stroke="' + en.color + '" stroke-width="' + en.w + '" stroke-linecap="round"></line>';
                } else if (en.kind === 'dots') {
                    out += rect(x + 1, gy - 1.6, 3.2, 3.2, en.color) + rect(x + 8, gy - 1.6, 3.2, 3.2, en.color);
                } else if (isColor && state.rainBarColor !== 'white') {
                    for (var k = 0; k < P.rainTiers.length; k += 1) {
                        out += rect(x + k * 2.4, gy - 3.5, 2.4, 7, P.rainTiers[k].color);
                    }
                    gw = P.rainTiers.length * 2.4 + 2;
                } else if (isColor) {
                    // colour + Solid bars: a solid swatch, matching the solid bars (dims to
                    // DarkGray in the light theme, like the bars themselves — see barFg)
                    out += rect(x, gy - 3.5, 12, 7, barFg);
                } else {
                    // B&W: outline box, matching the outlined silhouette bars
                    out += '<rect x="' + x + '" y="' + (gy - 3.5) + '" width="12" height="7" fill="none" stroke="' + ink.fg + '" stroke-width="1"></rect>';
                }
                var lx = x + gw + 3;
                out += txt(lx, ty, 7.5, '#AEB4BD', 'start', 600, en.label);
                x = lx + en.label.length * 4.3 + 8;
            }
            return out;
        }

        // The night clip is the one conditional def: it exists only when there is a tint
        // to clip. The hatch pattern is unconditional — its stroke, not its presence,
        // carries the night colour.
        var nightTint = nightFillTint();
        var e = '';
        e += rect(0, 0, 200, 124, ink.bg);
        e += '<defs>'
            + '<pattern id="nh" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="4" stroke="' + nightHatchStroke + '" stroke-width="0.7"></line></pattern>'
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
        if (state.barSource === 'rain') {
            // White (or theme-flipped) when the setting says so OR effectively-B&W. B&W draws
            // the outlined silhouette (BAR_OUTLINED); colour-white draws a solid bar
            // (BAR_SOLID) — matching the watch.
            var rainWhite = state.rainBarColor === 'white' || !isColor;
            for (var i = 0; i < n - 1; i += 1) {
                e += rainBars(rain[i], gapCenter(i) - bw / 2, bw, PB, plotH, rainWhite, P.rainTiers, !isColor, barFg, ink.bg);
            }
        }
        e += lineFor(state.secondaryLine);
        if (state.thirdLine && state.thirdLine !== 'off' && state.thirdLine !== state.secondaryLine) {
            e += barDotsFor(state.thirdLine);
        }
        e += drawTempCurve();
        // No status chrome (location / sunset / current-temp pill): the preview doesn't model it.
        // Hi/lo labels are the ACTUAL temperature range (TEMP_MIN/TEMP_MAX on the
        // wire), never the padded scaling band — the watch prints them as text
        // (forecast_layer.c text_labels_refresh) and a low the air never reached
        // would be a lie. With feels off the two are identical.
        e += txt(3, PT + 11, 8, '#AEB4BD', 'start', 600, tLabelMax + '°') + txt(3, PB - 1, 8, '#AEB4BD', 'start', 600, tLabelMin + '°');
        e += drawAxis();
        e += drawLegend();
        return svgFrame(e, 124);
    }

    PConf.blocks.register('forecastPreview', forecastPreview);

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = {
            forecastPreview: forecastPreview,
            pressureCurves: PRESSURE_CURVES
        };
    }
})();
