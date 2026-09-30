#pragma once
// The radar's sky rows (clouds, sun, lightning) — the RADAR_SKY_UINT8 blob the
// phone packs (src/pkjs/weather/radar-sky.js packSky) and the watch persists
// verbatim. Header-only and SDK-free, so the host suite pins the decode
// (test/c/radar_sky_test.c, the chart_stripe.h pattern).
//
// Layout, all little-endian:
//   [0..3]           start epoch of slot 0 (uint32), a quarter-hour boundary
//   [4]              N, the slot count (1..RADAR_SKY_MAX_SLOTS)
//   [5 .. 5+N)       cloud cover per slot, 0..250 (the stripe wire scale)
//   [5+N .. 5+2N)    sun strength per slot, 0..250 (share of clear-sky sun)
//   [5+2N .. 5+2N+1] lightning bitmask (uint16), bit k = lightning in slot k
// The phone sends both rows already rounded to the nearest stripe level (bytes
// 0/62/125/187/250, which chart_stripe_level maps back to levels 0..4), so the
// watch reads them on the plain 0..250 scale.
// Slot k covers [start + k * RADAR_SKY_SLOT_SECONDS, + RADAR_SKY_SLOT_SECONDS).
// The start is absolute (not relative to RAIN_RADAR_START), because the radar
// category can be deduped out of a send while the sky changes, and because the
// watch self-advances the radar window between fetches: the rows are placed by
// time against whatever radar start is persisted.
#include <stdbool.h>
#include <stdint.h>

#define RADAR_SKY_SLOT_SECONDS 900
#define RADAR_SKY_MAX_SLOTS    16
#define RADAR_SKY_HEADER_BYTES 5
#define RADAR_SKY_MAX_BYTES    (RADAR_SKY_HEADER_BYTES + 2 * RADAR_SKY_MAX_SLOTS + 2)

// The slot count a well-formed blob of `len` bytes carries, or 0 when the blob
// is malformed (too short, N out of range, or a length that disagrees with N).
static inline int radar_sky_count(const uint8_t *b, int len) {
    if (!b || len < RADAR_SKY_HEADER_BYTES) { return 0; }
    const int n = b[4];
    if (n < 1 || n > RADAR_SKY_MAX_SLOTS) { return 0; }
    return (len == RADAR_SKY_HEADER_BYTES + 2 * n + 2) ? n : 0;
}

static inline int32_t radar_sky_start(const uint8_t *b) {
    return (int32_t)((uint32_t)b[0] | ((uint32_t)b[1] << 8)
                   | ((uint32_t)b[2] << 16) | ((uint32_t)b[3] << 24));
}

static inline int radar_sky_cloud(const uint8_t *b, int k) {
    return b[RADAR_SKY_HEADER_BYTES + k];
}

static inline int radar_sky_sun(const uint8_t *b, int k) {
    return b[RADAR_SKY_HEADER_BYTES + b[4] + k];
}

static inline bool radar_sky_lightning(const uint8_t *b, int k) {
    const int at = RADAR_SKY_HEADER_BYTES + 2 * b[4];
    const unsigned mask = (unsigned)b[at] | ((unsigned)b[at + 1] << 8);
    return ((mask >> k) & 1u) != 0;
}

// Plot x of an absolute time on the radar's slot grid: `anchor` is the x of
// radar slot 0 (radar_start), `pitch` the px per 5-min radar slot. Linear in
// time, so a 15-min sky slot spans three radar columns wherever it falls.
static inline int radar_sky_x(int32_t t, int32_t radar_start, int anchor, int pitch,
                              int radar_slot_seconds) {
    return anchor + (int)((t - radar_start) * pitch / radar_slot_seconds);
}

// Whether any of the blob's `n` slots (radar_sky_count) overlaps the received
// radar window [radar_start, radar_start + window_seconds). The layer reserves
// and draws the sky band only then: a cleared radar (start 0) or a sky the
// self-advancing window has left behind keeps the plain radar. A time overlap
// is exact here: sky slots sit on the 900 s grid and the radar start on the
// 300 s one, so any overlap is >= 300 s — at least one pitch of pixels.
static inline bool radar_sky_in_window(const uint8_t *b, int n, int32_t radar_start,
                                       int32_t window_seconds) {
    if (n <= 0 || radar_start <= 0) { return false; }
    const int32_t start = radar_sky_start(b);
    return start < radar_start + window_seconds
        && start + n * RADAR_SKY_SLOT_SECONDS > radar_start;
}

