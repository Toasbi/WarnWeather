#pragma once
// The stripe's pure arithmetic — SDK-free, so the host suite can pin it
// (test/c/chart_stripe_test.c, the chart_runs.h pattern; chart.c itself is
// SDK-bound and never host-compiles). The settings preview mirrors all three
// (preview-forecast.js stripeLevel / stripeBlend / stripeDitherDefs), so the
// preview and the watch shade the same cells the same way.
#include <stdbool.h>
#include <stdint.h>

// Intensity steps a stripe cell can take; 0 means "draw nothing".
#define CHART_STRIPE_LEVELS 4

// A value's intensity level, 0..CHART_STRIPE_LEVELS. At or below `lo` is 0 —
// the metric lines' wire byte 0 means "nothing" (forecast-series.js
// metricBytes), so a stripe leaves that hour empty, as a mark would. Anything
// above it is at least level 1, rounding up, so a small reading still shows.
static inline int chart_stripe_level(int v, int lo, int hi) {
    const int range = hi - lo;
    if (range <= 0 || v <= lo) { return 0; }
    const int level = ((v - lo) * CHART_STRIPE_LEVELS + range - 1) / range;
    return level > CHART_STRIPE_LEVELS ? CHART_STRIPE_LEVELS : level;
}

// One 2-bit colour channel blended from `bg` toward `fg` by level/4, rounded
// half away from `bg` so level 1 always moves off the background when the two
// channels differ by at least two steps.
static inline uint8_t chart_stripe_channel(uint8_t bg, uint8_t fg, int level) {
    const int d = ((int)fg - (int)bg) * level;
    const int step = d >= 0 ? (d + 2) / 4 : -((-d + 2) / 4);
    return (uint8_t)((int)bg + step);
}

// The GColor8 argb byte for one level: each of r/g/b blended channel-wise
// (chart_stripe_channel), alpha forced opaque. Level CHART_STRIPE_LEVELS
// returns the line colour itself.
static inline uint8_t chart_stripe_blend(uint8_t bg_argb, uint8_t fg_argb, int level) {
    uint8_t out = 0xC0;   // alpha 0b11
    for (int shift = 4; shift >= 0; shift -= 2) {
        const uint8_t b = (uint8_t)((bg_argb >> shift) & 0x03);
        const uint8_t f = (uint8_t)((fg_argb >> shift) & 0x03);
        out |= (uint8_t)(chart_stripe_channel(b, f, level) << shift);
    }
    return out;
}

// B&W: whether pixel (x, y) is inked at this level — one pixel in four, a
// checkerboard, three in four, solid. Absolute coordinates, so neighbouring
// cells of the same level tile seamlessly.
static inline bool chart_stripe_dither_on(int level, int x, int y) {
    switch (level) {
        case 1:  return !(x & 1) && !(y & 1);
        case 2:  return ((x ^ y) & 1) == 0;
        case 3:  return !((x & 1) && (y & 1));
        default: return level >= CHART_STRIPE_LEVELS;
    }
}
