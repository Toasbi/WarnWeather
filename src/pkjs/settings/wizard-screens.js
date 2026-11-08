// src/pkjs/settings/wizard-screens.js — ES5, WebView. The setup wizard's Screens step, as data: the
// flick screens setup offers (Health and Rain radar, each where the watch draws it), which of them
// a watch's screens already hold, where one goes in, what the step calls each screen, and the
// layout a Default screen reads as. The DOM half (the pictures, the flick, the writes through
// screens-page.js) is wizard.js'.
//
// Dual-context: a CommonJS module in the tests, a plain concatenated <script> in the settings-page
// webview (scripts/build-config-page.js' APP_FILES, after screens.js and screen-presets.js, which it
// reads at load as window.Screens and window.ScreenPresets, and ahead of wizard.js), which has no
// require().
(function () {
    var M = (typeof require !== 'undefined') ? require('../screens.js') : window.Screens;
    var PRESETS = (typeof require !== 'undefined') ? require('../screen-presets.js') : window.ScreenPresets;

    // A stored layout the Layout picker doesn't offer -> the nearest one it does (aplite, whose
    // Layout is still a preset): Compact for the dense two-row calendar, No calendar for Weather
    // only (no calendar either, a big forecast). Neither has a screenshot of its own.
    var NEAREST_LAYOUT = { compactDense: 'compactCal', weatherOnly: 'noCal' };

    // The flick screens setup offers, in the order they go in: the Health screen (Add screen's
    // Health preset, screen-presets.js), then the Rain radar screen (today's Flick 1 and Flick 2).
    // `env` names the watch's fact each needs. Each is named after its template as it goes in.
    var TEMPLATES = [
        { id: 'health', name: 'Health', env: 'health', list: M.copy(PRESETS.byId('health').list) },
        { id: 'radar', name: 'Rain radar', env: 'radar',
            list: [{ k: 'strip' }, { k: 'clock' }, { k: 'radarbar' }, { k: 'radar', size: 'fill' }] }
    ];

    /**
     * The templates this watch can show.
     * @param {?Object} env Platform env.
     * @returns {Array<Object>}
     */
    function offered(env) {
        return TEMPLATES.filter(function (t) { return Boolean(env && env[t.env]); });
    }

    /**
     * A template by its id.
     * @param {string} id 'health' | 'radar'.
     * @returns {?Object}
     */
    function byId(id) {
        for (var i = 0; i < TEMPLATES.length; i += 1) { if (TEMPLATES[i].id === id) { return TEMPLATES[i]; } }
        return null;
    }

    /**
     * The template a screen is, row for row, or null for a screen of the user's own.
     * @param {Array<Object>} list A screen.
     * @returns {?Object}
     */
    function templateOf(list) {
        var seen = JSON.stringify(list || []);
        for (var i = 0; i < TEMPLATES.length; i += 1) {
            if (JSON.stringify(TEMPLATES[i].list) === seen) { return TEMPLATES[i]; }
        }
        return null;
    }

    /**
     * What the step calls a screen: its own name (screens.js nameOf), else Default, a template's
     * name (a screen added before screens had names), else its place (Flick 1, Flick 2).
     * @param {Array<Object>} list The screen.
     * @param {number} i Its place (0 = Default).
     * @param {Object} [S] Settings (its stored name).
     * @returns {string}
     */
    function nameOf(list, i, S) {
        var own = M.cleanName(S && S['viewName' + i]);
        if (own) { return own; }
        if (i === 0) { return M.NAMES[0]; }
        var t = templateOf(list);
        return t ? t.name : M.NAMES[i] || 'Flick ' + i;
    }

    /**
     * Where a template goes in among the screens: the Health screen before a Rain radar screen
     * already there, so the two keep that order; else after the others.
     * @param {Array<Array<Object>>} screens The screens, the Default first.
     * @param {string} id The template.
     * @returns {number} Its slot.
     */
    function insertAt(screens, id) {
        var radar = id === 'health' ? slotOf(screens, 'radar') : -1;
        return radar > 0 ? radar : screens.length;
    }

    /**
     * The slot a template is on, or -1.
     * @param {Array<Array<Object>>} screens The screens.
     * @param {string} id The template.
     * @returns {number}
     */
    function slotOf(screens, id) {
        for (var i = 1; i < screens.length; i += 1) {
            var t = templateOf(screens[i]);
            if (t && t.id === id) { return i; }
        }
        return -1;
    }

    /**
     * The layout a Default screen reads as, for the Layout picker: a three-row calendar is Full
     * calendar, a two-row one Compact, none No calendar.
     * @param {Array<Object>} list The Default screen.
     * @returns {string} 'fullCal' | 'compactCal' | 'noCal'
     */
    function layoutOf(list) {
        var c = M.idxOf(list || [], 'cal');
        if (c < 0) { return 'noCal'; }
        return list[c].rows === '3' ? 'fullCal' : 'compactCal';
    }

    var api = {
        NEAREST_LAYOUT: NEAREST_LAYOUT,
        TEMPLATES: TEMPLATES,
        offered: offered,
        byId: byId,
        templateOf: templateOf,
        nameOf: nameOf,
        insertAt: insertAt,
        slotOf: slotOf,
        layoutOf: layoutOf
    };

    // Dual-context export — mirrors the tail of src/pkjs/forecast-axis.js.
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    if (typeof window !== 'undefined') {
        window.WizardScreens = api;
    }
})();
