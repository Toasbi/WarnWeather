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
//   3. The threshold highlight colours (thresh<Kind>WarnColor/DangerColor) that
//      hold a foreground value — the page's "auto, track the theme fg" state
//      (blocks.js thresholdAutoColor), which onbuild.js otherwise re-derives
//      only on the NEXT page open. '' (no outline) and real picks are left alone.
//
// Every colour rule matches BOTH encodings a settings object carries: the page's
// live S holds '#RRGGBB' strings, while the phone's stored blob holds 0xRRGGBB
// ints (config-ui parseResponse runs hexToInt on every colour key at save, and
// seedDefaults writes GColorWhite as an int) — and the phone converts THAT blob
// (theme-schedule.js's night scratch copy). The converted value keeps the
// encoding it came in: an int stays an int (it rides the wire as-is, e.g.
// CLAY_COLOR_TIME), a string stays a string.
(function () {
    // Dual-context (see resolve-ink.js): a CommonJS require under Node/PKJS, the
    // window global published by the file concatenated ahead of this one in the
    // page bundle (build-config-page.js's APP_FILES puts resolve-ink.js first).
    var resolveInk = (typeof require !== 'undefined')
        ? require('./resolve-ink.js') : window.ResolveInk;
    // dark and bw are both white-on-black; light and bw-light are both black-on-white.
    var POLARITY = { dark: 'dark', bw: 'dark', light: 'light', 'bw-light': 'light' };
    // Each polarity's default foreground, in both encodings (see the header).
    var FG_HEX = { dark: '#FFFFFF', light: '#000000' };
    var FG_INT = { dark: 0xFFFFFF, light: 0x000000 };
    var CONVERTIBLE_KEYS = ['colorTime', 'colorSunday', 'colorSaturday', 'colorUSFederal'];
    // The threshold highlight colours (schema.js's per-kind WarnColor/DangerColor).
    var THRESHOLD_COLOR_KEY = /^thresh[A-Za-z]+(Warn|Danger)Color$/;

    /**
     * Whether a stored colour is a polarity's default foreground, in either
     * encoding: a 0xRRGGBB int (the phone's stored blob) or a '#RRGGBB' string
     * (the page's live state; case-insensitive).
     * @param {*} value Stored colour value.
     * @param {string} polarity 'dark'|'light'.
     * @returns {boolean} True when value is that polarity's foreground.
     */
    function isFg(value, polarity) {
        if (typeof value === 'number') { return value === FG_INT[polarity]; }
        if (typeof value === 'string') { return value.toUpperCase() === FG_HEX[polarity]; }
        return false;
    }

    /**
     * Swap S[k] from the old polarity's foreground to the new one's, keeping the
     * value's encoding (int stays int, string stays string). Anything else — a
     * real pick, '' (no outline), an absent key — is left alone.
     * @param {Object} S Settings state (mutated).
     * @param {string} k Settings key.
     * @param {string} oldPolarity 'dark'|'light'.
     * @param {string} newPolarity 'dark'|'light'.
     * @returns {void}
     */
    function convertFg(S, k, oldPolarity, newPolarity) {
        if (!isFg(S[k], oldPolarity)) { return; }
        S[k] = (typeof S[k] === 'number') ? FG_INT[newPolarity] : FG_HEX[newPolarity];
    }

    /**
     * Convert the polarity-dependent settings when the theme's polarity flips — the
     * four "match default foreground" color pickers, the threshold highlight colours
     * on auto, and the two bar color modes. Colours match and keep either encoding
     * ('#RRGGBB' string or 0xRRGGBB int, see the header).
     * Mutates S in place; no-op when the polarity is unchanged (including a dark<->bw
     * or light<->bw-light flip, neither of which is a polarity change) or when a
     * setting holds anything other than the OLD polarity's default.
     * @param {Object} S Live settings state (config-ui engine's S, or a scratch copy
     *     of the phone's stored blob).
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
        var i, k;
        for (i = 0; i < CONVERTIBLE_KEYS.length; i += 1) {
            convertFg(S, CONVERTIBLE_KEYS[i], oldPolarity, newPolarity);
        }
        for (k in S) {
            if (Object.prototype.hasOwnProperty.call(S, k) && THRESHOLD_COLOR_KEY.test(k)) {
                convertFg(S, k, oldPolarity, newPolarity);
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
     * toggle's onChange): when the Night pick is still identical to the theme
     * the user is on — nothing differentiated yet, true on a fresh install
     * (dark/dark) — seed a Dark night theme. A re-enable after the user set
     * the pair apart changes nothing.
     *
     * IT WRITES ONLY themeNight. The Theme row is now permanently visible and
     * doubles as the day theme, so the earlier version of this preset — which
     * flipped S.theme to 'light' and ran applyThemeConvert over the stored
     * colours — would read as the settings page changing the user's theme, and
     * their colours with it, behind their back. Switching the feature on picks
     * what happens AT NIGHT; the day stays whatever they chose.
     *
     * The consequence, deliberately accepted: on a fresh install (theme and
     * themeNight both 'dark') the seed lands on the value already there, so
     * the switch does nothing visible until the user sets Theme or Night theme
     * apart. There is no third state to infer that from — a dark day theme
     * with an unset night theme is indistinguishable from a dark day theme
     * with a deliberate dark night theme — and guessing wrong means the face
     * changes colour at dusk for someone who never asked.
     *
     * @param {Object} S Live settings state (config-ui engine's S).
     * @param {*} oldValue Previous toggle value.
     * @param {*} newValue New toggle value.
     * @returns {void}
     */
    function applyThemeAutoPreset(S, oldValue, newValue) {
        if (newValue !== true) { return; }
        if (S.theme !== S.themeNight) { return; }
        S.themeNight = 'dark';
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
