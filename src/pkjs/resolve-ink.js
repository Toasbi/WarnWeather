// src/pkjs/resolve-ink.js — ES5. Theme-aware color resolution: flips an exactly-
// white resolved color to black in light-polarity themes (dark/bw stay
// white-on-black, so white passes through unchanged there). Grays and hued colors
// are untouched — this only ever matters for a color that resolved to the default
// foreground.
var COLORS = require('./pebble-colors.js');

/**
 * Theme values: 'dark'|'light'|'bw'|'bw-light'. Two independent axes: polarity
 * (isLightPolarity) and effective color class (isBwTheme) — see theme.h for the
 * C-side mirror of this split.
 */

/**
 * Light-polarity check: black-on-white themes. dark/bw share dark polarity
 * (white-on-black); light/bw-light share light polarity (black-on-white).
 * @param {string} theme 'dark'|'light'|'bw'|'bw-light'.
 * @returns {boolean} True for 'light' or 'bw-light'.
 */
function isLightPolarity(theme) {
    return theme === 'light' || theme === 'bw-light';
}

/**
 * Effective B&W check: themes that render the Black & White drawing path on a
 * color display. bw is dark-polarity B&W; bw-light is light-polarity B&W.
 * @param {string} theme 'dark'|'light'|'bw'|'bw-light'.
 * @returns {boolean} True for 'bw' or 'bw-light'.
 */
function isBwTheme(theme) {
    return theme === 'bw' || theme === 'bw-light';
}

/**
 * @param {number} color 0xRRGGBB resolved color.
 * @param {string} theme 'dark'|'light'|'bw'|'bw-light'.
 * @returns {number} color, or GColorBlack when color is exactly white and theme is light-polarity.
 */
function resolveInk(color, theme) {
    if (isLightPolarity(theme) && color === COLORS.GColorWhite) {
        return COLORS.GColorBlack;
    }
    return color;
}

module.exports = { resolveInk: resolveInk, isLightPolarity: isLightPolarity, isBwTheme: isBwTheme };
