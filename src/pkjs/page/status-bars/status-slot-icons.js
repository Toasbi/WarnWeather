// src/pkjs/page/status-bars/status-slot-icons.js — ES5, WebView. The settings page's
// status-slot glyphs: one 24×24 inline-SVG fragment per id, registered into the
// config-ui icon registry (PConf.icons) so a schema row can lead its label with
// the same picture the watch draws in that slot (item.icon: id).
//
// Hand-drawn page copies of 3.1.1's PDC glyphs (the watch's status icons before
// the pixel drawings, named below), NOT generated from the watch's drawings, so
// a redraw on one side has to be carried to the other by hand (the weather ones,
// the rain alert's and the condition slot's, are condition-icons.js', below):
//   uv     -> STATUS_UV.pdc      (sun: octagon core, eight 2 px rays)
//   wind   -> STATUS_WIND.pdc    (three curled wind lines)
//   gust   -> STATUS_GUST.pdc    (windsock — the watch's gust glyph, which is
//             what the row should match, rather than a second wind curl)
//   aqi    -> STATUS_AQI.pdc     (leaf)
//   pollen -> STATUS_POLLEN.pdc  (four-petal flower on a curved stem)
// and the Alert settings card's System info rows (all ten also draw the Status slots
// tab's read-only Alerts rows, by on-demand.js ITEMS icon):
//   battery   -> battery_item.c (a battery body with its nub and a low charge bar;
//                the watch draws it procedurally, filled by the charge)
//   bluetooth -> STATUS_BT.pdc      (the Bluetooth rune)
//   quiet     -> STATUS_QUIET.pdc   (a muted speaker, struck through)
//   snooze    -> snooze_draw        (two Z's, the Battery saver hours' glyph)
// and the rest of the slot items the watch draws a glyph for, so the Status bars tab's
// preview shows every one of them. The pictures of the watch (preview-watch.js) draw the
// watch's own drawings instead (pixel-icon.js), at each bar's box and seat. These
// are the PDCs' own polylines, points rounded to 0.1 px (the 25-unit health glyphs
// fitted to the family's 20-unit ink, 22 wide at most, centred in the 24 frame):
//   temp         -> STATUS_TEMP.pdc          (thermometer)
//   dew          -> STATUS_DEW.pdc           (two drops)
//   countdown    -> STATUS_COUNTDOWN.pdc     (a calendar page with day dots)
//   phoneBattery -> STATUS_PHONE_BATTERY.pdc (a phone with a bolt)
//   distance     -> STATUS_DISTANCE.pdc      (a route between two stops)
//   steps        -> HEALTH_STEPS.pdc         (a shoe)
//   sleep        -> HEALTH_SLEEP.pdc         (a pillow with a Z)
//   hr           -> HEALTH_HEART.pdc         (the plain heart)
//   sun          -> status_row.c ARROW_PATH_INFO (the drawn sunrise/sunset arrow, a stem
//                   and a filled head, pointing down: the samples read a sunset)
// and the Plugin value's icons in each form the slot draws them in (plugin-value-page.js reads
// them here: the Icon row's pictures and the Status bars tab's rows), each from the icon the
// watch's drawings of it started from (scripts/pixel-icons/THIRD_PARTY.md); its Bluetooth on,
// Phone and Calendar are bluetooth, phoneBattery and countdown above:
//   switchOn, switchOff -> Tabler's toggle-right and toggle-left (SWITCH, SWITCH_OFF)
//   wifi, wifiOff       -> Tabler's wifi and wifi-off (WIFI, WIFI_OFF)
//   bluetoothOff        -> Tabler's bluetooth-off: the rune above, struck through (BT_OFF)
//   plug                -> Lucide's plug (PLUG): Lucide (https://lucide.dev), ISC License,
//                          Copyright (c) 2026 Lucide Icons and Contributors
//   tide                -> drawn after the watch's own drawing (TIDE): a wave curling over,
//                          a ripple under it
// The other outlines follow Tabler Icons (https://tabler.io/icons), MIT License,
// Copyright (c) 2020-2024 Pawel Kuna — the same family the watch glyphs were
// converted from. Everything is drawn in
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

    // The weather icons: the condition slot's (condition-icons.js, Tabler's weather in this
    // family; the owner's ask, 2026-11-15: proper SVGs, the watch's own pixel drawings another
    // time).
    var CONDITION = (typeof require !== 'undefined') ? require('../weather/condition-icons.js')
        : window.ConditionIcons;

    var ICONS = {
        // The rain alert's icon: the watch draws the rain cloud of the weather condition
        // slot (its Drizzle, Rain or Heavy rain drawing), in the foreground like every
        // other icon. The rows show the Rain one.
        rain: CONDITION.svg('RAIN'),
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
        // The old watch glyph's own polyline (STATUS_POLLEN.pdc, points rounded to 0.1 px):
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
            + '<path d="M14 4h6l-6 8h6"/>'),
        // The slot glyphs the watch draws from its PDCs (see the header): their own
        // polylines, so a slot in the preview shows the picture the watch puts there.
        temp: svg24(OUTLINE,
            '<path d="M10.5 2L13.5 2L15.1 3.5L15.1 14.2L16.6 15.9L16.6 20.5L15.1 22L8.9 22L7.4 20.5L7.4 15.9L8.9 14.2L8.9 3.5Z"/>'
            + '<path d="M12 5.1L12 18.9"/>'
            + '<path d="M10.5 15.9L10.5 18.9"/>'
            + '<path d="M13.5 15.9L13.5 18.9"/>'),
        dew: svg24(OUTLINE,
            '<path d="M6.8 16L8.9 15.4L10.4 13.9L11 11.8L10.5 10L9.1 8.4L7.6 6.6L6.8 4.4L5.9 6.6L4.4 8.4L3 10L2.5 11.8L3.1 13.9L4.6 15.4L6.8 16Z"/>'
            + '<path d="M12.6 5.8L13.5 4L14.1 2L15 4.6L16.4 6.9L18.4 8.9L20.1 10.6L21.1 12.6L21.5 14.6L21.1 17.1L19.9 19.2L18.1 20.9L15.8 21.9L13.4 22L11 21.4L8.9 19.9"/>'),
        countdown: svg24(OUTLINE,
            '<path d="M3.1 6.5L3.8 4.9L5.4 4.2L18.6 4.2L20.2 4.9L20.9 6.5L20.9 19.8L20.2 21.4L18.6 22L5.4 22L3.8 21.4L3.1 19.8L3.1 6.5"/>'
            + '<path d="M16.5 2L16.5 6.5"/>'
            + '<path d="M7.5 2L7.5 6.5"/>'
            + '<path d="M3.1 10.9L20.9 10.9"/>'
            + '<path d="M6.5 14.2h0"/>'
            + '<path d="M9.8 14.2h0"/>'
            + '<path d="M13.1 14.2h0"/>'
            + '<path d="M16.5 14.2h0"/>'
            + '<path d="M13.1 17.5h0"/>'
            + '<path d="M6.5 17.5h0"/>'
            + '<path d="M9.8 17.5h0"/>'),
        phoneBattery: svg24(OUTLINE,
            '<path d="M5.4 4.2L6 2.6L7.5 2L16.5 2L18 2.6L18.6 4.2L18.6 19.8L18 21.4L16.5 22L7.5 22L6 21.4L5.4 19.8L5.4 4.2"/>'
            + '<path d="M10.9 3.1L13.1 3.1"/>'
            + '<path d="M12 9.2L10.9 12L13.1 12L12 14.8"/>'),
        distance: svg24(OUTLINE,
            '<path d="M2 20L3.1 22L5.4 22L6.5 20L5.4 18.1L3.1 18.1L2 20"/>'
            + '<path d="M20 6.5L22 5.4L22 3.1L20 2L18.1 3.1L18.1 5.4L20 6.5"/>'
            + '<path d="M11 20L17.2 20L20 18.9L21.1 16.1L20 13.2L17.2 12.1L8.2 12.1L5.4 11L4.2 8.2L5.4 5.4L8.2 4.2L13.2 4.2"/>'),
        steps: svg24(OUTLINE,
            '<path d="M1 18.5L1 6.5L6 8.5L10 5.5L15 10.5L23 14.5L23 18.5Z"/>'
            + '<path d="M10 10.5L12 8.5"/>'
            + '<path d="M13 12.5L15 10.5"/>'
            + '<path d="M1 14.5L15 15.5"/>'
            + '<path d="M15 18.5L17 11.5"/>'),
        sleep: svg24(OUTLINE,
            '<path d="M3.9 22L3.9 18.2L2.6 17L2.6 5.8L6.4 2L17.6 2L21.4 5.8L21.4 17L17.6 20.8L6.4 20.8Z"/>'
            + '<path d="M16.4 15.8L7.6 15.8"/>'
            + '<path d="M16.4 7L7.6 7"/>'
            + '<path d="M7.6 15.8L16.4 7"/>'),
        hr: svg24(OUTLINE,
            '<path d="M12 22L21.5 12.5L21.5 6.8L16.8 2L12 6.8L7.2 2L2.5 6.8L2.5 12.5L12 22Z"/>'),
        // The drawn sunrise/sunset arrow (status_row.c ARROW_PATH_INFO, 8 px tall: a
        // stem, a head 3 px tall and 2 px either side, outline and fill), at 2.5x.
        sun: svg24(OUTLINE,
            '<path d="M12 2v12.5"/>'
            + '<path d="M7 14.5L12 22L17 14.5Z" fill="currentColor"/>'),
        // The weather condition slot's sample, a partly cloudy afternoon (the city's weather
        // icon too).
        condition: CONDITION.svg('SUN_CLOUD'),
        // The Plugin value's icons (see the header), each turning one on before off.
        switchOn: svg24(OUTLINE,
            '<path d="M14 12a2 2 0 1 0 4 0a2 2 0 1 0 -4 0"/>'
            + '<path d="M2 12a6 6 0 0 1 6 -6h8a6 6 0 0 1 6 6a6 6 0 0 1 -6 6h-8a6 6 0 0 1 -6 -6"/>'),
        switchOff: svg24(OUTLINE,
            '<path d="M6 12a2 2 0 1 0 4 0a2 2 0 1 0 -4 0"/>'
            + '<path d="M2 12a6 6 0 0 1 6 -6h8a6 6 0 0 1 6 6a6 6 0 0 1 -6 6h-8a6 6 0 0 1 -6 -6"/>'),
        wifi: svg24(OUTLINE,
            '<path d="M12 18l.01 0"/>'
            + '<path d="M9.172 15.172a4 4 0 0 1 5.656 0"/>'
            + '<path d="M6.343 12.343a8 8 0 0 1 11.314 0"/>'
            + '<path d="M3.515 9.515c4.686 -4.687 12.284 -4.687 17 0"/>'),
        wifiOff: svg24(OUTLINE,
            '<path d="M12 18l.01 0"/>'
            + '<path d="M9.172 15.172a4 4 0 0 1 5.656 0"/>'
            + '<path d="M6.343 12.343a7.963 7.963 0 0 1 3.864 -2.14m4.163 .155a7.965 7.965 0 0 1 3.287 2"/>'
            + '<path d="M3.515 9.515a12 12 0 0 1 3.544 -2.455m3.101 -.92a12 12 0 0 1 10.325 3.374"/>'
            + '<path d="M3 3l18 18"/>'),
        bluetoothOff: svg24(OUTLINE,
            '<path d="M3 3l18 18"/>'
            + '<path d="M16.438 16.45l-4.438 3.55v-8m0 -4v-4l5 4l-2.776 2.22m-2.222 1.779l-5 4"/>'),
        plug: svg24(OUTLINE,
            '<path d="M12 22v-5"/>'
            + '<path d="M15 8V2"/>'
            + '<path d="M17 8a1 1 0 0 1 1 1v4a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1z"/>'
            + '<path d="M9 8V2"/>'),
        // The watch's drawing (19x17 on the Pebble Time 2) smoothed: the wave rising from the
        // left, over its crest and down to where it curls in, the curl back up and down to the
        // water, and the ripple, a little taller than the drawing's so the stroke keeps it a wave.
        tide: svg24(OUTLINE,
            '<path d="M2 15.5C2 8.5 6.5 2.5 13.1 2.5C17 2.5 19.8 4.5 19.8 6.8C19.8 8.4 18.8 9.5 17.5 10.1'
            + 'C17 8.2 15.3 6.8 13.1 6.8C11.7 6.8 10.9 7.9 10.9 9.8L15.9 15.5L20.9 15.5"/>'
            + '<path d="M2 20.4C2.8 19.4 3.4 18.8 4.2 18.8C5.8 18.8 6.5 21.2 8.1 21.2S10.4 18.8 12 18.8'
            + 'S14.3 21.2 15.9 21.2S18.2 18.8 19.8 18.8S21.2 19.4 22 20.4"/>')
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
        P.icons.register('temp', ICONS.temp);
        P.icons.register('dew', ICONS.dew);
        P.icons.register('countdown', ICONS.countdown);
        P.icons.register('phoneBattery', ICONS.phoneBattery);
        P.icons.register('distance', ICONS.distance);
        P.icons.register('steps', ICONS.steps);
        P.icons.register('sleep', ICONS.sleep);
        P.icons.register('hr', ICONS.hr);
        P.icons.register('sun', ICONS.sun);
        P.icons.register('condition', ICONS.condition);
        P.icons.register('switchOn', ICONS.switchOn);
        P.icons.register('switchOff', ICONS.switchOff);
        P.icons.register('wifi', ICONS.wifi);
        P.icons.register('wifiOff', ICONS.wifiOff);
        P.icons.register('bluetoothOff', ICONS.bluetoothOff);
        P.icons.register('plug', ICONS.plug);
        P.icons.register('tide', ICONS.tide);
    }

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = ICONS;
    }
})();
