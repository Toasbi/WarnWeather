#pragma once
// The temperature-axis lines' margins and the hi/lo labels that name their extremes: pure,
// SDK-free, so the host suite can pin both rules (test/c/temp_axis_pad_test.c; the
// chart_flip.h pattern). forecast_layer.c is the one caller, and only off aplite: aplite is
// the frozen fork, its insets are constants and its labels sit where they always did. The
// settings preview mirrors both rules (preview-forecast.js), pinned by
// test/config-temp-axis-pad.test.js.
//
// THE MARGINS (owner, 2026-10-02). The temperature curve and the lines sharing its inset
// (feels-like and dew point: every series whose phone-sent inset_y is not 0) keep a margin
// between their band and each edge of the plot's content rows [T, B). An edge that something
// stands on or hangs from is ANCHORED: the rain bars (Bars from: Bottom or Top, while the
// graph draws them), or an amount metric's line, marks or Main-metric fill (Draw from;
// standing = the bottom, hanging = the top). On an anchored edge the margin is at least
// (B - T) / TEMP_AXIS_ANCHOR_DIV, so a tall graph keeps light and moderate bars clear of the
// temperature line and only heavy ones reach into it; a small graph barely changes, since a
// quarter of it is close to the 7 px inset. An edge nothing is anchored on keeps today's
// margin exactly. The bars' scale and the metric lines' mapping (inset 0) do not change.
#include <stdbool.h>

#include "c/layers/status_metrics.h"

// The quarter: an anchored edge's margin is the plot height over this (owner, 2026-10-02:
// "lets start with quarter"). The one knob to tune the rule.
#define TEMP_AXIS_ANCHOR_DIV 4

// The anchored edges, as a mask: forecast_layer.c ORs in one bit per thing drawn from an
// edge. TEMP_AXIS_ANCHOR(from_top) is the bit of the edge a bool from_top names.
#define TEMP_AXIS_ANCHOR_BOTTOM 0x01
#define TEMP_AXIS_ANCHOR_TOP    0x02
#define TEMP_AXIS_ANCHOR(from_top) (TEMP_AXIS_ANCHOR_BOTTOM + (int)(bool)(from_top))

// The temperature curve's margin at one edge: `today` (its inset there; 0 at the top under a
// top stripe band, whose gap keeps it clear), or, on an anchored edge, a quarter of the
// plot's content height `plot_h` (>= 0) where that is more.
static inline int temp_axis_margin(int today, bool anchored, int plot_h) {
    const int quarter = (int)((unsigned)plot_h / TEMP_AXIS_ANCHOR_DIV);
    return (anchored && quarter > today) ? quarter : today;
}

// THE LABELS (owner, 2026-10-02). The hi/lo temperature labels left of the graph line up with
// the temperature curve's highest and lowest rows when there is space: each label's INK (its
// digit cap, status_metrics.h) is centred on its row. Each label only ever moves inward from
// today's place (the hi label down, the lo label up), so it stays inside the strip; and the
// two keep at least TEMP_LABEL_MIN_INK_GAP blank rows between their ink. When they cannot
// (a small graph, a crowded strip, a flat or narrow temperature curve) both keep today's
// place.
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
