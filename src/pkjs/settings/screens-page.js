// src/pkjs/settings/screens-page.js — ES5, WebView (+ Node for tests). The Watchface tab's
// screens: the Screens card (one row per screen, a ✕ with Undo on each flick screen, "+ Add
// screen"), the screen editor (a full-screen sheet: the screen's picture and its rows top to
// bottom, dragged or moved, each with its option, "+ Add" at the natural place), Setup's Rain
// radar picker (Off keeps the source) and the modes the page works out from the screens.
//
// The screens are read from and written to the custom layout's per-view keys (screens.js
// screensOf / compileKeys), one screen at a time, so a screen the user does not touch keeps
// its keys byte for byte. A preset install (one the 2.6 migration could not move: its watch
// did not say what it is) turns custom at its first screen edit, through its own cycle's keys
// (view-cycle.js specToKeys), so nothing on it moves either. A bar an edit brings onto the
// screens with nothing to show (every slot Empty) takes its default slots (fillNewBars).
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
    var catalog = (typeof require !== 'undefined')
        ? require('../status-line-catalog.js') : window.StatusLineCatalog;
    // The page's one escape helper (config-ui/lib/html.js, concatenated ahead of every app file).
    var esc = (typeof require !== 'undefined') ? require('../config-ui/lib/html.js').esc : PConf.html.esc;

    // The screens' names, the Default first.
    var NAMES = ['Default', 'Flick 1', 'Flick 2'];
    // A new screen: the Watch bar and the Clock.
    var NEW_SCREEN = [{ k: 'strip' }, { k: 'clock' }];
    // The per-view keys a screen owns (custom-layout-schema.js customViewItems).
    var VIEW_STEMS = ['Top', 'Body', 'Upper', 'Lower', 'Order', 'TopSize', 'BodySize', 'Align', 'ClockOff', 'StripOff'];
    var TOO_TALL = 'Too tall for the watch. Remove a row or make a graph smaller.';
    var NOTHING_YET = 'Nothing on this screen yet, so the watch skips it.';
    var RADAR_OFF = 'The rain radar is off.';
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
     * layout to Compact calendar. Only a screen edit makes it custom there (writeScreen,
     * deleteScreen, insertScreen). aplite keeps its own modes (its page sets both off as it
     * opens, onbuild.js).
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

    // A bar's slots in their line's order (status-line-catalog.js LINES), as the catalog places them.
    var SLOT_POSITIONS = ['left', 'mid', 'right'];

    /**
     * The bars the screens show (view-cycle.js barsIn; the Watch bar is 'top').
     * @param {Object} S Settings.
     * @param {?Object} env Platform env.
     * @returns {{top: boolean, forecast: boolean, radar: boolean, health: boolean}}
     */
    function barsShown(S, env) {
        return VC.barsIn(VC.screensCycle(S, env));
    }

    /**
     * Give a bar that has just come onto a screen its default slots (status-line-catalog.js
     * slotDefault, the ones a new install has) when it would show nothing: every slot Empty, or
     * an item this watch cannot show. A bar never set up can be stored that way: the 2.6 move
     * stored a health item as Empty where health was off. A bar with a reading of its own, or
     * one a screen showed already, keeps its slots. Mutates S.
     * @param {Object} S Settings.
     * @param {{top: boolean, forecast: boolean, radar: boolean, health: boolean}} before
     *   barsShown() before the change.
     * @param {?Object} env Platform env.
     * @returns {void}
     */
    function fillNewBars(S, before, env) {
        var now = barsShown(S, env);
        catalog.LINES.forEach(function (line) {
            if (!now[line.id] || before[line.id]) { return; }
            var blank = line.slots.every(function (key, p) {
                return catalog.resolveSelection(S[key], S, env, { slotKey: key, position: SLOT_POSITIONS[p] }) === 'empty';
            });
            if (blank) { line.slots.forEach(function (key) { S[key] = catalog.slotDefault(key, env); }); }
        });
    }

    /**
     * Store one screen (its per-view keys) and the modes that follow; a bar it brings onto the
     * screens with nothing to show takes its default slots (fillNewBars). Mutates S.
     * @param {Object} S Settings.
     * @param {number} i View slot.
     * @param {Array<Object>} list The screen.
     * @param {?Object} env Platform env.
     * @param {Object} [before] barsShown() before the change, from a caller that has moved the
     *   other screens already (insertScreen); else read here.
     * @returns {void}
     */
    function writeScreen(S, i, list, env, before) {
        ensureCustom(S, env);
        var was = before || barsShown(S, env);
        Object.assign(S, M.compileKeys(list, i));
        if ((parseInt(S.viewCount, 10) || 1) < i + 1) { S.viewCount = String(i + 1); }
        fillNewBars(S, was, env);
        applyModes(S, env);
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
        ensureCustom(S, env);
        var n = parseInt(S.viewCount, 10) || 1;
        if (i < 1 || i >= n) { return false; }
        for (var j = i; j < n - 1; j++) { copyView(S, j + 1, j); }
        S.viewCount = String(n - 1);
        applyModes(S, env);
        return true;
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
        var snap = snapshot(S);
        if (!deleteScreen(S, i, env)) { return false; }
        showToast(NAMES[i] + ' deleted.', snap);
        return true;
    }

    /**
     * Put a new screen in at a slot: the screens from that slot on move down one, keys and
     * all, and the new one starts at the default position (a list has none, compileKeys
     * leaves viewAlign as stored, and a slot a deleted screen left can still hold its).
     * Mutates S.
     * @param {Object} S Settings.
     * @param {number} at View slot (1 or 2).
     * @param {Array<Object>} list The screen.
     * @param {?Object} env Platform env.
     * @returns {boolean} whether it went in (no fourth screen, never before the Default)
     */
    function insertScreen(S, at, list, env) {
        ensureCustom(S, env);
        var n = parseInt(S.viewCount, 10) || 1;
        if (n >= M.MAX_SCREENS || at < 1 || at > n) { return false; }
        // Before the move: the slot past the last screen can hold a deleted screen's keys.
        var before = barsShown(S, env);
        for (var j = n; j > at; j--) { copyView(S, j - 1, j); }
        S['viewAlign' + at] = 'clock';
        S.viewCount = String(n + 1);
        writeScreen(S, at, list, env, before);
        return true;
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
     * A screen's rows in a line, for its row on the Screens card: what it shows, the Watch
     * bar left out (most screens keep it).
     * @param {Array<Object>} list The screen.
     * @param {Object} S Settings.
     * @returns {string}
     */
    function contents(list, S) {
        var names = list.filter(function (b) { return b.k !== 'strip'; }).map(function (b) {
            return M.KINDS[b.k].name + (b.k === 'radar' && S.radarEnabled === false ? ' (off)' : '');
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
        // The editor (a full-screen sheet, the wizard's pattern).
        + '#screenEditor{position:fixed;top:0;left:0;right:0;bottom:0;z-index:1000;display:flex;flex-direction:column;'
        + 'max-width:460px;margin:0 auto;background:var(--bg);color:var(--fg);font-family:Inter,system-ui,sans-serif}'
        + '#screenEditor .se-hdr{flex:none;display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:8px;padding:16px 14px 10px}'
        + '#screenEditor .se-back{justify-self:start;width:38px;height:38px;border-radius:11px;border:none;background:var(--ctl);'
        + 'color:var(--lbl);display:flex;align-items:center;justify-content:center;cursor:pointer}'
        + '#screenEditor .se-ttl{margin:0;font-size:17px;font-weight:800}'
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
        + '.se-mv:disabled{opacity:.4;cursor:default}'
        + '.se-adds{display:flex;flex-wrap:wrap;gap:6px;align-items:center;padding:12px 14px 14px;border-top:1px solid var(--row-line)}'
        + '.se-addlbl{font-size:10.5px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--ttl);margin-right:2px}'
        + '.se-add{border:1px dashed var(--line-strong);background:none;color:var(--link);border-radius:999px;padding:6px 11px;'
        + 'font:700 12px Inter,system-ui,sans-serif;cursor:pointer}'
        + '.se-del{align-self:center;border:none;background:none;color:var(--link);font:700 13.5px Inter,system-ui,sans-serif;'
        + 'padding:10px 16px;cursor:pointer}'
        + '.se-toast{position:absolute;left:12px;right:12px;bottom:16px;z-index:40;background:var(--ctl);color:var(--lbl);'
        + 'border-radius:12px;padding:10px 12px;font-size:12.5px;line-height:1.45;box-shadow:0 10px 30px rgba(0,0,0,.35)}';

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

    // The page's live state (onReady) and the card's Undo toast.
    var UI = { ctx: null, toast: null, timer: null };

    /**
     * The Screens card's rows: one per screen, its name and what it shows; a ✕ on each flick
     * screen; "+ Add screen" while there are fewer than three; the Undo toast after a delete.
     * @param {Object} S Live settings.
     * @param {?Object} env Platform env.
     * @returns {string} HTML ('' on aplite)
     */
    function screensCard(S, env) {
        if (!hasScreens(env)) { return ''; }
        ensureStyle();
        var lists = M.screensOf(S || {}, env);
        var rows = lists.map(function (list, i) {
            return '<div class="scr-row"><button type="button" class="scr-main" data-action="openScreen" data-action-arg="' + i + '">'
                + '<span class="scr-mid"><span class="scr-t">' + NAMES[i] + '</span><span class="scr-els">'
                + esc(contents(list, S || {})) + '</span></span><span class="scr-chev" aria-hidden="true">›</span></button>'
                + (i > 0 ? '<button type="button" class="scr-x" data-action="deleteScreen" data-action-arg="' + i
                    + '" aria-label="Delete ' + NAMES[i] + '">' + I_X + '</button>' : '<span class="scr-xpad" aria-hidden="true"></span>')
                + '</div>';
        }).join('');
        var add = lists.length < M.MAX_SCREENS
            ? '<button type="button" class="scr-add" data-action="addScreen">+ Add screen</button>' : '';
        var t = UI.toast;
        var toast = t ? '<div class="scr-toast" role="status"><span>' + esc(t.text) + '</span>'
            + '<button type="button" class="scr-undo" data-action="undoDeleteScreen">Undo</button></div>' : '';
        return '<div class="scr-list">' + rows + add + toast + '</div>';
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

    // The editor's state: the slot, the row whose option is open, a row to flash, the
    // snap-back message and the drag in progress.
    var ED = { overlay: null, i: 0, open: -1, toast: '', toastTimer: null, drag: null };

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
     * One row of the list.
     * @param {Array<Object>} list The screen.
     * @param {number} j The row.
     * @param {Object} S Settings.
     * @param {?Object} env Platform env.
     * @returns {string} HTML
     */
    function rowHtml(list, j, S, env) {
        var b = list[j], K = M.KINDS[b.k], fixed = b.k === 'strip', open = ED.open === j && !fixed;
        var keepClock = ED.i === 0 && b.k === 'clock';
        var val = b.k === 'cal' ? b.rows + ' rows' : K.graph ? sizeLabel(b) : '';
        var h = '<div class="se-row" role="listitem" data-j="' + j + '">';
        h += fixed ? '<span class="se-grip off" aria-hidden="true"></span>'
            : '<span class="se-grip" data-grip="' + j + '" title="Drag to move" aria-hidden="true">' + I_GRIP + '</span>';
        h += fixed ? '<span class="se-main fixed"><span>' + K.name + '</span></span>'
            : '<button type="button" class="se-main" data-se="expand" data-j="' + j + '" aria-expanded="' + open + '"><span>'
                + K.name + '</span>' + (val ? '<span class="se-val">' + val + '</span>' : '') + '</button>';
        h += keepClock ? '<span class="se-x" aria-hidden="true"></span>'
            : '<button type="button" class="se-x" data-se="rm" data-j="' + j + '" aria-label="Remove ' + K.name + '">' + I_X + '</button>';
        if (b.k === 'radar' && S.radarEnabled === false) {
            h += '<div class="se-sub se-off"><span>' + RADAR_OFF + '</span>'
                + '<button type="button" class="se-link" data-se="radaron">Turn on</button></div>';
        }
        if (open) {
            h += '<div class="se-sub se-more">';
            if (b.k === 'cal') { h += optHtml(list, j, 'Rows', 'rows', M.CAL_ROWS, env); }
            if (K.graph) { h += optHtml(list, j, 'Size', 'size', M.GRAPH_SIZES, env); }
            h += '<div class="se-moves"><button type="button" class="se-mv" data-se="up" data-j="' + j + '"'
                + (moveOk(list, j, j - 1) ? '' : ' disabled') + '>' + I_UP + 'Move up</button>'
                + '<button type="button" class="se-mv" data-se="down" data-j="' + j + '"'
                + (moveOk(list, j, j + 1) ? '' : ' disabled') + '>' + I_DOWN + 'Move down</button></div></div>';
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
        return '<div class="se-pic"><span class="se-pic-card" role="img" aria-label="' + esc(NAMES[i] + ': ' + contents(list, S))
            + '">' + pic + '</span></div>'
            + (note ? '<div class="se-note" role="status">' + note + '</div>' : '')
            + '<div class="se-card"><div class="se-cardhd" id="seTtl">Top to bottom</div>'
            + '<div class="se-list" id="seList" role="list" aria-labelledby="seTtl">'
            + list.map(function (b, j) { return rowHtml(list, j, S, env); }).join('') + '</div>'
            + (adds.length ? '<div class="se-adds"><span class="se-addlbl">Add</span>' + adds.map(function (k) {
                return '<button type="button" class="se-add" data-se="add" data-k="' + k + '">+ ' + M.KINDS[k].name + '</button>';
            }).join('') + '</div>' : '')
            + '</div>'
            + (i > 0 ? '<button type="button" class="se-del" data-se="delscreen">Delete screen</button>' : '');
    }

    /**
     * Paint the editor, keeping its scroll position.
     * @returns {void}
     */
    function renderEditor() {
        if (!ED.overlay || !UI.ctx) { return; }
        var ctx = UI.ctx, body = ED.overlay.querySelector('[data-se-body]');
        var top = body.scrollTop;
        ED.overlay.querySelector('[data-se-title]').textContent = NAMES[ED.i];
        body.innerHTML = editorBody(ctx.S, ctx.ENV, ctx.USERDATA);
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
        document.removeEventListener('keydown', onKeydown);
        if (UI.ctx) { UI.ctx.render(); }
    }

    /**
     * Escape folds an open row's options, else closes the editor (not under a dialog).
     * @param {KeyboardEvent} e The key.
     * @returns {void}
     */
    function onKeydown(e) {
        if (e.key !== 'Escape') { return; }
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
        if (act === 'delscreen') {
            var i = ED.i;
            closeEditor();
            deleteWithUndo(S, i, env);
            ctx.render();
        }
    }

    /**
     * Start a drag by a row's handle: the row follows the pointer, the others make room, and a
     * drop that breaks a rule snaps back with the reason.
     * @param {PointerEvent} e The press.
     * @returns {void}
     */
    function onPointerDown(e) {
        var g = e.target && e.target.closest ? e.target.closest('[data-grip]') : null;
        if (!g || (e.button !== undefined && e.button !== 0)) { return; }
        e.preventDefault();
        var listEl = ED.overlay.querySelector('#seList');
        var rows = Array.prototype.slice.call(listEl.children);
        var j = Number(g.getAttribute('data-grip'));
        ED.drag = { j: j, to: j, rows: rows, y0: e.clientY, id: e.pointerId, listEl: listEl,
            rects: rows.map(function (r) { return r.getBoundingClientRect(); }) };
        try { g.setPointerCapture(e.pointerId); } catch (err) { /* an old WebView */ }
        rows[j].classList.add('lift');
        listEl.classList.add('dragging');
    }

    /**
     * Move the other rows out of the way of the dragged one's new place.
     * @returns {void}
     */
    function shiftRows() {
        var d = ED.drag, order = [], x;
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
     * @param {PointerEvent} e The move.
     * @returns {void}
     */
    function onPointerMove(e) {
        var d = ED.drag;
        if (!d || e.pointerId !== d.id) { return; }
        var dy = e.clientY - d.y0, r0 = d.rects[d.j];
        d.rows[d.j].style.transform = 'translateY(' + dy + 'px)';
        var center = r0.top + r0.height / 2 + dy, to = 0;
        for (var x = 0; x < d.rects.length; x++) {
            if (x !== d.j && d.rects[x].top + d.rects[x].height / 2 < center) { to++; }
        }
        if (to !== d.to) { d.to = to; shiftRows(); }
    }

    /**
     * Drop: store the move, or snap back with the rule it breaks.
     * @param {PointerEvent} e The release (or the cancel).
     * @returns {void}
     */
    function onPointerUp(e) {
        var d = ED.drag;
        if (!d || e.pointerId !== d.id) { return; }
        d.rows[d.j].classList.remove('lift');
        d.listEl.classList.remove('dragging');
        d.rows.forEach(function (r) { r.style.transform = ''; });
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
        if (ED.overlay || !UI.ctx || typeof document === 'undefined') { return; }
        ensureStyle();
        ED.i = i;
        ED.open = -1;
        ED.toast = '';
        var overlay = document.createElement('div');
        overlay.id = 'screenEditor';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.innerHTML = '<div class="se-hdr"><button type="button" class="se-back" data-se="close" aria-label="Back">' + I_BACK
            + '</button><h2 class="se-ttl" data-se-title></h2>'
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
        if (PConf.hooks && PConf.hooks.onReady) { PConf.hooks.onReady(function (ctx) { UI.ctx = ctx; }); }
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
        PConf.actions.addScreen = function (arg, S, env) {
            var i = addScreen(S, env);
            if (i >= 0) { UI.toast = null; openEditor(i); }
            return true;
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
        if (PConf.onChange) { PConf.onChange.register('radarSourcePicked', radarSourcePicked); }
        if (PConf.optionsResolvers) {
            PConf.optionsResolvers.register('apliteLayouts', function () { return APLITE_LAYOUTS.slice(); });
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
        hasScreens: hasScreens,
        ensureCustom: ensureCustom,
        applyModes: applyModes,
        barsShown: barsShown,
        fillNewBars: fillNewBars,
        writeScreen: writeScreen,
        snapshot: snapshot,
        restore: restore,
        deleteScreen: deleteScreen,
        insertScreen: insertScreen,
        addScreen: addScreen,
        contents: contents,
        drawnView: drawnView,
        screenPicture: screenPicture,
        setRadarEnabled: setRadarEnabled,
        radarModeToSave: radarModeToSave,
        screensCard: screensCard,
        editorBody: editorBody,
        radarSourceValue: radarSourceValue,
        radarSourcePicked: radarSourcePicked,
        batterySaverPauseHint: batterySaverPauseHint,
        _test: { ED: ED, UI: UI, openEditor: openEditor, closeEditor: closeEditor }
    };
    if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
    if (typeof window !== 'undefined') { window.ScreensPage = api; }
})();
