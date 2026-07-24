// Host golden-rect tests for the aplite lean twin src/c/windows/layout_aplite.c.
// Built with -DPBL_PLATFORM_APLITE and WITHOUT PBL_HEALTH / WW_QUICK_VIEW / WW_VIEW_CYCLE,
// exactly as the aplite platform build compiles it. Goldens equal the non-dual forecast
// cases in layout_test.c (144x168, fc_band_h 20), proving behavior parity on aplite.
#include <stdio.h>
#include <string.h>
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
    check("full.top_status",   L.top_status,   0, 0, 144, 14);
    check("full.top",          L.top,          0, 13, 144, 45);
    check("full.status",       L.status,       0, 97, 144, 20);
    check("full.status_lower", L.status_lower, 0, 97, 144, 20);
    check("full.time",         L.time,         0, 58, 144, 45);
    check("full.bottom",       L.bottom,       0, 117, 144, 51);
    check("full.loading",      L.loading,      0, 97, 144, 71);

    // COMPACT (wire tier 2), forecast status in the upper band
    L = compute(2, STATUS_SRC_FORECAST, STATUS_SRC_NONE);
    check("compact.top",       L.top,          0, 13, 144, 30);
    check("compact.status",    L.status,       0, 46, 144, 15);
    check("compact.time",      L.time,         0, 58, 144, 45);
    check("compact.bottom",    L.bottom,       0, 103, 144, 65);
    check("compact.loading",   L.loading,      0, 103, 144, 65);

    // NONE (wire tier 1), forecast status in the upper band
    L = compute(1, STATUS_SRC_FORECAST, STATUS_SRC_NONE);
    check("none.top",          L.top,          0, 13, 144, 0);
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
// never sends to aplite) collapses to the single UPPER band — there is NO lower/forecast-abutting
// band and NO compact->full tier promotion. Geometry matches the plain compact upper-status view.
static void geometry_upper_only(void) {
    ViewSpec s = view_spec_unpack(pack(2, 1, 0, STATUS_SRC_NONE, STATUS_SRC_FORECAST));
    MainLayout L = layout_compute_spec(BOUNDS, &s, FC_BAND_H);
    check("upper_only.status",       L.status,       0, 46, 144, 15);   // == compact upper band
    check("upper_only.status_lower", L.status_lower, 0, 46, 144, 15);   // mirrors status (no carve)
    check("upper_only.bottom",       L.bottom,       0, 103, 144, 65);  // == compact bottom (no lower carve)
    expect("upper_only.weather_status_on", layout_visibility(&s).weather_status, true);
    expect("upper_only.tier_compact", s.status_tier == LAYOUT_TIER_COMPACT, true);   // no promotion
}

int main(void) {
    golden_rects();
    downgrade_tests();
    geometry_upper_only();
    if (s_failures) { printf("%d FAILURES\n", s_failures); return 1; }
    printf("layout_aplite_test: OK\n");
    return 0;
}
