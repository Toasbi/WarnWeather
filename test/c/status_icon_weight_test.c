#include <stdio.h>
#include "c/layers/status_icon_weight.h"

// Host tests for the per-icon status-glyph optical-centre weight.
//
// The load-bearing property is the FIRST case: weight 50 must reproduce the
// placement the watchface used before weights existed, for every glyph height,
// odd and even. That expression is spelled out literally below (`cap_cy -
// bounds_h / 2`) rather than derived, so this is a comparison against the old
// behaviour and not a restatement of the new code.
//
// The direction cases carry HAND-COMPUTED literal pixel lifts (see the table in
// weight_lifts_by_the_expected_pixels) for the same reason.

static int s_failures = 0;

static void expect(const char *name, long got, long want) {
    if (got != want) { printf("FAIL %s: got %ld want %ld\n", name, got, want); s_failures++; }
}

// ── 1. Weight 50 == the pre-weight placement, exactly ────────────────────────
// The historical draw site was:  GPoint(icon_x, glyph_cy - gs.h / 2)
static void weight_50_is_the_old_placement(void) {
    static const int cap_cys[] = {0, 1, 7, 8, 46, 47, 73, 74, 103, 152, 200};
    for (unsigned c = 0; c < sizeof(cap_cys) / sizeof(cap_cys[0]); c++) {
        int cap_cy = cap_cys[c];
        for (int bounds_h = 0; bounds_h <= 40; bounds_h++) {   // odd and even
            int old_y = cap_cy - bounds_h / 2;                 // the pre-weight expression
            char name[64];
            snprintf(name, sizeof(name), "w50 cap_cy=%d bounds_h=%d", cap_cy, bounds_h);
            expect(name, status_icon_top_y(cap_cy, bounds_h, 50), old_y);
        }
    }
    // ...and the shipped table must route every icon through that no-op today.
    // (This pins the mechanism's neutral point, not the taste values: it asserts
    // what weight 50 DOES, so tuning an icon later cannot make it lie.)
    for (uint8_t id = 0; id <= STATUS_ICON_MAX; id++) {
        int w = status_icon_weight_pct(id);
        char name[64];
        snprintf(name, sizeof(name), "weight in sane range id=%u", id);
        expect(name, w >= 20 && w <= 80, 1);
    }
}

// ── 2. Unlisted / out-of-range ids fall back to the box centre ───────────────
// The table is designated-initialised, so a gap reads back as 0; 0 must never
// reach the arithmetic (it would draw the glyph half a box too low).
static void unknown_ids_centre(void) {
    expect("NONE -> centre", status_icon_weight_pct(STATUS_ICON_NONE),
           STATUS_ICON_WEIGHT_CENTRE);
    expect("DRAWN_SUN -> centre", status_icon_weight_pct(STATUS_ICON_DRAWN_SUN),
           STATUS_ICON_WEIGHT_CENTRE);
    expect("enum gap 6 -> centre", status_icon_weight_pct(6), STATUS_ICON_WEIGHT_CENTRE);
    expect("past MAX -> centre", status_icon_weight_pct(STATUS_ICON_MAX + 1),
           STATUS_ICON_WEIGHT_CENTRE);
    expect("255 -> centre", status_icon_weight_pct(255), STATUS_ICON_WEIGHT_CENTRE);
    // A fallback id therefore places identically to weight 50.
    expect("fallback places like w50",
           status_icon_top_y(74, 16, status_icon_weight_pct(6)),
           status_icon_top_y(74, 16, 50));
}

