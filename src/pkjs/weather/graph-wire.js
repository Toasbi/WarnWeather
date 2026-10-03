// src/pkjs/weather/graph-wire.js — ES5, phone only (PKJS and the Node tests; not in the
// settings-page bundle, whose previews read the settings, never the bytes). The graph's
// three settings-derived Clay tuples: the forecast's and the radar's packed bar palettes
// (BAR_PALETTE_UINT8, RADAR_PALETTE_UINT8) and the line styling (CLAY_LINE_STYLE_UINT8).
// THE one packer, for the Clay settings send (clay-payload.js) and the dev fixture send
// (fixture-weather.js), so the two cannot drift.
//
// The readings live elsewhere and are shared with the settings page: line-style.js
// resolves the graph colours and the style bytes, draw-from.js reads Draw from / Bars
// from, rain-tier.js builds the palettes. This file asks them about one watch, whose
// capabilities come from config-ui's computeEnv (the platform table the page's env is
// built from too), and encodes the answers.
//
// THE DRAW FROM BITS (Clay message only; no new tuple, no new length). A line's Draw
// from: Top is bit 5 of its own style byte (CLAY_LINE_STYLE_UINT8 [11], [12], [13], [15];
// persist.h LINE_STYLE_FROM_TOP), its float bit bit 6 (persist.h LINE_STYLE_FLOATING): the
// encoder's bytes never reach either (kinds 0-3, width 0/1/3 in bits 2-4), and the watch's
// decode of the style reads only bits 0-4. A chart's Bars from: Top is bit 7 of byte [1]
// of its palette blob: stop 0's threshold, which rain-tier.js always starts at 0, so the
// watch reads the flag as a negative stop-0 threshold (palette.h palette_from_top) and its
// renderer clamps that stop to the zero row as it always has. With every key on Bottom
// (or on aplite, which never gets a bit) both tuples are byte-identical to the build
// before the setting, save the float bit on a drawn pressure, feels-like or dew point line.

var rainTier = require('./rain-tier.js');
var resolveInk = require('../resolve-ink.js');
var lineStyle = require('../line-style.js');
var drawFrom = require('../draw-from.js');
var configUi = require('../config-ui');

// Line-style flag byte (wire byte [3]), bit 0: the secondary line's area fill is on.
var FLAG_SECONDARY_FILL = 0x01;
// NIGHT flag byte (wire byte [9]), bit 0: the night-area tint is an explicit user pick.
// It was the light-polarity opt-in for the night re-shade; NO WATCH READS IT any more,
// since light re-shades unconditionally off NIGHT_AREA_COLORS' light arm. Still sent,
// because bytes [4..9] are byte-for-byte the watch's NIGHT_COLORS persist blob and
// dropping it would change that blob's length for one dead byte. ADR-0003 §7.
var FLAG_NIGHT_FILL_EXPLICIT = 0x01;
// persist.h LINE_STYLE_FROM_TOP: bit 5 of a non-stripe line's style byte.
var LINE_BIT = 0x20;
// persist.h LINE_STYLE_FLOATING: bit 6 of a non-stripe line's style byte.
var FLOAT_BIT = 0x40;
// palette.h: bit 7 of a palette blob's byte [1] (stop 0's threshold, its bit 15).
var PALETTE_BIT = 0x80;

/**
 * A packed line-style byte with the edge its line is drawn from: the Top flag (LINE_BIT)
 * for TOP, the float bit (FLOAT_BIT) for FLOAT, neither for BOTTOM or null.
 * @param {number} byte line-style.js lineStyleByte output.
 * @param {?string} edge draw-from.js lineEdge: TOP, BOTTOM, FLOAT or null.
 * @returns {number}
 */
function styleByte(byte, edge) {
    if (edge === drawFrom.TOP) { return byte | LINE_BIT; }
    return edge === drawFrom.FLOAT ? (byte | FLOAT_BIT) : byte;
}

/**
 * A packed palette blob with its Bars from: Top flag (PALETTE_BIT in byte [1]) set
 * when `on`: a marked copy, the blob itself otherwise.
 * @param {number[]} blob rain-tier.js buildPackedPalette output (3 B per stop).
 * @param {boolean} on The chart's bars hang from the top (draw-from.js barsFromTop).
 * @returns {number[]}
 */
