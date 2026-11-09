// src/pkjs/settings/graph-styles-page.js — ES5, WebView (+ Node for tests). The graphs on the
// settings page (Pebble Time 2; src/pkjs/graph-styles.js is the model, which calls a graph a graph
// style): the Your graphs card at the top of Graphs › Forecast (a plain list of the graphs, each
// its name, length and screens, the picked one ticked and renamed in place with an OK button; New
// graph; the screens the picked graph shows on; then, under the card, Delete with Undo, a schema
// item the engine draws like every Delete: the page's shared parts, config-ui/lib/ui.js), the
// swap that lets every row on that pane edit the graph picked there, the screen editor's graph
// picker's options, and the five-series limit the forecast pickers and that picker keep.
//
// TEMPLATES AND GRAPHS (the owner's pick, 2026-11-08). A template is one of the setup's forecast
// looks (wizard-forecast.js LOOKS: Classic, Clean, Stripes). The Your graphs card's New graph starts
// a graph from one, or as a copy of one of the graphs; the screen editor's picker lists the graphs
// and makes a copy of its screen's graph. A template never changes and is never one of the graphs:
// a graph made from one is "Graph <n>" (graph-styles.js defaultName) until it is renamed, so it
// never reads as its template. The templates sheet draws each one as the setup draws its looks
// (graphPicture).
//
// THE SWAP. Every row, hint, resolver and the pinned preview on Graphs › Forecast reads the flat
// keys, which hold the first graph. While the pane shows another graph k, its values sit in the
// flat keys and the first graph's wait in S[SWAP].held, so every row edits graph k unchanged. The
// invariant: off that pane the flat keys hold the first graph. The engine's render hook
// (PConf.hooks.onRender) swaps on every way to and from the pane; its normalize hook
// (PConf.hooks.onNormalize) hands Save and Revert the settings as stored, graph k written into
// graphStyles and the first graph back in the flat keys, so picking a graph never lights Save
// and Save stores the edits. The swap state lives in S itself: whatever puts S back (Revert, a
// dialog's ×) puts the swap back with the values it describes.
//
// THE LIMIT. The weather message carries five metric rows (graph-styles.js ROWS: one per line and
// a spare), so the graphs the screens show draw at most five series between them (graph-styles.js
// THE UNION), a series being a metric drawn as a line or as a stripe. A graph keeps its four lines:
// the spare row has no picker (the owner's call, 2026-11-08: "only use for multiple graphs"). A
// pick that would make a sixth is greyed out, and its words say why in the page's terms, "lines
// and stripes": a forecast line's metric or style on a shown graph (LIMIT), a screen of the Show
// on row (limitNote: the rule, what the screens use, what the graph adds) and in the screen
// editor a graph or template that would join the screens (limitDesc). A graph no screen shows
// is free. The Your graphs card's header counts what the screens use, "4/5", with which ones and
// what counts behind its '?' (metricsNote, the section's noteFrom).
//
// Dual-context: a CommonJS module in the tests; in the webview a concatenated <script> after
// graph-styles.js and screens.js (scripts/build-config-page.js APP_FILES) and ahead of
// forecast-hints.js, which reads its limit, and screens-page.js, which reads its labels. What
// loads after it (the setup's looks, the preview helpers, the screens' writer) it reads when asked.
/* global PConf */
var PConf = (typeof global !== 'undefined' && global.PConf) ? global.PConf
    : (typeof window !== 'undefined' && window.PConf) ? window.PConf
    : (typeof PConf !== 'undefined' && PConf) ? PConf
    : null;
