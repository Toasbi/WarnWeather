// src/pkjs/settings/screen-frame.js — ES5, WebView (+ Node for tests). The frame every picture
// of a watch screen sits in: the screen's drawing, or a screenshot of it, on the watch's own
// ground (its black or white), with a margin of that ground all round. The round corners of the
// card that holds a picture then clip only the margin, never a slot or a label on the screen's
// edge rows, and the card reads as one black (or white) screen with no grey or bezel round it.
// Every screen picture draws through it: the Watchface tab's views, the Layout and Clock font
// pictures and the custom layout editor (preview-watch.js), and the setup wizard's screenshots
// and forecast graph (wizard.js). The card round a picture is its caller's.
//
// A card's corner radius clips nothing on the screen while it stays under about 3.4 times the
// margin as drawn: the corner's arc reaches the screen's corner at r = m·√2 / (√2 − 1).
(function () {
    var svgLib = typeof require !== 'undefined' ? require('./preview-svg.js') : window.PreviewSvg;
    // The margin, in the drawing's own pixels: about 6 % of its width, 9 on the 144 px wide
    // screens and 12 on emery's 200.
    var MARGIN = { 144: 9, 200: 12 };
    var XLINK = 'http://www.w3.org/1999/xlink';

    /**
     * The margin a drawing keeps all round.
     * @param {number} w The drawing's width (a screen's: 144, or 200 on emery).
     * @returns {number} The margin, in the drawing's pixels.
     */
    function margin(w) {
        return MARGIN[w] || Math.round(w * 0.0625);
    }

    /**
     * A picture's <svg>: the drawing on its ground, the ground running on its margin all round,
     * in the colours the watch's screen shows (preview-svg.js displayColors), as a screenshot of
     * it has them. The <svg> has no size of its own: the caller's CSS gives it a width (height:
     * auto).
     * @param {number} w The drawing's width.
     * @param {number} h Its height.
     * @param {string} bg The ground, the watch's background ('#000000' or '#FFFFFF').
     * @param {string} inner The drawing, in its own coordinates (0,0 its top-left corner).
     * @param {string} [cls] The <svg>'s class.
     * @returns {string} SVG markup.
     */
    function svg(w, h, bg, inner, cls) {
        var m = margin(w), vw = w + 2 * m, vh = h + 2 * m;
        return '<svg' + (cls ? ' class="' + cls + '"' : '') + ' viewBox="' + (-m) + ' ' + (-m) + ' ' + vw + ' ' + vh
            + '" aria-hidden="true" focusable="false">'
            + '<rect x="' + (-m) + '" y="' + (-m) + '" width="' + vw + '" height="' + vh + '" fill="' + bg + '"></rect>'
            + svgLib.displayColors(inner) + '</svg>';
    }

    /**
     * A screenshot as a framed drawing's content: the bitmap at the screen's own size, its pixels
     * kept square when it scales (image-rendering). Both href forms, for WebViews older than SVG 2's
     * plain href.
     * @param {number} w The screen's width.
     * @param {number} h Its height.
     * @param {string} src The screenshot (a data URI; the caller escapes it for an attribute).
     * @param {string} [attrs] More attributes for the <image> (a class, a data- hook), as markup.
     * @returns {string} SVG markup.
     */
    function image(w, h, src, attrs) {
        return '<image' + (attrs ? ' ' + attrs : '') + ' x="0" y="0" width="' + w + '" height="' + h
            + '" preserveAspectRatio="none" image-rendering="optimizeSpeed" href="' + src + '" xlink:href="' + src
            + '"></image>';
    }

    /**
     * Point a framed screenshot at another bitmap, in place (the setup wizard's pickers).
     * @param {Element} el The <image> (image's markup).
     * @param {string} src The new screenshot.
     * @returns {void}
     */
    function setImage(el, src) {
        el.setAttribute('href', src);
        if (el.setAttributeNS) { el.setAttributeNS(XLINK, 'xlink:href', src); }
    }

    /**
     * The ground of a framed picture, as a later screenshot on it needs (a light theme's is white).
     * @param {Element} svgEl The framed <svg> (svg's markup).
     * @param {string} bg The ground.
     * @returns {void}
     */
    function setGround(svgEl, bg) {
        var rect = svgEl && svgEl.querySelector('rect');
        if (rect) { rect.setAttribute('fill', bg); }
    }

    var api = { margin: margin, svg: svg, image: image, setImage: setImage, setGround: setGround };
    if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
    if (typeof window !== 'undefined') { window.ScreenFrame = api; }
})();
