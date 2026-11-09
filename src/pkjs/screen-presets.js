// src/pkjs/screen-presets.js — ES5. The screen presets: the screens Add screen offers after Blank
// (the Watch bar and the clock), the owner's six (2026-11-08), each as the list of what it shows
// (screens.js THE LIST) and, for a forecast screen, the template its graph is (wizard-forecast.js
// LOOKS: the Graphs tab's templates).
//
// WHAT A PRESET BRINGS. Its rows, and on a watch with graph styles (Pebble Time 2) its graph: a
// graph of yours that reads as its template, else a new one from the template
// (screens-page.js). The bars it shows are yours: adding a screen changes no bar's slots (a bar
// shown for the first time takes its default slots, as every screen edit does), and the Watch
// bar stays as it is (the owner's: a preset sets it only in setup, for the first screen). A watch
// with one graph keeps that graph on every screen, so there a forecast preset brings its rows.
//
// WHICH ONES A WATCH GETS. Only the ones it can draw (offered): Weathergraph and Clean need the
// Pebble Time 2's long span, the Health ones a watch with health. aplite has no screens.
//
// Dual-context: a CommonJS module in the tests, a plain concatenated <script> in the settings-page
// webview (scripts/build-config-page.js' APP_FILES, after screens.js and ahead of the modules that
// bind window.ScreenPresets while their bodies run: screens-page.js and wizard-screens.js), which
// has no require(). It reads nothing at load.
(function () {
    // In the order Add screen lists them. `look` is the template a forecast screen's graph is;
    // `needs` names the env facts (config-ui/lib/platform.js computeEnv) the watch must have.
    var PRESETS = [
        { id: 'classic', name: 'Classic', look: 'classic', needs: [],
            list: [{ k: 'strip' }, { k: 'cal', rows: '3' }, { k: 'clock' }, { k: 'fcbar' }, { k: 'fc', size: 'fill' }] },
        { id: 'weathergraph', name: 'Weathergraph', look: 'clean', needs: ['graphStyles', 'health'],
            list: [{ k: 'strip' }, { k: 'clock' }, { k: 'fcbar' }, { k: 'fc', size: 'fill' }, { k: 'healthbar' }] },
        { id: 'clean', name: 'Clean', look: 'clean', needs: ['graphStyles'],
            list: [{ k: 'strip' }, { k: 'cal', rows: '2' }, { k: 'clock' }, { k: 'fcbar' }, { k: 'fc', size: 'fill' }] },
        { id: 'stripes', name: 'Stripes', look: 'stripes', needs: [],
            list: [{ k: 'strip' }, { k: 'cal', rows: '2' }, { k: 'clock' }, { k: 'fcbar' }, { k: 'fc', size: 'fill' }] },
        { id: 'healthCal', name: 'Health + calendar', look: null, needs: ['health'],
            list: [{ k: 'strip' }, { k: 'cal', rows: '2' }, { k: 'clock' }, { k: 'healthbar' }, { k: 'health', size: 'fill' }] },
        { id: 'health', name: 'Health', look: null, needs: ['health'],
            list: [{ k: 'strip' }, { k: 'clock' }, { k: 'healthbar' }, { k: 'health', size: 'fill' }] }
    ];
    // Blank: the Watch bar and the clock, the rest the user's.
    var BLANK = [{ k: 'strip' }, { k: 'clock' }];

    // What each card says under its name: with graph styles, and on a watch with one graph,
    // whose forecast presets keep that graph.
    var DESC = {
        classic: 'ForecasWatch2\'s look, 24 h.',
        weathergraph: '66 h, Health bar below.',
        clean: 'Calendar and 66 h.',
        stripes: 'Clouds and rain chance as stripes.',
        healthCal: 'Calendar, Health bar and health graph.',
        health: 'Health bar and health graph.'
    };
    var DESC_ONE_GRAPH = {
        classic: '3-row calendar, Forecast bar and your graph.',
        stripes: '2-row calendar, Forecast bar and your graph.'
    };

    /**
     * Whether a watch can draw a preset: it has every fact the preset needs. An unknown watch
     * (no env) is capable, as the page reads one everywhere.
     * @param {Object} preset A PRESETS entry.
     * @param {?Object} env Platform env.
     * @returns {boolean}
     */
    function drawable(preset, env) {
        if (!env) { return true; }
        return preset.needs.every(function (fact) { return Boolean(env[fact]); });
    }

    /**
     * The presets this watch can draw, in Add screen's order.
     * @param {?Object} env Platform env.
     * @returns {Array<Object>}
     */
    function offered(env) {
        return PRESETS.filter(function (p) { return drawable(p, env); });
    }

    /**
     * A preset by its id.
     * @param {string} id A preset's id.
     * @returns {?Object}
     */
    function byId(id) {
        for (var i = 0; i < PRESETS.length; i += 1) { if (PRESETS[i].id === id) { return PRESETS[i]; } }
        return null;
    }

    /**
     * A preset's card line on this watch.
     * @param {Object} preset A PRESETS entry.
     * @param {?Object} env Platform env.
     * @returns {string}
     */
    function describe(preset, env) {
        var oneGraph = Boolean(env) && !env.graphStyles;
        return (oneGraph && DESC_ONE_GRAPH[preset.id]) || DESC[preset.id] || '';
    }

    var api = {
        PRESETS: PRESETS,
        BLANK: BLANK,
        drawable: drawable,
        offered: offered,
        byId: byId,
        describe: describe
    };

    // Dual-context export — mirrors the tail of src/pkjs/forecast-axis.js.
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    if (typeof window !== 'undefined') {
        window.ScreenPresets = api;
    }
})();
