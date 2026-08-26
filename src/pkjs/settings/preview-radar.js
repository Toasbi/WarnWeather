// src/pkjs/settings/preview-radar.js — ES5, WebView. The rain-radar preview
// block: a two-hour nowcast bar chart with its provider-dependent "nearby"
// outline bars, its legend, and the rain-countdown status strip above it.
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
    var rainBars = previewRain.rainBars, barPermille = previewRain.barPermille;
    var FALLBACK_PALETTE = previewRain.FALLBACK_PALETTE;
    var resolveInkLib = (typeof require !== 'undefined')
        ? require('../resolve-ink.js') : window.ResolveInk;
    var isLightPolarity = resolveInkLib.isLightPolarity;
    var isBwTheme = resolveInkLib.isBwTheme;

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

    /**
     * The rain-radar preview block — adapted from index.html:270-286's radarSVG.
     * @param {Object} state Live settings (colours as hex strings).
     * @param {Object} env Config-UI environment facts ({ color, platform, … }).
     * @param {Object} [userData] Page userData; `palette` is the page-open snapshot.
     * @returns {string} SVG markup.
     */
    function radarPreview(state, env, userData) {
        // Effective color: a color display renders as color only when the theme isn't
        // Black & White — a bw/bw-light theme reuses the exact preview a B&W watch gets.
        var isColor = !(env && !env.color) && !isBwTheme(state.theme);
        var ink = previewInk(state.theme);
        var radarMode = state.radarMode || 'graph';
        if (radarMode === 'off') {
            return svgFrame(rect(0, 0, 200, 120, ink.bg) + txt(100, 63, 10, '#566072', 'middle', 700, 'Radar off'));
        }
        var local = [0, 0, 0, 0.2, 0.6, 1.5, 3, 7, 14, 10, 5, 2, 0.8, 0.3, 0.1, 0, 0.3, 1, 3, 8, 12, 6, 2, 0.5];
        var add = [0.4, 0.5, 0.7, 1, 1.5, 2, 3, 4, 3, 2, 1.5, 1, 0.8, 0.5, 0.4, 0.3, 0.5, 1.5, 3, 4, 3, 2, 1, 0.5];
        var n = local.length, PX0 = 11, PX1 = 196, PT = 24, PB = 99, plotH = PB - PT;
        var step = (PX1 - PX0) / n, bw = step - 1.6;
        var e = rect(0, 0, 200, 118, ink.bg);
        var topY = PT - 7;
        e += '<line x1="' + PX0 + '" y1="' + topY + '" x2="' + PX1 + '" y2="' + topY + '" stroke="' + ink.rgba('0.22') + '" stroke-width="0.6"></line>';
        for (var k = 0; k <= n; k++) {
            var tx = PX0 + k * step, big = k % 6 === 0;
            e += '<line x1="' + tx + '" y1="' + topY + '" x2="' + tx + '" y2="' + (topY + (big ? 4 : 2)) + '" stroke="' + ink.rgba('0.30') + '" stroke-width="0.6"></line>';
        }
        e += txt(PX0, topY - 3, 7, '#7C828D', 'start', 600, 'now') + txt(PX0 + 12 * step, topY - 3, 7, '#7C828D', 'middle', 600, '+1h') + txt(PX1, topY - 3, 7, '#7C828D', 'end', 600, '+2h');
        e += '<line x1="' + PX0 + '" y1="' + PB + '" x2="' + PX1 + '" y2="' + PB + '" stroke="' + ink.rgba('0.18') + '" stroke-width="0.7"></line>';
        var P = (userData && userData.palette) || FALLBACK_PALETTE;
        var radarWhite = state.radarColor === 'white' || !isColor;
        // Solid ('white'/Solid) radar-bar color: DarkGray in light polarity, white in
        // dark (mirrors rain-tier.js buildPalette's colorMode==='white' branch — see
        // forecastPreview's barFg, same rule). B&W/bw themes draw an OUTLINE instead
        // (see the `outline` param below) using ink.fg as the stroke color, which this
        // also equals there — same value, different role.
        var radarBarFg = isColor ? (isLightPolarity(state.theme) ? '#555555' : '#FFFFFF') : ink.fg;
        // Only DWD carries a 2 km-area signal; Met.no and Rainbow are
        // single-point nowcasts → omit the hollow "nearby" outline bars and
        // their legend entry entirely.
        var showNearby = state.radarProvider === 'dwd';
        for (var i = 0; i < n; i++) {
            var x = PX0 + i * step + (step - bw) / 2;
            var nH = barPermille(Math.round((local[i] + add[i]) * 10)) / 1000;
            if (showNearby && nH > 0) {
                e += '<rect x="' + x + '" y="' + (PB - nH * plotH) + '" width="' + bw + '" height="' + (nH * plotH) + '" fill="none" stroke="' + ink.rgba('0.30') + '" stroke-width="0.7"></rect>';
            }
            // outline (B&W/bw: unfilled — the transparent interior shows the canvas
            // background through, i.e. theme_bg(), matching the watch's polarity-aware
            // palette fill) vs. solid (effectively-color Solid mode: radarBarFg).
            e += rainBars(local[i], x, bw, PB, plotH, radarWhite, P.rainTiers, !isColor, radarBarFg, ink.bg);
        }
        // Rain legend (one row): the exact-spot swatch (tier gradient on color, solid
        // theme-fg on B&W) + label, then a hollow grey "nearby" box + label. The nearby
        // box is a fixed grey outline (not tier-coloured), so it reads the same on
        // color and B&W — matching the faint nearby-rain outline bars above.
        var lgy = 110, lx = PX0;
        if (!radarWhite) {
            for (var t = 0; t < P.rainTiers.length; t += 1) {
                e += rect(lx + t * 2.4, lgy - 3.5, 2.4, 7, P.rainTiers[t].color);
            }
            lx += P.rainTiers.length * 2.4 + 2;
        } else {
            e += rect(lx, lgy - 3.5, 12, 7, radarBarFg);
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
        // (green tier when effectively color, theme-fg otherwise); the text stays
        // theme-fg and centred.
        // Countdown shows for every non-off tier; the horizon no longer has an Off option.
        var isAplite = Boolean(env && env.platform === 'aplite');
        if (isAplite) {
            return svgFrame(e, 118);
        }
        var glyphColor = isColor ? P.rainTiers[2].color : ink.fg;
        var bandH = 20, glyphSize = 10, label = "Rain in 15'";
        var groupW = glyphSize + 4 + labelAdvance(label, 11);
        var groupX = (200 - groupW) / 2;
        var band = rect(0, 0, 200, bandH, ink.bg);
        band += rainGlyph(groupX, (bandH - glyphSize) / 2, glyphSize, glyphColor);
        band += txt(groupX + glyphSize + 4, bandH / 2 + 4, 11, ink.fg, 'start', 700, label);
        band += '<line x1="0" y1="' + bandH + '" x2="200" y2="' + bandH + '" stroke="' + ink.rgba('0.18') + '" stroke-width="0.7"></line>';
        return svgFrame(band + '<g transform="translate(0,' + bandH + ')">' + e + '</g>', 118 + bandH);
    }

    PConf.blocks.register('radarPreview', radarPreview);

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { radarPreview: radarPreview };
    }
})();