function markPalette(blob, on) {
    if (!on || !blob || blob.length < 2) { return blob; }
    var out = blob.slice();
    out[1] = out[1] | PALETTE_BIT;
    return out;
}

/**
 * The packed palette tuples for both channels. Bars follow rainBarColor, the rain radar
 * follows radarColor; each is an independent GColor8 blob (3 B per stop).
 *
 * The absent-key fallback is DEFENSIVE, not a live path: both keys carry a static
 * schema defaultValue, so seedDefaults writes them on first boot, and the light theme
 * is only reachable through a settings save that writes both concretely. It goes
 * through barColorDefault anyway so the dark default is not spelled out a third time,
 * and so an absent key would resolve to the right polarity rather than silently to
 * multicolor if the seeding ever changes.
 *
 * Each blob also carries its chart's Bars from: Top (rainBarFrom, radarBarFrom) in bit 7
 * of its byte [1] (markPalette; see the header). Never on aplite, and with Bottom the
 * blobs are byte-identical to the ones sent before the setting existed.
 *
 * @param {Object} settings Clay settings (rainBarColor/radarColor/theme, rainBarFrom/
 *   radarBarFrom).
 * @param {Object|null} watchInfo Active watch info (platform read for packing).
 * @returns {{BAR_PALETTE_UINT8: number[], RADAR_PALETTE_UINT8: number[]}} Packed tuples.
 */
function buildPaletteTuples(settings, watchInfo) {
    var platform = watchInfo ? watchInfo.platform : 'basalt';
    var resolved = settings || {};
    var theme = resolved.theme || 'dark';
    var fallback = resolveInk.barColorDefault(theme);
    var env = configUi.computeEnv(watchInfo);
    return {
        BAR_PALETTE_UINT8: markPalette(
            rainTier.buildPackedPalette(platform, resolved.rainBarColor || fallback, theme),
            drawFrom.barsFromTop(resolved, 'rain', env)),
        RADAR_PALETTE_UINT8: markPalette(
            rainTier.buildPackedPalette(platform, resolved.radarColor || fallback, theme),
            drawFrom.barsFromTop(resolved, 'radar', env))
    };
}

/**
 * Pack the line styling for the Clay wire — SIXTEEN bytes:
 *
 *   [0] main-metric line colour    (GColor8 argb)
 *   [1] area fill colour           (GColor8 argb)
 *   [2] second-metric line colour  (GColor8 argb)
 *   [3] line flags — bit 0 = fill on
 *   [4] full-height night hatch    (GColor8 argb)  ┐
 *   [5] full-height dusk/dawn line (GColor8 argb)  │ bytes [4..9] are byte-for-byte
 *   [6] night-area underlay base   (GColor8 argb)  │ the watch's NIGHT_COLORS persist
 *   [7] night-area hatch           (GColor8 argb)  │ blob (NIGHT_COLOR_BYTES = 6);
 *   [8] night-area boundary        (GColor8 argb)  │ app_message.c stores the tail
 *   [9] night flags — bit 0 = the tint is an explicit pick  ┘ straight through.
 *   [10] third-metric line colour  (GColor8 argb)
 *   [11] main-metric line style    ┐ bytes [11..13] are byte-for-byte the watch's
 *   [12] second-metric line style  │ LINE_STYLES persist blob (kind | width << 2 —
 *   [13] third-metric line style   ┘ see line-style.js LINE_STYLE_KINDS; persist.h).
 *   [14] fourth-metric line colour (GColor8 argb)  ┐ the third tail block:
 *   [15] fourth-metric line style  (kind | field)  ┘ FIFTH_LINE_COLOR / _STYLE.
 *
 * Each style byte [11], [12], [13], [15] also carries its line's Draw from: Top in
 * bit 5 (LINE_BIT) and in bit 6 whether the drawn line floats, anchoring no edge of the
 * graph (FLOAT_BIT: pressure, feels-like, dew point); bit 7 stays 0. Neither is ever set
 * on a stripe or on aplite, so with every Draw from on Bottom and no floating line drawn
 * the bytes are the ones this function always sent.
 *
 * The colours are line-style.js resolveGraphColors' answer for this watch, the one
 * resolution the settings preview runs too (ADR-0003 §8). rgbToGColor8 matches Pebble's
 * GColorFromHEX exactly, so the pixel is identical to sending the full 0xRRGGBB. The
 * watch treats everything past byte [3] as OPTIONAL tail blocks (its length checks are
 * minimums, one per block), so a shorter tuple from an older sender still applies in
 * full — which is the rule for growing this: append a block plus its own length check,
 * never widen the minimum. ADR-0003 §7. Bytes [10..15] ship to every watch — aplite has
 * no parse arm for them and simply ignores the tail, exactly as pre-feature watches
 * ignore bytes they postdate.
 *
 * @param {Object} settings Clay settings blob.
 * @param {Object|null} watchInfo Pebble.getActiveWatchInfo() result, or null (an unknown
 *   watch reads capable, as computeEnv does).
 * @returns {number[]} The sixteen bytes above.
 */
