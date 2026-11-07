// Host-compiled test for src/c/appendix/step_scale.h (header-only, SDK-free). Build & run
// via scripts/test-c.sh.
#include <assert.h>
#include <stdint.h>
#include <stdio.h>

#include "c/appendix/step_scale.h"
#include "c/layers/status_metrics.h"   // the label font's metrics (health_graph_layer.c)

// The graph draws every mark the scale picks (its dashed line and its label) on the row
// step_scale_row gives it, unchecked (health_graph_layer.c step_marks_shown): over every hourly
// step count a watch can report (int16), each one sits on the plot, 0 < mark <= hi.
static void test_every_mark_is_drawn(void) {
    for (int peak = 0; peak <= INT16_MAX; ++peak) {
        const int hi = step_scale_hi(peak);
        int marks[2] = { 0, 0 };
        const int n = step_scale_marks(peak, marks);
        assert(n == 1 || n == 2);
        for (int i = 0; i < n; ++i) {
            assert(marks[i] > 0);
            assert(marks[i] <= hi);
        }
        if (n == 2) {
            assert(marks[1] < marks[0]);   // top first
        }
    }
}

// A quiet window (every hour under 100 steps, e.g. early morning) scales as 0.1k: the
// 0.1 line and its label draw. It used to scale to its own peak, which put 0.1 above
// the plot, so the axis showed no label at all.
static void test_quiet_window_scales_as_a_tenth(void) {
    const int floor_hi = step_scale_hi(STEP_SCALE_MIN);
    assert(floor_hi == 106);
    for (int peak = 0; peak < STEP_SCALE_MIN; ++peak) {
        int marks[2] = { 0, 0 };
        assert(step_scale_hi(peak) == floor_hi);
        assert(step_scale_marks(peak, marks) == 1);
        assert(marks[0] == 100);
    }
}

// From 0.1k up the scale is the busiest hour at ~95% of the plot, as before the floor.
static void test_busier_windows_keep_their_scale(void) {
    for (int peak = STEP_SCALE_MIN; peak <= INT16_MAX; ++peak) {
        assert(step_scale_hi(peak) == (peak * 100 + 94) / 95);
        int marks[2] = { 0, 0 };
        step_scale_marks(peak, marks);
        assert(marks[0] <= peak);   // the top line cuts through the tallest bar
    }
}

static void test_marks(void) {
    int m[2] = { 0, 0 };
    assert(step_scale_marks(120, m) == 1 && m[0] == 100);
    assert(step_scale_marks(250, m) == 1 && m[0] == 200);
    assert(step_scale_marks(499, m) == 1 && m[0] == 400);
    assert(step_scale_marks(500, m) == 1 && m[0] == 500);
    assert(step_scale_marks(1200, m) == 2 && m[0] == 1000 && m[1] == 500);
    assert(step_scale_marks(2600, m) == 2 && m[0] == 2500 && m[1] == 1500);
}

// The line's row is the bars' mapping: the scale's top on row 0, nothing on the floor.
static void test_rows(void) {
    assert(step_scale_row(0, 2421, 46) == 46);
    assert(step_scale_row(2421, 2421, 46) == 0);
    assert(step_scale_row(2000, 2421, 46) == 46 - (2000 * 46) / 2421);
    assert(step_scale_row(1000, 2421, 46) == 27);
}

// A step label as health_graph_layer.c draws it, in a font whose measured height is
// `content_h` (GOTHIC_18 or emery's Larger graph fonts' GOTHIC_24), told as the box Pebble
// lays the text in: the box seats its ink centre on the line's row + 1 (status_metrics.h:
// the cap at the box's bottom, status_ink_top blank rows over it), and is held no higher
// than leaves the ink on row 0. [ink0, ink1) are the ink's rows.
typedef struct { int ink0, ink1; } LabelInk;

static LabelInk drawn_label(int row, int content_h) {
    const int box_lift = content_h - 1 - status_glyph_below(content_h);
    const int ink_top = status_ink_top(content_h);
    int box = row - box_lift;
    if (box < -ink_top) { box = -ink_top; }
    return (LabelInk){ box + ink_top, box + ink_top + status_cap_h(content_h) };
}

