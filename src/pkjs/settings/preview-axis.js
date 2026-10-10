// src/pkjs/settings/preview-axis.js — ES5, WebView. The forecast preview's mirror of the
// watch's two axes: src/c/appendix/temp_axis_pad.h's temperature-axis margins, hi/lo labels,
// scale and numbers on the graph, and src/c/appendix/forecast_span.h's hour marks. Pure
// numbers, no SVG: preview-forecast.js lays its plot out with them, and
// test/config-temp-axis-pad.test.js holds the constants to the watch's headers.
// Registers nothing; it is a library, not a block.
(function () {
    // Dual-context pattern (see line-style.js): a CommonJS module under Node, a
    // concatenated <script> reading window.ForecastSpanHours in the webview.
    // forecast-span-hours.js precedes this file in APP_FILES.
    var spanHours = (typeof require !== 'undefined')
        ? require('../forecast-span-hours.js') : window.ForecastSpanHours;

    // The temperature-axis margins and hi/lo labels (src/c/appendix/temp_axis_pad.h),
    // mirrored: an anchored edge's margin is an eighth of the plot height, or from 64 rows on
    // its square over TEMP_AXIS_PAD_SQ_DIV (the share grows with the plot: an eighth at 64
    // rows, a quarter at 128), and the labels keep TEMP_LABEL_MIN_INK_GAP watch px of blank
    // rows between their ink. Both are the watch's numbers, held equal to the header's by
    // test/config-temp-axis-pad.test.js. WATCH_INSET_PX is the watch's temperature inset
    // (bottom_view.h BOTTOM_VIEW_PRIMARY_LINE_INSET_Y), the unit the preview scales watch px by.
    var TEMP_AXIS_PAD_SQ_DIV = 512;
    var TEMP_LABEL_MIN_INK_GAP = 11;
    var WATCH_INSET_PX = 7;
    // The hi/lo labels' digit cap, in preview units: about 0.7 em of their 8-unit font.
    var LABEL_CAP = 5.6;
    // The preview's curve inset in units: 12 units stand for the watch's WATCH_INSET_PX.
    var CURVE_INSET_PREV = 12;
    // The numbers on the graph (left axis BETA; temp_axis_pad.h THE NUMBERS ON THE GRAPH,
    // mirrored): watch px from a point's ink to its number's ink, and between the two
    // numbers' ink (test/config-temp-axis-pad.test.js holds both equal to the header's),
    // scaled to preview units like the label gap (CURVE_INSET_PREV units a WATCH_INSET_PX).
    var TEMP_LABEL_POINT_GAP = 2;
    var TEMP_LABEL_PART_GAP = 3;
    // The hour axis (forecast_grid.c forecast_grid_fill_axis_span, mirrored): what a slot
    // draws (src/c/appendix/forecast_span.h FORECAST_MARK_*), and an hour digit's width in
    // the 7.5-unit axis font, for the edge drop (forecast_span_label_fits).
    var MARK_NONE = 0;
    var MARK_TICK = 1;
    var MARK_LABEL = 2;
    var HOUR_DIGIT_W = 4.5;
    // A number's width per character of the 8-unit label font, in units.
    var NUMBER_CHAR_W = 4.6;

    /**
     * The hour axis's cadence for the span this watch draws — forecast_span.h forecast_span's
     * label_every / tick_every / by_clock, mirrored for the preview's own window (its 12
     * samples model no pitch): 12 h a label every 2nd slot, 24 h every 3rd, a tick on each,
     * both counted from slot 0; the long span (option 48) the clock's marks, a label every
     * 6 clock hours (a full feed's 3 px pitch) and a small tick on the other 3-hour marks.
     * The span is forecast-span-hours.js option's: every watch but emery (env.forecastSpan)
     * draws 24 h.
     * @param {?Object} state Clay settings.
     * @param {?Object} env computeEnv() result.
     * @returns {{labelEvery: number, tickEvery: number, byClock: boolean}}
     */
    function axisCadence(state, env) {
        var span = spanHours.option(state, env);
        if (span === 12) { return { labelEvery: 2, tickEvery: 1, byClock: false }; }
        if (span === 48) { return { labelEvery: 6, tickEvery: 3, byClock: true }; }
        return { labelEvery: 3, tickEvery: 1, byClock: false };
    }

    /**
     * Slot i's mark — forecast_span.h forecast_span_mark, mirrored: a label on every
     * labelEvery-th unit, a small tick on every tickEvery-th one between, else none. The unit
     * is the slot (from slot 0) or, by the clock, its hour, a repeated hour (a daylight-saving
     * fall-back) marked once.
     * @param {{labelEvery: number, tickEvery: number, byClock: boolean}} c axisCadence.
     * @param {number} i The slot.
     * @param {number} hour Its clock hour, 0..23.
     * @param {number} prevHour Slot i - 1's clock hour, -1 for slot 0.
     * @returns {number} MARK_NONE, MARK_TICK or MARK_LABEL.
     */
    function axisMark(c, i, hour, prevHour) {
        var unit = i;
        if (c.byClock) {
            if (hour === prevHour) { return MARK_NONE; }
            unit = hour;
        }
        if (unit % c.labelEvery === 0) { return MARK_LABEL; }
        return unit % c.tickEvery === 0 ? MARK_TICK : MARK_NONE;
    }

    /**
     * Whether an hour label centred on x is whole between the frame's edges —
     * forecast_span.h forecast_span_label_fits, mirrored: a label either edge would cut is
     * not drawn, and its tick stays.
     * @param {number} x The tick's x.
     * @param {string} text The label.
     * @param {number} left The first unit on screen.
     * @param {number} right The last.
     * @returns {boolean}
     */
    function axisLabelFits(x, text, left, right) {
        var w = text.length * HOUR_DIGIT_W;
        return x - w / 2 >= left && x + w / 2 <= right;
    }

    /**
     * The side a number prefers beside sample i: +1 right, -1 left — temp_axis_pad.h
     * temp_label_side, mirrored. The side whose neighbour lies further from the point (a
     * missing reading, null, is open space, the furthest); a tie goes right; the first sample
     * prefers right and the last left.
     * @param {Array.<?number>} ys The line's y per sample (null: no reading).
     * @param {number} i The point's sample.
     * @returns {number} 1 or -1.
     */
    function numberSide(ys, i) {
        var dp = -1, dn = -1;
        if (i > 0) { dp = ys[i - 1] === null ? Infinity : Math.abs(ys[i - 1] - ys[i]); }
        if (i + 1 < ys.length) { dn = ys[i + 1] === null ? Infinity : Math.abs(ys[i + 1] - ys[i]); }
        return dn >= dp ? 1 : -1;
    }

    /**
     * One number beside its point — temp_axis_pad.h temp_label_beside, mirrored: its ink
     * TEMP_LABEL_POINT_GAP watch px clear of the point's ink on the preferred side if it fits,
     * else the other, else the preferred one; held inside the area; its ink (LABEL_CAP over
     * the baseline) centred on the point's y and held inside the area's rows.
     * @param {number} x0 The point's ink, left edge.
     * @param {number} x1 The point's ink, right edge.
     * @param {number} y The point's y.
     * @param {number} side 1 right, -1 left (numberSide).
     * @param {number} w The number's width.
     * @param {{left: number, right: number, top: number, bottom: number}} area Where its ink
     *   may go.
     * @returns {{x: number, base: number}} The text's left edge and baseline.
     */
    function numberBeside(x0, x1, y, side, w, area) {
        var gap = TEMP_LABEL_POINT_GAP * CURVE_INSET_PREV / WATCH_INSET_PX;
        var right = x1 + gap, left = x0 - gap - w;
        var fitsR = right + w <= area.right, fitsL = left >= area.left;
        var x = side > 0 ? ((fitsR || !fitsL) ? right : left) : ((fitsL || !fitsR) ? left : right);
        if (x + w > area.right) { x = area.right - w; }
        if (x < area.left) { x = area.left; }
        var base = y + LABEL_CAP / 2;
        if (base - LABEL_CAP < area.top) { base = area.top + LABEL_CAP; }
        if (base > area.bottom) { base = area.bottom; }
        return { x: x, base: base };
    }

    /**
     * The two numbers apart — temp_axis_pad.h temp_labels_part, mirrored (mutates both):
     * untouched when their ink, grown by TEMP_LABEL_PART_GAP, does not meet; else the lo
     * number right under the hi one; else the lo number on the area's last row and the hi
     * one right over it. When even that does not fit, the hi number keeps numberBeside's
     * place, inside the area.
     * @param {{x: number, base: number}} hi The hi number (numberBeside).
     * @param {number} wHi Its width.
     * @param {{x: number, base: number}} lo The lo number.
     * @param {number} wLo Its width.
     * @param {{left: number, right: number, top: number, bottom: number}} area The area.
     * @returns {boolean} False when even that does not fit: the lo number is not drawn.
     */
    function numbersPart(hi, wHi, lo, wLo, area) {
        var gap = TEMP_LABEL_PART_GAP * CURVE_INSET_PREV / WATCH_INSET_PX;
        if (lo.x >= hi.x + wHi + gap || hi.x >= lo.x + wLo + gap
            || lo.base - LABEL_CAP >= hi.base + gap || hi.base - LABEL_CAP >= lo.base + gap) {
            return true;
        }
        lo.base = hi.base + LABEL_CAP + gap;
        if (lo.base <= area.bottom) { return true; }
        lo.base = area.bottom;
        var lifted = lo.base - LABEL_CAP - gap;
        if (lifted - LABEL_CAP < area.top) { return false; }   // no room: hi stays put
        hi.base = lifted;
        return true;
    }

    /**
     * Where the numbers' ink may go — forecast_numbers_on_graph's TempLabelArea,
     * mirrored: the plot's left edge (no axis On graph) to its right edge, from the first
     * content row under the top stripe band to the row over the zero line, shrunk on every side
     * by the outline's ring (one watch px), so the ring never crosses an edge, a band or the
     * zero line.
     * @param {number} px0 The plot's left edge (no axis column On graph).
     * @param {number} px1 The plot's right edge.
     * @param {number} top The first content row under the top stripe band.
     * @param {number} zero The zero line's row.
     * @returns {{left: number, right: number, top: number, bottom: number}}
     */
    function numbersArea(px0, px1, top, zero) {
        var o = CURVE_INSET_PREV / WATCH_INSET_PX;   // the outline On graph always draws
        return { left: px0 + o, right: px1 - o, top: top + o, bottom: zero - 1 - o };
    }

    /**
     * Whether the lo number is drawn too — forecast_numbers_on_graph's rule, mirrored: a flat
     * range (equal texts) draws the hi number alone; else both, kept apart by numbersPart,
     * which may still leave the lo one out. The preview's own sample never has a flat range,
     * so only the tests reach that case.
     * @param {string} hiText The hi number's text.
     * @param {string} loText The lo number's text.
     * @param {{x: number, base: number}} hi The hi number (numberBeside; numbersPart may move it).
     * @param {number} wHi Its width.
     * @param {{x: number, base: number}} lo The lo number (numbersPart may move it).
     * @param {number} wLo Its width.
     * @param {{left: number, right: number, top: number, bottom: number}} area numbersArea.
     * @returns {boolean} False when only the hi number is drawn.
     */
    function bothNumbers(hiText, loText, hi, wHi, lo, wLo, area) {
        return hiText !== loText && numbersPart(hi, wHi, lo, wLo, area);
    }

    /**
     * An anchored edge's share of a plot `units` preview units tall, in preview units:
     * temp_axis_pad.h temp_axis_margin, mirrored, the larger of its two terms. The eighth,
     * the floor, is linear, so it is taken in units as it always was (Math.floor(units / 8)).
     * The curve is not, so it is taken where the watch takes it, in watch rows: the plot goes
     * to whole watch px at the preview's scale (CURVE_INSET_PREV units per WATCH_INSET_PX, as
     * the inset and the label gap), the watch's integer square over TEMP_AXIS_PAD_SQ_DIV is
     * taken there, and the px it gives come back as units. The curve passes the eighth only
     * from 64 watch rows (about 110 units); the preview's own plots are at most 87 units (50
     * watch rows, about the watch's default view), so the preview keeps the flat eighth's
     * margins, as the watch does in plots that small.
     * @param {number} units The plot's height in preview units (>= 0).
     * @returns {number} The share, in preview units.
     */
    function anchorShare(units) {
        var eighth = Math.floor(units / 8);
        var rows = Math.floor(units * WATCH_INSET_PX / CURVE_INSET_PREV);
        var curve = Math.floor(rows * rows / TEMP_AXIS_PAD_SQ_DIV) * CURVE_INSET_PREV / WATCH_INSET_PX;
        return curve > eighth ? curve : eighth;
    }

    /**
     * The hi/lo labels' baselines, aligned with the temperature curve's extremes when there
     * is space — temp_axis_pad.h temp_labels_align, mirrored. Each label's ink (the cap above
     * its baseline) is centred on its row, moved only inward from today's baseline, and the
     * two keep the watch's minimum ink gap apart (scaled like the inset); else both keep
     * today's.
     *
     * The reach gate. On the watch, on an edge with no stripe band, today's label ink sits just
     * inside the row the curve reaches with today's margins (its inset row), so the label stays
     * put until the curve stops short of that row: an anchored edge's wider margin, or a
     * feels-like or dew point line widening the band. The preview's labels sit further out, in
     * the plot's corners beyond its inset rows, so there each one moves only once its extreme
     * lies inside `reachTop` / `reachBottom`, today's reach: with nothing anchored and no band
     * the labels stay where they always were, as the watch's do. The lo label sits on the
     * plot's floor on both, so its reach is always the inset row over it. The hi label's place
     * is fixed to the top of the graph on both, not to a top stripe band, so under a band there
     * is no gate (`reachTop` -Infinity, the watch's plain rule): the curve's top keeps its inset
     * below the band, which lies below the label's ink under any band, and the label follows
     * it, as basalt's does (its default view under one stripe: row 13 against the ink's centre
     * row 9; temp_axis_pad.h temp_labels_align).
     * @param {number} hiBase Today's hi baseline.
     * @param {number} loBase Today's lo baseline.
     * @param {number} curveTop The curve's highest y.
     * @param {number} curveBottom The curve's lowest y.
     * @param {number} reachTop The highest y the curve reaches with today's top margin, or
     *   -Infinity under a top stripe band (no gate).
     * @param {number} reachBottom The lowest y it reaches with today's bottom margin.
     * @returns {{hi: number, lo: number}} The baselines to draw.
     */
    function alignLabels(hiBase, loBase, curveTop, curveBottom, reachTop, reachBottom) {
        var hi = curveTop > reachTop ? Math.max(hiBase, curveTop + LABEL_CAP / 2) : hiBase;
        var lo = curveBottom < reachBottom ? Math.min(loBase, curveBottom + LABEL_CAP / 2) : loBase;
        if (lo - LABEL_CAP - hi >= TEMP_LABEL_MIN_INK_GAP * CURVE_INSET_PREV / WATCH_INSET_PX) {
            return { hi: hi, lo: lo };
        }
        return { hi: hiBase, lo: loBase };
    }

    /**
     * The temperature scale's range (temp_axis_pad.h THE SCALE, mirrored; owner, 2026-10-04:
     * "always fit all lines"): the lowest and highest value of the temperature and of every
     * feels-like or dew point line drawn, an hour with no reading (null) left out — the
     * watch's TEMP_AXIS_RANGE_NONE widened by temp_axis_range_widen. Its ends land on the
     * margin rows; min === max is a flat range, which sits mid-plot.
     * @param {number[]} temps The temperature sample (every hour a reading).
     * @param {Array.<Array.<?number>>} lines The drawn temperature-axis lines' samples.
     * @returns {{min: number, max: number}}
     */
    function tempAxisRange(temps, lines) {
        var all = [temps].concat(lines);
        var min = Infinity, max = -Infinity;
        for (var s = 0; s < all.length; s += 1) {
            for (var i = 0; i < all[s].length; i += 1) {
                var v = all[s][i];
                if (typeof v !== 'number') { continue; }
                if (v < min) { min = v; }
                if (v > max) { max = v; }
            }
        }
        return { min: min, max: max };
    }

    var api = {
        TEMP_AXIS_PAD_SQ_DIV: TEMP_AXIS_PAD_SQ_DIV,
        TEMP_LABEL_MIN_INK_GAP: TEMP_LABEL_MIN_INK_GAP,
        WATCH_INSET_PX: WATCH_INSET_PX,
        LABEL_CAP: LABEL_CAP,
        CURVE_INSET_PREV: CURVE_INSET_PREV,
        TEMP_LABEL_POINT_GAP: TEMP_LABEL_POINT_GAP,
        TEMP_LABEL_PART_GAP: TEMP_LABEL_PART_GAP,
        MARK_NONE: MARK_NONE,
        MARK_TICK: MARK_TICK,
        MARK_LABEL: MARK_LABEL,
        NUMBER_CHAR_W: NUMBER_CHAR_W,
        axisCadence: axisCadence,
        axisMark: axisMark,
        axisLabelFits: axisLabelFits,
        numberSide: numberSide,
        numberBeside: numberBeside,
        numbersPart: numbersPart,
        numbersArea: numbersArea,
        bothNumbers: bothNumbers,
        anchorShare: anchorShare,
        alignLabels: alignLabels,
        tempAxisRange: tempAxisRange
    };

    // Dual-context export — mirrors the tail of src/pkjs/status-thresholds.js.
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    if (typeof window !== 'undefined') {
        window.PreviewAxis = api;
    }
})();
