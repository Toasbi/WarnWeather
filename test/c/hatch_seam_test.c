// Host-side pin of the hatch's phase (hatch.h hatch_first_y), which the forecast's
// night shading relies on to run on up through the top stripe band: chart.c draws the
// band's rows (extend_top) and the plot's rows as two rects stacked in one column,
// and they must land exactly the dots one rect spanning both would — no doubled row,
// no missing row, no shifted diagonal at the seam. hatch.c's loops walk
// hatch_first_y's row and then every `stride` rows below it to the rect's end; the
// walk here is that loop, so the seam is checked on the real phase function.
#include <stdbool.h>
#include <stdio.h>
#include <string.h>

#include "c/appendix/hatch.h"

static int s_failures;

static void expect(const char *name, int got, int want) {
    if (got != want) {
        printf("FAIL %s: got %d want %d\n", name, got, want);
        s_failures++;
    }
}

#define MAX_H 128

// hatch_fill_rect_raw's inner loop for one column of a rect [top, top + h).
static void walk(bool dots[MAX_H], int x, int top, int h, int stride) {
    for (int y = hatch_first_y((int16_t)x, (int16_t)top, (int16_t)stride); y < top + h;
         y += stride) {
        dots[y] = true;
    }
}

int main(void) {
    // --- the phase itself ---
    expect("aligned start", hatch_first_y(4, 2, 6), 2);        // (4 + 2) % 6 == 0
    expect("next aligned row", hatch_first_y(4, 3, 6), 8);     // (4 + 8) % 6 == 0
    expect("negative x", hatch_first_y(-3, 0, 7), 3);          // (-3 + 3) % 7 == 0
    expect("negative y", hatch_first_y(0, -5, 6), 0);          // negative modulo folded

    // --- a hatch split at any row draws exactly the unsplit hatch ---
    // Every stride the night hatch takes (6..13 across the presets, hatch_stride_test.c)
    // and then some; every column phase; every band height a top stripe band can have
    // (up to 4 stripes of 6 px + gaps, 29 px) and past it.
    int seam_mismatches = 0, phase_misses = 0, backing_hits = 0;
    for (int stride = 2; stride <= 16; ++stride) {
        for (int x = -20; x < 220; ++x) {
            for (int band = 0; band <= 32; ++band) {
                const int h = 100;   // band + plot, the whole graph
                bool whole[MAX_H], split[MAX_H];
                memset(whole, 0, sizeof(whole));
                memset(split, 0, sizeof(split));
                walk(whole, x, 0, h, stride);
                walk(split, x, 0, band, stride);          // the band rows (extend_top)
                walk(split, x, band, h - band, stride);   // the plot rows below them
                for (int y = 0; y < h; ++y) {
                    if (whole[y] != split[y]) { seam_mismatches++; }
                    if (whole[y] && ((x + y) % stride + stride) % stride != 0) { phase_misses++; }
                }
                // B&W backs each plot dot with a background run one row above and below
                // it (hatch_fill_rect). The only plot dot whose run reaches into the band
                // is one on the plot's first row; the row above it must never hold a band
                // dot, or the backing would erase it.
                if (band > 0 && split[band] && split[band - 1]) { backing_hits++; }
            }
        }
    }
    expect("split hatch == unsplit hatch", seam_mismatches, 0);
    expect("every dot on the absolute diagonal", phase_misses, 0);
    expect("plot backing never erases a band dot", backing_hits, 0);

    if (s_failures) {
        printf("hatch_seam_test: %d failure(s)\n", s_failures);
        return 1;
    }
    printf("hatch_seam_test OK\n");
    return 0;
}
