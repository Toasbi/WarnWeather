// Host-compiled test for src/c/appendix/step_scale.h (header-only, SDK-free). Build & run
// via scripts/test-c.sh.
#include <assert.h>
#include <stdint.h>
#include <stdio.h>

#include "c/appendix/step_scale.h"
#include "c/layers/status_metrics.h"   // the label font's metrics (drawn_label)

// The graph seats each mark it keeps (its dashed line and its label) on the row step_scale_row
// gives it, with no bounds check (step_scale_grid): over every hourly step count a watch can
// report (int16), each mark sits on the plot, 0 < mark <= hi.
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
    assert(step_scale_row(2000, 2421, 46) == 8);
    assert(step_scale_row(1000, 2421, 46) == 27);
}

// A label's ink sits step_label_ink_lift rows above its line (its ink centre on the line's
// row + 1), held on row 0 at the highest: 6 rows in emery's Larger graph fonts (GOTHIC_24, a
// 14-row cap), 4 in GOTHIC_18 (an 11-row cap).
static void test_label_seat(void) {
    assert(step_label_ink_lift(24) == 6 && step_label_ink_lift(18) == 4);
    assert(step_label_ink_y(24, 24) == 18 && step_label_ink_y(7, 18) == 3);
    assert(step_label_ink_y(6, 24) == 0 && step_label_ink_y(3, 24) == 0);   // held on row 0
}

// A step label in a font whose measured height is `content_h` (GOTHIC_18, or emery's Larger
// graph fonts' GOTHIC_24), told as the box Pebble lays the text in rather than by its ink, so it
// checks step_label_ink_y from the other side: the box seats its ink centre on the line's row + 1
// (status_metrics.h: the cap at the box's bottom, status_ink_top blank rows over it), and is held
// no higher than leaves the ink on row 0. [ink0, ink1) are the ink's rows.
typedef struct { int ink0, ink1; } LabelInk;

static LabelInk drawn_label(int row, int content_h) {
    const int box_lift = content_h - 1 - status_glyph_below(content_h);
    const int ink_top = status_ink_top(content_h);
    int box = row - box_lift;
    if (box < -ink_top) { box = -ink_top; }
    return (LabelInk){ box + ink_top, box + ink_top + status_cap_h(content_h) };
}

// The seat health_graph_layer.c draws (step_label_ink_y) is the box's, on every row a plot can
// give a line and in both fonts.
static void test_ink_seat_is_the_box_seat(void) {
    const int fonts[2] = { 18, 24 };
    for (int f = 0; f < 2; ++f) {
        for (int row = 0; row <= 140; ++row) {
            assert(step_label_ink_y(row, fonts[f]) == drawn_label(row, fonts[f]).ink0);
        }
    }
}

// The grid (step_scale_grid) keeps both lines exactly while the drawn labels' ink keeps
// STEP_LABEL_GAP blank rows, for every busy window on every plot from a short top band to a tall
// body, in both fonts: two labels never touch, and the halfway line goes only when they would.
static void test_both_labels_only_apart(void) {
    const int fonts[2] = { 18, 24 };
    for (int f = 0; f < 2; ++f) {
        for (int plot_h = 20; plot_h <= 140; ++plot_h) {
            for (int peak = 500; peak <= 20000; ++peak) {
                int marks[2] = { 0, 0 };
                if (step_scale_marks(peak, marks) < 2) { continue; }
                const int hi = step_scale_hi(peak);
                StepGrid g;
                step_scale_grid(&g, marks, 2, hi, plot_h, fonts[f]);
                const LabelInk top = drawn_label(step_scale_row(marks[0], hi, plot_h), fonts[f]);
                const LabelInk mid = drawn_label(step_scale_row(marks[1], hi, plot_h), fonts[f]);
                assert(top.ink0 >= 0);   // no label's ink leaves the plot's top
                assert((g.n == 2) == (mid.ink0 >= top.ink1 + STEP_LABEL_GAP));
            }
        }
    }
}

// Before its first data the graph has no marks and a scale of 0: an empty grid, nothing divided.
// A quiet day's single mark keeps its line.
static void test_grid_counts(void) {
    int m[2] = { 0, 0 };
    StepGrid g;
    step_scale_grid(&g, m, 0, 0, 40, 24);
    assert(g.n == 0);
    assert(step_scale_marks(400, m) == 1);
    step_scale_grid(&g, m, 1, step_scale_hi(400), 40, 24);
    assert(g.n == 1 && g.rows[0] == step_scale_row(400, step_scale_hi(400), 40));
}

// The labels emery's 3-row top band crowded: a 40-row plot (measured on the emulator), with
// Larger graph fonts (GOTHIC_24). A window peaking at 2300 steps puts "2" on row 7 and "1" on
// row 24: the "2" label's ink on rows 1..14, 3 rows clear of the "1" label's from row 18
// (holding the "2" label's BOX on row 0 had sat its ink on rows 10..23, six of them over the
// "1"). The emulator's canned day (1200 steps at its busiest) puts "1" on row 9 and "0.5" on row
// 25: 2 rows clear, just enough. At 1000 steps "1" is on row 3, its label held on row 0, and
// "0.5" on row 22, just clear of it. At 1999 steps the "1.5" and "1" lines are 9 rows apart, less
// than a label in either font: "1.5" alone.
static void test_short_band(void) {
    int m[2] = { 0, 0 };
    StepGrid g;

    assert(step_scale_marks(2300, m) == 2 && m[0] == 2000 && m[1] == 1000);
    step_scale_grid(&g, m, 2, step_scale_hi(2300), 40, 24);
    assert(g.n == 2 && g.rows[0] == 7 && g.rows[1] == 24);
    assert(step_label_ink_y(7, 24) == 1 && step_label_ink_y(24, 24) == 18);
    step_scale_grid(&g, m, 2, step_scale_hi(2300), 40, 18);
    assert(g.n == 2);

    assert(step_scale_marks(1200, m) == 2 && m[0] == 1000 && m[1] == 500);
    step_scale_grid(&g, m, 2, step_scale_hi(1200), 40, 24);
    assert(g.n == 2 && g.rows[0] == 9 && g.rows[1] == 25);
    assert(!step_scale_labels_clear(9, 24, 24));   // a row closer and they would not be

    assert(step_scale_marks(1000, m) == 2 && m[0] == 1000 && m[1] == 500);
    step_scale_grid(&g, m, 2, step_scale_hi(1000), 40, 24);
    assert(g.n == 2 && g.rows[0] == 3 && g.rows[1] == 22);
    assert(!step_scale_labels_clear(3, 21, 24));

    assert(step_scale_marks(1999, m) == 2 && m[0] == 1500 && m[1] == 1000);
    step_scale_grid(&g, m, 2, step_scale_hi(1999), 40, 24);
    assert(g.n == 1 && g.rows[0] == 12);
    assert(step_scale_row(1000, step_scale_hi(1999), 40) == 21);
    step_scale_grid(&g, m, 2, step_scale_hi(1999), 40, 18);
    assert(g.n == 1);
}

int main(void) {
    test_every_mark_is_drawn();
    test_quiet_window_scales_as_a_tenth();
    test_busier_windows_keep_their_scale();
    test_marks();
    test_rows();
    test_label_seat();
    test_ink_seat_is_the_box_seat();
    test_both_labels_only_apart();
    test_grid_counts();
    test_short_band();
    printf("step_scale_test: all passed\n");
    return 0;
}
