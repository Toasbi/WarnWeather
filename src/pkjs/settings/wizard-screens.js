// src/pkjs/settings/wizard-screens.js — ES5, WebView. The setup wizard's Screens step, as data: the
// flick screens setup offers (Long forecast, Health and Rain radar, each where the watch draws it),
// their rows on the calendar the Layout step picked (the owner's ask, 2026-11-09: a screen setup
// adds shows the Default screen's calendar, none, two or three rows), which of them a watch's
// screens already hold, where one goes in, what the step calls each screen, and the layout a
// Default screen reads as. The DOM half (the pictures, the flick, the Long forecast screen's
// graph, the writes through screens-page.js) is wizard.js'.
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

    // The flick screens setup offers, in the order they go in: the Long forecast screen (Pebble Time
    // 2: a second graph over the long span, the owner's ask, 2026-11-09; its graph is wizard.js'),
    // the Health screen, then the Rain radar screen (today's Flick 1 and Flick 2): Add a screen's
    // screens (screen-presets.js listOf). `env` names the watch's fact each needs, `graph` the
    // graph it shows. Each is named after its template as it goes in.
    var TEMPLATES = [
        { id: 'long', name: 'Long forecast', env: 'graphStyles', graph: 'fc' },
        { id: 'health', name: 'Health', env: 'health', graph: 'health' },
        { id: 'radar', name: 'Rain radar', env: 'radar', graph: 'radar' }
    ];
    // The length the Long forecast screen's graph shows: the long span's stored option
    // (forecast-span-hours.js CHOICES).
    var LONG_SPAN = '48';

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
     * A template's screen on a calendar (screen-presets.js listOf). The Long forecast screen's
     * graph is put on it as it goes in (wizard.js).
     * @param {Object} t A TEMPLATES entry.
     * @param {string} cal The calendar's rows: '' (none), '2' or '3'.
     * @returns {Array<Object>} a new list
     */
    function listOf(t, cal) {
        return PRESETS.listOf(t.graph, cal);
    }

    /**
     * The template a screen is, its calendar aside (screen-presets.js graphOf): the Health and
     * Rain radar screens by their rows, the Long forecast screen by its rows and a graph other
     * than the first (a forecast screen on the first graph is the user's own). Null for a screen
     * of the user's own.
     * @param {Array<Object>} list A screen.
     * @returns {?Object}
     */
    function templateOf(list) {
        var graph = PRESETS.graphOf(list);
        if (graph === 'fc') {
            var fc = list[M.idxOf(list, 'fc')];
            return fc && fc.style && fc.style !== '1' ? byId('long') : null;
        }
        for (var i = 0; i < TEMPLATES.length; i += 1) {
            if (graph && TEMPLATES[i].graph === graph) { return TEMPLATES[i]; }
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
     * Where a template goes in among the screens: before the first screen of a template that comes
     * after it (TEMPLATES' order: Long forecast, Health, Rain radar), so they keep that order;
     * else after the others.
     * @param {Array<Array<Object>>} screens The screens, the Default first.
     * @param {string} id The template.
     * @returns {number} Its slot.
     */
    function insertAt(screens, id) {
        var mine = TEMPLATES.indexOf(byId(id));
        for (var i = 1; i < screens.length; i += 1) {
            var t = templateOf(screens[i]);
            if (t && TEMPLATES.indexOf(t) > mine) { return i; }
        }
        return screens.length;
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
        LONG_SPAN: LONG_SPAN,
        offered: offered,
        byId: byId,
        listOf: listOf,
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
