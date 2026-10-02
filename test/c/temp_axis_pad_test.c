// Host-compiled test for src/c/appendix/temp_axis_pad.h (header-only, SDK-free): the
// temperature-axis margins on the forecast graph's anchored edges, and the hi/lo labels
// lined up with the curve's extremes (owner, 2026-10-02). forecast_layer.c is SDK-bound and
// cannot be host-compiled, so its pure half is pinned here; the settings preview mirrors
// both rules (test/config-temp-axis-pad.test.js). Build & run via scripts/test-c.sh.
#include <assert.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>

#include "c/appendix/temp_axis_pad.h"

// The temperature curve's inset (bottom_view.h BOTTOM_VIEW_PRIMARY_LINE_INSET_Y).
#define INSET 7

static void test_anchor_bits(void) {
    assert(TEMP_AXIS_ANCHOR(false) == TEMP_AXIS_ANCHOR_BOTTOM);
    assert(TEMP_AXIS_ANCHOR(true) == TEMP_AXIS_ANCHOR_TOP);
    assert(TEMP_AXIS_ANCHOR(2) == TEMP_AXIS_ANCHOR_TOP);   // any true value
    assert((TEMP_AXIS_ANCHOR_BOTTOM & TEMP_AXIS_ANCHOR_TOP) == 0);
    assert(TEMP_AXIS_ANCHOR_DIV == 4);                     // the owner's quarter
}

// An edge nothing is anchored on keeps today's margin, whatever the plot's height; an
// anchored edge takes a quarter of the plot where that is more than today's.
static void test_margins(void) {
    for (int plot_h = 0; plot_h <= 200; ++plot_h) {
        const int quarter = plot_h / 4;
        for (int today = 0; today <= 14; ++today) {
            assert(temp_axis_margin(today, false, plot_h) == today);
            const int m = temp_axis_margin(today, true, plot_h);
            assert(m == (quarter > today ? quarter : today));
            assert(m >= today);
        }
    }
    // The views' plots (content rows [T, B), no stripes): the forecast band
    // (test/c/layout_test.c goldens) less the hour axis, 10 rows (basalt) / 20 (emery, its
    // 10-row bottom pad too). basalt's fullCal (51 px band, 41 rows) barely moves (10
    // against 7); the default compactCal view moves a little more, basalt 65 px (55 rows)
    // and emery 82 px (62 rows); the no-calendar views, basalt 87 px (77 rows) and emery
    // 111 px (91 rows), keep a quarter clear. emery's fullCal / compactDense, 68 px (48 rows).
    assert(temp_axis_margin(INSET, true, 51 - 10) == 10);    // basalt fullCal
    assert(temp_axis_margin(INSET, true, 65 - 10) == 13);    // basalt compactCal (default)
    assert(temp_axis_margin(INSET, true, 87 - 10) == 19);    // basalt noCal
    assert(temp_axis_margin(INSET, true, 68 - 20) == 12);    // emery fullCal / compactDense
    assert(temp_axis_margin(INSET, true, 82 - 20) == 15);    // emery compactCal (default)
    assert(temp_axis_margin(INSET, true, 111 - 20) == 22);   // emery noCal
    assert(temp_axis_margin(INSET, true, 27) == INSET);   // a quarter under the inset: today's
    // Under a top stripe band the top margin is 0 today, and a quarter when something hangs.
    assert(temp_axis_margin(0, false, 80) == 0);
    assert(temp_axis_margin(0, true, 80) == 20);
}

// The label's ink rows for a box at y in a font of content height h: the cap seats on the
// box bottom (status_metrics.h).
static int ink_top(int y, int h) { return y + status_ink_top(h); }
static int ink_bottom(int y, int h) { return y + h - 1; }

// Today's places (forecast_layer.c draw_left_axis): the hi box at -3 (GOTHIC_18) or pinned
// to ink row 7 (emery), the lo box 2 rows above the plot's baseline.
static int hi_today(int h, bool emery) { return emery ? status_ink_top(18) - status_ink_top(h) : -3; }
static int lo_today(int h, int baseline) { return baseline - h - 2; }

