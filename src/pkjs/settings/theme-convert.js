// src/pkjs/settings/theme-convert.js — ES5, WebView. Registers the config-ui
// engine's 'themeConvert' onChange hook (see engine.js's PConf.onChange).
//
// When the Theme control's polarity flips (dark/bw <-> light/bw-light), the settings
// whose DEFAULT depends on the polarity convert live, so their controls and the
// preview reflect the new default before the user saves. dark and bw share a polarity
// (both white-on-black), and light and bw-light share the other (both black-on-white)
// — flipping within a pair converts nothing.
//
// Two groups convert, on the same rule: a value still holding the OLD polarity's
// default becomes the NEW polarity's default, and anything else is a choice and is
// left alone. The rule cannot tell a deliberate pick that happens to equal the old
// default from an untouched one, and converts both; that is the accepted price of
// storing defaults concretely, and it errs toward the face staying legible.
//
//   1. The four "match the default foreground" color pickers (white <-> black).
//      colorToday is exempt: its black value is the "auto, match date color"
//      sentinel, not a color choice (see calendar_layer.c today_color()).
//   2. The rain-bar and radar-graph color modes (multicolor <-> Solid) — BAR_DEFAULT
//      below, which is also where the phone-side migration for installs that were
//      already on light reads the pair from (clay-settings.js).
/* global PConf */
// The `.onChange` test is not redundant (same hazard preview-radar.js documents for
// `.blocks`): config-ui's lib/color.js and lib/schema-walk.js each do
// `global.PConf = global.PConf || {}` to attach their own shard, so under Node any
// requirer that pulls line-style.js in first — clay-settings.js does, for the pair
// below — finds global.PConf EXISTING while carrying no onChange registry, and the
// register at the tail would throw. The page loads engine.js first and is unaffected.
var PConf = (typeof global !== 'undefined' && global.PConf && global.PConf.onChange)
    ? global.PConf
    : (typeof window !== 'undefined' && window.PConf) ? window.PConf
    : (typeof PConf !== 'undefined' && PConf) ? PConf
    : { onChange: { register: function () {}, get: function () {} } };

(function () {
    // dark and bw are both white-on-black; light and bw-light are both black-on-white.
    var POLARITY = { dark: 'dark', bw: 'dark', light: 'light', 'bw-light': 'light' };
    var OLD_FG = { dark: '#FFFFFF', light: '#000000' };
    var CONVERTIBLE_KEYS = ['colorTime', 'colorSunday', 'colorSaturday', 'colorUSFederal'];
    // The bar color mode a polarity starts on. The five multicolor rain tiers are tuned
    // against a black background: on white the lightest of them wash out, so the light
    // polarity starts on Solid instead — which rain-tier.js resolves to GColorDarkGray
    // there rather than white, so the bars still read. The wire VALUE stays 'white'; only
    // the label says "Solid" (schema.js). Both keys hold that same two-value vocabulary,
    // and buildPalette ignores it on a B&W render, so the pair converts on POLARITY, not
    // on colour-ness: bw-light -> light is not a polarity flip, and that install would
    // otherwise be the one still arriving on multicolor.
    var BAR_DEFAULT = { dark: 'multicolor', light: 'white' };
    var BAR_COLOR_KEYS = ['rainBarColor', 'radarColor'];

    /**
     * The rain-bar / radar-graph color mode a theme's polarity starts on. The phone's
     * migration for installs that were already on light asks this rather than repeating
     * the pair (clay-settings.js migrateLightThemeSolidBars).
     * @param {string} theme 'dark'|'light'|'bw'|'bw-light'; anything else reads as dark.
     * @returns {string} 'multicolor' or 'white' (the wire value labelled "Solid").
     */
    function barColorDefault(theme) {
        return BAR_DEFAULT[POLARITY[theme] || 'dark'];
    }

    /**
     * Convert the polarity-dependent settings when the theme's polarity flips — the
     * four "match default foreground" color pickers and the two bar color modes.
     * Mutates S in place; no-op when the polarity is unchanged (including a dark<->bw
     * or light<->bw-light flip, neither of which is a polarity change) or when a
     * setting holds anything other than the OLD polarity's default.
     * @param {Object} S Live settings state (config-ui engine's S).
     * @param {string} oldTheme 'dark'|'light'|'bw'|'bw-light'.
     * @param {string} newTheme 'dark'|'light'|'bw'|'bw-light'.
     * @returns {void}
     */
    function applyThemeConvert(S, oldTheme, newTheme) {
        var oldPolarity = POLARITY[oldTheme] || 'dark';
        var newPolarity = POLARITY[newTheme] || 'dark';
        if (oldPolarity === newPolarity) {
            return;
        }
        var oldFg = OLD_FG[oldPolarity];
        var newFg = OLD_FG[newPolarity];
        var i, k;
        for (i = 0; i < CONVERTIBLE_KEYS.length; i += 1) {
            k = CONVERTIBLE_KEYS[i];
            if (typeof S[k] === 'string' && S[k].toUpperCase() === oldFg) {
                S[k] = newFg;
            }
        }
        for (i = 0; i < BAR_COLOR_KEYS.length; i += 1) {
            k = BAR_COLOR_KEYS[i];
            if (S[k] === BAR_DEFAULT[oldPolarity]) {
                S[k] = BAR_DEFAULT[newPolarity];
            }
        }
    }

    PConf.onChange.register('themeConvert', function (S, oldTheme, newTheme) {
        applyThemeConvert(S, oldTheme, newTheme);
    });

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = {
            applyThemeConvert: applyThemeConvert,
            barColorDefault: barColorDefault,
            BAR_COLOR_KEYS: BAR_COLOR_KEYS
        };
    }
})();
