#pragma once
// emery: THE one slot/time -> x mapping of a chart's columns, in 1/256 px. Pure and SDK-free,
// so the host suite pins it (test/c/forecast_span_test.c). Every x the forecast computes from
// an hour's index or from a time goes through it: the chart engine's ticks, bars, marks, line
// and area vertices and stripe cells (chart.h chart_slot_tick_x), the hour axis's ticks and
// labels (forecast_grid.c), the night bands (forecast_layer.c graph_x_for_time), the frame's
// zero line, the numbers On graph, and the count of hours on screen (slot_x_count). So a
// fractional pitch (the long span's, forecast_span.h) cannot drift between them.
//
// A whole pitch p is SLOT_X_PITCH_Q(p), and slot_x is then exactly i * p: the 12 h and 24 h
// grids, the health graph and the radar draw the pixels they always did.
#include <stdint.h>

#define SLOT_X_Q 8                              // fraction bits: 1/256 px
#define SLOT_X_ONE (1 << SLOT_X_Q)
#define SLOT_X_PITCH_Q(px) ((px) << SLOT_X_Q)   // a whole-px pitch in 1/256 px
#define SLOT_X_STEP_S 3600                      // one slot is one hour (bottom_view.h
                                                // BOTTOM_VIEW_STEP_SECONDS, asserted equal)

/**
 * emery: slot i's tick column, px right of the grid's anchor: floor(i * pitch). Columns tile
 * with no gap or overlap: slot i spans [slot_x(i), slot_x(i + 1)), floor(pitch) or one more
 * px wide. i * pitch_q stays under 2^31 for any i <= 68 and pitch under 64 px.
 */
static inline int slot_x(int pitch_q, int i) {
    return (int)(((unsigned)i * (unsigned)pitch_q) >> SLOT_X_Q);
}

/**
 * emery: the column `secs` seconds after slot 0's hour: floor(secs * pitch / 3600), the same
 * line through the ticks, so hour i lands exactly on slot_x(pitch_q, i) and everything between
 * is monotonic. secs in [0, 68 h]: 68 * 3600 * 2048 (an 8 px pitch) is about 5e8, under 2^31.
 */
static inline int slot_time_x(int pitch_q, int32_t secs) {
    return (int)(((uint32_t)secs * (uint32_t)pitch_q) / ((uint32_t)SLOT_X_STEP_S << SLOT_X_Q));
}

/**
 * emery: how many of n slots have their tick column on the `w` columns right of the anchor
 * (slot_x(i) <= w - 1, a slot whose bar is cut counts): ceil(w * 256 / pitch_q), at most n.
 * At a whole pitch p it is temp_axis_pad.h temp_axis_drawn_entries' ceil(w / p).
 */
static inline int slot_x_count(int pitch_q, int n, int w) {
    const int shown = (int)(((unsigned)w * SLOT_X_ONE + (unsigned)pitch_q - 1) / (unsigned)pitch_q);
    return shown < n ? shown : n;
}
