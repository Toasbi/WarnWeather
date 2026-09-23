// Host-side pin of the radar sky blob decode (radar_sky.h): the phone's
// radar-sky.js packSky writes it and the watch reads it back with these
// inlines. The literal blob below mirrors test/radar-sky.test.js's packSky pin,
// so the two ends of the wire cannot drift apart without one suite failing.
#include <assert.h>
#include <stdio.h>

#include "c/appendix/radar_sky.h"

int main(void) {
    // start 1799086560 (0x6B3BE1E0, little-endian), N = 3,
    // clouds 0/125/250, sun 250/0/10, lightning in slot 1 only.
    const uint8_t blob[] = {
        0xE0, 0xE1, 0x3B, 0x6B,   // 1799086560 as LE uint32
        3,
        0, 125, 250,
        250, 0, 10,
        0x02, 0x00
    };
    const int len = (int)sizeof(blob);
    assert(radar_sky_count(blob, len) == 3);
    assert(radar_sky_start(blob) == 1799086560);
    assert(radar_sky_cloud(blob, 0) == 0);
    assert(radar_sky_cloud(blob, 2) == 250);
    assert(radar_sky_sun(blob, 0) == 250);
    assert(radar_sky_sun(blob, 2) == 10);
    assert(!radar_sky_lightning(blob, 0));
    assert(radar_sky_lightning(blob, 1));
    assert(!radar_sky_lightning(blob, 2));

    // Malformed blobs decode to no slots at all rather than overreading.
    assert(radar_sky_count(blob, len - 1) == 0);      // length disagrees with N
    assert(radar_sky_count(blob, 4) == 0);            // shorter than the header
    assert(radar_sky_count(NULL, 0) == 0);
    const uint8_t zero_n[] = { 0, 0, 0, 0, 0, 0, 0 };
    assert(radar_sky_count(zero_n, (int)sizeof(zero_n)) == 0);

    // x mapping: a 15-min sky slot spans three 5-min radar columns.
    assert(radar_sky_x(1000, 1000, 10, 6, 300) == 10);
    assert(radar_sky_x(1000 + 900, 1000, 10, 6, 300) == 28);
    assert(radar_sky_x(1000 - 300, 1000, 10, 6, 300) == 4);   // before the window: left of anchor

    // The bolt glyph: a zig-zag, every row inked, top-right to bottom-left.
    int inked = 0;
    for (int y = 0; y < RADAR_BOLT_H; ++y) {
        int row = 0;
        for (int x = 0; x < RADAR_BOLT_W; ++x) { row += radar_bolt_on(x, y); }
        assert(row > 0);
        inked += row;
    }
    assert(inked == 17);
    assert(radar_bolt_on(4, 0) && !radar_bolt_on(0, 0));
    assert(radar_bolt_on(0, 6) && !radar_bolt_on(4, 6));
    assert(!radar_bolt_on(5, 3) && !radar_bolt_on(0, 7));

    printf("radar_sky_test OK\n");
    return 0;
}
