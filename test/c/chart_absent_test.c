// Host-side pin of the solid line's gap kernel (chart_runs.h): the watch half
// of the "wire byte 0 draws nothing" invariant (forecast-series.js
// metricBytes), and of the rule that a metric line still comes down to a zero
// next to a reading. chart.c's SOLID path segments its polyline with
// chart_next_run, and forecast_layer.c flags the metric lines GAP or JOIN —
// both are SDK-bound and cannot be host-compiled (the line_style_decode_test
// pattern), so the kernel is pinned here, and the settings preview's twin
// (preview-forecast.js lineRuns) is held to the same LINE_RUN_VECTORS by
// test/config-blocks.test.js, keeping the two renderers from drifting apart.
#include <assert.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "c/appendix/chart_runs.h"

#define MAX_N 24

// Collect every run chart.c's segment loop would draw.
static int collect_runs(const int16_t *vals, int count, int lo, int zero,
                        int *starts, int *lens) {
    int n = 0, i = 0;
    while (i < count) {
        int start;
        const int run = chart_next_run(vals, count, lo, zero, i, &start);
        if (run == 0) { break; }
        starts[n] = start;
        lens[n] = run;
        n++;
        i = start + run;
    }
    return n;
}

// LINE_RUN_VECTORS: one line's samples (wire bytes over lo 0), how it reads its byte 0
// (chart_runs.h CHART_ZERO_*), and the runs its polyline draws as "start+length" pairs.
// test/config-blocks.test.js parses this table and runs the preview's lineRuns over it
// (the CITY_VECTORS pattern): keep one row per line, in this shape.
static const struct { const char *vals; int zero; const char *runs; } LINE_RUN_VECTORS[] = {
    { "5 0 0 3 2", CHART_ZERO_JOIN, "0+2 2+3" },
    { "8 6 4 2 1 0 0 0 0 0 1 3", CHART_ZERO_JOIN, "0+6 9+3" },
    { "0 0 9 8 0", CHART_ZERO_JOIN, "1+4" },
    { "0 5 0", CHART_ZERO_JOIN, "0+3" },
    { "5 0 3", CHART_ZERO_JOIN, "0+3" },
    { "0 2 0 0 0 7 0 9", CHART_ZERO_JOIN, "0+3 4+4" },
    { "4 0", CHART_ZERO_JOIN, "0+2" },
    { "0 4", CHART_ZERO_JOIN, "0+2" },
    { "3 3 3", CHART_ZERO_JOIN, "0+3" },
    { "0 0 0", CHART_ZERO_JOIN, "" },
    { "5 0 0 3 2", CHART_ZERO_GAP, "0+1 3+2" },
    { "0 0 9 8 0", CHART_ZERO_GAP, "2+2" },
    { "0 5 0", CHART_ZERO_GAP, "1+1" },
    { "5 0 3", CHART_ZERO_GAP, "0+1 2+1" },
    { "0 0 0", CHART_ZERO_GAP, "" },
    { "5 0 0 3 2", CHART_ZERO_DATA, "0+5" },
    { "0 0 0", CHART_ZERO_DATA, "0+3" },
};

// Parse "a b c" into vals; returns the count.
static int parse_vals(const char *s, int16_t *vals) {
    int n = 0;
    char *end;
    for (long v = strtol(s, &end, 10); end != s; v = strtol(s, &end, 10)) {
        vals[n++] = (int16_t)v;
        s = end;
    }
    return n;
}

// The runs as "start+length" pairs, the table's shape.
static void format_runs(const int *starts, const int *lens, int n, char *out, size_t size) {
    out[0] = '\0';
    for (int k = 0; k < n; k++) {
        const size_t used = strlen(out);
        snprintf(out + used, size - used, "%s%d+%d", k ? " " : "", starts[k], lens[k]);
    }
}

// The runs before a zero could join (the pre-JOIN kernel): every maximal stretch of
// samples that are not absent. DATA and GAP lines still draw exactly these.
static int reference_gap_runs(const int16_t *vals, int count, int lo, int zero,
                              int *starts, int *lens) {
    int n = 0;
    for (int i = 0; i < count; ) {
        if (chart_sample_absent(vals[i], lo, zero)) { i++; continue; }
        const int s = i;
        while (i < count && !chart_sample_absent(vals[i], lo, zero)) { i++; }
        starts[n] = s;
        lens[n] = i - s;
        n++;
    }
    return n;
}

static bool same_runs(int n1, const int *s1, const int *l1, int n2, const int *s2, const int *l2) {
    if (n1 != n2) { return false; }
    for (int k = 0; k < n1; k++) {
        if (s1[k] != s2[k] || l1[k] != l2[k]) { return false; }
    }
    return true;
}

