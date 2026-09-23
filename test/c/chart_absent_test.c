// Host-side pin of the solid line's gap kernel (chart_runs.h): the watch half
// of the "wire byte 0 draws nothing" invariant (forecast-series.js
// metricBytes). chart.c's SOLID path segments its polyline with
// chart_next_run, and forecast_layer.c flags the metric lines zero_absent —
// both are SDK-bound and cannot be host-compiled (the line_style_decode_test
// pattern), so the kernel is pinned here and the flag placement is covered by
// the settings preview's mirror pins (test/config-blocks.test.js's UV
// segmentation tests), keeping the two renderers from drifting apart.
#include <assert.h>
#include <stdio.h>

#include "c/appendix/chart_runs.h"

// Collect every run chart.c's segment loop would draw.
static int collect_runs(const int16_t *vals, int count, int lo, bool zero_absent,
                        int *starts, int *lens) {
    int n = 0, i = 0;
    while (i < count) {
        int start;
        const int run = chart_next_run(vals, count, lo, zero_absent, i, &start);
        if (run == 0) { break; }
        starts[n] = start;
        lens[n] = run;
        n++;
        i = start + run;
    }
    return n;
}

int main(void) {
    // CHART_ABSENT gaps whatever the flag says — the HR line's genuine gaps.
    assert(chart_sample_absent(CHART_ABSENT, 0, false));
    assert(chart_sample_absent(CHART_ABSENT, 40, true));

    // zero_absent: at or below the floor draws nothing — the metric lines'
    // wire byte 0 ("nothing"), matching the marks' unconditional <= lo skip.
    assert(chart_sample_absent(0, 0, true));
    assert(!chart_sample_absent(1, 0, true));

    // Unflagged, a floor reading is real data: the temp curve's band floor
    // (byte 0 = the coldest hour) and the HR line's lo must keep drawing.
    assert(!chart_sample_absent(0, 0, false));
    assert(!chart_sample_absent(40, 40, false));

    int starts[8], lens[8];

    // A flagged metric line over a dry spell: [5, 0, 0, 3, 2] segments into a
    // lone reading (chart.c's run == 1 small-square arm) plus a pair — the
    // same split test/config-blocks.test.js pins for the preview's UV line.
    {
        const int16_t vals[] = { 5, 0, 0, 3, 2 };
        const int n = collect_runs(vals, 5, 0, true, starts, lens);
        assert(n == 2);
        assert(starts[0] == 0 && lens[0] == 1);
        assert(starts[1] == 3 && lens[1] == 2);
    }

    // The same series unflagged draws straight through the zeros: one run —
    // the pre-fix solid rendering, still what temp/feels get.
    {
        const int16_t vals[] = { 5, 0, 0, 3, 2 };
        const int n = collect_runs(vals, 5, 0, false, starts, lens);
        assert(n == 1);
        assert(starts[0] == 0 && lens[0] == 5);
    }

    // An unflagged line still gaps on the explicit sentinel (HR).
    {
        const int16_t vals[] = { 60, CHART_ABSENT, 72 };
        const int n = collect_runs(vals, 3, 40, false, starts, lens);
        assert(n == 2);
        assert(starts[0] == 0 && lens[0] == 1);
        assert(starts[1] == 2 && lens[1] == 1);
    }

    // Leading/trailing gaps and an all-absent series.
    {
        const int16_t vals[] = { 0, 0, 9, 8, 0 };
        const int n = collect_runs(vals, 5, 0, true, starts, lens);
        assert(n == 1);
        assert(starts[0] == 2 && lens[0] == 2);
    }
    {
        const int16_t vals[] = { 0, 0, 0 };
        assert(collect_runs(vals, 3, 0, true, starts, lens) == 0);
    }

    // NULL values (a line consuming precomputed contour points without a
    // sentinel array): one whole-range run, however the layer is flagged.
    {
        int start;
        assert(chart_next_run(NULL, 7, 0, true, 0, &start) == 7);
        assert(start == 0);
    }

    printf("chart_absent_test OK\n");
    return 0;
}
