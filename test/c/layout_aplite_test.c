// Host golden-rect tests for the aplite lean twin src/c/windows/layout_aplite.c.
// Built with -DPBL_PLATFORM_APLITE and WITHOUT PBL_HEALTH / WW_QUICK_VIEW / WW_VIEW_CYCLE,
// exactly as the aplite platform build compiles it. Goldens equal the non-dual forecast
// cases in layout_test.c (144x168, fc_band_h 20), proving behavior parity on aplite.
#include <stdio.h>
#include <string.h>
#include "c/layers/status_metrics.h"
#include "c/windows/layout.h"

static int s_failures = 0;

static void check(const char *name, GRect got, int x, int y, int w, int h) {
    if (got.origin.x != x || got.origin.y != y || got.size.w != w || got.size.h != h) {
        printf("FAIL %s: got (%d,%d,%d,%d) want (%d,%d,%d,%d)\n", name,
               got.origin.x, got.origin.y, got.size.w, got.size.h, x, y, w, h);
        s_failures++;
    }
}
static void expect(const char *name, bool got, bool want) {
    if (got != want) { printf("FAIL %s: got %d want %d\n", name, got, want); s_failures++; }
}

#define BOUNDS GRect(0, 0, 144, 168)
#define FC_BAND_H 20

// Pack a 10-bit wire value, mirroring view-cycle.js packSpec():
// tier<<8 | top<<6 | body<<4 | statusUpper<<2 | statusLower.
static uint16_t pack(int tier, int top, int body, int su, int sl) {
    return (uint16_t)(((tier & 3) << 8) | ((top & 3) << 6) | ((body & 3) << 4)
                    | ((su & 3) << 2) | (sl & 3));
}

// Build a ViewSpec from a wire value via the twin's unpack, as the watch does.
static MainLayout compute(uint8_t wire_tier, int su, int sl) {
    ViewSpec spec = view_spec_unpack(pack(wire_tier, 1, 0, su, sl));
    return layout_compute_spec(BOUNDS, &spec, FC_BAND_H);
}

static void golden_rects(void) {
    MainLayout L;
    // FULL (wire tier 3), forecast status in the upper band
    L = compute(3, STATUS_SRC_FORECAST, STATUS_SRC_NONE);
    // top_status 17 = status_min_band_h(Gothic 18), the shortest clamp-free strip band; the
    // calendar follows the strip's INK at y=15 (status_strip_ink_h == 17 -
    // STATUS_TOP_STRIP_LIFT) and keeps its 45px / 3 rows, so the px come out of the
    // calendar->clock gap. Clock, status band and forecast anchor to CALENDAR_STATUS_HEIGHT and
    // are unchanged. Same numbers as layout_test.c's non-emery goldens — aplite has the same
    // 144x168 geometry and Gothic 18 strip/calendar/compact-status fonts, so it had the same
    // crowded compact calendar->status gap and takes the same derived fix.
    check("full.top_status",   L.top_status,   0, 0, 144, 17);
    check("full.top",          L.top,          0, 15, 144, 45);
    check("full.status",       L.status,       0, 97, 144, 20);
    check("full.status_lower", L.status_lower, 0, 97, 144, 20);
    check("full.time",         L.time,         0, 58, 144, 45);
    check("full.bottom",       L.bottom,       0, 117, 144, 51);
    check("full.loading",      L.loading,      0, 97, 144, 71);

    // COMPACT (wire tier 2), forecast status in the upper band
    L = compute(2, STATUS_SRC_FORECAST, STATUS_SRC_NONE);
    check("compact.top",       L.top,          0, 15, 144, 30);
    // Lone status: 17 instead of the calendar_h/3 slot's 15, bottom-anchored 3px into the clock
    // band (58 + 3 - 17). Its bottom row stays 60, so the seated line does not move.
    check("compact.status",    L.status,       0, 44, 144, 17);
    check("compact.time",      L.time,         0, 58, 144, 45);
    check("compact.bottom",    L.bottom,       0, 103, 144, 65);
    check("compact.loading",   L.loading,      0, 103, 144, 65);

    // NONE (wire tier 1), forecast status in the upper band
    L = compute(1, STATUS_SRC_FORECAST, STATUS_SRC_NONE);
    check("none.top",          L.top,          0, 15, 144, 0);
    check("none.time",         L.time,         0, 16, 144, 45);
    check("none.status",       L.status,       0, 59, 144, 22);
    check("none.bottom",       L.bottom,       0, 81, 144, 87);
    check("none.loading",      L.loading,      0, 81, 144, 87);
}

