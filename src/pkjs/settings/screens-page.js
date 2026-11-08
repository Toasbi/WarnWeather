// src/pkjs/settings/screens-page.js — ES5, WebView (+ Node for tests). The Watchface tab's
// screens: the Screens card (one row per screen by its name, dragged by its ≡ or moved with the
// arrow keys, the top one the Default; a ✕ with Undo on each other; "+ Add screen"), the Add a
// screen sheet (Blank, then the presets this watch can draw: screen-presets.js), the screen
// editor (a full-screen sheet: the screen's name, which a tap renames, its picture and its rows
// top to bottom, dragged or moved, each with its option, "+ Add" at the natural place), Setup's
// Rain radar picker (Off keeps the source) and the modes the page works out from the screens.
//
// The screens are read from and written to the custom layout's per-view keys (screens.js
// screensOf / compileKeys), one screen at a time, so a screen the user does not touch keeps
// its keys byte for byte. A preset install (one the 2.6 migration could not move: its watch
// did not say what it is) turns custom at its first screen edit, through its own cycle's keys
// (view-cycle.js specToKeys), so nothing on it moves either. Every edit lands through
// editScreens: a bar it brings onto the screens with nothing to show (every slot Empty) takes
// its default slots there.
// radarMode and healthMode follow every edit and every Save (screens.js deriveModes), so each
// reader of them stays as it is; what reads them between Saves, where a tick on the Alerts
// tab can have moved them, reads the ones Save will store (radarModeToSave).
// aplite has no screens: its Watchface tab keeps a plain Layout choice.
/* global PConf */
var PConf = (typeof global !== 'undefined' && global.PConf) ? global.PConf
    : (typeof window !== 'undefined' && window.PConf) ? window.PConf
    : (typeof PConf !== 'undefined' && PConf) ? PConf
    : null;
