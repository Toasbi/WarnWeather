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

    // The day change TRAVELS. A released pan glides onto its day rather than
    // cutting to it, so the eye can follow the timeline across instead of
    // having to re-find its place on the other side; a spring-back to the
    // same day eases home the same way. The curve decelerates hard —
    // most of the distance is covered early and the last few pixels settle —
    // which reads as the row coming to rest rather than stopping dead.
    //
    // Both halves are exported because everything that moves with the day
    // reads them — the panels, the tile row, the value tips riding OUTSIDE
    // the panned element, and the tiles' highlight in the stylesheet — so
    // there is exactly one place this timing lives, and the JS timers that
    // wait for the motion to finish cannot drift from the CSS that performs
    // it. Keep the two in step: the number in SETTLE_CSS is SETTLE_MS.
    var SETTLE_CSS = '0.42s cubic-bezier(0.16, 0.84, 0.32, 1)';
    var SETTLE_MS = 420;

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
        st.webkitTransition = animated ? '-webkit-transform ' + SETTLE_CSS : 'none';
        st.transition = animated ? 'transform ' + SETTLE_CSS : 'none';
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
        if (d !== api.day()) { api.commitDay(d); }
    }

    /**
     * Which day a released drag snaps to: a quick flick advances one day,
     * anything else rounds to the nearest day boundary.
     * @param {number} baseDay Day when the drag started.
     * @param {number} dxPx Horizontal drag distance (px, right = positive).
     * @param {number} vw Viewport width (px).
     * @param {number} days Timeline day count.
     * @param {number} dtMs Drag duration.
     * @returns {number} Target day, clamped to the timeline.
     */
    function snapTargetDay(baseDay, dxPx, vw, days, dtMs) {
        var target;
        if (dtMs < 300 && Math.abs(dxPx) > vw * 0.12) {
            target = baseDay + (dxPx < 0 ? 1 : -1);
        } else {
            target = Math.round(baseDay - dxPx / vw);
        }
        if (target < 0) { target = 0; }
        if (target > days - 1) { target = days - 1; }
        return target;
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
        gesture = {
            x0: x, y0: y, t0: Date.now(), vw: w, mode: null,
            base: api.day(), days: view.days, target: target
        };
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
        var f = gesture.base - dx / gesture.vw;
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
            panEndedAt = Date.now();
            api.commitDay(snapTargetDay(g.base, x - g.x0, g.vw, days, Date.now() - g.t0));
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
        wire: wire
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = apiOut;
    }
    if (typeof window !== 'undefined') {
        window.WeatherTabInteract = apiOut;
    }
})();
