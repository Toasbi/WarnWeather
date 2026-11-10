// src/pkjs/settings/screens-page.js — ES5, WebView (+ Node for tests). The Watchface tab's
// screens: the Screens card (one row per screen by its name, ending on the red arrow that opens
// its editor, dragged by its ≡ or moved with the arrow keys, the top one the Default; a ✕ with
// Undo on each other; "+ Add screen"), the Add a screen sheet (Blank, then the presets this
// watch can draw: screen-presets.js), the screen editor (a full-screen view under a dialog's
// header: the screen's name, which its pencil renames with an OK button, its picture and its
// rows top to bottom, each by its name, dragged by its ≡ or moved with the arrow keys, the
// calendar's rows and a graph's size as a dropdown that opens its picker; then the Add chips,
// one per thing the screen can take: each of your status bars, New status bar, and with
// several graphs each graph, or, once the screen has its forecast graph, Switch graph's chip
// per other graph, which puts that one in its place; and Delete screen under the card), the
// Status bars tab's Your status bars card (each bar's
// name, the screens that show it, the alerts placed on it and its picture, whose slots a tap
// changes, the red arrow in the middle of the row; a tap on the name opens the bar's dialog,
// schema.js barDialog, which pins the bar's picture; New status bar makes an empty bar and opens
// it), Setup's Rain radar picker (Off keeps the source) and the modes the page works out from
// the screens. Every arrow, dropdown, Delete, Undo, chip and header is the page's shared part
// (config-ui/lib/ui.js).
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
    // Graph styles (Pebble Time 2): the graphs the Add chips offer and their names, and the limit
    // (graph-styles-page.js; graph-styles.js the model).
    var GSP = (typeof require !== 'undefined') ? require('./graph-styles-page.js') : window.GraphStylesPage;
    var GS = (typeof require !== 'undefined') ? require('../graph-styles.js') : window.GraphStyles;
    // The screens Add screen offers after Blank.
    var PRESETS = (typeof require !== 'undefined') ? require('../screen-presets.js') : window.ScreenPresets;
    // What a screen's graphs draw, as a legend (Add a screen's cards and its picked screen).
    var LEGEND = (typeof require !== 'undefined') ? require('./screen-legend.js') : window.ScreenLegend;
    // The page's one escape helper (config-ui/lib/html.js, concatenated ahead of every app file).
    var html = (typeof require !== 'undefined') ? require('../config-ui/lib/html.js') : PConf.html;
    var esc = html.esc;
    // The page's shared parts (config-ui/lib/ui.js): the lists' rows, red arrows, New rows and
    // Undo (with the timer that takes a message away: flash), the editor's header, its rows'
    // dropdowns, its chips and Delete screen, the icons.
    var kit = (typeof require !== 'undefined') ? require('../config-ui/lib/ui.js') : PConf.ui;

    // The places' names, the Default first (a screen's own name: screens.js nameOf).
    var NAMES = M.NAMES;
    // A new screen: the Watch bar and the Clock.
    var NEW_SCREEN = PRESETS.BLANK;
    // The per-view keys a screen owns (custom-layout-schema.js customViewItems): a moved, deleted
    // or restored screen takes all of them along, its graph style (viewStyle) and name too.
    var VIEW_STEMS = ['Top', 'Body', 'Upper', 'Lower', 'Order', 'TopSize', 'BodySize', 'Align', 'ClockOff', 'StripOff',
        'Style', 'Name'];
    var TOO_TALL = 'Too tall for the watch. Remove a row or make a graph smaller.';
    var NOTHING_YET = 'Nothing on this screen yet, so the watch skips it.';
    var RADAR_OFF = 'The rain radar is off.';
    // Why a move snaps back: the top screen always shows the clock (the watch keeps it).
    var NO_ROOM_FOR_CLOCK = ' has no room for the clock, which the top screen always shows.';
    // A template's graph on a screen (graph-styles.js TEMPLATE GRAPHS): what its row says, and
    // why Edit graph cannot make it one of yours.
    var TEMPLATE_NOTE = 'Not one of your graphs until you edit it.';
    var NO_GRAPH_ROOM = 'You have ' + GS.MAX_STYLES + ' graphs already. Delete one on the Graphs tab to edit this one.';
    // How to reorder, under the Screens card's screens and the screen editor's rows; "Drag ≡" kept
    // on one line (a no-break space).
    var REORDER_HINT = 'Each flick shows the next one. Drag\u00a0≡ to change the order.';
    var ROWS_HINT = 'Drag\u00a0≡ to change the order.';
    // The screen editor's Add groups, in the order they show (the owner's ask, 2026-11-09: the
    // chips grouped by what they add), each with its caption, or capOf, which writes it from the
    // chips it holds ("Add the calendar or the clock"). Switch graph holds the graphs a screen
    // with a forecast graph can draw in its place (the owner's ask, 2026-11-09: switchOffers).
    var ADD_GROUPS = [{ id: 'bars', cap: 'Add a status bar' }, { id: 'graphs', cap: 'Add a graph' },
        { id: 'switch', cap: 'Switch graph' }, { id: 'rows',
            capOf: function (offers) {
                return 'Add ' + html.andList(offers.map(function (o) { return 'the ' + o.label.toLowerCase(); }), 'or');
            } }];
    // The editor's Rows and Size picker (custom-layout-schema.js: a page-only select), for the row
    // in ED.sizeRow: the calendar's rows, a graph's size; why it greys one out.
    var SCREEN_SIZE = 'screenRowSize';
    var FC_TOO_SMALL = 'Too small for the high and low temperatures';
    var NO_ROOM = 'Too tall for the watch';
    var FILL = 'All the room the other rows leave';
    var BARS_FULL = 'That’s the most status bars there can be: the Watch bar and ' + M.MAX_BARS
        + ' more. To make another, delete one you made.';
    // A Delete status bar's Undo while it shows (the Your status bars card).
    var BAR_UNDO = { v: null, t: null };
    // What a screen brings, under Add a screen's cards: with graph styles, and on a watch with
    // one graph (screen-presets.js WHAT A SCREEN BRINGS).
    var ADD_FINE = 'A forecast screen draws its template’s graph. It becomes one of your graphs only when you edit it.'
        + ' Your status bars keep what they show.';
    var ADD_FINE_ONE_GRAPH = 'A screen brings its rows. Your graph and your status bars stay as they are.';
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
        // A template's graph no screen draws any more goes with it (graph-styles.js TEMPLATE GRAPHS).
        var kept = GS.pruneTemplates(S);
        if (kept !== (S.graphStyles || '')) { S.graphStyles = kept; }
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
     * The view keys of every slot and the screen count, for Undo, and the graphs' item, which
     * holds a template's graph a deleted screen drew (editScreens drops it with the screen).
     * @param {Object} S Settings.
     * @returns {Object} key -> value
     */
    function snapshot(S) {
        var out = { viewCount: S.viewCount, layoutPreset: S.layoutPreset, customLayoutSeeded: S.customLayoutSeeded };
        if (Object.prototype.hasOwnProperty.call(S, 'graphStyles')) { out.graphStyles = S.graphStyles; }
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
     * New status bar, wherever it is tapped (the Your status bars card, the editor's + New status
     * bar): screens.js makeBar, and a Delete status bar's Undo dropped, since the bar made can be
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
     * A screen's name that no other screen has: the name, else the name with the first free
     * number ("Classic 2"), so a screen added twice is told apart.
     * @param {Object} S Settings (the screen in slot n already).
     * @param {?Object} env Platform env.
     * @param {string} name The name it would have.
     * @param {number} n Its slot.
     * @returns {string}
     */
    function freeName(S, env, name, n) {
        var taken = M.screensOf(S, env).map(function (l, i) { return i === n ? '' : M.nameOf(S, i); });
        if (taken.indexOf(name) === -1) { return name; }
        for (var k = 2; taken.indexOf(name + ' ' + k) !== -1; k++) { /* the first free number */ }
        return name + ' ' + k;
    }

    /**
     * What a screen added with no calendar or length named starts on (addChosen): the Default
     * screen's calendar and, for a forecast screen on a watch with graph styles, its template's
     * length (screen-presets.js spanOf). Add a screen's cards name their own calendar.
     * @param {Object} S Settings.
     * @param {?Object} env Platform env.
     * @param {Object} kind A screen-presets.js KINDS entry.
     * @returns {{cal: string, span: string}}
     */
    function addStart(S, env, kind) {
        return { cal: PRESETS.calendars(kind).length ? PRESETS.calOf(M.screensOf(S, env)[0]) : '',
            span: PRESETS.spanOf(kind, env) };
    }

    /**
     * One screen Add a screen can add: a kind with its calendar and, for a forecast screen on a
     * watch with graph styles, its length, as the screen it adds after the others. A forecast
     * screen there draws its template's graph (graph-styles-page.js templateGraph: a template
     * graph, never one of the six, so no screen waits for a free graph). `W` is the settings with
     * it added, which its picture draws (the radar on where the screen shows it, as adding it
     * turns it on); `why` says why it cannot be added: its graph would make more metrics than the
     * watch shows.
     * @param {Object} N Settings as stored (graph-styles-page.js asStored).
     * @param {?Object} env Platform env.
     * @param {Array<Array<Object>>} lists The screens.
     * @param {Object} kind A screen-presets.js KINDS entry.
     * @param {string} cal Its calendar: '' | '2' | '3' | screen-presets.js DENSE.
     * @param {string} span Its graph's length ('12' | '24' | '48'), '' where it has none.
     * `calName` names its calendar ('' on a screen of two graphs), for a screen reader: its
     * picture shows it. `W` holds the modes the screens need with it added (applyModes), so its
     * picture draws the radar as the watch will (the radar's sky rows draw as a graph only).
     * @param {{graph: ?Object, why: string}} [known] What the same kind at the same length found on
     *     another calendar: its graph and why it cannot be added, the same on every calendar (a
     *     calendar takes no graph and draws no metric), so Add a screen's cards read them once.
     * @returns {{id: string, name: string, calName: string, look: ?string, cal: string, span: string,
     *   list: Array<Object>, graph: ?{k: number, values: Object}, W: Object, n: number, why: string}}
     */
    function addChoice(N, env, lists, kind, cal, span, known) {
        var n = lists.length, list = PRESETS.screenOf(kind, cal), why = known ? known.why : '';
        var styled = Boolean(kind.look && env && env.graphStyles);
        var graph = known ? known.graph : styled ? GSP.templateGraph(N, env, kind.look, span) : null;
        if (graph) { list[M.idxOf(list, 'fc')].style = GS.codeOf(graph.k); }
        var W = Object.assign({}, N);
        if (graph) { W.graphStyles = GS.withTemplate(W, graph.k, kind.look, graph.values); }
        if (PRESETS.showsRadar(kind, cal)) { W.radarEnabled = true; }
        ensureCustom(W, env);
        putScreen(W, n, list);
        applyModes(W, env);
        W['viewAlign' + n] = 'clock';
        W['viewName' + n] = kind.name;
        if (!known && graph && GSP.screenOverflows(W, env, n, graph.k)) { why = GSP.limitDesc(W, env, graph.k); }
        return { id: kind.id, name: kind.name, calName: PRESETS.calendarName(kind, cal), look: kind.look, cal: cal,
            span: span, list: list, graph: graph, W: W, n: n, why: why };
    }

    /**
     * Add a screen's cards: each kind this watch can draw once per calendar it can have
     * (screen-presets.js cards; each fits every watch it is offered, with every calendar,
     * test/config-screen-presets.test.js), each as addChoice reads it on its template's length
     * (screen-presets.js spanOf). None with three screens already.
     * @param {Object} S Settings.
     * @param {?Object} env Platform env.
     * @returns {Array<Object>}
     */
    function addChoices(S, env) {
        var N = GSP.asStored(S), lists = M.screensOf(N, env), known = {};
        if (lists.length >= M.MAX_SCREENS) { return []; }
        return PRESETS.cards(env).map(function (card) {
            var span = PRESETS.spanOf(card.kind, env), key = card.kind.id + ':' + span;
            var c = addChoice(N, env, lists, card.kind, card.cal, span, known[key]);
            known[key] = known[key] || { graph: c.graph, why: c.why };
            return c;
        });
    }

    /**
     * Add the screen a kind stands for, with its calendar and length, after the others: a
     * forecast screen's template graph stored first (graph-styles.js TEMPLATE GRAPHS), the rain
     * radar turned on where the screen shows it, the screen named after its kind (freeName).
     * Mutates S.
     * @param {Object} S Settings.
     * @param {?Object} env Platform env.
     * @param {string} id A kind's id.
     * @param {string} [cal] Its calendar ('' | '2' | '3' | screen-presets.js DENSE); the Default
     *   screen's without.
     * @param {string} [span] Its graph's length; its template's without.
     * @returns {number} the new screen's slot, -1 for none (no room, it cannot be added, no such kind)
     */
    function addChosen(S, env, id, cal, span) {
        var N = GSP.asStored(S), lists = M.screensOf(N, env), kind = PRESETS.byId(id);
        if (lists.length >= M.MAX_SCREENS || !(kind && PRESETS.drawable(kind, env))) { return -1; }
        var start = addStart(N, env, kind);
        var c = addChoice(N, env, lists, kind, cal === undefined ? start.cal : cal, span || start.span);
        if (c.why) { return -1; }
        var held = S.graphStyles;
        if (c.graph) {
            GSP.settle(S);
            held = S.graphStyles;
            S.graphStyles = GS.withTemplate(S, c.graph.k, c.look, c.graph.values);
        }
        var turnOn = PRESETS.showsRadar(kind, c.cal) && S.radarEnabled === false;
        if (turnOn) { setRadarEnabled(S, true, env); }
        if (!insertScreen(S, c.n, M.copy(c.list), env)) {
            if (turnOn) { setRadarEnabled(S, false, env); }
            if (c.graph) { S.graphStyles = held; }
            return -1;
        }
        S['viewName' + c.n] = freeName(S, env, c.name, c.n);
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
     * its picture in its dialog).
     * @param {Object} S Settings.
     * @param {?Object} env Platform env.
     * @param {string} bar An on-demand.js BARS bar.
     * @param {Array<?Object>} [cycle] VC.screensCycle(S, env), when the caller has it already.
     * @returns {string}
     */
    function barWhere(S, env, bar, cycle) {
        return GSP.onScreens(barPlaces(S, env, bar, cycle).map(function (i) { return M.nameOf(S, i); }));
    }

    // ── New status bar and Delete status bar (Pebble Time 2) ────────────────

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
        // A row: its ≡, its name, the calendar's rows or a graph's size (a dropdown), its ✕.
        // Where the name and the dropdowns do not fit side by side, the dropdowns go under it.
        + '.se-row{position:relative;display:grid;grid-template-columns:40px minmax(0,1fr) 44px;align-items:center;'
        + 'background:var(--card);transition:transform .16s ease}'
        + '.se-row+.se-row{border-top:1px solid var(--row-line)}'
        + '.se-row.lift{z-index:5;transition:none;background:var(--bg);border-radius:10px;'
        + 'box-shadow:0 12px 26px rgba(0,0,0,.3),0 0 0 1px var(--card-line)}'
        + '.se-list.dragging{-webkit-user-select:none;user-select:none}'
        + '.se-grip{align-self:stretch;display:flex;align-items:center;justify-content:center;margin:0;padding:0;border:none;'
        + 'background:none;color:var(--faint);cursor:grab;touch-action:none;-webkit-appearance:none;appearance:none}'
        + '.se-grip:focus-visible{outline:2px solid var(--link);outline-offset:-6px;border-radius:12px}'
        + '.se-grip.off{cursor:default}'
        + '.se-mid{min-width:0;min-height:52px;display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px;padding:8px 0}'
        + '.se-name{flex:1 1 auto;min-width:0;font:600 14px Inter,system-ui,sans-serif;color:var(--lbl);overflow-wrap:anywhere}'
        + '.se-ctl{flex:0 1 auto;min-width:0;max-width:100%;display:flex;gap:6px;margin-left:auto}'
        + '.se-ctl .sel-wrap{flex:0 1 auto;min-width:0}'
        + '.se-x{width:44px;height:44px;display:flex;align-items:center;justify-content:center;border:none;background:none;'
        + 'color:var(--muted);cursor:pointer}'
        + '.se-x .ui-ic{width:16px;height:16px}'
        + '.se-sub{grid-column:1/-1;padding:0 14px 12px 40px}'
        + '.se-off{font-size:12.5px;color:var(--lbl);display:flex;flex-wrap:wrap;gap:4px 8px;align-items:baseline}'
        + '.se-link{border:none;background:none;padding:0;color:var(--link);font:700 12.5px Inter,system-ui,sans-serif;cursor:pointer}'
        // How to reorder, under the rows; the Add groups under it, each its caption over its chips.
        + '.se-hint{border-top:1px solid var(--row-line)}'
        + '.se-adds{display:grid;gap:14px;padding:12px 14px 14px;border-top:1px solid var(--row-line)}'
        + '.se-add{display:grid;gap:7px}'
        // Add a screen: a row per group, its cards side by side, scrolled sideways (the owner's,
        // 2026-11-10), out to the body's edges; a card its picture beside its name and legend
        // (screen-legend.js), as tall as the picture. A picked one big, what it shows (the legend
        // as a list), its Forecast length (a segmented control) and Add screen.
        + '.sa-group{display:grid;gap:8px;min-width:0}'
        + '.sa-group+.sa-group{margin-top:6px}'
        + '.sa-group>.ui-cap{padding:0 4px}'
        + '.sa-strip{display:flex;gap:10px;margin:0 -16px;padding:2px 16px 6px;overflow-x:auto;overflow-y:hidden;'
        + '-webkit-overflow-scrolling:touch;scroll-snap-type:x proximity;scroll-padding:0 16px;scrollbar-width:none}'
        + '.sa-strip::-webkit-scrollbar{display:none}'
        + '.sa-card{flex:0 0 auto;display:flex;align-items:flex-start;gap:12px;min-width:0;margin:0;padding:12px;'
        + 'border:none;border-radius:14px;background:var(--card);box-shadow:0 0 0 1px var(--card-line);'
        + 'color:var(--lbl);text-align:left;font:inherit;cursor:pointer;scroll-snap-align:start;'
        + '-webkit-appearance:none;appearance:none}'
        + '.sa-pic{display:block;flex:0 0 auto;width:96px;border-radius:9px;overflow:hidden;line-height:0;'
        + 'box-shadow:0 0 0 1px var(--card-line)}'
        + '.sa-pic svg{display:block;width:100%;height:auto}'
        + '.sa-txt{display:grid;align-content:start;gap:6px;min-width:0;width:112px;padding-top:1px}'
        + '.sa-n{font:700 13.5px/1.25 Inter,system-ui,sans-serif;color:var(--lbl)}'
        + '.sa-fine{padding:2px 4px;font-size:12px;line-height:1.45;color:var(--hint)}'
        + '.sa-cfg{display:grid;gap:14px}'
        + '.sa-big{justify-self:center;width:160px;border-radius:14px;overflow:hidden;line-height:0;'
        + 'box-shadow:0 0 0 1px var(--card-line)}'
        + '.sa-big svg{display:block;width:100%;height:auto}'
        + '.sa-row{display:grid;gap:9px}'
        + '.sa-lbl{font:700 12.5px/1.3 Inter,system-ui,sans-serif;color:var(--lbl);padding:0 3px}'
        + '.sa-why,.sa-gap{padding:0 3px;font-size:12.5px;line-height:1.45;color:var(--hint)}'
        + '.sa-add{width:100%;min-height:44px;margin-top:2px;border:none;border-radius:12px;'
        + 'background:linear-gradient(135deg,#FA4A35,#D93A24);color:#FFFFFF;font:700 15px Inter,system-ui,sans-serif;'
        + 'box-shadow:0 4px 14px rgba(250,74,53,.35);cursor:pointer}'
        + '.sa-add[disabled]{opacity:.4;box-shadow:none;cursor:default}';

    /**
     * Put the styles on the page once.
     * @returns {void}
     */
    function ensureStyle() {
        if (typeof document === 'undefined' || !document.getElementById || document.getElementById('scr-style')) { return; }
        var el = document.createElement('style');
        el.id = 'scr-style';
        el.textContent = CSS + LEGEND.CSS;
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
    // the row whose Rows or Size picker is open, the snap-back message, the drag in progress,
    // the name's input while the title is being renamed, Add a screen's pick while it shows one
    // (its kind, calendar and length: addPick), where its cards were scrolled to then
    // (cardsPlace), whether its cards are drawn (renderAdd: once while it is open, as nothing
    // under the overlay changes the settings they are drawn from) and the overlay's opening,
    // counted (a picture drawn after it opened is drawn for that one only: fillPictures).
    var ED = { overlay: null, mode: 'edit', i: 0, sizeRow: -1, toast: { v: null, t: null }, drag: null, nameEl: null,
        pick: null, cardsAt: null, drawn: false, opened: 0 };
    // Add a screen's pictures (the owner's ask, 2026-11-10: it opened slowly with a card per
    // preset and calendar): the first EAGER cards of each row draw theirs as it opens, the rest
    // FILL_STEP at a time after it, FILL_GAP ms (a frame) apart, a column of every row at a time
    // (fillPictures).
    var EAGER = 2, FILL_STEP = 3, FILL_GAP = 16;

    /**
     * A size as its dropdown and its picker read it: "2 rows", "Fill".
     * @param {string} v The calendar's rows or a graph's size ('2' | '3' | '4' | 'fill').
     * @returns {string}
     */
    function sizeLabel(v) {
        return v === 'fill' ? 'Fill' : v + ' rows';
    }

    /**
     * The style a forecast block draws: its own while it exists, else the first
     * (graph-styles-page.js drawnBy).
     * @param {Object} b The forecast block.
     * @param {Object} S Settings.
     * @returns {number} A style index.
     */
    function blockStyle(b, S) {
        return GSP.drawnBy(S, b);
    }

    /**
     * The template graph screen i's forecast graph draws (a screen Add a screen added: the
     * owner's, 2026-11-10), as its row reads it.
     * @param {Object} S Settings.
     * @param {?Object} env Platform env.
     * @param {Array<Object>} list The screen.
     * @returns {number} its index, -1 where the screen draws one of your graphs or none
     */
    function templateOf(S, env, list) {
        var at = M.idxOf(list, 'fc'), k = at < 0 || !(env && env.graphStyles) ? -1 : blockStyle(list[at], S);
        return GS.isTemplate(k) ? k : -1;
    }

    /**
     * The option a row's Rows or Size picker sets: the calendar's rows, a graph's size.
     * @param {Object} b A block.
     * @returns {?{key: string, values: Array<string>, cap: string}} null for a row without one
     */
    function sizeOf(b) {
        if (b.k === 'cal') { return { key: 'rows', values: M.CAL_ROWS, cap: 'Rows' }; }
        return M.isGraph(b) ? { key: 'size', values: M.GRAPH_SIZES, cap: 'Size' } : null;
    }

    /**
     * The row whose Rows or Size picker is open (ED.sizeRow) on the screen being edited.
     * @param {Object} S Settings.
     * @param {?Object} env Platform env.
     * @returns {?{list: Array<Object>, j: number, b: Object, opt: Object}} null when the row is
     *   gone or picks no size
     */
    function sizeRow(S, env) {
        var list = M.screensOf(S || {}, env)[ED.i] || [], b = list[ED.sizeRow], opt = b ? sizeOf(b) : null;
        return opt ? { list: list, j: ED.sizeRow, b: b, opt: opt } : null;
    }

    /**
     * The Rows and Size picker's options (options resolver 'screenRowSizeOptions'): the
     * calendar's 2 or 3 rows, a graph's 2, 3 or 4 rows or Fill. A size the watch has no room
     * for is greyed out, and so is the forecast graph's 2 rows (its high and low would overlap:
     * screens.js), each saying why.
     * @param {Object} S Settings.
     * @param {?Object} env Platform env.
     * @returns {Array} [label, value, meta]
     */
    function sizeOptions(S, env) {
        var r = sizeRow(S, env);
        if (!r) { return []; }
        return r.opt.values.map(function (v) {
            var why = v === r.b[r.opt.key] ? ''
                : r.b.k === 'fc' && v === '2' ? FC_TOO_SMALL
                : !fitsWatch(M.setOption(r.list, r.j, r.opt.key, v), ED.i, env) ? NO_ROOM : '';
            return [sizeLabel(v), v, why ? { desc: why, disabled: true } : v === 'fill' ? { desc: FILL } : {}];
        });
    }

    /**
     * The Rows and Size picker's title (display resolver 'screenRowSizeTitle'): "Calendar rows",
     * "Forecast graph size".
     * @param {Object} S Settings.
     * @param {?Object} env Platform env.
     * @returns {string} '' with no row (the select's own label stands)
     */
    function sizeTitle(S, env) {
        var r = sizeRow(S, env);
        return r ? M.blockName(r.b, S) + ' ' + r.opt.cap.toLowerCase() : '';
    }

    /**
     * A Rows or Size pick (onChange 'screenRowSizePicked'): the row takes it (screens.js
     * setOption: a graph set to Fill turns a filling other into 3 rows). A greyed-out size is
     * never taken.
     * @param {Object} S Settings.
     * @param {*} oldValue The pick before.
     * @param {string} value The size picked.
     * @param {?Object} env Platform env.
     * @returns {void}
     */
    function sizePicked(S, oldValue, value, env) {
        if (!ED.overlay) { return; }
        var r = sizeRow(S, env), v = String(value || '');
        var ok = sizeOptions(S, env).some(function (o) { return o[1] === v && !o[2].disabled; });
        if (!r || !ok || r.b[r.opt.key] === v) { return; }
        writeScreen(S, ED.i, M.setOption(r.list, r.j, r.opt.key, v), env);
    }

    /**
     * Whether the screens pick among several graphs (graph styles, Pebble Time 2): then the
     * forecast graph comes in by a chip per graph (graphOffers), switches by one (switchOffers)
     * and its row names its graph.
     * @param {Object} S Settings.
     * @param {?Object} env Platform env.
     * @returns {boolean}
     */
    function manyGraphs(S, env) {
        return Boolean(env && env.graphStyles) && GS.count(S) > 1;
    }

    /**
     * A row's name in the list: with several graphs the forecast graph's is its graph's ("Long"),
     * and a template's graph is its template's ("Outdoor"), as a status bar's is its bar's; any
     * other row's is its kind's (screens.js blockName).
     * @param {Object} b A block.
     * @param {Object} S Settings.
     * @param {?Object} env Platform env.
     * @returns {string}
     */
    function rowName(b, S, env) {
        if (b.k !== 'fc' || !(env && env.graphStyles)) { return M.blockName(b, S); }
        var k = blockStyle(b, S);
        return manyGraphs(S, env) || GS.isTemplate(k) ? GSP.graphName(S, env, k) : M.blockName(b, S);
    }

    /**
     * One row of the list (the owner's picks, 2026-11-09): its ≡, its name, the calendar's rows
     * or a graph's size as a dropdown that opens its picker, and its ✕. Which bar or graph a row
     * is was picked by its Add chip, so nothing else sits on the row: the Status bars tab edits a
     * bar, the Graphs tab a graph. The ≡ drags the row, and the arrow keys move it while it has
     * the focus. The Watch bar's row does not move; the Default screen's Clock has no ✕.
     * @param {Array<Object>} list The screen.
     * @param {number} j The row.
     * @param {Object} S Settings.
     * @param {?Object} env Platform env.
     * @returns {string} HTML
     */
    function rowHtml(list, j, S, env) {
        var b = list[j], fixed = !moves(b), keepClock = ED.i === 0 && b.k === 'clock';
        var name = rowName(b, S, env), size = sizeOf(b), ctl = '';
        if (size) {
            var shown = sizeLabel(b[size.key]);
            ctl = kit.dropdown(shown, { 'data-se': 'size', 'data-j': j, 'aria-haspopup': 'dialog',
                'aria-label': size.cap + ': ' + shown });
        }
        var h = '<div class="se-row" role="listitem" data-j="' + j + '">';
        h += fixed ? '<span class="se-grip off" aria-hidden="true"></span>'
            : '<button type="button" class="se-grip" data-grip="' + j + '" title="Drag to move" aria-label="Move ' + esc(name)
                + ' (arrow keys)">' + kit.icon('grip') + '</button>';
        h += '<div class="se-mid"><span class="se-name">' + esc(name) + '</span>' + (ctl ? '<span class="se-ctl">' + ctl + '</span>' : '')
            + '</div>';
        h += keepClock ? '<span class="se-x" aria-hidden="true"></span>'
            : '<button type="button" class="se-x" data-se="rm" data-j="' + j + '" aria-label="Remove ' + esc(name) + '">'
                + kit.icon('x') + '</button>';
        if (b.k === 'radar' && S.radarEnabled === false) {
            h += '<div class="se-sub se-off"><span>' + RADAR_OFF + '</span>'
                + '<button type="button" class="se-link" data-se="radaron">Turn on</button></div>';
        }
        // A template's graph (Add a screen's): what that means, and Edit graph to make it yours.
        if (b.k === 'fc' && templateOf(S, env, list) >= 0) {
            h += '<div class="se-sub se-off"><span>' + esc(TEMPLATE_NOTE) + '</span>'
                + '<button type="button" class="se-link" data-se="adopt">Edit graph</button></div>';
        }
        return h + '</div>';
    }

    /**
     * The screen with the forecast graph added at its place (screens.js add), drawing graph g.
     * @param {Array<Object>} list A screen.
     * @param {number} g A graph (a style index; the first is no field of the block).
     * @returns {Array<Object>} the new screen
     */
    function withGraph(list, g) {
        var next = M.add(list, 'fc');
        if (g > 0) { next[M.idxOf(next, 'fc')].style = GS.codeOf(g); }
        return next;
    }

    /**
     * The forecast graph's Add chips while there are several graphs (the owner's ask,
     * 2026-11-09: a chip per graph): each graph by its name, greyed out (off) where screen i
     * drawing it would make the screens show more metrics than the watch can
     * (graph-styles-page.js screenOverflows, as Add a screen reads a preset's graph), with the
     * settings that would make (W: a tap on it says why, addTap). null with one graph: the
     * Forecast graph chip stands.
     * @param {Object} S Settings.
     * @param {?Object} env Platform env.
     * @param {number} i View slot.
     * @param {Array<Object>} list The screen (it has no forecast graph).
     * @returns {?Array<{se: string, k: string, g: number, label: string, off: boolean, W: Object}>}
     */
    function graphOffers(S, env, i, list) {
        if (!manyGraphs(S, env)) { return null; }
        var N = GSP.asStored(S);
        return GSP.existing(N).map(function (g) {
            var W = Object.assign({}, N);
            ensureCustom(W, env);
            putScreen(W, i, withGraph(list, g));
            return { se: 'add', k: 'fc', g: g, label: GS.name(N, g), off: GSP.screenOverflows(W, env, i, g), W: W };
        });
    }

    /**
     * The screen with its forecast graph drawing graph g instead (a Switch graph chip): the row
     * keeps its place and its size.
     * @param {Array<Object>} list A screen with a forecast graph.
     * @param {number} g A graph (a style index; the first is no field of the block).
     * @returns {Array<Object>} the new screen
     */
    function switchedTo(list, g) {
        var next = M.copy(list), fc = next[M.idxOf(next, 'fc')];
        if (g > 0) { fc.style = GS.codeOf(g); } else { delete fc.style; }
        return next;
    }

    /**
     * The Switch graph chips (the owner's ask, 2026-11-09: the other graphs stay offered once the
     * screen has its forecast graph): with several graphs, a chip for each graph screen i does not
     * draw, greyed out (off) where drawing it in its place would make the screens show more
     * metrics than the watch can, with the settings that would make (W), as graphOffers reads
     * an Add chip. None while the screen has no forecast graph: graphOffers' chips add one. A
     * screen drawing a template's graph is offered your graphs even while you have one.
     * @param {Object} S Settings.
     * @param {?Object} env Platform env.
     * @param {number} i View slot.
     * @param {Array<Object>} list The screen.
     * @returns {Array<{se: string, k: string, g: number, label: string, off: boolean, W: Object}>}
     */
    function switchOffers(S, env, i, list) {
        var at = M.idxOf(list, 'fc');
        if (at < 0 || !(manyGraphs(S, env) || templateOf(S, env, list) >= 0)) { return []; }
        var N = GSP.asStored(S), now = GSP.drawnBy(N, list[at]);
        return GSP.existing(N).filter(function (g) { return g !== now; }).map(function (g) {
            var W = Object.assign({}, N);
            ensureCustom(W, env);
            putScreen(W, i, switchedTo(list, g));
            return { se: 'switch', k: 'fc', g: g, label: GS.name(N, g), off: GSP.screenOverflows(W, env, i, g), W: W };
        });
    }

    /**
     * Which of the editor's Add groups (ADD_GROUPS) an offer's chip sits in: the status bars (the
     * Watch bar and New status bar among them), the graphs, the graphs to switch to, the calendar
     * and the clock.
     * @param {{se: string, k: (string|undefined)}} o An offer (addOffers).
     * @returns {string} 'bars' | 'graphs' | 'switch' | 'rows'
     */
    function addGroupOf(o) {
        var b = { k: o.k };
        if (o.se === 'switch') { return 'switch'; }
        return o.se === 'newbar' || o.k === 'strip' || M.isBar(b) ? 'bars' : M.isGraph(b) ? 'graphs' : 'rows';
    }

    /**
     * Whether a row moves: every row but the Watch bar, which stays at the top.
     * @param {Object} b A block.
     * @returns {boolean}
     */
    function moves(b) {
        return b.k !== 'strip';
    }

    /**
     * What the editor's Add groups offer screen i (the owner's ask, 2026-11-09: a chip for each
     * thing, no pickers): every row the screen can take and the watch has room for (screens.js
     * addable, fitsWatch), in their order, each status bar by its name; New status bar after the
     * bars while it can make one for the screen (Pebble Time 2); with several graphs a chip per
     * graph in the forecast graph's place (graphOffers), or, while the screen has its forecast
     * graph, a chip per graph to switch it to (switchOffers). The chips are drawn from it, each in
     * its group (addGroupOf), and a tap is taken only when it matches one.
     * @param {Object} S Settings.
     * @param {?Object} env Platform env.
     * @param {number} i View slot.
     * @param {Array<Object>} list The screen.
     * @returns {Array<{se: string, label: string, off: boolean, k: (string|undefined), g: (number|undefined),
     *   W: (Object|undefined)}>} W: a graph chip's settings with it added (graphOffers)
     */
    function addOffers(S, env, i, list) {
        var out = [];
        M.addable(list, env, S).forEach(function (k) {
            if (!fitsWatch(M.add(list, k), i, env)) { return; }
            var graphs = k === 'fc' ? graphOffers(S, env, i, list) : null;
            out = out.concat(graphs || [{ se: 'add', k: k, label: M.blockName({ k: k }, S), off: false }]);
        });
        var free = M.newBarFor(list, S, env);
        if (free && fitsWatch(M.add(list, M.KIND_OF_BAR[free]), i, env)) {
            out.push({ se: 'newbar', label: 'New status bar', off: false });
        }
        return out.concat(switchOffers(S, env, i, list));
    }

    /**
     * The Add groups under the rows (ADD_GROUPS), each with its caption over a chip per offer
     * (addOffers). A greyed-out graph's chip still takes a tap, which says why (addTap): the
     * owner's, 2026-11-09, the Graphs tab explains the limit in full.
     * @param {Array<Object>} offers What the groups offer.
     * @returns {string} HTML ('' when they offer nothing)
     */
    function addRowHtml(offers) {
        var groups = ADD_GROUPS.map(function (grp) {
            var mine = offers.filter(function (o) { return addGroupOf(o) === grp.id; });
            if (!mine.length) { return ''; }
            var cap = grp.capOf ? grp.capOf(mine) : grp.cap;
            var chips = mine.map(function (o) {
                return kit.chip(o.label, { 'data-se': o.se, 'data-k': o.k, 'data-g': o.g },
                    { icon: o.se === 'switch' ? 'swap' : 'plus', dim: o.off });
            }).join('');
            return '<div class="se-add" role="group" aria-labelledby="seAdd-' + grp.id + '"><span class="ui-cap" id="seAdd-'
                + grp.id + '">' + esc(cap) + '</span><div class="ui-chips">' + chips + '</div></div>';
        }).join('');
        return groups ? '<div class="se-adds">' + groups + '</div>' : '';
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
        var pic = screenPicture(S, i, env, userData, 'se' + i + '-', cycle).svg;
        // The page's own card (the engine's .card and header), how to reorder under its rows while
        // two rows or more can move (as the Screens card says it), the Add groups, and Delete
        // screen under the card, as a dialog's Delete (kit.deleteButton).
        var movable = list.filter(moves).length;
        return '<div class="se-pic"><span class="se-pic-card" role="img" aria-label="' + esc(M.nameOf(S, i) + ': ' + contents(list, S))
            + '">' + pic + '</span></div>'
            + (note ? kit.note(note) : '')
            + '<div class="card se-card"><div class="cardHdr"><span class="ttlwrap"><span class="ttl" id="seTtl">Top to bottom</span>'
            + '</span></div><div class="se-list" id="seList" role="list" aria-labelledby="seTtl">'
            + list.map(function (b, j) { return rowHtml(list, j, S, env); }).join('') + '</div>'
            + (movable > 1 ? '<div class="ui-foot se-hint">' + esc(ROWS_HINT) + '</div>' : '')
            + addRowHtml(addOffers(S, env, i, list))
            + '</div>'
            + (i > 0 ? kit.deleteButton('Delete screen', { 'data-se': 'delscreen' }) : '');
    }

    /**
     * Add a screen's body, in two layers: its cards (addCards), drawn once while it is open, and
     * over them the picked screen (addPickBody) while one is picked, the cards hidden under it,
     * so ‹ shows them again as they were (the owner's ask, 2026-11-10: it had grown slow).
     * @param {Object} S Settings.
     * @param {?Object} env Platform env.
     * @param {Object} [userData] Page userData (the palette).
     * @returns {void}
     */
    function renderAdd(S, env, userData) {
        if (!ED.drawn) {
            var later = [];
            ED.overlay.querySelector('[data-se-body]').innerHTML = '<div data-sa-cards>' + addCards(S, env, userData, later)
                + '</div><div data-sa-pick></div>';
            ED.drawn = true;
            fillPictures(later, env, userData);
        }
        ED.overlay.querySelector('[data-sa-pick]').innerHTML = ED.pick ? addPickBody(S, env, userData) : '';
        ED.overlay.querySelector('[data-sa-cards]').style.display = ED.pick ? 'none' : '';
    }

    /**
     * Add a screen's cards: a row of cards per group (screen-presets.js GROUPS), its heading over
     * them, scrolled sideways (the owner's, 2026-11-10); each card (addChoices) the picture of the
     * screen it adds beside its name and the legend of what it shows (screen-legend.js). The
     * first EAGER cards of a row hold their pictures; the others hold a place for theirs, which
     * fillPictures draws (`later`, a column of every row after another). Under the rows, what a
     * screen brings.
     * @param {Object} S Settings.
     * @param {?Object} env Platform env.
     * @param {Object} [userData] Page userData (the palette).
     * @param {Array<Object>} later Takes the pictures left to draw, in the order to draw them.
     * @returns {string} HTML
     */
    function addCards(S, env, userData, later) {
        var choices = addChoices(S, env), columns = [];
        var groups = PRESETS.GROUPS.map(function (grp) {
            var mine = choices.filter(function (c) { return PRESETS.byId(c.id).group === grp.id; });
            var cards = mine.map(function (c, at) {
                var key = c.id + '-' + (c.cal || '0'), shown = addShown(c, env, userData, 'sa-' + key + '-', at < EAGER);
                if (at >= EAGER) { (columns[at] = columns[at] || []).push({ key: key, c: c, cycle: shown.cycle }); }
                // Its calendar is in its picture, and said to a screen reader after its name.
                return '<button type="button" class="sa-card" data-se="pick" data-id="' + c.id + '" data-cal="' + c.cal + '">'
                    + '<span class="sa-pic" aria-hidden="true"' + (at < EAGER ? '' : ' data-sa-pic="' + key + '"') + '>'
                    + shown.pic.svg + '</span><span class="sa-txt">'
                    + '<span class="sa-n">' + esc(c.name) + (c.calName ? '<span class="sr-only">, ' + esc(c.calName.toLowerCase())
                    + '</span>' : '') + '</span>' + LEGEND.cardHtml(shown.legend, shown.pic.bg) + '</span></button>';
            }).join('');
            return cards ? '<div class="sa-group" role="group" aria-labelledby="saGrp-' + grp.id + '"><span class="ui-cap"'
                + ' id="saGrp-' + grp.id + '">' + esc(grp.name) + '</span><div class="sa-strip" data-sa-strip="' + grp.id
                + '">' + cards + '</div></div>' : '';
        }).join('');
        columns.forEach(function (col) { Array.prototype.push.apply(later, col); });
        return groups + '<div class="sa-fine">' + esc(env && env.graphStyles ? ADD_FINE : ADD_FINE_ONE_GRAPH) + '</div>';
    }

    /**
     * Draw Add a screen's pictures left to draw (addCards' `later`), FILL_STEP at a time, each
     * step a frame after the last, so the cards show and take taps at once. A step for an
     * overlay closed or opened anew since, or gone on to a screen it added, does nothing.
     * @param {Array<{key: string, c: Object, cycle: Array}>} later The pictures, in order.
     * @param {?Object} env Platform env.
     * @param {Object} [userData] Page userData (the palette).
     * @returns {void}
     */
    function fillPictures(later, env, userData) {
        var opened = ED.opened;
        /** One step: the next pictures into their places, then the next step. */
        function step() {
            if (!ED.overlay || ED.opened !== opened || !ED.drawn) { return; }
            later.splice(0, FILL_STEP).forEach(function (x) {
                var at = ED.overlay.querySelector('[data-sa-pic="' + x.key + '"]');
                if (!at) { return; }
                at.innerHTML = screenPicture(x.c.W, x.c.n, env, userData, 'sa-' + x.key + '-', x.cycle).svg;
            });
            if (later.length) { setTimeout(step, FILL_GAP); }
        }
        if (later.length) { setTimeout(step, FILL_GAP); }
    }

    /**
     * A screen Add a screen can add as it shows it: its picture (screenPicture) and the legend of
     * what its graphs draw (screen-legend.js groups), read off the one cycle of its settings.
     * Without its picture (a card that draws it later: fillPictures), the screen's frame on its
     * ground, for its place (preview-watch.js blankScreen).
     * @param {Object} c An addChoice result.
     * @param {?Object} env Platform env.
     * @param {Object} [userData] Page userData (the palette).
     * @param {string} prefix What its graphs' ids start with, unique on the page.
     * @param {boolean} [draw] Draw the picture (the default); false: its frame only.
     * @returns {{pic: {svg: string, label: string, bg: string}, legend: Array<Object>, cycle: Array}}
     */
    function addShown(c, env, userData, prefix, draw) {
        var cycle = VC.screensCycle(c.W, env);
        var pic = draw === false ? PW.blankScreen(c.W, env, env && env.platform === 'emery' ? 1 : 0)
            : screenPicture(c.W, c.n, env, userData, prefix, cycle);
        return { pic: pic, legend: LEGEND.groups(drawnView(cycle[c.n] || null, c.W), c.W, env, userData), cycle: cycle };
    }

    /**
     * Where Add a screen's cards are scrolled to: the body, and each row sideways, so ‹ from a
     * picked card comes back to them (backToCards).
     * @returns {{top: number, rows: Object<string, number>}}
     */
    function cardsPlace() {
        var body = ED.overlay.querySelector('[data-se-body]'), rows = {};
        PRESETS.GROUPS.forEach(function (grp) {
            var row = body.querySelector('[data-sa-strip="' + grp.id + '"]');
            if (row) { rows[grp.id] = row.scrollLeft || 0; }
        });
        return { top: body.scrollTop || 0, rows: rows };
    }

    /**
     * Back from a picked card (‹, Escape) to Add a screen's cards, scrolled where they were
     * (cardsPlace).
     * @returns {void}
     */
    function backToCards() {
        var at = ED.cardsAt;
        ED.pick = null;
        ED.cardsAt = null;
        renderEditor();
        if (!at) { return; }
        var body = ED.overlay.querySelector('[data-se-body]');
        body.scrollTop = at.top;
        Object.keys(at.rows).forEach(function (id) {
            var row = body.querySelector('[data-sa-strip="' + id + '"]');
            if (row) { row.scrollLeft = at.rows[id]; }
        });
    }

    /**
     * The picked card as the screen it adds: addChoice on its calendar and length (ED.pick).
     * @param {Object} S Settings.
     * @param {?Object} env Platform env.
     * @returns {?Object} addChoice's result; null with no pick, no room or no such kind
     */
    function addPick(S, env) {
        var kind = ED.pick ? PRESETS.byId(ED.pick.id) : null;
        var N = GSP.asStored(S), lists = M.screensOf(N, env);
        if (!kind || lists.length >= M.MAX_SCREENS) { return null; }
        return addChoice(N, env, lists, kind, ED.pick.cal, ED.pick.span);
    }

    /**
     * A row of Add a screen's picked screen: its name over a segmented control (the page's .seg,
     * one equal segment per option), the picked option on.
     * @param {string} label The row's name.
     * @param {string} act What a tap does (data-se): 'aspan'.
     * @param {Array<Array<string>>} options [label, value] pairs.
     * @param {string} value The option picked.
     * @returns {string} HTML
     */
    function segRow(label, act, options, value) {
        return '<div class="sa-row"><div class="sa-lbl" id="sa-' + act + '">' + esc(label) + '</div>'
            + '<div class="seg full" role="group" aria-labelledby="sa-' + act + '">' + options.map(function (o) {
                var on = o[1] === value;
                return '<button type="button" data-se="' + act + '" data-v="' + esc(o[1]) + '"' + (on ? ' class="on"' : '')
                    + ' aria-pressed="' + on + '">' + esc(o[0]) + '</button>';
            }).join('') + '</div></div>';
    }

    /**
     * Add a screen's picked screen (the owner's asks, 2026-11-09 and 2026-11-10): its picture big
     * on the calendar its card picked; What it shows, the legend of what its graphs draw at the
     * length picked as a list, each graph's under its caption but a template's own (its graph
     * then is the screen), and what the weather service leaves out (screen-legend.js); for a
     * forecast screen on a watch with graph styles, Forecast length (12 h, 24 h, the long span by
     * its hours); why it cannot be added, if it cannot; Add screen.
     * @param {Object} S Settings.
     * @param {?Object} env Platform env.
     * @param {Object} [userData] Page userData (the palette).
     * @returns {string} HTML
     */
    function addPickBody(S, env, userData) {
        var c = addPick(S, env);
        if (!c) { return ''; }
        var kind = PRESETS.byId(c.id), N = GSP.asStored(S), shown = addShown(c, env, userData, 'sa-big-');
        var spans = c.span ? PRESETS.spanOptions(kind, env, N) : [], gs = shown.legend;
        // A screen keeps your forecast graph unless it brings a template's, at a length.
        var yours = !c.span, gap = LEGEND.gapNote(gs, N.provider);
        return '<div class="sa-cfg"><div class="sa-big" role="img" aria-label="' + esc(c.name + ': ' + shown.pic.label) + '">'
            + shown.pic.svg + '</div>'
            + '<div class="sa-row"><div class="sa-lbl">What it shows</div>' + LEGEND.listHtml(gs, shown.pic.bg,
                { captions: yours || gs.some(function (g) { return g.graph !== 'forecast'; }), yours: yours })
            + (gap ? '<div class="sa-gap">' + esc(gap) + '</div>' : '') + '</div>'
            + (spans.length ? segRow('Forecast length', 'aspan', spans, c.span) : '')
            + (c.why ? '<div class="sa-why" role="status">' + esc(c.why) + '</div>' : '')
            + '<button type="button" class="sa-add" data-se="addnow"' + (c.why ? ' disabled' : '') + '>Add screen</button></div>';
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
        var add = ED.mode === 'add', kind = add && ED.pick ? PRESETS.byId(ED.pick.id) : null;
        var name = kind ? kind.name : add ? 'Add a screen' : M.nameOf(S, ED.i);
        ED.overlay.querySelector('[data-se-head]').innerHTML = kit.header({
            titleId: 'seTitle', title: name, kicker: kind ? 'Add a screen' : 'Screens',
            way: { glyph: '&#8249;', label: 'Back', at: { 'data-se': kind ? 'addback' : 'close' } },
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
     * Paint the overlay (the editor, keeping its scroll position, or Add a screen: renderAdd).
     * @returns {void}
     */
    function renderEditor() {
        if (!ED.overlay || !UI.ctx) { return; }
        var ctx = UI.ctx, body = ED.overlay.querySelector('[data-se-body]');
        renderHeader(ctx.S);
        if (ED.mode === 'add') {
            renderAdd(ctx.S, ctx.ENV, ctx.USERDATA);
        } else {
            var top = body.scrollTop;
            ED.drawn = false;
            body.innerHTML = editorBody(ctx.S, ctx.ENV, ctx.USERDATA);
            body.scrollTop = top;
        }
        // Why a move went back: the page's toast (shell.html .toast), for three seconds.
        var t = ED.overlay.querySelector('[data-se-toast]');
        t.textContent = ED.toast.v || '';
        t.className = ED.toast.v ? 'toast show' : 'toast';
    }

    /**
     * Say why something did not happen in the editor (a move that snapped back, a greyed-out
     * chip): the page's toast, shown at once, for three seconds unless asked for longer.
     * @param {string} text Why.
     * @param {number} [ms] How long it shows.
     * @returns {void}
     */
    function editorToast(text, ms) {
        kit.flash(ED.toast, text, ms || 3000, renderEditor);
        renderEditor();
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
        // Add a screen closed without adding one changed nothing: the page stays as drawn.
        var changed = ED.mode !== 'add';
        ED.overlay = null;
        ED.drawn = false;
        ED.drag = null;
        ED.nameEl = null;
        document.removeEventListener('keydown', onKeydown);
        if (UI.ctx && changed) { UI.ctx.render(); }
    }

    /**
     * Move a row (its drag, its arrow keys): stored, or put back with the rule the move would
     * break, said for three seconds.
     * @param {Array<Object>} list The screen.
     * @param {number} j The row.
     * @param {number} to Its new place.
     * @returns {boolean} whether it moved
     */
    function editorMove(list, j, to) {
        var next = M.move(list, j, to), why = M.problem(next);
        if (why) { editorToast(why); return false; }
        commit(next);
        return true;
    }

    /**
     * The editor's keys (not under a dialog, nor while the name is renamed): Escape closes it;
     * ArrowUp / ArrowDown on a focused ≡ move its row a place (editorMove), the ≡ keeping the
     * focus.
     * @param {KeyboardEvent} e The key.
     * @returns {void}
     */
    function onKeydown(e) {
        if (ED.nameEl || !UI.ctx) { return; }
        var modal = document.getElementById('modal');
        if (modal && modal.open) { return; }
        if (e.key === 'Escape') {
            // Escape on a picked screen goes back to Add a screen's cards, as its ‹ does.
            if (ED.mode === 'add' && ED.pick) { backToCards(); return; }
            closeEditor();
            return;
        }
        var g = e.target && e.target.closest ? e.target.closest('[data-grip]') : null;
        if (!g || !ED.overlay || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) { return; }
        e.preventDefault();
        var j = Number(g.getAttribute('data-grip')), to = e.key === 'ArrowUp' ? j - 1 : j + 1;
        var list = M.screensOf(UI.ctx.S, UI.ctx.ENV)[ED.i] || [];
        if (to < 0 || to >= list.length) { return; }
        var again = ED.overlay.querySelector('[data-grip="' + (editorMove(list, j, to) ? to : j) + '"]');
        if (again) { again.focus(); }
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
     * A tap on an Add chip, taken only when it matches one the Add groups offer (addOffers): a
     * greyed-out one says why for five seconds and adds nothing; any other adds the row at its
     * place (screens.js add), a graph's chip drawing that graph (withGraph); + New status bar
     * makes an empty bar for the screen (newBarHere); a Switch graph chip puts its graph in the
     * forecast graph's place (switchedTo).
     * @param {Object} S Settings.
     * @param {?Object} env Platform env.
     * @param {Array<Object>} list The screen being edited.
     * @param {Element} t The chip.
     * @returns {void}
     */
    function addTap(S, env, list, t) {
        var se = t.getAttribute('data-se'), k = t.getAttribute('data-k'), g = t.getAttribute('data-g');
        var hit = addOffers(S, env, ED.i, list).filter(function (o) {
            return o.se === se && (o.k || null) === k && (o.g === undefined ? null : String(o.g)) === g;
        })[0];
        if (!hit) { return; }
        if (hit.off) { editorToast(GSP.limitDesc(hit.W, env, hit.g, hit.label), 5000); return; }
        if (se === 'newbar') { newBarHere(S, env, list); return; }
        if (se === 'switch') { commit(switchedTo(list, hit.g)); return; }
        commit(hit.g === undefined ? M.add(list, k) : withGraph(list, hit.g));
    }

    /**
     * Edit graph on a template's row (the owner's, 2026-11-10: a template's graph joins your
     * graphs once you edit it): the graph made one of yours (graph-styles-page.js
     * adoptTemplate), then its dialog opened over the editor; with six graphs already the toast
     * says to delete one first.
     * @param {Object} S Settings.
     * @param {?Object} env Platform env.
     * @param {Array<Object>} list The screen being edited.
     * @returns {void}
     */
    function adoptHere(S, env, list) {
        var k = templateOf(S, env, list);
        if (k < 0) { return; }
        var j = GSP.adoptTemplate(S, k);
        if (j < 0) { editorToast(NO_GRAPH_ROOM, 5000); return; }
        renderEditor();
        UI.ctx.render();
        GSP.openGraph(S, j, false, { kicker: M.nameOf(S, ED.i), onClose: renderEditor });
    }

    /**
     * + New status bar in the editor (Pebble Time 2): an empty bar made (makeBar) and put on the
     * screen at a bar's place, then its dialog opened over the editor with its name field ready.
     * @param {Object} S Settings.
     * @param {?Object} env Platform env.
     * @param {Array<Object>} list The screen being edited.
     * @returns {void}
     */
    function newBarHere(S, env, list) {
        var made = makeBar(S, env);
        if (!made) { return; }
        commit(M.add(list, M.KIND_OF_BAR[made]));
        openBar(made, true, M.nameOf(S, ED.i), renderEditor);
    }

    /**
     * The editor's taps: close, rename, Add a screen's pick, remove, an Add chip (addTap), a
     * row's dropdown (its picker), turn the radar on, delete the screen. A tap a drag ends in is
     * no tap.
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
        // Add a screen's card: the screen it adds on its card's calendar and its template's
        // length, to pick the length; ‹ goes back to the cards where they were.
        if (act === 'pick') {
            var kind = PRESETS.byId(t.getAttribute('data-id'));
            if (!kind) { return; }
            ED.cardsAt = cardsPlace();
            ED.pick = { id: kind.id, cal: t.getAttribute('data-cal') || '', span: PRESETS.spanOf(kind, env) };
            ED.overlay.querySelector('[data-se-body]').scrollTop = 0;
            renderEditor();
            return;
        }
        if (act === 'addback') { backToCards(); return; }
        if (act === 'aspan') {
            if (ED.pick) { ED.pick.span = t.getAttribute('data-v') || ''; }
            renderEditor();
            return;
        }
        // Add screen: the screen added after the others (addChosen), its editor next.
        if (act === 'addnow') {
            var slot = t.disabled || !ED.pick ? -1 : addChosen(S, env, ED.pick.id, ED.pick.cal, ED.pick.span);
            if (slot < 0) { return; }
            UI.toast.v = null;
            ED.pick = null;
            ED.mode = 'edit';
            ED.i = slot;
            ED.overlay.querySelector('[data-se-body]').scrollTop = 0;
            renderEditor();
            ctx.render();
            return;
        }
        if (act === 'rm') { commit(M.remove(list, j)); return; }
        if (act === 'add' || act === 'newbar' || act === 'switch') { addTap(S, env, list, t); return; }
        if (act === 'radaron') { setRadarEnabled(S, true, env); renderEditor(); ctx.render(); return; }
        if (act === 'adopt') { adoptHere(S, env, list); return; }
        // A row's Rows or Size: its picker opens over the editor (the page's select sheet, a
        // top-layer dialog), its pick lands through screenRowSizePicked.
        if (act === 'size') {
            var size = list[j] ? sizeOf(list[j]) : null;
            if (!size) { return; }
            ED.sizeRow = j;
            S[SCREEN_SIZE] = list[j][size.key];
            ctx.openSheet(SCREEN_SIZE, function () { renderEditor(); });
            return;
        }
        if (act === 'delscreen') {
            var i = ED.i;
            closeEditor();
            deleteWithUndo(S, i, env);
            ctx.render();
        }
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
        editorMove(M.screensOf(UI.ctx.S, UI.ctx.ENV)[ED.i] || [], d.j, d.to);
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
     * Open Add a screen (the screens this watch can draw: screen-presets.js offered).
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
        ED.sizeRow = -1;
        ED.toast.v = null;
        ED.nameEl = null;
        ED.pick = null;
        ED.cardsAt = null;
        ED.drawn = false;
        ED.opened += 1;
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
            PConf.onChange.register('screenRowSizePicked', sizePicked);
            PConf.onChange.register('barRenamed', barRenamed);
        }
        // Your status bars by name (screens.js barName): their dialogs' titles and their slot pickers'.
        if (PConf.displayResolvers) {
            PConf.displayResolvers.register('barName', function (S, env, args) { return M.barName(S, args.bar); });
            PConf.displayResolvers.register('barSlotTitle', function (S, env, args) {
                return M.barName(S, args.bar) + ' · ' + args.label;
            });
            PConf.displayResolvers.register('screenRowSizeTitle', sizeTitle);
        }
        if (PConf.optionsResolvers) {
            PConf.optionsResolvers.register('apliteLayouts', function () { return APLITE_LAYOUTS.slice(); });
            PConf.optionsResolvers.register('screenRowSizeOptions', sizeOptions);
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
        NO_GRAPH_ROOM: NO_GRAPH_ROOM,
        TEMPLATE_NOTE: TEMPLATE_NOTE,
        REORDER_HINT: REORDER_HINT,
        ROWS_HINT: ROWS_HINT,
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
        freeName: freeName,
        contents: contents,
        drawnView: drawnView,
        screenPicture: screenPicture,
        setRadarEnabled: setRadarEnabled,
        radarModeToSave: radarModeToSave,
        screensCard: screensCard,
        editorBody: editorBody,
        radarSourceValue: radarSourceValue,
        radarSourcePicked: radarSourcePicked,
        barRenamed: barRenamed,
        barsCard: barsCard,
        barDialogPicture: barDialogPicture,
        batterySaverPauseHint: batterySaverPauseHint
    };
    if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
    if (typeof window !== 'undefined') { window.ScreensPage = api; }
})();
