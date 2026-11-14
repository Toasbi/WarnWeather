// src/pkjs/settings/pixel-icon.js — the weather icons as the watch draws them, for the settings
// page's pictures: a pixel drawing (condition-pixels.generated.js: the ink, a row per number,
// bit x lighting column x) as SVG, every run of lit pixels a filled rectangle, so the page shows
// the very pixels the watch lights. Dual-context: required under Node, window.PixelIcon on the
// page (after condition-pixels.generated.js, ahead of every file that draws one).
(function () {
    'use strict';

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

    var api = { path: path, svg: svg };
    if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
    if (typeof window !== 'undefined') { window.PixelIcon = api; }
})();
