// src/pkjs/settings/watch-text.js — ES5, WebView (+ Node for tests). The watch's text in the
// settings page's pictures of its screens: a line in one of the six Gothic fonts the watch
// draws with (watch-fonts.generated.js, the firmware's own glyphs as web fonts), measured by
// the glyphs' advances and seated as the firmware seats it — each glyph's bitmap below the
// line's top by its own offset, so the baseline is the font's height below that top. At
// font-size = the height, a watch pixel is a unit of the drawing, so a line lands on the
// pixels the watch lights.
(function () {
    var NODE = typeof module !== 'undefined' && module.exports;
    var WF = NODE ? require('./watch-fonts.generated.js') : window.WatchFonts;
    var esc = NODE ? require('../config-ui/lib/html.js').esc : PConf.html.esc;
    // A character none of the six fonts holds draws in the page's sans instead.
    var FALLBACK = ", Roboto, 'Helvetica Neue', Arial, sans-serif";
    var styled = false;

    /**
     * The firmware font the watch draws at a size.
     * @param {number} size 14 | 18 | 24 (FONT_KEY_GOTHIC_<size>).
     * @param {boolean} [bold] Its _BOLD sibling.
     * @returns {{family: string, weight: number, height: number, missing: number, dense: string,
     *     extra: !Object<string, number>}}
     */
    function font(size, bold) {
        return WF.fonts['GOTHIC_' + size + (bold ? '_BOLD' : '')] || WF.fonts.GOTHIC_18;
    }

    /**
     * How far one character moves the pen: its glyph's advance, or the firmware's wildcard
     * glyph's for a character the font lacks.
     * @param {Object} f A font (font()).
     * @param {number} code A UTF-16 code unit.
     * @returns {number} Pixels.
     */
    function advance(f, code) {
        if (code >= 0x20 && code - 0x20 < f.dense.length) {
            var c = f.dense.charCodeAt(code - 0x20);
            return c === 32 ? f.missing : c - 48;
        }
        return Object.prototype.hasOwnProperty.call(f.extra, code) ? f.extra[code] : f.missing;
    }

    /**
     * A line's width as the watch measures it: the sum of its glyphs' advances.
     * @param {number} size 14 | 18 | 24.
     * @param {boolean} bold Bold face.
     * @param {string} s The text.
     * @returns {number} Pixels.
     */
    function width(size, bold, s) {
        var f = font(size, bold), w = 0, i;
        for (i = 0; i < s.length; i++) { w += advance(f, s.charCodeAt(i)); }
        return w;
    }

    /**
     * The longest start of a line that fits a width, with the firmware's trailing ellipsis
     * (GTextOverflowModeTrailingEllipsis) where it had to cut.
     * @param {number} size 14 | 18 | 24.
     * @param {boolean} bold Bold face.
     * @param {string} s The text.
     * @param {number} maxW The room, in pixels.
     * @returns {string} s itself when it fits.
     */
    function fit(size, bold, s, maxW) {
        if (width(size, bold, s) <= maxW) { return s; }
        var f = font(size, bold), dots = advance(f, 0x2026), w = 0, i;
        for (i = 0; i < s.length; i++) {
            var a = advance(f, s.charCodeAt(i));
            if (w + a + dots > maxW) { break; }
            w += a;
        }
        return i ? s.slice(0, i) + '…' : '';
    }

    /**
     * Put the fonts' @font-face rules on the page once (a page without a document has none to
     * load: Node draws the markup only).
     * @returns {void}
     */
    function ensureStyle() {
        if (styled || typeof document === 'undefined' || !document.getElementById || !document.head) { return; }
        styled = true;
        if (document.getElementById('wtx-fonts')) { return; }
        var el = document.createElement('style');
        el.id = 'wtx-fonts';
        el.textContent = WF.css;
        document.head.appendChild(el);
    }

    /**
     * One line of the watch's text, its left edge and line top given (graphics_draw_text's box
     * origin, alignment already applied by the caller).
     * @param {number} size 14 | 18 | 24.
     * @param {boolean} bold Bold face.
     * @param {number} x Left edge.
     * @param {number} top The line's top (the firmware's text box top).
     * @param {string} fill Colour.
     * @param {string} s The text (escaped here).
     * @param {string} [attrs] More attributes, as markup (an outline's stroke).
     * @returns {string} SVG markup, '' for no text.
     */
    function line(size, bold, x, top, fill, s, attrs) {
        if (!s) { return ''; }
        ensureStyle();
        var f = font(size, bold);
        return '<text x="' + x + '" y="' + (top + f.height) + '" font-size="' + f.height + '" fill="' + fill
            + '" font-family="' + f.family + esc(FALLBACK) + '" font-weight="' + f.weight + '"'
            + (attrs ? ' ' + attrs : '') + '>' + esc(s) + '</text>';
    }

    /**
     * A line drawn in a box as graphics_draw_text draws it: from the box's top, its left edge,
     * centred (the slack halved, rounded down) or against its right edge.
     * @param {number} size 14 | 18 | 24.
     * @param {boolean} bold Bold face.
     * @param {{x: number, y: number, w: number}} box The text box.
     * @param {string} align 'left' | 'center' | 'right'.
     * @param {string} fill Colour.
     * @param {string} s The text.
     * @returns {string} SVG markup.
     */
    function inBox(size, bold, box, align, fill, s) {
        var w = width(size, bold, s);
        var x = align === 'center' ? box.x + Math.floor((box.w - w) / 2) : align === 'right' ? box.x + box.w - w : box.x;
        return line(size, bold, x, box.y, fill, s);
    }

    var api = { font: font, width: width, fit: fit, line: line, inBox: inBox, ensureStyle: ensureStyle };
    if (NODE) { module.exports = api; }
    if (typeof window !== 'undefined') { window.WatchText = api; }
})();
