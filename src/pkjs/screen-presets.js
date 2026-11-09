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
// has no require(). At load it reads the page's html helpers (config-ui/lib/html.js) and the
// screens model (screens.js), both ahead of it.
(function () {
    var node = typeof require !== 'undefined';
    // Names as a sentence lists them (config-ui/lib/html.js, concatenated ahead of every app file).
    var html = node ? require('./config-ui/lib/html.js') : window.PConf.html;
    // The rows' names (screens.js blockName).
    var M = node ? require('./screens.js') : window.Screens;
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

    // The rows every screen has (the Watch bar, the clock), which a card's line leaves out (describe).
    var EVERY_SCREEN = ['strip', 'clock'];

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
     * The setup's looks, the templates a preset's graph is (settings/wizard-forecast.js LOOKS,
     * their one definition), read when asked: they load after this file in the page.
     * @returns {Object}
     */
    function looks() {
        return node ? require('./settings/wizard-forecast.js') : window.WizardForecast;
    }

    /**
     * A preset's forecast graph as its card names it: on a watch with graph styles, the template
     * it brings by its name and the length it starts on with the user's weather service ("24 h
     * Classic graph", "47 h Clean graph" with OpenWeatherMap); on a watch with one graph, which
     * the preset keeps, "your graph".
     * @param {Object} preset A PRESETS entry with a look.
     * @param {?Object} env Platform env.
     * @param {?Object} S The user's settings.
     * @returns {string}
     */
    function graphWords(preset, env, S) {
        if (env && !env.graphStyles) { return 'your graph'; }
        var WF = looks(), look = WF.lookOf(preset.look), len = WF.spanLabel(preset.look, env, S);
        return (len ? len + ' ' : '') + (look ? look.label + ' ' : '') + 'graph';
    }

    /**
     * A preset's card line on this watch, from its list: the calendar's rows, the bars by their
     * names and the graphs it shows ("3-row calendar, Forecast bar and 24 h Classic graph.").
     * @param {Object} preset A PRESETS entry.
     * @param {?Object} env Platform env.
     * @param {?Object} S The user's settings (the bars' names, the weather service).
     * @returns {string}
     */
    function describe(preset, env, S) {
        var words = preset.list.filter(function (b) { return EVERY_SCREEN.indexOf(b.k) === -1; }).map(function (b) {
            if (b.k === 'cal') { return b.rows + '-row calendar'; }
            if (b.k === 'fc') { return graphWords(preset, env, S); }
            return M.blockName(b, S);
        });
        return html.capitalize(html.andList(words)) + '.';
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
