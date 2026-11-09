// src/pkjs/settings/graph-styles-page.js — ES5, WebView (+ Node for tests). The graphs on the
// settings page (src/pkjs/graph-styles.js is the model, which calls a graph a graph style): the
// Your graphs card on Graphs › Forecast (the owner's ask, 2026-11-09: a list of the graphs, each
// with its picture, name, length and screens, the metrics it draws and the room left; a tap opens
// the graph's dialog, schema.js graphDialog, with its settings; New graph and the Undo of a Delete
// under the rows; on a watch without graph styles the one graph), the dialog's title (the graph's
// name, renamed there) and its Show on card with Delete under it (the page's shared parts,
// config-ui/lib/ui.js), the swap that lets every row of the dialog edit the graph it shows, and
// the five-series limit the forecast pickers, the Show on card and the screen editor's graph
// chips keep.
//
// TEMPLATES AND GRAPHS (the owner's pick, 2026-11-08). A template is one of the setup's forecast
// looks (wizard-forecast.js LOOKS: Classic, Clean, Stripes). The Your graphs card's New graph starts
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
// THE UNION), a series being a metric drawn as a line or as a stripe. A graph keeps its four lines:
// the spare row has no picker (the owner's call, 2026-11-08: "only use for multiple graphs"). A
// pick that would make a sixth is greyed out, and its words say why in the page's terms,
// "metrics" (a metric drawn as a line and as a stripe counting twice): a forecast line's metric or
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
    var GS = node ? require('../graph-styles.js') : window.GraphStyles;
    var M = node ? require('../screens.js') : window.Screens;
    var spanHours = node ? require('../forecast-span-hours.js') : window.ForecastSpanHours;
    // The metrics' names (forecast-metrics.js): the limit's words and the rows name a metric by them.
    var metrics = node ? require('./forecast-metrics.js') : window.ForecastMetrics;
    // The page's one escape helper and its sentence lists (config-ui/lib/html.js, concatenated
    // ahead of every app file).
    var html = node ? require('../config-ui/lib/html.js') : PConf.html;
    var esc = html.esc;
    var andList = html.andList;
    // The page's shared parts (config-ui/lib/ui.js): the card's list, its red arrows, New graph,
    // the chips, the Undo and its timer.
    var kit = node ? require('../config-ui/lib/ui.js') : PConf.ui;

    // The swap state in S: {k, held}, the style whose values sit in the flat keys and the
    // first style's values of the governed keys. Never a schema key, so never saved.
    var SWAP = '_graphStyleSwap';
    // The page-only items (schema.js): the card's pick and New graph's picker.
    var PICK = 'graphStylePick';
    var NEW_FROM = 'graphStyleNewFrom';
    // A graph's dialog (schema.js graphDialog).
    var SHEET = 'graph';
    // A line picker's greyed-out option (limitOptions): one change adds one series at most.
    var LIMIT = 'That makes ' + (GS.ROWS + 1) + ' metrics on your screens. The watch can show ' + GS.ROWS + '.';
    // New graph's copies: 'copy<n>', a copy of graph n. A picker's group header: GROUP (never a
    // value anything stores).
    var COPY = 'copy';
    var GROUP = '__group';
    // Why the card has no New graph: every slot holds one.
    var FULL = 'You have ' + GS.MAX_STYLES + ' graphs, the most there can be. Delete one to make another.';

    // The page's live state (onReady), the card's Undo (a flash: kit.flash) and the defaults a
    // template starts from (themedDefaults), kept per theme.
    var UI = { ctx: null, toast: { v: null, t: null }, defaults: null };
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
     * The engine's render hook: while a graph's dialog is open the picked style's values in the
     * flat keys, anywhere else the first style's.
     * @param {{S: Object, env: ?Object, dialog: ?string}} c The render's context (dialog: the
     *   root of the dialogs on screen).
     * @returns {void}
     */
    function onRender(c) {
        var S = c.S;
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
        return !on(env) || GS.exists(S, (parseInt(S[PICK], 10) || 1) - 1);
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
     * The screens whose forecast graph draws a graph, as the Watchface tab lists them.
     * @param {Object} S Settings.
     * @param {?Object} env Platform env.
     * @param {number} k A style index.
     * @returns {string[]} the screens' names
     */
    function screensOn(S, env, k) {
        return screenNames(S, env)[k] || [];
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
     * A graph's card line: its length and where it shows, "66 h · Flick 1", "24 h · No screen".
     * @param {Object} S Settings.
     * @param {?Object} env Platform env.
     * @param {number} k A style index.
     * @returns {string}
     */
    function cardLine(S, env, k) {
        return whereLine(styleSettings(S, k), env, screensOn(S, env, k));
    }

    /**
     * The card line of a graph with these settings on these screens (cardLine).
     * @param {Object} Sk The graph's settings.
     * @param {?Object} env Platform env.
     * @param {string[]} names The screens it shows on.
     * @returns {string}
     */
    function whereLine(Sk, env, names) {
        var len = spanHours.spanLabel(Sk, env);
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
     * The settings as stored, as they would be with screen i drawing style k.
     * @param {Object} S Settings.
     * @param {number} i View slot.
     * @param {number} k A style index.
     * @returns {Object} a copy
     */
    function withScreen(S, i, k) {
        var N = Object.assign({}, normalize(S));
        N['viewStyle' + i] = String(k + 1);
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
     * (forecast-metrics.js label), "(stripe)" after one drawn as a stripe.
     * @param {{metric: string, stripe: boolean}} s A series (graph-styles.js seriesOf).
     * @returns {string}
     */
    function seriesName(s) {
        return metrics.label(s.metric) + (s.stripe ? ' (stripe)' : '');
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
                + ' them, up to ' + GS.TRENDS + ' in one graph. A metric in two graphs counts once, or twice when one'
                + ' draws it as a line and the other as a stripe. Temperature, the rain bars and a graph no screen'
                + ' shows don\'t count.') + '</p>'
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
     * @returns {string} SVG markup
     */
    function graphPicture(Sk, env, userData, tag) {
        return svgLib().tagIds(forecastLooks().previewSvg(Sk, env, userData || {}), tag);
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
            var len = spanHours.spanLabel(GS.settingsFor(N, k), env);
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
        u.views.forEach(function (i) { S['viewStyle' + i] = String(u.k + 1); });
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
        if (k > 0) { next[j].style = String(k + 1); } else { delete next[j].style; }
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
        + '.gc-show{display:grid;gap:8px}';

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
     * What the Your graphs card reads, worked out once per render: the settings as stored, the
     * graphs the screens show and how many metrics they use between them (THE LIMIT), and each
     * graph's settings, the series it draws and the screens it shows on.
     * @param {Object} S Settings.
     * @param {?Object} env Platform env.
     * @returns {{N: Object, shown: number[], used: number, graphs: Array<{k: number, Sk: Object,
     *   series: Array<{metric: string, stripe: boolean}>, names: string[]}>}}
     */
    function listFacts(S, env) {
        var N = normalize(S), many = on(env), shown = many ? GS.stylesShown(N, env) : [];
        var names = many ? screenNames(N, env) : {};
        return {
            N: N,
            shown: shown,
            used: seriesUnion(N, env, shown).length,
            graphs: (many ? existing(N) : [0]).map(function (k) {
                var Sk = GS.settingsFor(N, k);
                return { k: k, Sk: Sk, series: seriesIn([Sk], env), names: names[k] || [] };
            })
        };
    }

    /**
     * How many more metrics graph k has room for (its row's last line): its free lines, and on
     * a shown graph no more than the screens' five leave (THE LIMIT; a metric another graph on
     * the screens draws would fit too, the '?' in the header says how they count).
     * @param {Object} S Settings.
     * @param {?Object} env Platform env.
     * @param {number} k A style index.
     * @param {Object} [facts] The card's facts (listFacts), when the caller has them.
     * @returns {string} "Room for 2 more metrics", "Full: 4 metrics", "Full: the screens show 5 metrics"
     */
    function roomText(S, env, k, facts) {
        var f = facts || listFacts(S, env), g = f.graphs.filter(function (x) { return x.k === k; })[0];
        var slots = GS.linesDrawn(env), free = Math.max(0, slots - (g ? g.series.length : 0)), room = free;
        if (f.shown.indexOf(k) !== -1) { room = Math.min(free, Math.max(0, GS.ROWS - f.used)); }
        if (room > 0) { return 'Room for ' + room + ' more metric' + (room > 1 ? 's' : ''); }
        return free === 0 ? 'Full: ' + slots + ' metrics' : 'Full: the screens show ' + GS.ROWS + ' metrics';
    }

    /**
     * A graph by the name the page gives it: its own where the watch has graph styles, else the
     * Forecast graph.
     * @param {Object} S Settings.
     * @param {?Object} env Platform env.
     * @param {number} k A style index.
     * @returns {string}
     */
    function graphName(S, env, k) {
        return on(env) ? GS.name(S, k) : SOLO;
    }

    /**
     * One graph's row on the Your graphs card: its picture (graphPicture), its name, where it
     * shows (whereLine; nothing on a watch with one graph), the metrics it draws and the room
     * left (roomText), the red arrow; a tap opens its dialog (action 'openGraph').
     * @param {Object} facts The card's facts (listFacts).
     * @param {Object} g One graph of them.
     * @param {?Object} env Platform env.
     * @param {?Object} userData Page userData (the palette).
     * @returns {string} HTML
     */
    function graphRow(facts, g, env, userData) {
        var where = on(env) ? whereLine(g.Sk, env, g.names) : '', metrics = g.series.map(seriesName);
        return '<div class="ui-row gl-row" role="listitem"><button type="button" class="gl-open" data-action="openGraph"'
            + ' data-action-arg="' + (g.k + 1) + '"><span class="ssel-pic gl-pic" aria-hidden="true">'
            + graphPicture(g.Sk, env, userData, 'gl' + g.k) + '</span><span class="gl-txt">'
            + '<span class="ui-n">' + esc(graphName(facts.N, env, g.k)) + '</span>'
            + (where ? '<span class="ui-d">' + esc(where) + '</span>' : '')
            + '<span class="ui-d gl-met">' + esc(metrics.length ? metrics.join(', ') : 'No metrics') + '</span>'
            + '<span class="ui-d">' + esc(roomText(facts.N, env, g.k, facts)) + '</span></span>' + kit.navArrow()
            + '</button></div>';
    }

    /**
     * The Your graphs card (block 'graphList'; the owner's ask, 2026-11-09: the graphs in a list
     * with their pictures, a graph's settings behind a tap), in the page's shared parts (kit): a
     * row per graph (graphRow), the one graph on a watch without graph styles; then, on a watch
     * with them, New graph while a slot is free, with how many graphs there are (its sheet starts
     * one from a template or as a copy, and the new graph's dialog opens), else why there is none,
     * and the Undo after a Delete.
     * @param {Object} S Settings.
     * @param {?Object} env Platform env.
     * @param {?Object} userData Page userData (the palette).
     * @returns {string} HTML
     */
    function listBlock(S, env, userData) {
        if (!S) { return ''; }
        ensureStyle();
        var facts = listFacts(S, env), lead = on(env) ? cardHint(facts.N) : '';
        var h = (lead ? '<div class="gl-lead">' + esc(lead) + '</div>' : '')
            + '<div role="list" aria-label="' + esc(listTitle(S, env) || SOLO) + '">'
            + facts.graphs.map(function (g) { return graphRow(facts, g, env, userData); }).join('') + '</div>';
        if (on(env)) {
            h += GS.freeSlot(facts.N) >= 0
                ? kit.newRow('New graph', facts.graphs.length + ' of ' + GS.MAX_STYLES + ' graphs', { 'data-action': 'newGraph' })
                : '<div class="ui-row ui-foot">' + esc(FULL) + '</div>';
            if (UI.toast.v) { h += kit.undoToast(UI.toast.v.label + ' deleted.', { 'data-action': 'undoDeleteGraphStyle' }); }
        }
        return '<div class="ui-list">' + h + '</div>';
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
     * title; closed, it hands the focus back to the graph's row.
     * @param {Object} S Settings.
     * @param {number} k A style index.
     * @param {boolean} rename Open the title as the name field.
     * @returns {void}
     */
    function openGraph(S, k, rename) {
        S[PICK] = String(k + 1);
        if (!(UI.ctx && UI.ctx.openDialog)) { return; }
        UI.ctx.openDialog(SHEET, { rename: rename, kicker: listTitle(S, UI.ctx.ENV),
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
    }

    var api = {
        SWAP: SWAP,
        PICK: PICK,
        NEW_FROM: NEW_FROM,
        LIMIT: LIMIT,
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
        existing: existing,
        drawnBy: drawnBy,
        screensOn: screensOn,
        onScreens: onScreens,
        cardLine: cardLine,
        graphShown: graphShown,
        limitOptions: limitOptions,
        screenOverflows: screenOverflows,
        limitDesc: limitDesc,
        limitNote: limitNote,
        metricsNote: metricsNote,
        cardHint: cardHint,
        sharedHint: sharedHint,
        templateValues: templateValues,
        presetGraph: presetGraph,
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
        roomText: roomText,
        deletable: deletable,
        deleteLabel: deleteLabel,
        _test: { UI: UI }
    };
    if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
    if (typeof window !== 'undefined') { window.GraphStylesPage = api; }
})();