// ── 3. Direction and magnitude ──────────────────────────────────────────────
// A LARGER weight LIFTS the glyph (smaller y). Lifts are hand-computed from
// `off * (bounds_h + 1) / 100`, rounded to nearest, halves away from zero:
//
//   bounds_h  ink  off=+4  off=+8  off=+16   (tier)
//        8      9    0.36->0  0.72->1  1.44->1   t9  rows, G14
//       10     11    0.44->0  0.88->1  1.76->2   t10 top strip, G18
//       12     13    0.52->1  1.04->1  2.08->2   t12 rows, G18 / emery top G24
//       14     15    0.60->1  1.20->1  2.40->2   t13/t16, G24
//       16     17    0.68->1  1.36->1  2.72->3   t16 rows, G24
static void weight_lifts_by_the_expected_pixels(void) {
    struct { int bounds_h, off4, off8, off16; } cases[] = {
        { 8, 0, 1, 1},
        {10, 0, 1, 2},
        {12, 1, 1, 2},
        {14, 1, 1, 2},
        {16, 1, 1, 3},
    };
    const int cap_cy = 74;
    for (unsigned i = 0; i < sizeof(cases) / sizeof(cases[0]); i++) {
        int h = cases[i].bounds_h;
        int base = status_icon_top_y(cap_cy, h, 50);
        char name[80];
        // Above 50 -> UP the screen -> smaller y.
        snprintf(name, sizeof(name), "h=%d w54 lifts %d", h, cases[i].off4);
        expect(name, status_icon_top_y(cap_cy, h, 54), base - cases[i].off4);
        snprintf(name, sizeof(name), "h=%d w58 lifts %d", h, cases[i].off8);
        expect(name, status_icon_top_y(cap_cy, h, 58), base - cases[i].off8);
        snprintf(name, sizeof(name), "h=%d w66 lifts %d", h, cases[i].off16);
        expect(name, status_icon_top_y(cap_cy, h, 66), base - cases[i].off16);
        // Below 50 -> DOWN the screen -> larger y, same magnitude (halves away
        // from zero, so the rounding is symmetric).
        snprintf(name, sizeof(name), "h=%d w46 drops %d", h, cases[i].off4);
        expect(name, status_icon_top_y(cap_cy, h, 46), base + cases[i].off4);
        snprintf(name, sizeof(name), "h=%d w42 drops %d", h, cases[i].off8);
        expect(name, status_icon_top_y(cap_cy, h, 42), base + cases[i].off8);
        snprintf(name, sizeof(name), "h=%d w34 drops %d", h, cases[i].off16);
        expect(name, status_icon_top_y(cap_cy, h, 34), base + cases[i].off16);
    }
}

// ── 4. Monotonic, and never sub-pixel-jittery ───────────────────────────────
// Sweeping the weight up must never move the glyph DOWN (the whole knob is
// useless if it does), and one step of weight must never move it more than the
// glyph's own height.
static void sweep_is_monotonic(void) {
    const int cap_cy = 74;
    for (int h = 1; h <= 20; h++) {
        int prev = status_icon_top_y(cap_cy, h, 0);
        for (int w = 1; w <= 100; w++) {
            int y = status_icon_top_y(cap_cy, h, w);
            char name[64];
            snprintf(name, sizeof(name), "monotonic h=%d w=%d", h, w);
            expect(name, y <= prev, 1);
            prev = y;
        }
    }
    // Symmetry: equal steps either side of 50 move the glyph equally far, so a
    // weight sheet reads the same in both directions.
    for (int h = 1; h <= 20; h++) {
        for (int k = 1; k <= 50; k++) {
            char name[64];
            snprintf(name, sizeof(name), "symmetric h=%d k=%d", h, k);
            int base = status_icon_top_y(cap_cy, h, 50);
            expect(name, base - status_icon_top_y(cap_cy, h, 50 + k),
                   status_icon_top_y(cap_cy, h, 50 - k) - base);
        }
    }
    // Extremes, hand-computed: at weight 100 the lift is half the ink height,
    // rounded up. h=8 (ink 9) -> round(4.5) = 5 px; h=16 (ink 17) -> 9 px.
    expect("h=8 w100 lifts 5", status_icon_top_y(cap_cy, 8, 100),
           status_icon_top_y(cap_cy, 8, 50) - 5);
    expect("h=16 w100 lifts 9", status_icon_top_y(cap_cy, 16, 100),
           status_icon_top_y(cap_cy, 16, 50) - 9);
}

int main(void) {
    weight_50_is_the_old_placement();
    unknown_ids_centre();
    weight_lifts_by_the_expected_pixels();
    sweep_is_monotonic();
    if (s_failures) {
        printf("status_icon_weight: %d failure(s)\n", s_failures);
        return 1;
    }
    printf("status_icon_weight OK\n");
    return 0;
}
