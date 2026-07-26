// Goldens for hatch.h's height-scaled stride curve.
//
// These expectations are computed from HATCH_GROWTH_PCT = 100. Retuning that knob is
// EXPECTED to break this test — that is the point: the goldens are the written record of
// what the curve does at every real plot height, so a retune has to restate them
// deliberately rather than drift silently.
//
// Plot heights come from the band heights pinned in test/c/layout_test.c, minus
// BOTTOM_VIEW_BOTTOM_PAD (0 / emery 10) and BOTTOM_VIEW_AXIS_H (10) for the forecast, or
// minus RADAR_AXIS_H (12) for the radar.
#include <stdio.h>

#include "c/appendix/hatch.h"

static int s_failures;

static void expect(const char *name, int got, int want) {
    if (got != want) {
        printf("FAIL %s: got %d want %d\n", name, got, want);
        s_failures++;
    }
}

// The project's two base strides: colour builds/themes use 6, any B&W theme uses 7
// (theme_is_bw() decides at the call sites; the curve itself is theme-agnostic).
#define BASE_COLOR 6
#define BASE_BW    7

// Baselines: the smallest forecast plot height per platform.
#define BASE_H_168   41
#define BASE_H_EMERY 48

int main(void) {
    // --- the platform constant is wired to the right baseline ---
#ifdef PBL_PLATFORM_EMERY
    expect("HATCH_BASE_PLOT_H/emery", HATCH_BASE_PLOT_H, BASE_H_EMERY);
#else
    expect("HATCH_BASE_PLOT_H/168", HATCH_BASE_PLOT_H, BASE_H_168);
#endif

    // --- clamp: at or below the baseline, the stride is exactly today's value ---
    expect("clamp/at-baseline/color",
           hatch_stride_scaled(BASE_COLOR, BASE_H_168, 41), 6);
    expect("clamp/at-baseline/bw",
           hatch_stride_scaled(BASE_BW, BASE_H_168, 41), 7);
    // radar in the full-tier top band (45 - RADAR_AXIS_H 12 = 33)
    expect("clamp/radar-top-full/color",
           hatch_stride_scaled(BASE_COLOR, BASE_H_168, 33), 6);
    // radar in the compact top band (30 - 12 = 18)
    expect("clamp/radar-top-compact/color",
           hatch_stride_scaled(BASE_COLOR, BASE_H_168, 18), 6);
    // radar in the compactDense body band (51 - 12 = 39)
    expect("clamp/radar-body-dense/color",
           hatch_stride_scaled(BASE_COLOR, BASE_H_168, 39), 6);
    expect("clamp/zero", hatch_stride_scaled(BASE_COLOR, BASE_H_168, 0), 6);
    expect("clamp/negative", hatch_stride_scaled(BASE_COLOR, BASE_H_168, -5), 6);

    // --- forecast, 168px watches (bands 51 / 65 / 87 → plots 41 / 55 / 77) ---
    expect("fc/168/fullCal/color",   hatch_stride_scaled(BASE_COLOR, BASE_H_168, 41), 6);
    expect("fc/168/fullCal/bw",      hatch_stride_scaled(BASE_BW,    BASE_H_168, 41), 7);
    expect("fc/168/compactCal/color", hatch_stride_scaled(BASE_COLOR, BASE_H_168, 55), 8);
    expect("fc/168/compactCal/bw",    hatch_stride_scaled(BASE_BW,    BASE_H_168, 55), 9);
    expect("fc/168/noCal/color",      hatch_stride_scaled(BASE_COLOR, BASE_H_168, 77), 11);
    expect("fc/168/noCal/bw",         hatch_stride_scaled(BASE_BW,    BASE_H_168, 77), 13);

    // --- forecast, emery (bands 68 / 82 / 111 → plots 48 / 62 / 91) ---
    expect("fc/emery/fullCal/color",   hatch_stride_scaled(BASE_COLOR, BASE_H_EMERY, 48), 6);
    expect("fc/emery/fullCal/bw",      hatch_stride_scaled(BASE_BW,    BASE_H_EMERY, 48), 7);
    expect("fc/emery/compactCal/color", hatch_stride_scaled(BASE_COLOR, BASE_H_EMERY, 62), 7);
    expect("fc/emery/compactCal/bw",    hatch_stride_scaled(BASE_BW,    BASE_H_EMERY, 62), 9);
    expect("fc/emery/noCal/color",      hatch_stride_scaled(BASE_COLOR, BASE_H_EMERY, 91), 11);
    expect("fc/emery/noCal/bw",         hatch_stride_scaled(BASE_BW,    BASE_H_EMERY, 91), 13);

    // --- radar area bars, 168px (bands 65 / 87 → plots 53 / 75) ---
    expect("radar/168/compactCal/color", hatch_stride_scaled(BASE_COLOR, BASE_H_168, 53), 7);
    expect("radar/168/compactCal/bw",    hatch_stride_scaled(BASE_BW,    BASE_H_168, 53), 9);
    expect("radar/168/noCal/color",      hatch_stride_scaled(BASE_COLOR, BASE_H_168, 75), 10);
    expect("radar/168/noCal/bw",         hatch_stride_scaled(BASE_BW,    BASE_H_168, 75), 12);

    // --- shape invariants across the whole reachable height range ---
    for (int base = BASE_COLOR; base <= BASE_BW; base++) {
        int prev = base;
        for (int h = 0; h <= 120; h++) {
            int got = hatch_stride_scaled(base, BASE_H_168, h);
            if (got < base) {
                printf("FAIL monotonic/floor: base=%d h=%d got=%d\n", base, h, got);
                s_failures++;
                break;
            }
            if (got < prev) {
                printf("FAIL monotonic/decreasing: base=%d h=%d got=%d prev=%d\n",
                       base, h, got, prev);
                s_failures++;
                break;
            }
            prev = got;
        }
    }

    if (s_failures) {
        printf("%d failure(s)\n", s_failures);
        return 1;
    }
    printf("hatch_stride_test: all cases pass\n");
    return 0;
}
