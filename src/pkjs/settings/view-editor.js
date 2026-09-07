// src/pkjs/settings/view-editor.js — ES5, WebView. The Custom-layout editor: a
// full-screen overlay (wizard pattern — NOT the engine's #modal, whose edit sheets
// cannot host select triggers) with one tab per view, each tab a reorderable element
// list over the per-view keys (schema.js customViewItems / view-cycle.js
// buildCustomCycle — the storage contract). Select rows open the engine's sheets via
// the onReady ctx's openSheet, which showModal()s ABOVE this overlay; edits write S
// live like every engine control, and the header's ✕ restores a snapshot taken on
// open while "Save layout" keeps S and closes — draft semantics without touching the
// sheet machinery. The pure reorder/add/remove core is exported for node tests.
/* global PConf */
var PConf = (typeof global !== 'undefined' && global.PConf) ? global.PConf
    : (typeof window !== 'undefined' && window.PConf) ? window.PConf
    : (typeof PConf !== 'undefined' && PConf) ? PConf
    : { hooks: {}, actions: {} };
(function () {
    'use strict';
    var viewCycleLib = (typeof require !== 'undefined')
        ? require('../view-cycle.js') : window.VIEW_CYCLE;

    // ── Pure core ───────────────────────────────────────────────────────────
    // Band letters match view-cycle.js STACK_ORDERS: T = top band (calendar/radar),
    // C = clock, A = upper status slot, B = lower status slot. The GRAPH is not a
    // letter — it is pinned below the stack and always present; the TOP BAR is not
    // a letter either — it is pinned above the stack (presence-only, flicks).

    /** Per-view key name. @param {string} stem @param {number} i @returns {string} */
    function k(stem, i) { return 'view' + stem + i; }

    /**
     * Which movable bands are on screen for view `i`.
     * @param {Object} S settings state
     * @param {number} i view slot
     * @returns {{T:boolean,C:boolean,A:boolean,B:boolean}}
     */
    function presence(S, i) {
        return {
            T: (S[k('Top', i)] || 'cal2') !== 'none',
            C: i === 0 || !S[k('ClockOff', i)],
            A: (S[k('Upper', i)] || 'off') !== 'off',
            B: (S[k('Lower', i)] || 'off') !== 'off'
        };
    }

    /**
     * Canonicalize an order array in place: A renders above B by contract (the
     * compiler assigns the visually-upper source to the wire's upper slot), so a
     * B-before-A ordering swaps the letters AND the two views' sources.
     * @param {string[]} ord 4-letter order array (mutated)
     * @param {Object} S settings state (sources swapped when needed)
     * @param {number} i view slot
     * @returns {void}
     */
    function canonicalize(ord, S, i) {
        var ai = -1, bi = -1, j;
        for (j = 0; j < 4; j++) {
            if (ord[j] === 'A') { ai = j; }
            if (ord[j] === 'B') { bi = j; }
        }
        if (bi < ai) {
            ord[ai] = 'B'; ord[bi] = 'A';
            var tmp = S[k('Upper', i)];
            S[k('Upper', i)] = S[k('Lower', i)];
            S[k('Lower', i)] = tmp;
        }
    }

    /** @param {Object} S @param {number} i @returns {string[]} valid order array */
    function orderArr(S, i) {
        var s = String(S[k('Order', i)] || 'TACB');
        if (viewCycleLib.orderCode(s) === 0 && s !== 'TACB') { s = 'TACB'; }
        return s.split('');
    }

    /**
     * Move a band one visible step up (dir -1) or down (dir +1): swap with the
     * nearest PRESENT band in that direction (absent bands keep their stored place
     * and are stepped over). No-op at the visible edge.
     * @param {Object} S settings state (mutated)
     * @param {number} i view slot
     * @param {string} band 'T'|'C'|'A'|'B'
     * @param {number} dir -1 up | +1 down
     * @returns {boolean} whether anything changed
     */
    function moveBand(S, i, band, dir) {
        var ord = orderArr(S, i);
        var pres = presence(S, i);
        var idx = -1, j;
        for (j = 0; j < 4; j++) { if (ord[j] === band) { idx = j; } }
        if (idx < 0 || !pres[band]) { return false; }
        j = idx + dir;
        while (j >= 0 && j < 4 && !pres[ord[j]]) { j += dir; }
        if (j < 0 || j > 3) { return false; }
        var tmp = ord[idx]; ord[idx] = ord[j]; ord[j] = tmp;
        canonicalize(ord, S, i);
        S[k('Order', i)] = ord.join('');
        return true;
    }

    /**
     * Send a band to the end of the stored order (directly above the graph) —
     * where a re-added element lands.
     * @param {Object} S @param {number} i @param {string} band @returns {void}
     */
    function bandToEnd(S, i, band) {
        var ord = orderArr(S, i);
        var out = [], j;
        for (j = 0; j < 4; j++) { if (ord[j] !== band) { out.push(ord[j]); } }
        out.push(band);
        canonicalize(out, S, i);
        S[k('Order', i)] = out.join('');
    }

    /**
     * Remove an element from view `i`. The graph cannot be removed; the clock and
     * top bar only on flicks (the schema has no slot-0 keys for them anyway).
     * @param {Object} S @param {number} i
     * @param {string} el 'topbar'|'T'|'C'|'A'|'B'
     * @returns {boolean} whether anything changed
     */
    function removeElement(S, i, el) {
        if (el === 'topbar') {
            if (i === 0 || S[k('StripOff', i)]) { return false; }
            S[k('StripOff', i)] = true; return true;
        }
        if (el === 'C') {
            if (i === 0 || S[k('ClockOff', i)]) { return false; }
            S[k('ClockOff', i)] = true; return true;
        }
        if (el === 'T') {
            if ((S[k('Top', i)] || 'cal2') === 'none') { return false; }
            S[k('Top', i)] = 'none'; return true;
        }
        if (el === 'A') {
            if ((S[k('Upper', i)] || 'off') === 'off') { return false; }
            S[k('Upper', i)] = 'off'; return true;
        }
        if (el === 'B') {
            if ((S[k('Lower', i)] || 'off') === 'off') { return false; }
            S[k('Lower', i)] = 'off'; return true;
        }
        return false;
    }

    /**
     * The source a fresh status row should carry in view `i`: the first of
     * weather/radar/health that (a) is not already on the sibling row (the C
     * invariant — no source repeats across bands) and (b) passes the same
     * capability gates buildCustomCycle folds by, so the fresh row never
     * compiles straight to NONE. null when no distinct capable source exists.
     * @param {Object} S @param {number} i @returns {?string}
     */
    function freeStatusSource(S, i) {
        var sibling = (S[k('Upper', i)] || 'off') !== 'off' ? S[k('Upper', i)]
                    : (S[k('Lower', i)] || 'off') !== 'off' ? S[k('Lower', i)] : null;
        var radarOk = S.radarMode === 'status' || S.radarMode === 'graph';
        var healthOk = S.healthMode === 'status' || S.healthMode === 'all';
        var candidates = ['weather', 'radar', 'health'], j, c;
        for (j = 0; j < candidates.length; j++) {
            c = candidates[j];
            if (c === sibling) { continue; }
            if (c === 'radar' && !radarOk) { continue; }
            if (c === 'health' && !healthOk) { continue; }
            return c;
        }
        return null;
    }

    /**
     * What ＋ can still add to view `i`, as [label, kind] pairs.
     * @param {Object} S @param {number} i @returns {Array}
     */
    function addableElements(S, i) {
        var out = [];
        var pres = presence(S, i);
        if (i > 0 && S[k('StripOff', i)]) { out.push(['Top bar (battery & date)', 'topbar']); }
        if (!pres.T) { out.push(['Calendar', 'top']); }
        if (i > 0 && S[k('ClockOff', i)]) { out.push(['Clock', 'clock']); }
        // Source-aware, not just slot-aware: with no distinct capable source left
        // (e.g. weather already shown, radar and health off) a second row would
        // duplicate the sibling and fold away — don't offer it.
        if ((!pres.A || !pres.B) && freeStatusSource(S, i) !== null) {
            out.push(['Status bar', 'status']);
        }
        return out;
    }

    /**
     * Add an element to view `i` (lands directly above the graph; the user moves it
     * from there). 'status' fills whichever status slot is free — the fresh row
     * always ends visually lowest via bandToEnd + canonicalize.
     * @param {Object} S @param {number} i @param {string} kind
     * @returns {boolean} whether anything changed
     */
    function addElement(S, i, kind) {
        if (kind === 'topbar') {
            if (i === 0 || !S[k('StripOff', i)]) { return false; }
            S[k('StripOff', i)] = false; return true;
        }
        if (kind === 'clock') {
            if (i === 0 || !S[k('ClockOff', i)]) { return false; }
            S[k('ClockOff', i)] = false;
            bandToEnd(S, i, 'C'); return true;
        }
        if (kind === 'top') {
            if ((S[k('Top', i)] || 'cal2') !== 'none') { return false; }
            S[k('Top', i)] = 'cal2';
            bandToEnd(S, i, 'T'); return true;
        }
        if (kind === 'status') {
            var pres = presence(S, i);
            var src = freeStatusSource(S, i);
            if (src === null) { return false; }
            if (!pres.A) {
                S[k('Upper', i)] = src;
                bandToEnd(S, i, 'A'); return true;
            }
            if (!pres.B) {
                S[k('Lower', i)] = src;
                bandToEnd(S, i, 'B'); return true;
            }
            return false;
        }
        return false;
    }

    /**
     * Normalize after a sheet pick: no source repeats across the two status rows
     * (the fresh pick wins, the sibling clears), and the single radar layer means
     * radar-in-top and radar-in-body are mutually exclusive (the fresh pick wins).
     * @param {Object} S @param {number} i @param {string} key the key just edited
     * @returns {void}
     */
    function normalizeAfterPick(S, i, key) {
        var up = k('Upper', i), lo = k('Lower', i);
        if (key === up && S[up] !== 'off' && S[up] === S[lo]) { S[lo] = 'off'; }
        if (key === lo && S[lo] !== 'off' && S[lo] === S[up]) { S[up] = 'off'; }
        if (key === k('Top', i) && S[key] === 'radar' && S[k('Body', i)] === 'radar') {
            S[k('Body', i)] = 'forecast';
        }
        if (key === k('Body', i) && S[key] === 'radar' && S[k('Top', i)] === 'radar') {
            S[k('Top', i)] = 'cal2';
        }
    }

    var VIEW_KEY_STEMS = ['Top', 'Body', 'Upper', 'Lower', 'Order'];

    /** @param {number} count @returns {string[]} every custom key for `count` views */
    function allCustomKeys() {
        var keys = ['viewCount'], i, s;
        for (i = 0; i < 3; i++) {
            for (s = 0; s < VIEW_KEY_STEMS.length; s++) { keys.push(k(VIEW_KEY_STEMS[s], i)); }
            if (i > 0) { keys.push(k('ClockOff', i)); keys.push(k('StripOff', i)); }
        }
        return keys;
    }

    /** @param {Object} S @returns {Object} snapshot of the custom keys */
    function takeSnapshot(S) {
        var snap = {}, keys = allCustomKeys(), i;
        for (i = 0; i < keys.length; i++) { snap[keys[i]] = S[keys[i]]; }
        return snap;
    }

    /** @param {Object} S @param {Object} snap @returns {void} */
    function restoreSnapshot(S, snap) {
        var keys = allCustomKeys(), i;
        for (i = 0; i < keys.length; i++) { S[keys[i]] = snap[keys[i]]; }
    }

    /** @param {Object} S @returns {number} 1-3 */
    function viewCount(S) {
        var n = parseInt(S.viewCount, 10);
        return (n >= 1 && n <= 3) ? n : 1;
    }

    /**
     * Add a view (up to 3): the new tab starts as a copy of the Default view.
     * @param {Object} S @returns {number} the new view's index, or -1 when full
     */
    function addView(S) {
        var n = viewCount(S);
        if (n >= 3) { return -1; }
        var s;
        for (s = 0; s < VIEW_KEY_STEMS.length; s++) {
            S[k(VIEW_KEY_STEMS[s], n)] = S[k(VIEW_KEY_STEMS[s], 0)];
        }
        S[k('ClockOff', n)] = false;
        S[k('StripOff', n)] = false;
        S.viewCount = String(n + 1);
        return n;
    }

    /**
     * Remove flick view `i` (never the Default); later views compact down so the
     * freed last slot packs to 0 on the wire.
     * @param {Object} S @param {number} i @returns {boolean}
     */
    function removeView(S, i) {
        var n = viewCount(S);
        if (i < 1 || i >= n) { return false; }
        var j, s;
        for (j = i; j < n - 1; j++) {
            for (s = 0; s < VIEW_KEY_STEMS.length; s++) {
                S[k(VIEW_KEY_STEMS[s], j)] = S[k(VIEW_KEY_STEMS[s], j + 1)];
            }
            S[k('ClockOff', j)] = Boolean(S[k('ClockOff', j + 1)]);
            S[k('StripOff', j)] = Boolean(S[k('StripOff', j + 1)]);
        }
        S.viewCount = String(n - 1);
        return true;
    }

    // ── Overlay (webview only) ──────────────────────────────────────────────

    var VE = { ctx: null, tab: 0, overlay: null, snapshot: null, addOpen: false };

    var VE_CSS =
        '#viewEditor{position:fixed;top:0;left:0;right:0;bottom:0;z-index:1000;display:flex;'
        + 'flex-direction:column;max-width:460px;margin:0 auto;background:var(--bg);'
        + 'color:var(--fg);font-family:Inter,system-ui,sans-serif}'
        + '#viewEditor .ve-hd{display:flex;align-items:center;gap:12px;padding:14px 16px 8px;flex:none}'
        + '#viewEditor .ve-hd h2{flex:1;margin:0;color:#FA4A35;font-size:19px;font-weight:800}'
        + '#viewEditor .ve-x{border:1px solid var(--ctl-line);background:var(--ctl);color:var(--fg);'
        + 'border-radius:9px;font:700 15px Inter,sans-serif;padding:7px 12px;cursor:pointer}'
        + '#viewEditor .ve-save{border:none;border-radius:9px;padding:8px 16px;cursor:pointer;'
        + 'background:linear-gradient(135deg,#FA4A35,#D93A24);color:#fff;font:700 13.5px Inter,sans-serif}'
        + '#viewEditor .ve-tabs{display:flex;gap:8px;padding:6px 16px 10px;flex:none}'
        + '#viewEditor .ve-body{flex:1;min-height:0;overflow-y:auto;padding:4px 16px 16px}'
        + '#viewEditor .ve-row{display:flex;align-items:stretch;gap:8px;margin-bottom:8px}'
        + '#viewEditor .ve-band{flex:1;display:flex;align-items:center;gap:10px;'
        + 'background:var(--card);border:1px solid var(--screen-line);border-radius:10px;padding:12px 12px}'
        + '#viewEditor .ve-band.fixed{opacity:.75}'
        + '#viewEditor .ve-band .lbl{flex:1;font:600 14px Inter,sans-serif;color:var(--lbl)}'
        + '#viewEditor .ve-band .val{color:var(--muted);font:500 13px Inter,sans-serif}'
        + '#viewEditor .ve-band .caret{color:var(--muted)}'
        + '#viewEditor .ve-del{border:none;background:none;color:var(--muted);'
        + 'font:700 15px Inter,sans-serif;cursor:pointer;padding:2px 6px}'
        + '#viewEditor .ve-arrows{display:flex;flex-direction:column;gap:4px;justify-content:center}'
        + '#viewEditor .ve-mv{border:1px solid var(--ctl-line);background:var(--ctl);color:var(--fg);'
        + 'border-radius:7px;font:700 11px Inter,sans-serif;padding:3px 9px;cursor:pointer}'
        + '#viewEditor .ve-mv[disabled]{opacity:.35;cursor:default}'
        + '#viewEditor .ve-add{display:block;width:100%;margin:10px 0 4px;padding:11px;border-radius:10px;'
        + 'border:1px dashed var(--line-strong);background:none;color:var(--fg);'
        + 'font:700 13.5px Inter,sans-serif;cursor:pointer}'
        + '#viewEditor .ve-addlist{margin:6px 0}'
        + '#viewEditor .ve-additem{display:block;width:100%;text-align:left;margin-bottom:6px;'
        + 'padding:10px 12px;border-radius:9px;border:1px solid var(--ctl-line);background:var(--ctl);'
        + 'color:var(--fg);font:600 13.5px Inter,sans-serif;cursor:pointer}'
        + '#viewEditor .ve-remove{display:block;width:100%;margin-top:14px;padding:11px;border:none;'
        + 'border-radius:10px;background:none;color:#FA4A35;font:700 13.5px Inter,sans-serif;cursor:pointer}';

    function esc(s) {
        return (PConf.engine && PConf.engine.esc) ? PConf.engine.esc(s) : String(s);
    }

    /** Current option label for key `key` in state S (falls back to the raw value). */
    function optionLabel(key, value) {
        var found = value == null ? '' : String(value);
        if (PConf.schemaWalk && PConf.schemaWalk.eachItem && VE.ctx) {
            PConf.schemaWalk.eachItem(VE.ctx.schema, function (it) {
                if (it.messageKey !== key || !it.options) { return; }
                var i;
                for (i = 0; i < it.options.length; i++) {
                    if (it.options[i][1] === value) { found = it.options[i][0]; }
                }
            });
        }
        return found;
    }

    /** One element row: dropdown trigger (optional), × inside, ▲▼ outside. */
    function rowHtml(opts) {
        var band = '<div class="ve-band' + (opts.fixed ? ' fixed' : '')
            + (opts.selectKey ? '" data-select="' + esc(opts.selectKey) : '') + '">'
            + '<span class="lbl">' + esc(opts.label) + '</span>'
            + (opts.value ? '<span class="val">' + esc(opts.value) + '</span><span class="caret">▾</span>' : '')
            + (opts.del ? '<button type="button" class="ve-del" data-ve-del="' + esc(opts.del)
                + '" aria-label="Remove ' + esc(opts.label) + '">✕</button>' : '')
            + '</div>';
        var arrows = opts.band
            ? '<div class="ve-arrows">'
              + '<button type="button" class="ve-mv" data-ve-mv="' + esc(opts.band) + ':-1" aria-label="Move up">▲</button>'
              + '<button type="button" class="ve-mv" data-ve-mv="' + esc(opts.band) + ':1" aria-label="Move down">▼</button>'
              + '</div>'
            : '';
        return '<div class="ve-row">' + band + arrows + '</div>';
    }

    function renderEditor() {
        if (!VE.overlay || !VE.ctx) { return; }
        var S = VE.ctx.S;
        var count = viewCount(S);
        if (VE.tab >= count) { VE.tab = count - 1; }
        var i = VE.tab;
        var names = ['Default', 'Flick 1', 'Flick 2'];
        var tabs = '', t;
        for (t = 0; t < count; t++) {
            tabs += '<button type="button" class="tab' + (t === VE.tab ? ' on' : '')
                + '" data-ve-tab="' + t + '">' + names[t] + '</button>';
        }
        if (count < 3) {
            tabs += '<button type="button" class="tab" data-ve-tab="add" aria-label="Add a view">＋</button>';
        }
        VE.overlay.querySelector('[data-ve-tabs]').innerHTML = tabs;

        var pres = presence(S, i);
        var ord = orderArr(S, i);
        var body = '';
        if (i === 0 || !S[k('StripOff', i)]) {
            body += rowHtml({
                label: 'Top bar', value: 'battery · date', fixed: true,
                del: i > 0 ? 'topbar' : null
            });
        }
        var j;
        for (j = 0; j < 4; j++) {
            var b = ord[j];
            if (!pres[b]) { continue; }
            if (b === 'T') {
                body += rowHtml({
                    label: 'Top area', value: optionLabel(k('Top', i), S[k('Top', i)] || 'cal2'),
                    selectKey: k('Top', i), del: 'T', band: 'T'
                });
            } else if (b === 'C') {
                body += rowHtml({ label: 'Clock', fixed: i === 0, del: i > 0 ? 'C' : null, band: 'C' });
            } else if (b === 'A' || b === 'B') {
                var key = b === 'A' ? k('Upper', i) : k('Lower', i);
                body += rowHtml({
                    label: 'Status bar', value: optionLabel(key, S[key]),
                    selectKey: key, del: b, band: b
                });
            }
        }
        body += rowHtml({
            label: 'Graph', value: optionLabel(k('Body', i), S[k('Body', i)] || 'forecast'),
            selectKey: k('Body', i), fixed: true
        });

        var addable = addableElements(S, i);
        if (addable.length) {
            body += '<button type="button" class="ve-add" data-ve-addtoggle>＋ Add element</button>';
            if (VE.addOpen) {
                body += '<div class="ve-addlist">';
                for (j = 0; j < addable.length; j++) {
                    body += '<button type="button" class="ve-additem" data-ve-add="'
                        + esc(addable[j][1]) + '">' + esc(addable[j][0]) + '</button>';
                }
                body += '</div>';
            }
        }
        if (i > 0) {
            body += '<button type="button" class="ve-remove" data-ve-removeview>Remove this view</button>';
        }
        VE.overlay.querySelector('[data-ve-body]').innerHTML = body;
    }

    function closeEditor(keep) {
        if (!VE.overlay) { return; }
        if (!keep && VE.snapshot) { restoreSnapshot(VE.ctx.S, VE.snapshot); }
        if (VE.overlay.parentNode) { VE.overlay.parentNode.removeChild(VE.overlay); }
        VE.overlay = null;
        VE.snapshot = null;
        document.removeEventListener('keydown', onKeydown);
        if (VE.ctx) { VE.ctx.render(); }
    }

    function onKeydown(e) {
        if (e.key !== 'Escape') { return; }
        // The engine's select sheet is a top-layer <dialog>; while it is open its own
        // cancel handler owns Escape — a second press then reaches us and closes the
        // editor. Without this guard one press would double-close.
        var modal = document.getElementById('modal');
        if (modal && modal.open) { return; }
        closeEditor(false);
    }

    function onClick(e) {
        if (!e.target || !e.target.closest || !VE.ctx) { return; }
        var S = VE.ctx.S, i = VE.tab, t;
        if ((t = e.target.closest('[data-ve-tab]'))) {
            var v = t.getAttribute('data-ve-tab');
            if (v === 'add') {
                var added = addView(S);
                if (added >= 0) { VE.tab = added; }
            } else {
                VE.tab = parseInt(v, 10) || 0;
            }
            VE.addOpen = false;
            renderEditor();
            return;
        }
        if ((t = e.target.closest('[data-ve-del]'))) {
            removeElement(S, i, t.getAttribute('data-ve-del'));
            renderEditor();
            return;
        }
        if ((t = e.target.closest('[data-ve-mv]'))) {
            var mv = t.getAttribute('data-ve-mv').split(':');
            moveBand(S, i, mv[0], parseInt(mv[1], 10));
            renderEditor();
            return;
        }
        if ((t = e.target.closest('[data-ve-addtoggle]'))) {
            VE.addOpen = !VE.addOpen;
            renderEditor();
            return;
        }
        if ((t = e.target.closest('[data-ve-add]'))) {
            addElement(S, i, t.getAttribute('data-ve-add'));
            VE.addOpen = false;
            renderEditor();
            return;
        }
        if ((t = e.target.closest('[data-ve-removeview]'))) {
            removeView(S, i);
            VE.tab = 0;
            renderEditor();
            return;
        }
        if ((t = e.target.closest('[data-select]'))) {
            var sk = t.getAttribute('data-select');
            VE.ctx.openSheet(sk, function () {
                normalizeAfterPick(S, i, sk);
                renderEditor();
            });
            return;
        }
        if ((t = e.target.closest('[data-ve-save]'))) { closeEditor(true); return; }
        if ((t = e.target.closest('[data-ve-close]'))) { closeEditor(false); return; }
    }

    function ensureStyle() {
        if (document.getElementById('ve-style')) { return; }
        var st = document.createElement('style');
        st.id = 've-style';
        st.textContent = VE_CSS;
        document.head.appendChild(st);
    }

    function openEditor() {
        if (VE.overlay || !VE.ctx || typeof document === 'undefined') { return; }
        ensureStyle();
        VE.snapshot = takeSnapshot(VE.ctx.S);
        VE.tab = 0;
        VE.addOpen = false;
        var overlay = document.createElement('div');
        overlay.id = 'viewEditor';
        overlay.innerHTML =
            '<div class="ve-hd">'
            + '<button type="button" class="ve-x" data-ve-close aria-label="Discard changes">✕</button>'
            + '<h2>Custom layout</h2>'
            + '<button type="button" class="ve-save" data-ve-save>Save layout</button>'
            + '</div>'
            + '<div class="ve-tabs" data-ve-tabs></div>'
            + '<div class="ve-body" data-ve-body></div>';
        document.body.appendChild(overlay);
        VE.overlay = overlay;
        overlay.addEventListener('click', onClick);
        document.addEventListener('keydown', onKeydown);
        renderEditor();
    }

    // Registration (guarded so requiring this file under Node is a no-op).
    if (PConf.hooks && PConf.hooks.onReady) {
        PConf.hooks.onReady(function (ctx) { VE.ctx = ctx; });
    }
    PConf.actions = PConf.actions || {};
    PConf.actions.openViewEditor = function () { openEditor(); };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = {
            presence: presence, canonicalize: canonicalize, moveBand: moveBand,
            bandToEnd: bandToEnd, removeElement: removeElement, addElement: addElement,
            addableElements: addableElements, freeStatusSource: freeStatusSource,
            normalizeAfterPick: normalizeAfterPick,
            takeSnapshot: takeSnapshot, restoreSnapshot: restoreSnapshot,
            addView: addView, removeView: removeView, viewCount: viewCount,
            _test: { openEditor: openEditor, closeEditor: closeEditor, renderEditor: renderEditor, VE: VE }
        };
    }
}());