// Whether both labels draw, as step_marks_shown asks it (step_label_ink_lift; its gap:
// STEP_LABEL_GAP).
static bool both_drawn(int top_row, int mid_row, int content_h) {
    return step_scale_labels_clear(top_row, mid_row, status_cap_h(content_h),
                                   status_cap_h(content_h) - 1 - status_glyph_below(content_h), 2);
}

// The plot keeps both lines exactly while the drawn labels' ink keeps 2 blank rows between,
// for every busy window on every plot from a short top band to a tall body, in both fonts:
// two labels never touch, and the halfway line goes only when they would.
static void test_both_labels_only_apart(void) {
    const int fonts[2] = { 18, 24 };
    for (int f = 0; f < 2; ++f) {
        for (int plot_h = 20; plot_h <= 140; ++plot_h) {
            for (int peak = 500; peak <= 20000; ++peak) {
                int marks[2] = { 0, 0 };
                if (step_scale_marks(peak, marks) < 2) { continue; }
                const int hi = step_scale_hi(peak);
                const int top_row = step_scale_row(marks[0], hi, plot_h);
                const int mid_row = step_scale_row(marks[1], hi, plot_h);
                const LabelInk top = drawn_label(top_row, fonts[f]);
                const LabelInk mid = drawn_label(mid_row, fonts[f]);
                assert(top.ink0 >= 0);   // no label's ink leaves the plot's top
                assert(both_drawn(top_row, mid_row, fonts[f]) == (mid.ink0 >= top.ink1 + 2));
            }
        }
    }
}

// The labels emery's 3-row top band crowded: a 40-row plot (measured on the emulator), with
// Larger graph fonts GOTHIC_24 (a 14-row cap, its box's top 10 rows blank). A window peaking at
// 2300 steps puts "2" on row 7 and "1" on row 24. Holding the "2" label's BOX on row 0 sat its
// ink on rows 10..23, six of them over the "1" label's from row 18; held by its ink it sits on
// its line, rows 1..14, 3 rows clear. The emulator's canned day (1200 steps at its busiest)
// puts "1" on row 9 and "0.5" on row 25: 2 rows clear. At 1999 steps the "1.5" and "1" lines
// are 9 rows apart, less than a label in either font: "1.5" alone.
static void test_short_band(void) {
    int m[2] = { 0, 0 };
    assert(step_scale_marks(2300, m) == 2 && m[0] == 2000 && m[1] == 1000);
    const int hi = step_scale_hi(2300);
    assert(step_scale_row(2000, hi, 40) == 7 && step_scale_row(1000, hi, 40) == 24);
    const LabelInk two = drawn_label(7, 24), one = drawn_label(24, 24);
    assert(two.ink0 == 1 && two.ink1 == 15 && one.ink0 == 18);
    const int old_two_ink0 = 0 + status_ink_top(24);   // the box held on row 0
    assert(old_two_ink0 == 10 && old_two_ink0 + status_cap_h(24) - one.ink0 == 6);
    assert(both_drawn(7, 24, 24));

    assert(step_scale_marks(1200, m) == 2 && m[0] == 1000 && m[1] == 500);
    const int hi_day = step_scale_hi(1200);
    assert(step_scale_row(1000, hi_day, 40) == 9 && step_scale_row(500, hi_day, 40) == 25);
    assert(drawn_label(25, 24).ink0 - drawn_label(9, 24).ink1 == 2);
    assert(both_drawn(9, 25, 24));

    assert(step_scale_marks(1999, m) == 2 && m[0] == 1500 && m[1] == 1000);
    const int hi_close = step_scale_hi(1999);
    const int top_row = step_scale_row(1500, hi_close, 40), mid_row = step_scale_row(1000, hi_close, 40);
    assert(mid_row - top_row == 9);
    assert(!both_drawn(top_row, mid_row, 24));
    assert(!both_drawn(top_row, mid_row, 18));
}

int main(void) {
    test_every_mark_is_drawn();
    test_quiet_window_scales_as_a_tenth();
    test_busier_windows_keep_their_scale();
    test_marks();
    test_rows();
    test_both_labels_only_apart();
    test_short_band();
    printf("step_scale_test: all passed\n");
    return 0;
}