int main(void) {
    // CHART_ABSENT gaps whatever the line reads its floor as — the HR line's genuine gaps.
    assert(chart_sample_absent(CHART_ABSENT, 0, CHART_ZERO_DATA));
    assert(chart_sample_absent(CHART_ABSENT, 40, CHART_ZERO_JOIN));

    // GAP and JOIN: at or below the floor draws nothing on its own — the metric lines'
    // wire byte 0 ("nothing"), matching the marks' unconditional <= lo skip.
    assert(chart_sample_absent(0, 0, CHART_ZERO_GAP));
    assert(chart_sample_absent(0, 0, CHART_ZERO_JOIN));
    assert(!chart_sample_absent(1, 0, CHART_ZERO_JOIN));

    // DATA: a floor reading is real data: the temp curve's band floor (byte 0 = the
    // coldest hour) and the HR line's lo must keep drawing.
    assert(!chart_sample_absent(0, 0, CHART_ZERO_DATA));
    assert(!chart_sample_absent(40, 40, CHART_ZERO_DATA));

    int starts[MAX_N], lens[MAX_N];
    char got[128];

    // The shared vectors (see LINE_RUN_VECTORS). JOIN: a zero next to a reading ends
    // the run there, so the line comes down to it ("5 0 0 3 2"); the zeros between
    // two such ends stay a gap; a lone zero between two readings is a dip ("5 0 3")
    // and a lone reading between zeros a peak ("0 5 0"). GAP: a plain gap, and a lone
    // reading is a run of one (chart.c's small square). DATA: straight through.
    for (size_t r = 0; r < sizeof(LINE_RUN_VECTORS) / sizeof(LINE_RUN_VECTORS[0]); r++) {
        int16_t vals[MAX_N];
        const int count = parse_vals(LINE_RUN_VECTORS[r].vals, vals);
        const int n = collect_runs(vals, count, 0, LINE_RUN_VECTORS[r].zero, starts, lens);
        format_runs(starts, lens, n, got, sizeof(got));
        if (strcmp(got, LINE_RUN_VECTORS[r].runs) != 0) {
            fprintf(stderr, "chart_absent_test: \"%s\" (zero %d): got \"%s\", want \"%s\"\n",
                    LINE_RUN_VECTORS[r].vals, LINE_RUN_VECTORS[r].zero, got,
                    LINE_RUN_VECTORS[r].runs);
            return 1;
        }
    }

    // A DATA line still gaps on the explicit sentinel (HR), a lone reading a run of one.
    {
        const int16_t vals[] = { 60, CHART_ABSENT, 72, 75 };
        const int n = collect_runs(vals, 4, 40, CHART_ZERO_DATA, starts, lens);
        assert(n == 2);
        assert(starts[0] == 0 && lens[0] == 1);
        assert(starts[1] == 2 && lens[1] == 2);
    }

    // Sweep: DATA and GAP lines draw exactly the runs they drew before JOIN existed,
    // and a JOIN line draws those same runs whenever no zero sits next to a reading
    // (all readings, or nothing at all): such a frame is unchanged. A JOIN run never
    // holds two zeros in a row, and always holds a reading.
    uint32_t seed = 12345u;
    for (int trial = 0; trial < 20000; trial++) {
        int16_t vals[MAX_N];
        seed = seed * 1103515245u + 12345u;
        const int count = 1 + (int)((seed >> 16) % MAX_N);
        seed = seed * 1103515245u + 12345u;
        const int density = (int)((seed >> 16) % 5);   // 0: no zeros ... 4: all zeros
        for (int i = 0; i < count; i++) {
            seed = seed * 1103515245u + 12345u;
            const int roll = (int)((seed >> 16) % 4);
            vals[i] = (int16_t)(roll < density ? 0 : 1 + (int)((seed >> 8) % 250));
        }
        int rs[MAX_N], rl[MAX_N];
        for (int zero = CHART_ZERO_DATA; zero <= CHART_ZERO_GAP; zero++) {
            const int n = collect_runs(vals, count, 0, zero, starts, lens);
            const int rn = reference_gap_runs(vals, count, 0, zero, rs, rl);
            assert(same_runs(n, starts, lens, rn, rs, rl));
        }
        bool neighbour = false;
        for (int i = 0; i + 1 < count; i++) {
            if ((vals[i] == 0) != (vals[i + 1] == 0)) { neighbour = true; }
        }
        const int n = collect_runs(vals, count, 0, CHART_ZERO_JOIN, starts, lens);
        if (!neighbour) {
            const int rn = reference_gap_runs(vals, count, 0, CHART_ZERO_GAP, rs, rl);
            assert(same_runs(n, starts, lens, rn, rs, rl));
        }
        for (int k = 0; k < n; k++) {
            bool reading = false;
            for (int i = starts[k]; i < starts[k] + lens[k]; i++) {
                if (vals[i] != 0) { reading = true; }
                if (i + 1 < starts[k] + lens[k]) { assert(vals[i] != 0 || vals[i + 1] != 0); }
            }
            assert(reading);
        }
    }

    printf("chart_absent_test OK\n");
    return 0;
}