// The cloud/sun cell span [*x0, *x1) of sky slot k of n inside the radar
// window's columns [x_min, x_max); false when nothing of it is left. xa and xb
// are the slot's unclamped start and end x (radar_sky_x). Two edges would
// otherwise leave a blank run, which on screen is pixel-identical to "clear
// sky, no sun" and so tells the wrong story:
//  - a leading gap, when the sky starts after the watch's radar start (the
//    radar was deduped out of a send, re-served or cleared while the sky came
//    through): slot 0 reaches LEFT to x_min;
//  - a trailing gap, when the watch has self-advanced its radar window past
//    the sky's last slot (a missed fetch): that slot persists RIGHT to x_max.
// An edge is only extended while it lies inside the window, the pixel form of
// radar_sky_in_window: the layer draws the band only while the sky overlaps
// the window, and a sky wholly outside it must not be stretched across it
// here either. Only cells extend, never bolts (radar_sky_bolt_x): cloud and
// sun change slowly, so the nearest quarter hour is a fair stand-in for the
// uncovered minutes, but a bolt marks a storm expected in one particular
// quarter hour, and repeating it would claim storms nobody forecast.
static inline bool radar_sky_cell_span(int xa, int xb, int k, int n, int x_min, int x_max,
                                       int *x0, int *x1) {
    if (k == 0 && xa > x_min && xa < x_max) { xa = x_min; }
    if (k == n - 1 && xb < x_max && xb > x_min) { xb = x_max; }
    *x0 = xa < x_min ? x_min : xa;
    *x1 = xb > x_max ? x_max : xb;
    return *x1 > *x0;
}

// Clip the span [*a, *a + *len) to [lo, hi) in place; false when nothing is
// left. The bolt's halo reaches one px past the glyph on every side, which on
// the 3 px stripes is one row above the band, into the axis tick row.
static inline bool radar_sky_clip_span(int *a, int *len, int lo, int hi) {
    int end = *a + *len;
    if (*a < lo) { *a = lo; }
    if (end > hi) { end = hi; }
    *len = end - *a;
    return *len > 0;
}

// The lightning bolt glyph, 5 px wide x 7 tall: one row mask per row, bit 4 =
// the leftmost column. A zig-zag from top-right to bottom-left.
#define RADAR_BOLT_W 5
#define RADAR_BOLT_H 7
static inline uint8_t radar_bolt_row(int row) {
    static const uint8_t ROWS[RADAR_BOLT_H] = { 0x03, 0x06, 0x0C, 0x1F, 0x06, 0x0C, 0x18 };
    return (row >= 0 && row < RADAR_BOLT_H) ? ROWS[row] : 0;
}
static inline bool radar_bolt_on(int x, int y) {
    return x >= 0 && x < RADAR_BOLT_W && ((radar_bolt_row(y) >> (RADAR_BOLT_W - 1 - x)) & 1u);
}

// The glyph's left x for a bolt in the slot spanning [xa, xb) (unclamped, as
// radar_sky_x gives it), centred on the part of that span visible in
// [x_min, x_max); false when the visible part is narrower than the glyph. The
// span is clamped FIRST: centred on the whole slot, the bolt of a partly
// visible edge slot (slot 0 with the radar start 10 min into the quarter hour,
// the last slot with it 5 min in) lands past the window's edge and would be
// dropped, although one visible pitch (6 or 8 px) holds the 5 px glyph. A fully
// visible slot centres exactly where it always did. The span is never extended
// the way radar_sky_cell_span extends a cell (see there for why). The halo
// reaches one px past the glyph; the caller clips it to the band and the grid.
static inline bool radar_sky_bolt_x(int xa, int xb, int x_min, int x_max, int *bx) {
    if (xa < x_min) { xa = x_min; }
    if (xb > x_max) { xb = x_max; }
    if (xb - xa < RADAR_BOLT_W) { return false; }
    *bx = xa + (xb - xa) / 2 - RADAR_BOLT_W / 2;
    return true;
}
