// src/pkjs/settings/blocks.js — ES5, WebView. Registers WarnWeather's custom blocks.
// Each block: function(state, env, userData) -> htmlString
/* global PConf, VIEW_CYCLE */
var PConf = (typeof global !== 'undefined' && global.PConf) ? global.PConf
    : (typeof window !== 'undefined' && window.PConf) ? window.PConf
    : (typeof PConf !== 'undefined' && PConf) ? PConf
    : { blocks: { register: function () {}, get: function () {} } };
(function () {
    // Node (tests/build tooling): view-cycle.js is a real CommonJS module, require it.
    // Webview: view-cycle.js is concatenated as a plain <script> before this file (see
    // scripts/build-config-page.js), which has no require(). It exposes its whole API as
    // one top-level VIEW_CYCLE object sharing this scope — read that directly. Matches how
    // this file already resolves PConf (see above): one name, no hand-copied export list.
    var VC = (typeof require !== 'undefined') ? require('../view-cycle.js') : VIEW_CYCLE;

    function parseStoredJson(v) {
        if (v === null || typeof v === 'undefined') { return null; }
        try { return JSON.parse(v); } catch (e) { return null; }
    }

    /* ---- pure SVG helpers (verbatim from index.html:197-228) ---------------- */

    // Fallback palette — used only if userData.palette wasn't injected (stale page). Kept in
    // lockstep with preview-palette.buildPreviewPalette() by a test, so it cannot drift.
    // Shape mirrors preview-palette.buildPreviewPalette(): per-metric line + fill colours, each
    // with a colour-display value and a B&W value, all sourced from forecast-series so the preview
    // can't diverge from the watch payload. gust has no fixed hue (resolved off the rain bars).
    var FALLBACK_PALETTE = {
        temp: '#FF0000',
        white: '#FFFFFF',
        line: {
            precip_prob: { color: '#55AAFF', bw: '#FFFFFF' },
            wind:        { color: '#FFFF00', bw: '#FFFFFF' },
            uv:          { color: '#FF00FF', bw: '#FFFFFF' },
            gust:        { colorMulti: '#FFFFFF', colorWhiteBars: '#AAAAAA', bw: '#FFFFFF' }
        },
        fill: {
            precip_prob: { color: '#0055AA', bw: '#AAAAAA' },
            wind:        { color: '#555500', bw: '#AAAAAA' },
            uv:          { color: '#AA00AA', bw: '#AAAAAA' },
            gust:        { color: '#555555', bw: '#AAAAAA' }
        },
        rainTiers: [
            { from: 0, color: '#AAAAAA' },
            { from: 140, color: '#55FFFF' },
            { from: 340, color: '#00FF00' },
            { from: 560, color: '#FFFF00' },
            { from: 780, color: '#FF5555' }
        ]
    };

    // Port of rain-tier.rainPermille (and its helpers). The watch builds bar heights with this
    // exact curve; the webview can't require() rain-tier, so it is mirrored here and guarded by
    // test/config-blocks.test.js ('barPermille matches rain-tier.rainPermille byte-for-byte').
    // Input is wire tenths (mm * 10); output is permille (0..1000) of plot height.
    var TIER_MAX_TENTHS = [1, 5, 20, 100];
    var TIER_TOP_PCT = [0, 14, 34, 56, 78, 100];
    function tierOfTenths(tenths) {
        if (tenths <= 0) { return 0; }
        for (var i = 0; i < TIER_MAX_TENTHS.length; i += 1) {
            if (tenths <= TIER_MAX_TENTHS[i]) { return i + 1; }
        }
        return 5;
    }
    function fillQ8(tenths, tier) {
        var low, high;
        switch (tier) {
            case 1: return 256;
            case 2: low = 2; high = 5; break;
            case 3: low = 6; high = 20; break;
            case 4: low = 21; high = 100; break;
            case 5: low = 101; high = 255; break;
            default: return 256;
        }
        if (tenths >= high) { return 256; }
        if (tenths <= low) { return 0; }
        return Math.trunc(((tenths - low) * 256) / (high - low));
    }
    function barPermille(tenths) {
        if (tenths <= 0) { return 0; }
        var tier = tierOfTenths(tenths);
        var q8 = fillQ8(tenths, tier);
        var belowH = Math.trunc((1000 * TIER_TOP_PCT[tier - 1]) / 100);
        var slabTopFull = Math.trunc((1000 * TIER_TOP_PCT[tier]) / 100);
        var slabHFull = slabTopFull - belowH;
        var slabHTop = Math.trunc((slabHFull * q8) / 256);
        if (slabHTop === 0 && q8 > 0) { slabHTop = 1; }
        var total = belowH + slabHTop;
        return total > 0 ? total : 1;
    }

    // Tier-banded rain bar at full plot height (mimics the watch). mm -> tenths internally.
    // white=true is the B&W silhouette: outline=true draws top+sides with an open bottom
    // (the x-axis closes it, matching chart.c BAR_OUTLINED); outline=false is a solid white bar.
    function rainBars(mm, x, bw, baseY, plotH, white, tiers, outline) {
        var H = barPermille(Math.round(mm * 10)) / 1000;
        if (H <= 0) { return ''; }
        var top = baseY - H * plotH;
        if (white) {
            if (outline) {
                return '<path d="M' + x + ',' + baseY + ' L' + x + ',' + top + ' L' + (x + bw) + ',' + top
                    + ' L' + (x + bw) + ',' + baseY + '" fill="none" stroke="#FFFFFF" stroke-width="1"></path>';
            }
            return rect(x, top, bw, H * plotH, '#FFFFFF');
        }
        var out = '';
        for (var k = 0; k < tiers.length; k += 1) {
            var from = tiers[k].from / 1000;
            if (H <= from) { break; }
            var to = (k + 1 < tiers.length) ? tiers[k + 1].from / 1000 : 1;
            var bandTop = Math.min(to, H);
            var h = (bandTop - from) * plotH - 0.5;
            out += rect(x, baseY - bandTop * plotH, bw, Math.max(h, 0.5), tiers[k].color);
        }
        return out;
    }

    function rect(x, y, w, h, fill) {
        return '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" fill="' + fill + '"></rect>';
    }

    function smooth(pts) {
        if (pts.length < 2) { return ''; }
        var d = 'M' + pts[0][0] + ',' + pts[0][1];
        for (var i = 0; i < pts.length - 1; i++) {
            var p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
            d += ' C' + (p1[0] + (p2[0] - p0[0]) / 6) + ',' + (p1[1] + (p2[1] - p0[1]) / 6) + ' ' + (p2[0] - (p3[0] - p1[0]) / 6) + ',' + (p2[1] - (p3[1] - p1[1]) / 6) + ' ' + p2[0] + ',' + p2[1];
        }
        return d;
    }

    function txt(x, y, s, fill, anchor, weight, t) {
        return '<text x="' + x + '" y="' + y + '" font-size="' + s + '" fill="' + fill + '" font-family="sans-serif" font-weight="' + weight + '" text-anchor="' + anchor + '">' + t + '</text>';
    }

    // Rough advance width (px) of a proportional sans-serif label at font-size `s`.
    // Used to lay out legend items left-to-right without a real text-metrics engine;
    // eyeball with `mise preview-config` and nudge the 0.52 factor if labels crowd.
    function labelAdvance(text, s) { return Math.round(text.length * s * 0.52); }

    // Small rain-intensity glyph: three short diagonal strokes in a size×size box at
    // (gx, gy). An SVG stand-in for the watch's procedural rain-lines glyph — visual
    // approximation, not a pixel-for-pixel trace.
    function rainGlyph(gx, gy, size, color) {
        var s = '', i, x0;
        for (i = 0; i < 3; i += 1) {
            x0 = gx + 2 + i * (size / 3);
            s += '<line x1="' + (x0 + size * 0.28) + '" y1="' + (gy + 1) + '" x2="' + x0 + '" y2="' + (gy + size - 1)
                + '" stroke="' + color + '" stroke-width="1.4" stroke-linecap="round"></line>';
        }
        return s;
    }

    // Wrap a preview SVG body in the standard 200×h frame. The negative margins
    // cancel the engine .blockrow padding (12px 16px 14px) so the preview bleeds
    // edge-to-edge.
    function svgFrame(inner, h) {
        h = h || 120;
        return '<svg viewBox="0 0 200 ' + h + '" style="aspect-ratio:200/' + h
            + ';display:block;width:calc(100% + 32px);margin:-12px -16px -14px">' + inner + '</svg>';
    }

    /* ---- forecastPreview: adapted from index.html:231-267 forecastSVG ---- */
    function forecastPreview(state, env, userData) {
        var isColor = !(env && !env.color);                  // B&W when env.color === false
        var P = (userData && userData.palette) || FALLBACK_PALETTE;

        // One coherent 12-point scenario starting at noon (slot 0 = 12:00): an afternoon
        // shower that suppresses UV, UV gone overnight, temp dipping then rising toward dawn.
        var temps  = [24, 24, 22, 20, 18, 16, 15, 14, 14, 15, 17, 19];
        var precip = [20, 55, 80, 85, 60, 35, 20, 15, 12, 10, 14, 22];
        var wind   = [14, 16, 20, 24, 22, 19, 17, 16, 18, 22, 26, 24];
        var rain   = [0, 0.5, 6, 12, 4, 1, 0.3, 0, 0, 0, 0, 0];
        var gust   = [22, 25, 30, 34, 32, 28, 25, 24, 27, 31, 36, 33];
        var uv     = [8, 6, 4, 2, 1, 0, 0, 0, 0, 0, 1, 3];

        var n = temps.length, PX0 = 20, PX1 = 197, PT = 4, PB = 100;
        var plotW = PX1 - PX0, plotH = PB - PT;
        // One watch-faithful slot grid (chart.c): N hourly slots, one tick per slot. Slot 0 is
        // 12:00; hour = 12 + i. Line vertices sit ON the ticks (so a line spans the first tick to
        // the last), and rain bars / second-metric dots sit centred in the hour COLUMN between two
        // ticks — exactly how chart_render_line vs chart_render_bars place them on the watch.
        var pitch = plotW / (n - 1);
        var tickX = function (i) { return PX0 + i * pitch; };              // line vertex / hour tick x
        var gapCenter = function (i) { return PX0 + (i + 0.5) * pitch; };  // bar / dot column centre
        var tmin = Math.min.apply(null, temps), tmax = Math.max.apply(null, temps);
        var ytop = PT + 3, ybot = PB - 12;
        var yT = function (t) { return ybot - (t - tmin) / (tmax - tmin || 1) * (ybot - ytop); };
        var n0 = tickX(9), n1 = tickX(n - 1);       // night band: sunset 21:00 (slot 9) -> right edge
        var bw = 9;                                  // rain-bar / dot width

        var windMax = state.windScale === 'low' ? 30 : (state.windScale === 'high' ? 70 : 50);
        // metric -> { sample series, full-scale max, fill? }. Color resolves per render.
        var METRIC = {
            precip_prob: { vals: precip, max: 100, fill: true },
            wind: { vals: wind, max: windMax },
            gust: { vals: gust, max: windMax },
            uv: { vals: uv, max: 11 }
        };
        /**
         * Per-metric stroke/dot color. White on B&W (series told apart by width/pattern). Gust has
         * no hue: white over color bars, light gray over white bars (matches forecast-series.lineColorFor).
         * @param {string} metric precip_prob|wind|gust|uv
         * @returns {string} #RRGGBB
         */
        function metricColor(metric) {
            if (metric === 'gust') {
                var g = P.line.gust;
                if (!isColor) { return g.bw; }
                return state.rainBarColor === 'white' ? g.colorWhiteBars : g.colorMulti;
            }
            var e = P.line[metric];
            if (!e) { return P.white; }
            return isColor ? e.color : e.bw;
        }
        /**
         * Per-metric area-fill color (every metric can fill, matching the watch). Null for an
         * unknown metric. Sourced from the palette so it can't diverge from forecast-series.
         * @param {string} metric precip_prob|wind|gust|uv
         * @returns {?string} #RRGGBB or null
         */
        function fillColor(metric) {
            var e = P.fill[metric];
            if (!e) { return null; }
            return isColor ? e.color : e.bw;
        }
        var tempColor = isColor ? P.temp : P.white;
        var tempW = isColor ? 2.2 : 3;               // B&W: thick temp vs thin main line
        var mainW = isColor ? 1.6 : 1;

        function drawNightShading() {
            if (!state.dayNightShading) { return ''; }
            return '<rect x="' + n0 + '" y="' + PT + '" width="' + (n1 - n0) + '" height="' + (PB - PT) + '" fill="url(#nh)"></rect>'
                + '<line x1="' + n0 + '" y1="' + PT + '" x2="' + n0 + '" y2="' + PB + '" stroke="rgba(255,255,255,0.45)" stroke-width="0.7"></line>'
                + '<line x1="' + n1 + '" y1="' + PT + '" x2="' + n1 + '" y2="' + PB + '" stroke="rgba(255,255,255,0.45)" stroke-width="0.7"></line>';
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
                out += '<line x1="' + tickX(i) + '" y1="' + PB + '" x2="' + tickX(i) + '" y2="' + (PB + (big ? 4 : 2)) + '" stroke="rgba(255,255,255,0.32)" stroke-width="0.6"></line>';
                if (big) { out += txt(tickX(i), 111, 7.5, '#7C828D', 'middle', 600, String((12 + i) % 24)); }
            }
            return out;
        }
        /**
         * Main metric: one continuous line whose vertices sit on the hour ticks, so it spans the
         * first tick to the last. Zero values stay in the line at the baseline (matching the watch's
         * chart_render_line) rather than breaking it — a line that dips to or starts at zero is still
         * drawn. Every metric can fill (matches the watch): the metric's palette fill colour on
         * colour displays, a dithered stipple on B&W (mirrors the watch's 1-bit
         * dither of the GColorLightGray fill — not diagonal lines).
         * @param {string} metric precip_prob|wind|gust|uv
         * @returns {string} SVG markup
         */
        var lineFor = function (metric) {
            var m = METRIC[metric];
            if (!m) { return ''; }
            var col = metricColor(metric), fc = fillColor(metric), out = '', pts = [];
            var doFill = Boolean(state.secondaryLineFill) && Boolean(fc);
            for (var i = 0; i < m.vals.length; i += 1) {
                var v = Math.min(m.vals[i], m.max);
                if (v < 0) { v = 0; }
                pts.push([tickX(i), PB - v / m.max * (PB - PT - 3)]);   // v == 0 lands on the baseline
            }
            if (pts.length < 2) { return out; }
            var d = smooth(pts);
            if (doFill) {
                var area = d + ' L' + pts[pts.length - 1][0] + ',' + PB + ' L' + pts[0][0] + ',' + PB + ' Z';
                out += isColor
                    ? '<path d="' + area + '" fill="' + fc + '" fill-opacity="0.25"></path>'
                    : '<path d="' + area + '" fill="url(#fillhatch)"></path>';
            }
            out += '<path d="' + d + '" fill="none" stroke="' + col + '" stroke-width="' + mainW + '"></path>';
            return out;
        };
        /**
         * Second metric: bar-aligned squares centred in the hour column (same columns as the rain
         * bars). A value of 0 sits on the baseline and is skipped (mirrors the watch's bar-dots).
         * @param {string} metric precip_prob|wind|gust|uv
         * @returns {string} SVG markup
         */
        var barDotsFor = function (metric) {
            var m = METRIC[metric];
            if (!m) { return ''; }
            var col = metricColor(metric);
            var dh = (isColor && col === P.white) ? 3 : 4, out = '';
            for (var i = 0; i < n - 1; i += 1) {
                var v = Math.min(m.vals[i], m.max);
                if (v <= 0) { continue; }
                var cy = PB - v / m.max * (PB - PT - 3);
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
            var LABEL = { precip_prob: 'Precip %', wind: 'Wind', gust: 'Gust', uv: 'UV' };
            var entries = [];
            entries.push({ kind: 'line', color: tempColor, w: tempW, label: 'Temp' });
            entries.push({ kind: 'line', color: metricColor(state.secondaryLine), w: mainW, label: LABEL[state.secondaryLine] || '' });
            if (state.thirdLine && state.thirdLine !== 'off' && state.thirdLine !== state.secondaryLine) {
                entries.push({ kind: 'dots', color: metricColor(state.thirdLine), label: LABEL[state.thirdLine] || '' });
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
                    // colour + white bars: a solid white swatch, matching the solid white bars
                    out += rect(x, gy - 3.5, 12, 7, P.white);
                } else {
                    // B&W: outline box, matching the outlined silhouette bars
                    out += '<rect x="' + x + '" y="' + (gy - 3.5) + '" width="12" height="7" fill="none" stroke="' + P.white + '" stroke-width="1"></rect>';
                }
                var lx = x + gw + 3;
                out += txt(lx, ty, 7.5, '#AEB4BD', 'start', 600, en.label);
                x = lx + en.label.length * 4.3 + 8;
            }
            return out;
        }

        var e = '';
        e += rect(0, 0, 200, 124, '#000');
        e += '<defs>'
            + '<pattern id="nh" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="4" stroke="rgba(255,255,255,0.30)" stroke-width="0.7"></line></pattern>'
            + '<pattern id="fillhatch" width="2" height="2" patternUnits="userSpaceOnUse"><rect width="1" height="1" fill="rgba(255,255,255,0.55)" shape-rendering="crispEdges"></rect><rect x="1" y="1" width="1" height="1" fill="rgba(255,255,255,0.55)" shape-rendering="crispEdges"></rect></pattern>'
            + '</defs>';
        e += drawNightShading();
        e += '<line x1="' + PX0 + '" y1="' + PB + '" x2="' + PX1 + '" y2="' + PB + '" stroke="rgba(255,255,255,0.20)" stroke-width="0.7"></line>';
        if (state.barSource === 'rain') {
            // White when the setting says so OR on a B&W display. B&W draws the outlined silhouette
            // (BAR_OUTLINED); colour-white draws a solid bar (BAR_SOLID) — matching the watch.
            var rainWhite = state.rainBarColor === 'white' || !isColor;
            for (var i = 0; i < n - 1; i += 1) {
                e += rainBars(rain[i], gapCenter(i) - bw / 2, bw, PB, plotH, rainWhite, P.rainTiers, !isColor);
            }
        }
        e += lineFor(state.secondaryLine);
        if (state.thirdLine && state.thirdLine !== 'off' && state.thirdLine !== state.secondaryLine) {
            e += barDotsFor(state.thirdLine);
        }
        e += drawTempCurve();
        // No status chrome (location / sunset / current-temp pill): the preview doesn't model it.
        e += txt(3, PT + 11, 8, '#AEB4BD', 'start', 600, tmax + '°') + txt(3, PB - 1, 8, '#AEB4BD', 'start', 600, tmin + '°');
        e += drawAxis();
        e += drawLegend();
        return svgFrame(e, 124);
    }

    /* ---- radarPreview: adapted from index.html:270-286 radarSVG ----------- */
    function radarPreview(state, env, userData) {
        if (state.radarProvider === 'disabled') {
            return svgFrame(rect(0, 0, 200, 120, '#000') + txt(100, 63, 10, '#566072', 'middle', 700, 'Radar off — enable a provider'));
        }
        var local = [0, 0, 0, 0.2, 0.6, 1.5, 3, 7, 14, 10, 5, 2, 0.8, 0.3, 0.1, 0, 0.3, 1, 3, 8, 12, 6, 2, 0.5];
        var add = [0.4, 0.5, 0.7, 1, 1.5, 2, 3, 4, 3, 2, 1.5, 1, 0.8, 0.5, 0.4, 0.3, 0.5, 1.5, 3, 4, 3, 2, 1, 0.5];
        var n = local.length, PX0 = 11, PX1 = 196, PT = 24, PB = 99, plotH = PB - PT;
        var step = (PX1 - PX0) / n, bw = step - 1.6;
        var e = rect(0, 0, 200, 118, '#000');
        var topY = PT - 7;
        e += '<line x1="' + PX0 + '" y1="' + topY + '" x2="' + PX1 + '" y2="' + topY + '" stroke="rgba(255,255,255,0.22)" stroke-width="0.6"></line>';
        for (var k = 0; k <= n; k++) {
            var tx = PX0 + k * step, big = k % 6 === 0;
            e += '<line x1="' + tx + '" y1="' + topY + '" x2="' + tx + '" y2="' + (topY + (big ? 4 : 2)) + '" stroke="rgba(255,255,255,0.30)" stroke-width="0.6"></line>';
        }
        e += txt(PX0, topY - 3, 7, '#7C828D', 'start', 600, 'now') + txt(PX0 + 12 * step, topY - 3, 7, '#7C828D', 'middle', 600, '+1h') + txt(PX1, topY - 3, 7, '#7C828D', 'end', 600, '+2h');
        e += '<line x1="' + PX0 + '" y1="' + PB + '" x2="' + PX1 + '" y2="' + PB + '" stroke="rgba(255,255,255,0.18)" stroke-width="0.7"></line>';
        var P = (userData && userData.palette) || FALLBACK_PALETTE;
        var radarWhite = state.radarColor === 'white' || (env && !env.color);
        // Only DWD carries a 2 km-area signal; Met.no and Rainbow are
        // single-point nowcasts → omit the hollow "nearby" outline bars and
        // their legend entry entirely.
        var showNearby = state.radarProvider === 'dwd';
        for (var i = 0; i < n; i++) {
            var x = PX0 + i * step + (step - bw) / 2;
            var nH = barPermille(Math.round((local[i] + add[i]) * 10)) / 1000;
            if (showNearby && nH > 0) {
                e += '<rect x="' + x + '" y="' + (PB - nH * plotH) + '" width="' + bw + '" height="' + (nH * plotH) + '" fill="none" stroke="rgba(255,255,255,0.30)" stroke-width="0.7"></rect>';
            }
            e += rainBars(local[i], x, bw, PB, plotH, radarWhite, P.rainTiers, false);
        }
        // Rain legend (one row): the exact-spot swatch (tier gradient on color, solid
        // white on B&W) + label, then a hollow grey "nearby" box + label. The nearby
        // box is a fixed grey outline (not tier-coloured), so it reads the same on
        // color and B&W — matching the faint nearby-rain outline bars above.
        var lgy = 110, lx = PX0;
        if (!radarWhite) {
            for (var t = 0; t < P.rainTiers.length; t += 1) {
                e += rect(lx + t * 2.4, lgy - 3.5, 2.4, 7, P.rainTiers[t].color);
            }
            lx += P.rainTiers.length * 2.4 + 2;
        } else {
            e += rect(lx, lgy - 3.5, 12, 7, P.white);
            lx += 14;
        }
        e += txt(lx + 3, lgy + 3, 7.5, '#AEB4BD', 'start', 600, 'Rain at your exact spot');
        if (showNearby) {
            lx += 3 + labelAdvance('Rain at your exact spot', 7.5) + 7;
            e += '<rect x="' + lx + '" y="' + (lgy - 3.5) + '" width="9" height="7" fill="none" stroke="#8A8F98" stroke-width="1"></rect>';
            lx += 11;
            e += txt(lx + 3, lgy + 3, 7.5, '#AEB4BD', 'start', 600, 'Nearby (2 km)');
        }
        // Rain-countdown preview band: a status-strip mock ("Rain in 15'") above the
        // chart, mirroring top_status_layer.c. Hidden when the countdown is Off, and
        // never shown on aplite (which lacks the feature). Only the glyph is coloured
        // (green tier on color, white on B&W); the text stays white and centred.
        var countdownOff = String(state.rainCountdownHorizon) === '0';
        var isAplite = Boolean(env && env.platform === 'aplite');
        if (countdownOff || isAplite) {
            return svgFrame(e, 118);
        }
        var isColor = !(env && !env.color);
        var glyphColor = isColor ? P.rainTiers[2].color : P.white;
        var bandH = 20, glyphSize = 10, label = "Rain in 15'";
        var groupW = glyphSize + 4 + labelAdvance(label, 11);
        var groupX = (200 - groupW) / 2;
        var band = rect(0, 0, 200, bandH, '#000');
        band += rainGlyph(groupX, (bandH - glyphSize) / 2, glyphSize, glyphColor);
        band += txt(groupX + glyphSize + 4, bandH / 2 + 4, 11, '#FFFFFF', 'start', 700, label);
        band += '<line x1="0" y1="' + bandH + '" x2="200" y2="' + bandH + '" stroke="rgba(255,255,255,0.18)" stroke-width="0.7"></line>';
        return svgFrame(band + '<g transform="translate(0,' + bandH + ')">' + e + '</g>', 118 + bandH);
    }

    /* ---- devStats: ported from inject.js:30-199 renderDevStats, minus clear button --- */
    function devStats(state, env, userData) {
        var events = parseStoredJson(userData && userData.devStats);
        if (!state.devStatsEnabled || !events || events.length === 0) { return ''; }

        var CATEGORIES = ['forecast', 'status', 'sun', 'radar', 'sleep'];
        var RAW_EVENT_CAP = 100;
        var TABLE_STYLE = 'border-collapse:collapse;font-size:0.72em;margin:2px 0 6px;width:100%;text-align:center;';
        var CELL_STYLE = 'border:1px solid #555;padding:1px 3px;';
        var TITLE_STYLE = 'font-size:0.8em;font-weight:bold;margin:8px 0 0;padding:0 16px;';
        var LEGEND_STYLE = 'font-size:0.7em;color:#9aa0a6;line-height:1.3;margin:1px 0 3px;padding:0 16px;';
        // App-owned override: this custom element ships its own CSS rather than the config-ui lib
        // carrying dev-stats rules. .dsBleed cancels the lib .blockrow's 16px side padding (full
        // bleed) so the tables run to the card's inner edge; dropping the grid's outer left/right
        // edges then lets the card border be the frame. !important beats the per-cell inline border.
        var STYLE_OVERRIDE = '<style>'
            + '.dsBleed{margin-left:-16px;margin-right:-16px;}'
            + '.dsTable td:first-child,.dsTable th:first-child{border-left:none !important;}'
            + '.dsTable td:last-child,.dsTable th:last-child{border-right:none !important;}'
            + '</style>';
        var days = {};
        var dayOrder = [];
        var raw;
        var html;

        function pad2(value) {
            return value < 10 ? '0' + value : String(value);
        }

        function dayOf(t) {
            var d = new Date(t);
            return pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
        }

        function timeOf(t) {
            var d = new Date(t);
            return dayOf(t) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
        }

        function cell(content) {
            return '<td style="' + CELL_STYLE + '">' + content + '</td>';
        }

        function headerRow(labels) {
            return '<tr>' + labels.map(function (label) {
                return '<th style="' + CELL_STYLE + '">' + label + '</th>';
            }).join('') + '</tr>';
        }

        function outcomeCell(counts) {
            var parts = [];
            if (counts.ack > 0) { parts.push(counts.ack + '✓'); }
            if (counts.nack > 0) { parts.push(counts.nack + '✗'); }
            if (counts.skip > 0) { parts.push(counts.skip + 'c'); }
            return parts.length > 0 ? parts.join('<br>') : '–';
        }

        // Aggregate per local day
        events.forEach(function (ev) {
            var day = dayOf(ev.t);
            var bucket = days[day];
            var outcome = ev.ok === 1 ? 'ack' : (ev.ok === 0 ? 'nack' : 'skip');
            if (!bucket) {
                bucket = {
                    weather: { ack: 0, nack: 0, skip: 0 },
                    setting: { ack: 0, nack: 0, skip: 0 },
                    cats: {}
                };
                CATEGORIES.forEach(function (name) {
                    bucket.cats[name] = { sent: 0, cached: 0 };
                });
                days[day] = bucket;
                dayOrder.push(day);
            }
            if (ev.k === 'weather') {
                bucket.weather[outcome] += 1;
                CATEGORIES.forEach(function (name) {
                    if (!ev.c || typeof ev.c[name] === 'undefined' || outcome === 'nack') { return; }
                    if (ev.c[name] === 1) {
                        bucket.cats[name].sent += 1;
                    } else {
                        bucket.cats[name].cached += 1;
                    }
                });
            } else {
                bucket.setting[outcome] += 1;
            }
        });
        dayOrder.reverse();  // Newest day first.

        // Daily rollup table — NOTE: no Clear button (now a schema toggle)
        html = '<div style="' + TITLE_STYLE + '">Daily summary</div>';
        html += '<div style="' + LEGEND_STYLE + '">'
            + '✓ delivered · ✗ rejected · c cache-skip (nothing sent)<br>'
            + 'per category: count● sent · count– cached</div>';
        html += '<table class="dsTable" style="' + TABLE_STYLE + '">';
        html += headerRow(['Day', 'weather'].concat(CATEGORIES).concat(['setting']));
        dayOrder.forEach(function (day) {
            var bucket = days[day];
            html += '<tr>' + cell(day) + cell(outcomeCell(bucket.weather));
            CATEGORIES.forEach(function (name) {
                html += cell(bucket.cats[name].sent + '●<br>' + bucket.cats[name].cached + '–');
            });
            html += cell(outcomeCell(bucket.setting)) + '</tr>';
        });
        html += '</table>';

        // Raw event list, newest first, capped for page sanity
        raw = events.slice(-RAW_EVENT_CAP).reverse();
        html += '<div style="' + TITLE_STYLE + '">Events</div>';
        html += '<div style="' + LEGEND_STYLE + '">'
            + 'ok: ✓ delivered · ✗ rejected · blank nothing sent<br>'
            + 'category/setting: ● sent · – cached · blank not in payload</div>';
        html += '<table class="dsTable" style="' + TABLE_STYLE + '">';
        html += headerRow(['Time', 'ok'].concat(CATEGORIES).concat(['setting']));
        raw.forEach(function (ev) {
            var okMark = ev.ok === 1 ? '✓' : (ev.ok === 0 ? '✗' : '');
            html += '<tr>' + cell(timeOf(ev.t)) + cell(okMark);
            CATEGORIES.forEach(function (name) {
                var mark = '';
                if (ev.k === 'weather' && ev.c && typeof ev.c[name] !== 'undefined') {
                    mark = ev.c[name] === 1 ? '●' : '–';
                }
                html += cell(mark);
            });
            html += cell(ev.k === 'setting' ? (ev.sent === 1 ? '●' : '–') : '') + '</tr>';
        });
        html += '</table>';
        if (events.length > RAW_EVENT_CAP) {
            html += '<div style="font-size:0.72em;padding:0 16px;">Showing last ' + RAW_EVENT_CAP + ' of ' + events.length + ' events.</div>';
        }
        return STYLE_OVERRIDE + '<div class="dsBleed">' + html + '</div>';
    }

    /* ---- lastFetch: ported from inject.js:309-334 ------------------------- */
    function lastFetch(state, env, userData) {
        var lastFetchSuccess = parseStoredJson(userData && userData.lastFetchSuccess);
        var lastFetchSuccessTime = null;
        var html = '';
        var date;
        var lastFetchAttempt;
        var attemptDate;
        var attemptTime;
        var shouldShowLastAttempt;
        var attemptText;

        html += '<b>Last fetch:</b> ';
        if (lastFetchSuccess !== null) {
            date = new Date(lastFetchSuccess.time);
            lastFetchSuccessTime = date.getTime();
            html += date.toLocaleDateString() + ' ' + date.toLocaleTimeString() + ' with ' + lastFetchSuccess.name;
        } else {
            html += 'Never';
        }

        lastFetchAttempt = parseStoredJson(userData && userData.lastFetchAttempt);
        if (lastFetchAttempt !== null) {
            if (lastFetchAttempt.error) {
                attemptDate = new Date(lastFetchAttempt.time);
                attemptTime = attemptDate.getTime();
                shouldShowLastAttempt = !Boolean(lastFetchSuccessTime) || attemptTime > lastFetchSuccessTime;

                if (shouldShowLastAttempt) {
                    attemptText = '<br>Last failed attempt:<br>';
                    attemptText += attemptDate.toLocaleDateString() + ' ' + attemptDate.toLocaleTimeString() + ' with ' + lastFetchAttempt.name;
                    attemptText += '<br>Error: ' + lastFetchAttempt.error.stage + ': ' + lastFetchAttempt.error.code;
                    html += attemptText;
                }
            }
        }

        return html;
    }

    // Resolve the Layout state to the adaptive view cycle (array of ViewSpec objects).
    // Shares view-cycle.js with clay-payload.js — no manual sync.
    function presetContents(state) {
        state = state || {};
        var radarEnabled = state.radarProvider !== 'disabled';
        return VC.buildViewCycle(VC.resolvePresetKey(state), state.healthMode || 'off', radarEnabled);
    }

    // Schematic band-stack geometry (px). The calendar is modelled as rows of height ROW
    // stacked with BAND_GAP between them (the same gap the renderers draw), so a status line
    // is exactly one freed calendar row: CAL2_H + BAND_GAP + STATUS_H === CAL3_H. Dropping the
    // 3rd calendar row buys precisely one status band. Kept honest by a test in config-blocks.
    var ROW = 10, BAND_GAP = 2;
    var CAL3_H = ROW * 3 + BAND_GAP * 2;   // 34 — full 3-row calendar (2 inter-row gaps)
    var CAL2_H = ROW * 2 + BAND_GAP;       // 22 — compact 2-row calendar (1 inter-row gap)
    var STATUS_H = ROW;                    // 10 — a status line = the freed calendar row
    var FLEX_MIN = 12;                     // floor for the flex (body) band so it never vanishes

    // Resolve band heights for a stack that fills `availH` (bands + gaps span exactly availH).
    // The single band flagged `flex` absorbs the slack; the rest keep their fixed `h`. Returns
    // a parallel array of heights (px). With no flex band, returns the fixed heights unchanged.
    function resolveBandHeights(bands, availH, gap) {
        var fixed = 0, flexIdx = -1, i, out = [];
        for (i = 0; i < bands.length; i++) {
            out.push(bands[i].h);
            if (bands[i].flex) { flexIdx = i; } else { fixed += bands[i].h; }
        }
        if (flexIdx >= 0) {
            var rest = availH - fixed - (bands.length - 1) * gap;
            out[flexIdx] = rest > FLEX_MIN ? rest : FLEX_MIN;
        }
        return out;
    }

    // Schematic band stack for one ViewSpec — proportional, not pixel-accurate. Mirrors
    // layout.c band ordering: compact = cal, single status (whichever is on) before clock;
    // dual = health before clock, weather after; full/none = clock then status row(s).
    function contentBands(spec) {
        if (!spec) { return null; }
        var bands = [{ label: 'Date', h: 12 }];
        var isNone = spec.tier === VC.TIER_NONE;
        var isFull = spec.tier === VC.TIER_FULL;
        var topBand = null;
        if (spec.top === VC.TOP_RADAR) { topBand = { label: 'Radar', h: CAL3_H }; }
        else if (!isNone) { topBand = { label: isFull ? 'Calendar (3 rows)' : 'Calendar (2 rows)', h: isFull ? CAL3_H : CAL2_H }; }
        var bodyLabel = spec.body === VC.BODY_GRAPH ? 'Health graph'
                      : spec.body === VC.BODY_RADAR ? 'Radar' : 'Forecast';
        // The body always takes the remaining space (flex); the fallback h only matters to a
        // consumer that doesn't resolve flex bands.
        var bodyBand = { label: bodyLabel, h: 20, flex: true };
        var weather = { label: 'Weather status', h: STATUS_H };
        var health = { label: 'Health status', h: STATUS_H };
        var clock = { label: 'Clock', h: isNone ? 30 : 22 };
        var dual = spec.status === VC.ST_D;
        var showW = spec.status === VC.ST_W || dual;
        var showH = spec.status === VC.ST_H || dual;
        if (topBand) { bands.push(topBand); }
        if (!isNone && !isFull) {                 // compact: single status rides the freed cal row
            if (dual) {
                bands.push(health);               // freed row, above the clock
                bands.push(clock);
                bands.push(weather);              // carved band, below the clock (near the body)
            } else {
                if (showH) { bands.push(health); }
                if (showW) { bands.push(weather); }
                bands.push(clock);
            }
        } else {                                  // full / none: clock, then status row(s)
            bands.push(clock);
            if (showH) { bands.push(health); }
            if (showW) { bands.push(weather); }
        }
        bands.push(bodyBand);
        return bands;
    }

    // Render a band array (each {label, h}) as the schematic band-stack SVG shared by
    // both layout previews. Returns '' for an empty/null band list (nothing to show).
    function renderBandStack(bands) {
        if (!bands || !bands.length) { return ''; }
        var W = 200, PAD = 8, w = W - PAD * 2, y = PAD, i;
        var heights = resolveBandHeights(bands, 118 - PAD * 2, BAND_GAP);
        var e = rect(0, 0, W, 118, '#000');
        for (i = 0; i < bands.length; i++) {
            e += rect(PAD, y, w, heights[i], '#1B1F27');
            e += txt(W / 2, y + heights[i] / 2 + 3, 8, '#AEB4BD', 'middle', 600, bands[i].label);
            y += heights[i] + BAND_GAP;
        }
        return svgFrame(e, 118);
    }

    function layoutPreview(state, env, userData) {
        return renderBandStack(contentBands(presetContents(state)[0]));
    }
    // First flick slot (index 1), or null when the cycle has none.
    function firstFlickContent(state) {
        var contents = presetContents(state);
        return contents.length > 1 ? contents[1] : null;
    }
    function layoutPreviewFlick(state, env, userData) {
        var content = firstFlickContent(state);
        return content ? renderBandStack(contentBands(content)) : '';
    }

    // One column of a side-by-side layout preview: a header label over a band stack that
    // fills the column width (no side padding). `dim`/`note` are unused by the adaptive
    // cycle preview (every slot in the cycle is available by construction) but kept as
    // params — `note` still renders as a placeholder sub-note when a column has no bands.
    function renderBandColumn(bands, x, w, header, note, dim) {
        var headerColor = dim ? '#5A6270' : '#8A92A0';
        var bandFill = dim ? '#14161C' : '#1B1F27';
        var labelColor = dim ? '#4A505C' : '#AEB4BD';
        var e = txt(x + w / 2, 9, 8, headerColor, 'middle', 700, header), y = 16, i;
        if (!bands || !bands.length) {
            e += rect(x, y, w, 104, '#12151C');
            e += txt(x + w / 2, y + 54, 8, '#6A7280', 'middle', 600, note || '—');
            return e;
        }
        // Bands + gaps span y=16..120, matching the empty-column placeholder's 104px box, so
        // the flex (body) band always fills down to the same bottom across all columns.
        var heights = resolveBandHeights(bands, 104, BAND_GAP);
        for (i = 0; i < bands.length; i++) {
            e += rect(x, y, w, heights[i], bandFill);
            e += txt(x + w / 2, y + heights[i] / 2 + 3, 7.5, labelColor, 'middle', 600, bands[i].label);
            y += heights[i] + BAND_GAP;
        }
        if (note) {
            e += txt(x + w / 2, y + 8, 7, '#7C828D', 'middle', 600, note);
        }
        return e;
    }

    // One labeled column per cycle slot: Default (slot 0) then Flick 1 / Flick 2. The cycle
    // (from view-cycle.js) already reflects radar/health availability — a disabled slot is
    // simply absent, so there's no "would be skipped" case left to flag.
    function layoutPreviewCombined(state, env, userData) {
        state = state || {};
        var contents = presetContents(state);
        var HEADERS = ['Default', 'Flick 1', 'Flick 2'];
        var W = 200, GAP = 6, n = contents.length || 1, colW = (W - GAP * (n - 1)) / n;
        var e = rect(0, 0, W, 128, '#000'), i;
        for (i = 0; i < contents.length; i += 1) {
            e += renderBandColumn(contentBands(contents[i]), i * (colW + GAP), colW,
                HEADERS[i], null, false);
        }
        return svgFrame(e, 128);
    }

    PConf.blocks.register('forecastPreview', forecastPreview);
    PConf.blocks.register('radarPreview', radarPreview);
    PConf.blocks.register('layoutPreview', layoutPreview);
    PConf.blocks.register('layoutPreviewFlick', layoutPreviewFlick);
    PConf.blocks.register('layoutPreviewCombined', layoutPreviewCombined);
    PConf.blocks.register('devStats', devStats);
    PConf.blocks.register('lastFetch', lastFetch);

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = {
            forecastPreview: forecastPreview, radarPreview: radarPreview,
            devStats: devStats, lastFetch: lastFetch,
            layoutPreview: layoutPreview, layoutPreviewFlick: layoutPreviewFlick,
            layoutPreviewCombined: layoutPreviewCombined,
            presetContents: presetContents, contentBands: contentBands,
            resolveBandHeights: resolveBandHeights,
            barPermille: barPermille, previewPaletteFallback: FALLBACK_PALETTE
        };
    }
})();
