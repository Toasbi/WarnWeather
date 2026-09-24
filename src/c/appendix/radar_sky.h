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
//   [5+N .. 5+2N)    sunshine per slot, 0..250 (share of the slot in sun)
//   [5+2N .. 5+2N+1] lightning bitmask (uint16), bit k = lightning in slot k
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
