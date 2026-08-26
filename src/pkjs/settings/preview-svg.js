// src/pkjs/settings/preview-svg.js — ES5, WebView. The SVG primitives every
// settings preview draws with: two element emitters (rect/txt), the 200-wide
// frame they are wrapped in, and the theme ink they are coloured from. Every
// member here has more than one caller across preview-forecast.js,
// preview-radar.js and preview-layout.js — a helper used by exactly one of them
// lives in that file instead. Registers nothing; it is a library, not a block.
(function () {
    // Dual-context pattern (see line-style.js): a CommonJS module under Node, a
    // concatenated <script> exposing window.ResolveInk in the webview, where the
    // page bundle has no require(). resolve-ink.js precedes this file in APP_FILES.
    var resolveInkLib = (typeof require !== 'undefined')
        ? require('../resolve-ink.js') : window.ResolveInk;
    var isLightPolarity = resolveInkLib.isLightPolarity;

    /**
     * A filled SVG rect.
     * @param {number} x Left edge.
     * @param {number} y Top edge.
     * @param {number} w Width.
     * @param {number} h Height.
     * @param {string} fill Fill colour (CSS/SVG paint).
     * @returns {string} SVG markup.
     */
    function rect(x, y, w, h, fill) {
        return '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" fill="' + fill + '"></rect>';
    }

    /**
     * An SVG text run in the preview's sans-serif face.
     * @param {number} x Anchor x.
     * @param {number} y Baseline y.
     * @param {number} s Font size.
     * @param {string} fill Text colour.
     * @param {string} anchor text-anchor: start|middle|end.
     * @param {number} weight font-weight.
     * @param {string} t The text itself (already escaped by the caller).
     * @returns {string} SVG markup.
     */
    function txt(x, y, s, fill, anchor, weight, t) {
        return '<text x="' + x + '" y="' + y + '" font-size="' + s + '" fill="' + fill + '" font-family="sans-serif" font-weight="' + weight + '" text-anchor="' + anchor + '">' + t + '</text>';
    }

    /**
     * Theme-aware ink for preview canvases: white-on-black in dark/bw, black-on-white
     * in light/bw-light. Structural chrome only (backgrounds, dividers, axis lines) —
     * hued data colors and the muted gray label/legend palette are untouched (known v1
     * limit: graph hues/data-grays are untuned on light backgrounds).
     * @param {string} theme 'dark'|'light'|'bw'|'bw-light'.
     * @returns {{bg: string, fg: string, rgba: function(number): string}} Theme ink set.
     */
    function previewInk(theme) {
        var light = isLightPolarity(theme);
        return {
            bg: light ? '#FFFFFF' : '#000000',
            fg: light ? '#000000' : '#FFFFFF',
            rgba: function (alpha) {
                return light ? 'rgba(0,0,0,' + alpha + ')' : 'rgba(255,255,255,' + alpha + ')';
            }
        };
    }

    /**
     * Wrap a preview SVG body in the standard 200×h frame. The negative margins
     * cancel the engine .blockrow padding (12px 16px 14px) so the preview bleeds
     * edge-to-edge.
     * @param {string} inner The preview body markup.
     * @param {number} [h=120] Frame height in viewBox units.
     * @returns {string} SVG markup.
     */
    function svgFrame(inner, h) {
        h = h || 120;
        return '<svg viewBox="0 0 200 ' + h + '" style="aspect-ratio:200/' + h
            + ';display:block;width:calc(100% + 32px);margin:-12px -16px -14px">' + inner + '</svg>';
    }

    var api = {
        rect: rect,
        txt: txt,
        previewInk: previewInk,
        svgFrame: svgFrame
    };

    // Dual-context export — mirrors the tail of src/pkjs/status-thresholds.js.
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    if (typeof window !== 'undefined') {
        window.PreviewSvg = api;
    }
})();
