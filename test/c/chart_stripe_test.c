// Host-side pin of the stripe line style's arithmetic (chart_stripe.h): the
// value -> level step, the background -> line-colour blend and the B&W dither.
// chart.c's chart_render_stripe is SDK-bound and cannot be host-compiled (the
// chart_absent_test pattern), so its pure half is pinned here; the settings
// preview mirrors the same three (preview-forecast.js), pinned by
// test/config-blocks.test.js with the same colours.
#include <assert.h>
#include <stdio.h>

#include "c/appendix/chart_stripe.h"

int main(void) {
    // Level: wire byte 0 draws nothing, anything above shows (rounding up), and
    // the top of the 0..250 range is full intensity.
    assert(chart_stripe_level(0, 0, 250) == 0);
    assert(chart_stripe_level(1, 0, 250) == 1);
    assert(chart_stripe_level(62, 0, 250) == 1);
    assert(chart_stripe_level(63, 0, 250) == 2);
    assert(chart_stripe_level(125, 0, 250) == 2);
    assert(chart_stripe_level(126, 0, 250) == 3);
    assert(chart_stripe_level(250, 0, 250) == 4);
    assert(chart_stripe_level(300, 0, 250) == 4);   // clamped
    assert(chart_stripe_level(5, 0, 0) == 0);       // degenerate range

    // Blend, dark ground: black -> PictonBlue (0x55AAFF, argb 0xDB) in quarters.
    assert(chart_stripe_blend(0xC0, 0xDB, 1) == 0xC5);   // 0x005555
    assert(chart_stripe_blend(0xC0, 0xDB, 2) == 0xD6);   // 0x5555AA
    assert(chart_stripe_blend(0xC0, 0xDB, 3) == 0xDA);   // 0x55AAAA
    assert(chart_stripe_blend(0xC0, 0xDB, 4) == 0xDB);   // the line colour itself
    // Light ground: white -> DukeBlue (0x0000AA, argb 0xC2); level 1 moves off white.
    assert(chart_stripe_blend(0xFF, 0xC2, 1) == 0xEB);   // 0xAAAAFF
    assert(chart_stripe_blend(0xFF, 0xC2, 4) == 0xC2);

    // Dither densities over one 2x2 tile: 1, 2, 3 and 4 inked pixels.
    for (int level = 1; level <= 4; ++level) {
        int inked = 0;
        for (int y = 0; y < 2; ++y) {
            for (int x = 0; x < 2; ++x) { inked += chart_stripe_dither_on(level, x, y); }
        }
        assert(inked == level);
    }
    assert(!chart_stripe_dither_on(0, 0, 0));

    // Colour pattern: a pale tint under full-colour vertical lines every 4th,
    // 3rd and 2nd column, then solid — so every level differs even where two
    // tints round to the same colour.
    assert(chart_stripe_tint_level(1) == 1 && chart_stripe_tint_level(2) == 1);
    assert(chart_stripe_tint_level(3) == 2 && chart_stripe_tint_level(4) == 4);
    for (int level = 1; level <= 4; ++level) {
        int lines = 0;
        for (int x = 0; x < 12; ++x) { lines += chart_stripe_line_on(level, x); }
        static const int EXPECTED[5] = { 0, 3, 4, 6, 12 };   // 12 columns: /4, /3, /2, all
        assert(lines == EXPECTED[level]);
    }
    assert(!chart_stripe_line_on(0, 0));

    printf("chart_stripe_test OK\n");
    return 0;
}
