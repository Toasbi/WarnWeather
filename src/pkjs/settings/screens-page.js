// src/pkjs/settings/screens-page.js — ES5, WebView (+ Node for tests). The Watchface tab's
// screens: the Screens card (one row per screen by its name, ending on the red arrow that opens
// its editor, dragged by its ≡ or moved with the arrow keys, the top one the Default; a ✕ with
// Undo on each other; "+ Add screen"), the Add a screen sheet (Blank, then the presets this
// watch can draw: screen-presets.js), the screen editor (a full-screen view under a dialog's
// header: the screen's name, which its pencil renames with an OK button, its picture and its
// rows top to bottom, dragged or moved, each folding open on its red ▸ like a folding card to
// show its option and its moves, a bar's and the forecast graph's a picker and an Edit button,
// then the Add chips, and Delete screen under the card), the Status bars tab's Your status bars card
// (each bar's name, the screens that show it, the alerts placed on it and its picture, whose
// slots a tap changes, the red arrow in the middle of the row; a tap on the name opens the bar's
// dialog, schema.js barDialog, which pins the bar's picture; New status bar makes an empty bar and
// opens it), Setup's Rain radar picker (Off keeps the source) and the modes the page works out
// from the screens. Every arrow, chevron, Delete, Undo, chip and header is the page's shared
// part (config-ui/lib/ui.js).
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
    // The page's shared parts (config-ui/lib/ui.js): the lists' rows, red arrows, New rows and
    // Undo (with the timer that takes a message away: flash), the editor's header, its folding
    // rows' chevrons, its chips and Delete screen, the icons.
    var kit = (typeof require !== 'undefined') ? require('../config-ui/lib/ui.js') : PConf.ui;

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
    var ALREADY = 'You already have this screen.';
    var NO_GRAPH_ROOM = 'It needs a new graph, and you have 3 already. Delete one on the Graphs tab.';
    var REORDER_HINT = 'The watch starts on the top screen. Each flick shows the next one. Drag ≡ to change the order.';
    // The editor's bar picker (custom-layout-schema.js: a page-only select); its New status bar row's
    // value is NEW_BAR (never a kind).
    var SCREEN_BAR = 'screenBar';
    var NEW_BAR = 'new';
    var BARS_FULL = 'That’s the most status bars there can be: the Watch bar and ' + M.MAX_BARS
        + ' more. To make another, delete one you made.';
    // A Delete status bar's Undo while it shows (the Your status bars card).
    var BAR_UNDO = { v: null, t: null };
    // What a preset brings, under Add a screen's cards: with graph styles, and on a watch with
    // one graph (screen-presets.js WHAT A PRESET BRINGS).
    var ADD_FINE = 'A preset adds its own graph, or uses one of yours that looks the same. Your status bars keep what they show.';
    var ADD_FINE_ONE_GRAPH = 'A preset adds its rows. Your graph and your status bars stay as they are.';
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
     * An Undo tapped (a flash holding {text, snap}): its snapshot put back (restore) and the
     * message gone.
     * @param {{v: *, t: *}} box The Undo's box.
     * @param {Object} S Settings.
     * @param {?Object} env Platform env.
     * @returns {boolean} true, the page repaints
     */
    function takeUndo(box, S, env) {
        if (box.v) { restore(S, box.v.snap, env); }
        kit.unflash(box);
        return true;
    }


    /**
     * New status bar, wherever it is tapped (the Your status bars card, the editor's + New status bar, the bar
     * picker): screens.js makeBar, and a Delete status bar's Undo dropped, since the bar made can be
     * the deleted one's slot (freeBar), which the Undo would write the old bar over.
     * @param {Object} S Settings.
     * @param {?Object} env Platform env.
     * @returns {?string} the bar made, null for none
     */
    function makeBar(S, env) {
        var made = M.makeBar(S, env);
        if (made) { kit.unflash(BAR_UNDO); }
        return made;
    }

    /**
     * Open a bar's dialog (schema.js barDialog) over whatever shows: the Status bars tab, or the
     * screen editor, which repaints as it closes. A bar New status bar just made opens with its name
     * field ready.
     * @param {string} bar An on-demand.js BARS bar.
     * @param {boolean} rename Whether the name field opens ready to type.
     * @param {string} kicker Where it opens from (the dialog's kicker).
     * @param {?function(): void} onClose Called after it closes: the editor's repaint, so it also
     *     marks a dialog over the editor, whose focus then goes back to nothing on the page.
     * @returns {void}
     */
    function openBar(bar, rename, kicker, onClose) {
        if (UI.ctx && UI.ctx.openDialog) {
            UI.ctx.openDialog(M.barSheet(bar), { rename: rename, kicker: kicker, onClose: onClose,
                overlay: Boolean(onClose) });
        }
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
        var N = GSP.asStored(S), lists = M.screensOf(N, env);
        var p = id === BLANK ? null : PRESETS.byId(id);
        if (lists.length >= M.MAX_SCREENS || (id !== BLANK && !(p && PRESETS.drawable(p, env)))) { return -1; }
        var c = addChoice(N, env, lists, p);
        if (c.why) { return -1; }
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

    // ── Your status bars (screens.js THE NAMES) ────────────────────────────

    /**
     * The places of the screens that show a status bar (the Watch bar: its strip).
     * @param {Object} S Settings.
     * @param {?Object} env Platform env.
     * @param {string} bar An on-demand.js BARS bar.
     * @param {Array<?Object>} [cycle] VC.screensCycle(S, env), when the caller has it already.
     * @returns {number[]}
     */
    function barPlaces(S, env, bar, cycle) {
        return M.placesWhere(S || {}, env, function (list) {
            return list.some(function (b) { return bar === 'top' ? b.k === 'strip' : M.BAR_OF_KIND[b.k] === bar; });
        }, cycle);
    }

    /**
     * Where a bar shows, by the screens' names: "On Default and Steps", "On no screen" (under
     * its picture in its dialog, its option in the editor's picker).
     * @param {Object} S Settings.
     * @param {?Object} env Platform env.
     * @param {string} bar An on-demand.js BARS bar.
     * @param {Array<?Object>} [cycle] VC.screensCycle(S, env), when the caller has it already.
     * @returns {string}
     */
    function barWhere(S, env, bar, cycle) {
        return GSP.onScreens(barPlaces(S, env, bar, cycle).map(function (i) { return M.nameOf(S, i); }));
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
        return codesText(PSB.barCodes(S || {}, env, bar).map(function (c) { return c.code; }));
    }

    /**
     * The editor's bar picker (options resolver 'screenBarOptions'): your bars by name
     * (screens.js yourBars), each with what it holds and where it shows; one the screen shows
     * already (another row) is greyed out. While New status bar can make one (Pebble Time 2), its row
     * follows: an empty bar, made for this row.
     * @param {Object} S Settings.
     * @param {?Object} env Platform env.
     * @returns {Array} [label, kind, meta]
     */
    function barOptions(S, env) {
        var cycle = VC.screensCycle(S || {}, env);
        var list = M.screensOf(S || {}, env, cycle)[ED.i] || [], cur = list[ED.barRow] || {};
        var out = M.yourBars(S, env).map(function (bar) {
            var k = M.KIND_OF_BAR[bar], here = k !== cur.k && M.idxOf(list, k) >= 0;
            return [M.barName(S, bar), k, here ? { desc: 'Already on this screen', disabled: true }
                : { desc: barHolds(S, env, bar) + ' · ' + barWhere(S, env, bar, cycle).replace(/^On/, 'on') }];
        });
        if (M.freeBar(S, env)) { out.push(['New status bar', NEW_BAR, { add: true, desc: 'An empty status bar, for this screen' }]); }
        return out;
    }

    /**
     * The editor's bar pick (onChange 'screenBarPicked'): the row shows that bar instead, in
     * its place. New status bar makes an empty one for the row, whose dialog opens with its name field
     * ready once the picker has closed (ED.made, onClick's 'bar').
     * @param {Object} S Settings.
     * @param {*} oldValue The pick before.
     * @param {string} kind The bar's kind ('fcbar' | 'radarbar' | 'healthbar' | 'bar4' ...), or
     *   NEW_BAR.
     * @param {?Object} env Platform env.
     * @returns {void}
     */
    function screenBarPicked(S, oldValue, kind, env) {
        if (!ED.overlay) { return; }
        var list = M.screensOf(S, env)[ED.i] || [], j = ED.barRow, v = String(kind || '');
        if (!list[j] || !M.BAR_OF_KIND[list[j].k]) { return; }
        if (v === NEW_BAR) {
            var made = makeBar(S, env);
            S[SCREEN_BAR] = made ? M.KIND_OF_BAR[made] : oldValue;
            if (!made) { return; }
            ED.made = made;
            v = M.KIND_OF_BAR[made];
        }
        if (!M.BAR_OF_KIND[v] || list[j].k === v || M.idxOf(list, v) >= 0) { return; }
        var next = M.copy(list);
        next[j] = { k: v };
        writeScreen(S, ED.i, next, env);
    }

    // ── New status bar and Delete status bar (Pebble Time 2) ────────────────

    /**
     * What a bar's slots hold, by their items' names, the empty ones left out.
     * @param {string[]} codes Slot codes.
     * @returns {string}
     */
    function codesText(codes) {
        var labels = codes.filter(function (c) { return c !== 'empty'; })
            .map(function (c) { return (catalog.byCode(c) || {}).label || c; });
        return labels.length ? labels.join(' · ') : 'Nothing in it yet';
    }

    /**
     * How many of your bars there are, of the most a watch with bars 4 to 6 has: "4 of 6 status bars".
     * @param {Object} S Settings.
     * @param {?Object} env Platform env.
     * @returns {string}
     */
    function barCount(S, env) {
        return M.yourBars(S, env).length + ' of ' + M.MAX_BARS + ' status bars';
    }

    /**
     * The editor's + New status bar: an empty bar made (makeBar) and put on the screen being edited, at
     * a bar's place (screens.js add), its row open; then its dialog, its name field ready.
     * @param {Object} S Settings.
     * @param {?Object} env Platform env.
     * @returns {void}
     */
    function newBarHere(S, env) {
        var made = makeBar(S, env);
        if (!made) { return; }
        var next = M.add(M.screensOf(S, env)[ED.i] || [], M.KIND_OF_BAR[made]);
        ED.open = M.idxOf(next, M.KIND_OF_BAR[made]);
        commit(next);
        openBar(made, true, M.nameOf(S, ED.i), renderEditor);
    }

    /**
     * A bar's name committed in its dialog's title (onChange 'barRenamed', on each bar's name
     * key): trimmed and cut as names are kept (screens.js cleanName); its own name, or none,
     * stores '' (so it reads as its own name); one another bar has takes a number (freeName).
     * @param {Object} S Settings.
     * @param {*} oldValue The name before.
     * @param {string} value The name typed.
     * @param {?Object} env Platform env.
     * @param {string} key The bar's name key ('<prefix>Name').
     * @returns {void}
     */
    function barRenamed(S, oldValue, value, env, key) {
        var bar = null, name = M.cleanName(value);
        M.yourBars(S, env).forEach(function (b) { if (M.barNameKey(b) === key) { bar = b; } });
        if (!bar) { S[key] = name; return; }
        var own = M.KINDS[M.KIND_OF_BAR[bar]].name;
        var taken = M.yourBars(S, env).filter(function (b) { return b !== bar; })
            .map(function (b) { return M.barName(S, b); }).concat([M.barName(S, 'top')]);
        S[key] = !name || name === own ? '' : M.freeName(taken, name);
    }

    /**
     * Delete status bar (a made bar's dialog): the bar unmade and every screen's row that showed it off
     * (screens.js unmakeBar), the modes worked out again, and an Undo shown in the Your status bars card
     * for five seconds. The dialog closes with its bar gone (the engine closes a dialog whose
     * section no longer shows).
     * @param {Object} S Settings.
     * @param {string} bar 'bar4' | 'bar5' | 'bar6'
     * @param {?Object} env Platform env.
     * @returns {boolean} whether a bar went
     */
    function deleteBar(S, bar, env) {
        var name = M.barName(S, bar), snap = M.unmakeBar(S, bar, env);
        if (!snap) { return false; }
        applyModes(S, env);
        kit.flash(BAR_UNDO, { text: name + ' deleted.', snap: snap }, 5000, renderPage);
        return true;
    }

    // ── The Your status bars card and a bar's dialog (the Status bars tab) ───

    /**
     * The alerts placed on a bar, for its row on the Your status bars card: the icons the bar's dialog's
     * Alerts row shows (alerts-page.js onDemandBarIcons: "Left" and "Right", each with its
     * icons), '' with none placed or on a watch without alerts (aplite).
     * @param {Object} S Live settings.
     * @param {?Object} env Platform env.
     * @param {string} bar An on-demand.js BARS bar.
     * @returns {string} HTML
     */
    function barAlerts(S, env, bar) {
        var icons = env && env.onDemand && PConf && PConf.hintResolvers ? PConf.hintResolvers.get('onDemandBarIcons') : null;
        return icons ? icons(S, env, { bar: bar, where: '' }) : '';
    }

    /**
     * The Your status bars card (block 'barsList', the owner's pick, 2026-11-09), in the page's shared
     * parts (kit): a line per bar, the Watch bar first and then your bars (screens.js yourBars),
     * each its name, the screens that show it (none on aplite, which has one) and the alerts
     * placed on it (barAlerts; the owner's ask, 2026-11-09: seen without opening the bar), a tap
     * opening the bar's dialog (schema.js barDialog); under it the bar's picture, where a tap on
     * a slot opens its picker, dimmed while no screen shows it; and the red arrow of a row that
     * opens a screen of its own, in the middle of the whole row. Then New status bar with how many bars
     * there are (Pebble Time 2), or with six why there is none, and the Undo after a Delete status bar.
     * @param {Object} S Live settings.
     * @param {?Object} env Platform env.
     * @returns {string} HTML
     */
    function barsCard(S, env) {
        var st = S || {}, cycle = hasScreens(env) ? VC.screensCycle(st, env) : null;
        var h = ['top'].concat(M.yourBars(st, env)).map(function (bar) {
            var name = M.barName(st, bar), places = cycle ? barPlaces(st, env, bar, cycle) : null;
            var where = !places ? '' : places.length ? places.map(function (i) { return M.nameOf(st, i); }).join(', ')
                : 'No screen';
            var sheet = M.barSheet(bar), alerts = barAlerts(st, env, bar);
            return '<div class="ui-row bl-bar"><div class="bl-main"><button type="button" class="bl-name" data-edit-sheet="' + sheet
                + '"><span class="bl-line"><span class="ui-n">' + esc(name) + '</span>'
                + (where ? '<span class="ui-d">' + esc(where) + '</span>' : '') + '</span>'
                + (alerts ? '<span class="ui-d bl-al"><span class="bl-al-cap">Alerts</span><span class="bl-al-runs">' + alerts
                    + '</span></span>' : '') + '</button>'
                + PSB.barPicture(st, env, bar, { tappable: true, dim: Boolean(places && !places.length) }) + '</div>'
                // The arrow's own column, a second way into the dialog for a tap beside the
                // picture; the name above is the one a screen reader and the keyboard use.
                + '<button type="button" class="bl-go" data-edit-sheet="' + sheet + '" tabindex="-1" aria-hidden="true">'
                + kit.navArrow() + '</button></div>';
        }).join('');
        if (M.freeBar(st, env)) {
            h += kit.newRow('New status bar', barCount(st, env), { 'data-action': 'newBar' });
        } else if (env && env.extraBars) {
            h += '<div class="ui-row ui-foot">' + esc(BARS_FULL) + '</div>';
        }
        if (BAR_UNDO.v) { h += kit.undoToast(BAR_UNDO.v.text, { 'data-action': 'undoDeleteBar' }); }
        ensureStyle();
        return '<div class="ui-list">' + h + '</div>';
    }

    /**
     * A bar's dialog's picture (block 'barPicture', pinned above it): the bar as the watch draws
     * it, large, and where it shows under it. The dialog's sheet id names the bar (screens.js
     * barOfSheet).
     * @param {Object} S Live settings.
     * @param {?Object} env Platform env.
     * @param {?Object} userData Page userData (unused).
     * @param {{sheet: string}} [opts] The dialog it is pinned above (engine renderEditModal).
     * @returns {string} HTML ('' outside a bar's dialog)
     */
    function barDialogPicture(S, env, userData, opts) {
        var bar = M.barOfSheet(opts && opts.sheet);
        if (!bar) { return ''; }
        ensureStyle();
        return '<div class="bl-pin">' + PSB.barPicture(S || {}, env, bar, { big: true })
            + (hasScreens(env) ? '<div class="ui-d">' + esc(barWhere(S || {}, env, bar)) + '</div>' : '') + '</div>';
    }

    // ── Styles ──────────────────────────────────────────────────

    // The cards' and the editor's own look. Their lists, red arrows, folding chevrons, New rows,
    // Undo, notes, chips, Delete screen, the editor's header and the icons are the page's shared
    // parts (kit: config-ui/lib/ui.js, their look in shell.html); the editor's card is the
    // page's .card.
    var CSS = ''
        // The Screens card: a row per screen in the shared list, its ≡ (two screens or more), its
        // name over what it shows and the red arrow, then the ✕ of any but the first.
        + '.scr-row{position:relative;display:flex;align-items:stretch;background:var(--card);transition:transform .16s ease}'
        + '.scr-main{flex:1;min-width:0;display:flex;align-items:center;gap:12px;padding:14px 8px 14px 16px;border:none;'
        + 'background:none;text-align:left;cursor:pointer;color:var(--lbl);font:inherit}'
        + '.scr-main.g{padding-left:0}'
        + '.scr-mid{flex:1;min-width:0;display:block}'
        + '.scr-mid>span{display:block}'
        + '.scr-mid .ui-d{margin-top:1px}'
        + '.scr-x,.scr-xpad{flex:none;width:46px}'
        + '.scr-x{display:flex;align-items:center;justify-content:center;border:none;border-left:1px solid var(--row-line);'
        + 'background:none;color:var(--muted);cursor:pointer}'
        // The card's ≡: a row lifts and follows it, the others make room.
        + '.scr-row.lift{z-index:5;transition:none;background:var(--bg);border-radius:10px;'
        + 'box-shadow:0 12px 26px rgba(0,0,0,.3),0 0 0 1px var(--card-line)}'
        + '.scr-list.dragging{-webkit-user-select:none;user-select:none}'
        + '.scr-grip{flex:none;width:42px;display:flex;align-items:center;justify-content:center;margin:0;padding:0 0 0 4px;'
        + 'border:none;background:none;color:var(--faint);cursor:grab;touch-action:none;-webkit-appearance:none;appearance:none}'
        + '.scr-grip:focus-visible{outline:2px solid var(--link);outline-offset:-6px;border-radius:12px}'
        + '.scr-pill{display:inline-block;margin-left:8px;padding:2px 7px;border-radius:999px;background:var(--ctl);'
        + 'color:var(--muted);font:700 10.5px/1.3 Inter,system-ui,sans-serif;vertical-align:1px}'
        // The Your status bars card: a bar's name line and its alerts over its picture, and the red arrow
        // (its dialog) in a column of its own, in the middle of the whole row as on a nav row.
        + '.bl-bar{display:flex;align-items:stretch;gap:8px;padding:10px 16px 12px}'
        + '.bl-main{flex:1 1 auto;min-width:0}'
        + '.bl-name{display:block;width:100%;margin:0 0 7px;padding:3px 0;border:none;background:none;'
        + 'color:var(--lbl);text-align:left;font:inherit;cursor:pointer;-webkit-appearance:none;appearance:none}'
        + '.bl-line{display:flex;align-items:center;gap:8px}'
        + '.bl-line .ui-n{flex:1 1 auto;min-width:0}'
        + '.bl-line .ui-d{flex:0 1 auto;min-width:0;max-width:55%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
        // Alerts, then the sides' icon runs, a wrapped run lined up under the first.
        + '.bl-al{display:flex;align-items:flex-start;gap:8px;margin-top:4px}'
        + '.bl-al-cap{flex:none}'
        + '.bl-al-runs{flex:1 1 auto;min-width:0}'
        + '.bl-go{flex:none;display:flex;align-items:center;justify-content:flex-end;width:22px;margin:0;padding:0;border:none;'
        + 'background:none;cursor:pointer;-webkit-appearance:none;appearance:none}'
        // A bar's dialog's picture: the bar, large, where it shows under it.
        + '.bl-pin{display:grid;gap:8px}'
        + '.bl-pin .ui-d{text-align:center}'
        // The editor: a full-screen view (the wizard's pattern) under a dialog's header.
        + '#screenEditor{position:fixed;top:0;left:0;right:0;bottom:0;z-index:1000;display:flex;flex-direction:column;'
        + 'max-width:460px;margin:0 auto;background:var(--bg);color:var(--fg);font-family:Inter,system-ui,sans-serif}'
        + '#screenEditor .se-body{flex:1;min-height:0;overflow-y:auto;padding:4px 16px 28px;display:flex;flex-direction:column;gap:12px}'
        + '#screenEditor .se-body>*{flex:none}'
        + '#screenEditor .se-body>.card{margin:0}'
        + '.se-pic{display:flex;justify-content:center}'
        + '.se-pic-card{display:block;width:148px;border-radius:13px;overflow:hidden;line-height:0;'
        + 'box-shadow:0 8px 20px rgba(0,0,0,.28),0 0 0 1px var(--card-line)}'
        + '.se-pic-card svg{display:block;width:100%;height:auto}'
        // A row: its ≡, its name, what it shows while folded and the red ▸ (▾ while open), its ✕.
        + '.se-row{position:relative;display:grid;grid-template-columns:40px minmax(0,1fr) 44px;align-items:center;'
        + 'background:var(--card);transition:transform .16s ease}'
        + '.se-row+.se-row{border-top:1px solid var(--row-line)}'
        + '.se-row.lift{z-index:5;transition:none;background:var(--bg);border-radius:10px;'
        + 'box-shadow:0 12px 26px rgba(0,0,0,.3),0 0 0 1px var(--card-line)}'
        + '.se-list.dragging{-webkit-user-select:none;user-select:none}'
        + '.se-grip{align-self:stretch;display:flex;align-items:center;justify-content:center;color:var(--faint);cursor:grab;touch-action:none}'
        + '.se-grip.off{cursor:default}'
        + '.se-main{min-width:0;display:flex;align-items:center;gap:8px;padding:13px 2px 13px 0;'
        + 'border:none;background:none;text-align:left;color:var(--lbl);font:600 14px Inter,system-ui,sans-serif;cursor:pointer}'
        + '.se-main>span:first-child{flex:1 1 auto;min-width:0}'
        + '.se-main.fixed{cursor:default}'
        + '.se-val{flex:0 1 auto;min-width:0;font-size:12px;font-weight:600;color:var(--muted);white-space:nowrap;overflow:hidden;'
        + 'text-overflow:ellipsis}'
        + '.se-main .chev{width:12px;text-align:center}'
        + '.se-x{width:44px;height:44px;display:flex;align-items:center;justify-content:center;border:none;background:none;'
        + 'color:var(--muted);cursor:pointer}'
        + '.se-x .ui-ic{width:16px;height:16px}'
        + '.se-sub{grid-column:1/-1;padding:0 14px 12px 40px}'
        + '.se-off{font-size:12.5px;color:var(--lbl);display:flex;flex-wrap:wrap;gap:4px 8px;align-items:baseline}'
        + '.se-link{border:none;background:none;padding:0;color:var(--link);font:700 12.5px Inter,system-ui,sans-serif;cursor:pointer}'
        + '.se-more{display:grid;gap:4px}'
        // An open row's options, a line each: the option's name, then its control (a picker
        // and its Edit, as the page's rows have them, or the segments).
        + '.se-opt{display:flex;align-items:center;gap:8px;min-height:42px}'
        + '.se-cap{flex:1 1 auto;min-width:0;font:500 14px Inter,system-ui,sans-serif;color:var(--lbl)}'
        + '.se-opt .sel-wrap{flex:0 1 auto;min-width:0}'
        + '.se-moves{display:flex;gap:8px;margin-top:6px}'
        + '.se-mv{flex:1 1 0;display:inline-flex;align-items:center;justify-content:center;gap:6px;border:1px solid var(--ctl-line);'
        + 'background:var(--bg);color:var(--lbl);border-radius:9px;padding:8px 6px;font:600 12px Inter,system-ui,sans-serif;cursor:pointer}'
        + '.se-mv .ui-ic{width:14px;height:14px}'
        + '.se-mv:disabled{opacity:.4;cursor:default}'
        // Add's chips under the rows, the caption first.
        + '.se-adds{padding:12px 14px 14px;border-top:1px solid var(--row-line)}'
        + '.se-adds .ui-cap{margin-right:2px}'
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
    var UI = { ctx: null, toast: { v: null, t: null }, note: { v: null, t: null }, drag: null };

    /**
     * Repaint the settings page (a flash going).
     * @returns {void}
     */
    function renderPage() {
        if (UI.ctx) { UI.ctx.render(); }
    }

    /**
     * The Screens card's rows, in the page's shared parts (kit): one per screen, its name (the
     * top one's "Default" pill when it has a name of its own) over what it shows and the red
     * arrow of a row that opens a screen of its own (the editor); with two screens or more a ≡
     * that drags it (the arrow keys move it too) and the line that says so; a ✕ on each flick
     * screen; Add screen while there are fewer than three; why a move snapped back; the Undo
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
            return '<div class="ui-row scr-row" data-scr-row="' + i + '">'
                + (many ? '<button type="button" class="scr-grip" data-scr-grip="' + i + '" aria-label="Move ' + name
                    + ' (arrow keys)" aria-describedby="scrHint">' + kit.icon('grip') + '</button>' : '')
                + '<button type="button" class="scr-main' + (many ? ' g' : '') + '" data-action="openScreen" data-action-arg="' + i
                + '"><span class="scr-mid"><span class="ui-n">' + name + pill + '</span><span class="ui-d">'
                + esc(contents(list, s)) + '</span></span>' + kit.navArrow() + '</button>'
                + (i > 0 ? '<button type="button" class="scr-x" data-action="deleteScreen" data-action-arg="' + i
                    + '" aria-label="Delete ' + name + '">' + kit.icon('x') + '</button>' : '<span class="scr-xpad" aria-hidden="true"></span>')
                + '</div>';
        }).join('');
        var add = lists.length < M.MAX_SCREENS ? kit.newRow('Add screen', '', { 'data-action': 'addScreen' }) : '';
        var hint = many ? '<div class="ui-row ui-foot" id="scrHint">' + REORDER_HINT + '</div>' : '';
        var note = UI.note.v ? kit.note(UI.note.v) : '';
        var toast = UI.toast.v ? kit.undoToast(UI.toast.v.text, { 'data-action': 'undoDeleteScreen' }) : '';
        return '<div class="ui-list scr-list">' + rows + add + hint + note + toast + '</div>';
    }

    /**
     * Say why a move snapped back, under the card, for four seconds.
     * @param {string} text Why.
     * @returns {void}
     */
    function showNote(text) {
        kit.flash(UI.note, text, 4000, renderPage);
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
        if (why) { showNote(why); } else { UI.note.v = null; }
        UI.toast.v = null;
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
        kit.flash(UI.toast, { text: text, snap: snap }, 5000, renderPage);
    }

    // ── The editor ──────────────────────────────────────────────────────────

    // The overlay's state: what it shows ('edit' a screen, or 'add': Add a screen), the slot,
    // the row whose option is open, the snap-back message, the drag in progress, and the name's
    // input while the title is being renamed.
    var ED = { overlay: null, mode: 'edit', i: 0, open: -1, toast: { v: null, t: null }, drag: null, nameEl: null,
        barRow: -1, made: null };

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
     * An open row's picker line (the owner's, 2026-11-09: as the page's own rows pick things):
     * the option's name, a picker that names what the row shows (a tap opens the sheet), and
     * Edit beside it.
     * @param {string} cap The option's name.
     * @param {string} pick The picker's data-se.
     * @param {string} edit Edit's data-se.
     * @param {number} j The row.
     * @param {string} value What the row shows (plain text).
     * @param {string} editLabel Edit's accessible name (plain text).
     * @returns {string} HTML
     */
    function pickerLine(cap, pick, edit, j, value, editLabel) {
        return '<div class="se-opt"><span class="se-cap">' + cap + '</span>'
            + '<button type="button" class="sel-wrap" data-se="' + pick + '" data-j="' + j + '" aria-haspopup="dialog"'
            + ' aria-label="' + esc(cap + ': ' + value) + '"><span>' + esc(value) + '</span><i class="sel-chev"></i></button>'
            + '<button type="button" class="thr-btn" data-se="' + edit + '" data-j="' + j + '" aria-label="' + esc(editLabel)
            + '"><span>Edit</span></button></div>';
    }

    /**
     * The forecast row's Graph line (a watch with graph styles: emery): the picker of your
     * graphs, by the graph's name and length, and Edit, which opens the graph on the Graphs tab.
     * @param {Array<Object>} list The screen.
     * @param {number} j The row.
     * @param {Object} S Settings.
     * @param {?Object} env Platform env.
     * @returns {string} HTML
     */
    function styleHtml(list, j, S, env) {
        var k = blockStyle(list[j], S);
        return pickerLine('Graph', 'style', 'editstyle', j, GSP.label(S, env, k), 'Edit ' + GS.name(S, k) + ' on the Graphs tab');
    }

    /**
     * The other screens a bar row's bar shows on, beside the row's name: "Also on Home".
     * @param {Object} S Settings.
     * @param {?Object} env Platform env.
     * @param {string} bar An on-demand.js BARS bar.
     * @returns {string} '' when this screen alone shows it
     */
    function alsoOn(S, env, bar, cycle) {
        var others = barPlaces(S, env, bar, cycle).filter(function (i) { return i !== ED.i; });
        return others.length ? 'Also on ' + GSP.andList(others.map(function (i) { return M.nameOf(S, i); })) : '';
    }

    /**
     * An open bar row's Bar line: the picker of your bars, by the bar's name, and Edit, which
     * opens the bar's dialog over the editor; under it the other screens that show the bar (the
     * folded row says it beside its name).
     * @param {number} j The row.
     * @param {Object} S Settings.
     * @param {string} bar An on-demand.js BARS bar.
     * @param {string} also alsoOn's line ('' for none).
     * @returns {string} HTML
     */
    function barHtml(j, S, bar, also) {
        var name = M.barName(S, bar);
        return pickerLine('Status bar', 'bar', 'editbar', j, name, 'Edit ' + name) + (also ? '<div class="ui-d">' + esc(also) + '</div>' : '');
    }

    /**
     * One row of the list, folding as a collapsible card does (kit.foldChev): its ≡, its name,
     * what it shows while it is folded ("Graph 2 · Fill", as a folded card's header says its
     * pick) and the red ▸ of a row that opens in place, ▾ while its options show under it (the
     * values among them); then its ✕. The Watch bar's row neither folds nor moves.
     * @param {Array<Object>} list The screen.
     * @param {number} j The row.
     * @param {Object} S Settings.
     * @param {?Object} env Platform env.
     * @param {Array<?Array>} cycle The screens' cycle (view-cycle.js screensCycle).
     * @returns {string} HTML
     */
    function rowHtml(list, j, S, env, cycle) {
        var b = list[j], K = M.KINDS[b.k], fixed = b.k === 'strip', open = ED.open === j && !fixed;
        var keepClock = ED.i === 0 && b.k === 'clock', name = esc(M.blockName(b, S)), bar = M.BAR_OF_KIND[b.k];
        // The forecast graph's own graph (a watch with graph styles) beside its size, so the
        // folded row names it too: "Graph 2 · Fill".
        var styled = b.k === 'fc' && Boolean(env && env.graphStyles);
        var also = bar ? alsoOn(S, env, bar, cycle) : '';
        var val = open ? '' : b.k === 'cal' ? b.rows + ' rows' : styled ? GS.name(S, blockStyle(b, S)) + ' · ' + sizeLabel(b)
            : K.graph ? sizeLabel(b) : also;
        var h = '<div class="se-row" role="listitem" data-j="' + j + '">';
        h += fixed ? '<span class="se-grip off" aria-hidden="true"></span>'
            : '<span class="se-grip" data-grip="' + j + '" title="Drag to move" aria-hidden="true">' + kit.icon('grip') + '</span>';
        h += fixed ? '<span class="se-main fixed"><span>' + name + '</span></span>'
            : '<button type="button" class="se-main" data-se="expand" data-j="' + j + '" aria-expanded="' + open + '"><span>'
                + name + '</span>' + (val ? '<span class="se-val">' + esc(val) + '</span>' : '') + kit.foldChev(open) + '</button>';
        h += keepClock ? '<span class="se-x" aria-hidden="true"></span>'
            : '<button type="button" class="se-x" data-se="rm" data-j="' + j + '" aria-label="Remove ' + name + '">'
                + kit.icon('x') + '</button>';
        if (b.k === 'radar' && S.radarEnabled === false) {
            h += '<div class="se-sub se-off"><span>' + RADAR_OFF + '</span>'
                + '<button type="button" class="se-link" data-se="radaron">Turn on</button></div>';
        }
        if (open) {
            h += '<div class="se-sub se-more">' + (styled ? styleHtml(list, j, S, env) : '') + (bar ? barHtml(j, S, bar, also) : '');
            if (b.k === 'cal') { h += optHtml(list, j, 'Rows', 'rows', M.CAL_ROWS, env); }
            if (K.graph) { h += optHtml(list, j, 'Size', 'size', M.GRAPH_SIZES, env); }
            h += '<div class="se-moves"><button type="button" class="se-mv" data-se="up" data-j="' + j + '"'
                + (moveOk(list, j, j - 1) ? '' : ' disabled') + '>' + kit.icon('up') + 'Move up</button>'
                + '<button type="button" class="se-mv" data-se="down" data-j="' + j + '"'
                + (moveOk(list, j, j + 1) ? '' : ' disabled') + '>' + kit.icon('down') + 'Move down</button></div></div>';
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
        var adds = M.addable(list, env, S).filter(function (k) { return fitsWatch(M.add(list, k), i, env); });
        // + New status bar (Pebble Time 2): while New status bar can make a bar for this screen and it would fit.
        var free = M.newBarFor(list, S, env);
        var newBar = Boolean(free) && fitsWatch(M.add(list, free), i, env);
        var pic = screenPicture(S, i, env, userData, 'se' + i + '-', cycle).svg;
        var chips = adds.map(function (k) {
            return kit.chip(M.blockName({ k: k }, S), { 'data-se': 'add', 'data-k': k }, { icon: 'plus' });
        }).join('') + (newBar ? kit.chip('New status bar', { 'data-se': 'newbar' }, { icon: 'plus' }) : '');
        // The page's own card (the engine's .card and header), the Add chips under its rows, and
        // Delete screen under the card, as a dialog's Delete (kit.deleteButton).
        return '<div class="se-pic"><span class="se-pic-card" role="img" aria-label="' + esc(M.nameOf(S, i) + ': ' + contents(list, S))
            + '">' + pic + '</span></div>'
            + (note ? kit.note(note) : '')
            + '<div class="card se-card"><div class="cardHdr"><span class="ttlwrap"><span class="ttl" id="seTtl">Top to bottom</span>'
            + '</span></div><div class="se-list" id="seList" role="list" aria-labelledby="seTtl">'
            + list.map(function (b, j) { return rowHtml(list, j, S, env, cycle); }).join('') + '</div>'
            + (chips ? '<div class="ui-chips se-adds"><span class="ui-cap">Add</span>' + chips + '</div>' : '')
            + '</div>'
            + (i > 0 ? kit.deleteButton('Delete screen', { 'data-se': 'delscreen' }) : '');
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
     * The overlay's header, a dialog's (kit.header): ‹ back to the page (the edits stay: the
     * page's Save and Revert decide), the kicker over the title, and Done. The title is the
     * screen's name with the pencil that renames it, or "Add a screen" (no pencil, no Done).
     * While the name is renamed (ED.nameEl) the header is its field with OK and a repaint
     * leaves it alone, so typing goes on.
     * @param {Object} S Settings.
     * @param {boolean} [renaming] Draw the name field (startRename).
     * @returns {void}
     */
    function renderHeader(S, renaming) {
        if (ED.nameEl) { return; }
        var add = ED.mode === 'add', name = add ? 'Add a screen' : M.nameOf(S, ED.i);
        ED.overlay.querySelector('[data-se-head]').innerHTML = kit.header({
            titleId: 'seTitle', title: name, kicker: 'Screens',
            way: { glyph: '&#8249;', label: 'Back', at: { 'data-se': 'close' } },
            pen: add ? null : { 'data-se': 'rename' },
            done: add ? null : { 'data-se': 'close' },
            rename: renaming ? { at: { 'data-se-name': true }, okAt: { 'data-se': 'renameok' }, label: 'Screen name',
                maxlength: M.NAME_MAX, placeholder: NAMES[ED.i] || '', value: name } : null
        });
    }

    /**
     * Rename the screen: the title becomes its name field, focused and selected, with OK in
     * Done's place (as every rename on the page). OK, Enter or leaving it stores the name,
     * Escape keeps the old one (endRename).
     * @param {Object} S Settings.
     * @returns {void}
     */
    function startRename(S) {
        renderHeader(S, true);
        var input = ED.nameEl = ED.overlay.querySelector('[data-se-name]');
        input.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') { e.preventDefault(); endRename(input.value); }
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); endRename(null); }
        });
        input.addEventListener('blur', function (e) {
            var to = e.relatedTarget;
            if (to && to.getAttribute && to.getAttribute('data-se') === 'renameok') { return; }
            endRename(input.value);
        });
        input.focus();
        input.select();
    }

    /**
     * End the rename: the name typed stored (renameScreen), or with null nothing changed; the
     * focus back on the pencil.
     * @param {?string} text The name typed, or null to cancel.
     * @returns {void}
     */
    function endRename(text) {
        if (!ED.nameEl || !ED.overlay || !UI.ctx) { return; }
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
        renderHeader(ctx.S);
        body.innerHTML = add ? addBody(ctx.S, ctx.ENV, ctx.USERDATA) : editorBody(ctx.S, ctx.ENV, ctx.USERDATA);
        body.scrollTop = top;
        // Why a move went back: the page's toast (shell.html .toast), for three seconds.
        var t = ED.overlay.querySelector('[data-se-toast]');
        t.textContent = ED.toast.v || '';
        t.className = ED.toast.v ? 'toast show' : 'toast';
    }

    /**
     * Say why a move snapped back, for three seconds.
     * @param {string} text The rule.
     * @returns {void}
     */
    function editorToast(text) {
        kit.flash(ED.toast, text, 3000, renderEditor);
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
        if (e.key !== 'Escape' || ED.nameEl) { return; }
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
        if (act === 'rename') { startRename(S); return; }
        if (act === 'renameok') { if (ED.nameEl) { endRename(ED.nameEl.value); } return; }
        // Add a screen's pick: the screen added after the others (addChosen), its editor next.
        if (act === 'pick') {
            var slot = t.disabled ? -1 : addChosen(S, env, t.getAttribute('data-id'));
            if (slot < 0) { return; }
            UI.toast.v = null;
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
        // A bar row's Bar picker: the picker of your bars opens over the editor, its pick lands
        // through screenBarPicked; a bar New status bar made there opens next, its name field ready.
        if (act === 'bar') {
            ED.barRow = j;
            ED.made = null;
            S[SCREEN_BAR] = list[j] ? list[j].k : '';
            ctx.openSheet(SCREEN_BAR, function () {
                renderEditor();
                var made = ED.made;
                ED.made = null;
                if (made && ED.overlay) { openBar(made, true, M.nameOf(S, ED.i), renderEditor); }
            });
            return;
        }
        // + New status bar: an empty bar on this screen, its dialog next (newBarHere).
        if (act === 'newbar') { newBarHere(S, env); return; }
        // A bar row's Edit: the bar's dialog over the editor, which repaints as it closes.
        if (act === 'editbar') {
            if (list[j] && M.BAR_OF_KIND[list[j].k]) { openBar(M.BAR_OF_KIND[list[j].k], false, M.nameOf(S, ED.i), renderEditor); }
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
        ED.toast.v = null;
        ED.nameEl = null;
        var overlay = document.createElement('div');
        overlay.id = 'screenEditor';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.setAttribute('aria-labelledby', 'seTitle');
        overlay.innerHTML = '<div data-se-head></div><div class="se-body" data-se-body></div>'
            + '<div class="toast" role="status" data-se-toast></div>';
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
        if (PConf.blocks) {
            PConf.blocks.register('screensCard', screensCard);
            PConf.blocks.register('barsList', barsCard);
            PConf.blocks.register('barPicture', barDialogPicture);
        }
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
        // New status bar, Delete status bar and its Undo (the Status bars tab, Pebble Time 2): New status bar makes an
        // empty bar and opens its dialog, its name field ready.
        PConf.actions.newBar = function (arg, S, env) {
            var made = makeBar(S, env);
            if (made) { openBar(made, true, 'Your status bars', null); }
            return !made;
        };
        PConf.actions.deleteBar = function (arg, S, env) { return deleteBar(S, String(arg || ''), env); };
        PConf.actions.undoDeleteBar = function (arg, S, env) { return takeUndo(BAR_UNDO, S, env); };
        PConf.actions.undoDeleteScreen = function (arg, S, env) { return takeUndo(UI.toast, S, env); };
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
            PConf.onChange.register('barRenamed', barRenamed);
        }
        // Your status bars by name (screens.js barName): their dialogs' titles and their slot pickers'.
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
        if (PConf.hintResolvers) { PConf.hintResolvers.register('batterySaverPauseHint', batterySaverPauseHint); }
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
        addChoices: addChoices,
        addChosen: addChosen,
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
        barRenamed: barRenamed,
        barsCard: barsCard,
        barDialogPicture: barDialogPicture,
        batterySaverPauseHint: batterySaverPauseHint
    };
    if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
    if (typeof window !== 'undefined') { window.ScreensPage = api; }
})();
