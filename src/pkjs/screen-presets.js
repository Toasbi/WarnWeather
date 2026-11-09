// src/pkjs/screen-presets.js — ES5. The screens Add a screen offers (the owner's five, 2026-11-09):
// Classic, Clean and Stripes, a forecast screen whose graph is that template (wizard-forecast.js
// LOOKS: the Graphs tab's templates), then Health and Rain radar. Setup's Screens step adds its
// screens from the same lists (settings/wizard-screens.js).
//
// A SCREEN'S ROWS (listOf): the Watch bar, a calendar of none, two or three rows (picked: Add a
// screen starts on the Default screen's, setup on its Layout), the clock, the graph's bar and the
// graph filling the rest (screens.js THE LIST). Every kind fits with every calendar on every
// watch that is offered it (test/config-screen-presets.test.js).
//
// WHAT A SCREEN BRINGS. Its rows, and on a watch with graph styles (Pebble Time 2) a forecast
// screen's graph: a graph of yours that reads as its template at the length picked, else a new
// one from the template (screens-page.js). The bars it shows are yours: adding a screen changes
// no bar's slots (a bar shown for the first time takes its default slots, as every screen edit
// does), and the Watch bar stays as it is. A watch with one graph keeps that graph on every
// screen, so it gets one forecast screen, Forecast, which brings its rows alone.
//
// WHICH ONES A WATCH GETS. Only the ones it can draw (offered): the templates on the Pebble Time 2,
// Forecast on a watch with one graph, Health on a watch with health, Rain radar on one with the
// rain radar. aplite has no screens.
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
    // In the order Add a screen lists them. `look` is the template a forecast screen's graph is;
    // `graph` the graph the screen shows (screens.js kinds); `needs` names the env facts
    // (config-ui/lib/platform.js computeEnv) the watch must have, `without` one it must not.
    var KINDS = [
        { id: 'classic', name: 'Classic', look: 'classic', graph: 'fc', needs: ['graphStyles'] },
        { id: 'clean', name: 'Clean', look: 'clean', graph: 'fc', needs: ['graphStyles'] },
        { id: 'stripes', name: 'Stripes', look: 'stripes', graph: 'fc', needs: ['graphStyles'] },
        { id: 'forecast', name: 'Forecast', look: null, graph: 'fc', needs: [], without: 'graphStyles' },
        { id: 'health', name: 'Health', look: null, graph: 'health', needs: ['health'] },
        { id: 'radar', name: 'Rain radar', look: null, graph: 'radar', needs: ['radar'] }
    ];
    // Each graph's bar, the row over it.
    var BAR_OF = { fc: 'fcbar', health: 'healthbar', radar: 'radarbar' };
    // A screen's calendar as Add a screen's Calendar names it: its rows ('' for none).
    var CALENDARS = [['None', ''], ['Compact', '2'], ['Full', '3']];
    // A screen with nothing but the Watch bar and the clock (screens-page.js addScreen).
    var BLANK = [{ k: 'strip' }, { k: 'clock' }];

    /**
     * Whether a watch can draw a kind: it has every fact the kind needs, and not the one it is
     * without. An unknown watch (no env) is capable, as the page reads one everywhere: it draws
     * graph styles, so it gets the templates.
     * @param {Object} kind A KINDS entry.
     * @param {?Object} env Platform env.
     * @returns {boolean}
     */
    function drawable(kind, env) {
        if (!env) { return !kind.without; }
        return kind.needs.every(function (fact) { return Boolean(env[fact]); })
            && !(kind.without && env[kind.without]);
    }

    /**
     * The kinds this watch can draw, in Add a screen's order.
     * @param {?Object} env Platform env.
     * @returns {Array<Object>}
     */
    function offered(env) {
        return KINDS.filter(function (kind) { return drawable(kind, env); });
    }

    /**
     * A kind by its id.
     * @param {string} id A kind's id.
     * @returns {?Object}
     */
    function byId(id) {
        for (var i = 0; i < KINDS.length; i += 1) { if (KINDS[i].id === id) { return KINDS[i]; } }
        return null;
    }

    /**
     * A screen's rows (A SCREEN'S ROWS above).
     * @param {string} graph The graph it shows: 'fc' | 'health' | 'radar'.
     * @param {string} cal Its calendar's rows: '' (none), '2' or '3'.
     * @returns {Array<Object>} a new list
     */
    function listOf(graph, cal) {
        var list = [{ k: 'strip' }];
        if (cal) { list.push({ k: 'cal', rows: cal }); }
        return list.concat([{ k: 'clock' }, { k: BAR_OF[graph] }, { k: graph, size: 'fill' }]);
    }

    /**
     * A screen's calendar: its rows, '' without one.
     * @param {?Array<Object>} list A screen.
     * @returns {string} '' | '2' | '3'
     */
    function calOf(list) {
        var c = M.idxOf(list || [], 'cal');
        return c < 0 ? '' : (list[c].rows === '3' ? '3' : '2');
    }

    /**
     * The graph a screen of these kinds shows, read off its rows (its calendar and its graph's
     * style aside): '' for a screen of the user's own.
     * @param {?Array<Object>} list A screen.
     * @returns {string} 'fc' | 'health' | 'radar' | ''
     */
    function graphOf(list) {
        /** @param {Array<Object>} l @returns {string} each row's kind and size, the calendar left out */
        function bare(l) {
            return l.filter(function (x) { return x.k !== 'cal'; })
                .map(function (x) { return x.k + ':' + (x.size || ''); }).join('|');
        }
        var seen = bare(list || []);
        for (var graph in BAR_OF) {
            if (Object.prototype.hasOwnProperty.call(BAR_OF, graph) && bare(listOf(graph, '')) === seen) { return graph; }
        }
        return '';
    }

    /**
     * The setup's looks, the templates a forecast screen's graph is (settings/wizard-forecast.js
     * LOOKS, their one definition), read when asked: they load after this file in the page.
     * @returns {Object}
     */
    function looks() {
        return node ? require('./settings/wizard-forecast.js') : window.WizardForecast;
    }

    /**
     * The length a kind's graph starts on: its template's (Classic and Stripes 24 hours, Clean the
     * long span), on a watch with graph styles; '' elsewhere, where every screen keeps your graph.
     * @param {Object} kind A KINDS entry.
     * @param {?Object} env Platform env.
     * @returns {string} '12' | '24' | '48' | ''
     */
    function spanOf(kind, env) {
        var look = kind.look && (!env || env.graphStyles) ? looks().lookOf(kind.look) : null;
        return look ? look.span : '';
    }

    /**
     * A kind's lengths as Add a screen's Forecast length names them (wizard-forecast.js
     * lookSpanOptions: the long span by the hours its template shows): a forecast screen's on a
     * watch with graph styles, none elsewhere.
     * @param {Object} kind A KINDS entry.
     * @param {?Object} env Platform env.
     * @param {?Object} S The user's settings (the weather service).
     * @returns {Array<Array<string>>} [label, value] pairs
     */
    function spanOptions(kind, env, S) {
        return spanOf(kind, env) ? looks().lookSpanOptions(kind.look, env, S) : [];
    }

    /**
     * A kind's forecast graph as its card names it: on a watch with graph styles, the template
     * it brings by its name and the length (spanOf, or the one picked) with the user's weather
     * service ("24 h Classic graph", "47 h Clean graph" with OpenWeatherMap); on a watch with one
     * graph, which every screen keeps, "your graph".
     * @param {Object} kind A KINDS entry with a forecast graph.
     * @param {?Object} env Platform env.
     * @param {?Object} S The user's settings.
     * @param {string} [span] The length picked ('12' | '24' | '48'); the template's own without.
     * @returns {string}
     */
    function graphWords(kind, env, S, span) {
        if (!kind.look) { return 'your graph'; }
        var WF = looks(), look = WF.lookOf(kind.look), len = WF.spanLabel(kind.look, env, S, span);
        return (len ? len + ' ' : '') + (look ? look.label + ' ' : '') + 'graph';
    }

    /**
     * A kind's card line on this watch: its bar by its name and its graph ("Forecast bar and 24 h
     * Classic graph."). The calendar is picked once the card is.
     * @param {Object} kind A KINDS entry.
     * @param {?Object} env Platform env.
     * @param {?Object} S The user's settings (the bars' names, the weather service).
     * @param {string} [span] The length picked, for a forecast graph.
     * @returns {string}
     */
    function describe(kind, env, S, span) {
        var words = listOf(kind.graph, '').filter(function (b) { return b.k !== 'strip' && b.k !== 'clock'; })
            .map(function (b) { return b.k === 'fc' ? graphWords(kind, env, S, span) : M.blockName(b, S); });
        return html.capitalize(html.andList(words)) + '.';
    }

    var api = {
        KINDS: KINDS,
        CALENDARS: CALENDARS,
        BLANK: BLANK,
        drawable: drawable,
        offered: offered,
        byId: byId,
        listOf: listOf,
        calOf: calOf,
        graphOf: graphOf,
        spanOf: spanOf,
        spanOptions: spanOptions,
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
