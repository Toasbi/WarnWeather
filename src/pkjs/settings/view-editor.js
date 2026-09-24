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
    // Band letters match view-cycle.js STACK_ORDERS: T = top band (calendar/radar/graph),
    // C = clock, A = upper status slot, B = lower status slot. The GRAPH (G) is not an
    // order letter — it is pinned below the stack, and removable (viewBody 'none');
    // the TOP BAR is not a letter either — it is pinned above the stack
    // (presence-only, flicks).

    /** Per-view key name. @param {string} stem @param {number} i @returns {string} */
    function k(stem, i) { return 'view' + stem + i; }

    /**
     * Is this Top-area value the calendar — 'cal' (rows in viewTopSize) or one of the
     * older 'cal2' / 'cal3' spellings?
     * @param {?string} v @returns {boolean}
     */
    function isCal(v) { return v === 'cal' || v === 'cal2' || v === 'cal3'; }

    /**
     * Rewrite view `i`'s older calendar spelling ('cal2' / 'cal3') to 'cal' + its rows in
     * viewTopSize — the same compiled view, so nothing on the wire changes.
     * @param {Object} S @param {number} i @returns {void}
     */
    function modernizeCal(S, i) {
        var v = S[k('Top', i)];
        if (v === 'cal2' || v === 'cal3') {
            S[k('Top', i)] = 'cal';
            S[k('TopSize', i)] = v === 'cal2' ? '2' : '3';
        }
    }

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
     * lone LOWER row, which the legacy order draws elsewhere (the swap layout).
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
     * ('TACB' — what every preset seeds). A view drawn literally even at code 0 (a
     * removed clock or top bar — viewCycleLib.isStacked, the watch's own order rule)
     * shows 'TACB'. Otherwise the legacy order seats the upper status row above the
     * clock only under a 2-row top area (COMPACT); a 3-row calendar, a radar top and no
     * top at all put the clock first and the status row(s) below it (layout.c
     * compute_layout). Read off the COMPILED spec, which
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
     * Would this compiled view be drawn in its LITERAL band order if it stored
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
     * order rule draws its code 0. Take it BEFORE an edit that can switch the rule (the
     * graph, the top bar, a Top-area or Graph pick, a size); hand it to keepOrder after.
     * @param {Object} S @param {number} i
     * @returns {{shown: string[], stacked: boolean}}
     */
    function orderSnapshot(S, i) {
        var compiled = viewCycleLib.buildCustomCycle(S)[i];
        return { shown: displayOrder(S, i), stacked: Boolean(compiled) && stackedAtCode0(compiled) };
    }

    /**
     * After an edit: if it switched the rule that draws view `i`'s legacy code — the
     * legacy order draws a 3-row calendar, radar or no-top view clock-first (T C A), the
     * literal order as T A C — store the order the view was drawn in before, so
     * the bands the user did not touch stay where they were. storedOrderFor prefers the
     * legacy code whenever it draws that order, so undoing the edit restores the view
     * byte for byte. A no-op when nothing moved.
     * @param {Object} S settings state (mutated)
     * @param {number} i view slot
     * @param {{shown: string[], stacked: boolean}} snap orderSnapshot() before the edit
     * @returns {boolean} false when no stored order can draw the bands where they were
     *   (the view then shows them in the new rule's order)
     */
    function keepOrder(S, i, snap) {
        var compiled = viewCycleLib.buildCustomCycle(S)[i];
        var now = Boolean(compiled) && stackedAtCode0(compiled);
        var pres = presence(S, i);
        var want = visibleBands(snap.shown.join(''), pres);
        if (now === snap.stacked) {
            // Same rule — but the legacy order itself depends on the top area's
            // rows (2 rows: status above the clock; 3 rows: below), so a calendar size
            // change can still move a band: put it back where it was drawn. When the
            // legacy code draws it, prefer that code (storedOrderFor's rule), so sizing
            // the calendar and sizing it back is byte-identical.
            if (!now && viewCycleLib.orderCode(orderArr(S, i).join('')) !== 0
                    && visibleBands(legacyOrder(S, i), pres) === want) {
                S[k('Order', i)] = 'TACB';
                return true;
            }
            if (visibleBands(displayOrder(S, i).join(''), pres) === want) { return true; }
            return storeOrder(S, i, snap.shown.slice());
        }
        // Back on the legacy order and its code 0 draws the same bands: store the legacy
        // code, so a view that started as a preset seed returns to it byte for byte.
        if (!now && visibleBands(legacyOrder(S, i), pres) === want) {
            S[k('Order', i)] = 'TACB';
            return true;
        }
        // The stored order still draws what the user saw under the new rule: keep it,
        // so a view that started on a stacked code keeps that exact code.
        if (visibleBands(displayOrder(S, i).join(''), pres) === want) { return true; }
        return storeOrder(S, i, snap.shown.slice());
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
     * differently — and no literal order code spells it.
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

    // What removing each element writes (removeElement / removalEmpties).
    var REMOVE_WRITE = {
        T: ['Top', 'none'], C: ['ClockOff', true], A: ['Upper', 'off'],
        B: ['Lower', 'off'], G: ['Body', 'none']
    };

    /**
     * Would removing `el` leave view `i` with nothing on screen? Judged on the COMPILED
     * view (a trial compile of the state with the removal applied), so a stored element
     * the capability folds already hide — a Radar status bar with radar off — does not
     * count as keeping the view alive. buildCustomCycle compiles an empty flick to null.
     * @param {Object} S @param {number} i @param {string} el 'T'|'C'|'A'|'B'|'G'
     * @returns {boolean}
     */
    function removalEmpties(S, i, el) {
        var w = REMOVE_WRITE[el];
        if (!w) { return false; }
        var trial = {}, key;
        for (key in S) {
            if (Object.prototype.hasOwnProperty.call(S, key)) { trial[key] = S[key]; }
        }
        trial[k(w[0], i)] = w[1];
        return !viewCycleLib.buildCustomCycle(trial)[i];
    }

    /**
     * Remove an element from view `i`. The clock and top bar only on flicks (the schema
     * has no slot-0 keys for them anyway); the graph on every view, the Default
     * included. A removal that would leave the view with nothing on screen is refused
     * (removalEmpties).
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
        if (removalEmpties(S, i, el)) { return false; }
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
            S[k('Top', i)] = 'none';
            S[k('TopSize', i)] = '3';   // a size belongs to the removed content, not the seat
            return true;
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
        // 'Top area', not 'Calendar': it lands as a calendar, but it is the seat — its
        // content is picked (calendar, radar, a graph) on the row once it is added.
        if (!pres.T) { out.push(['Top area', 'top']); }
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
            S[k('Top', i)] = 'cal';
            S[k('TopSize', i)] = '2';   // a 2-row calendar, as a fresh top area always was
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
     * (the fresh pick wins, the sibling clears), and each graph layer is a single
     * instance, so radar, the forecast and the health graph each take the top area OR
     * the graph row — the fresh pick wins.
     * @param {Object} S @param {number} i @param {string} key the key just edited
     * @returns {void}
     */
    function normalizeAfterPick(S, i, key) {
        var up = k('Upper', i), lo = k('Lower', i), top = k('Top', i), bodyK = k('Body', i);
        if (key === up && S[up] !== 'off' && S[up] === S[lo]) { S[lo] = 'off'; }
        if (key === lo && S[lo] !== 'off' && S[lo] === S[up]) { S[up] = 'off'; }
        if (key === top && S[key] === 'radar' && S[bodyK] === 'radar') {
            S[bodyK] = 'forecast';
        }
        if (key === bodyK && S[key] === 'radar' && S[top] === 'radar') {
            S[top] = 'cal';
            S[k('TopSize', i)] = '2';
        }
        // One seat per graph: picking the Graph row's graph for the Top area MOVES it up
        // (the graph row empties); picking the top's graph for the Graph row moves it down
        // (the top area goes back to a 2-row calendar).
        var graph = { forecast: true, health: true };
        if (key === top && graph[S[top]] && S[bodyK] === S[top]) { S[bodyK] = 'none'; }
        if (key === bodyK && graph[S[bodyK]] && S[top] === S[bodyK]) {
            S[top] = 'cal';
            S[k('TopSize', i)] = '2';
        }
        modernizeCal(S, i);
        // The top area's size follows it to its new content, within what that content
        // takes: a calendar has 2 or 3 rows (4 / Fill → 3), a forecast never 2 (→ 3).
        var ts = S[k('TopSize', i)] || '3';
        if (S[top] === 'cal' && ts !== '2' && ts !== '3') { S[k('TopSize', i)] = '3'; }
        if (S[top] === 'forecast' && ts === '2') { S[k('TopSize', i)] = '3'; }
        if (key === bodyK && S[bodyK] === 'forecast' && S[k('BodySize', i)] === '2') { S[k('BodySize', i)] = '3'; }
    }

    var SIZE_VALUES = ['2', '3', '4', 'fill'];

    /**
     * Set a band size of view `i`: stem 'TopSize' (a radar/graph top area) or
     * 'BodySize' (the graph), value '2' | '3' | '4' | 'fill'. One band fills per view:
     * making one fill turns a filling other into 3 rows.
     * @param {Object} S @param {number} i @param {string} stem @param {string} v
     * @returns {boolean} whether anything changed
     */
    function setSize(S, i, stem, v) {
        if ((stem !== 'TopSize' && stem !== 'BodySize') || SIZE_VALUES.indexOf(v) < 0) { return false; }
        if (stem === 'TopSize' && isCal(S[k('Top', i)])) {
            // A calendar's size is its rows: 2 or 3 (there is no 4th row, and it never fills).
            if (v !== '2' && v !== '3') { return false; }
            var before = shownSize(S, i, 'TopSize');
            modernizeCal(S, i);
            S[k('TopSize', i)] = v;
            return before !== v;
        }
        if (S[k(stem, i)] === v) { return false; }
        S[k(stem, i)] = v;
        if (v === 'fill') {
            var other = stem === 'TopSize' ? 'BodySize' : 'TopSize';
            var cur = S[k(other, i)] || (other === 'BodySize' ? 'fill' : '3');
            if (cur === 'fill') { S[k(other, i)] = '3'; }
        }
        return true;
    }

    /**
     * The size a seat SHOWS: the stored value with its default, a forecast seat's '2'
     * reading as the '3' it compiles to.
     * @param {Object} S @param {number} i @param {string} stem 'TopSize'|'BodySize'
     * @returns {string} '2'|'3'|'4'|'fill'
     */
    function shownSize(S, i, stem) {
        var v = S[k(stem, i)] || (stem === 'TopSize' ? '3' : 'fill');
        var content = S[k(stem === 'TopSize' ? 'Top' : 'Body', i)];
        if (stem === 'TopSize' && isCal(content)) {
            if (content === 'cal2') { return '2'; }
            if (content === 'cal3') { return '3'; }
            return v === '2' ? '2' : '3';
        }
        return (content === 'forecast' && v === '2') ? '3' : v;
    }

    /** @returns {string} the edited watch's platform ('' = unknown: both screens must fit) */
    function editFamily() {
        return (VE.ctx && VE.ctx.ENV && VE.ctx.ENV.platform) || '';
    }

    /**
     * Can view `i` take `stem` = `v`? A trial of the edit (setSize's one-fill rule and
     * keepOrder included): the view must fit the edited watch (view-cycle.js stackFits)
     * and keep every band where it is drawn — a size that switches the view's order rule
     * while no stored order can hold the bands in place would move one across the clock.
     * @param {Object} S @param {number} i @param {string} stem @param {string} v
     * @returns {boolean}
     */
    function sizeFits(S, i, stem, v) {
        var trial = {}, key;
        for (key in S) {
            if (Object.prototype.hasOwnProperty.call(S, key)) { trial[key] = S[key]; }
        }
        var snap = orderSnapshot(trial, i);
        setSize(trial, i, stem, v);
        if (!keepOrder(trial, i, snap)) { return false; }
        return viewCycleLib.stackFits(viewCycleLib.buildCustomCycle(trial)[i], editFamily()).fits;
    }

    /**
     * Set view `i`'s Alignment (where a stack nothing fills sits): 'clock' | 'top' |
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
     * Alignment control does not apply and is not shown). Read off the COMPILED spec, so
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
        // The Alignment section: a view setting below the element list, not an element —
        // divider, a heading in the page's .subhdr style, a one-line why, then the page's
        // segmented control (.seg, shell.html); tighter buttons fit four on a 320 px phone.
        + '#viewEditor .ve-align{margin:16px 0 4px;padding-top:14px;border-top:1px solid var(--screen-line)}'
        + '#viewEditor .ve-align-hd{font:800 11.5px Inter,sans-serif;letter-spacing:.1em;'
        + 'text-transform:uppercase;color:var(--ttl);margin-bottom:5px}'
        + '#viewEditor .ve-align .ve-note{margin:0 0 10px;color:var(--muted);'
        + 'font:500 12.5px/1.35 Inter,sans-serif}'
        + '#viewEditor .ve-seg button{padding:6px 9px}'
        // Two-line bands (a sized top area / the graph): the picker line, then the size line.
        + '#viewEditor .ve-band.ve-2l{flex-direction:column;align-items:stretch;gap:9px}'
        + '#viewEditor .ve-line{display:flex;align-items:center;gap:10px}'
        + '#viewEditor .ve-size .ve-cap{flex:1;color:var(--muted);font:600 12px Inter,sans-serif}'
        + '#viewEditor .ve-over{margin:4px 2px 8px;color:#FA4A35;font:600 12.5px/1.35 Inter,sans-serif}'
        // The live preview of the tab's view, centred above its element list.
        + '#viewEditor .ve-preview{display:flex;justify-content:center;margin:0 0 12px}';

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

    /**
     * One element row: dropdown trigger (optional), × inside, ▲▼ outside. With
     * `opts.size` (the size line's HTML) the band is two lines: the picker line, which
     * alone carries data-select, then the size line — a tap there never opens the sheet.
     */
    function rowHtml(opts) {
        var line = '<span class="lbl">' + esc(opts.label) + '</span>'
            + (opts.value ? '<span class="val">' + esc(opts.value) + '</span><span class="caret">▾</span>' : '')
            + (opts.del ? '<button type="button" class="ve-del" data-ve-del="' + esc(opts.del)
                + '" aria-label="Remove ' + esc(opts.label) + '">✕</button>' : '');
        var sel = opts.selectKey ? ' data-select="' + esc(opts.selectKey) + '"' : '';
        var band = opts.size
            ? '<div class="ve-band ve-2l' + (opts.fixed ? ' fixed' : '') + '">'
              + '<div class="ve-line"' + sel + '>' + line + '</div>' + opts.size + '</div>'
            : '<div class="ve-band' + (opts.fixed ? ' fixed' : '') + '"' + sel + '>' + line + '</div>';
        var arrows = opts.band
            ? '<div class="ve-arrows">'
              + '<button type="button" class="ve-mv" data-ve-mv="' + esc(opts.band) + ':-1" aria-label="Move up">▲</button>'
              + '<button type="button" class="ve-mv" data-ve-mv="' + esc(opts.band) + ':1" aria-label="Move down">▼</button>'
              + '</div>'
            : '';
        return '<div class="ve-row">' + band + arrows + '</div>';
    }

    /**
     * The size line of a sized band (a radar/graph top area, the graph): 2 · 3 · 4 ·
     * Fill rows of the calendar row. A choice is inert when the watch cannot show it: 2
     * rows of the forecast (its labels collide), or a size that makes the view too tall
     * for the edited watch — never the current value.
     * @param {Object} S @param {number} i @param {string} stem 'TopSize'|'BodySize'
     * @returns {string} HTML
     */
    function sizeHtml(S, i, stem) {
        var cur = shownSize(S, i, stem);
        var content = S[k(stem === 'TopSize' ? 'Top' : 'Body', i)];
        var forecast = content === 'forecast';
        var values = (stem === 'TopSize' && isCal(content)) ? ['2', '3'] : SIZE_VALUES;
        var btns = '', j, v, off;
        for (j = 0; j < values.length; j++) {
            v = values[j];
            off = v !== cur && ((forecast && v === '2') || !sizeFits(S, i, stem, v));
            btns += '<button type="button"' + (v === cur ? ' class="on"' : '')
                + ' data-ve-size="' + stem + ':' + v + '"' + (off ? ' disabled' : '') + '>'
                + (v === 'fill' ? 'Fill' : v) + '</button>';
        }
        return '<div class="ve-line ve-size"><span class="ve-cap">Size · rows</span>'
            + '<div class="seg ve-seg">' + btns + '</div></div>';
    }

    /**
     * The Alignment band for view `i`: where the elements sit, as one group, in the
     * space nothing fills (viewAlign). The note says why the row exists and what the
     * one non-obvious choice does; 'Clock mid' keeps the clock in the screen's middle
     * and is offered only while the view has a clock — a stored 'clock' on a clockless
     * view renders (and shows) as Middle.
     * @param {Object} S @param {number} i @param {Object} pres presence()
     * @returns {string} HTML
     */
    function alignmentHtml(S, i, pres) {
        var cur = S[k('Align', i)] || 'clock';
        if (cur === 'clock' && !pres.C) { cur = 'center'; }
        var opts = [['Top', 'top'], ['Middle', 'center'], ['Bottom', 'bottom'], ['Clock mid', 'clock']];
        var btns = '', j;
        for (j = 0; j < opts.length; j++) {
            if (opts[j][1] === 'clock' && !pres.C) { continue; }
            btns += '<button type="button"' + (opts[j][1] === cur ? ' class="on"' : '')
                + ' data-ve-align="' + opts[j][1] + '">' + opts[j][0] + '</button>';
        }
        var top = S[k('Top', i)] || 'cal2';
        var anyGraph = pres.G || top === 'radar' || top === 'forecast' || top === 'health';
        var why = anyGraph ? 'Nothing fills this view, so the elements sit together in the free space.'
                           : 'No graph, so the elements sit together in the free space.';
        if (pres.C) { why += ' Clock mid keeps the clock in the middle of the screen.'; }
        // A view SETTING, not a band: its own section under the element list (heading in
        // the page's .subhdr style, a divider above), never a card like the element rows.
        return '<div class="ve-align"><div class="ve-align-hd">Alignment</div>'
            + '<p class="ve-note">' + esc(why) + '</p>'
            + '<div class="seg ve-seg">' + btns + '</div></div>';
    }

    /**
     * The live preview of view `i` (preview-layout.js viewPreviewSvg): the schematic
     * band column the Layout tab shows, redrawn on every edit. '' when the preview
     * module is not on the page.
     * @param {Object} S @param {number} i @returns {string} HTML
     */
    function previewHtml(S, i) {
        var pl = (typeof require !== 'undefined') ? require('./preview-layout.js')
            : (PConf.previewLayout || null);
        if (!pl || !pl.viewPreviewSvg) { return ''; }
        var env = (VE.ctx && VE.ctx.ENV) || {};
        return '<div class="ve-preview">' + pl.viewPreviewSvg(S, env, i) + '</div>';
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
        var body = previewHtml(S, i);
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
            // Every ✕ is withheld where the removal would leave nothing on screen.
            if (b === 'T') {
                var topVal = S[k('Top', i)] || 'cal2';
                var sizedTop = isCal(topVal) || topVal === 'radar' || topVal === 'forecast'
                    || topVal === 'health';
                body += rowHtml({
                    label: 'Top area', value: optionLabel(k('Top', i), isCal(topVal) ? 'cal' : topVal),
                    selectKey: k('Top', i), del: removalEmpties(S, i, 'T') ? null : 'T', band: 'T',
                    size: sizedTop ? sizeHtml(S, i, 'TopSize') : null
                });
            } else if (b === 'C') {
                body += rowHtml({ label: 'Clock', fixed: i === 0,
                    del: (i > 0 && !removalEmpties(S, i, 'C')) ? 'C' : null, band: 'C' });
            } else if (b === 'A' || b === 'B') {
                var key = b === 'A' ? k('Upper', i) : k('Lower', i);
                body += rowHtml({
                    label: 'Status bar', value: optionLabel(key, S[key]),
                    selectKey: key, del: removalEmpties(S, i, b) ? null : b, band: b
                });
            }
        }
        // The graph is pinned last (no arrows) and removable on every view — the ✕ is
        // withheld only where it would leave nothing on screen.
        if (pres.G) {
            body += rowHtml({
                label: 'Graph', value: optionLabel(k('Body', i), S[k('Body', i)] || 'forecast'),
                selectKey: k('Body', i), del: removalEmpties(S, i, 'G') ? null : 'G',
                size: sizeHtml(S, i, 'BodySize')
            });
        }
        // A stored layout the edited watch cannot show whole (e.g. edited for a bigger
        // screen): say so — the watch clamps the last bands.
        var fit = viewCycleLib.stackFits(viewCycleLib.buildCustomCycle(S)[i], editFamily());
        if (!fit.fits) {
            body += '<p class="ve-over">Too tall for your watch by ' + fit.over
                + ' px — the bottom will be cut off.</p>';
        }

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
        if (!viewHasFill(S, i)) { body += alignmentHtml(S, i, pres); }
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
        if ((t = e.target.closest('[data-ve-size]'))) {
            if (t.disabled) { return; }
            var sz = t.getAttribute('data-ve-size').split(':');
            var sizeSnap = orderSnapshot(S, i);   // a size can switch the order rule (keepOrder)
            if (setSize(S, i, sz[0], sz[1])) { keepOrder(S, i, sizeSnap); }
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
            // Before the sheet writes: a pick can switch the order rule (keepOrder).
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
        // Older builds stored the calendar as 'cal2' / 'cal3': show it as the one
        // Calendar choice with its rows as the size (✕ restores the snapshot above).
        var mv;
        for (mv = 0; mv < 3; mv++) { modernizeCal(VE.ctx.S, mv); }
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
            removalEmpties: removalEmpties,
            setAlign: setAlign, viewHasFill: viewHasFill, setSize: setSize, sizeFits: sizeFits,
            orderSnapshot: orderSnapshot, keepOrder: keepOrder,
            normalizeAfterPick: normalizeAfterPick,
            takeSnapshot: takeSnapshot, restoreSnapshot: restoreSnapshot,
            addView: addView, removeView: removeView, viewCount: viewCount,
            _test: { openEditor: openEditor, closeEditor: closeEditor, renderEditor: renderEditor, VE: VE }
        };
    }
}());
