// src/pkjs/settings/graph-styles-page.js — ES5, WebView (+ Node for tests). Graph styles on the
// settings page (Pebble Time 2; src/pkjs/graph-styles.js is the model): the Graph style card at the
// top of Graphs › Forecast (a select of the styles, Rename, New style, Delete with Undo), the swap
// that lets every row on that pane edit the style picked there, the screen editor's style picker's
// options, and the four-series limit the forecast pickers and that picker keep.
//
// THE SWAP. Every row, hint, resolver and the pinned preview on Graphs › Forecast reads the flat
// keys, which hold the first style. While the pane shows another style k, its values sit in the
// flat keys and the first style's wait in S[SWAP].held, so every row edits style k unchanged. The
// invariant: off that pane the flat keys hold the first style. The engine's render hook
// (PConf.hooks.onRender) swaps on every way to and from the pane; its normalize hook
// (PConf.hooks.onNormalize) hands Save and Revert the settings as stored, style k written into
// graphStyles and the first style back in the flat keys, so picking a style never lights Save
// and Save stores the edits. The swap state lives in S itself: whatever puts S back (Revert, a
// dialog's ×) puts the swap back with the values it describes.
//
// THE LIMIT. The weather message carries four metric rows, so the styles the screens show draw at
// most four series between them (graph-styles.js THE UNION). A pick that would make a fifth is
// greyed out with LIMIT: a forecast line's metric or style on a shown style, and in the screen
// editor a style that would join the screens. A style no screen shows is free.
//
// Dual-context: a CommonJS module in the tests; in the webview a concatenated <script> after
// graph-styles.js and screens.js (scripts/build-config-page.js APP_FILES) and ahead of
// forecast-hints.js, which reads its limit, and screens-page.js, which reads its labels.
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
    // The page-only items (schema.js): the card's pick, Rename's field, New style's picker and
    // the screen editor's picker.
    var PICK = 'graphStylePick';
    var NAME = 'graphStyleName';
    var NEW_FROM = 'graphStyleNewFrom';
    var SCREEN_PICK = 'screenGraphStyle';
    // The pane the card and the swap belong to.
    var TAB = 'graphs';
    var PANE = 'forecast';
    var LIMIT = 'Your graph styles already draw 4 lines and stripes.';
    var COPY = 'copy';
    var NAME_MAX = 24;

    // The page's live state (onReady) and the card's Undo toast.
    var UI = { ctx: null, toast: null, timer: null, screenSlot: 0 };

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
     * A style as its pickers list it: its name and length, "Weathergraph · 66 h".
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
     * The screens whose forecast graph draws a style, as the Watchface tab lists them (a
     * screen on a style that does not exist draws the first).
     * @param {Object} S Settings.
     * @param {?Object} env Platform env.
     * @param {number} k A style index.
     * @returns {string[]} the screens' names
     */
    function screensOn(S, env, k) {
        var out = [];
        M.screensOf(S, env).forEach(function (list, i) {
            var fc = list[M.idxOf(list, 'fc')];
            var on = fc ? (parseInt(fc.style, 10) || 1) - 1 : -1;
            if (on > 0 && !GS.exists(S, on)) { on = 0; }
            if (on === k) { out.push(M.NAMES[i]); }
        });
        return out;
    }

    /**
     * Where a style shows, for its option's second line: "On Default and Flick 1".
     * @param {Object} S Settings.
     * @param {?Object} env Platform env.
     * @param {number} k A style index.
     * @returns {string}
     */
    function whereText(S, env, k) {
        var names = screensOn(S, env, k);
        if (!names.length) { return 'On no screen'; }
        return 'On ' + (names.length > 1 ? names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1] : names[0]);
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
     * Would screen i drawing style k make the shown styles draw a fifth series?
     * @param {Object} S Settings.
     * @param {?Object} env Platform env.
     * @param {number} i View slot.
     * @param {number} k A style index.
     * @returns {boolean}
     */
    function screenOverflows(S, env, i, k) {
        var N = Object.assign({}, normalize(S));
        N['viewStyle' + i] = String(k + 1);
        return overflows(N, env, GS.stylesShown(N, env), -1, null);
    }

    /**
     * Get the screen editor's Graph style picker ready for screen i (screens-page.js opens it
     * next): its value the screen's style, its limit worked out for that screen.
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
     * The styles as the pickers list them (options resolver 'graphStyleOptions'): each named
     * with its length, where it shows under it. With args.screen (the screen editor's picker,
     * for the screen beginScreenPick named) a style that would make the screens draw a fifth
     * series is disabled with LIMIT.
     * @param {Object} S Settings.
     * @param {?Object} env Platform env.
     * @param {{screen: boolean}} [args] The picker.
     * @returns {Array} [label, value, {desc, disabled}] per style
     */
    function styleOptions(S, env, args) {
        var a = args || {}, cur = S ? S[a.screen ? SCREEN_PICK : PICK] : null;
        return existing(S || {}).map(function (k) {
            var v = String(k + 1), meta = { desc: whereText(S, env, k) };
            if (a.screen && v !== cur && screenOverflows(S, env, UI.screenSlot, k)) {
                meta = { desc: LIMIT, disabled: true };
            }
            return [label(S, env, k), v, meta];
        });
    }

    /**
     * The card's hint: where the picked style shows, and what the card does.
     * @param {Object} S Settings.
     * @param {?Object} env Platform env.
     * @returns {string}
     */
    function cardHint(S, env) {
        var k = pickIndex(S);
        if (GS.count(S) < 2) { return whereText(S, env, k) + '. New style gives a screen its own graph.'; }
        return whereText(S, env, k) + '. The settings below are this style\'s.';
    }

    /**
     * The tail on every row of a key the styles share (hint resolver 'graphStyleShared',
     * schema.js hintTailFrom): said while more than one style exists.
     * @param {Object} S Settings.
     * @param {?Object} env Platform env.
     * @returns {string}
     */
    function sharedHint(S, env) {
        return (on(env) && GS.count(S) > 1) ? 'Every graph style shares this.' : '';
    }

    /**
     * The card's pick as the page opens (display resolver 'graphStyleOnOpen', initFrom): the
     * style of the first screen with a forecast graph, else the first.
     * @param {Object} S Settings.
     * @param {?Object} env Platform env.
     * @returns {string} '1' | '2' | '3'
     */
    function pickOnOpen(S, env) {
        if (!on(env)) { return '1'; }
        var lists = M.screensOf(S, env);
        for (var i = 0; i < lists.length; i++) {
            var fc = lists[i][M.idxOf(lists[i], 'fc')];
            if (fc) { return GS.exists(S, (parseInt(fc.style, 10) || 1) - 1) ? String(parseInt(fc.style, 10) || 1) : '1'; }
        }
        return '1';
    }

    // ── New style, Rename, Delete ────────────────────────────────────────────

    /**
     * The setup wizard's forecast looks (settings/wizard-forecast.js), read when asked: it loads
     * after this file in the page.
     * @returns {Object}
     */
    function forecastLooks() {
        return node ? require('./wizard-forecast.js') : window.WizardForecast;
    }

    /**
     * New style's "Start from" (options resolver 'graphStyleStarts'): the forecast looks, then a
     * copy of the style the card shows.
     * @param {Object} S Settings.
     * @param {?Object} env Platform env.
     * @returns {Array} [label, value, {desc}]
     */
    function startOptions(S, env) {
        var WF = forecastLooks();
        var out = WF.LOOKS.map(function (look) { return [look.label, look.id, { desc: WF.describe(look.id, env) }]; });
        out.push(['Copy of ' + GS.name(S, pickIndex(S)), COPY, { desc: 'Its lines, colors and length.' }]);
        return out;
    }

    /**
     * A name no other style has: `base`, else "base 2", "base 3".
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
     * Make a new style from a look or as a copy of the picked one (New style's onChange
     * 'graphStyleCreate'), pick it, and clear the picker. A look starts from the graph's
     * defaults as the theme starts them, with the look's own values and length over them;
     * the copy from the picked style's values. Mutates S.
     * @param {Object} S Settings (S[NEW_FROM] picked).
     * @param {*} oldValue The picker's value before.
     * @param {string} from A look's id, or 'copy'.
     * @param {?Object} env Platform env.
     * @returns {void}
     */
    function createStyle(S, oldValue, from, env) {
        S[NEW_FROM] = '';
        settle(S);
        var k = GS.freeSlot(S);
        if (k < 0 || !from) { return; }
        var values, title;
        if (from === COPY) {
            values = GS.valuesOf(S, pickIndex(S));
            title = GS.name(S, pickIndex(S));
        } else {
            var WF = forecastLooks();
            var look = null;
            WF.LOOKS.forEach(function (l) { if (l.id === from) { look = l; } });
            if (!look) { return; }
            var defaults = (UI.ctx && PConf && PConf.engine && PConf.engine.themedDefaults)
                ? PConf.engine.themedDefaults(UI.ctx.schema, S, env) : S;
            values = GS.valuesOf(defaults, 0);
            var rec = WF.looks(S, env, defaults, null).filter(function (r) { return r.id === from; })[0];
            Object.assign(values, rec ? rec.values : {}, { forecastHours: rec ? rec.span : values.forecastHours });
            title = look.label;
        }
        S.graphStyles = GS.withStyle(S, k, values);
        S.graphStyles = GS.withName(S, k, freeName(S, title));
        S[PICK] = String(k + 1);
    }

    /**
     * Rename's field committed (onChange 'graphStyleRenamed'): the picked style's name, '' for
     * the default one. Written into the item as stored, so the swap keeps it.
     * @param {Object} S Settings.
     * @param {*} oldValue The name before.
     * @param {string} value The name typed.
     * @returns {void}
     */
    function renameStyle(S, oldValue, value) {
        var k = pickIndex(S), name = String(value || '').replace(/^\s+|\s+$/g, '').slice(0, NAME_MAX);
        S.graphStyles = GS.withName(S, k, name === 'Graph style ' + (k + 1) ? '' : name);
    }

    /**
     * Delete the picked style (the card's Delete): the screens on it draw the first style, the
     * card picks the first, and an Undo shows for five seconds. Never the first style.
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
     * Undo a delete: the style back in its slot, with its name, on the screens that drew it,
     * and picked. Only that style's slot and those screens move.
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

    var CSS = '.gs-acts{display:flex;flex-wrap:wrap;gap:6px 18px;align-items:center}'
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
     * The card's buttons (block 'graphStyleActions'): Rename, New style while fewer than three
     * styles exist, Delete on a style but the first; the Undo after a delete.
     * @param {Object} S Settings.
     * @param {?Object} env Platform env.
     * @returns {string} HTML ('' where the watch has no styles)
     */
    function actionsBlock(S, env) {
        if (!on(env) || !S) { return ''; }
        ensureStyle();
        var k = pickIndex(S);
        var h = '<div class="gs-acts">'
            + '<button type="button" class="gs-act" data-edit-sheet="graphStyleRename">Rename</button>'
            + (GS.freeSlot(S) >= 0 ? '<button type="button" class="gs-act" data-select="' + NEW_FROM + '">New style</button>' : '')
            + (k > 0 ? '<button type="button" class="gs-act" data-action="deleteGraphStyle">Delete</button>' : '')
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
        if (PConf.blocks) { PConf.blocks.register('graphStyleActions', actionsBlock); }
        if (PConf.optionsResolvers) {
            PConf.optionsResolvers.register('graphStyleOptions', styleOptions);
            PConf.optionsResolvers.register('graphStyleStarts', startOptions);
        }
        if (PConf.hintResolvers) {
            PConf.hintResolvers.register('graphStyleHint', cardHint);
            PConf.hintResolvers.register('graphStyleShared', sharedHint);
        }
        if (PConf.displayResolvers) { PConf.displayResolvers.register('graphStyleOnOpen', pickOnOpen); }
        if (PConf.onChange) {
            PConf.onChange.register('graphStyleCreate', createStyle);
            PConf.onChange.register('graphStyleRenamed', renameStyle);
        }
        PConf.actions = PConf.actions || {};
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
        editing: editing,
        normalize: normalize,
        settle: settle,
        swapIn: swapIn,
        pickIndex: pickIndex,
        onRender: onRender,
        styleSettings: styleSettings,
        screenSettings: screenSettings,
        label: label,
        screensOn: screensOn,
        whereText: whereText,
        limitOptions: limitOptions,
        screenOverflows: screenOverflows,
        beginScreenPick: beginScreenPick,
        styleOptions: styleOptions,
        cardHint: cardHint,
        sharedHint: sharedHint,
        pickOnOpen: pickOnOpen,
        startOptions: startOptions,
        createStyle: createStyle,
        renameStyle: renameStyle,
        deletePicked: deletePicked,
        undoDelete: undoDelete,
        actionsBlock: actionsBlock,
        _test: { UI: UI }
    };
    if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
    if (typeof window !== 'undefined') { window.GraphStylesPage = api; }
})();
