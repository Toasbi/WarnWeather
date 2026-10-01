// Host-side pin of the radar sky blob decode (radar_sky.h): the phone's
// radar-sky.js packSky writes it and the watch reads it back with these
// inlines. The literal blob below mirrors test/radar-sky.test.js's packSky pin,
// so the two ends of the wire cannot drift apart without one suite failing.
#include <assert.h>
#include <stdio.h>

#include "c/appendix/chart_stripe.h"
#include "c/appendix/radar_sky.h"

// The radar window the layer draws: 24 slots of 5 min, anchored at the layer's
// x 0, so its columns are [0, 24 * pitch). The audit's two screens are pitch 6
// (144 px wide) and pitch 8 (200 px wide, 192 px of plot).
#define WIN_SLOTS   24
#define WIN_SECONDS (WIN_SLOTS * 300)

// Slot k's cloud/sun cell span for an n-slot sky starting at `sky`, against a
// radar window starting at `radar`, computed as draw_radar_sky computes it.
static bool cell(int32_t sky, int k, int n, int32_t radar, int pitch, int *x0, int *x1) {
    const int32_t t0 = sky + k * RADAR_SKY_SLOT_SECONDS;
    return radar_sky_cell_span(radar_sky_x(t0, radar, 0, pitch, 300),
                               radar_sky_x(t0 + RADAR_SKY_SLOT_SECONDS, radar, 0, pitch, 300),
                               k, n, 0, WIN_SLOTS * pitch, x0, x1);
}

// The bolt x of slot k, likewise as draw_radar_sky computes it.
static bool bolt(int32_t sky, int k, int32_t radar, int pitch, int *bx) {
    const int32_t t0 = sky + k * RADAR_SKY_SLOT_SECONDS;
    return radar_sky_bolt_x(radar_sky_x(t0, radar, 0, pitch, 300),
                            radar_sky_x(t0 + RADAR_SKY_SLOT_SECONDS, radar, 0, pitch, 300),
                            0, WIN_SLOTS * pitch, bx);
}

// Asserts the cell span of slot k is exactly [want0, want1).
static void assert_cell(int32_t sky, int k, int n, int32_t radar, int pitch,
                        int want0, int want1) {
    int x0 = -1, x1 = -1;
    assert(cell(sky, k, n, radar, pitch, &x0, &x1));
    assert(x0 == want0 && x1 == want1);
}

// Asserts the bolt of slot k is drawn exactly at `want`, whole inside the window.
static void assert_bolt(int32_t sky, int k, int32_t radar, int pitch, int want) {
    int bx = -100;
    assert(bolt(sky, k, radar, pitch, &bx));
    assert(bx == want);
    assert(bx >= 0 && bx + RADAR_BOLT_W <= WIN_SLOTS * pitch);
}

