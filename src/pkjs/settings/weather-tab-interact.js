// src/pkjs/settings/weather-tab-interact.js — the Weather tab's pointer
// mechanics: the drag-pans-the-day-window gesture (with day snapping and
// rubber-banding), the tap-to-scrub handoff, and pull-to-refresh with its
// indicator pill. Owns the document listeners; everything tab-stateful
// (the prepared view, the viewed day, the crosshair, the refetch) is
// reached through the small api object weather-tab.js wires in — this
// module keeps no weather state of its own. ES5, WebView.
(function () {
    'use strict';

    // wired by weather-tab.js: view/day/commitDay/scrub/panTips/canPull/refresh
    var api = null;
    var wired = false;

    // The day change TRAVELS: a released pan glides onto its day rather than
    // cutting to it, so the eye can follow the timeline across instead of
    // having to re-find its place on the other side.
    //
    // It travels in one of two ways, and telling them apart is the whole
    // point of this block.
    //
    // CARRY — the pan keeps going the way the finger was already going. The
    // motion has a speed to match, so it must START at that speed and slow
    // down from there. A fixed duration cannot: an ease-out's opening speed
    // is (its initial slope) x (the distance left) / (the duration), which
    // knows nothing about the finger. Measured on the page before this: a
    // drag moving 4.0 px a frame released into a settle whose first frame
    // moved 18.6 px — the content lurching to 4.7x the speed of the hand
    // that let it go, then decelerating. So here the DURATION is derived
    // from the release speed and the distance instead (settleMsFor), and
    // the curve is a hard ease-out: most of the ground early, the last few
    // pixels settling, which reads as coming to rest rather than stopping.
    //
    // REST — a spring-back to the day already shown, a day tapped on the
    // tile row, or a release too slow to carry anything. There is no speed
    // to continue: a spring-back has to travel the OPPOSITE way to the
    // finger, so "start fast" is not continuity, it is the lurch. These
    // start from a standstill on a gentle symmetric curve.
    //
    // CARRY_MIN_V is the line between them. Under it a release is a hand
    // coming to a stop, and a settle that bolts away from a stopped finger
    // is the thing being complained about.
    var EASE_CARRY = 'cubic-bezier(0.16, 1, 0.3, 1)';
    var CARRY_SLOPE = 6.14;            // its speed at t=0, x the average
    var CARRY_MIN_MS = 160;
    var CARRY_MAX_MS = 700;
    var CARRY_MIN_V = 0.2;             // px/ms — 200 px a second

    // The from-rest curve is a different shape for a different job. It is
    // the gentlest ease-out that still only ever SLOWS DOWN: every curve
    // here was checked for that, and the symmetric ease-in-out this started
    // as failed it — from a standstill it accelerates through the middle,
    // which is a ramp-up wherever the eye is. Its duration comes from the
    // distance too, so that whatever it has to cover, it opens at about
    // REST_V and decelerates from there instead of bolting.
    var EASE_REST = 'cubic-bezier(0.61, 1, 0.88, 1)';
    var REST_SLOPE = 1.62;
    var REST_V = 0.32;                 // px/ms the rest curve opens at
    var REST_MIN_MS = 200;
    var REST_MAX_MS = 700;

    // The stylesheet's baked-in default, for the tile colours when nothing
    // has been armed (a class change outside any drag).
    var SETTLE_MS = 380;
    var SETTLE_CSS = (SETTLE_MS / 1000) + 's ' + EASE_REST;

    // The settle currently ARMED — every element that moves with the day
    // reads it from here (the panels, the tile row, the value tips riding
    // OUTSIDE the panned element, the tiles' inks) so that the CSS which
    // performs the motion and the JS timers that wait for it cannot drift
    // apart. armSettle writes it once per release, before anything moves.
    var settle = { ms: SETTLE_MS, css: SETTLE_CSS };

    /** @returns {string} The armed settle as a CSS transition tail. */
    function settleCss() { return settle.css; }

    /** @returns {number} The armed settle's duration in ms. */
    function settleMs() { return settle.ms; }

    /**
     * Clamp a duration into a range.
     * @param {number} ms Raw duration.
     * @param {number} lo Floor.
     * @param {number} hi Ceiling.
     * @returns {number} Whole ms inside [lo, hi].
     */
    function boundMs(ms, lo, hi) {
        if (!(ms > lo)) { return lo; }
        if (ms > hi) { return hi; }
        return Math.round(ms);
    }

    /**
     * How long a settle must last for its opening speed to be `v`: the
     * curve covers `dist` at an initial (slope x dist / ms), so the
     * duration is what sets that opening speed, and it is the only thing
     * that can.
     * @param {number} dist Distance still to travel, px.
     * @param {number} v Wanted opening speed, px/ms (sign ignored).
     * @param {number} slope The curve's speed at t=0, x its average.
     * @returns {number} Raw duration in ms.
     */
    function msFor(dist, v, slope) {
        var d = Math.abs(dist);
        var sp = Math.abs(v);
        if (!(d > 0) || !(sp > 0)) { return 0; }
        return slope * d / sp;
    }

    /**
     * Choose the settle the next animated move will run on, and arm it.
     *
     * `travel` and `v` are both measured along the CONTENT's direction of
     * travel in px: the same sign means the release keeps going the way it
     * was already going, which is the only case with a speed worth
     * matching. Anything else — a spring-back, a tapped tile, a hand that
     * had already stopped — starts from rest.
     * @param {number} travel Distance the content still has to cover, px.
     * @param {number} v The content's speed at release, px/ms.
     * @returns {{ms: number, css: string}} The armed settle.
     */
    function armSettle(travel, v) {
        var ms;
        if (Math.abs(v) >= CARRY_MIN_V && travel * v > 0) {
            ms = boundMs(msFor(travel, v, CARRY_SLOPE), CARRY_MIN_MS, CARRY_MAX_MS);
            settle = { ms: ms, css: (ms / 1000) + 's ' + EASE_CARRY };
        } else {
            ms = boundMs(msFor(travel, REST_V, REST_SLOPE), REST_MIN_MS, REST_MAX_MS);
            settle = { ms: ms, css: (ms / 1000) + 's ' + EASE_REST };
        }
        return settle;
    }

    /**
     * A chart viewport's width: the page's own scale, one day per screen.
     * Measured only for day changes that arrive with no gesture behind them
     * (a tapped tile, an arrow key), which are rare enough to afford the
     * layout read — and which otherwise have no distance to time by.
     * @returns {number} Pixels per day, or 0 when nothing is rendered.
     */
    function pageScale() {
        if (typeof document === 'undefined' || !document.querySelector) { return 0; }
        var el = document.querySelector('.wx-pan');
        var vp = el && el.parentNode;
        return (vp && vp.clientWidth) || 0;
    }

    /**
     * Arm the settle for a day change nobody dragged. It has a distance but
     * no speed, so it is always a from-rest one — timed by how far the page
     * has to go, because jumping four days and nudging one are not the same
     * journey.
     * @param {number} fromDay Day now shown.
     * @param {number} toDay Day being moved to.
     * @returns {{ms: number, css: string}} The armed settle.
     */
    function armJump(fromDay, toDay) {
        return armSettle((toDay - fromDay) * pageScale(), 0);
    }

    // The day tiles' own edge margin (weather-tab-css.js gives the first and
    // last tile 8px), needed here because the row's resting end is measured,
    // not scrolled: without it the last day parks 8px too far left.
    // test/weather-tab.test.js pins the two together.
    var EDGE_PAD = 8;

    // How long after a released pan a click is still that pan's tail. A
    // drag that STARTED on a day tile ends over one, and the engine would
    // dispatch its tap and jump to whatever day the finger happened to lift
    // over, fighting the snap.
    var TAP_SUPPRESS_MS = 400;

    var panEndedAt = 0;

    /**
     * The nearest ancestor (self included) carrying an attribute.
     * @param {?Node} node Event target.
     * @param {string} attr Attribute name.
     * @returns {?Element} The carrier, or null.
     */
    function findAttr(node, attr) {
        while (node && node.getAttribute) {
            if (node.getAttribute(attr)) { return node; }
            node = node.parentNode;
        }
        return null;
    }

    /**
     * The pan transform (percent of the wide inner element) for a day.
     * @param {number} day Day index.
     * @param {number} days Timeline day count.
     * @returns {number} translateX percentage (negative).
     */
    function panPct(day, days) {
        return -(day * 100 / days);
    }

    /**
     * Write one element's pan transform, eased or tracking the finger.
     * @param {Element} el Element to move.
     * @param {string} val transform value.
     * @param {boolean} animated Whether to ease (the day snap).
     * @returns {void}
     */
    function moveEl(el, val, animated) {
        var st = el.style;
        st.webkitTransition = animated ? '-webkit-transform ' + settle.css : 'none';
        st.transition = animated ? 'transform ' + settle.css : 'none';
        st.webkitTransform = val;
        st.transform = val;
    }

    /**
     * Apply the shared pan transform to EVERY panel's inner element — the
     * whole tab below the day selector moves as one.
     * @param {number} pct translateX percentage.
     * @param {boolean} animated Whether to ease (the day snap).
     * @returns {void}
     */
    function setPan(pct, animated) {
        if (typeof document === 'undefined' || !document.querySelectorAll) { return; }
        var els = document.querySelectorAll('.wx-pan');
        var val = 'translateX(' + pct + '%)';
        for (var i = 0; i < els.length; i += 1) { moveEl(els[i], val, animated); }
    }

    /**
     * The tile row's travel: how far it may move before its LAST SELECTABLE
     * tile sits flush against the viewport's right edge, and which day that
     * is. Tiles past the timeline's end (a provider can report more daily
     * rows than there are hours for) are drawn but never landed on, so they
     * stay outside the travel.
     *
     * Measured every time rather than cached: tile width is a percentage of
     * the page, so it changes with the window, and a render replaces the
     * row wholesale.
     * @param {number} days Selectable day count.
     * @returns {?{row: Element, max: number, top: number}} Row and travel.
     */
    function stripRest(days) {
        if (typeof document === 'undefined' || !document.querySelector) { return null; }
        var row = document.querySelector('.wx-days');
        var vp = row && row.parentNode;
        if (!vp) { return null; }
        var tiles = row.children || [];
        var w = vp.clientWidth || 0;
        if (!tiles.length || !w) { return null; }
        var top = tiles.length - 1;
        if (days - 1 < top) { top = days - 1; }
        if (top < 0) { return null; }
        var last = tiles[top];
        // The row is not a scroll container, so there is no scrollWidth to
        // trust: its extent is that tile's right edge plus its own trailing
        // margin.
        var max = last.offsetLeft + last.offsetWidth + EDGE_PAD - w;
        if (max < 0) { max = 0; }
        return { row: row, max: max, top: top };
    }

    /**
     * Move the day tiles to a (possibly fractional) day: a LINEAR ramp from
     * the row's start to its end, one equal step per day.
     *
     * Every day change therefore moves the tiles, which is the whole point —
     * they are part of the pan, not a strip that catches up afterwards.
     * Centering the selected tile instead would clamp to a standstill at
     * both ends (with five days the first two and last two centre out of
     * range), so the commonest swipe of all, today to tomorrow, would move
     * nothing. The ramp keeps every selectable tile fully in view anyway,
     * and both ends of the row stop flush instead of pulling in blank space.
     * @param {number} f Day, fractional mid-drag.
     * @param {number} days Selectable day count (past the ends the panels
     *   rubber-band; the tiles simply stop).
     * @param {boolean} animated Whether to ease (the day snap).
     * @returns {void}
     */
    function setDayStrip(f, days, animated) {
        var g = stripRest(days);
        if (!g) { return; }
        var at = f < 0 ? 0 : (f > g.top ? g.top : f);
        var off = g.top > 0 ? g.max * at / g.top : 0;
        moveEl(g.row, 'translateX(' + (-off).toFixed(1) + 'px)', animated);
    }

    /**
     * Whether a click arriving now is the tail of a pan just released.
     * @returns {boolean} True while such a click must be ignored.
     */
    function tapSuppressed() {
        // A negative age means the clock moved BACKWARDS since the pan (a
        // phone re-syncing its time, say). Fail open — a swallowed tap that
        // never unswallows would leave the tiles dead.
        var age = Date.now() - panEndedAt;
        return age >= 0 && age < TAP_SUPPRESS_MS;
    }

    /**
     * Keep the tile viewport's own scroll at zero.
     *
     * It clips with overflow:hidden, which stops the USER scrolling it but
     * not the ENGINE: bringing a focused element into view scrolls a hidden
     * box just the same (Chrome moves it 186px to reveal the last tile).
     * The row's position is a transform the viewed day owns, so a scroll
     * offset underneath it is a silent desync — every later transform would
     * be measured against a viewport that has moved.
     * @param {?Event} e Scroll event (capture phase — scroll does not bubble).
     * @returns {void}
     */
    function unscroll(e) {
        var el = e && e.target;
        if (!el || !el.className || typeof el.className !== 'string') { return; }
        if (el.className.indexOf('wx-daysvp') === -1) { return; }
        if (el.scrollLeft) { el.scrollLeft = 0; }
    }

    /**
     * A tile taking focus selects its day — which moves the row properly,
     * instead of the browser scrolling the box to reveal it.
     *
     * Pointer focus is ignored: pressing a tile focuses it before the click
     * (and before a drag that starts there has moved a pixel), so honouring
     * it would jump the day out from under the gesture. The click handler
     * owns that case, and the keyboard owns this one.
     * @param {?Event} e Focus event.
     * @returns {void}
     */
    function focusDay(e) {
        if (gesture || tapSuppressed()) { return; }
        var vp = findAttr(e && e.target, 'data-wxvp');
        if (!vp || vp.getAttribute('data-wxvp') !== 'days') { return; }
        var arg = e.target.getAttribute && e.target.getAttribute('data-action-arg');
        if (arg === null || arg === undefined || arg === '') { return; }
        var d = parseInt(arg, 10);
        var view = api.view();
        if (!view || !(d >= 0) || d > view.days - 1) { return; }
        if (d !== api.day()) { armJump(api.day(), d); api.commitDay(d); }
    }

    // How far past the release a flicked TILE ROW is treated as still
    // carrying. It is the row's momentum expressed as time: the finger's
    // speed is projected this long and the row lands wherever that runs
    // out. Longer and every flick pins the last day; shorter and a flick is
    // just a drag that happened to be fast.
    var FLING_MS = 120;

    /**
     * Which day a released drag lands on.
     *
     * The two surfaces are not the same gesture and must not answer the
     * same way. A chart is a PAGE: one swipe turns one day, whichever way
     * it went, because the graphs are read a day at a time and a swipe that
     * skipped two would leave the reader looking for their place. The tile
     * row is a ROW: it scrolls, and a quick swipe across it carries on past
     * the next day the way a flicked list does — which is what puts all
     * five days within one gesture instead of four.
     * @param {number} baseDay Day when the drag started.
     * @param {number} dxPx Horizontal drag distance (px, right = positive).
     * @param {number} scale Pixels of finger per day on THIS surface.
     * @param {number} days Timeline day count.
     * @param {number} dtMs Drag duration.
     * @param {number} v Release speed in px/ms (right = positive).
     * @param {boolean} tiles True when the gesture began on the tile row.
     * @returns {number} Target day, clamped to the timeline.
     */
    function snapTargetDay(baseDay, dxPx, scale, days, dtMs, v, tiles) {
        var at = baseDay - dxPx / scale;
        var target;
        if (tiles) {
            target = Math.round(at - (v || 0) * FLING_MS / scale);
            // A flick always moves at least one day. Momentum alone would
            // leave a short, fast swipe rounding back onto the day it
            // started from — and it always would when the row happens to
            // FIT its viewport (a two-day timeline, say): there is no row
            // travel to scale by then, the page scale takes over, and a
            // third of a screen is a third of a day. A swipe that fast and
            // that far was an instruction, whatever the arithmetic says.
            if (target === baseDay && dtMs < 300 && Math.abs(dxPx) > scale * 0.12) {
                target = baseDay + (dxPx < 0 ? 1 : -1);
            }
        } else if (dtMs < 300 && Math.abs(dxPx) > scale * 0.12) {
            target = baseDay + (dxPx < 0 ? 1 : -1);
        } else {
            target = Math.round(at);
        }
        if (target < 0) { target = 0; }
        if (target > days - 1) { target = days - 1; }
        return target;
    }

    // The trailing window the release speed is measured over. Short enough
    // that a drag which STALLED before the finger came up reads as stalled
    // — the speed that matters is the one the content had when it was let
    // go, not the average of the whole gesture.
    var VEL_MS = 90;

    /**
     * Remember one pointer sample, dropping the ones now out of the window.
     * @param {Object} g The live gesture.
     * @param {number} x Client x.
     * @param {number} t Sample time.
     * @returns {void}
     */
    function trackPoint(g, x, t) {
        g.pts.push({ x: x, t: t });
        while (g.pts.length > 2 && t - g.pts[0].t > VEL_MS) { g.pts.shift(); }
    }

    /**
     * The finger's speed as it left, over the trailing window.
     * @param {Object} g The live gesture.
     * @param {number} x Client x at release.
     * @param {number} t Release time.
     * @returns {number} px/ms, right positive; 0 when it cannot be measured.
     */
    function releaseV(g, x, t) {
        var first = g.pts.length ? g.pts[0] : null;
        if (!first) { return 0; }
        var dt = t - first.t;
        if (!(dt > 0)) { return 0; }
        return (x - first.x) / dt;
    }

    /**
     * Pixels of finger travel per day on the surface a gesture began on.
     *
     * A chart viewport IS a day, so a chart drag moves one day per screen.
     * The tile row is not: five tiles live in one screen, and its whole
     * travel is the few tiles that do not fit. Driving it at the chart's
     * scale meant a full-width sweep advanced one day and crept the row 48
     * px — the row read as stuck to the screen. At its own scale the finger
     * carries the tile under it, which is the only scale a row can have.
     * @param {Object} g The live gesture.
     * @returns {number} Pixels per day, never zero.
     */
    function gestureScale(g) {
        if (g.tiles) {
            var r = stripRest(g.days);
            // A row that fits its viewport has no travel to scale by; fall
            // back to the page scale rather than divide by nothing.
            if (r && r.top > 0 && r.max > 0) { return r.max / r.top; }
        }
        return g.vw;
    }

    /**
     * Where the timeline actually IS, as a fractional day, read off the live
     * transform rather than taken from the committed day.
     *
     * The two agree at rest and only at rest. A settle moves the panels over
     * as much as CARRY_MAX_MS, and a finger that comes down inside that
     * window is looking at a page between two days. Starting the new drag
     * from the COMMITTED day made the first move frame — which writes
     * transition:'none', cancelling the curve — snap the whole tab from
     * wherever it had got to straight to the destination: on a 390px
     * viewport, a ~190px jolt in the frame the user expected to keep
     * gliding. Flicking day to day is how you cross five days, so it was
     * every other swipe.
     * @param {number} days Timeline day count.
     * @returns {?number} Fractional day, or null when it cannot be read.
     */
    function liveDay(days) {
        if (typeof document === 'undefined' || !document.querySelector) { return null; }
        var pan = document.querySelector('.wx-pan');
        var vp = pan && pan.parentNode;
        if (!pan || !vp || !pan.getBoundingClientRect || !vp.getBoundingClientRect) { return null; }
        var pr = pan.getBoundingClientRect();
        var vr = vp.getBoundingClientRect();
        if (!vr.width) { return null; }
        // .wx-pan is as many viewports wide as there are days, and it is
        // translated by whole viewports, so the gap between the two left
        // edges IS the day, to scale — mid-curve included, because a
        // transform in flight is what getBoundingClientRect reports.
        var f = (vr.left - pr.left) / vr.width;
        // A read that lands mid-reflow, or a transform nobody has written
        // yet, is worse than the committed day: take it only when it is
        // somewhere the timeline could actually be.
        if (!(f > -1) || !(f < days)) { return null; }
        return f;
    }

    // --- gestures: drag pans the day window, tap scrubs the crosshair --------

    var gesture = null;

    /**
     * Start tracking a pointer that landed on a chart viewport.
     * @param {number} x Client x.
     * @param {number} y Client y.
     * @param {?Node} target Event target.
     * @returns {void}
     */
    function beginGesture(x, y, target) {
        var vpEl = findAttr(target, 'data-wxvp');
        var view = api.view();
        if (!vpEl || !view || !vpEl.getBoundingClientRect) { return; }
        var w = vpEl.getBoundingClientRect().width;
        if (!w) { return; }
        var t = Date.now();
        // Where the page IS, not where the last release sent it: a finger
        // down mid-settle continues the glide instead of teleporting it.
        var live = liveDay(view.days);
        gesture = {
            x0: x, y0: y, t0: t, vw: w, mode: null,
            base: live === null ? api.day() : live, days: view.days, target: target,
            tiles: vpEl.getAttribute('data-wxvp') === 'days',
            pts: [{ x: x, t: t }]
        };
        // Measured once, at touch-down: the row's geometry cannot change
        // mid-gesture (a resize is handled when no gesture is live), and a
        // layout read per drag frame is a frame's worth of work for an
        // answer that never moves.
        gesture.scale = gestureScale(gesture);
    }

    /**
     * Track movement: decide pan vs vertical scroll once, then drag the
     * canvas live (with rubber-banding past the ends).
     * @param {number} x Client x.
     * @param {number} y Client y.
     * @param {?Event} e The move event (preventDefault while panning).
     * @returns {void}
     */
    function moveGesture(x, y, e) {
        if (!gesture) { return; }
        var dx = x - gesture.x0;
        var dy = y - gesture.y0;
        if (gesture.mode === null) {
            if (Math.abs(dx) < 7 && Math.abs(dy) < 7) { return; }
            gesture.mode = Math.abs(dx) > Math.abs(dy) ? 'pan' : 'scroll';
        }
        if (gesture.mode !== 'pan') { return; }
        if (e && e.preventDefault) { e.preventDefault(); }
        trackPoint(gesture, x, Date.now());
        var f = gesture.base - dx / gesture.scale;
        if (f < 0) { f = f * 0.35; }
        if (f > gesture.days - 1) { f = (gesture.days - 1) + (f - (gesture.days - 1)) * 0.35; }
        setPan(-(f * 100 / gesture.days), false);
        // The value tips live OUTSIDE the panned element, so they need
        // the drag position handed to them or they hang in place while
        // the values slide out from under them. Unanimated: a drag frame
        // tracks the finger exactly.
        api.panTips(f, false);
        // So does the day strip, which travels at its own scale and hands
        // its highlight over as the drag crosses the day.
        api.panStrip(f, false);
    }

    /**
     * Finish: snap a pan to its day, or treat an unmoved press as a
     * crosshair tap.
     * @param {number} x Client x at release.
     * @returns {void}
     */
    function endGesture(x) {
        if (!gesture) { return; }
        var g = gesture;
        gesture = null;
        if (g.mode === 'pan') {
            // A refetch can land mid-gesture and shrink/grow the timeline;
            // snap against the CURRENT day count, not the one at touch-down.
            var view = api.view();
            var days = view ? view.days : g.days;
            var t = Date.now();
            var dx = x - g.x0;
            var v = releaseV(g, x, t);
            var target = snapTargetDay(g.base, dx, g.scale, days, t - g.t0, v, g.tiles);
            // Arm the settle BEFORE anything moves: every element that eases
            // home reads the armed curve, and they all have to read the same
            // one. Both numbers are in the CONTENT's frame — it travels the
            // opposite way to the finger, so the speed is negated — which is
            // what lets armSettle ask the one question that matters: is this
            // release still going where it was going?
            var atRelease = g.base - dx / g.scale;
            armSettle((target - atRelease) * g.scale, -v);
            panEndedAt = t;
            api.commitDay(target);
            return;
        }
        if (g.mode === null) {
            var chart = findAttr(g.target, 'data-wxchart');
            if (chart) { api.scrub(chart, x); }
        }
    }

    /**
     * Abort (touchcancel): ease back to the resting day.
     * @returns {void}
     */
    function cancelGesture() {
        if (!gesture) { return; }
        var g = gesture;
        gesture = null;
        if (g.mode === 'pan') {
            panEndedAt = Date.now();
            // An abort has no direction worth continuing: the content goes
            // back where it came from, which is a start from rest — timed
            // by however far the drag had got before it was taken away.
            var lastX = g.pts.length ? g.pts[g.pts.length - 1].x : g.x0;
            var at = g.base - (lastX - g.x0) / g.scale;
            armSettle((api.day() - at) * g.scale, 0);
            setPan(panPct(api.day(), g.days), true);
            api.panTips(api.day(), true);
            api.panStrip(api.day(), true);
        }
    }

    // --- pull-to-refresh: a downward pull from the page top on the Weather
    // tab refetches manually (the only refresh path besides the Refresh
    // button beside the 5-day title and reopening the tab — no timers, to
    // spare keyed APIs).

    var PULL_TRIGGER_PX = 70;
    var pull = null;   // {x0, y0, engaged, armed}

    /**
     * The page's current scroll offset (whichever element scrolls).
     * @returns {number} Pixels scrolled from the top.
     */
    function pageScrollTop() {
        var sc = document.getElementById('scroll');
        var a = sc ? sc.scrollTop : 0;
        var de = document.documentElement;
        var b = (typeof window !== 'undefined' && window.pageYOffset)
            || (de && de.scrollTop) || (document.body && document.body.scrollTop) || 0;
        return a > b ? a : b;
    }

    /**
     * Show/update the pull indicator pill (created lazily). The pill rides
     * the drag: damped translateY and a fade tied to the pull distance,
     * both written every move — but the TEXT and class only when the armed
     * state actually flips. Rewriting them per touchmove re-laid the pill
     * out every frame, which is what made it stutter.
     * @param {boolean} armed Past the release threshold.
     * @param {number} dy Current downward pull distance (px).
     * @returns {void}
     */
    function showPullPill(armed, dy) {
        var el = document.getElementById('wx-ptr');
        if (!el) {
            el = document.createElement('div');
            el.id = 'wx-ptr';
            document.body.appendChild(el);
        }
        el.style.display = 'block';
        if (el.getAttribute('data-armed') !== String(armed)) {
            el.setAttribute('data-armed', String(armed));
            el.className = armed ? 'on' : '';
            el.textContent = armed ? 'Release to refresh' : 'Pull to refresh';
        }
        var travel = dy * 0.35;
        if (travel > 46) { travel = 46; }
        var fade = dy / 56;
        if (fade > 1) { fade = 1; }
        el.style.opacity = String(fade);
        var t = 'translateX(-50%) translateY(' + travel.toFixed(1) + 'px)';
        el.style.webkitTransform = t;
        el.style.transform = t;
    }

    /** @returns {void} Hide the pull indicator pill. */
    function hidePullPill() {
        var el = document.getElementById('wx-ptr');
        if (el) { el.style.display = 'none'; }
    }

    /**
     * Start tracking a possible pull: Weather tab rendered, no overlay or
     * sheet open, and the page at its top.
     * @param {number} x Client x.
     * @param {number} y Client y.
     * @returns {void}
     */
    function beginPull(x, y) {
        pull = null;
        if (!api.canPull() || !document.querySelector) { return; }
        if (!document.querySelector('.wx-days')) { return; }
        if (document.getElementById('wxloc')) { return; }
        var modal = document.getElementById('modal');
        if (modal && modal.open) { return; }
        if (pageScrollTop() > 0) { return; }
        pull = { x0: x, y0: y, engaged: false, armed: false };
    }

    /**
     * Track a pull in progress; engages on a clearly-vertical downward drag
     * and hands off to the chart pan when that gesture claims the pointer.
     * @param {number} x Client x.
     * @param {number} y Client y.
     * @param {?Event} e The move event (preventDefault while engaged).
     * @returns {void}
     */
    function movePull(x, y, e) {
        if (!pull) { return; }
        if (gesture && gesture.mode === 'pan') { pull = null; hidePullPill(); return; }
        var dy = y - pull.y0;
        var dx = x - pull.x0;
        if (!pull.engaged) {
            if (dy < -8) { pull = null; return; }
            if (dy < 14 || Math.abs(dx) > dy) { return; }
            pull.engaged = true;
        }
        if (dy < 0) { pull.engaged = false; pull.armed = false; hidePullPill(); return; }
        if (e && e.preventDefault) { e.preventDefault(); }
        pull.armed = dy >= PULL_TRIGGER_PX;
        showPullPill(pull.armed, dy);
    }

    /**
     * Release: past the threshold → refetch; either way, clean up.
     * @returns {void}
     */
    function endPull() {
        var p = pull;
        pull = null;
        hidePullPill();
        if (p && p.armed) { api.refresh(); }
    }

    /**
     * Wire the tab's state hooks and attach the document listeners (once).
     * @param {{view: function(): ?Object, day: function(): number,
     *          commitDay: function(number): void,
     *          scrub: function(Element, number): void,
     *          panTips: function(number, boolean): void,
     *          panStrip: function(number, boolean): void,
     *          canPull: function(): boolean,
     *          refresh: function(): void}} hooks Tab-state access.
     * @returns {void}
     */
    function wire(hooks) {
        api = hooks;
        if (wired || typeof document === 'undefined' || !document.addEventListener) { return; }
        wired = true;
        document.addEventListener('touchstart', function (e) {
            var t = e.touches && e.touches[0];
            if (t && e.touches.length === 1) {
                beginGesture(t.clientX, t.clientY, e.target);
                beginPull(t.clientX, t.clientY);
            }
        }, true);
        // {passive:false}: modern webviews default document-level touchmove
        // to passive, which would ignore the pan's preventDefault; ancient
        // ones read the object as a truthy capture flag, which is also fine.
        document.addEventListener('touchmove', function (e) {
            var t = e.touches && e.touches[0];
            if (t) {
                moveGesture(t.clientX, t.clientY, e);
                movePull(t.clientX, t.clientY, e);
            }
        }, { passive: false, capture: true });
        document.addEventListener('touchend', function (e) {
            // A second finger lifting must not end the primary gesture at
            // its x — only the LAST finger ends the interaction.
            if (e.touches && e.touches.length) { return; }
            var t = e.changedTouches && e.changedTouches[0];
            if (t) { endGesture(t.clientX); } else { cancelGesture(); }
            endPull();
        }, true);
        document.addEventListener('touchcancel', function () {
            cancelGesture();
            pull = null;
            hidePullPill();
        }, true);
        document.addEventListener('mousedown', function (e) {
            beginGesture(e.clientX, e.clientY, e.target);
            beginPull(e.clientX, e.clientY);
        }, true);
        document.addEventListener('mousemove', function (e) {
            // e.buttons is authoritative where it exists (0 = no button —
            // e.which stays 1 on plain moves in WebKit, so `buttons||which`
            // would treat every hover as a drag); which is the old-engine
            // fallback only when buttons is genuinely undefined.
            var down = e.buttons !== undefined ? e.buttons : e.which;
            if (down) {
                moveGesture(e.clientX, e.clientY, e);
                movePull(e.clientX, e.clientY, e);
            }
        }, true);
        document.addEventListener('mouseup', function (e) {
            endGesture(e.clientX);
            endPull();
        }, true);
        // Capture: scroll does not bubble, and the viewport element is
        // replaced on every render, so the listener cannot live on it.
        document.addEventListener('scroll', unscroll, true);
        document.addEventListener('focusin', focusDay, true);
        // A rotation reflows the tiles while the row's transform still holds
        // the old day's PIXELS, which leaves the viewed day hanging off the
        // edge (measured: the last tile 52px past a 320px viewport). The
        // panels pan in percent and need no such fix; this row is measured.
        if (typeof window !== 'undefined' && window.addEventListener) {
            window.addEventListener('resize', function () {
                if (!gesture) { api.panStrip(api.day(), false); }
            }, false);
        }
    }

    var apiOut = {
        panPct: panPct,
        setPan: setPan,
        setDayStrip: setDayStrip,
        tapSuppressed: tapSuppressed,
        snapTargetDay: snapTargetDay,
        EDGE_PAD: EDGE_PAD,
        SETTLE_CSS: SETTLE_CSS,
        SETTLE_MS: SETTLE_MS,
        settleCss: settleCss,
        settleMs: settleMs,
        armSettle: armSettle,
        armJump: armJump,
        CARRY_MIN_V: CARRY_MIN_V,
        CARRY_MAX_MS: CARRY_MAX_MS,
        REST_MIN_MS: REST_MIN_MS,
        REST_MAX_MS: REST_MAX_MS,
        wire: wire
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = apiOut;
    }
    if (typeof window !== 'undefined') {
        window.WeatherTabInteract = apiOut;
    }
})();
