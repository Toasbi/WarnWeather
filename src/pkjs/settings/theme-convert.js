// src/pkjs/settings/theme-convert.js — ES5, WebView. Registers the config-ui
// engine's 'themeConvert' onChange hook (see engine.js's PConf.onChange).
//
// When the Theme control's polarity flips (dark/bw <-> light), the four "match
// the default foreground" color pickers convert live so their swatches and the
// preview reflect the new default before the user saves. dark and bw share a
// polarity (both white-on-black) — flipping between them converts nothing.
// colorToday is exempt: its black value is the "auto, match date color" sentinel,
// not a color choice (see calendar_layer.c today_color()).
/* global PConf */
var PConf = (typeof global !== 'undefined' && global.PConf) ? global.PConf
    : (typeof window !== 'undefined' && window.PConf) ? window.PConf
    : (typeof PConf !== 'undefined' && PConf) ? PConf
    : { onChange: { register: function () {}, get: function () {} } };

(function () {
    // dark and bw are both white-on-black; only light is black-on-white.
    var POLARITY = { dark: 'dark', bw: 'dark', light: 'light' };
    var OLD_FG = { dark: '#FFFFFF', light: '#000000' };
    var CONVERTIBLE_KEYS = ['colorTime', 'colorSunday', 'colorSaturday', 'colorUSFederal'];

    /**
     * Convert the "match default foreground" color pickers when the theme's
     * polarity flips. Mutates S in place; no-op when the polarity is unchanged
     * (including a dark<->bw flip, which isn't a polarity change) or when a
     * picker holds anything other than the OLD polarity's default foreground.
     * @param {Object} S Live settings state (config-ui engine's S).
     * @param {string} oldTheme 'dark'|'light'|'bw'.
     * @param {string} newTheme 'dark'|'light'|'bw'.
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
        for (var i = 0; i < CONVERTIBLE_KEYS.length; i += 1) {
            var k = CONVERTIBLE_KEYS[i];
            if (typeof S[k] === 'string' && S[k].toUpperCase() === oldFg) {
                S[k] = newFg;
            }
        }
    }

    PConf.onChange.register('themeConvert', function (S, oldTheme, newTheme) {
        applyThemeConvert(S, oldTheme, newTheme);
    });

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { applyThemeConvert: applyThemeConvert };
    }
})();
