// src/pkjs/screen-presets.js — ES5. The screens Add a screen offers (the owner's five, 2026-11-09,
// then many more, to show what the watchface can draw; 2026-11-10: the common ways to show the
// weather, and better too many than too few): a forecast screen whose graph is a template
// (wizard-forecast.js LOOKS: the Graphs tab's templates) in a themed row (GROUPS): Everyday
// (Classic, Clean, Stripes, Simple), Rain and clouds (Rain, Sky, Clouds), Outdoors (Outdoor, Sun,
// Comfort), Wind and pressure (Wind, Storm, Pressure, Meteogram); then Health and Rain radar, and
// two graphs on one screen, the health graph or the rain radar over the forecast. Setup's Screens
// step adds its screens from the same lists (settings/wizard-screens.js). Each kind's `group` is the
// row Add a screen lists it in.
//
// A SCREEN'S ROWS (listOf): the Watch bar, a calendar of none, two or three rows, the clock, the
// graph's bar and the graph filling the rest (screens.js THE LIST). Add a screen shows each kind
// once per calendar (cards: None, Compact and Full, the owner's, 2026-11-10, then Dense), setup
// adds it on its Layout's. Dense (the owner's ask, 2026-11-10: more status bars at once) is the
// compact calendar with the radar bar right under it and the graph's own bar under the clock (the
// forecast bar under the Rain radar's), on a watch with the rain radar. A screen of two graphs has
// its upper graph, three rows high, in the calendar's seat (screens.js: one row sits there), so it
// has no calendar (calendars) and one card. Every kind fits with every calendar on every watch that
// is offered it (test/config-screen-presets.test.js).
//
// WHAT A SCREEN BRINGS. Its rows, and on a watch with graph styles (Pebble Time 2) a forecast
// screen's graph: its template's, at the length picked, as a template graph (the owner's,
// 2026-11-10: graph-styles.js TEMPLATE GRAPHS), which is none of your six graphs until you edit
// it and goes with the screen (screens-page.js). The bars it shows are yours: adding a screen changes
// no bar's slots (a bar shown for the first time takes its default slots, as every screen edit
// does), and the Watch bar stays as it is. A watch with one graph keeps that graph on every
// screen, so it gets one forecast screen, Forecast, which brings its rows alone.
//
// WHAT A SCREEN SHOWS. A card and its picked screen show the legend of what its graphs draw
// (settings/screen-legend.js, read off the picture's settings: a template's graph at the length
// picked, your graph's where the screen keeps it); a card names its calendar to a screen reader
// only (calendarName), as its picture shows it (the owner's, 2026-11-10).
//
// WHICH ONES A WATCH GETS. Only the ones it can draw (offered): the templates on the Pebble Time 2,
// Forecast on a watch with one graph, Health and Health + forecast on a watch with health, Rain
// radar and Radar + forecast on one with the rain radar. A screen of two graphs keeps your
// forecast graph, as Forecast does. aplite has no screens.
//
// Dual-context: a CommonJS module in the tests, a plain concatenated <script> in the settings-page
// webview (scripts/build-config-page.js' APP_FILES, after screens.js and ahead of the modules that
// bind window.ScreenPresets while their bodies run: screens-page.js and wizard-screens.js), which
// has no require(). At load it reads the screens model (screens.js), ahead of it.
(function () {
    var node = typeof require !== 'undefined';
    // The rows' names (screens.js blockName).
    var M = node ? require('./screens.js') : window.Screens;
    // In the order Add a screen lists them. `look` is the template a forecast screen's graph is
    // (its name is the template's label); `graph` the graph the screen shows (screens.js kinds),
    // `upper` the one over it on a screen of two graphs; `needs` names the env facts
    // (config-ui/lib/platform.js computeEnv) the watch must have, `without` one it must not;
    // `group` the heading it is listed under (GROUPS).
    var KINDS = [
        { id: 'classic', name: 'Classic', look: 'classic', graph: 'fc', needs: ['graphStyles'], group: 'everyday' },
        { id: 'clean', name: 'Clean', look: 'clean', graph: 'fc', needs: ['graphStyles'], group: 'everyday' },
        { id: 'stripes', name: 'Stripes', look: 'stripes', graph: 'fc', needs: ['graphStyles'], group: 'everyday' },
        { id: 'simple', name: 'Simple', look: 'simple', graph: 'fc', needs: ['graphStyles'], group: 'everyday' },
        { id: 'rain', name: 'Rain', look: 'rain', graph: 'fc', needs: ['graphStyles'], group: 'rain' },
        { id: 'sky', name: 'Sky', look: 'sky', graph: 'fc', needs: ['graphStyles'], group: 'rain' },
        { id: 'clouds', name: 'Clouds', look: 'clouds', graph: 'fc', needs: ['graphStyles'], group: 'rain' },
        { id: 'outdoor', name: 'Outdoor', look: 'outdoor', graph: 'fc', needs: ['graphStyles'], group: 'outdoors' },
        { id: 'sun', name: 'Sun', look: 'sun', graph: 'fc', needs: ['graphStyles'], group: 'outdoors' },
        { id: 'comfort', name: 'Comfort', look: 'comfort', graph: 'fc', needs: ['graphStyles'], group: 'outdoors' },
        { id: 'wind', name: 'Wind', look: 'wind', graph: 'fc', needs: ['graphStyles'], group: 'wind' },
        { id: 'storm', name: 'Storm', look: 'storm', graph: 'fc', needs: ['graphStyles'], group: 'wind' },
        { id: 'pressure', name: 'Pressure', look: 'pressure', graph: 'fc', needs: ['graphStyles'], group: 'wind' },
        { id: 'meteogram', name: 'Meteogram', look: 'meteogram', graph: 'fc', needs: ['graphStyles'], group: 'wind' },
        { id: 'forecast', name: 'Forecast', look: null, graph: 'fc', needs: [], without: 'graphStyles', group: 'fc' },
        { id: 'health', name: 'Health', look: null, graph: 'health', needs: ['health'], group: 'more' },
        { id: 'radar', name: 'Rain radar', look: null, graph: 'radar', needs: ['radar'], group: 'more' },
        { id: 'healthfc', name: 'Health + forecast', look: null, graph: 'fc', upper: 'health', needs: ['health'],
            group: 'more' },
        { id: 'radarfc', name: 'Radar + forecast', look: null, graph: 'fc', upper: 'radar', needs: ['radar'], group: 'more' }
    ];
    // Add a screen's rows, in order, each its heading over the cards of its group, side by side: a
    // watch with one graph its Forecast screen, the Pebble Time 2 the templates' screens by theme.
    // A row with nothing this watch can draw is left out.
    var GROUPS = [{ id: 'fc', name: 'Forecast' }, { id: 'everyday', name: 'Everyday' }, { id: 'rain', name: 'Rain and clouds' },
        { id: 'outdoors', name: 'Outdoors' }, { id: 'wind', name: 'Wind and pressure' }, { id: 'more', name: 'Health and radar' }];
    // Each graph's bar, the row over it.
    var BAR_OF = { fc: 'fcbar', health: 'healthbar', radar: 'radarbar' };
    // An upper graph's rows, on a screen of two graphs: three, the forecast filling the rest under
    // its bar on every watch (the fit test).
    var UPPER_SIZE = '3';
    // A screen's calendars, in the order Add a screen's cards show them: [name, rows] ('' for none,
    // DENSE for the compact one with the radar bar under it), each card naming its own
    // (CARD_CALENDAR) to a screen reader.
    var DENSE = 'dense';
    var CALENDARS = [['None', ''], ['Compact', '2'], ['Full', '3'], ['Dense', DENSE]];
    var CARD_CALENDAR = { '': 'No calendar', '2': 'Compact calendar', '3': 'Full calendar',
        dense: 'Compact calendar and radar bar' };
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
     * calendar's seat.
     * @param {Object} kind A KINDS entry.
     * @param {string} cal Its calendar's rows: '' | '2' | '3'.
     * @returns {Array<Object>} a new list
     */
    function screenOf(kind, cal) {
        return listOf(kind.graph, kind.upper ? '' : cal, kind.upper);
    }

    /**
     * The calendars a kind can have: every one, Dense only on a watch with the rain radar (an
     * unknown one too); none on a screen of two graphs (its upper graph has the calendar's seat).
     * @param {Object} kind A KINDS entry.
     * @param {?Object} [env] Platform env.
     * @returns {Array<Array<string>>} [name, rows] pairs
     */
    function calendars(kind, env) {
        if (kind.upper) { return []; }
        return !env || env.radar ? CALENDARS : CALENDARS.filter(function (c) { return c[1] !== DENSE; });
    }

    /**
     * Add a screen's cards on this watch, in its order: each kind it can draw (offered) once per
     * calendar it can have, None, Compact, Full and Dense in turn (the owner's, 2026-11-10: the
     * calendar picked on the card, the length on the screen it opens); a screen of two graphs once.
     * @param {?Object} env Platform env.
     * @returns {Array<{kind: Object, cal: string}>} cal: '' | '2' | '3' | DENSE
     */
    function cards(env) {
        var out = [];
        offered(env).forEach(function (kind) {
            var cals = calendars(kind, env);
            (cals.length ? cals : [['', '']]).forEach(function (c) { out.push({ kind: kind, cal: c[1] }); });
        });
        return out;
    }

    /**
     * A card's calendar as a screen reader hears it after its name: "No calendar", "Compact
     * calendar", "Full calendar", "Compact calendar and radar bar"; '' for a screen of two graphs,
     * which has none to pick.
     * @param {Object} kind A KINDS entry.
     * @param {string} cal Its calendar's rows: '' | '2' | '3' | DENSE.
     * @returns {string}
     */
    function calendarName(kind, cal) {
        return kind.upper ? '' : CARD_CALENDAR[cal] || '';
    }

    /**
     * Whether a kind's screen shows the rain radar, its graph or, Dense, its bar (adding it turns
     * the radar on).
     * @param {Object} kind A KINDS entry.
     * @param {string} [cal] Its calendar: DENSE shows the radar bar.
     * @returns {boolean}
     */
    function showsRadar(kind, cal) {
        return kind.graph === 'radar' || kind.upper === 'radar' || (!kind.upper && cal === DENSE);
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
        var look = lookOn(kind, env) ? looks().lookOf(kind.look) : null;
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
     * The template a kind's forecast graph is on this watch: its look on a watch with graph
     * styles (an unknown watch has them), '' where every screen keeps your graph.
     * @param {Object} kind A KINDS entry.
     * @param {?Object} env Platform env.
     * @returns {string} a look's id, or ''
     */
    function lookOn(kind, env) {
        return kind.look && (!env || env.graphStyles) ? kind.look : '';
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
        calendarName: calendarName,
        showsRadar: showsRadar,
        calOf: calOf,
        graphOf: graphOf,
        spanOf: spanOf,
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
