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
//   2. The rain-bar and radar-graph color modes (multicolor <-> Solid). The pair itself
//      lives in resolve-ink.js (barColorDefault / BAR_COLOR_KEYS), not here: the phone's
//      migration needs the same answer, and this file cannot be its home because
//      requiring it REGISTERS a hook. A side-effect-free leaf can be shared; a
//      registration cannot.
/* global PConf */
var PConf = (typeof global !== 'undefined' && global.PConf) ? global.PConf
    : (typeof window !== 'undefined' && window.PConf) ? window.PConf
    : (typeof PConf !== 'undefined' && PConf) ? PConf
    : { onChange: { register: function () {}, get: function () {} } };

(function () {
    // Dual-context (see line-style.js): a CommonJS require under Node, the window global
    // published by the file concatenated ahead of this one in the page bundle
    // (build-config-page.js's APP_FILES puts resolve-ink.js well before this file).
    var resolveInk = (typeof require !== 'undefined')
        ? require('../resolve-ink.js') : window.ResolveInk;
    // dark and bw are both white-on-black; light and bw-light are both black-on-white.
    var POLARITY = { dark: 'dark', bw: 'dark', light: 'light', 'bw-light': 'light' };
    var OLD_FG = { dark: '#FFFFFF', light: '#000000' };
    var CONVERTIBLE_KEYS = ['colorTime', 'colorSunday', 'colorSaturday', 'colorUSFederal'];

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
        // barColorDefault reads polarity off the theme itself, so the raw themes go
        // straight in: bw answers dark, bw-light answers light. That is also why the
        // pair converts on polarity rather than colour-ness — bw-light -> light is not
        // a flip, and that install would otherwise be the one left on multicolor.
        var oldBar = resolveInk.barColorDefault(oldTheme);
        var newBar = resolveInk.barColorDefault(newTheme);
        for (i = 0; i < resolveInk.BAR_COLOR_KEYS.length; i += 1) {
            k = resolveInk.BAR_COLOR_KEYS[i];
            if (S[k] === oldBar) { S[k] = newBar; }
        }
    }

    PConf.onChange.register('themeConvert', function (S, oldTheme, newTheme) {
        applyThemeConvert(S, oldTheme, newTheme);
    });

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { applyThemeConvert: applyThemeConvert };
    }
})();
