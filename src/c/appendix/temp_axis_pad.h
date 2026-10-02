#pragma once
// The forecast plot's vertical layout, the temperature-axis lines' margins and the hi/lo
// labels that name their extremes: pure, SDK-free, so the host suite can pin every rule
// (test/c/temp_axis_pad_test.c; the chart_flip.h pattern). forecast_layer.c is the one
// caller, and only off aplite: aplite is the frozen fork, it has no stripes, its insets are
// constants and its labels sit where they always did. The settings preview mirrors the rules
// (preview-forecast.js, draw-from.js forecastAnchors), pinned by
// test/config-temp-axis-pad.test.js.
//
// WHAT TAKES PART (owner, 2026-10-02). Only a series with at least one value above 0 in the
// window the graph draws (its first num_entries samples) takes part in the layout. One with
// nothing above 0 draws nothing (a stripe's empty cell, a bar of 0, a metric line's wire
// byte 0: all draw nothing), and the plot lays out as if it were not there: a stripe gives up
// its band (no band, no gap; the plot grows into it) and a line, its marks, its fill or the
// rain bars anchor no edge. The moment one hour has a value above 0 it counts again.
//
// THE MARGINS (owner, 2026-10-02). The temperature curve and the lines sharing its inset
// (feels-like and dew point: every series whose phone-sent inset_y is not 0) keep a margin
// between their band and each edge of the plot's content rows [T, B): the rows between the
// top stripe band (its gap included) and the bottom one (which hangs under the zero line),
// the whole graph above the hour axis without stripes. An edge that something stands on or
// hangs from is ANCHORED: the rain bars (Bars from: Bottom or Top), or an amount metric's
// line, marks or Main-metric fill (Draw from; standing = the bottom, hanging = the top). On an
// anchored edge the margin is at least (B - T) / TEMP_AXIS_ANCHOR_DIV, so a tall graph keeps
// light bars clear of the temperature line and only heavy ones reach into it; a plot under 64
// rows keeps its 7 px inset, which an eighth of it does not exceed. An edge nothing is
// anchored on keeps today's margin exactly (the inset, or 0 at the top under a top stripe
// band, whose gap keeps the curve clear). The bars' scale and the metric lines' mapping
// (inset 0) do not change.
#include <stdbool.h>
#include <stdint.h>

#include "c/layers/status_metrics.h"

// The share: an anchored edge's margin is the plot height over this. The owner's first pick
// was a quarter (4); "much less" (2026-10-02) made it an eighth, the one knob he tunes further.
#define TEMP_AXIS_ANCHOR_DIV 8

// The anchored edges, as a mask: one bit per edge something is drawn from.
// TEMP_AXIS_ANCHOR(from_top) is the bit of the edge a bool from_top names.
#define TEMP_AXIS_ANCHOR_BOTTOM 0x01
#define TEMP_AXIS_ANCHOR_TOP    0x02
#define TEMP_AXIS_ANCHOR(from_top) (TEMP_AXIS_ANCHOR_BOTTOM + (int)(bool)(from_top))

// The stripe bands' geometry, derived from the plot height rather than the platform: a stripe
// is about a twelfth of the graph above the hour axis, 3..6 px, so it keeps its proportion in
// every band height. Stripes sharing an edge stack with FORECAST_STRIPE_GAP between them; the
// top band keeps FORECAST_TOP_BAND_GAP clear rows under its last stripe, the bottom band one
// row over the hour axis (the axis row itself, which keeps the ticks).
#define FORECAST_STRIPE_H(plot_h) \
    ((plot_h) / 12 < 3 ? 3 : ((plot_h) / 12 > 6 ? 6 : (plot_h) / 12))
#define FORECAST_STRIPE_GAP 1
#define FORECAST_TOP_BAND_GAP 2
#define FORECAST_BOTTOM_BAND_GAP 1

// The rows one edge's band takes for `stripes` stripes drawing something: none without one.
static inline int forecast_stripe_band(int stripes, int stripe_h, int gap) {
    return stripes ? stripes * stripe_h + (stripes - 1) * FORECAST_STRIPE_GAP + gap : 0;
}

// The one scan: whether any of a series' values[0..n) (the drawn window) is above 0.
static inline bool temp_axis_any_above_zero(const int16_t *values, int n) {
    while (n-- > 0) {
        if (*values++ > 0) { return true; }
    }
    return false;
}

// The plot's edges for one redraw: the stripes taking a band on each edge, and the anchored
// edges (TEMP_AXIS_ANCHOR_* bits). Start from all zero.
typedef struct {
    int top_stripes, bottom_stripes, anchors;
} TempAxisEdges;