function buildLineStyleBytes(settings, watchInfo) {
    var env = configUi.computeEnv(watchInfo);
    var s = lineStyle.resolveGraphColors(settings, env);
    /**
     * One line's style byte with its Draw from flag and its float bit.
     * @param {string} lineKey secondaryLine|thirdLine|fourthLine|fifthLine.
     * @returns {number} lineStyleByte, bit 5 set while the line hangs from the top, bit 6
     *   while it is drawn but anchors no edge (pressure, feels-like, dew point).
     */
    function styleWithFrom(lineKey) {
        return styleByte(lineStyle.lineStyleByte(settings, lineKey + 'Style'),
            drawFrom.lineEdge(settings, lineKey, env));
    }
    return [
        rainTier.rgbToGColor8(s.secondary),
        rainTier.rgbToGColor8(s.fill),
        rainTier.rgbToGColor8(s.third),
        s.fillOn ? FLAG_SECONDARY_FILL : 0,
        rainTier.rgbToGColor8(s.night.hatch),
        rainTier.rgbToGColor8(s.night.boundary),
        rainTier.rgbToGColor8(s.night.areaBase),
        rainTier.rgbToGColor8(s.night.areaHatch),
        rainTier.rgbToGColor8(s.night.areaBoundary),
        s.night.fillExplicit ? FLAG_NIGHT_FILL_EXPLICIT : 0,
        rainTier.rgbToGColor8(s.fourth),
        styleWithFrom('secondaryLine'),
        styleWithFrom('thirdLine'),
        styleWithFrom('fourthLine'),
        rainTier.rgbToGColor8(s.fifth),
        styleWithFrom('fifthLine')
    ];
}

/**
 * The graph's three Clay tuples for one watch, keyed by their AppMessage names. Derived
 * from the settings blob plus the watch's capabilities alone, never from weather data, so
 * they ride the Clay message (test/inbox-size.test.js budgets them). Deliberately NOT
 * platform-gated, unlike the threshold blob or the curve insets: aplite renders the same
 * two metric lines, so it needs their colours too.
 * @param {Object} settings Clay settings blob.
 * @param {Object|null} watchInfo Pebble.getActiveWatchInfo() result, or null.
 * @returns {{BAR_PALETTE_UINT8: number[], RADAR_PALETTE_UINT8: number[],
 *   CLAY_LINE_STYLE_UINT8: number[]}} The tuples, in that (send) order.
 */
function buildGraphTuples(settings, watchInfo) {
    var palette = buildPaletteTuples(settings, watchInfo);
    return {
        BAR_PALETTE_UINT8: palette.BAR_PALETTE_UINT8,
        RADAR_PALETTE_UINT8: palette.RADAR_PALETTE_UINT8,
        CLAY_LINE_STYLE_UINT8: buildLineStyleBytes(settings, watchInfo)
    };
}

module.exports = {
    FLAG_SECONDARY_FILL: FLAG_SECONDARY_FILL,
    FLAG_NIGHT_FILL_EXPLICIT: FLAG_NIGHT_FILL_EXPLICIT,
    LINE_BIT: LINE_BIT,
    FLOAT_BIT: FLOAT_BIT,
    PALETTE_BIT: PALETTE_BIT,
    styleByte: styleByte,
    markPalette: markPalette,
    buildPaletteTuples: buildPaletteTuples,
    buildLineStyleBytes: buildLineStyleBytes,
    buildGraphTuples: buildGraphTuples
};