(function () {
    'use strict';
    var VC = (typeof require !== 'undefined') ? require('../view-cycle.js') : window.VIEW_CYCLE;
    var M = (typeof require !== 'undefined') ? require('../screens.js') : window.Screens;
    var PW = (typeof require !== 'undefined') ? require('./preview-watch.js') : window.PreviewWatch;
    var PSB = (typeof require !== 'undefined')
        ? require('./preview-status-bars.js') : window.PreviewStatusBars;
    var catalog = (typeof require !== 'undefined')
        ? require('../status-line-catalog.js') : window.StatusLineCatalog;
    var onDemand = (typeof require !== 'undefined') ? require('../on-demand.js') : window.OnDemand;
    // Graph styles (Pebble Time 2): the forecast row's graph card and its picker
    // (graph-styles-page.js the options, pictures, labels, limit and writes; graph-styles.js the
    // model).
    var GSP = (typeof require !== 'undefined') ? require('./graph-styles-page.js') : window.GraphStylesPage;
    var GS = (typeof require !== 'undefined') ? require('../graph-styles.js') : window.GraphStyles;
    // The screens Add screen offers after Blank.
    var PRESETS = (typeof require !== 'undefined') ? require('../screen-presets.js') : window.ScreenPresets;
    // The page's one escape helper (config-ui/lib/html.js, concatenated ahead of every app file).
    var esc = (typeof require !== 'undefined') ? require('../config-ui/lib/html.js').esc : PConf.html.esc;

    // The places' names, the Default first (a screen's own name: screens.js nameOf).
    var NAMES = M.NAMES;
    // A new screen: the Watch bar and the Clock (Add a screen's Blank).
    var NEW_SCREEN = PRESETS.BLANK;
    var BLANK = 'blank';
    // The per-view keys a screen owns (custom-layout-schema.js customViewItems): a moved, deleted
    // or restored screen takes all of them along, its graph style (viewStyle) and name too.
    var VIEW_STEMS = ['Top', 'Body', 'Upper', 'Lower', 'Order', 'TopSize', 'BodySize', 'Align', 'ClockOff', 'StripOff',
        'Style', 'Name'];
    var TOO_TALL = 'Too tall for the watch. Remove a row or make a graph smaller.';
    var NOTHING_YET = 'Nothing on this screen yet, so the watch skips it.';
    var RADAR_OFF = 'The rain radar is off.';
    // Why a move snaps back: the top screen always shows the clock (the watch keeps it).
    var NO_ROOM_FOR_CLOCK = ' has no room for the clock, which the top screen always shows.';
    // Why Add a screen greys out a preset.
    var ALREADY = 'Already one of yours.';
    var NO_GRAPH_ROOM = 'No room for its graph: you have 3 graphs. Delete one on the Graphs tab.';
    var REORDER_HINT = 'Drag ≡ to reorder. The top screen is the Default.';
    // The editor's bar picker (custom-layout-schema.js: a page-only select) and the tab a bar is
    // edited on (the Status bars tab's id).
    var SCREEN_BAR = 'screenBar';
    var STATUS_TAB = 'watch';
    // What a preset brings, under Add a screen's cards: with graph styles, and on a watch with
    // one graph (screen-presets.js WHAT A PRESET BRINGS).
    var ADD_FINE = 'A preset brings its graph, or uses one of yours that matches. Your bars keep their slots.';
    var ADD_FINE_ONE_GRAPH = 'A preset brings its rows. Your graph and your bars stay as they are.';
    // aplite's Layout choice, its Watchface tab having no screens: the three calendars.
    var APLITE_LAYOUTS = [['Full calendar', 'fullCal'], ['Compact calendar', 'compactCal'], ['No calendar', 'noCal']];

    /**
     * Whether this watch has screens to edit: every watch but aplite (and an unknown one).
     * @param {?Object} env Platform env.
     * @returns {boolean}
     */
    function hasScreens(env) {
        return !(env && env.platform === 'aplite');
    }

    /**
     * Turn a preset into the custom keys of its own cycle (view-cycle.js specToKeys, which
     * compiles back byte for byte), so a first edit moves nothing on the other screens.
     * Mutates S; a custom layout is left as it is.
     * @param {Object} S Settings.
     * @param {?Object} env Platform env.
     * @returns {void}
     */
    function ensureCustom(S, env) {
        if (S.layoutPreset === 'custom') { return; }
        Object.assign(S, VC.specToKeys(VC.resolveViewCycle(S, env)));
        S.layoutPreset = 'custom';
        S.customLayoutSeeded = true;
    }

    /**
     * Write the modes the screens need (screens.js deriveModes) into S. A preset's screens
     * follow its modes, so on a watch known to have screens it turns custom first
     * (ensureCustom): a mode worked out from them can then never drop one (the radar turned
     * off, then on again, keeps its screen). A watch that did not say what it is keeps its
     * preset here, as the 2.6 migration does: it might be an aplite, which folds a custom
     * layout to Compact calendar. Only a screen edit makes it custom there (editScreens).
     * aplite keeps its own modes (its page sets both off as it opens, onbuild.js).
     * @param {Object} S Settings.
     * @param {?Object} env Platform env.
     * @returns {void}
     */
    function applyModes(S, env) {
        if (!hasScreens(env)) { return; }
        if (env && env.platform) { ensureCustom(S, env); }
        var m = M.deriveModes(S, env);
        S.radarMode = m.radarMode;
        S.healthMode = m.healthMode;
    }

    /**
     * Give a bar that has just come onto a screen its default slots (status-line-catalog.js
     * slotDefault, the ones a new install has) when it would show nothing: every slot Empty, or
     * an item this watch cannot show, as the screen's picture reads it (preview-status-bars.js
     * barCodes, the slots without their sample text). A bar never set up can be stored that way:
     * the 2.6 move stored a health item as Empty where health was off. A bar with a reading of
     * its own, or one a screen showed already, keeps its slots. Mutates S.
     * @param {Object} S Settings.
     * @param {{top: boolean, forecast: boolean, radar: boolean, health: boolean}} before
     *   view-cycle.js barsShown() before the change.
     * @param {?Object} env Platform env.
     * @returns {void}
     */
    function fillNewBars(S, before, env) {
        var now = VC.barsShown(S, env);
        Object.keys(now).forEach(function (bar) {
            if (!now[bar] || before[bar]) { return; }
            var slots = PSB.barCodes(S, env, bar);
            var blank = slots.every(function (c) { return c.code === 'empty'; });
            if (blank) { slots.forEach(function (c) { S[c.key] = catalog.slotDefault(c.key, env); }); }
        });
    }

    /**
     * Make one screen edit, the way every one lands: a preset turns custom first
     * (ensureCustom), so the edit changes the very keys the watch runs; then a bar the edit
     * brings onto the screens with nothing to show takes its default slots (fillNewBars), and
     * the modes follow the screens (applyModes). Mutates S.
     * @param {Object} S Settings.
     * @param {?Object} env Platform env.
     * @param {function(): boolean} edit Writes the per-view keys; false when it declines
     *   (writing nothing).
     * @returns {boolean} whether the edit was made
     */
    function editScreens(S, env, edit) {
        ensureCustom(S, env);
        var before = VC.barsShown(S, env);
        if (!edit()) { return false; }
        fillNewBars(S, before, env);
        applyModes(S, env);
        return true;
    }

    /**
     * Write one screen's per-view keys into its slot, the screen count growing to hold it.
     * Mutates S.
     * @param {Object} S Settings.
     * @param {number} i View slot.
     * @param {Array<Object>} list The screen.
     * @returns {void}
     */
    function putScreen(S, i, list) {
        Object.assign(S, M.compileKeys(list, i));
        if ((parseInt(S.viewCount, 10) || 1) < i + 1) { S.viewCount = String(i + 1); }
    }

    /**
     * Store one screen (a screen edit: editScreens). Mutates S.
     * @param {Object} S Settings.
     * @param {number} i View slot.
     * @param {Array<Object>} list The screen.
     * @param {?Object} env Platform env.
     * @returns {void}
     */
    function writeScreen(S, i, list, env) {
        editScreens(S, env, function () { putScreen(S, i, list); return true; });
    }

    /**
     * The view keys of every slot and the screen count, for Undo.
     * @param {Object} S Settings.
     * @returns {Object} key -> value
     */
    function snapshot(S) {
        var out = { viewCount: S.viewCount, layoutPreset: S.layoutPreset, customLayoutSeeded: S.customLayoutSeeded };
        for (var i = 0; i < M.MAX_SCREENS; i++) {
            for (var s = 0; s < VIEW_STEMS.length; s++) {
                var key = 'view' + VIEW_STEMS[s] + i;
                if (Object.prototype.hasOwnProperty.call(S, key)) { out[key] = S[key]; }
            }
        }
        return out;
    }

    /**
     * Put a snapshot back. Mutates S.
     * @param {Object} S Settings.
     * @param {Object} snap snapshot().
     * @param {?Object} env Platform env.
     * @returns {void}
     */
    function restore(S, snap, env) {
        Object.assign(S, snap);
        applyModes(S, env);
    }

    /**
     * Copy one slot's view keys onto another (a screen moving a slot up or down). Mutates S.
     * @param {Object} S Settings.
     * @param {number} from The slot copied.
     * @param {number} to The slot written.
     * @returns {void}
     */
    function copyView(S, from, to) {
        for (var s = 0; s < VIEW_STEMS.length; s++) {
            S['view' + VIEW_STEMS[s] + to] = S['view' + VIEW_STEMS[s] + from];
        }
    }

    /**
     * Delete a flick screen: the screens after it move up a slot, keys and all. Mutates S.
     * @param {Object} S Settings.
     * @param {number} i View slot (1 or 2).
     * @param {?Object} env Platform env.
     * @returns {boolean} whether a screen went
     */
    function deleteScreen(S, i, env) {
        return editScreens(S, env, function () {
            var n = parseInt(S.viewCount, 10) || 1;
            if (i < 1 || i >= n) { return false; }
            for (var j = i; j < n - 1; j++) { copyView(S, j + 1, j); }
            S.viewCount = String(n - 1);
            return true;
        });
    }

    /**
     * Delete a flick screen and offer its Undo (the Screens card's ✕, the editor's Delete
     * screen). A preset turns custom first, so the Undo's snapshot holds the very keys the
     * delete shifts, and putting it back cannot lose a screen to the modes it changed.
     * Mutates S.
     * @param {Object} S Settings.
     * @param {number} i View slot (1 or 2).
     * @param {?Object} env Platform env.
     * @returns {boolean} whether a screen went
     */
    function deleteWithUndo(S, i, env) {
        ensureCustom(S, env);
        var snap = snapshot(S), name = M.nameOf(S, i);
        if (!deleteScreen(S, i, env)) { return false; }
        showToast(name + ' deleted.', snap);
        return true;
    }

    /**
     * Put a new screen in at a slot: the screens from that slot on move down one, keys and
     * all, and the new one starts at the default position with its place's name (a list has
     * neither, compileKeys leaves viewAlign as stored, and a slot a deleted screen left can
     * still hold its). Mutates S.
     * @param {Object} S Settings.
     * @param {number} at View slot (1 or 2).
     * @param {Array<Object>} list The screen.
     * @param {?Object} env Platform env.
     * @returns {boolean} whether it went in (no fourth screen, never before the Default)
     */
    function insertScreen(S, at, list, env) {
        return editScreens(S, env, function () {
            var n = parseInt(S.viewCount, 10) || 1;
            if (n >= M.MAX_SCREENS || at < 1 || at > n) { return false; }
            for (var j = n; j > at; j--) { copyView(S, j - 1, j); }
            S['viewAlign' + at] = 'clock';
            S['viewName' + at] = '';
            S.viewCount = String(n + 1);
            putScreen(S, at, list);
            return true;
        });
    }

    /**
     * Add a screen (the Watch bar and the Clock) after the others. Mutates S.
     * @param {Object} S Settings.
     * @param {?Object} env Platform env.
     * @returns {number} its slot, or -1 with three screens already
     */
    function addScreen(S, env) {
        var n = M.screensOf(S, env).length;
        return insertScreen(S, n, M.copy(NEW_SCREEN), env) ? n : -1;
    }

    /**
     * Set the stored per-view keys of a slot (viewKeys' shape): a key a screen never had stays
     * absent. Mutates S.
     * @param {Object} S Settings.
     * @param {number} i View slot.
     * @param {Object<string, *>} keys Stem -> value.
     * @returns {void}
     */
    function setViewKeys(S, i, keys) {
        VIEW_STEMS.forEach(function (stem) {
            var key = 'view' + stem + i;
            if (keys[stem] === undefined) { delete S[key]; } else { S[key] = keys[stem]; }
        });
    }

    /**
     * The stored per-view keys of a slot, by stem.
     * @param {Object} S Settings.
     * @param {number} i View slot.
     * @returns {Object<string, *>}
     */
    function viewKeys(S, i) {
        var out = {};
        VIEW_STEMS.forEach(function (stem) { out[stem] = S['view' + stem + i]; });
        return out;
    }

    /**
     * Move a screen to another place (the Screens card's drag and arrow keys): the screens in
     * between shift a place, keys and all, their names and graphs too. The top screen is the
     * Default, which always shows the clock (the watch keeps it): a screen moved there without
     * one gets it, and one with no room for it stays where it was. The Default has no
     * viewClockOff, so the screen that leaves the top shows the clock it had. Mutates S.
     * @param {Object} S Settings.
     * @param {number} from The screen's place.
     * @param {number} to Its new place.
     * @param {?Object} env Platform env.
     * @returns {string} '' when it moved (or had nowhere to go), else why it stayed
     */
    function moveScreen(S, from, to, env) {
        var why = '';
        editScreens(S, env, function () {
            var lists = M.screensOf(S, env), n = lists.length, order = [], x;
            if (from === to || from < 0 || to < 0 || from >= n || to >= n) { return false; }
            for (x = 0; x < n; x++) { order.push(x); }
            order.splice(to, 0, order.splice(from, 1)[0]);
            var top = lists[order[0]], clock = M.idxOf(top, 'clock') < 0;
            if (clock) {
                top = M.add(top, 'clock');
                if (!fitsWatch(top, 0, env)) { why = M.nameOf(S, order[0]) + NO_ROOM_FOR_CLOCK; return false; }
            }
            var keys = order.map(function (o) { return viewKeys(S, o); });
            keys.forEach(function (k, slot) {
                k.ClockOff = slot > 0 ? Boolean(k.ClockOff) : undefined;
                setViewKeys(S, slot, k);
            });
            if (clock) { putScreen(S, 0, top); }
            return true;
        });
        return why;
    }

    /**
     * Name a screen (the editor's title): '' for its place's name. Mutates S.
     * @param {Object} S Settings.
     * @param {number} i View slot.
     * @param {*} text The name typed.
     * @returns {void}
     */
    function renameScreen(S, i, text) {
        var name = M.cleanName(text);
        S['viewName' + i] = name === NAMES[i] ? '' : name;
    }

    /**
     * Do two screens show the same rows (their graphs aside)?
     * @param {Array<Object>} a A screen.
     * @param {Array<Object>} b Another.
     * @returns {boolean}
     */
    function sameRows(a, b) {
        /** @param {Array<Object>} l @returns {string} each row's kind, rows and size */
        function bare(l) {
            return l.map(function (x) { return x.k + ':' + (x.rows || '') + ':' + (x.size || ''); }).join('|');
        }
        return bare(a) === bare(b);
    }

    /**
     * One of Add a screen's choices: Blank (preset null) or a preset, as the screen it adds
     * after the others. On a watch with graph styles a forecast preset brings its graph
     * (graph-styles-page.js presetGraph: yours that reads as its template, else a new one).
     * `W` is the settings with it added, which its picture draws; `why` greys it out: it is one
     * of your screens already (its rows, and its graph where it brings one), no graph slot is
     * free, or its graph would make more lines and stripes than the watch shows.
     * @param {Object} N Settings as stored (graph-styles-page.js asStored).
     * @param {?Object} env Platform env.
     * @param {Array<Array<Object>>} lists The screens.
     * @param {?Object} p A screen-presets.js entry, or null for Blank.
     * @returns {{id: string, name: string, desc: string, look: ?string, list: Array<Object>,
     *   graph: ?{k: number, values: ?Object}, W: Object, n: number, why: string}}
     */
    function addChoice(N, env, lists, p) {
        var n = lists.length, list = M.copy(p ? p.list : NEW_SCREEN), why = '';
        var graph = p && p.look && env && env.graphStyles ? GSP.presetGraph(N, env, p.look) : null;
        if (graph && graph.k > 0) { list[M.idxOf(list, 'fc')].style = String(graph.k + 1); }
        var W = Object.assign({}, N);
        if (graph && graph.values) { W.graphStyles = GS.withStyle(W, graph.k, graph.values); }
        ensureCustom(W, env);
        putScreen(W, n, list);
        W['viewAlign' + n] = 'clock';
        W['viewName' + n] = p ? p.name : '';
        if (p) {
            // With graph styles a forecast preset is its rows and its graph: a screen of yours is
            // it only when it draws that graph, one of yours already.
            var styled = Boolean(p.look && env && env.graphStyles);
            var mine = lists.some(function (l) {
                return sameRows(l, list) && (!styled
                    || Boolean(graph && !graph.values && GSP.drawnBy(N, l[M.idxOf(l, 'fc')]) === graph.k));
            });
            if (mine) { why = ALREADY; } else if (styled && !graph) { why = NO_GRAPH_ROOM; } else if (graph
                && GSP.screenOverflows(W, env, n, graph.k, null)) { why = GSP.limitDesc(W, env, graph.k); }
        }
        return { id: p ? p.id : BLANK, name: p ? p.name : 'Blank', desc: p ? PRESETS.describe(p, env)
            : 'Watch bar and clock. You add the rest.', look: p ? p.look : null, list: list, graph: graph, W: W, n: n, why: why };
    }

    /**
     * Add a screen's choices: Blank, then the presets this watch can draw (screen-presets.js
     * offered; each fits every watch it is offered as a flick screen,
     * test/config-screen-presets.test.js), each as addChoice reads it. None with three screens
     * already.
     * @param {Object} S Settings.
     * @param {?Object} env Platform env.
     * @returns {Array<Object>}
     */
    function addChoices(S, env) {
        var N = GSP.asStored(S), lists = M.screensOf(N, env);
        if (lists.length >= M.MAX_SCREENS) { return []; }
        return [addChoice(N, env, lists, null)].concat(PRESETS.offered(env).map(function (p) {
            return addChoice(N, env, lists, p);
        }));
    }

    /**
     * Add the screen a choice stands for, after the others: its graph made first when it brings
     * a new one (and picked on the Graphs tab, as the editor's picker picks a new graph), the
     * screen named after its preset. Mutates S.
     * @param {Object} S Settings.
     * @param {?Object} env Platform env.
     * @param {string} id 'blank' or a preset's id.
     * @returns {number} the new screen's slot, -1 for none (no room, greyed out, no such choice)
     */
    function addChosen(S, env, id) {
        var c = addChoices(S, env).filter(function (x) { return x.id === id; })[0];
        if (!c || c.why || c.n >= M.MAX_SCREENS) { return -1; }
        var list = M.copy(c.list);
        if (c.graph && c.graph.values) {
            var k = GSP.createGraph(S, c.look, env), j = M.idxOf(list, 'fc');
            if (k < 0) { return -1; }
            if (k > 0) { list[j].style = String(k + 1); } else { delete list[j].style; }
            S[GSP.PICK] = String(k + 1);
        }
        if (!insertScreen(S, c.n, list, env)) { return -1; }
        S['viewName' + c.n] = id === BLANK ? '' : c.name;
        return c.n;
    }

    /**
     * A screen's rows in a line, for its row on the Screens card: what it shows, a bar by its
     * name (screens.js blockName), the Watch bar left out (most screens keep it).
     * @param {Array<Object>} list The screen.
     * @param {Object} S Settings.
     * @returns {string}
     */
    function contents(list, S) {
        var names = list.filter(function (b) { return b.k !== 'strip'; }).map(function (b) {
            return M.blockName(b, S) + (b.k === 'radar' && S.radarEnabled === false ? ' (off)' : '');
        });
        return names.length ? names.join(' · ') : 'Nothing yet';
    }

    /**
     * The view as the watch draws it now: with the rain radar off, the radar graph folds as
     * it does without radar data (the forecast or the calendar in its place) and the bars
     * stay (view-cycle.js resolveForFit).
     * @param {?Object} spec The compiled view.
     * @param {Object} S Settings.
     * @returns {?Object}
     */
    function drawnView(spec, S) {
        if (!spec || S.radarEnabled !== false) { return spec; }
        return VC.resolveForFit(spec, false, true);
    }

    /**
     * A screen's picture as the watch draws it now (drawnView), or its bare screen ("Nothing
     * to show") when nothing is on it: the editor's, and the setup's Screens and Forecast steps'.
     * @param {Object} S Settings.
     * @param {number} i View slot.
     * @param {?Object} env Platform env.
     * @param {Object} [userData] Page userData (the palette).
     * @param {string} prefix What its graphs' ids start with, unique on the page.
     * @param {Array<?Object>} [cycle] VC.screensCycle(S, env), when the caller has it already.
     * @returns {{svg: string, label: string}}
     */
    function screenPicture(S, i, env, userData, prefix, cycle) {
        var spec = (cycle || VC.screensCycle(S, env))[i] || null;
        if (!spec) { return PW.viewScreen(S, env, i, userData); }
        return PW.screenSvg(drawnView(spec, S), i, S, env, userData || {}, env && env.platform === 'emery' ? 1 : 0,
            new Date(), prefix);
    }

    /**
     * Does a screen fit the watch it is edited for?
     * @param {Array<Object>} list The screen.
     * @param {number} i View slot.
     * @param {?Object} env Platform env.
     * @returns {boolean}
     */
    function fitsWatch(list, i, env) {
        return M.fits(list, i, (env && env.platform) || '');
    }

    // ── Your bars (screens.js THE NAMES) ───────────────────────────────────

    /**
     * The places of the screens that show a status bar.
     * @param {Object} S Settings.
     * @param {?Object} env Platform env.
     * @param {string} bar An on-demand.js BARS bar.
     * @returns {number[]}
     */
    function barPlaces(S, env, bar) {
        var out = [];
        M.screensOf(S, env).forEach(function (list, i) {
            if (list.some(function (b) { return M.BAR_OF_KIND[b.k] === bar; })) { out.push(i); }
        });
        return out;
    }

    /**
     * Where a bar shows, by the screens' names: "On Default and Steps", "On no screen" (its
     * Name row's hint on the Status bars tab, its option in the editor's picker).
     * @param {Object} S Settings.
     * @param {?Object} env Platform env.
     * @param {string} bar An on-demand.js BARS bar.
     * @returns {string}
     */
    function barWhere(S, env, bar) {
        var names = barPlaces(S || {}, env, bar).map(function (i) { return M.nameOf(S, i); });
        return names.length ? 'On ' + GSP.andList(names) : 'On no screen';
    }

    /**
     * What a bar holds, by its slots' items (preview-status-bars.js barCodes, as its picture
     * reads them), the empty ones left out: "Temperature/feels like · City · Air quality (AQI)".
     * @param {Object} S Settings.
     * @param {?Object} env Platform env.
     * @param {string} bar An on-demand.js BARS bar.
     * @returns {string}
     */
    function barHolds(S, env, bar) {
        var labels = PSB.barCodes(S || {}, env, bar).filter(function (c) { return c.code !== 'empty'; })
            .map(function (c) { return (catalog.byCode(c.code) || {}).label || c.code; });
        return labels.length ? labels.join(' · ') : 'Nothing in it yet';
    }

    /**
     * The bars this watch draws, in the Status bars tab's order (on-demand.js PAGE_BARS, the
     * Watch bar left out), as their rows' kinds.
     * @param {?Object} env Platform env.
     * @returns {string[]} 'fcbar' | 'healthbar' | 'radarbar'
     */
    function barKinds(env) {
        return onDemand.PAGE_BARS.map(function (b) { return M.KIND_OF_BAR[b.bar]; }).filter(function (k) {
            return Boolean(k) && M.capable(k, env);
        });
    }

    /**
     * The editor's bar picker (options resolver 'screenBarOptions'): your bars by name, each
     * with what it holds and where it shows; one the screen shows already (another row) is
     * greyed out.
     * @param {Object} S Settings.
     * @param {?Object} env Platform env.
     * @returns {Array} [label, kind, meta]
     */
    function barOptions(S, env) {
        var list = M.screensOf(S || {}, env)[ED.i] || [], cur = list[ED.barRow] || {};
        return barKinds(env).map(function (k) {
            var bar = M.BAR_OF_KIND[k], here = k !== cur.k && M.idxOf(list, k) >= 0;
            return [M.barName(S, bar), k, here ? { desc: 'Already on this screen', disabled: true }
                : { desc: barHolds(S, env, bar) + ' · ' + barWhere(S, env, bar).replace(/^On/, 'on') }];
        });
    }

    /**
     * The editor's bar pick (onChange 'screenBarPicked'): the row shows that bar instead, in
     * its place.
     * @param {Object} S Settings.
     * @param {*} oldValue The pick before.
     * @param {string} kind The bar's kind ('fcbar' | 'radarbar' | 'healthbar').
     * @param {?Object} env Platform env.
     * @returns {void}
     */
    function screenBarPicked(S, oldValue, kind, env) {
        if (!ED.overlay || !M.BAR_OF_KIND[kind]) { return; }
        var list = M.screensOf(S, env)[ED.i] || [], j = ED.barRow;
        if (!list[j] || !M.BAR_OF_KIND[list[j].k] || list[j].k === kind || M.idxOf(list, kind) >= 0) { return; }
        var next = M.copy(list);
        next[j] = { k: kind };
        writeScreen(S, ED.i, next, env);
    }

    // ── Icons ──────────────────────────────────────────────────

    /**
     * A line icon (the editor's and the card's).
     * @param {string} d Its SVG path.
     * @returns {string} SVG markup
     */
    function ic(d) { return '<svg class="scr-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="' + d + '"/></svg>'; }
    var I_X = ic('M6 6l12 12M18 6L6 18');
    var I_GRIP = ic('M5 8.5h14M5 12h14M5 15.5h14');
    var I_BACK = ic('M15 5l-7 7 7 7');
    var I_UP = ic('M12 19V5M6 11l6-6 6 6');
    var I_DOWN = ic('M12 5v14M6 13l6 6 6-6');
    var I_PEN = ic('M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4');

    var CSS = ''
        + '.scr-ic{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}'
        // The list bleeds over the .blockrow's padding (12px 16px 14px) so its rows are the
        // card's own rows: the text 16px in and the dividers edge to edge, like every card below.
        + '.scr-list{margin:-12px -16px -14px}'
        + '.scr-row{display:flex;align-items:stretch;border-bottom:1px solid var(--row-line)}'
        + '.scr-row:last-child{border-bottom:none}'
        + '.scr-main{flex:1;min-width:0;display:flex;align-items:center;gap:12px;padding:14px 8px 14px 16px;border:none;'
        + 'background:none;text-align:left;cursor:pointer;color:var(--lbl);font:inherit}'
        + '.scr-mid{flex:1;min-width:0;display:block}'
        + '.scr-t{display:block;font-size:14.5px;font-weight:700}'
        + '.scr-els{display:block;font-size:12px;color:var(--hint);line-height:1.4;margin-top:1px}'
        + '.scr-chev{flex:none;color:var(--faint);font-size:18px;line-height:1}'
        + '.scr-x,.scr-xpad{flex:none;width:46px}'
        + '.scr-x{display:flex;align-items:center;justify-content:center;border:none;border-left:1px solid var(--row-line);'
        + 'background:none;color:var(--muted);cursor:pointer}'
        + '.scr-add{display:block;width:100%;padding:14px 16px;border:none;background:none;text-align:left;color:var(--link);'
        + 'font:700 13.5px Inter,system-ui,sans-serif;cursor:pointer}'
        + '.scr-toast{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:0 16px 14px;'
        + 'background:var(--ctl);border-radius:10px;padding:9px 12px;font-size:12.5px;color:var(--lbl)}'
        + '.scr-undo{flex:none;border:none;background:none;padding:2px 4px;color:var(--link);font:800 12.5px Inter,system-ui,sans-serif;cursor:pointer}'
        // The card's ≡ (two screens or more): a row lifts and follows it, the others make room.
        + '.scr-row{position:relative;background:var(--card);transition:transform .16s ease}'
        + '.scr-row.lift{z-index:5;transition:none;background:var(--bg);border-radius:10px;'
        + 'box-shadow:0 12px 26px rgba(0,0,0,.3),0 0 0 1px var(--card-line)}'
        + '.scr-list.dragging{-webkit-user-select:none;user-select:none}'
        + '.scr-grip{flex:none;width:42px;display:flex;align-items:center;justify-content:center;margin:0;padding:0 0 0 4px;'
        + 'border:none;background:none;color:var(--faint);cursor:grab;touch-action:none;-webkit-appearance:none;appearance:none}'
        + '.scr-grip:focus-visible{outline:2px solid var(--link);outline-offset:-6px;border-radius:12px}'
        + '.scr-main.g{padding-left:0}'
        + '.scr-pill{display:inline-block;margin-left:8px;padding:2px 7px;border-radius:999px;background:var(--ctl);'
        + 'color:var(--muted);font:700 10.5px/1.3 Inter,system-ui,sans-serif;vertical-align:1px}'
        + '.scr-hint{padding:10px 16px 14px;font-size:12px;line-height:1.4;color:var(--hint)}'
        + '.scr-note{margin:0 16px 14px;border-left:3px solid var(--info-rule);background:var(--info-tint);border-radius:8px;'
        + 'padding:9px 11px;font-size:12.5px;line-height:1.45;color:var(--static)}'
        // The editor (a full-screen sheet, the wizard's pattern).
        + '#screenEditor{position:fixed;top:0;left:0;right:0;bottom:0;z-index:1000;display:flex;flex-direction:column;'
        + 'max-width:460px;margin:0 auto;background:var(--bg);color:var(--fg);font-family:Inter,system-ui,sans-serif}'
        + '#screenEditor .se-hdr{flex:none;display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:8px;padding:16px 14px 10px}'
        + '#screenEditor .se-back{justify-self:start;width:38px;height:38px;border-radius:11px;border:none;background:var(--ctl);'
        + 'color:var(--lbl);display:flex;align-items:center;justify-content:center;cursor:pointer}'
        + '#screenEditor .se-ttl{margin:0;min-width:0;font-size:17px;font-weight:800;text-align:center}'
        // The editor's title: the screen's name, a tap renames it.
        + '.se-name{display:inline-flex;align-items:center;gap:6px;max-width:100%;margin:0;padding:4px 6px;border:none;'
        + 'border-radius:8px;background:none;color:var(--fg);font:800 17px/1.25 Inter,system-ui,sans-serif;cursor:pointer}'
        + '.se-name span{overflow-wrap:anywhere}'
        + '.se-name .scr-ic{flex:none;width:15px;height:15px;color:var(--link)}'
        + '.se-name-in{box-sizing:border-box;width:12em;max-width:100%;margin:0;padding:6px 8px;border:1px solid var(--ctl-line);'
        + 'border-radius:8px;background:var(--bg);color:var(--fg);font:700 16px Inter,system-ui,sans-serif;text-align:center}'
        + '#screenEditor .se-done{justify-self:end}'
        + '#screenEditor .se-body{flex:1;min-height:0;overflow-y:auto;padding:4px 14px 28px;display:flex;flex-direction:column;gap:12px}'
        + '#screenEditor .se-body>*{flex:none}'
        + '.se-pic{display:flex;justify-content:center}'
        + '.se-pic-card{display:block;width:148px;border-radius:13px;overflow:hidden;line-height:0;'
        + 'box-shadow:0 8px 20px rgba(0,0,0,.28),0 0 0 1px var(--card-line)}'
        + '.se-pic-card svg{display:block;width:100%;height:auto}'
        + '.se-note{border-left:3px solid var(--info-rule);background:var(--info-tint);border-radius:8px;padding:9px 11px;'
        + 'font-size:12.5px;line-height:1.45;color:var(--static)}'
        + '.se-card{background:var(--card);border:1px solid var(--card-line);border-radius:16px;overflow:hidden}'
        + '.se-cardhd{padding:14px 16px 8px;font-size:11px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--ttl)}'
        + '.se-row{position:relative;display:grid;grid-template-columns:40px minmax(0,1fr) 44px;align-items:center;'
        + 'border-top:1px solid var(--row-line);background:var(--card);transition:transform .16s ease}'
        + '.se-row.lift{z-index:5;transition:none;background:var(--bg);border-radius:10px;'
        + 'box-shadow:0 12px 26px rgba(0,0,0,.3),0 0 0 1px var(--card-line)}'
        + '.se-list.dragging{-webkit-user-select:none;user-select:none}'
        + '.se-grip{align-self:stretch;display:flex;align-items:center;justify-content:center;color:var(--faint);cursor:grab;touch-action:none}'
        + '.se-grip.off{cursor:default}'
        + '.se-main{min-width:0;display:flex;align-items:baseline;justify-content:space-between;gap:8px;padding:13px 2px 13px 0;'
        + 'border:none;background:none;text-align:left;color:var(--lbl);font:600 14px Inter,system-ui,sans-serif;cursor:pointer}'
        + '.se-main.fixed{cursor:default}'
        + '.se-val{font-size:12px;font-weight:600;color:var(--muted);white-space:nowrap}'
        + '.se-x{width:44px;height:44px;display:flex;align-items:center;justify-content:center;border:none;background:none;'
        + 'color:var(--muted);cursor:pointer}'
        + '.se-x .scr-ic{width:16px;height:16px}'
        + '.se-sub{grid-column:1/-1;padding:0 14px 12px 40px}'
        + '.se-off{font-size:12.5px;color:var(--lbl);display:flex;flex-wrap:wrap;gap:4px 8px;align-items:baseline}'
        + '.se-link{border:none;background:none;padding:0;color:var(--link);font:700 12.5px Inter,system-ui,sans-serif;cursor:pointer}'
        + '.se-more{display:grid;gap:10px}'
        + '.se-opt{display:grid;gap:6px}'
        + '.se-cap{font-size:10.5px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--ttl)}'
        + '.se-opt .seg{display:flex}'
        + '.se-opt .seg button{flex:1 1 0}'
        + '.se-moves{display:flex;gap:8px}'
        + '.se-mv{flex:1 1 0;display:inline-flex;align-items:center;justify-content:center;gap:6px;border:1px solid var(--ctl-line);'
        + 'background:var(--bg);color:var(--lbl);border-radius:9px;padding:8px 6px;font:600 12px Inter,system-ui,sans-serif;cursor:pointer}'
        + '.se-mv .scr-ic{width:14px;height:14px}'
        // The forecast row's graph (a watch with graph styles): a card that names the graph and
        // opens its picker, under the row whether it is open or not (the watch above draws it).
        + '.se-graph{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:10px;width:100%;'
        + 'margin:0;padding:9px 10px 9px 12px;border:1px solid var(--ctl-line);border-radius:11px;background:var(--bg);'
        + 'color:var(--lbl);text-align:left;font:inherit;cursor:pointer;-webkit-appearance:none;appearance:none}'
        + '.se-gtxt{display:grid;gap:2px;min-width:0}'
        + '.se-gname{font:700 13.5px/1.3 Inter,system-ui,sans-serif;color:var(--lbl);overflow-wrap:anywhere}'
        + '.se-ghint{font:600 11.5px/1.35 Inter,system-ui,sans-serif;color:var(--link)}'
        + '.se-ghold{font:500 12px/1.35 Inter,system-ui,sans-serif;color:var(--hint)}'
        + '.se-graph .se-chev{color:var(--faint);font-size:18px;line-height:1}'
        + '.se-opt .se-link{justify-self:start;margin-top:2px}'
        + '.se-mv:disabled{opacity:.4;cursor:default}'
        + '.se-adds{display:flex;flex-wrap:wrap;gap:6px;align-items:center;padding:12px 14px 14px;border-top:1px solid var(--row-line)}'
        + '.se-addlbl{font-size:10.5px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--ttl);margin-right:2px}'
        + '.se-add{border:1px dashed var(--line-strong);background:none;color:var(--link);border-radius:999px;padding:6px 11px;'
        + 'font:700 12px Inter,system-ui,sans-serif;cursor:pointer}'
        + '.se-del{align-self:center;border:none;background:none;color:var(--link);font:700 13.5px Inter,system-ui,sans-serif;'
        + 'padding:10px 16px;cursor:pointer}'
        + '.se-toast{position:absolute;left:12px;right:12px;bottom:16px;z-index:40;background:var(--ctl);color:var(--lbl);'
        + 'border-radius:12px;padding:10px 12px;font-size:12.5px;line-height:1.45;box-shadow:0 10px 30px rgba(0,0,0,.35)}'
        // Add a screen: Blank across the top, the presets two by two, each with its picture.
        + '.sa-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}'
        + '.sa-card{display:grid;justify-items:center;align-content:start;gap:8px;min-width:0;margin:0;padding:12px 10px;'
        + 'border:none;border-radius:14px;background:var(--card);box-shadow:0 0 0 1px var(--card-line);color:var(--lbl);'
        + 'text-align:center;font:inherit;cursor:pointer;-webkit-appearance:none;appearance:none}'
        + '.sa-card.wide{grid-column:1/-1;grid-template-columns:auto minmax(0,1fr);justify-items:start;align-items:center;'
        + 'gap:14px;text-align:left}'
        + '.sa-pic{display:block;width:104px;border-radius:10px;overflow:hidden;line-height:0;box-shadow:0 0 0 1px var(--card-line)}'
        + '.sa-card.wide .sa-pic{width:60px;border-radius:7px}'
        + '.sa-pic svg{display:block;width:100%;height:auto}'
        + '.sa-txt{display:grid;gap:3px;min-width:0}'
        + '.sa-n{font:700 13.5px/1.25 Inter,system-ui,sans-serif;color:var(--lbl)}'
        + '.sa-d{font:500 11.5px/1.35 Inter,system-ui,sans-serif;color:var(--hint);overflow-wrap:anywhere}'
        + '.sa-card[disabled]{cursor:default}'
        + '.sa-card[disabled] .sa-pic{opacity:.45}'
        + '.sa-card[disabled] .sa-n{color:var(--muted)}'
        + '.sa-fine{padding:2px 4px;font-size:12px;line-height:1.45;color:var(--hint)}';

    /**
     * Put the styles on the page once.
     * @returns {void}
     */
    function ensureStyle() {
        if (typeof document === 'undefined' || !document.getElementById || document.getElementById('scr-style')) { return; }
        var el = document.createElement('style');
        el.id = 'scr-style';
        el.textContent = CSS;
        document.head.appendChild(el);
    }

    // ── The Screens card ────────────────────────────────────────────────────

    // The page's live state (onReady), the card's Undo toast, why a move snapped back, and the
    // card's drag in progress.
    var UI = { ctx: null, toast: null, timer: null, note: '', noteTimer: null, drag: null };

    /**
     * The Screens card's rows: one per screen, its name (the top one's "Default" pill when it
     * has a name of its own) and what it shows; with two screens or more a ≡ that drags it
     * (the arrow keys move it too) and the line that says so; a ✕ on each flick screen;
     * "+ Add screen" while there are fewer than three; why a move snapped back; the Undo toast
     * after a delete.
     * @param {Object} S Live settings.
     * @param {?Object} env Platform env.
     * @returns {string} HTML ('' on aplite)
     */
    function screensCard(S, env) {
        if (!hasScreens(env)) { return ''; }
        ensureStyle();
        var s = S || {}, lists = M.screensOf(s, env), many = lists.length > 1;
        var rows = lists.map(function (list, i) {
            var name = esc(M.nameOf(s, i));
            var pill = i === 0 && M.nameOf(s, 0) !== NAMES[0] ? '<span class="scr-pill">' + NAMES[0] + '</span>' : '';
            return '<div class="scr-row" data-scr-row="' + i + '">'
                + (many ? '<button type="button" class="scr-grip" data-scr-grip="' + i + '" aria-label="Move ' + name
                    + ' (arrow keys)" aria-describedby="scrHint">' + I_GRIP + '</button>' : '')
                + '<button type="button" class="scr-main' + (many ? ' g' : '') + '" data-action="openScreen" data-action-arg="' + i
                + '"><span class="scr-mid"><span class="scr-t">' + name + pill + '</span><span class="scr-els">'
                + esc(contents(list, s)) + '</span></span><span class="scr-chev" aria-hidden="true">›</span></button>'
                + (i > 0 ? '<button type="button" class="scr-x" data-action="deleteScreen" data-action-arg="' + i
                    + '" aria-label="Delete ' + name + '">' + I_X + '</button>' : '<span class="scr-xpad" aria-hidden="true"></span>')
                + '</div>';
        }).join('');
        var add = lists.length < M.MAX_SCREENS
            ? '<button type="button" class="scr-add" data-action="addScreen">+ Add screen</button>' : '';
        var hint = many ? '<div class="scr-hint" id="scrHint">' + REORDER_HINT + '</div>' : '';
        var note = UI.note ? '<div class="scr-note" role="status">' + esc(UI.note) + '</div>' : '';
        var t = UI.toast;
        var toast = t ? '<div class="scr-toast" role="status"><span>' + esc(t.text) + '</span>'
            + '<button type="button" class="scr-undo" data-action="undoDeleteScreen">Undo</button></div>' : '';
        return '<div class="scr-list">' + rows + add + hint + note + toast + '</div>';
    }

    /**
     * Say why a move snapped back, under the card, for four seconds.
     * @param {string} text Why.
     * @returns {void}
     */
    function showNote(text) {
        UI.note = text;
        if (UI.noteTimer) { clearTimeout(UI.noteTimer); }
        UI.noteTimer = setTimeout(function () {
            UI.note = '';
            UI.noteTimer = null;
            if (UI.ctx) { UI.ctx.render(); }
        }, 4000);
    }

    /**
     * Move a screen from the card (its drag, its arrow keys) and repaint: the page, and a reason
     * under the card when the move snapped back.
     * @param {number} from The screen's place.
     * @param {number} to Its new place.
     * @returns {string} '' when it moved, else why it stayed (moveScreen)
     */
    function cardMove(from, to) {
        var ctx = UI.ctx, why = moveScreen(ctx.S, from, to, ctx.ENV);
        if (why) { showNote(why); } else if (UI.note) { UI.note = ''; }
        UI.toast = null;
        ctx.render();
        return why;
    }

    /**
     * A press on a card row's ≡: the row lifts and follows the pointer (startDrag).
     * @param {PointerEvent} e The press.
     * @returns {void}
     */
    function onCardPointerDown(e) {
        var g = e.target && e.target.closest ? e.target.closest('[data-scr-grip]') : null;
        if (!g || !UI.ctx || UI.drag || (e.button !== undefined && e.button !== 0)) { return; }
        var listEl = g.closest('.scr-list');
        if (!listEl) { return; }
        UI.drag = startDrag(e, g, Number(g.getAttribute('data-scr-grip')), listEl,
            Array.prototype.slice.call(listEl.querySelectorAll('[data-scr-row]')));
    }

    /**
     * @param {PointerEvent} e A move.
     * @returns {void}
     */
    function onCardPointerMove(e) {
        if (UI.drag && e.pointerId === UI.drag.id) { followPointer(UI.drag, e); }
    }

    /**
     * The drop: the screen takes its new place, or stays with the reason (cardMove).
     * @param {PointerEvent} e The release (or the cancel).
     * @returns {void}
     */
    function onCardPointerUp(e) {
        var d = UI.drag;
        if (!d || e.pointerId !== d.id) { return; }
        UI.drag = null;
        endDrag(d);
        if (d.to !== d.j && UI.ctx) { cardMove(d.j, d.to); }
    }

    /**
     * ArrowUp / ArrowDown on a focused ≡ move its screen a place; the ≡ keeps the focus.
     * @param {KeyboardEvent} e The key.
     * @returns {void}
     */
    function onCardKeydown(e) {
        var g = e.target && e.target.closest ? e.target.closest('[data-scr-grip]') : null;
        if (!g || !UI.ctx || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) { return; }
        e.preventDefault();
        var i = Number(g.getAttribute('data-scr-grip')), to = e.key === 'ArrowUp' ? i - 1 : i + 1;
        if (to < 0 || to >= M.screensOf(UI.ctx.S, UI.ctx.ENV).length) { return; }
        var at = cardMove(i, to) ? i : to;
        var again = document.querySelector('[data-scr-grip="' + at + '"]');
        if (again) { again.focus(); }
    }

    /**
     * Show the Undo toast for five seconds.
     * @param {string} text Its line.
     * @param {Object} snap What Undo puts back.
     * @returns {void}
     */
    function showToast(text, snap) {
        UI.toast = { text: text, snap: snap };
        if (UI.timer) { clearTimeout(UI.timer); }
        UI.timer = setTimeout(function () {
            UI.toast = null;
            UI.timer = null;
            if (UI.ctx) { UI.ctx.render(); }
        }, 5000);
    }

    // ── The editor ──────────────────────────────────────────────────────────

    // The overlay's state: what it shows ('edit' a screen, or 'add': Add a screen), the slot,
    // the row whose option is open, the snap-back message, the drag in progress, whether the
    // title is being renamed and its input while it is.
    var ED = { overlay: null, mode: 'edit', i: 0, open: -1, toast: '', toastTimer: null, drag: null, renaming: false,
        nameEl: null, barRow: -1 };

    /**
     * A graph's size as its row reads it.
     * @param {Object} b A graph block.
     * @returns {string}
     */
    function sizeLabel(b) {
        return b.size === 'fill' ? 'Fill' : b.size + ' rows';
    }

    /**
     * Would a move keep the rules?
     * @param {Array<Object>} list The screen.
     * @param {number} j The row.
     * @param {number} to Its new place.
     * @returns {boolean}
     */
    function moveOk(list, j, to) {
        return to >= 0 && to < list.length && !M.problem(M.move(list, j, to));
    }

    /**
     * The option buttons of a row: the calendar's rows, a graph's size; a size the watch has
     * no room for is disabled, and the forecast never takes 2 rows.
     * @param {Array<Object>} list The screen.
     * @param {number} j The row.
     * @param {string} label The option's caption.
     * @param {string} key 'rows' | 'size'
     * @param {Array<string>} values Its values.
     * @param {?Object} env Platform env.
     * @returns {string} HTML
     */
    function optHtml(list, j, label, key, values, env) {
        var cur = list[j][key];
        return '<div class="se-opt"><span class="se-cap">' + label + '</span><div class="seg" role="group" aria-label="'
            + label + '">' + values.map(function (v) {
                var on = v === cur;
                var off = !on && ((key === 'size' && list[j].k === 'fc' && v === '2')
                    || !fitsWatch(M.setOption(list, j, key, v), ED.i, env));
                return '<button type="button" class="' + (on ? 'on' : '') + '" data-se="opt" data-j="' + j + '" data-key="'
                    + key + '" data-v="' + v + '" aria-pressed="' + on + '"' + (off ? ' disabled' : '') + '>'
                    + (v === 'fill' ? 'Fill' : v) + '</button>';
            }).join('') + '</div></div>';
    }

    /**
     * The style a forecast block draws: its own while it exists, else the first.
     * @param {Object} b The forecast block.
     * @param {Object} S Settings.
     * @returns {number} A style index.
     */
    function blockStyle(b, S) {
        var k = (parseInt(b.style, 10) || 1) - 1;
        return GS.exists(S, k) ? k : 0;
    }

    /**
     * The forecast row's graph (a watch with graph styles: emery), shown under the row whether
     * its options are open or not, so the choice is in view as the graph is added: a card with
     * the graph's name and length and what a tap does (the picker: another graph, or a new one
     * from a template), and the link that edits the graph on the Graphs tab. No picture: the
     * screen's picture above draws the graph (the owner's, 2026-11-08).
     * @param {Array<Object>} list The screen.
     * @param {number} j The row.
     * @param {Object} S Settings.
     * @param {?Object} env Platform env.
     * @returns {string} HTML
     */
    function styleHtml(list, j, S, env) {
        var k = blockStyle(list[j], S), many = GS.count(S) > 1, free = GS.freeSlot(S) >= 0;
        var hint = many ? (free ? 'Tap to pick another graph or start a new one' : 'Tap to pick another graph')
            : 'Tap to give this screen a graph of its own';
        return '<div class="se-opt"><span class="se-cap">Graph</span>'
            + '<button type="button" class="se-graph" data-se="style" data-j="' + j + '" aria-haspopup="dialog">'
            + '<span class="se-gtxt"><span class="se-gname">' + esc(GSP.label(S, env, k)) + '</span>'
            + '<span class="se-ghint">' + hint + '</span></span>'
            + '<span class="se-chev" aria-hidden="true">›</span></button>'
            + '<button type="button" class="se-link" data-se="editstyle" data-j="' + j + '">Edit '
            + esc(GS.name(S, k)) + ' on the Graphs tab ›</button></div>';
    }

    /**
     * The other screens a bar row's bar shows on, beside the row's name: "Also on Home".
     * @param {Object} S Settings.
     * @param {?Object} env Platform env.
     * @param {string} bar An on-demand.js BARS bar.
     * @returns {string} '' when this screen alone shows it
     */
    function alsoOn(S, env, bar) {
        var others = barPlaces(S, env, bar).filter(function (i) { return i !== ED.i; });
        return others.length ? 'Also on ' + GSP.andList(others.map(function (i) { return M.nameOf(S, i); })) : '';
    }

    /**
     * An open bar row's Bar card: the bar's name and what it holds, a tap opening the picker of
     * your bars (another one here instead), and the link that edits it on the Status bars tab.
     * @param {number} j The row.
     * @param {Object} S Settings.
     * @param {?Object} env Platform env.
     * @param {string} bar An on-demand.js BARS bar.
     * @returns {string} HTML
     */
    function barHtml(j, S, env, bar) {
        var name = esc(M.barName(S, bar));
        return '<div class="se-opt"><span class="se-cap">Bar</span>'
            + '<button type="button" class="se-graph" data-se="bar" data-j="' + j + '" aria-haspopup="dialog">'
            + '<span class="se-gtxt"><span class="se-gname">' + name + '</span>'
            + '<span class="se-ghold">' + esc(barHolds(S, env, bar)) + '</span>'
            + '<span class="se-ghint">Tap to show another of your bars here</span></span>'
            + '<span class="se-chev" aria-hidden="true">›</span></button>'
            + '<button type="button" class="se-link" data-se="editbar" data-j="' + j + '">Edit ' + name
            + ' on the Status bars tab ›</button></div>';
    }

    /**
     * One row of the list.
     * @param {Array<Object>} list The screen.
     * @param {number} j The row.
     * @param {Object} S Settings.
     * @param {?Object} env Platform env.
     * @returns {string} HTML
     */
    function rowHtml(list, j, S, env) {
        var b = list[j], K = M.KINDS[b.k], fixed = b.k === 'strip', open = ED.open === j && !fixed;
        var keepClock = ED.i === 0 && b.k === 'clock', name = esc(M.blockName(b, S)), bar = M.BAR_OF_KIND[b.k];
        var val = b.k === 'cal' ? b.rows + ' rows' : K.graph ? sizeLabel(b) : bar ? alsoOn(S, env, bar) : '';
        var h = '<div class="se-row" role="listitem" data-j="' + j + '">';
        h += fixed ? '<span class="se-grip off" aria-hidden="true"></span>'
            : '<span class="se-grip" data-grip="' + j + '" title="Drag to move" aria-hidden="true">' + I_GRIP + '</span>';
        h += fixed ? '<span class="se-main fixed"><span>' + name + '</span></span>'
            : '<button type="button" class="se-main" data-se="expand" data-j="' + j + '" aria-expanded="' + open + '"><span>'
                + name + '</span>' + (val ? '<span class="se-val">' + esc(val) + '</span>' : '') + '</button>';
        h += keepClock ? '<span class="se-x" aria-hidden="true"></span>'
            : '<button type="button" class="se-x" data-se="rm" data-j="' + j + '" aria-label="Remove ' + name + '">' + I_X + '</button>';
        if (b.k === 'radar' && S.radarEnabled === false) {
            h += '<div class="se-sub se-off"><span>' + RADAR_OFF + '</span>'
                + '<button type="button" class="se-link" data-se="radaron">Turn on</button></div>';
        }
        // The forecast graph's own graph: first, and in view while the row is folded too.
        var graph = b.k === 'fc' && env && env.graphStyles ? styleHtml(list, j, S, env) : '';
        if (open) {
            h += '<div class="se-sub se-more">' + graph + (bar ? barHtml(j, S, env, bar) : '');
            if (b.k === 'cal') { h += optHtml(list, j, 'Rows', 'rows', M.CAL_ROWS, env); }
            if (K.graph) { h += optHtml(list, j, 'Size', 'size', M.GRAPH_SIZES, env); }
            h += '<div class="se-moves"><button type="button" class="se-mv" data-se="up" data-j="' + j + '"'
                + (moveOk(list, j, j - 1) ? '' : ' disabled') + '>' + I_UP + 'Move up</button>'
                + '<button type="button" class="se-mv" data-se="down" data-j="' + j + '"'
                + (moveOk(list, j, j + 1) ? '' : ' disabled') + '>' + I_DOWN + 'Move down</button></div></div>';
        } else if (graph) {
            h += '<div class="se-sub se-more">' + graph + '</div>';
        }
        return h + '</div>';
    }

    /**
     * The editor's body for the screen in ED.i.
     * @param {Object} S Settings.
     * @param {?Object} env Platform env.
     * @param {Object} [userData] Page userData (the palette).
     * @returns {string} HTML
     */
    function editorBody(S, env, userData) {
        var i = ED.i, cycle = VC.screensCycle(S, env), list = M.screensOf(S, env, cycle)[i] || [];
        var note = !cycle[i] ? NOTHING_YET : !fitsWatch(list, i, env) ? TOO_TALL : '';
        var adds = M.addable(list, env).filter(function (k) { return fitsWatch(M.add(list, k), i, env); });
        var pic = screenPicture(S, i, env, userData, 'se' + i + '-', cycle).svg;
        return '<div class="se-pic"><span class="se-pic-card" role="img" aria-label="' + esc(M.nameOf(S, i) + ': ' + contents(list, S))
            + '">' + pic + '</span></div>'
            + (note ? '<div class="se-note" role="status">' + note + '</div>' : '')
            + '<div class="se-card"><div class="se-cardhd" id="seTtl">Top to bottom</div>'
            + '<div class="se-list" id="seList" role="list" aria-labelledby="seTtl">'
            + list.map(function (b, j) { return rowHtml(list, j, S, env); }).join('') + '</div>'
            + (adds.length ? '<div class="se-adds"><span class="se-addlbl">Add</span>' + adds.map(function (k) {
                return '<button type="button" class="se-add" data-se="add" data-k="' + k + '">+ ' + esc(M.blockName({ k: k }, S))
                    + '</button>';
            }).join('') + '</div>' : '')
            + '</div>'
            + (i > 0 ? '<button type="button" class="se-del" data-se="delscreen">Delete screen</button>' : '');
    }

    /**
     * Add a screen's body: its choices (addChoices) as cards, Blank across the top and the
     * presets two by two, each with the picture of the screen it adds; a greyed-out one says
     * why in place of its line. Under them what a preset brings.
     * @param {Object} S Settings.
     * @param {?Object} env Platform env.
     * @param {Object} [userData] Page userData (the palette).
     * @returns {string} HTML
     */
    function addBody(S, env, userData) {
        var cards = addChoices(S, env).map(function (c) {
            var off = Boolean(c.why);
            return '<button type="button" class="sa-card' + (c.id === BLANK ? ' wide' : '') + '" data-se="pick" data-id="'
                + c.id + '"' + (off ? ' disabled' : '') + '><span class="sa-pic" aria-hidden="true">'
                + screenPicture(c.W, c.n, env, userData, 'sa-' + c.id + '-').svg + '</span>'
                + '<span class="sa-txt"><span class="sa-n">' + esc(c.name) + '</span><span class="sa-d">'
                + esc(off ? c.why : c.desc) + '</span></span></button>';
        }).join('');
        return '<div class="sa-grid">' + cards + '</div><div class="sa-fine">' + esc(env && env.graphStyles ? ADD_FINE
            : ADD_FINE_ONE_GRAPH) + '</div>';
    }

    /**
     * The overlay's title: "Add a screen", or the screen's name, which a tap renames (an input
     * while it is renamed: left alone by a repaint, so typing goes on).
     * @param {Object} S Settings.
     * @returns {void}
     */
    function renderTitle(S) {
        var h = ED.overlay.querySelector('[data-se-title]');
        if (ED.mode === 'add') { h.innerHTML = 'Add a screen'; return; }
        if (ED.renaming) {
            if (ED.nameEl) { return; }
            h.innerHTML = '<input type="text" class="se-name-in" maxlength="' + M.NAME_MAX + '" aria-label="Screen name"'
                + ' autocomplete="off" value="' + esc(M.nameOf(S, ED.i)) + '">';
            var input = ED.nameEl = h.querySelector('input');
            input.addEventListener('keydown', function (e) {
                if (e.key === 'Enter') { e.preventDefault(); endRename(input.value); }
                if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); endRename(null); }
            });
            input.addEventListener('blur', function () { endRename(input.value); });
            input.focus();
            input.select();
            return;
        }
        var name = esc(M.nameOf(S, ED.i));
        h.innerHTML = '<button type="button" class="se-name" data-se="rename" aria-label="Rename ' + name + '"><span>' + name
            + '</span>' + I_PEN + '</button>';
    }

    /**
     * End the rename: the name typed stored (renameScreen), or with null nothing changed; the
     * focus back on the name.
     * @param {?string} text The name typed, or null to cancel.
     * @returns {void}
     */
    function endRename(text) {
        if (!ED.renaming || !ED.overlay || !UI.ctx) { return; }
        ED.renaming = false;
        ED.nameEl = null;
        if (text !== null) {
            renameScreen(UI.ctx.S, ED.i, text);
            UI.ctx.render();
        }
        renderEditor();
        var b = ED.overlay.querySelector('[data-se="rename"]');
        if (b) { b.focus(); }
    }

    /**
     * Paint the overlay (the editor, or Add a screen), keeping its scroll position.
     * @returns {void}
     */
    function renderEditor() {
        if (!ED.overlay || !UI.ctx) { return; }
        var ctx = UI.ctx, body = ED.overlay.querySelector('[data-se-body]'), add = ED.mode === 'add';
        var top = body.scrollTop;
        renderTitle(ctx.S);
        ED.overlay.querySelector('.se-done').style.display = add ? 'none' : '';
        body.innerHTML = add ? addBody(ctx.S, ctx.ENV, ctx.USERDATA) : editorBody(ctx.S, ctx.ENV, ctx.USERDATA);
        body.scrollTop = top;
        var t = ED.overlay.querySelector('[data-se-toast]');
        t.textContent = ED.toast;
        t.style.display = ED.toast ? '' : 'none';
    }

    /**
     * Say why a move snapped back, for three seconds.
     * @param {string} text The rule.
     * @returns {void}
     */
    function editorToast(text) {
        ED.toast = text;
        if (ED.toastTimer) { clearTimeout(ED.toastTimer); }
        ED.toastTimer = setTimeout(function () { ED.toast = ''; ED.toastTimer = null; renderEditor(); }, 3000);
    }

    /**
     * Store the screen being edited and repaint the editor and the page under it.
     * @param {Array<Object>} list The new screen.
     * @returns {void}
     */
    function commit(list) {
        var ctx = UI.ctx;
        writeScreen(ctx.S, ED.i, list, ctx.ENV);
        renderEditor();
        ctx.render();
    }

    /**
     * Close the editor (‹ and Done alike: the edits are already on the page, whose Save and
     * Revert decide).
     * @returns {void}
     */
    function closeEditor() {
        if (!ED.overlay) { return; }
        if (ED.overlay.parentNode) { ED.overlay.parentNode.removeChild(ED.overlay); }
        ED.overlay = null;
        ED.drag = null;
        ED.renaming = false;
        ED.nameEl = null;
        document.removeEventListener('keydown', onKeydown);
        if (UI.ctx) { UI.ctx.render(); }
    }

    /**
     * Escape folds an open row's options, else closes the editor (not under a dialog).
     * @param {KeyboardEvent} e The key.
     * @returns {void}
     */
    function onKeydown(e) {
        if (e.key !== 'Escape' || ED.renaming) { return; }
        var modal = document.getElementById('modal');
        if (modal && modal.open) { return; }
        if (ED.open >= 0) { ED.open = -1; renderEditor(); return; }
        closeEditor();
    }

    /**
     * Turn the rain radar on or off (Setup's Rain radar picker, a screen's Rain radar row, the
     * setup's Rain radar screen): its source stays as stored, the Rain radar picker shows Off or
     * that source (radarSourceValue), and the modes follow.
     * @param {Object} S Settings.
     * @param {boolean} on On or off.
     * @param {?Object} env Platform env.
     * @returns {void}
     */
    function setRadarEnabled(S, on, env) {
        S.radarEnabled = on;
        S.radarSource = radarSourceValue(S);
        applyModes(S, env);
    }

    /**
     * The editor's taps: close, open a row's options, remove, add, move, pick an option, turn
     * the radar on, delete the screen. A tap a drag ends in is no tap.
     * @param {MouseEvent} e The click.
     * @returns {void}
     */
    function onClick(e) {
        var t = e.target && e.target.closest ? e.target.closest('[data-se]') : null;
        if (!t || !UI.ctx || ED.drag) { return; }
        var ctx = UI.ctx, S = ctx.S, env = ctx.ENV;
        var act = t.getAttribute('data-se'), j = Number(t.getAttribute('data-j'));
        var list = M.screensOf(S, env)[ED.i] || [];
        if (act === 'close') { closeEditor(); return; }
        if (act === 'rename') { ED.renaming = true; renderTitle(S); return; }
        // Add a screen's pick: the screen added after the others (addChosen), its editor next.
        if (act === 'pick') {
            var slot = t.disabled ? -1 : addChosen(S, env, t.getAttribute('data-id'));
            if (slot < 0) { return; }
            UI.toast = null;
            ED.mode = 'edit';
            ED.i = slot;
            ED.open = -1;
            ED.overlay.querySelector('[data-se-body]').scrollTop = 0;
            renderEditor();
            ctx.render();
            return;
        }
        if (act === 'expand') { ED.open = ED.open === j ? -1 : j; renderEditor(); return; }
        if (act === 'rm') { ED.open = -1; commit(M.remove(list, j)); return; }
        if (act === 'add') {
            var k = t.getAttribute('data-k');
            var next = M.add(list, k);
            ED.open = k === 'strip' ? -1 : M.idxOf(next, k);
            commit(next);
            return;
        }
        if (act === 'up' || act === 'down') {
            var to = act === 'up' ? j - 1 : j + 1;
            if (!moveOk(list, j, to)) { return; }
            ED.open = to;
            commit(M.move(list, j, to));
            return;
        }
        if (act === 'opt') {
            if (t.disabled) { return; }
            commit(M.setOption(list, j, t.getAttribute('data-key'), t.getAttribute('data-v')));
            return;
        }
        if (act === 'radaron') { setRadarEnabled(S, true, env); renderEditor(); ctx.render(); return; }
        // The forecast row's graph: its picker opens over the editor (the page's select sheet, a
        // top-layer dialog), its pick lands through screenGraphStylePicked.
        if (act === 'style') {
            GSP.beginScreenPick(S, ED.i, String(blockStyle(list[j], S) + 1));
            ctx.openSheet(GSP.SCREEN_PICK, function () { renderEditor(); });
            return;
        }
        // A bar row's Bar card: the picker of your bars opens over the editor, its pick lands
        // through screenBarPicked.
        if (act === 'bar') {
            ED.barRow = j;
            S[SCREEN_BAR] = list[j] ? list[j].k : '';
            ctx.openSheet(SCREEN_BAR, function () { renderEditor(); });
            return;
        }
        // "Edit <bar> on the Status bars tab": the editor closes, the tab opens.
        if (act === 'editbar') {
            closeEditor();
            ctx.gotoTab(STATUS_TAB);
            return;
        }
        // "Edit <graph> on the Graphs tab": the editor closes, the Graphs tab opens on that graph.
        if (act === 'editstyle') {
            S[GSP.PICK] = String(blockStyle(list[j], S) + 1);
            closeEditor();
            ctx.gotoTab('graphs', 'forecast');
            return;
        }
        if (act === 'delscreen') {
            var i = ED.i;
            closeEditor();
            deleteWithUndo(S, i, env);
            ctx.render();
        }
    }

    /**
     * The screen editor's graph pick (onChange 'screenGraphStylePicked'): the screen being edited
     * draws that graph, or a new one made from the template picked (graph-styles-page.js
     * pickForScreen). The first graph is no field of the block (screens.js).
     * @param {Object} S Settings.
     * @param {*} oldValue The graph before.
     * @param {string} value '1' | '2' | '3' | 'new:<template id>'.
     * @param {?Object} env Platform env.
     * @returns {void}
     */
    function screenStylePicked(S, oldValue, value, env) {
        if (!ED.overlay) { return; }
        GSP.pickForScreen(S, env, ED.i, value, oldValue);
    }

    // ── Dragging a row (the editor's rows, the Screens card's screens) ─────

    /**
     * Start a drag by a handle: its row lifts to follow the pointer (followPointer), the others
     * make room (shiftRows).
     * @param {PointerEvent} e The press.
     * @param {Element} grip The handle (it captures the pointer).
     * @param {number} j The row's index.
     * @param {Element} listEl The list.
     * @param {Array<Element>} rows Its rows, in order.
     * @returns {Object} the drag
     */
    function startDrag(e, grip, j, listEl, rows) {
        e.preventDefault();
        var d = { j: j, to: j, rows: rows, y0: e.clientY, id: e.pointerId, listEl: listEl,
            rects: rows.map(function (r) { return r.getBoundingClientRect(); }) };
        try { grip.setPointerCapture(e.pointerId); } catch (err) { /* an old WebView */ }
        rows[j].classList.add('lift');
        listEl.classList.add('dragging');
        return d;
    }

    /**
     * Move the other rows out of the way of the dragged one's new place.
     * @param {Object} d The drag.
     * @returns {void}
     */
    function shiftRows(d) {
        var order = [], x;
        for (x = 0; x < d.rows.length; x++) { if (x !== d.j) { order.push(x); } }
        order.splice(d.to, 0, d.j);
        var y = d.rects[0].top;
        order.forEach(function (r) {
            if (r !== d.j) {
                var dy = y - d.rects[r].top;
                d.rows[r].style.transform = dy ? 'translateY(' + dy + 'px)' : '';
            }
            y += d.rects[r].height;
        });
    }

    /**
     * The dragged row follows the pointer; its new place is the rows above its middle.
     * @param {Object} d The drag.
     * @param {PointerEvent} e The move.
     * @returns {void}
     */
    function followPointer(d, e) {
        var dy = e.clientY - d.y0, r0 = d.rects[d.j];
        d.rows[d.j].style.transform = 'translateY(' + dy + 'px)';
        var center = r0.top + r0.height / 2 + dy, to = 0;
        for (var x = 0; x < d.rects.length; x++) {
            if (x !== d.j && d.rects[x].top + d.rects[x].height / 2 < center) { to++; }
        }
        if (to !== d.to) { d.to = to; shiftRows(d); }
    }

    /**
     * Put the rows back where they were drawn (the caller stores the move and repaints).
     * @param {Object} d The drag.
     * @returns {void}
     */
    function endDrag(d) {
        d.rows[d.j].classList.remove('lift');
        d.listEl.classList.remove('dragging');
        d.rows.forEach(function (r) { r.style.transform = ''; });
    }

    /**
     * A press on an editor row's handle: the row follows the pointer (startDrag), and a drop
     * that breaks a rule snaps back with the reason.
     * @param {PointerEvent} e The press.
     * @returns {void}
     */
    function onPointerDown(e) {
        var g = e.target && e.target.closest ? e.target.closest('[data-grip]') : null;
        if (!g || (e.button !== undefined && e.button !== 0)) { return; }
        var listEl = ED.overlay.querySelector('#seList');
        ED.drag = startDrag(e, g, Number(g.getAttribute('data-grip')), listEl, Array.prototype.slice.call(listEl.children));
    }

    /**
     * @param {PointerEvent} e A move.
     * @returns {void}
     */
    function onPointerMove(e) {
        if (ED.drag && e.pointerId === ED.drag.id) { followPointer(ED.drag, e); }
    }

    /**
     * Drop: store the move, or snap back with the rule it breaks.
     * @param {PointerEvent} e The release (or the cancel).
     * @returns {void}
     */
    function onPointerUp(e) {
        var d = ED.drag;
        if (!d || e.pointerId !== d.id) { return; }
        endDrag(d);
        // The click a drag ends in is not a tap on the row.
        setTimeout(function () { ED.drag = null; }, 0);
        if (d.to === d.j || !UI.ctx) { return; }
        var list = M.screensOf(UI.ctx.S, UI.ctx.ENV)[ED.i] || [];
        var next = M.move(list, d.j, d.to), why = M.problem(next);
        if (why) { editorToast(why); renderEditor(); return; }
        ED.open = -1;
        commit(next);
    }

    /**
     * Open the editor on a screen.
     * @param {number} i View slot.
     * @returns {void}
     */
    function openEditor(i) {
        openOverlay('edit', i);
    }

    /**
     * Open Add a screen (Blank, then the presets this watch can draw).
     * @returns {void}
     */
    function openAdd() {
        openOverlay('add', 0);
    }

    /**
     * Open the full-screen overlay: the editor on a screen, or Add a screen.
     * @param {string} mode 'edit' | 'add'
     * @param {number} i View slot (the editor's).
     * @returns {void}
     */
    function openOverlay(mode, i) {
        if (ED.overlay || !UI.ctx || typeof document === 'undefined') { return; }
        ensureStyle();
        ED.mode = mode;
        ED.i = i;
        ED.open = -1;
        ED.toast = '';
        ED.renaming = false;
        ED.nameEl = null;
        var overlay = document.createElement('div');
        overlay.id = 'screenEditor';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.setAttribute('aria-labelledby', 'seTitle');
        overlay.innerHTML = '<div class="se-hdr"><button type="button" class="se-back" data-se="close" aria-label="Back">' + I_BACK
            + '</button><h2 class="se-ttl" id="seTitle" data-se-title></h2>'
            + '<button type="button" class="dlg-done se-done" data-se="close">Done</button></div>'
            + '<div class="se-body" data-se-body></div><div class="se-toast" role="status" data-se-toast style="display:none"></div>';
        document.body.appendChild(overlay);
        ED.overlay = overlay;
        overlay.addEventListener('click', onClick);
        overlay.addEventListener('pointerdown', onPointerDown);
        overlay.addEventListener('pointermove', onPointerMove);
        overlay.addEventListener('pointerup', onPointerUp);
        overlay.addEventListener('pointercancel', onPointerUp);
        document.addEventListener('keydown', onKeydown);
        renderEditor();
    }

    // ── Setup's Rain radar picker ───────────────────────────────────────────

    /**
     * The Rain radar picker's value as the page opens: Off while the radar is off, else its
     * source (display resolver, initFrom).
     * @param {Object} S Settings.
     * @returns {string}
     */
    function radarSourceValue(S) {
        return (S && S.radarEnabled === false) ? 'off' : ((S && S.radarProvider) || 'rainbow');
    }

    /**
     * A pick: Off turns the radar off and keeps the source; a source turns it on (onChange).
     * @param {Object} S Settings (radarSource already set).
     * @param {*} oldValue The previous pick.
     * @param {*} newValue The pick.
     * @param {?Object} env Platform env.
     * @returns {void}
     */
    function radarSourcePicked(S, oldValue, newValue, env) {
        if (newValue !== 'off') { S.radarProvider = newValue; }
        setRadarEnabled(S, newValue !== 'off', env);
    }

    /**
     * The radarMode Save stores for these settings (screens.js deriveModes, as the onSubmit hook
     * below writes it): the page's one reading of whether the phone fetches the rain radar, for
     * what asks between Saves (the radar key's check here, the call budgets in blocks.js). The
     * stored radarMode can lag until Save (a rain tick on the Alerts tab moves it). Whether the
     * radar is on at all is the switch, radarEnabled: the picker, the "turn it on" notes and
     * the key rows read that, so a key can go in before a screen uses the radar.
     * @param {Object} S Settings.
     * @param {?Object} env Platform env.
     * @returns {string} 'off' | 'countdown' | 'status' | 'graph'
     */
    function radarModeToSave(S, env) {
        if (!hasScreens(env)) { return (S && S.radarMode) || 'graph'; }   // aplite: its own, as Save keeps it
        return M.deriveModes(S || {}, env).radarMode;
    }

    /**
     * The Battery saver's pause, for the Update interval's hint, while it is on.
     * @param {Object} S Settings.
     * @param {?Object} env Platform env.
     * @param {{staticHint: string}} args The row's own hint.
     * @returns {string}
     */
    function batterySaverPauseHint(S, env, args) {
        var s = S || {};
        var own = (args && args.staticHint) || '';
        if (s.sleepNightEnabled === false) { return own; }
        var from = parseInt(s.sleepStartHour, 10), to = parseInt(s.sleepEndHour, 10);
        if (isNaN(from)) { from = 0; }
        if (isNaN(to)) { to = 7; }
        var pause = 'Paused ' + from + ':00–' + to + ':00 by the Battery saver.';
        return own ? own + ' ' + pause : pause;
    }

    // ── Registration (the webview; a no-op under Node without the page) ─────

    if (PConf) {
        if (PConf.blocks) { PConf.blocks.register('screensCard', screensCard); }
        if (PConf.hooks && PConf.hooks.onReady) {
            PConf.hooks.onReady(function (ctx) {
                UI.ctx = ctx;
                // The Screens card's ≡: dragged, or moved with the arrow keys.
                if (typeof document !== 'undefined' && document.addEventListener) {
                    document.addEventListener('pointerdown', onCardPointerDown);
                    document.addEventListener('pointermove', onCardPointerMove);
                    document.addEventListener('pointerup', onCardPointerUp);
                    document.addEventListener('pointercancel', onCardPointerUp);
                    document.addEventListener('keydown', onCardKeydown);
                }
            });
        }
        if (PConf.hooks && PConf.hooks.onSubmit) {
            // Save writes the modes the screens need, whatever changed them (a screen, the
            // radar, a slot's health item, the rain alert's ticks).
            PConf.hooks.onSubmit(function (ctx) {
                if (!UI.ctx || !hasScreens(ctx.env)) { return; }
                var m = M.deriveModes(UI.ctx.S, ctx.env);
                ctx.set('radarMode', m.radarMode);
                ctx.set('healthMode', m.healthMode);
            });
        }
        PConf.actions = PConf.actions || {};
        PConf.actions.openScreen = function (arg) { openEditor(parseInt(arg, 10) || 0); };
        PConf.actions.addScreen = function () {
            openAdd();
            return false;
        };
        PConf.actions.deleteScreen = function (arg, S, env) {
            deleteWithUndo(S, parseInt(arg, 10) || 0, env);
            return true;
        };
        PConf.actions.undoDeleteScreen = function (arg, S, env) {
            if (UI.toast) {
                restore(S, UI.toast.snap, env);
                UI.toast = null;
                if (UI.timer) { clearTimeout(UI.timer); UI.timer = null; }
            }
            return true;
        };
        if (PConf.displayResolvers) { PConf.displayResolvers.register('radarSourceValue', radarSourceValue); }
        if (PConf.attentionResolvers) {
            // The Rain radar picker's key check (key-status.js keyAttention, on radarProvider):
            // nothing to ask while no radar call is made (the radar off, or nothing on the
            // screens and no rain alert on a shown bar needing it: radarModeToSave).
            PConf.attentionResolvers.register('radarKeyAttention', function (S, env) {
                var fn = PConf.attentionResolvers.get('keyAttention');
                return (!S || !fn || radarModeToSave(S, env) === 'off') ? null : fn(S, env, { picker: 'radarProvider' });
            });
        }
        if (PConf.onChange) {
            PConf.onChange.register('radarSourcePicked', radarSourcePicked);
            PConf.onChange.register('screenGraphStylePicked', screenStylePicked);
            PConf.onChange.register('screenBarPicked', screenBarPicked);
        }
        // Your bars by name (screens.js barName): the Status bars tab's card titles and slot
        // pickers' titles, and each Name row's hint, where the bar shows.
        if (PConf.displayResolvers) {
            PConf.displayResolvers.register('barName', function (S, env, args) { return M.barName(S, args.bar); });
            PConf.displayResolvers.register('barSlotTitle', function (S, env, args) {
                return M.barName(S, args.bar) + ' · ' + args.label;
            });
        }
        if (PConf.optionsResolvers) {
            PConf.optionsResolvers.register('apliteLayouts', function () { return APLITE_LAYOUTS.slice(); });
            PConf.optionsResolvers.register('screenBarOptions', barOptions);
        }
        if (PConf.hintResolvers) {
            PConf.hintResolvers.register('batterySaverPauseHint', batterySaverPauseHint);
            PConf.hintResolvers.register('barScreens', function (S, env, args) { return barWhere(S, env, args.bar); });
        }
        if (PConf.whenResolvers) {
            PConf.whenResolvers.register('manyScreens', function (S, env) {
                return hasScreens(env) && M.screensOf(S, env).length > 1;
            });
        }
    }

    var api = {
        NAMES: NAMES,
        NEW_SCREEN: NEW_SCREEN,
        APLITE_LAYOUTS: APLITE_LAYOUTS,
        TOO_TALL: TOO_TALL,
        NOTHING_YET: NOTHING_YET,
        NO_ROOM_FOR_CLOCK: NO_ROOM_FOR_CLOCK,
        ALREADY: ALREADY,
        NO_GRAPH_ROOM: NO_GRAPH_ROOM,
        REORDER_HINT: REORDER_HINT,
        hasScreens: hasScreens,
        ensureCustom: ensureCustom,
        applyModes: applyModes,
        editScreens: editScreens,
        writeScreen: writeScreen,
        snapshot: snapshot,
        restore: restore,
        deleteScreen: deleteScreen,
        insertScreen: insertScreen,
        addScreen: addScreen,
        moveScreen: moveScreen,
        renameScreen: renameScreen,
        sameRows: sameRows,
        addChoices: addChoices,
        addChosen: addChosen,
        barWhere: barWhere,
        barHolds: barHolds,
        barOptions: barOptions,
        screenBarPicked: screenBarPicked,
        contents: contents,
        drawnView: drawnView,
        screenPicture: screenPicture,
        setRadarEnabled: setRadarEnabled,
        radarModeToSave: radarModeToSave,
        screensCard: screensCard,
        editorBody: editorBody,
        radarSourceValue: radarSourceValue,
        radarSourcePicked: radarSourcePicked,
        screenStylePicked: screenStylePicked,
        batterySaverPauseHint: batterySaverPauseHint,
        _test: { ED: ED, UI: UI, openEditor: openEditor, openAdd: openAdd, closeEditor: closeEditor, addBody: addBody,
            onCardKeydown: onCardKeydown, cardMove: cardMove }
    };
    if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
    if (typeof window !== 'undefined') { window.ScreensPage = api; }
})();
