// Host tests for layers/faded_pixel.h: a status icon's faded pixel is read off the mark
// gen_watch_icons.js puts in its fill, and shaded its thirds of the way from the paper to the
// ink, each channel rounded to the nearest, as the icon creator's watch test shades it. Built
// with PBL_COLOR: the black and white watches draw no faded pixel.
#include <stdio.h>

#include "c/layers/faded_pixel.h"

static int s_failures;
static void expect_int(const char *name, long got, long want) {
    if (got != want) { printf("FAIL %s: got %ld want %ld\n", name, got, want); s_failures++; }
}

static long shade(uint8_t ink, uint8_t paper, int thirds) {
    return faded_pixel_shade((GColor){ .argb = ink }, (GColor){ .argb = paper }, thirds).argb;
}

int main(void) {
    // The marks: a fill with no alpha, the thirds in its low bits; the drawing's own fill is clear.
    expect_int("mark.own_clear", faded_pixel_thirds((GColor){ .argb = 0x00 }), 0);
    expect_int("mark.a_third", faded_pixel_thirds((GColor){ .argb = 0x01 }), 1);
    expect_int("mark.two_thirds", faded_pixel_thirds((GColor){ .argb = 0x02 }), 2);
    expect_int("mark.an_opaque_fill_is_none", faded_pixel_thirds((GColor){ .argb = 0xC1 }), 0);

    // The dark theme: white ink on black, as gen_watch_icons.js strokes them (FADED_STROKE).
    expect_int("dark.third_dark_grey", shade(0xFF, 0xC0, 1), 0xD5);
    expect_int("dark.two_thirds_light_grey", shade(0xFF, 0xC0, 2), 0xEA);
    // The light theme: black ink on white, a third of the way from the white.
    expect_int("light.third_light_grey", shade(0xC0, 0xFF, 1), 0xEA);
    expect_int("light.two_thirds_dark_grey", shade(0xC0, 0xFF, 2), 0xD5);
    // Inside a filled highlight box: white ink on red, each channel on its own.
    expect_int("red_box.third", shade(0xFF, 0xF0, 1), 0xF5);
    expect_int("red_box.two_thirds", shade(0xFF, 0xF0, 2), 0xFA);
    // The Bluetooth rune's PictonBlue on black: channels 1, 2, 3 each shaded.
    expect_int("picton.third", shade(0xDB, 0xC0, 1), 0xC5);
    expect_int("picton.two_thirds", shade(0xDB, 0xC0, 2), 0xD6);
    // The ends: none of the ink is the paper, all of it the ink; ink on itself stays itself.
    expect_int("ends.none", shade(0xFF, 0xC0, 0), 0xC0);
    expect_int("ends.all", shade(0xFF, 0xC0, 3), 0xFF);
    expect_int("ends.ink_on_itself", shade(0xF0, 0xF0, 1), 0xF0);

    if (s_failures) { printf("%d faded_pixel failure(s)\n", s_failures); return 1; }
    printf("faded_pixel OK\n");
    return 0;
}
