// src/pkjs/settings/preview-rain.js — ES5, WebView. The watch's rain-tier bar
// curve, mirrored for the previews, plus the tier-banded bar the two charts draw
// with it and the palette they fall back to when the page opened without one.
// Shared by preview-forecast.js (the rain bars under the graph) and
// preview-radar.js (the nowcast bars) — the only two consumers rain math has.
// Registers nothing; it is a library, not a block.
// barPermille below calls Math.trunc (ES2015); polyfills.js never loads in the
// flat concatenated page, so guard it here for pre-ES6 WebViews (same body as
// the polyfills.js one).
if (!Math.trunc) {
    Math.trunc = function (v) { return v < 0 ? Math.ceil(v) : Math.floor(v); };
}
(function () {
    // Dual-context pattern (see line-style.js): a CommonJS module under Node, a
    // concatenated <script> exposing window.PreviewSvg in the webview. preview-svg.js
    // precedes this file in APP_FILES.
    var svg = (typeof require !== 'undefined') ? require('./preview-svg.js') : window.PreviewSvg;
    var rect = svg.rect;

    // Fallback palette — used only if userData.palette wasn't injected (stale page).
    // Shape mirrors what preview-palette.buildPreviewPalette() still builds: the temp
    // curve's mirrored C constant and the rain-tier ramp. The per-metric line and fill
    // tables that used to live here are GONE from both sides: the graph colours are
    // resolved live off `state` by line-style.js now, so there is nothing left for a
    // page-open snapshot of them to freeze — or to drift from.
    var FALLBACK_PALETTE = {
        temp: '#FF0000',
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
    /**
     * Which of the five tiers a rain reading lands in.
     * @param {number} tenths Rain in tenths of a mm.
     * @returns {number} 0 (dry) .. 5.
     */
    function tierOfTenths(tenths) {
        if (tenths <= 0) { return 0; }
        for (var i = 0; i < TIER_MAX_TENTHS.length; i += 1) {
            if (tenths <= TIER_MAX_TENTHS[i]) { return i + 1; }
        }
        return 5;
    }
    /**
     * How full the reading sits within its own tier's slab, as a Q8 fraction.
     * @param {number} tenths Rain in tenths of a mm.
     * @param {number} tier The tier from tierOfTenths().
     * @returns {number} 0..256.
     */
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
    /**
     * Bar height for a rain reading, as a fraction of the plot in permille — the
     * mirror of rain-tier.rainPermille, pinned to it by test/config-blocks.test.js.
     * @param {number} tenths Rain in tenths of a mm (the wire unit).
     * @returns {number} 0..1000.
     */
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

    /**
     * Tier-banded rain bar at full plot height (mimics the watch). mm -> tenths
     * internally. white=true is the B&W silhouette: outline=true draws top+sides with an
     * open bottom (the x-axis closes it, matching chart.c BAR_OUTLINED); outline=false is
     * a solid white bar. The outline path is filled with `bg` (the polarity background,
     * theme_bg() on the watch) so it's opaque — matching chart.c's theme_bg()-filled +
     * theme_fg()-outlined bar — rather than transparent, which would let whatever's
     * painted behind it (e.g. a dithered area fill) show through. SVG fills an open
     * subpath as if closed by a straight line back to its start, so the implicit 4th
     * (bottom) edge closes exactly on the baseline without needing to be stroked.
     * @param {number} mm Rain for this column, in mm.
     * @param {number} x Left edge of the bar.
     * @param {number} bw Bar width.
     * @param {number} baseY Baseline (the plot floor) y.
     * @param {number} plotH Full plot height a 1000‰ bar would span.
     * @param {boolean} white Solid/outlined single-colour bar instead of tier bands.
     * @param {Array.<{from: number, color: string}>} tiers The tier ramp (palette.rainTiers).
     * @param {boolean} outline Draw the B&W open-bottom silhouette rather than a solid bar.
     * @param {string} [fg='#FFFFFF'] Bar/stroke colour in the `white` modes.
     * @param {string} [bg='#000000'] Interior fill of the outlined silhouette.
     * @returns {string} SVG markup.
     */
    function rainBars(mm, x, bw, baseY, plotH, white, tiers, outline, fg, bg) {
        var H = barPermille(Math.round(mm * 10)) / 1000;
        if (H <= 0) { return ''; }
        fg = fg || '#FFFFFF';
        bg = bg || '#000000';
        var top = baseY - H * plotH;
        if (white) {
            if (outline) {
                return '<path d="M' + x + ',' + baseY + ' L' + x + ',' + top + ' L' + (x + bw) + ',' + top
                    + ' L' + (x + bw) + ',' + baseY + '" fill="' + bg + '" stroke="' + fg + '" stroke-width="1"></path>';
            }
            return rect(x, top, bw, H * plotH, fg);
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

    var api = {
        FALLBACK_PALETTE: FALLBACK_PALETTE,
        barPermille: barPermille,
        rainBars: rainBars
    };

    // Dual-context export — mirrors the tail of src/pkjs/status-thresholds.js.
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    if (typeof window !== 'undefined') {
        window.PreviewRain = api;
    }
})();
