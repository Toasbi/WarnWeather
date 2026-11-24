// src/pkjs/page/weather/pixel-icon.js — the status icons as the watch draws them, for the settings
// page's pictures of the watch (preview-watch.js): its drawings (status-pixels.generated.js: per
// icon and size, the box as wide as the ink, a row per number, bit x lighting column x, the blank
// rows that seat it kept) as SVG, every run of lit pixels a filled rectangle, so a picture shows
// the very pixels the watch lights, at the size and seat set in the icon creator. The page's
// labels draw outlines instead (status-slot-icons.js, condition-icons.js), but for an icon it has
// no outline of: the Plugin value's (glyph, plugin-value-page.js).
// Dual-context: required under Node, window.PixelIcon on the page (after
// status-pixels.generated.js, ahead of preview-watch.js).
(function () {
    'use strict';

    var PIXELS = (typeof require !== 'undefined') ? require('../../settings/status-pixels.generated.js')
        : (typeof window !== 'undefined' && window.StatusPixels) || {icons: {}, ids: {}};

    /**
     * A pixel drawing's lit pixels as one SVG path, in pixel units: a rectangle per run.
     * @param {{w: number, rows: !Array<number>}} p The drawing.
     * @returns {string} The path data; '' for a blank drawing.
     */
    function path(p) {
        var d = '';
        for (var y = 0; y < p.rows.length; y++) {
            var x = 0;
            while (x < p.w) {
                if (!(p.rows[y] & (1 << x))) { x++; continue; }
                var x0 = x;
                while (x < p.w && (p.rows[y] & (1 << x))) { x++; }
                d += 'M' + x0 + ' ' + y + 'h' + (x - x0) + 'v1h-' + (x - x0) + 'z';
            }
        }
        return d;
    }

    /**
     * The drawing a watch family draws an icon with in a bar of this box, as the watch looks it
     * up (status_icon_size.h status_icon_drawing): the box's own, else the icon's for the tallest
     * smaller box.
     * @param {string} key The icon's key (status-pixels ids).
     * @param {string} family 'basalt' (the 144 px watches) or 'emery'.
     * @param {number} box The rows the bar's icon height paints.
     * @returns {?{w: number, rows: !Array<number>}} The drawing; null for none.
     */
    function forBox(key, family, box) {
        var sizes = PIXELS.icons[key];
        if (!sizes) { return null; }
        var best = null, bestBox = 0;
        Object.keys(sizes).forEach(function (id) {
            var m = /^(\w+)-(\d+)$/.exec(id);
            if (!m || m[1] !== family) { return; }
            var b = Number(m[2]);
            if (b <= box && b > bestBox) { best = sizes[id]; bestBox = b; }
        });
        return best;
    }

    /**
     * Which of the watch's drawings a platform draws: the Pebble Time 2's, the Pebble Classic and
     * Steel's bit masks, or the 144 px watches' (status_pixel_icons.generated.h).
     * @param {Object} env Platform env.
     * @returns {string} 'emery', 'aplite' or 'basalt'.
     */
    function family(env) {
        var p = env && env.platform;
        return p === 'emery' ? 'emery' : p === 'aplite' ? 'aplite' : 'basalt';
    }

    /**
     * An icon as a glyph of the page's (a list's picture, a bar row's icon): the largest drawing
     * the platform's watches draw it with, its lit pixels in currentColor, in a square a pixel
     * wider than its box on each side, as the outlines sit in theirs (status-slot-icons.js).
     * @param {string} key The icon's key (status-pixels ids).
     * @param {Object} env Platform env.
     * @returns {string} An <svg>; '' where those watches have no drawing of it.
     */
    function glyph(key, env) {
        var p = forBox(key, family(env), Infinity);
        if (!p) { return ''; }
        var side = Math.max(p.w, p.rows.length) + 2;
        return '<svg viewBox="' + (p.w - side) / 2 + ' ' + (p.rows.length - side) / 2 + ' ' + side + ' ' + side
            + '" fill="currentColor" shape-rendering="crispEdges"><path d="' + path(p) + '"></path></svg>';
    }

    var api = { path: path, forBox: forBox, family: family, glyph: glyph, pixels: PIXELS };
    if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
    if (typeof window !== 'undefined') { window.PixelIcon = api; }
})();
