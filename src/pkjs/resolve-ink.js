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

/**
 * The theme a target watch will actually render, given whether its platform ships
 * the light polarity. Platforms without WW_THEME_POLARITY (aplite) have the light
 * polarity compiled out — theme.h pins theme_is_light() to false, so a stored
 * light / bw-light byte renders as the classic white-on-black. Mirror that freeze
 * on the phone before deriving wire colors, or a light-polarity flip (white→black)
 * would ship line/dot colors the watch draws black-on-black. Folds the polarity to
 * dark: light→dark, bw-light→bw; dark/bw pass through. supportsPolarity true (every
 * platform except aplite) returns the theme unchanged.
 * @param {string} theme 'dark'|'light'|'bw'|'bw-light'.
 * @param {boolean} supportsPolarity Whether the target platform ships the light polarity.
 * @returns {string} The theme the target platform actually renders.
 */
function effectiveTheme(theme, supportsPolarity) {
    if (supportsPolarity) { return theme; }
    if (theme === 'light') { return 'dark'; }
    if (theme === 'bw-light') { return 'bw'; }
    return theme;
}

module.exports = {
    resolveInk: resolveInk,
    isLightPolarity: isLightPolarity,
    isBwTheme: isBwTheme,
    effectiveTheme: effectiveTheme
};
