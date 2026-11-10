// src/pkjs/settings/preview-svg.js — ES5, WebView. The SVG primitives every
// settings preview draws with: two element emitters (rect/txt), the 200-wide
// frame they are wrapped in, and the theme ink they are coloured from. Every
// member here has more than one caller across preview-forecast.js,
// preview-radar.js, preview-health.js and preview-watch.js — a helper used by
// exactly one of them lives in that file instead. Registers nothing; it is a library, not a block.
(function () {
    // Dual-context pattern (see line-style.js): a CommonJS module under Node, a
    // concatenated <script> exposing window.ResolveInk in the webview, where the
    // page bundle has no require(). resolve-ink.js precedes this file in APP_FILES.
    var resolveInkLib = (typeof require !== 'undefined')
        ? require('../resolve-ink.js') : window.ResolveInk;
    var isLightPolarity = resolveInkLib.isLightPolarity;

    // How the watch's screen shows each of its 64 colours: pebble-tool's screenshot colour
    // correction (commands/screenshot.py _correct_colours), which every screenshot of the watch
    // carries. Black and white, which it keeps, are left out. A preview draws in the watch's
    // own colours, the ones its colour pickers show; a picture of the watch's screen
    // (screen-frame.js) shows them as the screen does (displayColors).
    var DISPLAY = {
        '000055': '001E41', '0000AA': '004387', '0000FF': '0068CA', '005500': '2B4A2C', '005555': '27514F',
        '0055AA': '16638D', '0055FF': '007DCE', '00AA00': '5E9860', '00AA55': '5C9B72', '00AAAA': '57A5A2',
        '00AAFF': '4CB4DB', '00FF00': '8EE391', '00FF55': '8EE69E', '00FFAA': '8AEBC0', '00FFFF': '84F5F1',
        '550000': '4A161B', '550055': '482748', '5500AA': '40488A', '5500FF': '2F6BCC', '555500': '564E36',
        '555555': '545454', '5555AA': '4F6790', '5555FF': '4180D0', '55AA00': '759A64', '55AA55': '759D76',
        '55AAAA': '71A6A4', '55AAFF': '69B5DD', '55FF00': '9EE594', '55FF55': '9DE7A0', '55FFAA': '9BECC2',
        '55FFFF': '95F6F2', 'AA0000': '99353F', 'AA0055': '983E5A', 'AA00AA': '955694', 'AA00FF': '8F74D2',
        'AA5500': '9D5B4D', 'AA5555': '9D6064', 'AA55AA': '9A7099', 'AA55FF': '9587D5', 'AAAA00': 'AFA072',
        'AAAA55': 'AEA382', 'AAAAAA': 'ABABAB', 'AAAAFF': 'A7BAE2', 'AAFF00': 'C9E89D', 'AAFF55': 'C9EAA7',
        'AAFFAA': 'C7F0C8', 'AAFFFF': 'C3F9F7', 'FF0000': 'E35462', 'FF0055': 'E25874', 'FF00AA': 'E16AA3',
        'FF00FF': 'DE83DC', 'FF5500': 'E66E6B', 'FF5555': 'E6727C', 'FF55AA': 'E37FA7', 'FF55FF': 'E194DF',
        'FFAA00': 'F1AA86', 'FFAA55': 'F1AD93', 'FFAAAA': 'EFB5B8', 'FFAAFF': 'ECC3EB', 'FFFF00': 'FFEEAB',
        'FFFF55': 'FFF1B5', 'FFFFAA': 'FFF6D3'
    };

    /**
     * A drawing in the colours the watch's screen shows: each of the watch's 64 colours, written
     * #RRGGBB as a paint, swapped for its DISPLAY shade (a reference like url(#id) is left be).
     * @param {string} markup SVG markup in the watch's colours.
     * @returns {string} The markup as the screen shows it.
     */
    function displayColors(markup) {
        return String(markup || '').replace(/#([0-9A-Fa-f]{6})(?=["';),\s]|$)/g, function (m, hex, at, all) {
            var shade = all.charAt(at - 1) === '(' ? null : DISPLAY[hex.toUpperCase()];
            return shade ? '#' + shade : m;
        });
    }

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
     * edge-to-edge; with `bleed: false` (a box of its own, the setup wizard's card) it
     * just fills its box's width.
     * @param {string} inner The preview body markup.
     * @param {number} [h=120] Frame height in viewBox units.
     * @param {{bleed: boolean}} [opts] `bleed: false` drops the margins.
     * @returns {string} SVG markup.
     */
    function svgFrame(inner, h, opts) {
        h = h || 120;
        var fit = (opts && opts.bleed === false) ? 'width:100%' : 'width:calc(100% + 32px);margin:-12px -16px -14px';
        return '<svg viewBox="0 0 200 ' + h + '" style="aspect-ratio:200/' + h
            + ';display:block;' + fit + '">' + inner + '</svg>';
    }

    /**
     * Take a preview svgFrame drew apart again: its frame height and its body, for a
     * picture that places the preview inside one of its own boxes (the Watchface tab's
     * watch draws each graph band from its preview). Kept beside svgFrame so the two
     * cannot drift (test/preview-svg.test.js round-trips them).
     * @param {string} svg One svgFrame result.
     * @returns {?{h: number, inner: string}} null for anything svgFrame did not draw.
     */
    function unframe(svg) {
        var m = /^<svg viewBox="0 0 200 ([0-9.]+)" style="[^"]*">([\s\S]*)<\/svg>$/.exec(String(svg || ''));
        return m ? { h: Number(m[1]), inner: m[2] } : null;
    }

    /**
     * Give a drawing's ids a tag of their own, and every reference to them (url(#…), href="#…"),
     * so several drawings on one page never share a pattern or a clip: a page that shows the same
     * preview twice (the Watchface tab's graph bands, the graphs' pictures) would otherwise paint
     * every copy with the first one's.
     * @param {string} markup SVG markup.
     * @param {string} tag The suffix, unique on the page (letters, digits and '-').
     * @returns {string} The markup with every id "<id>-<tag>".
     */
    function tagIds(markup, tag) {
        return String(markup || '').replace(/id="([^"]+)"/g, 'id="$1-' + tag + '"')
            .replace(/url\(#([^)]+)\)/g, 'url(#$1-' + tag + ')')
            .replace(/href="#([^"]+)"/g, 'href="#$1-' + tag + '"');
    }

    var api = {
        rect: rect,
        txt: txt,
        displayColors: displayColors,
        previewInk: previewInk,
        svgFrame: svgFrame,
        unframe: unframe,
        tagIds: tagIds
    };

    // Dual-context export — mirrors the tail of src/pkjs/status-thresholds.js.
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    if (typeof window !== 'undefined') {
        window.PreviewSvg = api;
    }
})();