// The audit cases for one screen. Q is a quarter-hour epoch (the phone's sky
// grid); the radar start sits on the 5-min grid, 0, 5 or 10 min past a quarter.
static void audit_cases(int p) {
    const int32_t Q = 1799086500;   // 1998985 * 900
    const int x_max = WIN_SLOTS * p;
    int x0, x1, bx;

    // Radar slot 0 at +0/+5/+10 min into the quarter the 10-slot sky starts
    // at: the sky covers the whole window, so nothing extends, slot 0 is cut
    // at the left edge, and the slot the window ends in is cut at the right.
    assert_cell(Q, 0, 10, Q, p, 0, 3 * p);
    assert_cell(Q, 7, 10, Q, p, 21 * p, x_max);
    assert(!cell(Q, 8, 10, Q, p, &x0, &x1));                 // starts at the window end
    assert_cell(Q, 0, 10, Q + 300, p, 0, 2 * p);
    assert_cell(Q, 1, 10, Q + 300, p, 2 * p, 5 * p);
    assert_cell(Q, 8, 10, Q + 300, p, 23 * p, x_max);
    assert(!cell(Q, 9, 10, Q + 300, p, &x0, &x1));            // the last slot: wholly right
    assert_cell(Q, 0, 10, Q + 600, p, 0, p);
    assert_cell(Q, 8, 10, Q + 600, p, 22 * p, x_max);

    // Leading gap: a sky starting 15 / 45 min after the radar start. Slot 0
    // reaches back to the window's first column; the next slot is untouched.
    assert_cell(Q + 900, 0, 10, Q, p, 0, 6 * p);
    assert_cell(Q + 900, 1, 10, Q, p, 6 * p, 9 * p);
    assert_cell(Q + 2700, 0, 10, Q, p, 0, 12 * p);
    assert_cell(Q + 2700, 1, 10, Q, p, 12 * p, 15 * p);

    // Trailing gap: the window has self-advanced until the 10-slot sky
    // [Q, Q + 9000) ends 25 / 55 min before the window does. The last slot
    // persists to the window's last column; the one before it is untouched.
    assert(Q + 9000 == (Q + 3300) + WIN_SECONDS - 1500);
    assert_cell(Q, 9, 10, Q + 3300, p, 16 * p, x_max);
    assert_cell(Q, 8, 10, Q + 3300, p, 13 * p, 16 * p);
    assert(!cell(Q, 0, 10, Q + 3300, p, &x0, &x1));           // slid out on the left
    assert(Q + 9000 == (Q + 5100) + WIN_SECONDS - 3300);
    assert_cell(Q, 9, 10, Q + 5100, p, 10 * p, x_max);
    assert_cell(Q, 8, 10, Q + 5100, p, 7 * p, 10 * p);

    // A one-slot sky inside the window is both first and last: it fills it.
    assert_cell(Q + 900, 0, 1, Q, p, 0, x_max);

    // A sky wholly outside the window (the layer never draws one, as
    // radar_sky_in_window fails) is not stretched across it either.
    assert(!cell(Q, 9, 10, Q + 9000, p, &x0, &x1));           // ended at the left edge
    assert(!cell(Q + WIN_SECONDS, 0, 10, Q, p, &x0, &x1));    // starts at the right edge

    // Edge bolts: a partly visible slot's bolt is centred on its visible part.
    // Slot 0 with the radar at +10 shows one pitch, [0, p): centred on the
    // whole slot the bolt fell at -p/2 - 2 and was dropped.
    assert_bolt(Q, 0, Q + 600, p, p / 2 - RADAR_BOLT_W / 2);
    // The last slot with the radar at +5 shows one pitch, [23p, 24p): centred
    // on the whole slot the bolt ran past the window's end and was dropped.
    assert_bolt(Q, 8, Q + 300, p, 23 * p + p / 2 - RADAR_BOLT_W / 2);
    // The other two partly visible cases now centre on the visible part too:
    // slot 0 at +5 ([0, 2p)) and the last slot at +10 ([22p, 24p)).
    assert_bolt(Q, 0, Q + 300, p, p - RADAR_BOLT_W / 2);
    assert_bolt(Q, 8, Q + 600, p, 23 * p - RADAR_BOLT_W / 2);

    // A fully visible slot's bolt is where the old whole-slot centring put it.
    assert_bolt(Q, 2, Q, p, (6 * p + 9 * p) / 2 - RADAR_BOLT_W / 2);
    assert_bolt(Q, 1, Q + 300, p, (2 * p + 5 * p) / 2 - RADAR_BOLT_W / 2);
    // Bolts never extend: in a leading gap slot 0's cell covers [0, 6p), but
    // its bolt stays centred on the slot's own quarter hour.
    assert_bolt(Q + 900, 0, Q, p, (3 * p + 6 * p) / 2 - RADAR_BOLT_W / 2);
    // A slot wholly outside the window has no bolt.
    assert(!bolt(Q, 8, Q, p, &bx));
    assert(!bolt(Q, 0, Q + 900, p, &bx));
}

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

    // Window overlap: the band shows only while a sky slot overlaps the radar
    // window [radar_start, radar_start + 7200). S is a quarter-hour epoch (the
    // phone's skyStartFor grid); N = 3 covers [S, S + 2700).
    const int32_t S = 1799086500;   // 1998985 * 900
    const uint8_t on_grid[] = {
        0xA4, 0xE1, 0x3B, 0x6B,     // S as LE uint32
        3, 0, 0, 0, 0, 0, 0, 0x00, 0x00
    };
    assert(radar_sky_count(on_grid, (int)sizeof(on_grid)) == 3);
    assert(radar_sky_start(on_grid) == S);
    const int32_t W = 24 * 300;
    assert(radar_sky_in_window(on_grid, 3, S, W));                   // fully inside
    assert(radar_sky_in_window(on_grid, 3, S + 2400, W));            // last slot at the left edge
    assert(!radar_sky_in_window(on_grid, 3, S + 2700, W));           // slid out: all left of it
    assert(radar_sky_in_window(on_grid, 3, S - W + 300, W));         // first slot at the right edge
    assert(!radar_sky_in_window(on_grid, 3, S - W, W));              // all right of the window
    // The guards, each on a start the overlap alone would accept: a cleared
    // sky (n = 0) leaves the layer's static buffer holding the old start, and
    // a zero-start blob sits inside a radar window that starts at 0.
    assert(!radar_sky_in_window(on_grid, 0, S - 300, W));            // no (or a malformed) sky
    const uint8_t zero_start[] = { 0, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0, 0x00, 0x00 };
    assert(radar_sky_count(zero_start, (int)sizeof(zero_start)) == 3);
    assert(!radar_sky_in_window(zero_start, 3, 0, W));               // radar cleared (start 0)
    // ...and the smallest overlap, 300 s, is one whole pitch on screen.
    assert(radar_sky_x(S + 2700, S + 2400, 0, 6, 300)
           - radar_sky_x(S + 2400, S + 2400, 0, 6, 300) == 6);

    // Span clip: the bolt halo's 3 px cells stay inside the band / slot grid.
    int a = 9, span = 3;                // halo row 9..11, band 10..17
    assert(radar_sky_clip_span(&a, &span, 10, 18) && a == 10 && span == 2);
    a = 16; span = 3;                   // 16..18 against band end 18
    assert(radar_sky_clip_span(&a, &span, 10, 18) && a == 16 && span == 2);
    a = 12; span = 3;                   // inside: untouched
    assert(radar_sky_clip_span(&a, &span, 10, 18) && a == 12 && span == 3);
    a = 7; span = 3;                    // 7..9: wholly above
    assert(!radar_sky_clip_span(&a, &span, 10, 18));
    a = 18; span = 1;                   // wholly past the end
    assert(!radar_sky_clip_span(&a, &span, 10, 18));

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

    // The rows' wire bytes (and a forecast stripe's): the phone picks each
    // cell's level on its own scale and sends these bytes (stripe-levels.js
    // LEVEL_BYTES), which the watch's round-up chart_stripe_level maps back to
    // exactly levels 0..4.
    const int level_bytes[] = { 0, 62, 125, 187, 250 };
    for (int i = 0; i <= CHART_STRIPE_LEVELS; ++i) {
        assert(chart_stripe_level(level_bytes[i], 0, 250) == i);
    }

    // The cell and bolt spans on the audit's two screens, in exact pixels.
    audit_cases(6);
    assert_cell(1799086500 + 900, 0, 10, 1799086500, 6, 0, 36);    // 144 px: leading 15 min
    assert_cell(1799086500, 9, 10, 1799086500 + 3300, 6, 96, 144); // 144 px: trailing 25 min
    assert_bolt(1799086500, 0, 1799086500 + 600, 6, 1);             // 144 px: [0, 6) -> 1..5
    assert_bolt(1799086500, 8, 1799086500 + 300, 6, 139);           // 144 px: [138, 144)
    audit_cases(8);
    assert_cell(1799086500 + 2700, 0, 10, 1799086500, 8, 0, 96);   // 200 px: leading 45 min
    assert_cell(1799086500, 9, 10, 1799086500 + 5100, 8, 80, 192); // 200 px: trailing 55 min
    assert_bolt(1799086500, 0, 1799086500 + 600, 8, 2);             // 200 px: [0, 8) -> 2..6
    assert_bolt(1799086500, 8, 1799086500 + 300, 8, 186);           // 200 px: [184, 192)

    // The bolt's visibility threshold: a visible span of exactly the glyph's
    // width draws it flush, one px less does not.
    int bx = -1;
    assert(radar_sky_bolt_x(-10, 5, 0, 144, &bx) && bx == 0);
    assert(!radar_sky_bolt_x(-10, 4, 0, 144, &bx));
    assert(radar_sky_bolt_x(139, 160, 0, 144, &bx) && bx == 139);
    assert(!radar_sky_bolt_x(140, 160, 0, 144, &bx));
    // A non-zero anchor: the edges are x_min / x_max, never column 0.
    int x0 = -1, x1 = -1;
    assert(radar_sky_cell_span(40, 58, 0, 3, 22, 166, &x0, &x1) && x0 == 22 && x1 == 58);
    assert(radar_sky_cell_span(76, 94, 2, 3, 22, 166, &x0, &x1) && x0 == 76 && x1 == 166);
    assert(radar_sky_bolt_x(10, 28, 22, 166, &bx) && bx == 23);

    printf("radar_sky_test OK\n");
    return 0;
}
