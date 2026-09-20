// src/pkjs/settings/weather-tab-icons.js — the Weather tab's condition-icon
// vocabulary: one hand-drawn 25×25 SVG glyph per normalized icon id
// (weather-tab-model.js's ICONS). Split out of weather-tab-charts.js purely
// for module size; the charts file is the only consumer. ES5, WebView.
(function () {
    'use strict';

    /**
     * The glyph body for a normalized icon id, drawn in a 25×25 frame.
     * `ink` carries the cloud strokes, `sun` the sun, `water` precipitation.
     * @param {string} id Icon id (weather-tab-model.js vocabulary).
     * @param {Object} pal Palette.
     * @returns {string} SVG fragment.
     */
    function iconBody(id, pal) {
        var ink = pal.muted;
        var sun = pal.sun;
        var water = pal.water;
        var cloud = '<path d="M7 17h9a4 4 0 0 0 .8-7.9A5.5 5.5 0 0 0 6.2 10 3.5 3.5 0 0 0 7 17z" fill="none" stroke="'
            + ink + '" stroke-width="1.8" stroke-linejoin="round"/>';
        var sunCore = '<circle cx="12" cy="12" r="4" fill="none" stroke="' + sun + '" stroke-width="1.8"/>'
            + '<g stroke="' + sun + '" stroke-width="1.8" stroke-linecap="round">'
            + '<line x1="12" y1="3" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="21"/>'
            + '<line x1="3" y1="12" x2="5" y2="12"/><line x1="19" y1="12" x2="21" y2="12"/>'
            + '<line x1="5.6" y1="5.6" x2="7" y2="7"/><line x1="17" y1="17" x2="18.4" y2="18.4"/>'
            + '<line x1="18.4" y1="5.6" x2="17" y2="7"/><line x1="7" y1="17" x2="5.6" y2="18.4"/></g>';
        var smallSun = '<circle cx="16.5" cy="7.5" r="3" fill="none" stroke="' + sun + '" stroke-width="1.6"/>'
            + '<g stroke="' + sun + '" stroke-width="1.6" stroke-linecap="round">'
            + '<line x1="16.5" y1="2.2" x2="16.5" y2="3.6"/><line x1="21.8" y1="7.5" x2="20.4" y2="7.5"/>'
            + '<line x1="20.2" y1="3.8" x2="19.2" y2="4.8"/></g>';
        // The moons share the suns' warm ink, so the chip twins recolor
        // them through the same `sun` slot.
        var moonCore = '<path d="M14.8 5.4a7 7 0 1 0 4.7 8.9 5.6 5.6 0 0 1-4.7-8.9z" fill="none" stroke="'
            + sun + '" stroke-width="1.8" stroke-linejoin="round"/>';
        var smallMoon = '<path d="M17.6 3.6a3.4 3.4 0 1 0 2.9 4.9 2.8 2.8 0 0 1-2.9-4.9z" fill="none" stroke="'
            + sun + '" stroke-width="1.6" stroke-linejoin="round"/>';
        var drops = function (n, heavy) {
            var d = '<g stroke="' + water + '" stroke-width="' + (heavy ? 2 : 1.6) + '" stroke-linecap="round">';
            for (var i = 0; i < n; i += 1) {
                var x = 8 + i * 4;
                d += '<line x1="' + x + '" y1="19" x2="' + (x - 1.2) + '" y2="22"/>';
            }
            return d + '</g>';
        };
        if (id === 'clear') { return sunCore; }
        if (id === 'partly') { return smallSun + cloud; }
        // Night twins of the sun-bearing glyphs (see NIGHT below).
        if (id === 'nclear') { return moonCore; }
        if (id === 'npartly') { return smallMoon + cloud; }
        if (id === 'nshowers') { return smallMoon + cloud + drops(2, true); }
        if (id === 'cloudy') { return cloud; }
        if (id === 'fog') {
            return cloud + '<g stroke="' + ink + '" stroke-width="1.6" stroke-linecap="round">'
                + '<line x1="7" y1="19.5" x2="17" y2="19.5"/><line x1="9" y1="22" x2="15" y2="22"/></g>';
        }
        if (id === 'drizzle') { return cloud + drops(2, false); }
        if (id === 'rain') { return cloud + drops(3, true); }
        if (id === 'showers') { return smallSun + cloud + drops(2, true); }
        if (id === 'sleet') {
            return cloud + drops(1, false)
                + '<circle cx="13.5" cy="20.5" r="1.1" fill="none" stroke="' + water + '" stroke-width="1.2"/>';
        }
        if (id === 'snow') {
            return cloud + '<g fill="' + water + '"><circle cx="9" cy="20" r="1.2"/><circle cx="13" cy="21.5" r="1.2"/>'
                + '<circle cx="16.5" cy="19.5" r="1.2"/></g>';
        }
        if (id === 'thunder') {
            return cloud + '<path d="M12 18l-2.5 4h2l-1 3 3.8-4.6h-2.1l1.4-2.4z" fill="' + sun + '"/>';
        }
        return cloud;
    }

    /**
     * A standalone icon svg (the daily tiles).
     * @param {string} id Icon id.
     * @param {number} size Rendered size (px).
     * @param {Object} pal Palette.
     * @returns {string} Inline SVG.
     */
    function iconSvg(id, size, pal) {
        return '<svg viewBox="0 0 25 25" width="' + size + '" height="' + size + '" aria-hidden="true">'
            + iconBody(id, pal) + '</svg>';
    }

    // The sun-bearing ids and their moon twins: render-time variants only
    // (never provider-mapped, so deliberately NOT in the model's ICONS
    // vocabulary). Cloud/rain-only glyphs read fine at night as they are.
    var NIGHT = { clear: 'nclear', partly: 'npartly', showers: 'nshowers' };

    var api = { iconBody: iconBody, iconSvg: iconSvg, NIGHT: NIGHT };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    if (typeof window !== 'undefined') {
        window.WeatherTabIcons = api;
    }
})();
