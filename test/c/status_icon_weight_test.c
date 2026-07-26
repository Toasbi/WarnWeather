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

// ── 5. The shipped taste values, and the pixel lifts they buy ───────────────
// The weights in status_icon_weight.h are what a human judged on device from the
// per-tier comparison sheets. This case pins them so that editing one fails
// loudly, in two independent halves:
//
//   5a  the table read-back for THIS platform's build (guarded like the table);
//   5b  the FULL (icon x tier) -> pixel-lift matrix, for BOTH platforms' values,
//       since the arithmetic itself has no platform dependence — so the plain
//       build checks emery's numbers too. Every lift is hand-computed from
//       round(off * ink / 100), halves away from zero, and written out in the
//       comment beside it.
//
// The ink height per (icon, tier) is DEVICE-MEASURED — see the table in
// status_icon_weight.h and .superpowers/sdd/icon-weight-remaining-report.md §1 —
// and `bounds_h` is that ink height minus 1 (icon_load() paints one row more than
// the bounds box). The four ink figures still carried over from
// icon-centring-analysis.md rather than re-measured are AQI@t13, HR@t10 and
// STEPS/AQI@t10; all four belong to icons at weight 50 on that platform, where the
// lift is 0 for any ink whatsoever, so nothing here rides on them.
static void shipped_weights_are_the_judged_ones(void) {
    // 5a — this build's table.
    struct { uint8_t id; int want; const char *name; } table[] = {
#ifdef PBL_PLATFORM_EMERY
        {STATUS_ICON_TEMP, 50, "emery TEMP"},
        {STATUS_ICON_UV, 53, "emery UV"},
        {STATUS_ICON_WIND, 60, "emery WIND"},
        {STATUS_ICON_GUST, 53, "emery GUST"},
        {STATUS_ICON_STEPS, 54, "emery STEPS"},
        {STATUS_ICON_SLEEP, 50, "emery SLEEP"},
        {STATUS_ICON_HR, 56, "emery HR"},
        {STATUS_ICON_DISTANCE, 53, "emery DISTANCE"},
        {STATUS_ICON_AQI, 50, "emery AQI"},
        {STATUS_ICON_POLLEN, 56, "emery POLLEN"},
        {STATUS_ICON_COUNTDOWN, 59, "emery COUNTDOWN"},
#else
        {STATUS_ICON_TEMP, 50, "basalt TEMP"},
        {STATUS_ICON_UV, 50, "basalt UV"},
        {STATUS_ICON_WIND, 54, "basalt WIND"},
        {STATUS_ICON_GUST, 54, "basalt GUST"},
        {STATUS_ICON_STEPS, 50, "basalt STEPS"},
        {STATUS_ICON_SLEEP, 50, "basalt SLEEP"},
        {STATUS_ICON_HR, 50, "basalt HR"},
        {STATUS_ICON_DISTANCE, 50, "basalt DISTANCE"},
        {STATUS_ICON_AQI, 50, "basalt AQI"},
        {STATUS_ICON_POLLEN, 54, "basalt POLLEN"},
        {STATUS_ICON_COUNTDOWN, 58, "basalt COUNTDOWN"},
#endif
    };
    for (unsigned i = 0; i < sizeof(table) / sizeof(table[0]); i++) {
        expect(table[i].name, status_icon_weight_pct(table[i].id), table[i].want);
    }

    // 5b — every icon at every tier its platform ships, both platforms. Positive
    // want_lift = the glyph moves UP. `ink` is the measured painted height, so the
    // bounds_h handed to the arithmetic is ink - 1.
    //
    // Tiers, in column order: basalt/diorite/flint = t9 (FULL rows) / t10 (top
    // strip) / t12 (COMPACT + NONE rows); emery = t12 (FULL rows) / t13 (top strip)
    // / t16 (COMPACT + NONE rows). A cell marked "(unjudged)" is a tier the user
    // never saw on a comparison sheet — it is asserted so a future edit cannot
    // change it silently, not because it was chosen.
    struct { const char *cell; int weight, ink, want_lift; } cells[] = {
        // ── basalt / diorite / flint ────────────────────────────────────────
        {"b TEMP w50 t9",       50,  9, 0},
        {"b TEMP w50 t10",      50, 11, 0},
        {"b TEMP w50 t12",      50, 13, 0},
        {"b UV w50 t9",         50,  9, 0},
        {"b UV w50 t10",        50, 11, 0},
        {"b UV w50 t12",        50, 13, 0},
        {"b WIND w54 t9",       54,  9, 0},   //  4*9  = 36  -> 0
        {"b WIND w54 t10",      54, 11, 0},   //  4*11 = 44  -> 0  (unjudged)
        {"b WIND w54 t12",      54, 13, 1},   //  4*13 = 52  -> 1
        {"b GUST w54 t9",       54,  9, 0},   //  4*9  = 36  -> 0
        {"b GUST w54 t10",      54, 11, 0},   //  4*11 = 44  -> 0  (unjudged)
        {"b GUST w54 t12",      54, 13, 1},   //  4*13 = 52  -> 1
        {"b STEPS w50 t9",      50,  9, 0},
        {"b STEPS w50 t10",     50,  9, 0},
        {"b STEPS w50 t12",     50, 11, 0},
        {"b SLEEP w50 t9",      50, 11, 0},
        {"b SLEEP w50 t10",     50, 11, 0},
        {"b SLEEP w50 t12",     50, 13, 0},
        {"b HR w50 t9",         50, 11, 0},
        {"b HR w50 t12",        50, 13, 0},
        {"b DISTANCE w50 t9",   50,  9, 0},
        {"b DISTANCE w50 t10",  50, 11, 0},
        {"b DISTANCE w50 t12",  50, 13, 0},
        {"b AQI w50 t9",        50,  9, 0},
        {"b AQI w50 t10",       50,  9, 0},
        {"b AQI w50 t12",       50, 11, 0},
        {"b POLLEN w54 t9",     54, 11, 0},   //  4*11 = 44  -> 0
        {"b POLLEN w54 t10",    54, 11, 0},   //  4*11 = 44  -> 0  (unjudged)
        {"b POLLEN w54 t12",    54, 13, 1},   //  4*13 = 52  -> 1
        {"b COUNTDOWN w58 t9",  58, 11, 1},   //  8*11 = 88  -> 1
        {"b COUNTDOWN w58 t10", 58, 11, 1},   //  8*11 = 88  -> 1  (unjudged, forced:
                                              //  t9 and t10 share ink 11)
        {"b COUNTDOWN w58 t12", 58, 13, 1},   //  8*13 = 104 -> 1
        // ── emery ───────────────────────────────────────────────────────────
        {"e TEMP w50 t12",      50, 13, 0},   //  the one cell a single weight cannot
        {"e TEMP w50 t13",      50, 13, 0},   //  express (0 at ink 13 AND 1 at ink
        {"e TEMP w50 t16",      50, 15, 0},   //  15) — left at the no-op on purpose
        {"e UV w53 t12",        53, 13, 0},   //  3*13 = 39  -> 0  (unjudged)
        {"e UV w53 t13",        53, 13, 0},   //  3*13 = 39  -> 0
        {"e UV w53 t16",        53, 17, 1},   //  3*17 = 51  -> 1
        {"e WIND w60 t12",      60, 13, 1},   // 10*13 = 130 -> 1  (unjudged, forced:
                                              //  t12 and t13 share ink 13)
        {"e WIND w60 t13",      60, 13, 1},   // 10*13 = 130 -> 1
        {"e WIND w60 t16",      60, 17, 2},   // 10*17 = 170 -> 2
        {"e GUST w53 t12",      53, 13, 0},   //  3*13 = 39  -> 0  (unjudged)
        {"e GUST w53 t13",      53, 13, 0},   //  3*13 = 39  -> 0
        {"e GUST w53 t16",      53, 17, 1},   //  3*17 = 51  -> 1
        {"e STEPS w54 t12",     54, 11, 0},   //  4*11 = 44  -> 0  (unjudged)
        {"e STEPS w54 t13",     54, 11, 0},   //  4*11 = 44  -> 0
        {"e STEPS w54 t16",     54, 13, 1},   //  4*13 = 52  -> 1
        {"e SLEEP w50 t12",     50, 13, 0},
        {"e SLEEP w50 t13",     50, 15, 0},
        {"e SLEEP w50 t16",     50, 17, 0},
        {"e HR w56 t12",        56, 13, 1},   //  6*13 = 78  -> 1  (unjudged)
        {"e HR w56 t13",        56, 15, 1},   //  6*15 = 90  -> 1
        {"e HR w56 t16",        56, 17, 1},   //  6*17 = 102 -> 1
        {"e DISTANCE w53 t12",  53, 13, 0},   //  3*13 = 39  -> 0  (unjudged)
        {"e DISTANCE w53 t13",  53, 13, 0},   //  3*13 = 39  -> 0
        {"e DISTANCE w53 t16",  53, 17, 1},   //  3*17 = 51  -> 1
        {"e AQI w50 t12",       50, 11, 0},
        {"e AQI w50 t13",       50, 13, 0},
        {"e AQI w50 t16",       50, 15, 0},
        {"e POLLEN w56 t12",    56, 13, 1},   //  6*13 = 78  -> 1  (unjudged)
        {"e POLLEN w56 t13",    56, 15, 1},   //  6*15 = 90  -> 1
        {"e POLLEN w56 t16",    56, 17, 1},   //  6*17 = 102 -> 1
        {"e COUNTDOWN w59 t12", 59, 13, 1},   //  9*13 = 117 -> 1  (unjudged, forced:
                                              //  t16's 2 px needs off >= 9)
        {"e COUNTDOWN w59 t13", 59, 15, 1},   //  9*15 = 135 -> 1
        {"e COUNTDOWN w59 t16", 59, 17, 2},   //  9*17 = 153 -> 2
        // ── the neutral point, at every shipped ink height ───────────────────
        {"w50 ink 9",  50,  9, 0},
        {"w50 ink 11", 50, 11, 0},
        {"w50 ink 13", 50, 13, 0},
        {"w50 ink 15", 50, 15, 0},
        {"w50 ink 17", 50, 17, 0},
    };
    const int cap_cy = 74;
    for (unsigned i = 0; i < sizeof(cells) / sizeof(cells[0]); i++) {
        int h = cells[i].ink - 1;                 // bounds_h; icon_load() paints ink
        expect(cells[i].cell, status_icon_top_y(cap_cy, h, cells[i].weight),
               status_icon_top_y(cap_cy, h, 50) - cells[i].want_lift);
        // No shipped weight may ask for a >=2 px lift on this branch of the table
        // beyond the two that were device-checked; +-3 px is NOT clip-verified, so
        // guard the ceiling here rather than discovering it on a watch.
        char name[96];
        snprintf(name, sizeof(name), "%s lift <= 2 px", cells[i].cell);
        expect(name, cells[i].want_lift <= 2 && cells[i].want_lift >= -2, 1);
    }

    // 5c — the shipped table can only ask for lifts inside the device-verified
    // +-2 px envelope, at every ink height its platform renders. Computed from the
    // table rather than listed, so a new icon or a bumped weight is caught too.
#ifdef PBL_PLATFORM_EMERY
    static const int inks[] = {11, 13, 15, 17};        // emery: t12/t13/t16 glyphs
#else
    static const int inks[] = {9, 11, 13};             // basalt et al: t9/t10/t12
#endif
    for (uint8_t id = 0; id <= STATUS_ICON_MAX; id++) {
        int w = status_icon_weight_pct(id);
        for (unsigned k = 0; k < sizeof(inks) / sizeof(inks[0]); k++) {
            int h = inks[k] - 1;
            int lift = status_icon_top_y(74, h, 50) - status_icon_top_y(74, h, w);
            char name[96];
            snprintf(name, sizeof(name), "id=%u ink=%d lift within +-2", id, inks[k]);
            expect(name, lift >= -2 && lift <= 2, 1);
        }
    }
}

int main(void) {
    weight_50_is_the_old_placement();
    unknown_ids_centre();
    weight_lifts_by_the_expected_pixels();
    sweep_is_monotonic();
    shipped_weights_are_the_judged_ones();
    if (s_failures) {
        printf("status_icon_weight: %d failure(s)\n", s_failures);
        return 1;
    }
    printf("status_icon_weight OK\n");
    return 0;
}
