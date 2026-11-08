// src/pkjs/settings/graph-styles-page.js — ES5, WebView (+ Node for tests). The graphs on the
// settings page (Pebble Time 2; src/pkjs/graph-styles.js is the model, which calls a graph a graph
// style): the Your graphs card at the top of Graphs › Forecast (a picture of each graph, New graph,
// the screens the picked graph shows on, Rename, Delete with Undo), the swap that lets every row on
// that pane edit the graph picked there, the screen editor's graph picker's options, and the
// four-series limit the forecast pickers and that picker keep.
//
// TEMPLATES AND GRAPHS (the owner's pick, 2026-11-08). A template is one of the setup's forecast
// looks (wizard-forecast.js LOOKS: Classic, Weathergraph, Stripes). New graph starts a graph from
// one, or as a copy of one of the graphs, and the screen editor's picker can start one for its
// screen. A template never changes and is never one of the graphs: a graph made from one is
// "Graph <n>" (graph-styles.js defaultName) until it is renamed, so it never reads as its template.
// Every picker draws each graph and template as the setup draws its looks (graphPicture).
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
// THE LIMIT. The weather message carries four metric rows, so the graphs the screens show draw at
// most four series between them (graph-styles.js THE UNION), a series being a metric drawn as a
// line or as a stripe. A pick that would make a fifth is greyed out, and its words say why in the
// page's terms, "lines and stripes": a forecast line's metric or style on a shown graph (LIMIT),
// a screen of the Show on row (limitNote: the rule, what the screens use, what the graph adds)
// and in the screen editor a graph or template that would join the screens (limitDesc). A graph
// no screen shows is free.
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

    // The swap state in S: {k, held}, the style whose values sit in the flat keys and the
    // first style's values of the governed keys. Never a schema key, so never saved.
    var SWAP = '_graphStyleSwap';
    // The page-only items (schema.js): the card's pick, Rename's field, New graph's picker and
    // the screen editor's picker.
    var PICK = 'graphStylePick';
    var NAME = 'graphStyleName';
    var NEW_FROM = 'graphStyleNewFrom';
    var SCREEN_PICK = 'screenGraphStyle';
    // The pane the card and the swap belong to.
    var TAB = 'graphs';
    var PANE = 'forecast';
    // A line picker's greyed-out option (limitOptions): one change adds one series at most.
    var LIMIT = 'That makes 5 lines and stripes on your screens; the watch can show 4.';
    // New graph's copies: 'copy<n>', a copy of graph n. The screen editor's templates:
    // 'new:<template id>'. A picker's group header: GROUP (never a value anything stores).
    var COPY = 'copy';
    var NEW = 'new:';
    var GROUP = '__group';
    var NAME_MAX = 24;
    // A template's line under its name in the pickers, after its length (its picture shows the rest).
    var TEMPLATE_LINES = {
        classic: 'Rain chance and rain bars',
        weathergraph: 'Clouds along the top, solid rain bars',
        stripes: 'Clouds and rain chance as stripes'
    };
    var I_PLUS = '<svg class="gc-ic" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 5v14M5 12h14"/></svg>';
    var I_CHECK = '<svg class="gc-ic" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

    // The page's live state (onReady), the card's Undo toast, the screen the editor's picker is
    // for, and the defaults a template starts from (themedDefaults), kept per theme.
    var UI = { ctx: null, toast: null, timer: null, screenSlot: 0, defaults: null };

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
     * anywhere else the first style's; Rename's field holds the picked style's name.
     * @param {{S: Object, env: ?Object, tab: string, pane: ?string}} c The render's context.
     * @returns {void}
     */
    function onRender(c) {
        var S = c.S;
        if (!on(c.env) && !S[SWAP]) { return; }
        if (S[PICK] !== undefined && pickIndex(S) === 0 && S[PICK] !== '1') { S[PICK] = '1'; }
        var want = (on(c.env) && c.tab === TAB && c.pane === PANE) ? pickIndex(S) : 0;
        if (want !== editing(S)) {
            settle(S);
            if (want) { swapIn(S, want); }
        }
        S[NAME] = GS.name(S, pickIndex(S));
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
        var out = [];
        M.screensOf(S, env).forEach(function (list, i) {
            if (drawnBy(S, list[M.idxOf(list, 'fc')]) === k) { out.push(M.NAMES[i]); }
        });
        return out;
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
     * Where a graph shows, for its option's second line: "On Default and Flick 1".
     * @param {Object} S Settings.
     * @param {?Object} env Platform env.
     * @param {number} k A style index.
     * @returns {string}
     */
    function whereText(S, env, k) {
        var names = screensOn(S, env, k);
        return names.length ? 'On ' + andList(names) : 'On no screen';
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
        }), env) > GS.TRENDS;
    }

    /**
     * A forecast picker's options with the limit applied (forecast-hints.js forecastMetric and
     * lineStyleOptions): a choice that would make the shown styles draw a fifth series is
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
     * Would screen i drawing style k make the shown styles draw a fifth series?
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
            + seriesUnion(N, env, shown).length + ' lines and stripes on your screens; the watch can show 4.';
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
        return 'The watch can show 4 lines and stripes across all your screens.'
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
     * for the screen beginScreenPick named) a graph that would make the screens draw a fifth
     * series is disabled with LIMIT, and while a slot is free the templates follow, a new graph
     * from one put on the screen (pickForScreen).
     * @param {Object} S Settings.
     * @param {?Object} env Platform env.
     * @param {{screen: boolean}} [args] The picker.
     * @returns {Array} [label, value, {desc, disabled}] per graph
     */
    function styleOptions(S, env, args) {
        var a = args || {}, cur = S ? S[a.screen ? SCREEN_PICK : PICK] : null;
        var out = existing(S || {}).map(function (k) {
            var v = String(k + 1), meta = { desc: whereText(S, env, k) };
            if (a.screen && v !== cur && screenOverflows(S, env, UI.screenSlot, k)) {
                meta = { desc: limitDesc(withScreen(S, UI.screenSlot, k), env, k), disabled: true };
            }
            return [label(S, env, k), v, meta];
        });
        var slot = S ? GS.freeSlot(normalize(S)) : -1;
        if (!a.screen || slot < 0) { return out; }
        out.push(['New graph from a template', GROUP, { groupHeader: true, disabled: true }]);
        forecastLooks().LOOKS.forEach(function (look) {
            var values = templateValues(normalize(S), env, look.id);
            var full = screenOverflows(S, env, UI.screenSlot, slot, values);
            out.push([look.label, NEW + look.id, full
                ? { desc: limitDesc(withScreen(S, UI.screenSlot, slot, values), env, slot), disabled: true }
                : { desc: templateLine(S, env, look.id) }]);
        });
        return out;
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
     * A name no other graph has: `base`, else "base 2", "base 3".
     * @param {Object} S Settings.
     * @param {string} base The name wanted.
     * @returns {string}
     */
    function freeName(S, base) {
        var taken = existing(S).map(function (k) { return GS.name(S, k); });
        var n = String(base).slice(0, NAME_MAX), i = 2;
        while (taken.indexOf(n) !== -1) { n = String(base).slice(0, NAME_MAX - 3) + ' ' + i; i++; }
        return n;
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
     * Rename's field committed (onChange 'graphStyleRenamed'): the picked graph's name, '' for
     * the default one. Written into the item as stored, so the swap keeps it.
     * @param {Object} S Settings.
     * @param {*} oldValue The name before.
     * @param {string} value The name typed.
     * @returns {void}
     */
    function renameStyle(S, oldValue, value) {
        var k = pickIndex(S), name = String(value || '').replace(/^\s+|\s+$/g, '').slice(0, NAME_MAX);
        S.graphStyles = GS.withName(S, k, name === GS.defaultName(k) ? '' : name);
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
        showToast(undo);
    }

    /**
     * Undo a delete: the graph back in its slot, with its name, on the screens that drew it,
     * and picked. Only that graph's slot and those screens move.
     * @param {Object} S Settings.
     * @returns {void}
     */
    function undoDelete(S) {
        var u = UI.toast;
        if (!u) { return; }
        clearToast();
        settle(S);
        if (GS.exists(S, u.k)) { return; }
        S.graphStyles = GS.withStyle(S, u.k, u.values);
        S.graphStyles = GS.withName(S, u.k, u.name);
        u.views.forEach(function (i) { S['viewStyle' + i] = String(u.k + 1); });
        S[PICK] = String(u.k + 1);
    }

    /**
     * Show the Undo for five seconds.
     * @param {Object} undo What Undo puts back.
     * @returns {void}
     */
    function showToast(undo) {
        clearToast();
        UI.toast = undo;
        UI.timer = setTimeout(function () {
            UI.toast = null;
            UI.timer = null;
            if (UI.ctx) { UI.ctx.render(); }
        }, 5000);
    }

    /**
     * Drop the Undo.
     * @returns {void}
     */
    function clearToast() {
        if (UI.timer) { clearTimeout(UI.timer); }
        UI.toast = null;
        UI.timer = null;
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
     * picked, or a new one made from the template picked ('new:<id>'), which the Graphs tab
     * then picks too. A template with no free slot changes nothing.
     * @param {Object} S Settings.
     * @param {?Object} env Platform env.
     * @param {number} i View slot.
     * @param {string} value '1' | '2' | '3' | 'new:<template id>'
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

    var CSS = '.gc-row{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}'
        + '.gc{display:grid;gap:3px;align-content:start;min-width:0;margin:0;padding:6px 6px 8px;border:none;border-radius:12px;'
        + 'background:var(--bg);box-shadow:0 0 0 1px var(--card-line);color:var(--lbl);text-align:left;font:inherit;'
        + 'cursor:pointer;-webkit-appearance:none;appearance:none}'
        + '.gc.on{box-shadow:0 0 0 2px #FA4A35}'
        + '.gc-pic{display:block;border-radius:7px;overflow:hidden;line-height:0;margin-bottom:3px}'
        + '.gc-pic svg{display:block;width:100%;height:auto}'
        + '.gc-n{font:700 12px/1.25 Inter,system-ui,sans-serif;color:var(--lbl);overflow-wrap:anywhere}'
        + '.gc.on .gc-n{color:var(--link)}'
        + '.gc-d{font:500 10.5px/1.3 Inter,system-ui,sans-serif;color:var(--hint)}'
        + '.gc.add{place-content:center;justify-items:center;gap:5px;background:transparent;box-shadow:none;'
        + 'border:1.5px dashed var(--line-strong);color:var(--link);font:700 11.5px/1.2 Inter,system-ui,sans-serif;text-align:center}'
        // The icons only: a graph's picture inherits nothing from here (an inherited stroke
        // would outline every shape in it).
        + '.gc-ic{fill:none;stroke:currentColor;stroke-width:2.3;stroke-linecap:round;stroke-linejoin:round}'
        + '.gc.add .gc-ic{width:18px;height:18px}'
        + '.gc-hint{margin-top:10px}'
        + '.gc-show{display:grid;gap:8px;margin-top:12px;padding-top:12px;border-top:1px solid var(--row-line)}'
        + '.gc-cap{font-size:10.5px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--ttl)}'
        + '.gc-chips{display:flex;flex-wrap:wrap;gap:6px}'
        + '.gc-chip{display:inline-flex;align-items:center;gap:5px;margin:0;padding:7px 11px;border:none;border-radius:999px;'
        + 'background:var(--ctl);box-shadow:inset 0 0 0 1px var(--ctl-line);color:var(--lbl);'
        + 'font:600 12.5px/1.2 Inter,system-ui,sans-serif;cursor:pointer;-webkit-appearance:none;appearance:none}'
        + '.gc-chip.on{background:rgba(250,74,53,.14);box-shadow:inset 0 0 0 1.5px #FA4A35;color:var(--link)}'
        + '.gc-chip[disabled]{opacity:.42;cursor:default}'
        + '.gc-chip[aria-disabled="true"]{cursor:default}'
        + '.gc-chip .gc-ic{width:13px;height:13px}'
        + '.gs-acts{display:flex;flex-wrap:wrap;gap:6px 18px;align-items:center;margin-top:12px}'
        + '.gs-act{border:none;background:none;padding:2px 0;color:var(--link);font:700 13px Inter,system-ui,sans-serif;'
        + 'cursor:pointer}'
        + '.gs-toast{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:10px;'
        + 'background:var(--ctl);border-radius:10px;padding:9px 12px;font-size:12.5px;color:var(--lbl)}'
        + '.gs-undo{flex:none;border:none;background:none;padding:2px 4px;color:var(--link);'
        + 'font:800 12.5px Inter,system-ui,sans-serif;cursor:pointer}';

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
     * screens draw a fifth series; a line under it says why.
     * @param {Object} S Settings.
     * @param {?Object} env Platform env.
     * @param {number} k The picked graph.
     * @returns {string} HTML
     */
    function showOnHtml(S, env, k) {
        var lists = M.screensOf(S, env), none = [], full = false, kept = false;
        var chips = lists.map(function (list, i) {
            var name = esc(M.NAMES[i]), drawn = drawnBy(S, list[M.idxOf(list, 'fc')]);
            if (drawn < 0) { none.push(M.NAMES[i]); return '<button type="button" class="gc-chip" disabled>' + name + '</button>'; }
            if (drawn === k) {
                // The first graph's tick stays: a screen draws it unless it has another graph.
                if (k === 0) { kept = true; }
                return '<button type="button" class="gc-chip on" aria-pressed="true"'
                    + (k === 0 ? ' aria-disabled="true"' : ' data-action="graphOnScreen" data-action-arg="' + i + '"')
                    + '>' + I_CHECK + name + '</button>';
            }
            if (screenOverflows(S, env, i, k)) { full = true; return '<button type="button" class="gc-chip" disabled>' + name + '</button>'; }
            return '<button type="button" class="gc-chip" aria-pressed="false" data-action="graphOnScreen" data-action-arg="'
                + i + '">' + name + '</button>';
        }).join('');
        var notes = [];
        if (none.length === lists.length) {
            notes.push('No screen has a forecast graph yet. Add one on the Watchface tab.');
        } else if (none.length) {
            notes.push(andList(none) + (none.length > 1 ? ' have' : ' has') + ' no forecast graph.');
        }
        if (full) { notes.push(limitNote(S, env, k)); }
        if (kept) { notes.push('A screen shows ' + GS.name(S, 0) + ' unless you give it another graph.'); }
        return '<div class="gc-show"><span class="gc-cap" id="gc-show-cap">Show on</span>'
            + '<div class="gc-chips" role="group" aria-labelledby="gc-show-cap">' + chips + '</div>'
            + (notes.length ? '<div>' + esc(notes.join(' ')) + '</div>' : '') + '</div>';
    }

    /**
     * The Your graphs card (block 'graphStyleCards'): a picture card per graph, the picked one
     * ringed (a tap picks another: the settings below then change it), New graph while a slot
     * is free, the hint, the Show on row with two graphs or more, Rename, Delete on a graph but
     * the first, and the Undo after a delete.
     * @param {Object} S Settings.
     * @param {?Object} env Platform env.
     * @param {?Object} userData Page userData (the palette).
     * @returns {string} HTML ('' where the watch has no graph styles)
     */
    function cardsBlock(S, env, userData) {
        if (!on(env) || !S) { return ''; }
        ensureStyle();
        var k = pickIndex(S), ks = existing(S);
        var h = '<div class="gc-row" role="group" aria-label="Your graphs">' + ks.map(function (j) {
            var picked = j === k, name = esc(GS.name(S, j));
            return '<button type="button" class="gc' + (picked ? ' on' : '') + '" aria-pressed="' + picked
                + '" data-action="pickGraph" data-action-arg="' + (j + 1) + '">'
                + '<span class="gc-pic" aria-hidden="true">' + graphPicture(styleSettings(S, j), env, userData, 'gc' + j) + '</span>'
                + '<span class="gc-n">' + name + '</span><span class="gc-d">' + esc(cardLine(S, env, j)) + '</span></button>';
        }).join('')
            + (GS.freeSlot(normalize(S)) >= 0 ? '<button type="button" class="gc add" data-select="' + NEW_FROM + '">'
                + I_PLUS + '<span>New graph</span></button>' : '')
            + '</div>'
            + '<div class="gc-hint">' + esc(cardHint(S)) + '</div>';
        if (ks.length > 1) { h += showOnHtml(S, env, k); }
        var name = esc(GS.name(S, k));
        h += '<div class="gs-acts">'
            + '<button type="button" class="gs-act" data-edit-sheet="graphStyleRename" aria-label="Rename ' + name + '">Rename</button>'
            + (k > 0 ? '<button type="button" class="gs-act" data-action="deleteGraphStyle" aria-label="Delete ' + name + '">Delete</button>' : '')
            + '</div>';
        var t = UI.toast;
        if (t) {
            h += '<div class="gs-toast" role="status"><span>' + esc(t.label) + ' deleted.</span>'
                + '<button type="button" class="gs-undo" data-action="undoDeleteGraphStyle">Undo</button></div>';
        }
        return h;
    }

    // ── Registration (the webview; a no-op under Node without the page) ─────

    if (PConf) {
        if (PConf.hooks && PConf.hooks.onRender) { PConf.hooks.onRender(onRender); }
        if (PConf.hooks && PConf.hooks.onNormalize) { PConf.hooks.onNormalize(normalize); }
        if (PConf.hooks && PConf.hooks.onReady) { PConf.hooks.onReady(function (ctx) { UI.ctx = ctx; }); }
        if (PConf.blocks) { PConf.blocks.register('graphStyleCards', cardsBlock); }
        if (PConf.optionsResolvers) {
            PConf.optionsResolvers.register('graphStyleOptions', styleOptions);
            PConf.optionsResolvers.register('graphStyleStarts', startOptions);
        }
        if (PConf.hintResolvers) { PConf.hintResolvers.register('graphStyleShared', sharedHint); }
        if (PConf.pictureResolvers) { PConf.pictureResolvers.register('graphStylePicture', optionPicture); }
        if (PConf.displayResolvers) { PConf.displayResolvers.register('graphStyleOnOpen', pickOnOpen); }
        if (PConf.onChange) {
            PConf.onChange.register('graphStyleCreate', createStyle);
            PConf.onChange.register('graphStyleRenamed', renameStyle);
        }
        PConf.actions = PConf.actions || {};
        PConf.actions.pickGraph = function (arg, S) { S[PICK] = String(arg); return true; };
        PConf.actions.graphOnScreen = function (arg, S, env) { toggleScreen(S, env, Number(arg)); return true; };
        PConf.actions.deleteGraphStyle = function (arg, S) { deletePicked(S); return true; };
        PConf.actions.undoDeleteGraphStyle = function (arg, S) { undoDelete(S); return true; };
    }

    var api = {
        SWAP: SWAP,
        PICK: PICK,
        NAME: NAME,
        NEW_FROM: NEW_FROM,
        SCREEN_PICK: SCREEN_PICK,
        LIMIT: LIMIT,
        NEW: NEW,
        editing: editing,
        normalize: normalize,
        settle: settle,
        swapIn: swapIn,
        pickIndex: pickIndex,
        onRender: onRender,
        styleSettings: styleSettings,
        screenSettings: screenSettings,
        label: label,
        drawnBy: drawnBy,
        screensOn: screensOn,
        whereText: whereText,
        cardLine: cardLine,
        limitOptions: limitOptions,
        screenOverflows: screenOverflows,
        limitDesc: limitDesc,
        limitNote: limitNote,
        beginScreenPick: beginScreenPick,
        styleOptions: styleOptions,
        cardHint: cardHint,
        sharedHint: sharedHint,
        pickOnOpen: pickOnOpen,
        templateValues: templateValues,
        templateLine: templateLine,
        optionPicture: optionPicture,
        startOptions: startOptions,
        createGraph: createGraph,
        createStyle: createStyle,
        renameStyle: renameStyle,
        deletePicked: deletePicked,
        undoDelete: undoDelete,
        setScreenGraph: setScreenGraph,
        toggleScreen: toggleScreen,
        pickForScreen: pickForScreen,
        cardsBlock: cardsBlock,
        _test: { UI: UI }
    };
    if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
    if (typeof window !== 'undefined') { window.GraphStylesPage = api; }
})();
