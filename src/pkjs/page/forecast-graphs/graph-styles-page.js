// src/pkjs/page/forecast-graphs/graph-styles-page.js — ES5, WebView (+ Node for tests). The graphs on the
// settings page (src/pkjs/forecast-graphs/domain/graph-styles.js is the model, which calls a graph a graph style): the
// Your graphs card on Graphs › Forecast (the owner's ask, 2026-11-09: a list of the graphs, each
// with its picture, name, length and screens, the metrics it draws and the room left; a tap opens
// the graph's dialog, schema.js graphDialog, with its settings; New graph and the Undo of a Delete
// under the rows; on a watch without graph styles the one graph), the dialog's title (the graph's
// name, renamed there) and its Show on card with Delete under it (the page's shared parts,
// config-ui/lib/ui.js), the swap that lets every row of the dialog edit the graph it shows, and
// the five-series limit the forecast pickers, the Show on card and the screen editor's graph
// chips keep.
//
// TEMPLATES AND GRAPHS (the owner's pick, 2026-11-08). A template is one of the forecast looks
// (wizard-forecast.js LOOKS: Classic, Clean and Stripes, which setup offers too, then Simple, Rain,
// Sky, Clouds, Outdoor, Sun, Comfort, Wind, Storm, Pressure and Meteogram). The Your graphs card's
// New graph starts
// a graph from one, or as a copy of one of the graphs; the screen editor adds one of the graphs
// by its chip. A template never changes and is never one of the graphs:
// a graph made from one is "Graph <n>" (graph-styles.js defaultName) until it is renamed, so it
// never reads as its template. The templates sheet draws each one as the setup draws its looks
// (graphPicture).
//
// THE SWAP. Every row, hint, resolver and the pinned preview of a graph's dialog reads the flat
// keys, which hold the first graph. While the dialog of another graph k is open (the pick k,
// which openGraph writes as it opens it), nested Lines and Graph colors dialogs too, its values
// sit in the flat keys and the first graph's wait in S[SWAP].held, so every row edits graph k
// unchanged. The invariant: with no graph dialog open the flat keys hold the first graph. The
// engine's render hook (PConf.hooks.onRender, told the dialog on screen) swaps on every way into
// and out of the dialog; its normalize hook (PConf.hooks.onNormalize) hands Save and Revert the
// settings as stored, graph k written into graphStyles and the first graph back in the flat
// keys, so opening a graph never lights Save and Save stores the edits. The swap state lives in
// S itself: whatever puts S back (Revert, a dialog's ×) puts the swap back with the values it
// describes. A dialog whose graph is gone (its Delete) shows nothing, so the engine closes it
// (graphShown, schema.js graphDialog's gate).
//
// THE LIMIT. The weather message carries five metric rows (graph-styles.js ROWS: one per line and
// a spare), so the graphs the screens show draw at most five series between them (graph-styles.js
// THE UNION), a series being a metric drawn as a line or as a stripe, with all its values or
// alerts only (Visible values: each graph's own, the owner's, 2026-11-10). A graph keeps its four lines:
// the spare row has no picker (the owner's call, 2026-11-08: "only use for multiple graphs"). A
// pick that would make a sixth is greyed out, and its words say why in the page's terms,
// "metrics" (a metric drawn two ways counting twice): a forecast line's metric or
// style on a shown graph (LIMIT), a screen of the Show on card (limitNote: the rule, what the
// screens use, what the graph adds), and a graph that would join the screens: Add a screen's
// preset and, when tapped, the screen editor's graph chip (limitDesc). A graph no screen shows is
// free. The Your graphs card's header counts what the screens use, "4/5 metrics active", with
// which ones and what counts behind its '?' (metricsNote, the section's noteFrom), and each row
// says how many more metrics its graph has room for (roomText).
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
    var GS = node ? require('../../forecast-graphs/domain/graph-styles.js') : window.GraphStyles;
    var M = node ? require('../../layout/domain/screens.js') : window.Screens;
    var spanHours = node ? require('../../weather/domain/forecast-span-hours.js') : window.ForecastSpanHours;
    // The metrics' names (forecast-metrics.js): the limit's words and the rows name a metric by them.
    var metrics = node ? require('./forecast-metrics.js') : window.ForecastMetrics;
    // A line's Visible values (line-alert.js): a template's graph starts with your first graph's.
    var lineAlert = node ? require('../../alerts/domain/line-alert.js') : window.LineAlert;
    // A graph's lines (line-style.js FORECAST_LINES): the one a pick over the limit turns off.
    var lineStyle = node ? require('../../forecast-graphs/domain/line-style.js') : window.LineStyle;
    // The page's one escape helper and its sentence lists (config-ui/lib/html.js, concatenated
    // ahead of every app file).
    var html = node ? require('../../config-ui/lib/html.js') : PConf.html;
    var esc = html.esc;
    var andList = html.andList;
    // The page's shared parts (config-ui/lib/ui.js): the card's list, its red arrows, New graph,
    // the chips, the Undo and its timer.
    var kit = node ? require('../../config-ui/lib/ui.js') : PConf.ui;

    // The swap state in S: {k, held}, the style whose values sit in the flat keys and the
    // first style's values of the governed keys. Never a schema key, so never saved.
    var SWAP = '_graphStyleSwap';
    // The page-only items (schema.js): the card's pick and New graph's picker.
    var PICK = 'graphStylePick';
    var NEW_FROM = 'graphStyleNewFrom';
    // A graph's dialog (schema.js graphDialog).
    var SHEET = 'graph';
    // A line picker's option over the limit (limitOptions): one change adds one series at most.
    // It is taken, and the line's dialog then asks which line to turn off (limitBlock).
    var LIMIT = 'That makes ' + (GS.ROWS + 1) + ' metrics on your screens. The watch can show ' + GS.ROWS
        + ', so you then turn off a line.';
    // New graph's copies: 'copy<n>', a copy of graph n. A picker's group header: GROUP (never a
    // value anything stores).
    var COPY = 'copy';
    var GROUP = '__group';
    // Why the card has no New graph: every slot holds one.
    var FULL = 'You have ' + GS.MAX_STYLES + ' graphs, the most there can be. Delete one to make another.';

    // The page's live state (onReady), the card's Undo (a flash: kit.flash) and the defaults a
    // template starts from (themedDefaults), kept per theme.
    // covered: a dialog covers the page this render (onRender); list: the Your graphs card as it
    // was last drawn (listBlock).
    // last: the pick over the limit the line dialog's Undo puts back (limitPicked): its key, the
    // value it had, the graph it was made on and the Main metric's fill before it; null for none.
    var UI = { ctx: null, toast: { v: null, t: null }, defaults: null, covered: false, list: '', last: null };
    // A one-graph watch's graph, by the name the page gives the row (screens.js KINDS).
    var SOLO = M.blockName({ k: 'fc' });

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
     * The style the pick names (openGraph writes the row's number, 1 for the first): 0 for the
     * first and for no pick.
     * @param {?Object} S Settings.
     * @returns {number}
     */
    function picked(S) {
        var k = parseInt(S && S[PICK], 10) - 1;
        return k > 0 ? k : 0;
    }

    /**
     * The style the dialog shows, as an index: the picked one, the first where it names none
     * (graphShown closes the dialog then).
     * @param {?Object} S Settings.
     * @returns {number}
     */
    function pickIndex(S) {
        var k = picked(S);
        return GS.exists(S, k) ? k : 0;
    }

    /**
     * The engine's render hook: while a graph's dialog is open the picked style's values in the
     * flat keys, anywhere else the first style's.
     * @param {{S: Object, env: ?Object, dialog: ?string}} c The render's context (dialog: the
     *   root of the dialogs on screen).
     * @returns {void}
     */
    function onRender(c) {
        var S = c.S;
        UI.covered = Boolean(c.dialog);
        if (!on(c.env) && !S[SWAP]) { return; }
        var want = (on(c.env) && c.dialog === SHEET) ? pickIndex(S) : 0;
        if (want !== editing(S)) {
            settle(S);
            if (want) { swapIn(S, want); }
        }
    }

    /**
     * Whether the dialog's graph exists (when resolver 'graphShown', the dialog's gate): always on
     * a watch with one graph; a dialog whose graph is gone (its Delete) shows nothing and closes.
     * @param {Object} S Settings (the show-when context: the settings by key).
     * @param {?Object} env Platform env.
     * @returns {boolean}
     */
    function graphShown(S, env) {
        return !on(env) || GS.exists(S, picked(S));
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
     * the watch draws it (graph-styles.js wireCycle), else the first style. Off the stored
     * settings, so a picture drawn while a graph's dialog holds another style is still right.
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
     * The graph a screen's forecast graph draws: its own while it exists, else the first.
     * @param {Object} S Settings.
     * @param {?Object} fc The screen's forecast block (screens.js), or null.
     * @returns {number} A style index, -1 for no forecast graph.
     */
    function drawnBy(S, fc) {
        if (!fc) { return -1; }
        var k = GS.styleOf(fc.style);
        return (k > 0 && GS.exists(S, k)) ? k : 0;
    }

    /**
     * The screens each graph shows on, by their names as the Watchface tab lists them, read off
     * the screens once.
     * @param {Object} S Settings.
     * @param {?Object} env Platform env.
     * @returns {Object<number, string[]>} by style index; a graph no screen shows has none
     */
    function screenNames(S, env) {
        var out = {};
        M.screensOf(S, env).forEach(function (list, i) {
            var k = drawnBy(S, list[M.idxOf(list, 'fc')]);
            if (k >= 0) { (out[k] = out[k] || []).push(M.nameOf(S, i)); }
        });
        return out;
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
     * A graph's row line: its length and the screens it shows on (screenNames), "66 h · Flick 1",
     * "24 h · No screen".
     * @param {Object} Sk The graph's settings.
     * @param {string[]} names The screens it shows on.
     * @returns {string}
     */
    function cardLine(Sk, names) {
        var len = spanHours.spanLabel(Sk);
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
     * lineStyleOptions): a choice that would make the shown styles draw a sixth series says so
     * (LIMIT), and stays a choice (the owner's ask, 2026-11-10: take it, then pick which line to
     * turn off: limitBlock). The style edited is the one in the flat keys; a style no screen
     * shows is free, and the current pick never says it. With a single style shown nothing can.
     * @param {Array} options The picker's options.
     * @param {Object} S Settings.
     * @param {?Object} env Platform env.
     * @param {string} key The picker's key (a line's metric or style key).
     * @returns {Array} the options, one over the limit with meta {desc}
     */
    function limitOptions(options, S, env, key) {
        if (!on(env) || !S) { return options; }
        var N = normalize(S), k = editing(S), shown = GS.stylesShown(N, env);
        if (shown.length < 2 || shown.indexOf(k) === -1) { return options; }
        return options.map(function (o) {
            if (o[1] === S[key]) { return o; }
            var over = {};
            over[key] = o[1];
            if (!overflows(N, env, shown, k, over)) { return o; }
            return [o[0], o[1], Object.assign({}, o[2] || {}, { desc: LIMIT })];
        });
    }

    /**
     * How many metrics the screens show while that is more than the watch can and the graph the
     * dialog edits is one of the graphs they show (THE LIMIT); 0 otherwise.
     * @param {Object} S Settings.
     * @param {?Object} env Platform env.
     * @returns {number}
     */
    function overBy(S, env) {
        if (!on(env) || !S) { return 0; }
        var N = normalize(S), shown = GS.stylesShown(N, env);
        if (shown.indexOf(editing(S)) === -1) { return 0; }
        var n = seriesUnion(N, env, shown).length;
        return n > GS.ROWS ? n : 0;
    }

    /**
     * The lines that, turned off, make room for one metric: each line of a graph the screens
     * show that draws a series no other line draws, the Main metric's aside (it has no Off), and
     * a template's graph's (it is none of yours until you edit it: TEMPLATE GRAPHS).
     * @param {Object} S Settings.
     * @param {?Object} env Platform env.
     * @returns {Array<{k: number, key: string, s: Object}>} k: the graph; key: the line's metric key
     */
    function offLines(S, env) {
        var N = normalize(S), all = [];
        GS.stylesShown(N, env).forEach(function (k) {
            GS.seriesOf(GS.settingsFor(N, k), env).forEach(function (s, j) {
                if (s) { all.push({ k: k, key: lineStyle.FORECAST_LINES[j].key, s: s, j: j }); }
            });
        });
        return all.filter(function (c) {
            return c.j > 0 && !GS.isTemplate(c.k)
                && all.filter(function (o) { return GS.sameSeries(o.s, c.s); }).length === 1;
        }).map(function (c) { return { k: c.k, key: c.key, s: c.s }; });
    }

    /**
     * A pick on a line's dialog (onChange 'graphLimitPicked' on a line's metric and style and a
     * metric's Visible values; schema.js lineSheet runs it first): while it makes the screens
     * show more metrics than the watch can, what the row held is kept for the dialog's Undo
     * (limitBlock); else nothing is.
     * @param {Object} S Settings (the pick in them).
     * @param {*} oldValue What the row held.
     * @param {*} value The pick.
     * @param {?Object} env Platform env.
     * @param {string} key The row's key.
     * @returns {void}
     */
    function limitPicked(S, oldValue, value, env, key) {
        UI.last = overBy(S, env) ? { key: key, old: oldValue, k: editing(S), fill: S.secondaryLineFill } : null;
    }

    /**
     * Turn line `key` of graph k off (a tap on one of limitBlock's chips), wherever its values sit
     * while the dialog shows a graph (THE SWAP): the flat keys for the graph shown, the held
     * values for the first one, else the graph's own stored values. Mutates S.
     * @param {Object} S Settings.
     * @param {number} k The graph.
     * @param {string} key The line's metric key.
     * @returns {void}
     */
    function turnOff(S, k, key) {
        if (k === editing(S)) {
            S[key] = 'off';
        } else if (k === 0) {
            S[SWAP].held[key] = 'off';
        } else {
            var values = GS.valuesOf(normalize(S), k);
            values[key] = 'off';
            S.graphStyles = GS.withStyle(S, k, values);
        }
    }

    /**
     * The top of a line's dialog while its graph makes the screens show more metrics than the
     * watch can (block 'graphLimit', the owner's ask, 2026-11-10: a pick over the limit is
     * taken, then you choose which line of which graph goes): how many there are, a chip per
     * line that makes room (offLines: "Long: Wind gusts"), and Undo, which puts the pick back.
     * '' while they fit.
     * @param {Object} S Settings.
     * @param {?Object} env Platform env.
     * @returns {string} HTML
     */
    function limitBlock(S, env) {
        var n = overBy(S, env);
        if (!n) { UI.last = null; return ''; }
        var N = normalize(S), lines = offLines(S, env);
        var chips = lines.map(function (c) {
            return kit.chip(graphName(N, env, c.k) + ': ' + seriesName(c.s),
                { 'data-action': 'graphLimitOff', 'data-action-arg': c.k + ':' + c.key }, { icon: 'x' });
        });
        if (UI.last && UI.last.k === editing(S)) {
            chips.push(kit.chip('Undo', { 'data-action': 'graphLimitUndo' }));
        }
        var text = 'That makes ' + n + ' metrics on your screens, and the watch can show ' + GS.ROWS + '. '
            + (lines.length ? 'Turn off one of these lines:' : 'Change a line in one of your graphs to make room.');
        return '<div class="gl-over" role="group" aria-label="Make room">' + kit.note(text)
            + (chips.length ? '<div class="ui-chips">' + chips.join('') + '</div>' : '') + '</div>';
    }

    /**
     * A tap on a chip of limitBlock: its line turned off ("<graph>:<key>"); taken only for a line
     * offLines offers.
     * @param {string} arg The chip's argument.
     * @param {Object} S Settings.
     * @param {?Object} env Platform env.
     * @returns {boolean} whether anything changed
     */
    function limitOff(arg, S, env) {
        var at = String(arg || '').indexOf(':'), k = parseInt(String(arg).slice(0, at), 10), key = String(arg).slice(at + 1);
        var ok = offLines(S, env).some(function (c) { return c.k === k && c.key === key; });
        if (!ok) { return false; }
        turnOff(S, k, key);
        UI.last = null;
        return true;
    }

    /**
     * limitBlock's Undo: the pick over the limit put back, the Main metric's fill with it.
     * @param {Object} S Settings.
     * @returns {boolean} whether anything changed
     */
    function limitUndo(S) {
        var last = UI.last;
        if (!last || last.k !== editing(S)) { return false; }
        S[last.key] = last.old;
        if (last.key === lineStyle.FORECAST_LINES[0].key) { S.secondaryLineFill = last.fill; }
        UI.last = null;
        return true;
    }

    /**
     * The settings as stored, as they would be with screen i drawing style k.
     * @param {Object} S Settings.
     * @param {number} i View slot.
     * @param {number} k A style index.
     * @returns {Object} a copy
     */
    function withScreen(S, i, k) {
        var N = Object.assign({}, normalize(S));
        N['viewStyle' + i] = GS.codeOf(k);
        return N;
    }

    /**
     * Would screen i drawing style k make the shown styles draw a sixth series?
     * @param {Object} S Settings.
     * @param {?Object} env Platform env.
     * @param {number} i View slot.
     * @param {number} k A style index.
     * @returns {boolean}
     */
    function screenOverflows(S, env, i, k) {
        var N = withScreen(S, i, k);
        return overflows(N, env, GS.stylesShown(N, env), -1, null);
    }

    /**
     * A series as the limit's words name it: its metric as the Lines card's pickers name it
     * (forecast-metrics.js label), "(stripe)" after one drawn as a stripe, "(alerts only)" after
     * one whose Visible values are Alert (both: "(stripe, alerts only)").
     * @param {{metric: string, stripe: boolean, alert: boolean}} s A series (graph-styles.js seriesOf).
     * @returns {string}
     */
    function seriesName(s) {
        var how = (s.stripe ? ['stripe'] : []).concat(s.alert ? ['alerts only'] : []);
        return metrics.label(s.metric) + (how.length ? ' (' + how.join(', ') + ')' : '');
    }

    /**
     * The series some styles draw between them on this watch, each once, in the order they first
     * draw them.
     * @param {Object} N Settings as stored.
     * @param {?Object} env Platform env.
     * @param {number[]} ks Style indices.
     * @returns {Array<{metric: string, stripe: boolean}>}
     */
    function seriesUnion(N, env, ks) {
        return seriesIn(ks.map(function (k) { return GS.settingsFor(N, k); }), env);
    }

    /**
     * The series graphs with these settings draw between them on this watch (graph-styles.js
     * seriesOf), each once, in the order they first draw them.
     * @param {Object[]} list The graphs' settings (settingsFor).
     * @param {?Object} env Platform env.
     * @returns {Array<{metric: string, stripe: boolean}>}
     */
    function seriesIn(list, env) {
        var out = [];
        list.forEach(function (Sk) {
            GS.seriesOf(Sk, env).forEach(function (s) {
                if (s && !hasSeries(out, s)) { out.push(s); }
            });
        });
        return out;
    }

    /**
     * @param {Array<{metric: string, stripe: boolean, alert: boolean}>} list Series.
     * @param {{metric: string, stripe: boolean, alert: boolean}} s A series.
     * @returns {boolean} whether the list holds s
     */
    function hasSeries(list, s) {
        for (var i = 0; i < list.length; i++) {
            if (GS.sameSeries(list[i], s)) { return true; }
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
     * Why a graph that would join the screens is greyed out: what it would add to the graphs it
     * would show beside, and how many metrics the screens would then show. Add a screen says it
     * under a preset's card; the screen editor says it, the graph named first, when its greyed-out
     * chip is tapped ("Long also needs ...").
     * @param {Object} N The settings as stored, with the screen on style k (withScreen).
     * @param {?Object} env Platform env.
     * @param {number} k The style picked (or to be made).
     * @param {string} [name] The graph's name, to start with.
     * @returns {string}
     */
    function limitDesc(N, env, k, name) {
        var shown = GS.stylesShown(N, env);
        var extra = extraNames(N, env, k, shown.filter(function (j) { return j !== k; }));
        var lead = extra.length ? (name ? name + ' also needs ' : 'Also needs ') + andList(extra) + ': that makes '
            : (name ? name + ' makes ' : 'That makes ');
        return lead + seriesUnion(N, env, shown).length + ' metrics on your screens. The watch can show ' + GS.ROWS + '.';
    }

    /**
     * The Your graphs card's note (section noteFrom 'graphMetricsNote'; the owner's picks,
     * 2026-11-09: the count with a word on what it counts, what it means behind a '?'): how
     * many of the watch's five metric rows the graphs on the screens use between them, "4/5
     * metrics active", and behind its '?' which ones and what counts (THE LIMIT), with how to
     * make room once all five are active.
     * @param {Object} S Settings.
     * @param {?Object} env Platform env.
     * @returns {?{text: string, label: string, info: string}} null where the watch has no graph styles
     */
    function metricsNote(S, env) {
        if (!on(env) || !S) { return null; }
        var N = normalize(S), inUse = seriesUnion(N, env, GS.stylesShown(N, env)).map(seriesName);
        var used = inUse.length;
        return {
            text: used + '/' + GS.ROWS + ' metrics active',
            label: used + ' of ' + GS.ROWS + ' metrics active',
            info: esc((used ? 'Active: ' + inUse.join(', ') + '.' : 'No screen shows a forecast graph yet.')
                + (used >= GS.ROWS ? ' To make room, turn off a line in one of your graphs.' : ''))
                + '<p class="intro-more">' + esc('The graphs on your screens can show ' + GS.ROWS + ' metrics between'
                + ' them, up to ' + GS.TRENDS + ' in one graph. A metric in two graphs counts once, or twice when they'
                + ' draw it differently: as a line and as a stripe, or with all values and with alerts only.'
                + ' Temperature, the rain bars and a graph no screen shows don\'t count.') + '</p>'
        };
    }

    /**
     * Why the limit greys out a screen's chip on the Show on card: the rule, the metrics the
     * screens use now, what the graph needs on top, and how to make room.
     * @param {Object} S Settings.
     * @param {?Object} env Platform env.
     * @param {number} k The dialog's graph.
     * @returns {string}
     */
    function limitNote(S, env, k) {
        var N = normalize(S), shown = GS.stylesShown(N, env);
        var inUse = seriesUnion(N, env, shown).map(seriesName), extra = extraNames(N, env, k, shown);
        return 'The watch can show ' + GS.ROWS + ' metrics across all your screens.'
            + (inUse.length ? ' In use: ' + inUse.join(', ') + '.' : '')
            + (extra.length ? ' ' + GS.name(S, k) + ' also needs ' + andList(extra) + '.' : '')
            + ' To make room, turn off a line in one of your graphs.';
    }

    /**
     * The card's lead over its one graph, on a watch with graph styles: what New graph is for.
     * With two graphs or more the rows say it themselves.
     * @param {Object} S Settings.
     * @returns {string} '' for none
     */
    function cardHint(S) {
        return GS.count(S) < 2 ? 'New graph gives a screen a graph of its own.' : '';
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

    // ── The modules loaded after this one, read when asked ──────────────────

    /**
     * The setup's forecast looks, the templates (page/settings/wizard/wizard-forecast.js).
     * @returns {Object}
     */
    function forecastLooks() {
        return node ? require('../settings/wizard/wizard-forecast.js') : window.WizardForecast;
    }

    /**
     * The preview helpers (page/settings/preview-svg.js).
     * @returns {Object}
     */
    function svgLib() {
        return node ? require('../settings/preview-svg.js') : window.PreviewSvg;
    }

    /**
     * The screens' writer (page/layout/screens-page.js).
     * @returns {Object}
     */
    function screensPage() {
        return node ? require('../layout/screens-page.js') : window.ScreensPage;
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
     * template's own values at its length (wizard-forecast.js valuesAt: Outdoor draws its
     * feels-like line on 12 and 24 hours only) and that length over them, and your first
     * graph's Visible values (no template sets them: a template's wind, gust or UV line shows
     * what yours do, so it counts as the same metric on your screens, as it did while every
     * graph shared them).
     * @param {Object} S Settings as stored (settled or normalize).
     * @param {?Object} env Platform env.
     * @param {string} id A template's id (wizard-forecast.js LOOKS).
     * @param {string} [span] The length ('12' | '24' | '48'); the template's own without.
     * @returns {?Object} governed key -> value, or null for no such template
     */
    function templateValues(S, env, id, span) {
        var looks = forecastLooks(), look = looks.lookOf(id);
        if (!look) { return null; }
        var defaults = themedDefaults(S, env), len = String(span || look.span), shows = {};
        lineAlert.METRIC_IDS.forEach(function (metric) {
            var key = lineAlert.settingKey(metric);
            if (has(S, key)) { shows[key] = S[key]; }
        });
        return Object.assign(GS.valuesOf(defaults, 0), looks.valuesAt(id, S, env, defaults, len), { forecastHours: len }, shows);
    }

    /**
     * The graph a forecast screen Add a screen adds draws (screen-presets.js, Pebble Time 2; the
     * owner's, 2026-11-10): its template's own at the length picked, a template graph
     * (graph-styles.js TEMPLATE GRAPHS) and never one of the six, in the first one no screen
     * names, with the values a graph made from the template would start with (templateValues).
     * @param {Object} S Settings.
     * @param {?Object} env Platform env.
     * @param {string} id The template's id (wizard-forecast.js LOOKS).
     * @param {string} [span] The length ('12' | '24' | '48'); the template's own without.
     * @returns {?{k: number, values: Object}} null for no such template
     */
    function templateGraph(S, env, id, span) {
        var N = normalize(S), k = GS.freeTemplate(N), values = k < 0 ? null : templateValues(N, env, id, span);
        return values ? { k: k, values: values } : null;
    }

    /**
     * Make template graph k one of yours (its screen row's Edit, the owner's, 2026-11-10: a
     * template's graph counts toward the six once it is edited): its values in the first free
     * slot, named after its template ("Outdoor") unless another graph has that name (then as a
     * new graph is: newName), the screens that drew it drawing that one, the template graph
     * gone. Mutates S (settled first).
     * @param {Object} S Settings.
     * @param {number} k A template graph's index.
     * @returns {number} the graph made, -1 when there is none to make it from or no free slot
     */
    function adoptTemplate(S, k) {
        settle(S);
        var j = GS.freeSlot(S), values = GS.isTemplate(k) ? GS.parse(S).styles[k] : null;
        if (j < 0 || !values) { return -1; }
        var look = forecastLooks().lookOf(GS.lookOf(S, k));
        var taken = existing(S).map(function (g) { return GS.name(S, g); });
        S.graphStyles = GS.withStyle(S, j, values);
        S.graphStyles = GS.withName(S, j, look && taken.indexOf(look.label) === -1 ? look.label : newName(S, j));
        for (var i = 0; i < M.MAX_SCREENS; i++) {
            if (S['viewStyle' + i] === GS.codeOf(k)) { S['viewStyle' + i] = GS.codeOf(j); }
        }
        S.graphStyles = GS.pruneTemplates(S);
        return j;
    }

    /**
     * A template's line in the pickers: its length, then what it draws, in the words the template
     * is written in (wizard-forecast.js summary): "66 h · Rain chance as a shaded area, clouds as
     * a stripe, solid rain bars".
     * @param {Object} S Settings.
     * @param {?Object} env Platform env.
     * @param {string} id A template's id.
     * @returns {string}
     */
    function templateLine(S, env, id) {
        var looks = forecastLooks(), len = looks.spanLabel(id, env, normalize(S));
        return (len ? len + ' · ' : '') + looks.summary(id, env);
    }

    /**
     * A graph as the pickers and its card draw it: the setup's look preview (wizard-forecast.js
     * previewSvg) of its settings, its ids tagged (preview-svg.js tagIds) so the pictures on one
     * page never share a pattern.
     * @param {Object} Sk The settings the graph draws.
     * @param {?Object} env Platform env.
     * @param {?Object} userData Page userData (the palette).
     * @param {string} tag Unique on the page.
     * @param {{bare: boolean}} [opts] `bare`: without its legend (previewSvg).
     * @returns {string} SVG markup
     */
    function graphPicture(Sk, env, userData, tag, opts) {
        return svgLib().tagIds(forecastLooks().previewSvg(Sk, env, userData || {}, opts), tag);
    }

    /**
     * The settings a picker's option draws: a graph ('1'..'3'), a copy of one ('copy<n>'), or a
     * template (its id).
     * @param {Object} S Settings.
     * @param {?Object} env Platform env.
     * @param {string} v The option's value.
     * @returns {?Object} null for a value that names none (a group header)
     */
    function optionSettings(S, env, v) {
        var N = normalize(S), k = /^[0-9]$/.test(v) ? parseInt(v, 10) - 1
            : v.indexOf(COPY) === 0 ? parseInt(v.slice(COPY.length), 10) - 1 : -1;
        if (k >= 0) { return GS.exists(N, k) ? GS.settingsFor(N, k) : null; }
        var values = templateValues(N, env, v);
        return values ? Object.assign({}, N, values) : null;
    }

    /**
     * A graph's picture by its value as the pickers name it (optionSettings: one of yours, a
     * template at its own length), its ids tagged: the pickers' options and Add a screen's roll
     * (screens-page.js, without the legend).
     * @param {Object} S Settings.
     * @param {?Object} env Platform env.
     * @param {string} v The value.
     * @param {?Object} userData Page userData.
     * @param {string} tag Unique on the page.
     * @param {{bare: boolean}} [opts] `bare`: without its legend (previewSvg).
     * @returns {string} SVG markup, '' for none
     */
    function valuePicture(S, env, v, userData, tag, opts) {
        var Sk = optionSettings(S, env, String(v || ''));
        return Sk ? graphPicture(Sk, env, userData, tag.replace(/[^A-Za-z0-9-]/g, '-'), opts) : '';
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
        var v = String(args.value || '');
        return valuePicture(S, env, v, userData, 'gs-' + v);
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
            var len = spanHours.spanLabel(GS.settingsFor(N, k));
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
     * @param {Object} [over] Values laid over the new graph's (Add a screen's length, at which a
     *   template's values are read: templateValues).
     * @returns {number} The new graph's index, -1 for none made (no free slot, no such source).
     */
    function createGraph(S, from, env, over) {
        settle(S);
        var k = GS.freeSlot(S), src = String(from || '');
        if (k < 0 || !src) { return -1; }
        var values = null;
        if (src.indexOf(COPY) === 0) {
            var j = parseInt(src.slice(COPY.length), 10) - 1;
            if (GS.exists(S, j)) { values = GS.valuesOf(S, j); }
        } else {
            values = templateValues(S, env, src, over && over.forecastHours);
        }
        if (!values) { return -1; }
        S.graphStyles = GS.withStyle(S, k, Object.assign(values, over || {}));
        S.graphStyles = GS.withName(S, k, newName(S, k));
        return k;
    }

    /**
     * New graph's pick (onChange 'graphStyleCreate'): the graph made (createGraph), whose dialog
     * opens once the sheet has closed (newGraph); the picker cleared.
     * @param {Object} S Settings (S[NEW_FROM] picked).
     * @param {*} oldValue The picker's value before.
     * @param {string} from A template's id, or 'copy<n>'.
     * @param {?Object} env Platform env.
     * @returns {void}
     */
    function createStyle(S, oldValue, from, env) {
        S[NEW_FROM] = '';
        createGraph(S, from, env);
    }

    /**
     * A name typed for the picked graph (onChange 'graphStyleRenamed': the graph dialog's title,
     * schema.js graphDialog rename): its name, '' for the default one. Written into the item as
     * stored, so the swap keeps it.
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
     * Delete the picked graph (its dialog's Delete): the screens on it draw the first graph, and
     * an Undo shows on the card for five seconds. The pick still names the graph, so the dialog,
     * its graph gone, closes (graphShown). Never the first graph.
     * @param {Object} S Settings.
     * @returns {void}
     */
    function deletePicked(S) {
        var k = pickIndex(S);
        if (k === 0) { return; }
        settle(S);
        var o = GS.parse(S);
        var undo = { k: k, name: o.names[k], values: o.styles[k], label: GS.name(S, k), views: GS.deleteStyle(S, k) };
        kit.flash(UI.toast, undo, 5000, function () { if (UI.ctx) { UI.ctx.render(); } });
    }

    /**
     * Undo a delete: the graph back in its slot, with its name, on the screens that drew it.
     * Only that graph's slot and those screens move.
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
        u.views.forEach(function (i) { S['viewStyle' + i] = GS.codeOf(u.k); });
    }

    // ── The screens a graph shows on ────────────────────────────────────────

    /**
     * Put graph k on screen i's forecast graph (the Show on card),
     * through the screens' writer (screens-page.js writeScreen), with the swap undone first
     * (the next render swaps the dialog's graph back in). A screen without a forecast graph is
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
        if (k > 0) { next[j].style = GS.codeOf(k); } else { delete next[j].style; }
        screensPage().writeScreen(S, i, next, env);
    }

    /**
     * A tap on a Show on chip (action 'graphOnScreen'): the dialog's graph onto screen i, or off
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

    // ── The Your graphs card ────────────────────────────────────────────────

    // The card's own look; its list, red arrows, New graph, the chips and the Undo are the page's
    // shared parts (kit: config-ui/lib/ui.js, their look in shell.html).
    var CSS = '.gl-lead{padding:12px 16px 10px}'
        // A row: the graph's picture, its name, where it shows, its metrics and the room left,
        // the red arrow of a row that opens a screen of its own.
        + '.gl-open{display:flex;align-items:center;gap:12px;width:100%;margin:0;padding:12px 12px 12px 16px;border:none;'
        + 'background:none;color:var(--lbl);text-align:left;font:inherit;cursor:pointer;-webkit-appearance:none;appearance:none}'
        // The picture in the pickers' frame (shell.html .ssel-pic), wider.
        + '.gl-pic{width:118px;border-radius:9px}'
        + '.gl-txt{flex:1 1 auto;min-width:0;display:grid;gap:3px}'
        + '.gl-met{color:var(--lbl)}'
        // The Show on card's chips and the line under them, in the card's block row.
        + '.gc-show{display:grid;gap:8px}'
        // A line's dialog over the limit: the note, the lines to turn off under it.
        + '.gl-over{display:grid;gap:8px;padding:4px 0}';

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
     * The Your graphs card's rows, worked out once per render: a row per graph on a watch with
     * graph styles, else the one graph with no screens line. Each has the settings it draws (its
     * picture), its name, its length and the screens it shows on (cardLine), the metrics it draws
     * and the room it has left (roomText; THE LIMIT read once for all of them).
     * @param {Object} S Settings.
     * @param {?Object} env Platform env.
     * @returns {{N: Object, solo: boolean, rows: Array<{k: number, Sk: Object, name: string,
     *   where: string, metrics: string, room: string}>}} N: the settings as stored
     */
    function listRows(S, env) {
        var N = normalize(S), solo = !on(env), shown = GS.stylesShown(N, env);
        var names = screenNames(N, env), used = seriesUnion(N, env, shown).length;
        return {
            N: N,
            solo: solo,
            rows: (solo ? [0] : existing(N)).map(function (k) {
                var Sk = GS.settingsFor(N, k), series = seriesIn([Sk], env);
                return { k: k, Sk: Sk, name: graphName(N, env, k), where: solo ? '' : cardLine(Sk, names[k] || []),
                    metrics: series.length ? series.map(seriesName).join(', ') : 'No metrics',
                    room: roomText(series.length, shown.indexOf(k) !== -1, used, env) };
            })
        };
    }

    /**
     * How many more metrics a graph has room for (its row's last line): its free lines, and on a
     * graph the screens show no more than the screens' five leave (THE LIMIT; a metric another
     * graph on the screens draws would fit too, the '?' in the header says how they count).
     * @param {number} count The metrics it draws.
     * @param {boolean} shown Whether a screen shows it.
     * @param {number} used The metrics the screens show between them.
     * @param {?Object} env Platform env.
     * @returns {string} "Room for 2 more metrics", "Full: 4 metrics", "Full: the screens show 5 metrics"
     */
    function roomText(count, shown, used, env) {
        var slots = GS.linesDrawn(env), free = Math.max(0, slots - count);
        var room = shown ? Math.min(free, Math.max(0, GS.ROWS - used)) : free;
        if (room > 0) { return 'Room for ' + room + ' more metric' + (room > 1 ? 's' : ''); }
        return free === 0 ? 'Full: ' + slots + ' metrics' : 'Full: the screens show ' + GS.ROWS + ' metrics';
    }

    /**
     * A graph by the name the page gives it: where the watch has graph styles one of yours by
     * its own (graph-styles.js name) and a template graph by its template's ("Outdoor"), else
     * the Forecast graph.
     * @param {Object} S Settings.
     * @param {?Object} env Platform env.
     * @param {number} k A style index.
     * @returns {string}
     */
    function graphName(S, env, k) {
        if (!on(env)) { return SOLO; }
        if (!GS.isTemplate(k)) { return GS.name(S, k); }
        var look = forecastLooks().lookOf(GS.lookOf(S, k));
        return look ? look.label : SOLO;
    }

    /**
     * One graph's row on the Your graphs card (listRows): its picture (graphPicture), its name,
     * where it shows, the metrics it draws, the room left and the red arrow; a tap opens its
     * dialog (action 'openGraph').
     * @param {Object} r The row.
     * @param {?Object} env Platform env.
     * @param {?Object} userData Page userData (the palette).
     * @returns {string} HTML
     */
    function graphRow(r, env, userData) {
        return '<div class="ui-row gl-row" role="listitem"><button type="button" class="gl-open" data-action="openGraph"'
            + ' data-action-arg="' + (r.k + 1) + '"><span class="ssel-pic gl-pic" aria-hidden="true">'
            + graphPicture(r.Sk, env, userData, 'gl' + r.k) + '</span><span class="gl-txt">'
            + '<span class="ui-n">' + esc(r.name) + '</span>'
            + (r.where ? '<span class="ui-d">' + esc(r.where) + '</span>' : '')
            + '<span class="ui-d gl-met">' + esc(r.metrics) + '</span>'
            + '<span class="ui-d">' + esc(r.room) + '</span></span>' + kit.navArrow()
            + '</button></div>';
    }

    /**
     * The Your graphs card (block 'graphList'; the owner's ask, 2026-11-09: the graphs in a list
     * with their pictures, a graph's settings behind a tap), in the page's shared parts (kit): a
     * row per graph (graphRow), the one graph on a watch without graph styles; then, on a watch
     * with them, New graph while a slot is free, with how many graphs there are (its sheet starts
     * one from a template or as a copy, and the new graph's dialog opens), else why there is none,
     * and the Undo after a Delete. Under a dialog, which covers the whole page, it is the card as
     * last drawn: a tap in a graph's dialog draws that dialog, not the pictures of a list nobody
     * sees, and the render that closes the dialog draws the card afresh.
     * @param {Object} S Settings.
     * @param {?Object} env Platform env.
     * @param {?Object} userData Page userData (the palette).
     * @returns {string} HTML
     */
    function listBlock(S, env, userData) {
        if (!S) { return ''; }
        if (UI.covered && UI.list) { return UI.list; }
        ensureStyle();
        var list = listRows(S, env), lead = list.solo ? '' : cardHint(list.N);
        var h = (lead ? '<div class="gl-lead">' + esc(lead) + '</div>' : '')
            + '<div role="list" aria-label="' + esc(listTitle(S, env) || SOLO) + '">'
            + list.rows.map(function (r) { return graphRow(r, env, userData); }).join('') + '</div>';
        if (!list.solo) {
            h += GS.freeSlot(list.N) >= 0
                ? kit.newRow('New graph', list.rows.length + ' of ' + GS.MAX_STYLES + ' graphs', { 'data-action': 'newGraph' })
                : '<div class="ui-row ui-foot">' + esc(FULL) + '</div>';
            if (UI.toast.v) { h += kit.undoToast(UI.toast.v.label + ' deleted.', { 'data-action': 'undoDeleteGraphStyle' }); }
        }
        UI.list = '<div class="ui-list">' + h + '</div>';
        return UI.list;
    }

    // ── A graph's dialog (schema.js graphDialog) ────────────────────────────

    /**
     * The Show on card of a graph's dialog (block 'graphShowOn'; two graphs or more): a chip per
     * screen, ticked where the screen draws the graph, greyed out where it has no forecast graph
     * or where the graph would make the screens show a sixth metric; a line under it says why.
     * @param {Object} S Settings.
     * @param {?Object} env Platform env.
     * @returns {string} HTML ('' with one graph or none to choose between)
     */
    function showOnBlock(S, env) {
        if (!on(env) || !S || GS.count(S) < 2) { return ''; }
        ensureStyle();
        var k = pickIndex(S), lists = M.screensOf(S, env), none = [], full = false, kept = false;
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
        return '<div class="gc-show"><div class="ui-chips" role="group" aria-label="Show on">' + chips + '</div>'
            + (notes.length ? '<div class="ui-d">' + esc(notes.join(' ')) + '</div>' : '') + '</div>';
    }

    /**
     * The dialog's title (display resolver 'graphName'): the graph's name, or on a watch with
     * one graph the Forecast graph.
     * @param {Object} S Settings.
     * @param {?Object} env Platform env.
     * @returns {string}
     */
    function dialogTitle(S, env) {
        return graphName(S, env, pickIndex(S));
    }

    /**
     * The dialog's name field's placeholder (display resolver 'graphDefaultName'): the graph's
     * default name, which an empty name stands for.
     * @param {Object} S Settings.
     * @returns {string} "Graph 2"
     */
    function defaultNameOfPick(S) {
        return GS.defaultName(pickIndex(S));
    }

    /**
     * The Your graphs card's title (display resolver 'graphListTitle'): "Your graphs" where the
     * watch has graph styles, none over the one graph elsewhere (its row names it).
     * @param {Object} S Settings.
     * @param {?Object} env Platform env.
     * @returns {string}
     */
    function listTitle(S, env) {
        return on(env) ? 'Your graphs' : '';
    }

    /**
     * Open graph k's dialog: it is picked (the dialog's render swaps it in), then the dialog
     * opens over the pane, its title a name field when asked (a new graph), its kicker the card's
     * title; closed, it hands the focus back to the graph's row. Over the screen editor (its
     * graph row's Edit) it says the screen's name instead, and the editor repaints
     * once it closes.
     * @param {Object} S Settings.
     * @param {number} k A style index.
     * @param {boolean} rename Open the title as the name field.
     * @param {{kicker: string, onClose: Function}} [over] Opened over the screen editor.
     * @returns {void}
     */
    function openGraph(S, k, rename, over) {
        S[PICK] = String(k + 1);
        if (!(UI.ctx && UI.ctx.openDialog)) { return; }
        UI.ctx.openDialog(SHEET, over ? { rename: rename, kicker: over.kicker, onClose: over.onClose, overlay: true }
            : { rename: rename, kicker: listTitle(S, UI.ctx.ENV),
                focusBack: '[data-action="openGraph"][data-action-arg="' + (k + 1) + '"]' });
    }

    /**
     * Whether the dialog's Delete shows (when resolver 'graphDeletable'): on a watch with graph
     * styles, while the dialog's graph is not the first, which every screen falls back to.
     * @param {Object} S Settings (the show-when context: the settings by key).
     * @param {?Object} env Platform env.
     * @returns {boolean}
     */
    function deletable(S, env) {
        return on(env) && pickIndex(S) > 0;
    }

    /**
     * What the dialog's Delete says (hint resolver 'graphDeleteLabel'): the graph by name.
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
        if (PConf.hooks && PConf.hooks.onReady) { PConf.hooks.onReady(function (ctx) { UI.ctx = ctx; }); }
        if (PConf.blocks) {
            PConf.blocks.register('graphList', listBlock);
            PConf.blocks.register('graphShowOn', showOnBlock);
            PConf.blocks.register('graphLimit', function (S, env) { ensureStyle(); return limitBlock(S, env); });
        }
        if (PConf.optionsResolvers) {
            PConf.optionsResolvers.register('graphStyleStarts', startOptions);
        }
        if (PConf.hintResolvers) {
            PConf.hintResolvers.register('graphStyleShared', sharedHint);
            PConf.hintResolvers.register('graphDeleteLabel', deleteLabel);
        }
        if (PConf.whenResolvers) {
            PConf.whenResolvers.register('graphDeletable', deletable);
            PConf.whenResolvers.register('graphShown', graphShown);
        }
        if (PConf.pictureResolvers) { PConf.pictureResolvers.register('graphStylePicture', optionPicture); }
        if (PConf.displayResolvers) {
            PConf.displayResolvers.register('graphMetricsNote', metricsNote);
            PConf.displayResolvers.register('graphName', dialogTitle);
            PConf.displayResolvers.register('graphDefaultName', defaultNameOfPick);
            PConf.displayResolvers.register('graphListTitle', listTitle);
        }
        if (PConf.onChange) {
            PConf.onChange.register('graphStyleCreate', createStyle);
            PConf.onChange.register('graphStyleRenamed', renameStyle);
            PConf.onChange.register('graphLimitPicked', limitPicked);
        }
        PConf.actions = PConf.actions || {};
        // A row of the Your graphs card: its graph's dialog.
        PConf.actions.openGraph = function (arg, S) {
            openGraph(S, Math.max(0, (parseInt(arg, 10) || 1) - 1), false);
            return false;
        };
        // New graph: its sheet (templates and copies); a pick makes the graph (createStyle), whose
        // dialog opens with its name field ready once the sheet has closed. Dismissed, the sheet
        // hands the focus back to New graph.
        PConf.actions.newGraph = function (arg, S) {
            if (!UI.ctx || !UI.ctx.openSheet) { return false; }
            var before = existing(S);
            UI.ctx.openSheet(NEW_FROM, function () {
                var made = existing(S).filter(function (k) { return before.indexOf(k) === -1; });
                if (made.length) { openGraph(S, made[0], true); }
            }, '[data-action="newGraph"]');
            return false;
        };
        PConf.actions.graphOnScreen = function (arg, S, env) { toggleScreen(S, env, Number(arg)); return true; };
        // Delete in a graph's dialog: the graph gone, its dialog closes (graphShown); the card's
        // Undo shows.
        PConf.actions.deleteGraphStyle = function (arg, S) { deletePicked(S); return true; };
        PConf.actions.undoDeleteGraphStyle = function (arg, S) { undoDelete(S); return true; };
        // A line's dialog over the limit (limitBlock): a line turned off, or the pick put back.
        PConf.actions.graphLimitOff = limitOff;
        PConf.actions.graphLimitUndo = function (arg, S) { return limitUndo(S); };
    }

    var api = {
        SWAP: SWAP,
        PICK: PICK,
        NEW_FROM: NEW_FROM,
        LIMIT: LIMIT,
        editing: editing,
        normalize: normalize,
        // normalize by the name other modules call it by: a call spelt `.normalize(` reads as
        // String.prototype.normalize to the ES5 check (test/repo/config-es5.test.js).
        asStored: normalize,
        settle: settle,
        swapIn: swapIn,
        pickIndex: pickIndex,
        onRender: onRender,
        styleSettings: styleSettings,
        screenSettings: screenSettings,
        existing: existing,
        drawnBy: drawnBy,
        onScreens: onScreens,
        listRows: listRows,
        graphShown: graphShown,
        limitOptions: limitOptions,
        overBy: overBy,
        offLines: offLines,
        limitBlock: limitBlock,
        screenOverflows: screenOverflows,
        limitDesc: limitDesc,
        limitNote: limitNote,
        metricsNote: metricsNote,
        cardHint: cardHint,
        sharedHint: sharedHint,
        templateValues: templateValues,
        templateGraph: templateGraph,
        graphName: graphName,
        adoptTemplate: adoptTemplate,
        openGraph: openGraph,
        templateLine: templateLine,
        optionPicture: optionPicture,
        valuePicture: valuePicture,
        startOptions: startOptions,
        createGraph: createGraph,
        createStyle: createStyle,
        renameStyle: renameStyle,
        deletePicked: deletePicked,
        undoDelete: undoDelete,
        setScreenGraph: setScreenGraph,
        toggleScreen: toggleScreen,
        deletable: deletable,
        deleteLabel: deleteLabel,
        _test: { UI: UI }
    };
    if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
    if (typeof window !== 'undefined') { window.GraphStylesPage = api; }
})();
