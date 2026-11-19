#pragma once
#include <pebble.h>

// A faded pixel (scripts/pixel-icons/README.md, Faded pixels): a pixel of a status icon the colour
// watches draw a third or two thirds of the way from what is behind the icon to its ink, beside
// its own pixels or over one, so its steps and dots look smoother. gen_watch_icons.js writes each
// shade's pixels as 1 px lines and dots after the drawing's own, marked by their fill: a colour
// with no alpha, which draws nothing, its thirds in the low two bits. The black and white watches
// have no shade between ink and paper and draw none (status_row_icons.c).

// How many thirds of the ink a drawing command's fill marks it as: 1 or 2 for a faded pixel's, 0
// for the drawing's own, whose fill is clear.
static inline int faded_pixel_thirds(GColor fill) {
    return (fill.argb & 0xC0) == 0 ? fill.argb & 3 : 0;
}

#if defined(PBL_COLOR)
// The colour `thirds` of the way from `paper` to `ink`, each two-bit channel rounded to the
// nearest: a third of white ink on black paper is dark grey, two thirds light grey. The icon
// creator's previews and its watch test shade the same.
static inline GColor faded_pixel_shade(GColor ink, GColor paper, int thirds) {
    uint8_t out = 0xC0;
    for (int i = 0; i < 3; i++) {
        int s = (ink.argb >> (2 * i)) & 3, d = (paper.argb >> (2 * i)) & 3;
        out |= (uint8_t)(((thirds * s + (3 - thirds) * d + 1) / 3) << (2 * i));
    }
    return (GColor){ .argb = out };
}
#endif
