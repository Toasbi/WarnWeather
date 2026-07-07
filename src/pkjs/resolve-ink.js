// src/pkjs/resolve-ink.js — ES5. Theme-aware color resolution: flips an exactly-
// white resolved color to black in the light theme (dark/bw stay white-on-black,
// so white passes through unchanged there). Grays and hued colors are untouched —
// this only ever matters for a color that resolved to the default foreground.
var COLORS = require('./pebble-colors.js');

/**
 * @param {number} color 0xRRGGBB resolved color.
 * @param {string} theme 'dark'|'light'|'bw'.
 * @returns {number} color, or GColorBlack when color is exactly white and theme is 'light'.
 */
function resolveInk(color, theme) {
    if (theme === 'light' && color === COLORS.GColorWhite) {
        return COLORS.GColorBlack;
    }
    return color;
}

module.exports = { resolveInk: resolveInk };
