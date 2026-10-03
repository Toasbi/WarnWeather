#pragma once
// The chart's one vertical rule ("Draw from" / "Bars from": Bottom | Top) — pure,
// SDK-free, so the host suite can pin it (test/c/chart_flip_test.c; the chart_runs.h /
// chart_stripe.h pattern). A value stands on a ZERO ROW just outside the plot's content
// and grows DIR-ward: from the bottom (zero = the row below the content, the forecast's
// axis row; dir -1) or hanging from the top (zero = the row above the content; dir +1).
// The zero row is never part of a value, so both directions cover the same rows of the
// plot and Top is the exact mirror y' = content_top + content_bottom - 1 - y.
//
// chart.c reaches these through CHART_ZERO / CHART_DIR (chart.h), which fold to the
// bottom edge and -1 on aplite (no WW_LINE_STYLE), so its code is today's there.
#include <stdbool.h>
#include <stdint.h>

// The zero row: below the content (content_bottom is exclusive) or above it.
static inline int chart_flip_zero(bool from_top, int content_top, int content_bottom) {
    return from_top ? content_top - 1 : content_bottom;
}

// The direction a value grows in, in rows: down when hanging, up when standing.
static inline int chart_flip_dir(bool from_top) {
    return from_top ? 1 : -1;
}

// The row h px out from the zero row: a mark's centre, the free end of a bar h px tall
// (h = 1: the row next to the zero row; h = 0: the zero row itself).
static inline int chart_flip_y(int zero, int dir, int h) {
    return zero + dir * h;
}

// How far row y lies from the zero row (chart_flip_y's inverse).
static inline int chart_flip_h(int zero, int dir, int y) {
    return dir * (y - zero);
}

// The topmost row of the band h0..h1-1 px out (h1 - h0 rows): a bar, a tier segment,
// a halo, a fill or re-shade column.
static inline int chart_flip_span_y(int zero, int dir, int h0, int h1) {
    return dir < 0 ? zero - h1 : zero + 1 + h0;
}

// A line vertex or an Area fill contour point h px out. Standing, it is chart_flip_y:
// a value under one pixel lands on the zero row, the axis row, which the axis covers.
// Hanging, the zero row is the row above the plot, the lower of the 2 gap rows under
// a top stripe band, so a value above zero that scales under one pixel (a Visible
// values: Alert line at its warn crossing, a 1 % rain chance) is held on the plot's
// first row instead, the way the marks slide back inside the plot: a thin stroke never
// paints a gap row, and a bold one (3 px) keeps the upper gap row clear. A line's
// vertex is always held, its zero too: the one a metric line comes down to next to a
// reading (chart_runs.h CHART_ZERO_JOIN). So a bold stroke spills one row past every
// zero vertex, away from the plot: hanging onto the lower gap row, standing onto the row
// under the axis row (beside an hour tick, or into a first bottom stripe's empty cell).
// `held` is false only for a fill's zero, whose stretch stays on the zero row and fills
// nothing, as it stays on the axis standing.
static inline int chart_flip_vertex_y(int zero, int dir, int h, bool held) {
    if (held && dir > 0 && h < 1) {
        h = 1;
    }
    return chart_flip_y(zero, dir, h);
}

// A rain palette's "Bars from: Top" flag: bit 15 of stop 0's threshold. The phone ORs
// 0x80 into the palette blob's byte [1] (weather/graph-wire.js markPalette; rain-tier.js
// packPalette), and stop 0 otherwise always starts at 0, so a negative stop 0 is the
// flag and nothing else. Every renderer clamps a stop under the floor to the floor.
static inline bool chart_flip_palette_top(int16_t stop0_from) {
    return stop0_from < 0;
}
