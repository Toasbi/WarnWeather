// src/pkjs/resolve-ink.js — ES5. The theme-polarity vocabulary, and the two things
// that depend on nothing but polarity:
//
//   - resolveInk: flips an exactly-white resolved color to black in light-polarity
//     themes (dark/bw stay white-on-black, so white passes through unchanged there).
//     Grays and hued colors are untouched — this only ever matters for a color that
//     resolved to the default foreground.
//   - barColorDefault: which bar color mode a polarity STARTS on (below).
//
// It is deliberately side-effect-free, which is what lets the phone runtime and the
// settings page share it: everything here is a pure function of its arguments, and
// requiring the module registers nothing. theme-convert.js cannot offer that — it
// registers a config-UI onChange hook at import time — so anything both sides need
// belongs here, not there.
//
// Dual context: a CommonJS module on the phone and in the tests, and a plain
// concatenated <script> in the settings-page webview (scripts/build-config-page.js's
// APP_FILES), which has no require(). pebble-colors.js is concatenated before this
// file and exposes the same table on window there.
(function () {
    var COLORS = (typeof require !== 'undefined')
        ? require('./pebble-colors.js') : window.PebbleColors;

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

    // The rain-bar / radar-graph color modes, and which one a polarity starts on. The
    // five multicolor rain tiers are tuned against a black background: on white the
    // lightest of them wash out, so the light polarity starts on Solid instead — which
    // rain-tier.js resolves to GColorDarkGray there rather than white, so the bars still
    // read. The wire VALUE stays 'white'; only the settings label says "Solid"
    // (schema.js). Both keys hold this same two-value vocabulary, and rain-tier's
    // buildPalette ignores it on a B&W render, so the pair is a function of POLARITY and
    // not of colour-ness.
    var BAR_COLOR_MULTI = 'multicolor';
    var BAR_COLOR_SOLID = 'white';
    // The two settings keys holding that vocabulary — the rain bars under the forecast
    // graph and the radar graph. Listed here so the settings page's polarity conversion
    // (theme-convert.js) and the phone's migration iterate the SAME pair.
    var BAR_COLOR_KEYS = ['rainBarColor', 'radarColor'];

    /**
     * The bar color mode a theme's polarity starts on.
     * @param {string} theme 'dark'|'light'|'bw'|'bw-light'; anything else reads as dark.
     * @returns {string} 'multicolor', or 'white' (the wire value labelled "Solid").
     */
    function barColorDefault(theme) {
        return isLightPolarity(theme) ? BAR_COLOR_SOLID : BAR_COLOR_MULTI;
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

    var api = {
        resolveInk: resolveInk,
        isLightPolarity: isLightPolarity,
        isBwTheme: isBwTheme,
        effectiveTheme: effectiveTheme,
        barColorDefault: barColorDefault,
        BAR_COLOR_KEYS: BAR_COLOR_KEYS
    };

    // Dual-context export — mirrors the tail of src/pkjs/status-thresholds.js.
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    if (typeof window !== 'undefined') {
        window.ResolveInk = api;
    }
})();
