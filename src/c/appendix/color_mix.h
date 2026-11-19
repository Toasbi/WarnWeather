#pragma once
// A colour a share of the way from one GColor8 to another. SDK-free, so the host suite pins it
// through its two users: the chart stripes' tints (chart_stripe.h, test/c/chart_stripe_test.c)
// and a status icon's faded pixels (layers/faded_pixel.h, test/c/faded_pixel_test.c).
#include <stdint.h>

// The GColor8 argb byte `num`/`den` of the way from `bg` to `fg`, alpha opaque: each two-bit
// r/g/b channel moves that share of its difference, rounded to the nearest step, a half away
// from `bg`. 0 gives `bg`'s colour and `den` gives `fg`'s.
static inline uint8_t gcolor8_mix(uint8_t bg, uint8_t fg, int num, int den) {
    uint8_t out = 0xC0;
    for (int shift = 4; shift >= 0; shift -= 2) {
        const int from = (bg >> shift) & 0x03;
        const int d = (((fg >> shift) & 0x03) - from) * num;
        const int step = d >= 0 ? (d + den / 2) / den : -((-d + den / 2) / den);
        out |= (uint8_t)((from + step) << shift);
    }
    return out;
}
