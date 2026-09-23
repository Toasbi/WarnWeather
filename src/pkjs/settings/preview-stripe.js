// src/pkjs/settings/preview-stripe.js — ES5, WebView. The stripe look the settings
// previews draw — chart_stripe.h mirrored: a value's level, the colour cell (tint +
// full-colour vertical lines that tighten with the level) and the four B&W dither
// densities. Shared by the forecast preview's stripe line style and the radar
// preview's sky rows, so both draw exactly what the watch's chart_stripe_fill_cell
// does. test/c/chart_stripe_test.c pins the C side; test/config-blocks.test.js this.
(function () {
    var svg = (typeof require !== 'undefined') ? require('./preview-svg.js') : window.PreviewSvg;
    var rect = svg.rect;

    // chart_stripe.h's colour pattern: the tint level under each pattern level, and
    // the line spacing (every Nth watch pixel column) per level.
    var TINT = [0, 0, 1, 2, 4];
    var EVERY = [0, 5, 3, 2, 1];

    /**
     * A wire byte's stripe level, 0..4 — chart_stripe_level(v, 0, 250).
     * @param {number} b Byte 0..250 (0 draws nothing).
     * @returns {number} Level 0..4.
     */
    function levelOfByte(b) {
        return b <= 0 ? 0 : Math.min(4, Math.floor((b * 4 + 249) / 250));
    }

    /**
     * The tint for one level: each 2-bit Pebble channel blended from the background
     * toward the line colour in quarter steps, rounded half away from the background
     * — chart_stripe_blend.
     * @param {string} bgHex Background '#RRGGBB'.
     * @param {string} fgHex Line colour '#RRGGBB'.
     * @param {number} level 0..4 (0 is the background itself).
     * @returns {string} '#RRGGBB'.
     */
    function blend(bgHex, fgHex, level) {
        var out = '#', sh, b, c, d, v, hx;
        for (sh = 16; sh >= 0; sh -= 8) {
            b = (parseInt(bgHex.slice(1), 16) >> sh & 0xFF) >> 6;
            c = (parseInt(fgHex.slice(1), 16) >> sh & 0xFF) >> 6;
            d = (c - b) * level;
            v = b + (d >= 0 ? Math.floor((d + 2) / 4) : -Math.floor((-d + 2) / 4));
            hx = (v * 0x55).toString(16).toUpperCase();
            out += hx.length < 2 ? '0' + hx : hx;
        }
        return out;
    }

    /**
     * Whether watch pixel column px carries a full-colour line at this level —
     * chart_stripe_line_on: every 5th, 3rd, 2nd column, then solid.
     * @param {number} level 1..4.
     * @param {number} px Watch pixel column.
     * @returns {boolean} True when the column is lined.
     */
    function lineOn(level, px) {
        if (level >= 4) { return true; }
        return px % EVERY[level] === 0;
    }

    /**
     * One stripe cell at a level — chart_stripe_fill_cell. Colour: the tint, then
     * the full-colour vertical lines (one watch pixel column = 2 preview units). B&W:
     * the `<prefix>1`..`<prefix>4` dither pattern (see ditherDefs).
     * @param {boolean} isColor Effective colour render?
     * @param {number} x Cell left.
     * @param {number} y Cell top.
     * @param {number} w Cell width.
     * @param {number} h Cell height.
     * @param {string} color Line colour (hex).
     * @param {number} level 0..4 (0 draws nothing).
     * @param {string} bgHex Background '#RRGGBB'.
     * @param {string} prefix Dither pattern id prefix.
     * @returns {string} SVG markup.
     */
    function cell(isColor, x, y, w, h, color, level, bgHex, prefix) {
        if (level <= 0) { return ''; }
        if (!isColor) { return rect(x, y, w, h, 'url(#' + prefix + level + ')'); }
        var out = rect(x, y, w, h, blend(bgHex, color, TINT[level]));
        if (level >= 4) { return out; }
        for (var px = Math.ceil(x / 2); px * 2 < x + w; px += 1) {
            if (lineOn(level, px)) {
                out += rect(px * 2, y, Math.min(2, x + w - px * 2), h, color);
            }
        }
        return out;
    }

    /**
     * The four B&W dither densities as 2x2 SVG patterns (`<prefix>1`..`<prefix>4`)
     * — chart_stripe_dither_on: one pixel in four, a checkerboard, three in four,
     * solid.
     * @param {string} fgHex The ink colour.
     * @param {string} prefix Pattern id prefix.
     * @returns {string} SVG pattern defs.
     */
    function ditherDefs(fgHex, prefix) {
        var CELLS = [[[0, 0]], [[0, 0], [1, 1]], [[0, 0], [1, 0], [0, 1]],
            [[0, 0], [1, 0], [0, 1], [1, 1]]];
        var out = '', l, c;
        for (l = 0; l < CELLS.length; l += 1) {
            out += '<pattern id="' + prefix + (l + 1) + '" width="2" height="2" patternUnits="userSpaceOnUse">';
            for (c = 0; c < CELLS[l].length; c += 1) {
                out += '<rect x="' + CELLS[l][c][0] + '" y="' + CELLS[l][c][1]
                    + '" width="1" height="1" fill="' + fgHex + '" shape-rendering="crispEdges"></rect>';
            }
            out += '</pattern>';
        }
        return out;
    }

    var api = {
        levelOfByte: levelOfByte,
        blend: blend,
        lineOn: lineOn,
        cell: cell,
        ditherDefs: ditherDefs
    };
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    if (typeof window !== 'undefined') {
        window.PreviewStripe = api;
    }
})();
