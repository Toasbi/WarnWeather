// src/pkjs/page/weather/pixel-icon.js — the status icons as the watch draws them, for the settings
// page's pictures of the watch (preview-watch.js): its drawings (status-pixels.generated.js: per
// icon and size, the box as wide as the ink, a row per number, bit x lighting column x, the blank
// rows that seat it kept) as SVG, every run of lit pixels a filled rectangle, so a picture shows
// the very pixels the watch lights, at the size and seat set in the icon creator. The page's
// labels draw outlines instead (status-slot-icons.js, condition-icons.js).
// Dual-context: required under Node, window.PixelIcon on the page (after
// status-line-catalog.js and status-pixels.generated.js, which it binds while its body runs,
// ahead of plugin-value-page.js and preview-watch.js).
(function () {
    'use strict';

    var node = typeof require !== 'undefined';
    var PIXELS = node ? require('../../settings/status-pixels.generated.js')
        : (typeof window !== 'undefined' && window.StatusPixels) || {icons: {}, ids: {}};
    var ICONS = node ? require('../../status-bars/domain/status-line-catalog.js').ICONS
        : (typeof window !== 'undefined' && window.StatusLineCatalog && window.StatusLineCatalog.ICONS) || {};
    // The key of each status icon id's drawings (status-line-catalog.js ICONS), which the drawings
    // list under the id's status_line.h name.
    var KEY_OF_ICON = {};
    Object.keys(ICONS).forEach(function (name) {
        var key = PIXELS.ids['STATUS_ICON_' + name];
        if (key) { KEY_OF_ICON[ICONS[name]] = key; }
    });

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
     * @param {number} id A status icon id, as a bake packs it (status-line-catalog.js ICONS).
     * @returns {?string} The key of the watch's drawings of it (status-pixels ids); null for an id
     *   that loads none: a text-only one, or a glyph the watch draws in code.
     */
    function keyOfIcon(id) {
        return KEY_OF_ICON[id] || null;
    }

    var api = { path: path, forBox: forBox, family: family, keyOfIcon: keyOfIcon, pixels: PIXELS };
    if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
    if (typeof window !== 'undefined') { window.PixelIcon = api; }
})();
