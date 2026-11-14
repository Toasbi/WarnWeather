// src/pkjs/page/layout/screen-presets.js — ES5. The screens Add a screen offers (the owner's five, 2026-11-09,
// then many more; 2026-11-10: the layout first, then the graph): Blank, the Watch bar and the
// clock with the rest yours to add (the owner's, 2026-11-10: still the first), then the forecast
// screen on each calendar, then the screens of the other graphs: Health, Rain radar, and two
// graphs on one screen, the health graph or the rain radar over the forecast. A screen's forecast
// graph is picked after its layout (screens-page.js: your graphs, then the templates,
// wizard-forecast.js LOOKS, the Graphs tab's), and Health's and Rain radar's calendar there too.
// Setup's Screens step adds its screens from the same lists (page/settings/wizard/wizard-screens.js). Each
// kind's `group` is the heading Add a screen lists it under.
//
// A SCREEN'S ROWS (listOf): the Watch bar, a calendar of none, two or three rows, the clock, the
// graph's bar and the graph filling the rest (screens.js THE LIST); Blank the Watch bar and the
// clock. Add a screen shows the forecast screen once per calendar (cards: None, Compact and Full,
// the owner's, 2026-11-10, then Dense), each named after it (cardName), and the others once,
// setup adds them on its Layout's. Dense (the owner's ask, 2026-11-10: more status bars at once)
// is the compact calendar with the radar bar right under it and the graph's own bar under the
// clock (the forecast bar under the Rain radar's), on a watch with the rain radar. A screen of two
// graphs has its upper graph, three rows high, in the calendar's seat (screens.js: one row sits
// there), so it has no calendar (calendars). Every kind fits with every calendar on every watch
// that is offered it (test/config-screen-presets.test.js).
//
// WHAT A SCREEN BRINGS. Its rows, and on a watch with graph styles (Pebble Time 2) the graph its
// forecast graph draws: one of yours, or a template's at the length picked, as a template graph
// (the owner's, 2026-11-10: graph-styles.js TEMPLATE GRAPHS), which is none of your six graphs
// until you edit it and goes with the screen (screens-page.js). The bars it shows are yours:
// adding a screen changes no bar's slots (a bar shown for the first time takes its default slots,
// as every screen edit does), and the Watch bar stays as it is. A watch with one graph keeps that
// graph on every screen, so a screen there brings its rows alone.
//
// WHAT A SCREEN SHOWS. A card shows its screen with your graph; the screen picked shows the graph
// picked, with the legend of what its graphs draw (page/layout/screen-legend.js, read off the
// picture's settings); a card's picture shows its calendar, which Dense names to a screen reader
// too (cardSaid).
//
// WHICH ONES A WATCH GETS. Only the ones it can draw (offered): Blank and the forecast screen on
// every watch, Dense on one with the rain radar, Health and Health + forecast on a watch with
// health, Rain radar and Radar + forecast on one with the rain radar; the templates on a watch with
// graph styles (templates). aplite has no screens.
//
// Dual-context: a CommonJS module in the tests, a plain concatenated <script> in the settings-page
// webview (scripts/build-config-page.js' APP_FILES, after screens.js and ahead of the modules that
// bind window.ScreenPresets while their bodies run: screens-page.js and wizard-screens.js), which
// has no require(). At load it reads the screens model (screens.js), ahead of it.
(function () {
    var node = typeof require !== 'undefined';
    // The rows' names (screens.js blockName).
    var M = node ? require('../../layout/domain/screens.js') : window.Screens;
    // In the order Add a screen lists them. `graph` is the graph the screen shows (screens.js
    // kinds; none on Blank), `upper` the one over it on a screen of two graphs; `needs` names the
    // env facts (config-ui/lib/platform.js computeEnv) the watch must have; `group` the heading it
    // is listed under (GROUPS). `layouts`: its cards are its layouts, one per calendar (cards),
    // named after it (cardName), so its calendar is picked on its card and the screen is named
    // after its graph (screens-page.js); another kind's calendar is picked after its card.
    var KINDS = [
        { id: 'blank', name: 'Blank', graph: '', needs: [], group: 'start' },
        { id: 'forecast', name: 'Forecast', graph: 'fc', needs: [], group: 'fc', layouts: true },
        { id: 'health', name: 'Health', graph: 'health', needs: ['health'], group: 'more' },
        { id: 'radar', name: 'Rain radar', graph: 'radar', needs: ['radar'], group: 'more' },
        { id: 'healthfc', name: 'Health + forecast', graph: 'fc', upper: 'health', needs: ['health'], group: 'more' },
        { id: 'radarfc', name: 'Radar + forecast', graph: 'fc', upper: 'radar', needs: ['radar'], group: 'more' }
    ];
    // Add a screen's headings, in order, each over the cards of its group: Blank under none, the
    // forecast screen's layouts, then the other graphs' screens.
    var GROUPS = [{ id: 'start', name: '' }, { id: 'fc', name: 'With a forecast graph' }, { id: 'more', name: 'Other screens' }];
    // Each graph's bar, the row over it.
    var BAR_OF = { fc: 'fcbar', health: 'healthbar', radar: 'radarbar' };
    // An upper graph's rows, on a screen of two graphs: three, the forecast filling the rest under
    // its bar on every watch (the fit test).
    var UPPER_SIZE = '3';
    // A screen's calendars, in the order Add a screen shows them: [name, rows] ('' for none, DENSE
    // for the compact one with the radar bar under it): the forecast screen's cards, by their names
    // (LAYOUT_NAME, Dense's said in full to a screen reader: cardSaid), Health's and Rain radar's
    // Calendar choice, by the first.
    var DENSE = 'dense';
    var CALENDARS = [['None', ''], ['Compact', '2'], ['Full', '3'], ['Dense', DENSE]];
    var LAYOUT_NAME = { '': 'No calendar', '2': 'Compact calendar', '3': 'Full calendar', dense: 'Dense' };
    // A screen with nothing but the Watch bar and the clock: Blank.
    var BLANK = [{ k: 'strip' }, { k: 'clock' }];

    /**
     * Whether a watch can draw a kind: it has every fact the kind needs. An unknown watch (no env)
     * is capable, as the page reads one everywhere.
     * @param {Object} kind A KINDS entry.
     * @param {?Object} env Platform env.
     * @returns {boolean}
     */
    function drawable(kind, env) {
        return !env || kind.needs.every(function (fact) { return Boolean(env[fact]); });
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
     * @param {string} cal Its calendar's rows: '' (none), '2' or '3', or DENSE; none under an upper
     *   graph.
     * @param {string} [upper] The graph over it, on a screen of two graphs: 'health' | 'radar'.
     * @returns {Array<Object>} a new list
     */
    function listOf(graph, cal, upper) {
        var list = [{ k: 'strip' }], bar = BAR_OF[graph];
        if (upper) {
            list.push({ k: upper, size: UPPER_SIZE });
        } else if (cal === DENSE) {
            // The radar bar under the compact calendar, the graph's own under the clock: the
            // forecast bar under the Rain radar's, whose bar is up top.
            list.push({ k: 'cal', rows: '2' }, { k: BAR_OF.radar });
            if (graph === 'radar') { bar = BAR_OF.fc; }
        } else if (cal) {
            list.push({ k: 'cal', rows: cal });
        }
        return list.concat([{ k: 'clock' }, { k: bar }, { k: graph, size: 'fill' }]);
    }

    /**
     * A kind's screen with a calendar (listOf): its upper graph, if it has one, in the
     * calendar's seat; Blank's Watch bar and clock.
     * @param {Object} kind A KINDS entry.
     * @param {string} cal Its calendar's rows: '' | '2' | '3' | DENSE.
     * @returns {Array<Object>} a new list
     */
    function screenOf(kind, cal) {
        if (!kind.graph) { return M.copy(BLANK); }
        return listOf(kind.graph, kind.upper ? '' : cal, kind.upper);
    }

    /**
     * The calendars a kind can have: every one, Dense only on a watch with the rain radar (an
     * unknown one too); none on Blank, nor on a screen of two graphs (its upper graph has the
     * calendar's seat).
     * @param {Object} kind A KINDS entry.
     * @param {?Object} [env] Platform env.
     * @returns {Array<Array<string>>} [name, rows] pairs
     */
    function calendars(kind, env) {
        if (!kind.graph || kind.upper) { return []; }
        return !env || env.radar ? CALENDARS : CALENDARS.filter(function (c) { return c[1] !== DENSE; });
    }

    /**
     * Add a screen's cards on this watch, in its order: each kind it can draw (offered), the
     * forecast screen once per calendar it can have (None, Compact, Full and Dense in turn: the
     * owner's, 2026-11-10, the layout first, its graph after it), the others once (Health's and
     * Rain radar's calendar is picked after them, from None).
     * @param {?Object} env Platform env.
     * @returns {Array<{kind: Object, cal: string}>} cal: '' | '2' | '3' | DENSE
     */
    function cards(env) {
        var out = [];
        offered(env).forEach(function (kind) {
            var cals = kind.layouts ? calendars(kind, env) : [['', '']];
            cals.forEach(function (c) { out.push({ kind: kind, cal: c[1] }); });
        });
        return out;
    }

    /**
     * A card's name: a layout's by its calendar ("Compact calendar", "Dense"), the others' their
     * own.
     * @param {Object} kind A KINDS entry.
     * @param {string} cal Its calendar's rows: '' | '2' | '3' | DENSE.
     * @returns {string}
     */
    function cardName(kind, cal) {
        return kind.layouts ? LAYOUT_NAME[cal] || LAYOUT_NAME[''] : kind.name;
    }

    /**
     * What a screen reader hears after a card's name, which leaves it out: Dense's calendar, the
     * compact one with the radar bar; '' for every other card.
     * @param {Object} kind A KINDS entry.
     * @param {string} cal Its calendar's rows: '' | '2' | '3' | DENSE.
     * @returns {string}
     */
    function cardSaid(kind, cal) {
        return kind.layouts && cal === DENSE ? 'compact calendar and radar bar' : '';
    }

    /**
     * Whether a kind's screen shows the rain radar, its graph or, Dense, its bar (adding it turns
     * the radar on).
     * @param {Object} kind A KINDS entry.
     * @param {string} [cal] Its calendar: DENSE shows the radar bar.
     * @returns {boolean}
     */
    function showsRadar(kind, cal) {
        return kind.graph === 'radar' || kind.upper === 'radar' || (calendars(kind).length > 0 && cal === DENSE);
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
     * The setup's looks, the templates a forecast screen's graph can be (page/settings/wizard/wizard-forecast.js
     * LOOKS, their one definition), read when asked: they load after this file in the page.
     * @returns {Object}
     */
    function looks() {
        return node ? require('../settings/wizard/wizard-forecast.js') : window.WizardForecast;
    }

    /**
     * The templates a screen's forecast graph can draw on this watch, in the New graph sheet's
     * order (wizard-forecast.js LOOKS): every one on a watch with graph styles (an unknown watch
     * has them), none elsewhere, where every screen keeps your graph.
     * @param {?Object} env Platform env.
     * @returns {Array<Object>} LOOKS entries
     */
    function templates(env) {
        return !env || env.graphStyles ? looks().LOOKS : [];
    }

    /**
     * A template by its id, where this watch can draw it (templates).
     * @param {string} id A template's id.
     * @param {?Object} env Platform env.
     * @returns {?Object} its LOOKS entry
     */
    function template(id, env) {
        return templates(env).length ? looks().lookOf(id) : null;
    }

    /**
     * A template's lengths as Add a screen's Forecast length names them (wizard-forecast.js
     * lookSpanOptions: the long span by the hours it shows), where this watch can draw it and has
     * a Forecast length; none elsewhere.
     * @param {string} id A template's id.
     * @param {?Object} env Platform env.
     * @param {?Object} S The user's settings (the weather service).
     * @returns {Array<Array<string>>} [label, value] pairs
     */
    function spanOptions(id, env, S) {
        return template(id, env) ? looks().lookSpanOptions(id, env, S) : [];
    }

    var api = {
        KINDS: KINDS,
        GROUPS: GROUPS,
        CALENDARS: CALENDARS,
        DENSE: DENSE,
        BLANK: BLANK,
        drawable: drawable,
        offered: offered,
        byId: byId,
        listOf: listOf,
        screenOf: screenOf,
        calendars: calendars,
        cards: cards,
        cardName: cardName,
        cardSaid: cardSaid,
        showsRadar: showsRadar,
        calOf: calOf,
        graphOf: graphOf,
        templates: templates,
        template: template,
        spanOptions: spanOptions
    };

    // Dual-context export — mirrors the tail of src/pkjs/forecast-axis.js.
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    if (typeof window !== 'undefined') {
        window.ScreenPresets = api;
    }
})();
