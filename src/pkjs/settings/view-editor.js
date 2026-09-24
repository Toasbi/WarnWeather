// src/pkjs/settings/view-editor.js — ES5, WebView. The Custom-layout editor: a
// full-screen overlay (wizard pattern — NOT the engine's #modal, whose edit sheets
// cannot host select triggers) with one tab per view, each tab a reorderable element
// list over the per-view keys (custom-layout-schema.js customViewItems /
// view-cycle.js buildCustomCycle — the storage contract). Select rows open the engine's sheets via
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
    // C = clock, A = upper status slot, B = lower status slot. The GRAPH (G) is not an
    // order letter — it is pinned below the stack, and removable (viewBody 'none');
    // the TOP BAR is not a letter either — it is pinned above the stack
    // (presence-only, flicks).

    /** Per-view key name. @param {string} stem @param {number} i @returns {string} */
    function k(stem, i) { return 'view' + stem + i; }

    /**
     * Which bands are on screen for view `i`: the four movable ones and the graph.
     * @param {Object} S settings state
     * @param {number} i view slot
     * @returns {{T:boolean,C:boolean,A:boolean,B:boolean,G:boolean}}
     */
    function presence(S, i) {
        return {
            T: (S[k('Top', i)] || 'cal2') !== 'none',
            C: i === 0 || !S[k('ClockOff', i)],
            A: (S[k('Upper', i)] || 'off') !== 'off',
            B: (S[k('Lower', i)] || 'off') !== 'off',
            G: (S[k('Body', i)] || 'forecast') !== 'none'
        };
    }

    /**
     * How many of the view's elements (top area, clock, status bars, graph) are on
     * screen. A view never drops to zero — the last one keeps its ✕ withheld.
     * @param {Object} S @param {number} i @returns {number} 0-5
     */
    function elementCount(S, i) {
        var pres = presence(S, i), n = 0, j, names = ['T', 'C', 'A', 'B', 'G'];
        for (j = 0; j < names.length; j++) { if (pres[names[j]]) { n++; } }
        return n;
    }

    /**
     * Canonicalize an order array in place: A renders above B by contract (the
     * compiler assigns the visually-upper source to the wire's upper slot). A
     * B-before-A ordering with BOTH rows present swaps the letters AND the two rows'
     * sources. With one row absent its letter only marks a free slot, so that letter
     * moves instead (B to just after A, or A to just before B) and the present row
     * keeps its own slot — swapping sources there would turn a lone upper row into a
     * lone LOWER row, which the legacy engine draws elsewhere (the swap layout).
     * @param {string[]} ord 4-letter order array (mutated)
     * @param {Object} S settings state (sources swapped when needed)
     * @param {number} i view slot
     * @returns {void}
     */
    function canonicalize(ord, S, i) {
        var ai = ord.indexOf('A'), bi = ord.indexOf('B');
        if (bi > ai) { return; }
        var pres = presence(S, i);
        if (pres.A && pres.B) {
            ord[ai] = 'B'; ord[bi] = 'A';
            var tmp = S[k('Upper', i)];
            S[k('Upper', i)] = S[k('Lower', i)];
            S[k('Lower', i)] = tmp;
        } else if (!pres.B) {
            ord.splice(bi, 1);
            ord.splice(ord.indexOf('A') + 1, 0, 'B');
        } else {
            ord.splice(ai, 1);
            ord.splice(ord.indexOf('B'), 0, 'A');
        }
    }

    /** @param {Object} S @param {number} i @returns {string[]} valid order array */
    function orderArr(S, i) {
        var s = String(S[k('Order', i)] || 'TACB');
        if (viewCycleLib.orderCode(s) === 0 && s !== 'TACB') { s = 'TACB'; }
        return s.split('');
    }

    /**
     * The band order view `i` renders in when it STORES the legacy order code 0
     * ('TACB' — what every preset seeds). A view the watch stacks even at code 0 (a
     * removed clock or top bar — viewCycleLib.isStacked, the watch's own dispatch
     * rule) is drawn literally as 'TACB'. Otherwise the legacy engine seats the upper
     * status row above the clock only under the 2-row (COMPACT) calendar; a 3-row
     * calendar, a radar top and no top at all put the clock first and the status
     * row(s) below it (layout.c compute_with_weights). Read off the COMPILED spec, which
     * already folds a radar top the watch can't draw — with its order code stripped:
     * the question is what code 0 renders, and storedOrderFor asks it while the view
     * still holds a stacked code (which would otherwise always answer 'TACB').
     * @param {Object} S @param {number} i @returns {string} 'TACB' or 'TCAB'
     */
    function legacyOrder(S, i) {
        var compiled = viewCycleLib.buildCustomCycle(S)[i];
        if (!compiled) { return 'TCAB'; }
        if (stackedAtCode0(compiled)) { return 'TACB'; }
        return (compiled.tier === viewCycleLib.TIER_COMPACT) ? 'TACB' : 'TCAB';
    }

    /**
     * Would this compiled view render through the watch's STACKED engine if it stored
     * the legacy order code 0? (viewCycleLib.isStacked with the order code stripped.)
     * @param {!Object} compiled spec from buildCustomCycle
     * @returns {boolean}
     */
    function stackedAtCode0(compiled) {
        var s = viewCycleLib.cloneSpec(compiled);
        delete s.order;
        return viewCycleLib.isStacked(s);
    }

    /**
     * What an edit must not disturb: the order view `i` is drawn in now, and which
     * engine draws its code 0. Take it BEFORE an edit that can switch engines (the
     * graph, the top bar, a Top-area or Graph pick, a size); hand it to keepOrder after.
     * @param {Object} S @param {number} i
     * @returns {{shown: string[], stacked: boolean}}
     */
    function orderSnapshot(S, i) {
        var compiled = viewCycleLib.buildCustomCycle(S)[i];
        return { shown: displayOrder(S, i), stacked: Boolean(compiled) && stackedAtCode0(compiled) };
    }

    /**
     * After an edit: if it switched the engine that draws view `i`'s legacy code — the
     * legacy engine draws a 3-row calendar, radar or no-top view clock-first (T C A),
     * the stacker literally (T A C) — store the order the view was drawn in before, so
     * the bands the user did not touch stay where they were. storedOrderFor prefers the
     * legacy code whenever it draws that order, so undoing the edit restores the view
     * byte for byte. A no-op when the engine did not change.
     * @param {Object} S settings state (mutated)
     * @param {number} i view slot
     * @param {{shown: string[], stacked: boolean}} snap orderSnapshot() before the edit
     * @returns {void}
     */
    function keepOrder(S, i, snap) {
        var compiled = viewCycleLib.buildCustomCycle(S)[i];
        var now = Boolean(compiled) && stackedAtCode0(compiled);
        if (now === snap.stacked) { return; }
        storeOrder(S, i, snap.shown.slice());
    }

    /**
     * The order view `i` is DISPLAYED (and edited) in: what the watch renders. A stacked
     * order code renders as stored; the legacy code renders per legacyOrder, so a
     * seeded fullCal/noCal view lists its status bar below the clock, where it is.
     * @param {Object} S @param {number} i @returns {string[]} display order array
     */
    function displayOrder(S, i) {
        var ord = orderArr(S, i);
        if (viewCycleLib.orderCode(ord.join('')) !== 0) { return ord; }
        return legacyOrder(S, i).split('');
    }

    /** @param {string} seq order letters @param {Object} pres presence() @returns {string} the present ones */
    function visibleBands(seq, pres) {
        var out = '', j;
        for (j = 0; j < seq.length; j++) { if (pres[seq.charAt(j)]) { out += seq.charAt(j); } }
        return out;
    }

    /**
     * The order string to STORE so the watch renders view `i` as the (canonical) display
     * order `ord`: the legacy 'TACB' when the legacy render already shows the present
     * bands in that order — so a seeded preset moved away and back is byte-identical
     * again — else the stacked code spelling it, else any stacked code showing the same
     * present bands in the same order (an absent band's slot is free). null when no wire
     * order renders it: a status bar above the clock with a second one below it, over a
     * 3-row calendar or radar, is only the legacy slot's order, which that top renders
     * differently — and the stacked engine has no code for it.
     * @param {Object} S @param {number} i @param {string[]} ord canonical display order
     * @returns {?string} the order to store, or null when unrepresentable
     */
    function storedOrderFor(S, i, ord) {
        var pres = presence(S, i);
        var want = visibleBands(ord.join(''), pres);
        if (visibleBands(legacyOrder(S, i), pres) === want) { return 'TACB'; }
        if (viewCycleLib.orderCode(ord.join('')) !== 0) { return ord.join(''); }
        var c;
        for (c = 1; c < viewCycleLib.STACK_ORDERS.length; c++) {
            if (visibleBands(viewCycleLib.STACK_ORDERS[c], pres) === want) { return viewCycleLib.STACK_ORDERS[c]; }
        }
        return null;
    }

    /**
     * Canonicalize `ord` (which may swap the two status sources) and store the order the
     * watch renders it in. When nothing renders it, the sources are put back and nothing
     * is stored.
     * @param {Object} S settings state (mutated on success)
     * @param {number} i view slot
     * @param {string[]} ord display order array (mutated)
     * @returns {boolean} whether it was stored
     */
    function storeOrder(S, i, ord) {
        var up = S[k('Upper', i)], lo = S[k('Lower', i)];
        canonicalize(ord, S, i);
        var stored = storedOrderFor(S, i, ord);
        if (stored === null) {
            S[k('Upper', i)] = up;
            S[k('Lower', i)] = lo;
            return false;
        }
        S[k('Order', i)] = stored;
        return true;
    }

    /**
     * Move a band one visible step up (dir -1) or down (dir +1): swap with the
     * nearest PRESENT band in that direction (absent bands keep their stored place
     * and are stepped over). Works on the DISPLAYED order, so the arrows move what the
     * list shows. No-op at the visible edge, and where no wire order renders the result
     * (see storedOrderFor).
     * @param {Object} S settings state (mutated)
     * @param {number} i view slot
     * @param {string} band 'T'|'C'|'A'|'B'
     * @param {number} dir -1 up | +1 down
     * @returns {boolean} whether anything changed
     */
    function moveBand(S, i, band, dir) {
        var ord = displayOrder(S, i);
        var pres = presence(S, i);
        var idx = -1, j;
        for (j = 0; j < 4; j++) { if (ord[j] === band) { idx = j; } }
        if (idx < 0 || !pres[band]) { return false; }
        j = idx + dir;
        while (j >= 0 && j < 4 && !pres[ord[j]]) { j += dir; }
        if (j < 0 || j > 3) { return false; }
        var tmp = ord[idx]; ord[idx] = ord[j]; ord[j] = tmp;
        return storeOrder(S, i, ord);
    }

    /**
     * Send a band to the end of the order (directly above the graph) — where a
     * re-added element lands; or, where the watch can't render it there (see
     * storedOrderFor), as low as it can.
     * @param {Object} S settings state (mutated)
     * @param {number} i view slot
     * @param {string} band 'T'|'C'|'A'|'B'
     * @param {string[]} [from] the display order to start from — the one shown BEFORE
     *   the element was re-added, since re-adding the top area can change the tier
     *   and with it the legacy display order. Defaults to the current display order.
     * @returns {void}
     */
    function bandToEnd(S, i, band, from) {
        var ord = from || displayOrder(S, i);
        var others = [], j, pos;
        for (j = 0; j < 4; j++) { if (ord[j] !== band) { others.push(ord[j]); } }
        for (pos = others.length; pos >= 0; pos--) {
            if (storeOrder(S, i, others.slice(0, pos).concat([band], others.slice(pos)))) { return; }
        }
    }

    /**
     * Remove an element from view `i`. The clock and top bar only on flicks (the schema
     * has no slot-0 keys for them anyway); the graph on every view, the Default
     * included. The view's last element is never removed.
     * @param {Object} S @param {number} i
     * @param {string} el 'topbar'|'T'|'C'|'A'|'B'|'G'
     * @returns {boolean} whether anything changed
     */
    function removeElement(S, i, el) {
        var snap;
        if (el === 'topbar') {
            if (i === 0 || S[k('StripOff', i)]) { return false; }
            snap = orderSnapshot(S, i);
            S[k('StripOff', i)] = true;
            keepOrder(S, i, snap);
            return true;
        }
        if (elementCount(S, i) <= 1) { return false; }
        if (el === 'G') {
            if (!presence(S, i).G) { return false; }
            snap = orderSnapshot(S, i);
            S[k('Body', i)] = 'none';
            keepOrder(S, i, snap);
            return true;
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
     * capability gates buildCustomCycle folds by (viewCycleLib.capabilities —
     * the shared table), so the fresh row never compiles straight to NONE.
     * null when no distinct capable source exists.
     * @param {Object} S @param {number} i @returns {?string}
     */
    function freeStatusSource(S, i) {
        var sibling = (S[k('Upper', i)] || 'off') !== 'off' ? S[k('Upper', i)]
                    : (S[k('Lower', i)] || 'off') !== 'off' ? S[k('Lower', i)] : null;
        var cap = viewCycleLib.capabilities(S);
        var candidates = ['weather', 'radar', 'health'], j, c;
        for (j = 0; j < candidates.length; j++) {
            c = candidates[j];
            if (c === sibling) { continue; }
            if (c === 'radar' && !cap.radarRow) { continue; }
            if (c === 'health' && !cap.healthRow) { continue; }
            return c;
        }
        return null;
    }

    /**
     * The graph a re-added Graph band should carry in view `i`: the first of
     * forecast/health/radar that the Top area does not already show (one seat per
     * graph kind — each graph layer is a single instance) and that passes the same
     * capability gates buildCustomCycle folds by (a health graph needs healthMode
     * 'all', a radar chart radarMode 'graph'). null when none is left.
     * @param {Object} S @param {number} i @returns {?string}
     */
    function freeBodyContent(S, i) {
        var top = S[k('Top', i)] || 'cal2';
        var cap = viewCycleLib.capabilities(S);
        var candidates = ['forecast', 'health', 'radar'], j, c;
        for (j = 0; j < candidates.length; j++) {
            c = candidates[j];
            if (c === top) { continue; }
            if (c === 'health' && !cap.healthBody) { continue; }
            if (c === 'radar' && !cap.radarChart) { continue; }
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
        if (!pres.G && freeBodyContent(S, i) !== null) { out.push(['Graph', 'graph']); }
        return out;
    }

    /**
     * Add an element to view `i` (lands directly above the graph; the user moves it
     * from there). 'status' fills whichever status slot is free — the fresh row
     * ends visually lowest via bandToEnd + canonicalize, or as low as the watch can
     * render it (a second status bar under a 3-row calendar whose first sits above
     * the clock lands right below the first).
     * @param {Object} S @param {number} i @param {string} kind
     * @returns {boolean} whether anything changed
     */
    function addElement(S, i, kind) {
        // The order as shown before the element appears: re-adding the top area turns a
        // no-top view into a 2-row one, which changes how a legacy order displays.
        var snap = orderSnapshot(S, i);
        var shown = snap.shown;
        if (kind === 'topbar') {
            if (i === 0 || !S[k('StripOff', i)]) { return false; }
            S[k('StripOff', i)] = false;
            keepOrder(S, i, snap);
            return true;
        }
        if (kind === 'clock') {
            if (i === 0 || !S[k('ClockOff', i)]) { return false; }
            S[k('ClockOff', i)] = false;
            bandToEnd(S, i, 'C', shown); return true;
        }
        if (kind === 'top') {
            if ((S[k('Top', i)] || 'cal2') !== 'none') { return false; }
            S[k('Top', i)] = 'cal2';
            bandToEnd(S, i, 'T', shown); return true;
        }
        if (kind === 'graph') {
            var g = freeBodyContent(S, i);
            if (presence(S, i).G || g === null) { return false; }
            S[k('Body', i)] = g;
            S[k('BodySize', i)] = 'fill';
            // One fill per view: a fresh graph takes the space, a filling top reverts.
            if (S[k('TopSize', i)] === 'fill') { S[k('TopSize', i)] = '3'; }
            keepOrder(S, i, snap);
            return true;
        }
        if (kind === 'status') {
            var pres = presence(S, i);
            var src = freeStatusSource(S, i);
            if (src === null) { return false; }
            if (!pres.A) {
                S[k('Upper', i)] = src;
                bandToEnd(S, i, 'A', shown); return true;
            }
            if (!pres.B) {
                S[k('Lower', i)] = src;
                bandToEnd(S, i, 'B', shown); return true;
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

    /**
     * Set view `i`'s Position (where a stack nothing fills sits): 'clock' | 'top' |
     * 'center' | 'bottom'. Unknown values are ignored.
     * @param {Object} S @param {number} i @param {string} v
     * @returns {boolean} whether anything changed
     */
    function setAlign(S, i, v) {
        if (!Object.prototype.hasOwnProperty.call(viewCycleLib.ALIGN_CODE, v)) { return false; }
        if (S[k('Align', i)] === v) { return false; }
        S[k('Align', i)] = v;
        return true;
    }

    /**
     * Whether view `i` currently has a band that fills the leftover space (then the
     * Position control does not apply and is not shown). Read off the COMPILED spec, so
     * capability folds count (e.g. a health graph folded to the forecast still fills).
     * @param {Object} S @param {number} i @returns {boolean}
     */
    function viewHasFill(S, i) {
        var s = viewCycleLib.buildCustomCycle(S)[i];
        return Boolean(s) && viewCycleLib.hasFill(s);
    }

    var VIEW_KEY_STEMS = ['Top', 'Body', 'Upper', 'Lower', 'Order', 'TopSize', 'BodySize', 'Align'];

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
        + 'border-radius:10px;background:none;color:#FA4A35;font:700 13.5px Inter,sans-serif;cursor:pointer}'
        // The Position band: label + the page's segmented control (.seg, shell.html),
        // wrapping onto a second line on narrow phones; tighter buttons fit four.
        + '#viewEditor .ve-band.ve-pos{flex-wrap:wrap;row-gap:8px}'
        + '#viewEditor .ve-seg button{padding:6px 9px}';

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

    /**
     * The Position band for view `i`: where a stack nothing fills sits. 'Clock'
     * centres the clock on the screen and is offered only while the view has one; a
     * stored 'clock' on a clockless view renders (and shows) as Middle.
     * @param {Object} S @param {number} i @param {Object} pres presence()
     * @returns {string} HTML
     */
    function positionHtml(S, i, pres) {
        var cur = S[k('Align', i)] || 'clock';
        if (cur === 'clock' && !pres.C) { cur = 'center'; }
        var opts = [['Clock', 'clock'], ['Top', 'top'], ['Middle', 'center'], ['Bottom', 'bottom']];
        var btns = '', j;
        for (j = 0; j < opts.length; j++) {
            if (opts[j][1] === 'clock' && !pres.C) { continue; }
            btns += '<button type="button"' + (opts[j][1] === cur ? ' class="on"' : '')
                + ' data-ve-align="' + opts[j][1] + '">' + opts[j][0] + '</button>';
        }
        return '<div class="ve-row"><div class="ve-band ve-pos"><span class="lbl">Position</span>'
            + '<div class="seg ve-seg">' + btns + '</div></div></div>';
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
        var ord = displayOrder(S, i);   // what the watch renders, not the stored letters
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
            var last = elementCount(S, i) <= 1;
            if (b === 'T') {
                body += rowHtml({
                    label: 'Top area', value: optionLabel(k('Top', i), S[k('Top', i)] || 'cal2'),
                    selectKey: k('Top', i), del: last ? null : 'T', band: 'T'
                });
            } else if (b === 'C') {
                body += rowHtml({ label: 'Clock', fixed: i === 0, del: (i > 0 && !last) ? 'C' : null, band: 'C' });
            } else if (b === 'A' || b === 'B') {
                var key = b === 'A' ? k('Upper', i) : k('Lower', i);
                body += rowHtml({
                    label: 'Status bar', value: optionLabel(key, S[key]),
                    selectKey: key, del: last ? null : b, band: b
                });
            }
        }
        // The graph is pinned last (no arrows) and removable on every view — the ✕ is
        // withheld only while it is the view's last element.
        var canRemove = elementCount(S, i) > 1;
        if (pres.G) {
            body += rowHtml({
                label: 'Graph', value: optionLabel(k('Body', i), S[k('Body', i)] || 'forecast'),
                selectKey: k('Body', i), del: canRemove ? 'G' : null
            });
        }
        if (!viewHasFill(S, i)) { body += positionHtml(S, i, pres); }

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
        if ((t = e.target.closest('[data-ve-align]'))) {
            setAlign(S, i, t.getAttribute('data-ve-align'));
            renderEditor();
            return;
        }
        if ((t = e.target.closest('[data-select]'))) {
            var sk = t.getAttribute('data-select');
            // Before the sheet writes: a pick can switch engines (keepOrder).
            var snap = orderSnapshot(S, i);
            VE.ctx.openSheet(sk, function () {
                normalizeAfterPick(S, i, sk);
                keepOrder(S, i, snap);
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
            displayOrder: displayOrder,
            bandToEnd: bandToEnd, removeElement: removeElement, addElement: addElement,
            addableElements: addableElements, freeStatusSource: freeStatusSource,
            freeBodyContent: freeBodyContent, elementCount: elementCount,
            setAlign: setAlign, viewHasFill: viewHasFill,
            orderSnapshot: orderSnapshot, keepOrder: keepOrder,
            normalizeAfterPick: normalizeAfterPick,
            takeSnapshot: takeSnapshot, restoreSnapshot: restoreSnapshot,
            addView: addView, removeView: removeView, viewCount: viewCount,
            _test: { openEditor: openEditor, closeEditor: closeEditor, renderEditor: renderEditor, VE: VE }
        };
    }
}());
