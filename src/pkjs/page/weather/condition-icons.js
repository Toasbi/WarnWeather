// src/pkjs/page/weather/condition-icons.js — ES5, WebView. The weather condition icons the
// settings page draws: the weather condition slot's (its list of conditions, and the condition
// and City slots in the pictures of the watch, status-slot-icons.js) and the rain alert's (the
// Alerts tab, the rain radar preview). Outline SVGs on a 24-unit grid in the page's icon family
// (status-slot-icons.js' OUTLINE): Tabler Icons' own where Tabler has the weather (sun, moon,
// cloud, fog, haze, rain, snow, storm, wind); drizzle, sleet and hail on Tabler's rain cloud with
// what falls from it; and a sun or a moon peeking from behind a smaller cloud, composed as 3.1.1's
// watch glyphs were (scripts/gen-condition-glyphs.py, before the pixel drawings), fitted to the
// grid. The owner's ask, 2026-11-15: proper SVGs on the page; the watch's own drawings another
// time. Tabler Icons (https://tabler.io/icons), MIT License, Copyright (c) 2020-2024 Paweł Kuna.
//
// Dual-context: required under Node, window.ConditionIcons on the page (scripts/build-config-page.js
// APP_FILES, ahead of every file that draws one).
(function () {
    'use strict';

    // The family's stroke (status-slot-icons.js OUTLINE).
    var STROKE = 1.8;
    var OUTLINE = ' fill="none" stroke="currentColor" stroke-width="' + STROKE + '"'
        + ' stroke-linecap="round" stroke-linejoin="round"';

    // Tabler's cloud, closed (cloud).
    var CLOUD = 'M6.657 18c-2.572 0 -4.657 -2.007 -4.657 -4.483c0 -2.475 2.085 -4.482 4.657 -4.482'
        + 'c.393 -1.762 1.794 -3.2 3.675 -3.773c1.88 -.572 3.956 -.193 5.444 1c1.488 1.19 2.162 3.007 1.77 4.769'
        + 'h.99c1.913 0 3.464 1.56 3.464 3.486c0 1.927 -1.551 3.487 -3.465 3.487h-11.878';
    // Tabler's rain cloud, open at the bottom for what falls from it (cloud-rain, cloud-snow).
    var OPEN_CLOUD = 'M7 18a4.6 4.4 0 0 1 0 -9a5 4.5 0 0 1 11 2h1a3.5 3.5 0 0 1 0 7';
    // Tabler's moon.
    var MOON = 'M12 3c.132 0 .263 0 .393 0a7.5 7.5 0 0 0 7.92 12.446a9 9 0 1 1 -8.313 -12.454z';
    // The sun peeking out over the cloud's upper left: its ring from 95 to 355 degrees (y down)
    // around (8.5, 8.5), r 3.2, and five rays from r 4.6 to 6.3 at 135 to 315 degrees.
    var SUN_PEEK = 'M8.221 11.688A3.2 3.2 0 1 1 11.688 8.221M5.247 11.753L4.045 12.955M3.9 8.5L2.2 8.5'
        + 'M5.247 5.247L4.045 4.045M8.5 3.9L8.5 2.2M11.753 5.247L12.955 4.045';

    /**
     * @param {string} d Path data.
     * @returns {string} The path.
     */
    function path(d) {
        return '<path d="' + d + '"/>';
    }

    /**
     * Shapes drawn at `s` times their size, from (tx, ty), with strokes as wide as the others':
     * the group's stroke widened by the scale it is drawn at (`outer`, the scale of the group it
     * sits in).
     * @param {number} tx X offset. @param {number} ty Y offset.
     * @param {number} s Its scale. @param {number} outer The scale around it (1 for none).
     * @param {string} body The shapes.
     * @returns {string} SVG markup.
     */
    function scaled(tx, ty, s, outer, body) {
        return '<g transform="translate(' + tx + ' ' + ty + ') scale(' + s + ')" stroke-width="'
            + Math.round(STROKE / (s * outer) * 1000) / 1000 + '">' + body + '</g>';
    }

    // Each glyph's shapes (condition.js CONDITIONS glyph, less its COND_), inside a 24-unit box.
    var BODIES = {
        SUN: path('M12 12m-4 0a4 4 0 1 0 8 0a4 4 0 1 0 -8 0')
            + path('M3 12h1m8 -9v1m8 8h1m-9 8v1m-6.4 -15.4l.7 .7m12.1 -.7l-.7 .7m0 11.4l.7 .7m-12.1 -.7l-.7 .7'),
        MOON: path(MOON),
        // The two peeking glyphs fitted to the grid as a whole (their ink box 20 wide, centred).
        SUN_CLOUD: scaled(-0.072, 1.613, 0.942, 1,
            path(SUN_PEEK) + scaled(7.6, 6.9, 0.72, 0.942, path(CLOUD))),
        MOON_CLOUD: scaled(-0.77, 0.873, 0.971, 1,
            scaled(1.2, 1.4, 0.55, 0.971, path(MOON)) + scaled(7.6, 6.9, 0.72, 0.971, path(CLOUD))),
        CLOUD: path(CLOUD),
        FOG: path('M7 16a4.6 4.4 0 0 1 0 -9a5 4.5 0 0 1 11 2h1a3.5 3.5 0 0 1 0 7h-12') + path('M5 20l14 0'),
        HAZE: path('M3 12h1') + path('M12 3v1') + path('M20 12h1') + path('M5.6 5.6l.7 .7')
            + path('M18.4 5.6l-.7 .7') + path('M8 12a4 4 0 1 1 8 0') + path('M3 16h18') + path('M3 20h18'),
        // Rain's drops halved.
        DRIZZLE: path(OPEN_CLOUD) + path('M11 14v1m0 3v1m4 -4v1m0 3v1'),
        RAIN: path(OPEN_CLOUD) + path('M11 13v2m0 3v2m4 -5v2m0 3v2'),
        // A rain drop beside snow.
        SLEET: path(OPEN_CLOUD) + path('M11 13v2m0 3v2') + path('M15 16v.01m0 3v.01'),
        SNOW: path(OPEN_CLOUD) + path('M11 15v.01m0 3v.01m0 3v.01m4 -4v.01m0 3v.01'),
        // Stones twice the snow's dots.
        HAIL: path(OPEN_CLOUD) + '<circle cx="11" cy="15" r="1.1"/><circle cx="15" cy="17.5" r="1.1"/>'
            + '<circle cx="11" cy="20" r="1.1"/>',
        THUNDER: path('M7 18a4.6 4.4 0 0 1 0 -9a5 4.5 0 0 1 11 2h1a3.5 3.5 0 0 1 0 7h-1') + path('M13 14l-2 4l3 0l-2 4'),
        WIND: path('M5 8h8.5a2.5 2.5 0 1 0 -2.34 -3.24') + path('M3 12h15.5a2.5 2.5 0 1 1 -2.34 3.24')
            + path('M4 16h5.5a2.5 2.5 0 1 1 -2.34 3.24')
    };

    /**
     * A glyph's shapes alone, for a picture that draws them into its own frame: the caller puts
     * them in a group that gives them the family's outline (OUTLINE) and maps the 24-unit box to
     * where it goes (preview-radar.js rainIcon).
     * @param {string} key A glyph: 'SUN', 'RAIN', … (condition.js glyph less COND_).
     * @returns {string} SVG markup; '' for no such glyph.
     */
    function body(key) {
        return BODIES[key] || '';
    }

    /**
     * A glyph as an <svg> in the current colour.
     * @param {string} key A glyph: 'SUN', 'RAIN', … (condition.js glyph less COND_).
     * @param {number} [size] Its width and height in px; none: it fills the box it is put in.
     * @returns {string} SVG markup; '' for no such glyph.
     */
    function svg(key, size) {
        if (!BODIES[key]) { return ''; }
        return '<svg viewBox="0 0 24 24"' + (size ? ' width="' + size + '" height="' + size + '"' : '')
            + OUTLINE + ' aria-hidden="true">' + BODIES[key] + '</svg>';
    }

    var api = { KEYS: Object.keys(BODIES), OUTLINE: OUTLINE, body: body, svg: svg };
    if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
    if (typeof window !== 'undefined') { window.ConditionIcons = api; }
})();
