// Authoritative rain-tier definition (single source of truth for colors).
// Height constants mirror C rain_tier.c (RAIN_TIER_MAX_TENTHS / RAIN_TIER_TOP_PCT_ARR);
// they are duplicated there for the radar's on-watch height math — keep in sync.
var COLORS = require('../pebble-colors');

var MAX_TENTHS = [1, 5, 20, 100];                 // tier upper bounds (wire tenths)
var TOP_PCT    = [0, 14, 34, 56, 78, 100];        // cumulative slab tops (% of plot)
// Per-tier colors for colour displays, tiers 1..5.
var TIER_COLORS = [
    COLORS.GColorLightGray, COLORS.GColorElectricBlue, COLORS.GColorGreen,
    COLORS.GColorYellow, COLORS.GColorSunsetOrange
];
// B&W platforms get a single black stop; the watch adds the white outline.
var BW_PLATFORMS = { aplite: true, diorite: true };

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
 * Build the rain color palette for a watch platform + bar-color choice.
 * B&W platforms always get a single black stop (the watch adds the white outline) and
 * ignore rainBarColor. On color displays, 'white' collapses to a single white stop;
 * anything else (default) yields the five multicolor tier stops.
 * @param {string} platform Pebble platform id (aplite/basalt/chalk/diorite/emery).
 * @param {string} [rainBarColor] 'multicolor' (default) or 'white'. Color displays only.
 * @returns {{from: number[], rgb: number[]}} Stops: permille thresholds + 0xRRGGBB colors.
 */
function buildPalette(platform, rainBarColor) {
    if (BW_PLATFORMS[platform]) {
        return { from: [0], rgb: [COLORS.GColorBlack] };
    }
    if (rainBarColor === 'white') {
        return { from: [0], rgb: [COLORS.GColorWhite] };
    }
    return {
        from: [0, 140, 340, 560, 780],   // TOP_PCT[0..4] * 10
        rgb: TIER_COLORS.slice()
    };
}

/**
 * Convert a logical palette into the little-endian byte arrays the wire expects.
 * Pebble.sendAppMessage packs a plain JS array as uint8 (0..255), so the wide
 * stop values must be serialized as bytes — same as TEMP_TREND_INT16 in
 * provider.getPayload. The C side reads them back via (int16_t*)/(int32_t*).
 * @param {{from: number[], rgb: number[]}} palette Logical palette from buildPalette.
 * @returns {{from: number[], rgb: number[]}} Byte arrays: from = int16 LE, rgb = int32 LE.
 */
function paletteToWire(palette) {
    var fromBytes = Array.prototype.slice.call(new Uint8Array(new Int16Array(palette.from).buffer));
    var rgbBytes = Array.prototype.slice.call(new Uint8Array(new Int32Array(palette.rgb).buffer));
    return { from: fromBytes, rgb: rgbBytes };
}

module.exports = {
    rainPermille: rainPermille,
    buildPalette: buildPalette,
    paletteToWire: paletteToWire
};