static void downgrade_tests(void) {
    // A dual health-upper + forecast-lower view reaching the aplite twin (it shouldn't in
    // practice — the swap toggle is hidden on aplite): health folds to NONE, and the surviving
    // forecast collapses to the SINGLE upper band (no lower band on aplite). Body stays forecast.
    ViewSpec r = view_spec_resolve(view_spec_unpack(pack(2, 1, 0, STATUS_SRC_HEALTH, STATUS_SRC_FORECAST)),
                                   false, false);
    expect("dual.collapses_to_upper_forecast", r.status_upper == STATUS_SRC_FORECAST, true);
    expect("dual.no_lower_band", r.status_lower == STATUS_SRC_NONE, true);
    expect("dual.body_forecast", r.body == BODY_FORECAST, true);
    // A none-tier health-graph body + health status row -> forecast body, no status.
    r = view_spec_resolve(view_spec_unpack(pack(1, 0, 1, STATUS_SRC_HEALTH, STATUS_SRC_NONE)), false, false);
    expect("graph.body_forecast", r.body == BODY_FORECAST, true);
    expect("graph.health_status_dropped", r.status_upper == STATUS_SRC_NONE, true);
    // Visibility: forecast on, calendar tracks rows, radar/health off.
    ViewSpec full = view_spec_unpack(pack(3, 1, 0, STATUS_SRC_FORECAST, STATUS_SRC_NONE));
    LayerVisibility v = layout_visibility(&full);
    expect("vis.forecast", v.forecast, true);
    expect("vis.calendar", v.calendar, true);
    expect("vis.radar", v.radar, false);
    expect("vis.radar_status", v.radar_status, false);
    expect("vis.health_status", v.health_status, false);
    ViewSpec none = view_spec_unpack(pack(1, 0, 0, STATUS_SRC_FORECAST, STATUS_SRC_NONE));
    expect("vis.none.calendar_off", layout_visibility(&none).calendar, false);
}

// aplite is forecast-UPPER-only: a forecast arriving in the lower wire slot (which the phone
// no promotion). A colour watch's dual/dense reaching aplite (upper = health/radar, dropped)
// collapses its forecast to this same upper band — not an unrequested swap.
static void geometry_upper_only(void) {
    ViewSpec s = view_spec_unpack(pack(2, 1, 0, STATUS_SRC_FORECAST, STATUS_SRC_NONE));
    MainLayout L = layout_compute_spec(BOUNDS, &s, FC_BAND_H);
    check("upper_only.status",       L.status,       0, 44, 144, 17);   // == compact upper band
    check("upper_only.status_lower", L.status_lower, 0, 44, 144, 17);   // mirrors status (no carve)
    check("upper_only.bottom",       L.bottom,       0, 103, 144, 65);  // == compact bottom (no lower carve)
    expect("upper_only.weather_status_on", layout_visibility(&s).weather_status, true);
    expect("upper_only.tier_compact", s.status_tier == LAYOUT_TIER_COMPACT, true);   // no promotion
    // A colour-watch dual/dense (health upper + forecast lower) synced to aplite collapses its
    // forecast to the upper slot — NOT a swap (upper slot was occupied on the source watch).
    ViewSpec dense = view_spec_unpack(pack(2, 1, 0, STATUS_SRC_HEALTH, STATUS_SRC_FORECAST));
    expect("upper_only.dense_collapses_upper", dense.status_upper == STATUS_SRC_FORECAST, true);
    expect("upper_only.dense_no_lower", dense.status_lower == STATUS_SRC_NONE, true);
}

// Swap layout on aplite (compactCal + swapClockStatus, upper slot empty): the lone forecast
// moves below the clock at the SAME size as the upper slot (a true position swap), and the clock
// reclaims the freed 3rd-calendar-row. aplite's only lower-band case (no radar/health/dual).
static void geometry_swap(void) {
    ViewSpec up = view_spec_unpack(pack(2, 1, 0, STATUS_SRC_FORECAST, STATUS_SRC_NONE));  // upper ref
    MainLayout Lu = layout_compute_spec(BOUNDS, &up, FC_BAND_H);
    ViewSpec s = view_spec_unpack(pack(2, 1, 0, STATUS_SRC_NONE, STATUS_SRC_FORECAST));   // swap
    MainLayout L = layout_compute_spec(BOUNDS, &s, FC_BAND_H);
    expect("swap.lower_forecast", s.status_lower == STATUS_SRC_FORECAST, true);
    expect("swap.upper_none", s.status_upper == STATUS_SRC_NONE, true);
    expect("swap.upper_collapsed", L.status.size.h == 0, true);
    expect("swap.same_band_height_as_upper", L.status_lower.size.h == Lu.status.size.h, true);
    int freed_row = Lu.top.size.h / 2;   // 2-row compact calendar -> one row is cal_h/2
    // The band is carved from a freed_row-sized slot at the top of the bottom band, but the
    // clamp-free band is taller, so its surplus grows UPWARD into the clock band's blank bottom
    // margin — the seated line and the forecast keep exactly the pixels they had.
    expect("swap.below_clock_top", L.status_lower.origin.y > L.time.origin.y, true);
    expect("swap.overhangs_clock_slack",
           (L.time.origin.y + L.time.size.h) - L.status_lower.origin.y
               == L.status_lower.size.h - freed_row, true);
    // The clock reclaims the freed 3rd-calendar-row: exactly one calendar row higher than in the
    // un-swapped view (no longer "abuts L.top's bottom" — the calendar band slides down under
    // the font-sized strip while the clock stays anchored to the strip's reserve).
    expect("swap.clock_reclaims_freed_row", L.time.origin.y == Lu.time.origin.y - freed_row, true);
    expect("swap.tier_compact", s.status_tier == LAYOUT_TIER_COMPACT, true);
    expect("swap.weather_status_on", layout_visibility(&s).weather_status, true);
}

