// src/pkjs/settings/theme-convert.js — ES5, WebView. Registers the config-ui
// engine's 'themeConvert' and 'themeAutoPreset' onChange hooks (see engine.js's
// PConf.onChange).
//
// The conversion rules themselves live in the side-effect-free leaf
// theme-flip.js (the resolve-ink.js pattern), because the phone runtime needs
// the same conversion for the auto theme switch's send-time scratch copy
// (theme-schedule.js) — and requiring THIS file registers a hook, so it cannot
// be the shared home. This file is only the page-side registration; it
// re-exports the leaf's functions under Node so the tests keep one entry point.
/* global PConf */
var PConf = (typeof global !== 'undefined' && global.PConf) ? global.PConf
    : (typeof window !== 'undefined' && window.PConf) ? window.PConf
    : (typeof PConf !== 'undefined' && PConf) ? PConf
    : { onChange: { register: function () {}, get: function () {} } };

(function () {
    // Dual-context (see line-style.js): a CommonJS require under Node, the window
    // global published by the file concatenated ahead of this one in the page
    // bundle (build-config-page.js's APP_FILES puts theme-flip.js before this file).
    var themeFlip = (typeof require !== 'undefined')
        ? require('../theme-flip.js') : window.ThemeFlip;
    // Under Node, config-ui lib files seed global.PConf as a bare {} shard (e.g.
    // show-when.js) that carries no onChange registry — registration is a
    // page-only concern, so a missing registry is a no-op, not a crash.
    var onChange = (PConf && PConf.onChange) ? PConf.onChange
        : { register: function () {} };

    onChange.register('themeConvert', function (S, oldTheme, newTheme) {
        themeFlip.applyThemeConvert(S, oldTheme, newTheme);
    });

    onChange.register('themeAutoPreset', function (S, oldValue, newValue) {
        themeFlip.applyThemeAutoPreset(S, oldValue, newValue);
    });

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = {
            applyThemeConvert: themeFlip.applyThemeConvert,
            applyThemeAutoPreset: themeFlip.applyThemeAutoPreset
        };
    }
})();
