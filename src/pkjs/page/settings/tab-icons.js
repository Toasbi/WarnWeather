// src/pkjs/page/settings/tab-icons.js — ES5, WebView (+ Node for tests). The tab bar's glyphs,
// one per schema tab (tab.icon), registered in the page's icon registry (PConf.icons) like
// the status slots' (status-slot-icons.js). Line drawings on a 24-unit grid: the bar's CSS
// gives them their stroke (.tab-ico svg: currentColor, 1.9, round caps), so they take the
// tab's colour, the accent on the active one.
/* global PConf */
(function () {
    // The engine's registry, found as status-slot-icons.js finds it: on the page always,
    // under Node only once a test has loaded the engine (a bare require exports the map).
    var P = (typeof global !== 'undefined' && global.PConf && global.PConf.icons) ? global.PConf
        : (typeof window !== 'undefined' && window.PConf && window.PConf.icons) ? window.PConf
        : (typeof PConf !== 'undefined' && PConf && PConf.icons) ? PConf
        : null;

    /**
     * Wrap a glyph's shapes in the bar's 24-unit frame.
     * @param {string} shapes SVG shapes (paths, circles).
     * @returns {string} The <svg> fragment.
     */
    function glyph(shapes) {
        return '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' + shapes + '</svg>';
    }

    var ICONS = {
        // Weather: the sun behind a cloud.
        'tab-weather': glyph('<path d="M11.4 7.6a4.2 4.2 0 0 1 8 3.4"/><path d="M15.5 2.2v1.6M21.6 8.4H20M20 4l-1.1 1.1"/>'
            + '<path d="M6.8 20.5h8.6a3.6 3.6 0 0 0 .4-7.2 5 5 0 0 0-9.7 1.1 3.1 3.1 0 0 0 .7 6.1z"/>'),
        // Watchface: a square watch, its strap above and below, the time on its face.
        'tab-watchface': glyph('<rect x="5.5" y="5.5" width="13" height="13" rx="3"/>'
            + '<path d="M8.6 5.5l.6-3h5.6l.6 3M8.6 18.5l.6 3h5.6l.6-3M9.5 12h5"/>'),
        // Status bars: two rows of values.
        'tab-status': glyph('<rect x="3.5" y="5" width="17" height="5.5" rx="2"/><rect x="3.5" y="13.5" width="17" height="5.5" rx="2"/>'
            + '<path d="M9 5v5.5M15 13.5V19"/>'),
        // Alerts: a warning sign.
        'tab-alerts': glyph('<path d="M10.3 4.2L2.6 17.6A2 2 0 0 0 4.3 20.6h15.4a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0z"/>'
            + '<path d="M12 9.5v4.2M12 17.2v.1"/>'),
        // Graphs: a line rising over an axis.
        'tab-graphs': glyph('<path d="M3.5 3.5v17h17"/><path d="M7.5 15.5l3.6-4.4 3.3 2.6 5.1-6.4"/>'),
        // Setup: three sliders.
        'tab-setup': glyph('<path d="M4 6.5h8M18 6.5h2M4 12h2M10 12h10M4 17.5h11M19 17.5h1"/>'
            + '<circle cx="15" cy="6.5" r="2.3"/><circle cx="8" cy="12" r="2.3"/><circle cx="17" cy="17.5" r="2.3"/>')
    };

    if (P) {
        Object.keys(ICONS).forEach(function (id) { P.icons.register(id, ICONS[id]); });
    }

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { ICONS: ICONS };
    }
})();
