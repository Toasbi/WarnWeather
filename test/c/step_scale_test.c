// Host-compiled test for src/c/appendix/step_scale.h (header-only, SDK-free). Build & run
// via scripts/test-c.sh.
#include <assert.h>
#include <stdint.h>
#include <stdio.h>

#include "c/appendix/step_scale.h"

// The graph draws a mark (its dashed line and its label) only while 0 < mark <= hi
// (health_graph_layer.c step_grid_draw / draw_left_axis). Over every hourly step count a
// watch can report (int16), each mark the scale picks is drawn.
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

int main(void) {
    test_every_mark_is_drawn();
    test_quiet_window_scales_as_a_tenth();
    test_busier_windows_keep_their_scale();
    test_marks();
    printf("step_scale_test: all passed\n");
    return 0;
}