(function () {
    'use strict';
    var node = typeof require !== 'undefined';
    var GS = node ? require('../graph-styles.js') : window.GraphStyles;
    var M = node ? require('../screens.js') : window.Screens;
    var spanHours = node ? require('../forecast-span-hours.js') : window.ForecastSpanHours;
    // The page's one escape helper (config-ui/lib/html.js, concatenated ahead of every app file).
    var esc = node ? require('../config-ui/lib/html.js').esc : PConf.html.esc;
    // The page's shared parts (config-ui/lib/ui.js): the card's list, New graph, the chips, the
    // pencil and the name field, the Undo and its timer.
    var kit = node ? require('../config-ui/lib/ui.js') : PConf.ui;

    // The swap state in S: {k, held}, the style whose values sit in the flat keys and the
    // first style's values of the governed keys. Never a schema key, so never saved.
    var SWAP = '_graphStyleSwap';
    // The page-only items (schema.js): the card's pick, New graph's picker and the screen
    // editor's picker.
    var PICK = 'graphStylePick';
    var NEW_FROM = 'graphStyleNewFrom';
    var SCREEN_PICK = 'screenGraphStyle';
    // The pane the card and the swap belong to.
    var TAB = 'graphs';
    var PANE = 'forecast';
    // A line picker's greyed-out option (limitOptions): one change adds one series at most.
    var LIMIT = 'That makes ' + (GS.ROWS + 1) + ' lines and stripes on your screens. The watch can show '
        + GS.ROWS + '.';
    // New graph's copies: 'copy<n>', a copy of graph n; the screen editor's New graph is NEW +
    // one of them ('new:copy1'). A picker's group header: GROUP (never a value anything stores).
    var COPY = 'copy';
    var NEW = 'new:';
    var GROUP = '__group';
    // A template's line under its name in the pickers, after its length (its picture shows the rest).
    var TEMPLATE_LINES = {
        classic: 'Rain chance and rain bars',
        clean: 'Clouds along the top, solid rain bars',
        stripes: 'Clouds and rain chance as stripes, solid rain bars from the top'
    };
    // Why the card has no New graph: every slot holds one.
    var FULL = 'You have ' + GS.MAX_STYLES + ' graphs, the most there can be. Delete one to make another.';

    // The page's live state (onReady), the card's Undo (a flash: kit.flash), the screen the
    // editor's picker is for, the defaults a template starts from (themedDefaults), kept per
    // theme, and whether the picked graph's name is a field right now (the card's pencil).
    var UI = { ctx: null, toast: { v: null, t: null }, screenSlot: 0, defaults: null, renaming: false };

    /**
     * @param {Object} o An object.
     * @param {string} k A key.
     * @returns {boolean} whether o holds k itself
     */
    function has(o, k) {
        return Object.prototype.hasOwnProperty.call(o, k);
    }

    /**
     * Whether this watch has graph styles (emery: platform.js env.graphStyles).
     * @param {?Object} env Platform env.
     * @returns {boolean}
     */
    function on(env) {
        return Boolean(env && env.graphStyles);
    }

    /**
     * The style whose values sit in the flat keys now: 0 off the swap.
     * @param {?Object} S Settings.
     * @returns {number}
     */
    function editing(S) {
        return (S && S[SWAP]) ? S[SWAP].k : 0;
    }

    /**
     * The settings as Save stores them (the engine's normalize hook): off the swap S itself;
     * on it a copy with the first style back in the flat keys and the style on screen in
     * graphStyles. The item keeps its stored string while the style's values are the ones it
     * stores (a governed key it holds no value of reads as the first style's), so a style
     * picked and left alone stores what it did.
     * @param {Object} st Settings.
     * @returns {Object}
     */
    function normalize(st) {
        var sw = st && st[SWAP];
        if (!sw) { return st; }
        var out = Object.assign({}, st);
        delete out[SWAP];
        var stored = GS.parse(st).styles[sw.k];
        var cur = {}, same = Boolean(stored);
        GS.GOVERNED.forEach(function (key) {
            if (has(st, key)) { cur[key] = st[key]; }
            if (has(sw.held, key)) { out[key] = sw.held[key]; } else { delete out[key]; }
            if (same && (stored && has(stored, key) ? stored[key] : sw.held[key]) !== st[key]) { same = false; }
        });
        if (!same) { out.graphStyles = GS.withStyle(st, sw.k, cur); }
        return out;
    }

    /**
     * Put S into its stored shape in place (normalize): the swap undone. S stays the same
     * object (the engine and every block share it).
     * @param {Object} S Settings.
     * @returns {void}
     */
    function settle(S) {
        var n = normalize(S);
        if (n === S) { return; }
        Object.keys(S).forEach(function (k) {
            if (!has(n, k)) { delete S[k]; }
        });
        Object.assign(S, n);
    }

    /**
     * Swap style k in: its values into the flat keys, the first style's held. A style that does
     * not exist swaps nothing. S must be settled.
     * @param {Object} S Settings.
     * @param {number} k A style index, 1 or 2.
     * @returns {void}
     */
    function swapIn(S, k) {
        var st = GS.parse(S).styles[k];
        if (!st) { return; }
        var held = {};
        GS.GOVERNED.forEach(function (key) {
            if (has(S, key)) { held[key] = S[key]; }
            if (has(st, key)) { S[key] = st[key]; }
        });
        S[SWAP] = { k: k, held: held };
    }

    /**
     * The style the card has picked, as an index: 0 for the first, and for a pick that names
     * no style.
     * @param {?Object} S Settings.
     * @returns {number}
     */
    function pickIndex(S) {
        var k = parseInt(S && S[PICK], 10) - 1;
        return (k > 0 && GS.exists(S, k)) ? k : 0;
    }

    /**
     * The engine's render hook: on Graphs › Forecast the picked style's values in the flat keys,
     * anywhere else the first style's (and no name field open).
     * @param {{S: Object, env: ?Object, tab: string, pane: ?string}} c The render's context.
     * @returns {void}
     */
    function onRender(c) {
        var S = c.S;
        if (!on(c.env) && !S[SWAP]) { return; }
        if (S[PICK] !== undefined && pickIndex(S) === 0 && S[PICK] !== '1') { S[PICK] = '1'; }
        var here = on(c.env) && c.tab === TAB && c.pane === PANE;
        var want = here ? pickIndex(S) : 0;
        if (!here) { UI.renaming = false; }
        if (want !== editing(S)) {
            settle(S);
            if (want) { swapIn(S, want); }
        }
    }

    /**
     * A style as the page shows it now, wherever its values sit (the swap): the settings as
     * style k draws the graph.
     * @param {Object} S Settings.
     * @param {number} k A style index.
     * @returns {Object}
     */
    function styleSettings(S, k) {
        return GS.settingsFor(normalize(S), k);
    }

    /**
     * The settings a screen's forecast graph draws (a screen picture: preview-watch.js
     * screenSvg): its view's graph style where the watch has styles and the style exists, as
     * the watch draws it (graph-styles.js wireCycle), else the first style. Off the swap's
     * own, so a picture drawn while Graphs › Forecast shows another style is still right.
     * @param {Object} S Settings.
     * @param {?Object} env Platform env.
     * @param {?Object} spec The compiled view.
     * @returns {Object}
     */
    function screenSettings(S, env, spec) {
        var k = (on(env) && spec && spec.graphStyle && GS.exists(S, spec.graphStyle)) ? spec.graphStyle : 0;
        return (k === 0 && !S[SWAP]) ? S : styleSettings(S, k);
    }

    /**
     * A style's Forecast length as its row names it ("24 h", "66 h": forecast-span-hours.js
     * spanOptions, the long span by the hours it shows).
     * @param {Object} Sk The style's settings.
     * @param {?Object} env Platform env.
     * @returns {string}
     */
    function lengthLabel(Sk, env) {
        var want = String(spanHours.storedHours(Sk)), opts = spanHours.spanOptions(Sk, env);
        for (var i = 0; i < opts.length; i++) {
            if (opts[i][1] === want) { return opts[i][0]; }
        }
        return '';
    }

    /**
     * A graph as its pickers list it: its name and length, "Graph 2 · 66 h".
     * @param {Object} S Settings.
     * @param {?Object} env Platform env.
     * @param {number} k A style index.
     * @returns {string}
     */
    function label(S, env, k) {
        var N = normalize(S), len = lengthLabel(GS.settingsFor(N, k), env);
        return GS.name(N, k) + (len ? ' · ' + len : '');
    }

    /**
     * The graph a screen's forecast graph draws: its own while it exists, else the first.
     * @param {Object} S Settings.
     * @param {?Object} fc The screen's forecast block (screens.js), or null.
     * @returns {number} A style index, -1 for no forecast graph.
     */
    function drawnBy(S, fc) {
        if (!fc) { return -1; }
        var k = (parseInt(fc.style, 10) || 1) - 1;
        return (k > 0 && GS.exists(S, k)) ? k : 0;
    }

    /**
     * The screens whose forecast graph draws a graph, as the Watchface tab lists them.
     * @param {Object} S Settings.
     * @param {?Object} env Platform env.
     * @param {number} k A style index.
     * @returns {string[]} the screens' names
     */
    function screensOn(S, env, k) {
        return M.placesWhere(S, env, function (list) { return drawnBy(S, list[M.idxOf(list, 'fc')]) === k; })
            .map(function (i) { return M.nameOf(S, i); });
    }

    /**
     * Names as a sentence lists them: "Default", "Default and Flick 1", "Default, Flick 1 and
     * Flick 2".
     * @param {string[]} names At least one.
     * @returns {string}
     */
    function andList(names) {
        return names.length > 1 ? names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1] : names[0];
    }

    /**
     * Where something shows, by the screens' names: "On Default and Flick 1", "On no screen".
     * @param {string[]} names The screens' names.
     * @returns {string}
     */
    function onScreens(names) {
        return names.length ? 'On ' + andList(names) : 'On no screen';
    }

    /**
     * Where a graph shows, for its option's second line: "On Default and Flick 1".
     * @param {Object} S Settings.
     * @param {?Object} env Platform env.
     * @param {number} k A style index.
     * @returns {string}
     */
    function whereText(S, env, k) {
        return onScreens(screensOn(S, env, k));
    }

    /**
     * A graph's card line: its length and where it shows, "66 h · Flick 1", "24 h · No screen".
     * @param {Object} S Settings.
     * @param {?Object} env Platform env.
     * @param {number} k A style index.
     * @returns {string}
     */
    function cardLine(S, env, k) {
        var len = lengthLabel(styleSettings(S, k), env), names = screensOn(S, env, k);
        return (len ? len + ' · ' : '') + (names.length ? names.join(', ') : 'No screen');
    }

    /**
     * The existing styles' indices, ascending.
     * @param {?Object} S Settings.
     * @returns {number[]}
     */
    function existing(S) {
        var out = [];
        for (var k = 0; k < GS.MAX_STYLES; k++) {
            if (GS.exists(S, k)) { out.push(k); }
        }
        return out;
    }

    /**
     * Would the shown styles draw more series than the weather message has rows for, with
     * style k's values `over` laid on it?
     * @param {Object} N Settings as stored (normalize).
     * @param {?Object} env Platform env.
     * @param {number[]} shown The styles the screens show (graph-styles.js stylesShown).
     * @param {number} k The style `over` changes (-1: none).
     * @param {?Object} over Governed values laid over style k, or null.
     * @returns {boolean}
     */
    function overflows(N, env, shown, k, over) {
        if (shown.length < 2) { return false; }
        return GS.rowsNeeded(shown.map(function (j) {
            var Sj = GS.settingsFor(N, j);
            return (j === k && over) ? Object.assign({}, Sj, over) : Sj;
        }), env) > GS.ROWS;
    }

    /**
     * A forecast picker's options with the limit applied (forecast-hints.js forecastMetric and
     * lineStyleOptions): a choice that would make the shown styles draw a sixth series is
     * disabled with LIMIT. The style edited is the one in the flat keys; a style no screen shows
     * is free, and the current pick is never greyed out. With a single style nothing can be.
     * @param {Array} options The picker's options.
     * @param {Object} S Settings.
     * @param {?Object} env Platform env.
     * @param {string} key The picker's key (a line's metric or style key).
     * @returns {Array} the options, a disabled one with meta {disabled, desc}
     */
    function limitOptions(options, S, env, key) {
        if (!on(env) || !S || GS.count(S) < 2) { return options; }
        var N = normalize(S), k = editing(S), shown = GS.stylesShown(N, env);
        if (shown.length < 2 || shown.indexOf(k) === -1) { return options; }
        return options.map(function (o) {
            if (o[1] === S[key]) { return o; }
            var over = {};
            over[key] = o[1];
            if (!overflows(N, env, shown, k, over)) { return o; }
            return [o[0], o[1], Object.assign({}, o[2] || {}, { disabled: true, desc: LIMIT })];
        });
    }

    /**
     * The settings as stored, as they would be with screen i drawing style k. With `values`, k is
     * a style still to be made with them (a template the screen editor's picker offers).
     * @param {Object} S Settings.
     * @param {number} i View slot.
     * @param {number} k A style index.
     * @param {?Object} [values] The governed values of the style to be made in slot k.
     * @returns {Object} a copy
     */
    function withScreen(S, i, k, values) {
        var N = Object.assign({}, normalize(S));
        if (values) { N.graphStyles = GS.withStyle(N, k, values); }
        N['viewStyle' + i] = String(k + 1);
        return N;
    }

    /**
     * Would screen i drawing style k make the shown styles draw a sixth series?
     * @param {Object} S Settings.
     * @param {?Object} env Platform env.
     * @param {number} i View slot.
     * @param {number} k A style index.
     * @param {?Object} [values] The governed values of the style to be made in slot k.
     * @returns {boolean}
     */
    function screenOverflows(S, env, i, k, values) {
        var N = withScreen(S, i, k, values);
        return overflows(N, env, GS.stylesShown(N, env), -1, null);
    }

    /**
     * A series as the limit's words name it: its metric as the Lines card's pickers name it
     * (forecast-hints.js, PConf.forecastLineOptions), "(stripe)" after one drawn as a stripe.
     * @param {{metric: string, stripe: boolean}} s A series (graph-styles.js seriesOf).
     * @returns {string}
     */
    function seriesName(s) {
        var table = (PConf && PConf.forecastLineOptions && PConf.forecastLineOptions.metrics) || [], name = s.metric;
        for (var i = 0; i < table.length; i++) {
            if (table[i][1] === s.metric) { name = table[i][0]; }
        }
        return name + (s.stripe ? ' (stripe)' : '');
    }

    /**
     * The series some styles draw between them, each once, in the order they first draw them.
     * @param {Object} N Settings as stored.
     * @param {?Object} env Platform env.
     * @param {number[]} ks Style indices.
     * @returns {Array<{metric: string, stripe: boolean}>}
     */
    function seriesUnion(N, env, ks) {
        var out = [];
        ks.forEach(function (k) {
            GS.seriesOf(GS.settingsFor(N, k), env).forEach(function (s) {
                if (s && !hasSeries(out, s)) { out.push(s); }
            });
        });
        return out;
    }

    /**
     * @param {Array<{metric: string, stripe: boolean}>} list Series.
     * @param {{metric: string, stripe: boolean}} s A series.
     * @returns {boolean} whether the list holds s
     */
    function hasSeries(list, s) {
        for (var i = 0; i < list.length; i++) {
            if (list[i].metric === s.metric && list[i].stripe === s.stripe) { return true; }
        }
        return false;
    }

    /**
     * What style k draws that the other styles do not, by name ("Precipitation % (stripe)").
     * @param {Object} N Settings as stored.
     * @param {?Object} env Platform env.
     * @param {number} k A style index.
     * @param {number[]} others The other styles.
     * @returns {string[]}
     */
    function extraNames(N, env, k, others) {
        var have = seriesUnion(N, env, others);
        return seriesUnion(N, env, [k]).filter(function (s) { return !hasSeries(have, s); }).map(seriesName);
    }

    /**
     * Why the screen editor's picker greys out a graph or a template: what it would add to the
     * graphs it would show beside, and how many lines and stripes the screens would then show.
     * @param {Object} N The settings as stored, with the screen on style k (withScreen).
     * @param {?Object} env Platform env.
     * @param {number} k The style picked (or to be made).
     * @returns {string}
     */
    function limitDesc(N, env, k) {
        var shown = GS.stylesShown(N, env);
        var extra = extraNames(N, env, k, shown.filter(function (j) { return j !== k; }));
        return (extra.length ? 'Also needs ' + andList(extra) + ': that makes ' : 'That makes ')
            + seriesUnion(N, env, shown).length + ' lines and stripes on your screens. The watch can show '
            + GS.ROWS + '.';
    }

    /**
     * The Your graphs card's note (section noteFrom 'graphMetricsNote'; the owner's pick,
     * 2026-11-09: only the number, what it means behind a '?'): how many of the watch's five
     * metric rows the graphs on the screens use between them, "4/5", and behind its '?' which
     * ones and what counts (THE LIMIT), with how to make room once all five are in use.
     * @param {Object} S Settings.
     * @param {?Object} env Platform env.
     * @returns {?{text: string, label: string, info: string}} null where the watch has no graph styles
     */
    function metricsNote(S, env) {
        if (!on(env) || !S) { return null; }
        var N = normalize(S), inUse = seriesUnion(N, env, GS.stylesShown(N, env)).map(seriesName);
        var used = inUse.length;
        return {
            text: used + '/' + GS.ROWS,
            label: used + ' of ' + GS.ROWS + ' metrics in use',
            info: esc((used ? 'In use: ' + inUse.join(', ') + '.' : 'No screen shows a forecast graph yet.')
                + (used >= GS.ROWS ? ' To make room, turn off a line in one of your graphs.' : ''))
                + '<p class="intro-more">' + esc('The graphs on your screens can show ' + GS.ROWS + ' metrics between'
                + ' them, up to ' + GS.TRENDS + ' in one graph. A metric in two graphs counts once, or twice when one'
                + ' draws it as a line and the other as a stripe. Temperature, the rain bars and a graph no screen'
                + ' shows don\'t count.') + '</p>'
        };
    }

    /**
     * The Show on row's note when the limit greys out a screen: the rule, the lines and stripes
     * the screens use now, what graph k needs on top, and how to make room.
     * @param {Object} S Settings.
     * @param {?Object} env Platform env.
     * @param {number} k The picked graph (a graph no screen shows: one that does never adds).
     * @returns {string}
     */
    function limitNote(S, env, k) {
        var N = normalize(S), shown = GS.stylesShown(N, env);
        var inUse = seriesUnion(N, env, shown).map(seriesName), extra = extraNames(N, env, k, shown);
        return 'The watch can show ' + GS.ROWS + ' lines and stripes across all your screens.'
            + (inUse.length ? ' In use: ' + inUse.join(', ') + '.' : '')
            + (extra.length ? ' ' + GS.name(S, k) + ' also needs ' + andList(extra) + '.' : '')
            + ' To make room, turn off a line in one of your graphs.';
    }

    /**
     * Get the screen editor's graph picker ready for screen i (screens-page.js opens it next):
     * its value the screen's graph, its limit worked out for that screen.
     * @param {Object} S Settings.
     * @param {number} i View slot.
     * @param {string} style The screen's style ('1' | '2' | '3').
     * @returns {void}
     */
    function beginScreenPick(S, i, style) {
        UI.screenSlot = i;
        S[SCREEN_PICK] = style;
    }

    /**
     * The graphs as the pickers list them (options resolver 'graphStyleOptions'): each named
     * with its length, where it shows under it. With args.screen (the screen editor's picker,
     * for the screen beginScreenPick named; the owner's, 2026-11-09: your graphs only) the
     * screen's own graph says where else it shows, a graph that would make the screens draw a
     * sixth series is disabled with LIMIT, and while a slot is free New graph follows: a copy of
     * the screen's graph, for the screen (pickForScreen). Templates stay on the Graphs tab.
     * @param {Object} S Settings.
     * @param {?Object} env Platform env.
     * @param {{screen: boolean}} [args] The picker.
     * @returns {Array} [label, value, {desc, disabled}] per graph
     */
    function styleOptions(S, env, args) {
        var a = args || {}, cur = S ? S[a.screen ? SCREEN_PICK : PICK] : null;
        var out = existing(S || {}).map(function (k) {
            var v = String(k + 1), meta = { desc: whereText(S, env, k) };
            if (a.screen && v === cur) { meta = { desc: alsoText(S, env, k) }; }
            if (a.screen && v !== cur && screenOverflows(S, env, UI.screenSlot, k)) {
                meta = { desc: limitDesc(withScreen(S, UI.screenSlot, k), env, k), disabled: true };
            }
            return [label(S, env, k), v, meta];
        });
        var mine = parseInt(cur, 10) - 1;
        if (!a.screen || !S || GS.freeSlot(normalize(S)) < 0 || !GS.exists(S, mine)) { return out; }
        out.push(['New graph', NEW + COPY + (mine + 1), { add: true,
            desc: 'A copy of ' + GS.name(normalize(S), mine) + ', for this screen' }]);
        return out;
    }

    /**
     * Where else the screen editor's screen's own graph shows, for its option's line: "Also on
     * Work", "Only on this screen".
     * @param {Object} S Settings.
     * @param {?Object} env Platform env.
     * @param {number} k The screen's graph.
     * @returns {string}
     */
    function alsoText(S, env, k) {
        var others = M.placesWhere(S, env, function (list) { return drawnBy(S, list[M.idxOf(list, 'fc')]) === k; })
            .filter(function (i) { return i !== UI.screenSlot; }).map(function (i) { return M.nameOf(S, i); });
        return others.length ? 'Also on ' + andList(others) : 'Only on this screen';
    }

    /**
     * The card's hint under the graphs: what a tap does, or with one graph what New graph is for.
     * @param {Object} S Settings.
     * @returns {string}
     */
    function cardHint(S) {
        return GS.count(S) < 2 ? 'New graph gives a screen a graph of its own.' : 'Tap a graph to change it below.';
    }

    /**
     * The tail on every row of a key the graphs share (hint resolver 'graphStyleShared',
     * schema.js hintTailFrom): said while more than one graph exists.
     * @param {Object} S Settings.
     * @param {?Object} env Platform env.
     * @returns {string}
     */
    function sharedHint(S, env) {
        return (on(env) && GS.count(S) > 1) ? 'Every graph shares this.' : '';
    }

    /**
     * The card's pick as the page opens (display resolver 'graphStyleOnOpen', initFrom): the
     * graph of the first screen with a forecast graph, else the first.
     * @param {Object} S Settings.
     * @param {?Object} env Platform env.
     * @returns {string} '1' | '2' | '3'
     */
    function pickOnOpen(S, env) {
        if (!on(env)) { return '1'; }
        var lists = M.screensOf(S, env);
        for (var i = 0; i < lists.length; i++) {
            var k = drawnBy(S, lists[i][M.idxOf(lists[i], 'fc')]);
            if (k >= 0) { return String(k + 1); }
        }
        return '1';
    }

    // ── The modules loaded after this one, read when asked ──────────────────

    /**
     * The setup's forecast looks, the templates (settings/wizard-forecast.js).
     * @returns {Object}
     */
    function forecastLooks() {
        return node ? require('./wizard-forecast.js') : window.WizardForecast;
    }

    /**
     * The preview helpers (settings/preview-svg.js).
     * @returns {Object}
     */
    function svgLib() {
        return node ? require('./preview-svg.js') : window.PreviewSvg;
    }

    /**
     * The screens' writer (settings/screens-page.js).
     * @returns {Object}
     */
    function screensPage() {
        return node ? require('./screens-page.js') : window.ScreensPage;
    }

    // ── Templates and pictures ──────────────────────────────────────────────

    /**
     * The graph's defaults as the theme starts them (engine themedDefaults, which reads the
     * theme only), worked out once per theme; S itself under Node without the page.
     * @param {Object} S Settings.
     * @param {?Object} env Platform env.
     * @returns {Object}
     */
    function themedDefaults(S, env) {
        if (!(UI.ctx && PConf && PConf.engine && PConf.engine.themedDefaults)) { return S; }
        if (!UI.defaults || UI.defaults.theme !== S.theme) {
            UI.defaults = { theme: S.theme, values: PConf.engine.themedDefaults(UI.ctx.schema, S, env) };
        }
        return UI.defaults.values;
    }

    /**
     * The values a graph made from a template starts with: the graph's defaults, the
     * template's own values and its length over them.
     * @param {Object} S Settings as stored (settled or normalize).
     * @param {?Object} env Platform env.
     * @param {string} id A template's id (wizard-forecast.js LOOKS).
     * @returns {?Object} governed key -> value, or null for no such template
     */
    function templateValues(S, env, id) {
        var defaults = themedDefaults(S, env);
        var rec = forecastLooks().looks(S, env, defaults, null).filter(function (r) { return r.id === id; })[0];
        return rec ? Object.assign(GS.valuesOf(defaults, 0), rec.values, { forecastHours: rec.span }) : null;
    }

    /**
     * The graph a screen preset brings (screen-presets.js, Pebble Time 2): the first graph of
     * yours that reads as its template, look and length alike (wizard-forecast.js same,
     * spanOf), else a new one from the template in the first free slot (values: what
     * createGraph would give it). Null when neither is there: no graph reads as it and every
     * slot is taken.
     * @param {Object} S Settings.
     * @param {?Object} env Platform env.
     * @param {string} id The template's id (wizard-forecast.js LOOKS).
     * @returns {?{k: number, values: ?Object}} values null for a graph of yours
     */
    function presetGraph(S, env, id) {
        var N = normalize(S), looks = forecastLooks();
        var rec = looks.looks(N, env, themedDefaults(N, env), null).filter(function (r) { return r.id === id; })[0];
        if (!rec) { return null; }
        var mine = existing(N).filter(function (k) {
            var Sk = GS.settingsFor(N, k);
            return looks.same(Sk, rec.values, env) && looks.spanOf(Sk) === String(rec.span);
        });
        if (mine.length) { return { k: mine[0], values: null }; }
        var k = GS.freeSlot(N);
        return k < 0 ? null : { k: k, values: templateValues(N, env, id) };
    }

    /**
     * A template's line in the pickers: its length, then what it draws ("66 h · Clouds along the
     * top, solid rain bars").
     * @param {Object} S Settings.
     * @param {?Object} env Platform env.
     * @param {string} id A template's id.
     * @returns {string}
     */
    function templateLine(S, env, id) {
        var N = normalize(S), len = lengthLabel(Object.assign({}, N, templateValues(N, env, id)), env);
        return (len ? len + ' · ' : '') + (TEMPLATE_LINES[id] || forecastLooks().describe(id, env));
    }

    /**
     * A graph as the pickers and its card draw it: the setup's look preview (wizard-forecast.js
     * previewSvg) of its settings, its ids tagged (preview-svg.js tagIds) so the pictures on one
     * page never share a pattern.
     * @param {Object} Sk The settings the graph draws.
     * @param {?Object} env Platform env.
     * @param {?Object} userData Page userData (the palette).
     * @param {string} tag Unique on the page.
     * @returns {string} SVG markup
     */
    function graphPicture(Sk, env, userData, tag) {
        return svgLib().tagIds(forecastLooks().previewSvg(Sk, env, userData || {}), tag);
    }

    /**
     * The settings a picker's option draws: a graph ('1'..'3'), a copy of one ('copy<n>'), or a
     * template (its id, or 'new:<id>').
     * @param {Object} S Settings.
     * @param {?Object} env Platform env.
     * @param {string} v The option's value.
     * @returns {?Object} null for a value that names none (a group header)
     */
    function optionSettings(S, env, v) {
        var N = normalize(S), k = /^[0-9]$/.test(v) ? parseInt(v, 10) - 1
            : v.indexOf(COPY) === 0 ? parseInt(v.slice(COPY.length), 10) - 1 : -1;
        if (k >= 0) { return GS.exists(N, k) ? GS.settingsFor(N, k) : null; }
        var values = templateValues(N, env, v.indexOf(NEW) === 0 ? v.slice(NEW.length) : v);
        return values ? Object.assign({}, N, values) : null;
    }

    /**
     * A picker option's picture (picture resolver 'graphStylePicture', the pickers' pictureFrom).
     * @param {Object} S Settings.
     * @param {?Object} env Platform env.
     * @param {{messageKey: string, value: string}} args The option.
     * @param {?Object} userData Page userData.
     * @returns {string} SVG markup, '' for none
     */
    function optionPicture(S, env, args, userData) {
        var v = String(args.value || ''), Sk = optionSettings(S, env, v);
        return Sk ? graphPicture(Sk, env, userData, 'gs-' + v.replace(/[^A-Za-z0-9]/g, '-')) : '';
    }

    // ── New graph, Rename, Delete ───────────────────────────────────────────

    /**
     * New graph's options (options resolver 'graphStyleStarts'): the templates, then a copy of
     * each graph.
     * @param {Object} S Settings.
     * @param {?Object} env Platform env.
     * @returns {Array} [label, value, {desc}]
     */
    function startOptions(S, env) {
        var N = normalize(S);
        var out = forecastLooks().LOOKS.map(function (look) {
            return [look.label, look.id, { desc: templateLine(S, env, look.id) }];
        });
        out.push(['Or copy one of your graphs', GROUP, { groupHeader: true, disabled: true }]);
        existing(N).forEach(function (k) {
            var len = lengthLabel(GS.settingsFor(N, k), env);
            out.push(['Copy of ' + GS.name(N, k), COPY + (k + 1), { desc: (len ? len + ' · ' : '') + 'Its lines and colors' }]);
        });
        return out;
    }

    /**
     * The name a new graph in slot k stores: '' for its default name ("Graph <k+1>"), else, when
     * another graph was renamed to that, the first "Graph <n>" no other graph has.
     * @param {Object} S Settings.
     * @param {number} k The new graph's slot.
     * @returns {string}
     */
    function newName(S, k) {
        var others = existing(S).filter(function (j) { return j !== k; }).map(function (j) { return GS.name(S, j); });
        if (others.indexOf(GS.defaultName(k)) === -1) { return ''; }
        for (var n = 0; others.indexOf(GS.defaultName(n)) !== -1; n++) { /* the first free number */ }
        return GS.defaultName(n);
    }

    /**
     * Make a graph from a template or as a copy of a graph, in the first free slot, called
     * "Graph <n>" (newName). A template starts from the graph's defaults as the theme starts
     * them, with its own values and length over them; a copy from the graph's values. Mutates S
     * (settled first).
     * @param {Object} S Settings.
     * @param {string} from A template's id, or 'copy<n>'.
     * @param {?Object} env Platform env.
     * @returns {number} The new graph's index, -1 for none made (no free slot, no such source).
     */
    function createGraph(S, from, env) {
        settle(S);
        var k = GS.freeSlot(S), src = String(from || '');
        if (k < 0 || !src) { return -1; }
        var values = null;
        if (src.indexOf(COPY) === 0) {
            var j = parseInt(src.slice(COPY.length), 10) - 1;
            if (GS.exists(S, j)) { values = GS.valuesOf(S, j); }
        } else {
            values = templateValues(S, env, src);
        }
        if (!values) { return -1; }
        S.graphStyles = GS.withStyle(S, k, values);
        S.graphStyles = GS.withName(S, k, newName(S, k));
        return k;
    }

    /**
     * New graph's pick (onChange 'graphStyleCreate'): the graph made (createGraph) and picked, so
     * the pane shows it; the picker cleared.
     * @param {Object} S Settings (S[NEW_FROM] picked).
     * @param {*} oldValue The picker's value before.
     * @param {string} from A template's id, or 'copy<n>'.
     * @param {?Object} env Platform env.
     * @returns {void}
     */
    function createStyle(S, oldValue, from, env) {
        S[NEW_FROM] = '';
        var k = createGraph(S, from, env);
        if (k > 0) { S[PICK] = String(k + 1); }
    }

    /**
     * A name typed for the picked graph (the card's name field): its name, '' for the default
     * one. Written into the item as stored, so the swap keeps it.
     * @param {Object} S Settings.
     * @param {*} oldValue The name before.
     * @param {string} value The name typed.
     * @returns {void}
     */
    function renameStyle(S, oldValue, value) {
        var k = pickIndex(S), name = M.cleanName(value);
        S.graphStyles = GS.withName(S, k, name === GS.defaultName(k) ? '' : name);
    }

    /**
     * The card's name field, when it shows.
     * @returns {?Element}
     */
    function nameField() {
        return (typeof document !== 'undefined' && document.querySelector) ? document.querySelector('[data-gl-rename-in]') : null;
    }

    /**
     * OK (or Enter) in the card's name field: the name stored (renameStyle), the field gone.
     * @param {Object} S Settings.
     * @returns {void}
     */
    function commitName(S) {
        var el = nameField();
        if (el) { renameStyle(S, null, el.value); }
        UI.renaming = false;
    }

    /**
     * Delete the picked graph (the card's Delete): the screens on it draw the first graph, the
     * card picks the first, and an Undo shows for five seconds. Never the first graph.
     * @param {Object} S Settings.
     * @returns {void}
     */
    function deletePicked(S) {
        var k = pickIndex(S);
        if (k === 0) { return; }
        settle(S);
        var o = GS.parse(S);
        var undo = { k: k, name: o.names[k], values: o.styles[k], label: GS.name(S, k), views: GS.deleteStyle(S, k) };
        S[PICK] = '1';
        UI.renaming = false;
        kit.flash(UI.toast, undo, 5000, function () { if (UI.ctx) { UI.ctx.render(); } });
    }

    /**
     * Undo a delete: the graph back in its slot, with its name, on the screens that drew it,
     * and picked. Only that graph's slot and those screens move.
     * @param {Object} S Settings.
     * @returns {void}
     */
    function undoDelete(S) {
        var u = UI.toast.v;
        if (!u) { return; }
        kit.unflash(UI.toast);
        settle(S);
        if (GS.exists(S, u.k)) { return; }
        S.graphStyles = GS.withStyle(S, u.k, u.values);
        S.graphStyles = GS.withName(S, u.k, u.name);
        u.views.forEach(function (i) { S['viewStyle' + i] = String(u.k + 1); });
        S[PICK] = String(u.k + 1);
    }

    // ── The screens a graph shows on ────────────────────────────────────────

    /**
     * Put graph k on screen i's forecast graph (the Show on row, the screen editor's picker),
     * through the screens' writer (screens-page.js writeScreen), with the swap undone first
     * (the next render swaps the pane's graph back in). A screen without a forecast graph is
     * left as it is.
     * @param {Object} S Settings.
     * @param {?Object} env Platform env.
     * @param {number} i View slot.
     * @param {number} k A style index.
     * @returns {void}
     */
    function setScreenGraph(S, env, i, k) {
        settle(S);
        var list = M.screensOf(S, env)[i] || [], j = M.idxOf(list, 'fc');
        if (j < 0) { return; }
        var next = M.copy(list);
        if (k > 0) { next[j].style = String(k + 1); } else { delete next[j].style; }
        screensPage().writeScreen(S, i, next, env);
    }

    /**
     * A tap on a Show on chip (action 'graphOnScreen'): the picked graph onto screen i, or off
     * it again (the screen then draws the first graph). The first graph's own chips do nothing:
     * a screen draws it unless it has another graph. A chip the limit greys out does nothing.
     * @param {Object} S Settings.
     * @param {?Object} env Platform env.
     * @param {number} i View slot.
     * @returns {void}
     */
    function toggleScreen(S, env, i) {
        var k = pickIndex(S), list = M.screensOf(S, env)[i] || [];
        var drawn = drawnBy(S, list[M.idxOf(list, 'fc')]);
        if (drawn < 0) { return; }
        if (drawn === k) {
            if (k > 0) { setScreenGraph(S, env, i, 0); }
            return;
        }
        if (!screenOverflows(S, env, i, k)) { setScreenGraph(S, env, i, k); }
    }

    /**
     * The screen editor's pick (screens-page.js screenStylePicked): screen i draws the graph
     * picked, or New graph's copy of its graph ('new:copy<n>'), which the Graphs tab then picks
     * too. With no free slot New graph changes nothing.
     * @param {Object} S Settings.
     * @param {?Object} env Platform env.
     * @param {number} i View slot.
     * @param {string} value '1' | '2' | '3' | 'new:copy<n>' (createGraph's source after NEW)
     * @param {*} oldValue The picker's value before.
     * @returns {void}
     */
    function pickForScreen(S, env, i, value, oldValue) {
        var v = String(value || ''), k;
        if (v.indexOf(NEW) === 0) {
            k = createGraph(S, v.slice(NEW.length), env);
            if (k < 0) { S[SCREEN_PICK] = oldValue; return; }
            S[PICK] = String(k + 1);
        } else {
            k = parseInt(v, 10) - 1;
            if (!(k >= 0 && GS.exists(S, k))) { return; }
        }
        S[SCREEN_PICK] = String(k + 1);
        setScreenGraph(S, env, i, k);
    }

    // ── The Your graphs card ────────────────────────────────────────────────

    // The card's own look; its list, New graph, the chips, the pencil, the name field and the Undo
    // are the page's shared parts (kit: config-ui/lib/ui.js, their look in shell.html).
    var CSS = '.gl-lead{padding:12px 16px 10px}'
        + '.gl-row{display:flex;align-items:center}'
        + '.gl-row.on{background:rgba(250,74,53,.12)}'
        + '.gl-pick{flex:1 1 auto;min-width:0;display:flex;align-items:center;gap:10px;margin:0;padding:12px 16px;border:none;'
        + 'background:none;color:var(--lbl);text-align:left;font:inherit;cursor:pointer;-webkit-appearance:none;appearance:none}'
        + '.gl-txt{flex:1 1 auto;min-width:0;display:grid;gap:2px}'
        + '.gl-pick .ui-ic{flex:none;color:var(--link);stroke-width:2.6}'
        + '.gl-row .ui-pen{margin:0 10px 0 0}'
        + '.gl-row.rn{gap:8px;padding:8px 12px 8px 16px}'
        + '.gc-show{display:grid;gap:8px;padding:12px 16px 14px}';

    /**
     * Put the card's styles on the page once.
     * @returns {void}
     */
    function ensureStyle() {
        if (typeof document === 'undefined' || !document.getElementById || document.getElementById('gs-style')) { return; }
        var el = document.createElement('style');
        el.id = 'gs-style';
        el.textContent = CSS;
        document.head.appendChild(el);
    }

    /**
     * The Show on row for graph k (two graphs or more): a chip per screen, ticked where the
     * screen draws k, greyed out where it has no forecast graph or where k would make the
     * screens draw a sixth series; a line under it says why.
     * @param {Object} S Settings.
     * @param {?Object} env Platform env.
     * @param {number} k The picked graph.
     * @returns {string} HTML
     */
    function showOnHtml(S, env, k) {
        var lists = M.screensOf(S, env), none = [], full = false, kept = false;
        var chips = lists.map(function (list, i) {
            var name = M.nameOf(S, i), drawn = drawnBy(S, list[M.idxOf(list, 'fc')]);
            if (drawn < 0) { none.push(name); return kit.chip(name, { disabled: true }); }
            if (drawn === k) {
                // The first graph's tick stays: a screen draws it unless it has another graph.
                if (k === 0) { kept = true; }
                return kit.chip(name, k === 0 ? { 'aria-pressed': 'true', 'aria-disabled': 'true' }
                    : { 'aria-pressed': 'true', 'data-action': 'graphOnScreen', 'data-action-arg': i }, { icon: 'check', on: true });
            }
            if (screenOverflows(S, env, i, k)) { full = true; return kit.chip(name, { disabled: true }); }
            return kit.chip(name, { 'aria-pressed': 'false', 'data-action': 'graphOnScreen', 'data-action-arg': i });
        }).join('');
        var notes = [];
        if (none.length === lists.length) {
            notes.push('No screen has a forecast graph yet. Add one on the Watchface tab.');
        } else if (none.length) {
            notes.push(andList(none) + (none.length > 1 ? ' have' : ' has') + ' no forecast graph.');
        }
        if (full) { notes.push(limitNote(S, env, k)); }
        if (kept) { notes.push('A screen shows ' + GS.name(S, 0) + ' unless you give it another graph.'); }
        return '<div class="ui-row gc-show"><span class="ui-cap" id="gc-show-cap">Show on</span>'
            + '<div class="ui-chips" role="group" aria-labelledby="gc-show-cap">' + chips + '</div>'
            + (notes.length ? '<div class="ui-d">' + esc(notes.join(' ')) + '</div>' : '') + '</div>';
    }

    /**
     * The Your graphs card (block 'graphStyleCards'; the owner's pick, 2026-11-09: a plain list
     * like the Your status bars card and the screen editor's pickers), in the page's shared parts (kit):
     * what a tap does, then a row per graph, its name over its length and the screens that show
     * it, the picked one tinted and ticked (a tap picks another: the settings below then change
     * it) with a pencil that makes its name a field with OK; New graph while a slot is free, with
     * how many graphs there are (its sheet starts one from a template or as a copy), else why
     * there is none; the Undo after a delete; the Show on row with two graphs or more. Delete
     * is the section's own item, under the card (schema.js; deleteLabel, deletable).
     * @param {Object} S Settings.
     * @param {?Object} env Platform env.
     * @returns {string} HTML ('' where the watch has no graph styles)
     */
    function cardsBlock(S, env) {
        if (!on(env) || !S) { return ''; }
        ensureStyle();
        var k = pickIndex(S), ks = existing(S);
        var rows = ks.map(function (j) {
            var picked = j === k, name = GS.name(S, j);
            if (picked && UI.renaming) {
                return '<div class="ui-row gl-row on rn" role="listitem">' + kit.renameField({
                    at: { 'data-gl-rename-in': true }, okAt: { 'data-action': 'renameGraphOk' }, label: 'Graph name',
                    maxlength: M.NAME_MAX, placeholder: GS.defaultName(j), value: name }) + '</div>';
            }
            return '<div class="ui-row gl-row' + (picked ? ' on' : '') + '" role="listitem"><button type="button" class="gl-pick"'
                + ' aria-pressed="' + picked + '" data-action="pickGraph" data-action-arg="' + (j + 1) + '">'
                + '<span class="gl-txt"><span class="ui-n">' + esc(name) + '</span><span class="ui-d">' + esc(cardLine(S, env, j))
                + '</span></span>' + (picked ? kit.icon('check') : '') + '</button>'
                + (picked ? kit.penButton(name, { 'data-action': 'renameGraph' }) : '') + '</div>';
        }).join('');
        return '<div class="ui-list"><div class="gl-lead">' + esc(cardHint(S)) + '</div>'
            + '<div role="list" aria-label="Your graphs">' + rows + '</div>'
            + (GS.freeSlot(normalize(S)) >= 0
                ? kit.newRow('New graph', ks.length + ' of ' + GS.MAX_STYLES + ' graphs', { 'data-select': NEW_FROM })
                : '<div class="ui-row ui-foot">' + esc(FULL) + '</div>')
            + (UI.toast.v ? kit.undoToast(UI.toast.v.label + ' deleted.', { 'data-action': 'undoDeleteGraphStyle' }) : '')
            + (ks.length > 1 ? showOnHtml(S, env, k) : '')
            + '</div>';
    }

    /**
     * Whether the card's Delete shows (when resolver 'graphDeletable'): on a watch with graph
     * styles, while the picked graph is not the first, which every screen falls back to.
     * @param {Object} S Settings (the show-when context: the settings by key).
     * @param {?Object} env Platform env.
     * @returns {boolean}
     */
    function deletable(S, env) {
        return on(env) && pickIndex(S) > 0;
    }

    /**
     * What the card's Delete says (hint resolver 'graphDeleteLabel'): the picked graph by name.
     * @param {Object} S Settings.
     * @returns {string} "Delete Graph 2"
     */
    function deleteLabel(S) {
        return 'Delete ' + GS.name(S, pickIndex(S));
    }

    // ── Registration (the webview; a no-op under Node without the page) ─────

    if (PConf) {
        if (PConf.hooks && PConf.hooks.onRender) { PConf.hooks.onRender(onRender); }
        if (PConf.hooks && PConf.hooks.onNormalize) { PConf.hooks.onNormalize(normalize); }
        if (PConf.hooks && PConf.hooks.onReady) {
            PConf.hooks.onReady(function (ctx) {
                UI.ctx = ctx;
                // The card's name field: Enter stores the name as OK does, Escape keeps the old one;
                // leaving it for anything but OK stores it too, without a repaint, so the tap that
                // took the focus lands (its own repaint shows the name again).
                if (typeof document === 'undefined' || !document.addEventListener) { return; }
                document.addEventListener('keydown', function (e) {
                    if (!UI.renaming || !e.target || !e.target.closest || !e.target.closest('[data-gl-rename-in]')) { return; }
                    if (e.key !== 'Enter' && e.key !== 'Escape') { return; }
                    e.preventDefault();
                    if (e.key === 'Enter') { commitName(ctx.S); } else { UI.renaming = false; }
                    ctx.render();
                    var pen = document.querySelector('[data-action="renameGraph"]');
                    if (pen) { pen.focus(); }
                });
                document.addEventListener('focusout', function (e) {
                    var el = e.target && e.target.closest ? e.target.closest('[data-gl-rename-in]') : null, to = e.relatedTarget;
                    if (!el || !UI.renaming || (to && to.closest && to.closest('[data-action="renameGraphOk"]'))) { return; }
                    renameStyle(ctx.S, null, el.value);
                    UI.renaming = false;
                });
            });
        }
        if (PConf.blocks) { PConf.blocks.register('graphStyleCards', cardsBlock); }
        if (PConf.optionsResolvers) {
            PConf.optionsResolvers.register('graphStyleOptions', styleOptions);
            PConf.optionsResolvers.register('graphStyleStarts', startOptions);
        }
        if (PConf.hintResolvers) {
            PConf.hintResolvers.register('graphStyleShared', sharedHint);
            PConf.hintResolvers.register('graphDeleteLabel', deleteLabel);
        }
        if (PConf.whenResolvers) { PConf.whenResolvers.register('graphDeletable', deletable); }
        if (PConf.pictureResolvers) { PConf.pictureResolvers.register('graphStylePicture', optionPicture); }
        if (PConf.displayResolvers) {
            PConf.displayResolvers.register('graphStyleOnOpen', pickOnOpen);
            PConf.displayResolvers.register('graphMetricsNote', metricsNote);
        }
        if (PConf.onChange) { PConf.onChange.register('graphStyleCreate', createStyle); }
        PConf.actions = PConf.actions || {};
        PConf.actions.pickGraph = function (arg, S) {
            S[PICK] = String(arg);
            UI.renaming = false;
            return true;
        };
        // The picked graph's pencil: its name becomes a field, focused with the name selected
        // once the page has repainted; OK stores it.
        PConf.actions.renameGraph = function () {
            UI.renaming = true;
            setTimeout(function () {
                var el = nameField();
                if (el) { el.focus(); if (el.select) { el.select(); } }
            }, 0);
            return true;
        };
        PConf.actions.renameGraphOk = function (arg, S) { commitName(S); return true; };
        PConf.actions.graphOnScreen = function (arg, S, env) { toggleScreen(S, env, Number(arg)); return true; };
        PConf.actions.deleteGraphStyle = function (arg, S) { deletePicked(S); return true; };
        PConf.actions.undoDeleteGraphStyle = function (arg, S) { undoDelete(S); return true; };
    }

    var api = {
        SWAP: SWAP,
        PICK: PICK,
        NEW_FROM: NEW_FROM,
        SCREEN_PICK: SCREEN_PICK,
        LIMIT: LIMIT,
        NEW: NEW,
        editing: editing,
        normalize: normalize,
        // normalize by the name other modules call it by: a call spelt `.normalize(` reads as
        // String.prototype.normalize to the ES5 check (test/config-es5.test.js).
        asStored: normalize,
        settle: settle,
        swapIn: swapIn,
        pickIndex: pickIndex,
        onRender: onRender,
        styleSettings: styleSettings,
        screenSettings: screenSettings,
        label: label,
        drawnBy: drawnBy,
        screensOn: screensOn,
        andList: andList,
        whereText: whereText,
        onScreens: onScreens,
        cardLine: cardLine,
        limitOptions: limitOptions,
        screenOverflows: screenOverflows,
        limitDesc: limitDesc,
        limitNote: limitNote,
        metricsNote: metricsNote,
        beginScreenPick: beginScreenPick,
        styleOptions: styleOptions,
        cardHint: cardHint,
        sharedHint: sharedHint,
        pickOnOpen: pickOnOpen,
        templateValues: templateValues,
        presetGraph: presetGraph,
        templateLine: templateLine,
        optionPicture: optionPicture,
        startOptions: startOptions,
        createGraph: createGraph,
        createStyle: createStyle,
        renameStyle: renameStyle,
        commitName: commitName,
        deletePicked: deletePicked,
        undoDelete: undoDelete,
        setScreenGraph: setScreenGraph,
        toggleScreen: toggleScreen,
        pickForScreen: pickForScreen,
        cardsBlock: cardsBlock,
        deletable: deletable,
        deleteLabel: deleteLabel,
        _test: { UI: UI }
    };
    if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
    if (typeof window !== 'undefined') { window.GraphStylesPage = api; }
})();
