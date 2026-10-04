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

// How a LINE layer reads a value at or below its floor (ChartLineLayer.zero_absent):
// as data (temperature, HR), as nothing (the line breaks there), or as nothing that
// is still a real zero (the line comes down to it next to a reading). The metric lines
// set one of the last two: their wire invariant (forecast-series.js metricBytes)
// reserves byte 0 for "nothing", the same reading the marks have always applied. GAP
// is a line whose byte 0 is a missing reading (pressure, feels-like, dew point: the
// floating lines); JOIN one whose byte 0 is a zero (rain chance, clouds, wind, gusts,
// UV, and a Visible values: Alert line below its warn level).
#define CHART_ZERO_DATA 0
#define CHART_ZERO_GAP  1
#define CHART_ZERO_JOIN 2

// One line sample's "nothing here" test for the SOLID path: the explicit
// CHART_ABSENT sentinel, plus — on a GAP or JOIN line — anything at or below the
// floor. The temperature curve and the HR line (DATA) read their floor as data.
static inline bool chart_sample_absent(int16_t v, int lo, int zero_absent) {
    return v == CHART_ABSENT || (zero_absent && v <= lo);
}

// Whether the polyline draws the segment from sample k to k + 1: between two readings
// always; on a JOIN line also between a reading and a zero, so the line comes down to
// the zero row next to a reading instead of starting or ending in mid-air. Two zeros
// in a row never draw (a dry spell is a gap), nor does a sentinel on any other line.
// A JOIN line never carries CHART_ABSENT (its values are wire bytes).
static inline bool chart_segment_drawn(const int16_t *vals, int k, int lo, int zero_absent) {
    const bool a = chart_sample_absent(vals[k], lo, zero_absent);
    const bool b = chart_sample_absent(vals[k + 1], lo, zero_absent);
    return zero_absent == CHART_ZERO_JOIN ? !(a && b) : !(a || b);
}

// Find the next run of drawn samples at or after `from`: writes the run's first index
// to *start and returns its length (0 = nothing left). A run is the vertices joined by
// drawn segments (chart_segment_drawn): on a JOIN line it takes the zero on each side
// of its readings, and carries on through a lone zero between two readings (the line
// dips to the zero row and back), so a lone reading between zeros is a peak. A run of
// one is a lone reading no segment reaches (chart.c's small square).
static inline int chart_next_run(const int16_t *vals, int count, int lo,
                                 int zero_absent, int from, int *start) {
    int i = from;
    while (i < count && chart_sample_absent(vals[i], lo, zero_absent)
           && !(i + 1 < count && chart_segment_drawn(vals, i, lo, zero_absent))) { i++; }
    *start = i;
    if (i >= count) { return 0; }
    while (i + 1 < count && chart_segment_drawn(vals, i, lo, zero_absent)) { i++; }
    return i + 1 - *start;
}
