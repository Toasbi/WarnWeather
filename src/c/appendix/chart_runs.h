#pragma once
// The solid line's gap kernel — pure, SDK-free, so the host suite can pin it
// (test/c/chart_absent_test.c, the line_style_decode_test pattern; chart.c and
// forecast_layer.c themselves are SDK-bound and never host-compile). chart.c's
// SOLID path is the only consumer; the mark styles keep their own
// unconditional `<= lo` skip in chart_draw_bar_marks.
#include <stdbool.h>
#include <stdint.h>

// Sentinel marking "no value for this bucket" in a LINE layer's values[]. The
// solid line BREAKS across it (the polyline is drawn as separate segments)
// instead of plunging through it; the dotted path and BARS/AREA layers ignore
// it. Only emitters that can have genuine gaps (the health HR line) ever store
// it — temp/forecast values never equal INT16_MIN.
#define CHART_ABSENT INT16_MIN

// One line sample's "draw nothing here" test for the SOLID path: the explicit
// CHART_ABSENT sentinel, plus — for layers that opt in via zero_absent —
// anything at or below the floor. The metric lines opt in: their wire
// invariant (forecast-series.js metricBytes) reserves byte 0 for "nothing",
// the same reading the marks have always applied. Temp/feels and the HR line
// leave it unset — their floor readings are real data.
static inline bool chart_sample_absent(int16_t v, int lo, bool zero_absent) {
    return v == CHART_ABSENT || (zero_absent && v <= lo);
}

// Find the next contiguous run of drawable samples at or after `from`: writes
// the run's first index to *start and returns its length (0 = nothing left).
// A NULL vals (precomputed points, no sentinel to read) is one whole-range
// run — the contour-consuming line draws exactly as before unless it also
// carries values.
static inline int chart_next_run(const int16_t *vals, int count, int lo,
                                 bool zero_absent, int from, int *start) {
    int i = from;
    while (i < count && vals && chart_sample_absent(vals[i], lo, zero_absent)) { i++; }
    *start = i;
    while (i < count && !(vals && chart_sample_absent(vals[i], lo, zero_absent))) { i++; }
    return i - *start;
}
