// Authoritative rain-tier definition (single source of truth for colors).
// Height constants mirror C rain_tier.c (RAIN_TIER_MAX_TENTHS / RAIN_TIER_TOP_PCT_ARR);
// they are duplicated there for the radar's on-watch height math — keep in sync.
var COLORS = require('../pebble-colors');
var configUi = require('../config-ui');
var resolveInkLib = require('../resolve-ink.js');
var isBwTheme = resolveInkLib.isBwTheme;
var isLightPolarity = resolveInkLib.isLightPolarity;

var MAX_TENTHS = [1, 5, 20, 100];                 // tier upper bounds (wire tenths)
var TOP_PCT    = [0, 14, 34, 56, 78, 100];        // cumulative slab tops (% of plot)
// Per-tier colors for colour displays, tiers 1..5.
var TIER_COLORS = [
    COLORS.GColorLightGray, COLORS.GColorElectricBlue, COLORS.GColorGreen,
    COLORS.GColorYellow, COLORS.GColorSunsetOrange
];
// B&W platforms get a single polarity-background stop (black in dark, white in light);
// the watch adds a polarity-foreground outline.

/**
 * Tier index 1..5 for a wire-tenths rain value, or 0 for <= 0.
 * @param {number} tenths Rain in wire tenths.
 * @returns {number} Tier index.
 */
function tierOfTenths(tenths) {
    if (tenths <= 0) { return 0; }
    for (var i = 0; i < MAX_TENTHS.length; i += 1) {
        if (tenths <= MAX_TENTHS[i]) { return i + 1; }
    }
    return 5;
}

/**
 * Fraction (0..256) of the topmost tier slab that is filled. Port of C
 * rain_tier_fill_q8.
 * @param {number} tenths Rain in wire tenths.
 * @param {number} tier Tier index 1..5.
 * @returns {number} q8 fill in [0,256].
 */
function fillQ8(tenths, tier) {
    var low, high;
    switch (tier) {
        case 1: return 256;
        case 2: low = 2;   high = 5;   break;
        case 3: low = 6;   high = 20;  break;
        case 4: low = 21;  high = 100; break;
        case 5: low = 101; high = 255; break;
        default: return 256;
    }
    if (tenths >= high) { return 256; }
    if (tenths <= low)  { return 0; }
    return Math.trunc(((tenths - low) * 256) / (high - low));
}

/**
 * Per-mille (0..1000) bar height for a wire-tenths rain value. Exact port of C
 * rain_tier_permille / rain_tier_proportional_height(tenths, 1000).
 * @param {number} tenths Rain in wire tenths.
 * @returns {number} Height in per-mille of plot height.
 */
function rainPermille(tenths) {
    if (tenths <= 0) { return 0; }
    var tier = tierOfTenths(tenths);
    var q8 = fillQ8(tenths, tier);
    var belowH = Math.trunc((1000 * TOP_PCT[tier - 1]) / 100);
    var slabTopFull = Math.trunc((1000 * TOP_PCT[tier]) / 100);
    var slabHFull = slabTopFull - belowH;
    var slabHTop = Math.trunc((slabHFull * q8) / 256);
    if (slabHTop === 0 && q8 > 0) { slabHTop = 1; }
    var total = belowH + slabHTop;
    return total > 0 ? total : 1;
}

/**
 * Build the rain color palette for a watch platform + color choice + theme.
 * B&W platforms (or the Black & White theme — bw or bw-light — on a color
 * platform, effective color) always get a single stop matching the polarity
 * background (theme_bg() on the watch: black in dark polarity, white in light
 * polarity — see palette.c fill_defaults / health_graph_layer.c) and ignore
 * colorMode; the watch pairs it with a theme_fg() outline. On effectively-color
 * displays, 'white' collapses to a single stop — white in dark polarity,
 * GColorDarkGray in light polarity (a pure white bar reads too flat against a
 * white background) — anything else (default) yields the five multicolor tier
 * stops, untouched by theme.
 * @param {string} platform Pebble platform id (aplite/basalt/chalk/diorite/emery/flint).
 * @param {string} [colorMode] 'multicolor' (default) or 'white'. Effectively-color displays only.
 * @param {string} [theme] 'dark'|'light'|'bw'|'bw-light'; defaults to 'dark' (dark-polarity stop, no B&W collapse beyond hardware).
 * @returns {{from: number[], rgb: number[]}} Stops: permille thresholds + 0xRRGGBB colors.
 */
function buildPalette(platform, colorMode, theme) {
    theme = theme || 'dark';
    if (!configUi.isColorPlatform(platform) || isBwTheme(theme)) {
        return { from: [0], rgb: [isLightPolarity(theme) ? COLORS.GColorWhite : COLORS.GColorBlack] };
    }
    if (colorMode === 'white') {
        return { from: [0], rgb: [isLightPolarity(theme) ? COLORS.GColorDarkGray : COLORS.GColorWhite] };
    }
    return {
        from: [0, 140, 340, 560, 780],   // TOP_PCT[0..4] * 10
        rgb: TIER_COLORS.slice()
    };
}

/**
 * Quantize a 0xRRGGBB color to the single GColor8 byte the watch stores.
 * Matches Pebble's GColorFromHEX exactly: opaque alpha (0b11) + top 2 bits per
 * channel, so the rendered pixel is identical to sending the full hex.
 * @param {number} hex 0xRRGGBB color.
 * @returns {number} GColor8 byte (0xC0..0xFF).
 */
function rgbToGColor8(hex) {
    var r = (hex >> 16) & 0xFF;
    var g = (hex >> 8) & 0xFF;
    var b = hex & 0xFF;
    return 0xC0 | ((r >> 6) << 4) | ((g >> 6) << 2) | (b >> 6);
}

/**
 * Pack a logical palette into the wire blob: 3 bytes/stop —
 * [from_lo, from_hi (int16 LE permille), GColor8 color]. Stop count is the
 * consumer's `len / 3`; there is no separate count field.
 * @param {{from: number[], rgb: number[]}} palette Logical palette from buildPalette.
 * @returns {number[]} Packed uint8 array (length === stops * 3).
 */
function packPalette(palette) {
    var out = [];
    for (var i = 0; i < palette.from.length; i += 1) {
        var from = palette.from[i] & 0xFFFF;
        out.push(from & 0xFF);           // from_lo
        out.push((from >> 8) & 0xFF);    // from_hi
        out.push(rgbToGColor8(palette.rgb[i]));
    }
    return out;
}

/**
 * Build and pack one channel's palette in a single call.
 * @param {string} platform Pebble platform id.
 * @param {string} colorMode 'multicolor' or 'white'.
 * @param {string} [theme] 'dark'|'light'|'bw'|'bw-light'.
 * @returns {number[]} Packed uint8 palette blob for the wire.
 */
function buildPackedPalette(platform, colorMode, theme) {
    return packPalette(buildPalette(platform, colorMode, theme));
}

module.exports = {
    rainPermille: rainPermille,
    buildPalette: buildPalette,
    rgbToGColor8: rgbToGColor8,
    packPalette: packPalette,
    buildPackedPalette: buildPackedPalette
};
