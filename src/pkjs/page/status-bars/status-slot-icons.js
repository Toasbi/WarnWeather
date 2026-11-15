// src/pkjs/page/status-bars/status-slot-icons.js — ES5, WebView. The settings page's
// status-slot glyphs, registered into the config-ui icon registry (PConf.icons) so a schema row
// can lead its label with the picture the watch draws in that slot (item.icon: id).
//
// Every glyph the watch draws from a drawing is that drawing (status-pixels.generated.js through
// pixel-icon.js: its ink at the 144 px watches' 13-row box), so a redraw in the icon creator
// reaches the page with the next build of the drawings. SLOT_KEYS names the drawing each slot
// draws, for the watch pictures too (preview-watch.js), which draw it at the bar's box and seat.
// Three glyphs the watch draws in code, not from a drawing, stay outlines here: the battery
// (battery_item.c, filled by the charge), Battery saver's two Z's (snooze_draw) and the
// sunrise/sunset arrow (status_row.c ARROW_PATH_INFO). Everything is drawn in currentColor, so
// the .lbl-ico rule colours the glyph and the theme flip follows.
//
// Page-only on purpose: status-line-catalog.js also ships in the watch-runtime PKJS bundle and
// schema.js travels as JSON, so the SVG strings live here and the schema only names an id.
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

    var PixelIcon = (typeof require !== 'undefined') ? require('../weather/pixel-icon.js') : window.PixelIcon;

    // The drawing each slot that has one draws (scripts/pixel-icons/icons.json keys). The
    // condition slot's is the condition's: the sample, a partly cloudy afternoon (the city's
    // weather icon too); the rain alert's the condition slot's rain cloud.
    var SLOT_KEYS = {
        rain: 'RAIN', uv: 'UV', wind: 'WIND', gust: 'GUST', aqi: 'AQI', pollen: 'POLLEN',
        bluetooth: 'BT', quiet: 'QUIET', temp: 'TEMP', dew: 'DEW', countdown: 'COUNTDOWN',
        phoneBattery: 'PHONE_BATTERY', distance: 'DISTANCE', steps: 'STEPS', sleep: 'SLEEP', hr: 'HEART',
        condition: 'SUN_CLOUD'
    };

    var ICONS = {
        battery: svg24(OUTLINE,
            '<path d="M6 7h11a2 2 0 0 1 2 2v1h1v4h-1v1a2 2 0 0 1 -2 2h-11a2 2 0 0 1 -2 -2v-6a2 2 0 0 1 2 -2"/>'
            + '<path d="M7.5 10v4"/>'),
        snooze: svg24(OUTLINE,
            '<path d="M4 12h6l-6 8h6"/>'
            + '<path d="M14 4h6l-6 8h6"/>'),
        // The drawn sunrise/sunset arrow (status_row.c ARROW_PATH_INFO, 8 px tall: a
        // stem, a head 3 px tall and 2 px either side, outline and fill), at 2.5x.
        sun: svg24(OUTLINE,
            '<path d="M12 2v12.5"/>'
            + '<path d="M7 14.5L12 22L17 14.5Z" fill="currentColor"/>')
    };
    Object.keys(SLOT_KEYS).forEach(function (code) {
        ICONS[code] = PixelIcon.svg(PixelIcon.label(SLOT_KEYS[code]));
    });

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
    }

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = ICONS;
        // Beside the glyphs, not among them: a test walking the glyphs never meets it.
        Object.defineProperty(module.exports, 'SLOT_KEYS', {value: SLOT_KEYS});
    }
    if (typeof window !== 'undefined') { window.StatusSlotIcons = {SLOT_KEYS: SLOT_KEYS}; }
})();