static void test_label_examples(void) {
    // basalt's fullCal view (51 px band): baseline 41, curve 7..34 unanchored (inset 7 both
    // edges). The curve's extremes sit at or beyond today's labels, so nothing moves.
    int hi = hi_today(18, false), lo = lo_today(18, 41);
    temp_labels_align(&hi, &lo, 18, 7, 41 - INSET);
    assert(hi == -3 && lo == 21);
    // The same view with the rain bars standing: the curve's floor rises to row 31. The lo
    // label's ink (11 rows) centres on it, 11 blank rows under the hi label's: it fits.
    hi = hi_today(18, false); lo = lo_today(18, 41);
    temp_labels_align(&hi, &lo, 18, 7, 41 - 10);
    assert(hi == -3 && lo == 19);
    assert(ink_top(lo, 18) == 31 - 5 && ink_bottom(lo, 18) == 31 + 5);
    assert(ink_top(lo, 18) - ink_bottom(hi, 18) - 1 == TEMP_LABEL_MIN_INK_GAP);
    // basalt's default compactCal view (65 px band): baseline 55, the bars standing (margin
    // 13: curve floor 42). The lo label rises 5 rows, its ink centred on the floor.
    hi = hi_today(18, false); lo = lo_today(18, 55);
    assert(lo == 35);
    temp_labels_align(&hi, &lo, 18, 7, 55 - 13);
    assert(hi == -3 && lo == 30);
    assert(ink_top(lo, 18) == 42 - 5);
    // emery's fullCal / compactDense view (68 px band) at GOTHIC_24: baseline 48, the bars
    // standing (margin 12: curve floor 36). The lo label would come within 8 rows of the hi
    // label's ink. Too close: today's.
    hi = hi_today(24, true); lo = lo_today(24, 48);
    temp_labels_align(&hi, &lo, 24, 7, 48 - 12);
    assert(hi == hi_today(24, true) && lo == lo_today(24, 48));
    // emery's default compactCal view (82 px band) at GOTHIC_24: baseline 62, the bars
    // standing (margin 15: curve floor 47). Room: the lo label rises 6 rows, its ink (14
    // rows) centred on the floor.
    hi = hi_today(24, true); lo = lo_today(24, 62);
    assert(lo == 36);
    temp_labels_align(&hi, &lo, 24, 7, 62 - 15);
    assert(hi == hi_today(24, true) && lo == 30);
    assert(ink_top(lo, 24) == 47 - 7);
    // A tall graph (basalt's no-calendar view, 87 px band: baseline 77, quarter 19), the rain
    // bars hanging and a rain-chance line standing: both edges a quarter in, both labels
    // centred on the curve's extremes.
    hi = hi_today(18, false); lo = lo_today(18, 77);
    temp_labels_align(&hi, &lo, 18, 19, 77 - 19);
    assert(ink_top(hi, 18) == 19 - 5 && ink_top(lo, 18) == 58 - 5);
    // A flat curve: both on one row, never room for the gap.
    hi = hi_today(18, false); lo = lo_today(18, 77);
    temp_labels_align(&hi, &lo, 18, 38, 38);
    assert(hi == -3 && lo == lo_today(18, 77));
}

// Over every placement: either both labels keep today's place, or each moved only inward,
// the two keep the minimum gap, and each label's ink is centred on its row unless that row
// lies beyond today's label (then it stays at today's).
static void test_label_invariants(void) {
    srand(1);
    const int heights[] = { 14, 18, 24 };
    for (int n = 0; n < 200000; ++n) {
        const int h = heights[rand() % 3];
        const int baseline = 30 + rand() % 140;
        const int hi0 = hi_today(h, rand() % 2);
        const int lo0 = lo_today(h, baseline);
        const int a = rand() % (baseline + 1), b = rand() % (baseline + 1);
        const int top = a < b ? a : b, bottom = a < b ? b : a;
        int hi = hi0, lo = lo0;
        temp_labels_align(&hi, &lo, h, top, bottom);
        if (hi == hi0 && lo == lo0) { continue; }
        assert(hi >= hi0 && lo <= lo0);
        assert(ink_top(lo, h) - ink_bottom(hi, h) - 1 >= TEMP_LABEL_MIN_INK_GAP);
        const int cap = status_cap_h(h);
        if (hi > hi0) { assert(ink_top(hi, h) == top - cap / 2); }
        if (lo < lo0) { assert(ink_top(lo, h) == bottom - cap / 2); }
    }
}

int main(void) {
    test_anchor_bits();
    test_margins();
    test_label_examples();
    test_label_invariants();
    printf("temp_axis_pad_test: all passed\n");
    return 0;
}
