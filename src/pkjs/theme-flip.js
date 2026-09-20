// src/pkjs/theme-flip.js — the polarity-flip conversion rules, as a
// side-effect-free leaf (the resolve-ink.js pattern: pure functions of their
// arguments, requiring it registers nothing). Shared by the settings page —
// settings/theme-convert.js registers these as the 'themeConvert' /
// 'themeAutoPreset' onChange hooks — and by the phone runtime, where
// theme-schedule.js runs the same conversion on the auto theme switch's
// send-time scratch copy. theme-convert.js itself cannot be that shared home:
// requiring it registers a hook (see its header).
//
// When the theme's polarity flips (dark/bw <-> light/bw-light), the settings
// whose DEFAULT depends on the polarity convert: a value still holding the OLD
// polarity's default becomes the NEW polarity's default, and anything else is
// a choice and is left alone. The rule cannot tell a deliberate pick that
// happens to equal the old default from an untouched one, and converts both;
// that is the accepted price of storing defaults concretely, and it errs
// toward the face staying legible.
//
//   1. The four "match the default foreground" color pickers (white <-> black).
//      colorToday is exempt: its black value is the "auto, match date color"
//      sentinel, not a color choice (see calendar_layer.c today_color()).
//   2. The rain-bar and radar-graph color modes (multicolor <-> Solid). The
//      pair itself lives in resolve-ink.js (barColorDefault / BAR_COLOR_KEYS).
(function () {
    // Dual-context (see resolve-ink.js): a CommonJS require under Node/PKJS, the
    // window global published by the file concatenated ahead of this one in the
    // page bundle (build-config-page.js's APP_FILES puts resolve-ink.js first).
    var resolveInk = (typeof require !== 'undefined')
        ? require('./resolve-ink.js') : window.ResolveInk;
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
     * @param {Object} S Live settings state (config-ui engine's S, or a scratch copy).
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

    /**
     * First-enable preset for the automatic theme switch (the themeAuto
     * toggle's onChange): when the Day and Night picks are still identical —
     * nothing differentiated yet, true on a fresh install (dark/dark) — seed
     * the feature's advertised default, Light by day and Dark by night,
     * running the same polarity conversion a manual flip to Light would. A
     * re-enable after the user set the pair apart changes nothing.
     * @param {Object} S Live settings state (config-ui engine's S).
     * @param {*} oldValue Previous toggle value.
     * @param {*} newValue New toggle value.
     * @returns {void}
     */
    function applyThemeAutoPreset(S, oldValue, newValue) {
        if (newValue !== true) { return; }
        if (S.theme !== S.themeNight) { return; }
        var oldTheme = S.theme || 'dark';
        S.themeNight = 'dark';
        if (oldTheme !== 'light') {
            S.theme = 'light';
            applyThemeConvert(S, oldTheme, 'light');
        }
    }

    var api = {
        applyThemeConvert: applyThemeConvert,
        applyThemeAutoPreset: applyThemeAutoPreset
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    if (typeof window !== 'undefined') {
        window.ThemeFlip = api;
    }
})();