// One configured series' part in the edges, off one scan of its drawn window: a stripe takes
// a band on its edge, a line, marks, fill or the rain bars anchor the edge they are drawn from
// (`from_top`) unless the line floats (pressure, feels-like, dew point: no zero to stand on).
// A series with nothing above 0 takes no part. Returns false only for such a stripe: it is not
// drawn, so the caller drops it and the rest of its edge's stripes close up.
static inline bool temp_axis_edges_add(TempAxisEdges *e, const int16_t *values, int n,
                                       bool stripe, bool floating, bool from_top) {
    if (!temp_axis_any_above_zero(values, n)) { return !stripe; }
    if (stripe) {
        if (from_top) { ++e->top_stripes; } else { ++e->bottom_stripes; }
    } else if (!floating) {
        e->anchors |= TEMP_AXIS_ANCHOR(from_top);
    }
    return true;
}

// The temperature curve's margin at one edge: `today` (its inset there; 0 at the top under a
// top stripe band), or, on an anchored edge, the plot's content height `plot_h` (>= 0) over
// TEMP_AXIS_ANCHOR_DIV where that is more.
static inline int temp_axis_margin(int today, bool anchored, int plot_h) {
    const int share = (int)((unsigned)plot_h / TEMP_AXIS_ANCHOR_DIV);
    return (anchored && share > today) ? share : today;
}

// Both margins, for a curve inset by `inset` in a plot `plot_h` content rows tall under a top
// stripe band `top_band` rows tall (0 without one), with the edges `anchors`.
typedef struct { int16_t top, bottom; } __attribute__((aligned(4))) TempMargin;
static inline TempMargin temp_axis_margins(int inset, int top_band, int plot_h, int anchors) {
    return (TempMargin){
        .top    = (int16_t)temp_axis_margin(top_band ? 0 : inset,
                                            anchors & TEMP_AXIS_ANCHOR_TOP, plot_h),
        .bottom = (int16_t)temp_axis_margin(inset, anchors & TEMP_AXIS_ANCHOR_BOTTOM, plot_h) };
}

// THE LABELS (owner, 2026-10-02). The hi/lo temperature labels left of the graph line up with
// the temperature curve's highest and lowest rows when there is space: each label's INK (its
// digit cap, status_metrics.h) is centred on its row. Each label only ever moves inward from
// today's place (the hi label down, the lo label up), so it stays inside the strip; and the
// two keep at least TEMP_LABEL_MIN_INK_GAP blank rows between their ink. When they cannot
// (a small graph, a crowded strip, a flat or narrow temperature curve) both keep today's
// place. On an edge that is not anchored and has no stripe band, the curve reaches today's
// inset row there, which lies outward of today's label ink centre (rows 7 against 9, basalt;
// 7 against 14, emery), so that label moves only where the curve stops short of the inset (a
// feels-like or dew point line widening the band).
//
// Today's minimum: the smallest gap the labels leave in any preset's view, emery's 68 px band
// (fullCal, compactDense) at GOTHIC_24 (forecast_layer.c draw_left_axis). basalt's tightest,
// the 51 px fullCal band, leaves 13 at GOTHIC_18; the default compactCal views leave 27
// (basalt) and 25 (emery, GOTHIC_24).
#define TEMP_LABEL_MIN_INK_GAP 11

// In: *hi_y / *lo_y are today's box tops, h the boxes' content height (both labels are
// measured in the one label font), curve_top / curve_bottom the curve's highest and lowest
// rows. Out: the aligned box tops, or today's unchanged.
static inline void temp_labels_align(int *hi_y, int *lo_y, int h,
                                     int curve_top, int curve_bottom) {
    const int cap = status_cap_h(h);
    // Box top to the ink's centre row: the cap seats on the box bottom (status_metrics.h),
    // so its rows are h - cap .. h - 1, centred on h - (cap + 1) / 2 (the lower of the two
    // middle rows for an even cap). cap > 0: unsigned halving, no sign fix-up.
    const int centre = h - (int)((unsigned)(cap + 1) / 2);
    int hi = curve_top - centre;
    int lo = curve_bottom - centre;
    if (hi < *hi_y) { hi = *hi_y; }   // never above today's hi label
    if (lo > *lo_y) { lo = *lo_y; }   // never below today's lo label
    // The blank rows between the hi label's last ink row and the lo label's first are
    // lo - hi - cap: both caps are `cap` rows, seated alike.
    if (lo - hi - cap >= TEMP_LABEL_MIN_INK_GAP) {
        *hi_y = hi;
        *lo_y = lo;
    }
}
