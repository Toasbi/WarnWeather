// src/pkjs/settings/status-slot-icons.js — ES5, WebView. The settings page's
// status-slot glyphs: one 24×24 inline-SVG fragment per id, registered into the
// config-ui icon registry (PConf.icons) so a schema row can lead its label with
// the same picture the watch draws in that slot (item.icon: id).
//
// Hand-drawn page copies of the watch's PDC glyphs, NOT generated from them, so
// a redraw on one side has to be carried to the other by hand:
//   rain   -> resources/data/RAIN_*.pdc (the filled teardrop of
//             scripts/gen-rain-pdc.py, one drop, grown to the 24 px frame)
//   uv     -> STATUS_UV.pdc      (sun: octagon core, eight 2 px rays)
//   wind   -> STATUS_WIND.pdc    (three curled wind lines)
//   gust   -> STATUS_GUST.pdc    (windsock — the watch's gust glyph, which is
//             what the row should match, rather than a second wind curl)
//   aqi    -> STATUS_AQI.pdc     (leaf)
//   pollen -> STATUS_POLLEN.pdc  (four-petal flower on a curved stem)
// and the On demand card's System info rows:
//   battery   -> battery_item.c (a battery body with its nub and a low charge bar;
//                the watch draws it procedurally, filled by the charge)
//   bluetooth -> STATUS_BT.pdc      (the Bluetooth rune)
//   quiet     -> STATUS_QUIET.pdc   (a muted speaker, struck through)
//   snooze    -> snooze_draw        (two Z's, the Battery saver hours' glyph)
// The outlines follow Tabler Icons (https://tabler.io/icons), MIT License,
// Copyright (c) 2020-2024 Pawel Kuna — the same family the watch glyphs were
// converted from (credited in scripts/gen-status-pdc.py). Everything is drawn in
// currentColor, so the .lbl-ico rule colours the glyph and the theme flip follows.
//
// Page-only on purpose: status-line-catalog.js also ships in the watch-runtime
// PKJS bundle and schema.js travels as JSON, so the SVG strings live here and the
// schema only names an id.
/* global PConf */
(function () {
    'use strict';

    // The shared outline attributes (Tabler's look at our 1.8 stroke — the weather
    // tab's glyph weight, legible at the 16 px the label icon renders at).
    var OUTLINE = ' fill="none" stroke="currentColor" stroke-width="1.8"'
        + ' stroke-linecap="round" stroke-linejoin="round"';

    /**
     * One registry-ready fragment: a 24×24 svg around the given body.
     * @param {string} attrs Attributes for the root svg (fill/stroke defaults).
     * @param {string} body The shapes inside it.
     * @returns {string} Inline SVG markup.
     */
    function svg24(attrs, body) {
        return '<svg viewBox="0 0 24 24"' + attrs + '>' + body + '</svg>';
    }

    var ICONS = {
        // The watch's rain drop is a pure fill with no outline (gen-rain-pdc.py: a cone
        // from the tip tangent to a round body). Same construction here — tip at y 3,
        // body r 6 centred at (12, 14.5), tangent points at ±58.6° — so the row reads as
        // the strip's rain glyph rather than as one more outline.
        rain: svg24(' fill="currentColor"',
            '<path d="M12 3L17.1 11.4A6 6 0 1 1 6.9 11.4Z"/>'),
        uv: svg24(OUTLINE,
            '<circle cx="12" cy="12" r="4"/>'
            + '<path d="M12 2v2M12 20v2M2 12h2M20 12h2'
            + 'M4.9 4.9l1.5 1.5M17.6 17.6l1.5 1.5M19.1 4.9l-1.5 1.5M6.4 17.6l-1.5 1.5"/>'),
        wind: svg24(OUTLINE,
            '<path d="M5 8h8.5a2.5 2.5 0 1 0 -2.34 -3.24"/>'
            + '<path d="M3 12h15.5a2.5 2.5 0 1 1 -2.34 3.24"/>'
            + '<path d="M4 16h5.5a2.5 2.5 0 1 1 -2.34 3.24"/>'),
        gust: svg24(OUTLINE,
            '<path d="M6 3v18M4 21h4"/>'
            + '<path d="M6 11l12 -1v-4l-12 -1"/>'
            + '<path d="M10 5.5v5M14 6v4"/>'),
        aqi: svg24(OUTLINE,
            '<path d="M5 21c.5 -4.5 2.5 -8 7 -10"/>'
            + '<path d="M9 18c6.2 0 10.5 -3.3 11 -12v-2h-4c-9 0 -12 4 -12 9c0 1 0 3 2 5h3z"/>'),
        // The watch glyph's own polyline (STATUS_POLLEN.pdc, points rounded to 0.1 px):
        // four petals around the stem's top, then the stem curving off to the lower left.
        pollen: svg24(OUTLINE,
            '<path d="M12.5 18.5L14.5 20.1L17.1 19.8L18.6 17.8L18.3 15.3L17.6 14.4'
            + 'L18.8 14.5L21.1 13.5L22 11.1L21.1 8.8L18.6 7.9L17.6 7.9L18.1 7.1L18.5 4.5'
            + 'L17 2.5L14.5 2.1L12.4 3.8L11.9 4.6L11.5 3.8L9.5 2L7 2.4L5.4 4.5L5.9 7'
            + 'L6.4 7.9L5.4 7.8L2.9 8.8L2 11.1L2.9 13.5L5.4 14.4"/>'
            + '<path d="M3.3 22L5.8 20.1L7.8 18.3L9.3 16.4L10.6 14.3L12 12"/>'),
        battery: svg24(OUTLINE,
            '<path d="M6 7h11a2 2 0 0 1 2 2v1h1v4h-1v1a2 2 0 0 1 -2 2h-11a2 2 0 0 1 -2 -2v-6a2 2 0 0 1 2 -2"/>'
            + '<path d="M7.5 10v4"/>'),
        // The watch rune's own outline (docs/superpowers/svg/bluetooth.svg).
        bluetooth: svg24(OUTLINE,
            '<path d="M7 8l10 8l-5 4v-16l5 4l-10 8"/>'),
        // The watch glyph's speaker and slash (docs/superpowers/svg/mute.svg).
        quiet: svg24(OUTLINE,
            '<path d="M4 9h4l5 -5v16l-5 -5h-4z"/>'
            + '<path d="M4 4l16 16"/>'),
        snooze: svg24(OUTLINE,
            '<path d="M4 12h6l-6 8h6"/>'
            + '<path d="M14 4h6l-6 8h6"/>')
    };

    // Register into the engine's icon registry when it is there: always on the page
    // (engine.js is a lib file, concatenated ahead of every app file), and under Node
    // only once a test has loaded the engine — a bare require just exports the map.
    var P = (typeof global !== 'undefined' && global.PConf && global.PConf.icons) ? global.PConf
        : (typeof window !== 'undefined' && window.PConf && window.PConf.icons) ? window.PConf
        : (typeof PConf !== 'undefined' && PConf && PConf.icons) ? PConf
        : null;
    if (P) {
        P.icons.register('rain', ICONS.rain);
        P.icons.register('uv', ICONS.uv);
        P.icons.register('wind', ICONS.wind);
        P.icons.register('gust', ICONS.gust);
        P.icons.register('aqi', ICONS.aqi);
        P.icons.register('pollen', ICONS.pollen);
        P.icons.register('battery', ICONS.battery);
        P.icons.register('bluetooth', ICONS.bluetooth);
        P.icons.register('quiet', ICONS.quiet);
        P.icons.register('snooze', ICONS.snooze);
    }

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = ICONS;
    }
})();
