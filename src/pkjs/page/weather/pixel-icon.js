// src/pkjs/page/weather/pixel-icon.js — the status icons as the watch draws them, for the settings
// page's pictures: its drawings (status-pixels.generated.js: per icon and size, the box as wide as
// the ink, a row per number, bit x lighting column x, the blank rows that seat it kept) as SVG,
// every run of lit pixels a filled rectangle, so the page shows the very pixels the watch lights.
// Dual-context: required under Node, window.PixelIcon on the page (after
// status-pixels.generated.js, ahead of every file that draws one).
(function () {
    'use strict';

    var PIXELS = (typeof require !== 'undefined') ? require('../../settings/status-pixels.generated.js')
        : (typeof window !== 'undefined' && window.StatusPixels) || {icons: {}, ids: {}};
    // The drawing the page labels an icon with: the 144 px watches' 13-row box, an icon the
    // Pebble Time 2 alone draws its own 13-row one.
    var LABEL_SIZES = ['basalt-13', 'emery-13'];

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
     * A pixel drawing as an <svg> that fills the box it is given (its viewBox the drawing's
     * own), in the current colour.
     * @param {?{w: number, rows: !Array<number>}} p The drawing.
     * @returns {string} SVG markup; '' for none.
     */
    function svg(p) {
        if (!p) { return ''; }
        return '<svg viewBox="0 0 ' + p.w + ' ' + p.rows.length + '" shape-rendering="crispEdges" aria-hidden="true">'
            + '<path fill="currentColor" d="' + path(p) + '"/></svg>';
    }

    /**
     * A drawing's ink alone: its blank rows above and below, its seat, left out.
     * @param {?{w: number, rows: !Array<number>}} p The drawing.
     * @returns {?{w: number, rows: !Array<number>}} Its ink; null for none or a blank one.
     */
    function ink(p) {
        if (!p) { return null; }
        var top = 0, bottom = p.rows.length;
        while (top < bottom && !p.rows[top]) { top++; }
        while (bottom > top && !p.rows[bottom - 1]) { bottom--; }
        return top < bottom ? {w: p.w, rows: p.rows.slice(top, bottom)} : null;
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
     * An icon's drawing for a label on the page: its ink at LABEL_SIZES.
     * @param {string} key The icon's key.
     * @returns {?{w: number, rows: !Array<number>}} The ink; null for none.
     */
    function label(key) {
        var sizes = PIXELS.icons[key] || {};
        for (var i = 0; i < LABEL_SIZES.length; i++) {
            if (sizes[LABEL_SIZES[i]]) { return ink(sizes[LABEL_SIZES[i]]); }
        }
        return null;
    }

    /**
     * A weather condition glyph's label drawing, by the glyph's name (STATUS_ICON_COND_<name>:
     * SUN_CLOUD, RAIN).
     * @param {string} name The glyph's name.
     * @returns {?{w: number, rows: !Array<number>}} The ink; null for none.
     */
    function condition(name) {
        var key = PIXELS.ids['STATUS_ICON_COND_' + name];
        return key ? label(key) : null;
    }

    var api = { path: path, svg: svg, ink: ink, forBox: forBox, label: label, condition: condition, pixels: PIXELS };
    if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
    if (typeof window !== 'undefined') { window.PixelIcon = api; }
})();