// The seating invariant, aplite's own bands: status_seat_y() must not CLAMP on any band the
// twin produces, or the row is lifted off the band centre and reads high (see the same test in
// layout_test.c). aplite's status rows are Gothic 18 at the top/compact/none tiers and Gothic 14
// at the full tier (status_row_aplite.c row_font); a Gothic content height IS the nominal size.
#define TOP_ROW_H 18
#define FULL_ROW_H 14
#define COMPACT_ROW_H 18
#define NONE_ROW_H 18
#define FC_BAND_H_SHIPPING (FULL_ROW_H + 2 * 3)   // status_forecast_band_h: content + 2*clearance

static void expect_no_lift(const char *view, const char *band, int band_h, int content_h) {
    if (band_h <= 0) { return; }
    int cap_cy = status_glyph_center_y(status_seat_y(band_h, content_h), content_h);
    if (cap_cy != band_h / 2) {
        printf("FAIL seating %s.%s: band_h %d, font %d -> cap centre %d, band centre %d"
               " (shortest clamp-free band is %d)\n",
               view, band, band_h, content_h, cap_cy, band_h / 2,
               status_min_band_h(content_h));
        s_failures++;
    }
}

// The top strip is the one line deliberately NOT cap-centred, so expect_no_lift() is the wrong
// predicate for it (ported from layout_test.c, where the reasoning lives): its band stays
// clamp-free — which is what keeps every band below it from moving, and what puts the strip's
// ink end exactly STATUS_TOP_STRIP_LIFT rows above its band bottom, where calendar_y anchors
// (status_strip_ink_h) — while its CONTENT seats STATUS_TOP_STRIP_LIFT rows higher inside that
// band, because the strip's top edge IS the screen's top edge and only the gap below it reads.
static void expect_strip_lift(const char *view, int band_h, int content_h) {
    int free_h = status_min_band_h(content_h);
    if (band_h != free_h) {
        printf("FAIL seating %s.top_status: band_h %d, expected the clamp-free %d"
               " (the strip lifts its CONTENT, it must not resize its band)\n",
               view, band_h, free_h);
        s_failures++;
        return;
    }
    int seat = status_strip_seat_y(band_h, content_h);
    int cap = status_glyph_center_y(seat, content_h);
    if (cap != band_h / 2 - STATUS_TOP_STRIP_LIFT) {
        printf("FAIL seating %s.top_status: cap centre %d, expected %d (band centre %d - %d)\n",
               view, cap, band_h / 2 - STATUS_TOP_STRIP_LIFT, band_h / 2,
               STATUS_TOP_STRIP_LIFT);
        s_failures++;
    }
    int tails = seat + content_h + status_descender_h(content_h);
    if (tails > band_h) {
        printf("FAIL seating %s.top_status: tails reach %d, past the %d band\n",
               view, tails, band_h);
        s_failures++;
    }
}

static void seating_no_lift(void) {
    struct { const char *name; uint8_t tier; int su; int sl; int row_h; } views[] = {
        { "fullCal",     3, STATUS_SRC_FORECAST, STATUS_SRC_NONE,     FULL_ROW_H    },
        { "compactCal",  2, STATUS_SRC_FORECAST, STATUS_SRC_NONE,     COMPACT_ROW_H },
        { "compactSwap", 2, STATUS_SRC_NONE,     STATUS_SRC_FORECAST, COMPACT_ROW_H },
        { "noCal",       1, STATUS_SRC_FORECAST, STATUS_SRC_NONE,     NONE_ROW_H    },
    };
    for (unsigned i = 0; i < sizeof(views) / sizeof(views[0]); i++) {
        ViewSpec spec = view_spec_unpack(pack(views[i].tier, 1, 0, views[i].su, views[i].sl));
        MainLayout L = layout_compute_spec(BOUNDS, &spec, FC_BAND_H_SHIPPING);
        expect_strip_lift(views[i].name, L.top_status.size.h, TOP_ROW_H);
        expect_no_lift(views[i].name, "status", L.status.size.h, views[i].row_h);
        if (spec.status_lower != STATUS_SRC_NONE) {
            expect_no_lift(views[i].name, "status_lower", L.status_lower.size.h, views[i].row_h);
        }
        expect("seating.strip_is_shortest_clamp_free",
               L.top_status.size.h == status_min_band_h(TOP_ROW_H), true);
    }
}

int main(void) {
    golden_rects();
    downgrade_tests();
    geometry_upper_only();
    geometry_swap();
    seating_no_lift();
    if (s_failures) { printf("%d FAILURES\n", s_failures); return 1; }
    printf("layout_aplite_test: OK\n");
    return 0;
}
