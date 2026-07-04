// Host-run golden-rect tests for src/c/windows/layout.c.
// Build & run via scripts/test-c.sh (compiled twice: bare and -DPBL_PLATFORM_EMERY).
// "dump" arg prints actuals in table form for updating goldens deliberately.
#include <stdio.h>
#include <string.h>
#include "c/windows/layout.h"

static int s_failures = 0;
static int s_dump = 0;

static void check(const char *name, GRect got, int x, int y, int w, int h) {
    if (s_dump) {
        printf("    check(\"%s\", L.%s, %d, %d, %d, %d);\n",
               name, strchr(name, '.') + 1, got.origin.x, got.origin.y, got.size.w, got.size.h);
        return;
    }
    if (got.origin.x != x || got.origin.y != y || got.size.w != w || got.size.h != h) {
        printf("FAIL %s: got (%d,%d,%d,%d) want (%d,%d,%d,%d)\n", name,
               got.origin.x, got.origin.y, got.size.w, got.size.h, x, y, w, h);
        s_failures++;
    }
}

#ifdef PBL_PLATFORM_EMERY
#define BOUNDS GRect(0, 0, 200, 228)
#define FC_BAND_H 24
#else
#define BOUNDS GRect(0, 0, 144, 168)
#define FC_BAND_H 20
#endif

static void golden_rects(void) {
    MainLayout L;
#ifndef PBL_PLATFORM_EMERY
    // ── non-emery (144x168), fc_band_h 20 ──
    L = layout_compute(BOUNDS, LAYOUT_TIER_FULL, false, FC_BAND_H);
    if (s_dump) printf("  FULL !dual\n");
    check("full.top_status",   L.top_status,   0, 0, 144, 14);
    check("full.top",          L.top,          0, 13, 144, 45);
    check("full.status",       L.status,       0, 97, 144, 20);
    check("full.status_lower", L.status_lower, 0, 97, 144, 20);
    check("full.time",         L.time,         0, 58, 144, 45);
    check("full.bottom",       L.bottom,       0, 117, 144, 51);
    check("full.loading",      L.loading,      0, 97, 144, 71);
    check("full.radar",        L.radar,        0, 13, 144, 45);

    L = layout_compute(BOUNDS, LAYOUT_TIER_COMPACT, false, FC_BAND_H);
    if (s_dump) printf("  COMPACT !dual\n");
    check("compact.top",          L.top,          0, 13, 144, 30);
    check("compact.status",       L.status,       0, 46, 144, 15);  // 43 + 3 single-status nudge
    check("compact.status_lower", L.status_lower, 0, 46, 144, 15);
    check("compact.time",         L.time,         0, 58, 144, 45);
    check("compact.bottom",       L.bottom,       0, 103, 144, 65);
    check("compact.loading",      L.loading,      0, 103, 144, 65);
    check("compact.radar",        L.radar,        0, 13, 144, 30);

    L = layout_compute(BOUNDS, LAYOUT_TIER_NONE, false, FC_BAND_H);
    if (s_dump) printf("  NONE !dual\n");
    check("none.top",     L.top,     0, 13, 144, 0);
    check("none.time",    L.time,    0, 16, 144, 45);   // 14 + NONE_TIME_DROP 2
    check("none.status",  L.status,  0, 59, 144, 22);
    check("none.bottom",  L.bottom,  0, 81, 144, 87);
    check("none.loading", L.loading, 0, 81, 144, 87);
    check("none.radar",   L.radar,   0, 81, 144, 87);

    L = layout_compute(BOUNDS, LAYOUT_TIER_COMPACT, true, FC_BAND_H);
    if (s_dump) printf("  COMPACT dual\n");
    check("dualc.status",       L.status,       0, 43, 144, 15);   // no nudge when dual
    check("dualc.status_lower", L.status_lower, 0, 97, 144, 20);   // == full-mode weather band
    check("dualc.bottom",       L.bottom,       0, 117, 144, 51);  // == full-mode forecast
    check("dualc.loading",      L.loading,      0, 117, 144, 51);

    L = layout_compute(BOUNDS, LAYOUT_TIER_NONE, true, FC_BAND_H);
    if (s_dump) printf("  NONE dual\n");
    check("dualn.status",       L.status,       0, 59, 144, 22);
    check("dualn.status_lower", L.status_lower, 0, 81, 144, 22);
    check("dualn.bottom",       L.bottom,       0, 103, 144, 65);
    check("dualn.radar",        L.radar,        0, 103, 144, 65);
#else
    // ── emery (200x228), fc_band_h 24; pads x2/top2/bottom4; content 188 → 60/60/68 ──
    L = layout_compute(BOUNDS, LAYOUT_TIER_FULL, false, FC_BAND_H);
    if (s_dump) printf("  FULL !dual (emery)\n");
    check("full.top_status",   L.top_status,   2, 2, 196, 21);
    check("full.top",          L.top,          2, 22, 196, 60);
    check("full.status",       L.status,       2, 132, 196, 24);
    check("full.status_lower", L.status_lower, 2, 132, 196, 24);
    check("full.time",         L.time,         2, 82, 196, 60);
    check("full.bottom",       L.bottom,       2, 156, 198, 68);
    check("full.loading",      L.loading,      2, 132, 196, 92);  // was (2,142,196,82): unified rule = status top → bottom pad
    check("full.radar",        L.radar,        2, 22, 196, 60);

    L = layout_compute(BOUNDS, LAYOUT_TIER_COMPACT, false, FC_BAND_H);
    if (s_dump) printf("  COMPACT !dual (emery)\n");
    check("compact.top",     L.top,     2, 22, 196, 40);
    check("compact.status",  L.status,  2, 65, 196, 20);   // 62 + 3 single-status nudge
    check("compact.time",    L.time,    2, 82, 196, 60);
    check("compact.bottom",  L.bottom,  2, 142, 198, 82);
    check("compact.loading", L.loading, 2, 142, 196, 82);
    check("compact.radar",   L.radar,   2, 22, 196, 40);

    L = layout_compute(BOUNDS, LAYOUT_TIER_NONE, false, FC_BAND_H);
    if (s_dump) printf("  NONE !dual (emery)\n");
    check("none.top",     L.top,     2, 22, 196, 0);
    check("none.time",    L.time,    2, 26, 196, 60);   // 23 + NONE_TIME_DROP 3
    check("none.status",  L.status,  2, 83, 196, 30);
    check("none.bottom",  L.bottom,  2, 113, 198, 111);
    check("none.loading", L.loading, 2, 113, 198, 111);
    check("none.radar",   L.radar,   2, 113, 198, 111);

    L = layout_compute(BOUNDS, LAYOUT_TIER_COMPACT, true, FC_BAND_H);
    if (s_dump) printf("  COMPACT dual (emery)\n");
    check("dualc.status",       L.status,       2, 62, 196, 20);
    check("dualc.status_lower", L.status_lower, 2, 132, 198, 24);  // width copies L.bottom.size.w
                                                                    // (== forecast_w = w - PAD_X, not
                                                                    // content_w) at carve time
    check("dualc.bottom",       L.bottom,       2, 156, 198, 68);  // == full-mode forecast
    check("dualc.loading",      L.loading,      2, 156, 198, 68);

    L = layout_compute(BOUNDS, LAYOUT_TIER_NONE, true, FC_BAND_H);
    if (s_dump) printf("  NONE dual (emery)\n");
    check("dualn.status",       L.status,       2, 83, 196, 30);
    check("dualn.status_lower", L.status_lower, 2, 113, 198, 30);
    check("dualn.bottom",       L.bottom,       2, 143, 198, 81);
    check("dualn.radar",        L.radar,        2, 143, 198, 81);
#endif
}

static void expect(const char *name, bool got, bool want) {
    if (got != want) { printf("FAIL %s: got %d want %d\n", name, got, want); s_failures++; }
}

static ViewSpec spec_of(uint8_t mode, bool dual, uint8_t top, uint8_t bottom,
                        bool graph_on, bool active) {
    return view_spec_resolve(
        view_spec_from_state(mode, dual, top, bottom, graph_on, active), true);
}

static void viewspec_tests(void) {
    // Default boot view: full, calendar + forecast + weather status.
    ViewSpec s = spec_of(LAYOUT_TIER_FULL, false, 0, 0, false, false);
    LayerVisibility v = layout_visibility(&s);
    expect("boot.calendar", v.calendar, true);
    expect("boot.radar", v.radar, false);
    expect("boot.forecast", v.forecast, true);
    expect("boot.health_graph", v.health_graph, false);
    expect("boot.weather_status", v.weather_status, true);
    expect("boot.health_status", v.health_status, false);
    expect("boot.tier", s.status_tier == LAYOUT_TIER_FULL, true);

    // Health ALL flick: radar top + health graph + health status.
    s = spec_of(LAYOUT_TIER_COMPACT, false, 1, 1, true, true);
    v = layout_visibility(&s);
    expect("alt.calendar", v.calendar, false);
    expect("alt.radar", v.radar, true);
    expect("alt.forecast", v.forecast, false);
    expect("alt.health_graph", v.health_graph, true);
    expect("alt.health_status", v.health_status, true);
    expect("alt.weather_status", v.weather_status, false);

    // Health STATUS mode: bottom=health keeps the forecast graph, swaps the status row.
    s = spec_of(LAYOUT_TIER_COMPACT, false, 1, 1, false, true);
    v = layout_visibility(&s);
    expect("hstat.forecast", v.forecast, true);
    expect("hstat.health_graph", v.health_graph, false);
    expect("hstat.health_status", v.health_status, true);

    // Radar top requested with NO data -> calendar (the flick dead-end downgrade).
    ViewSpec raw = view_spec_from_state(LAYOUT_TIER_COMPACT, false, 1, 0, false, false);
    s = view_spec_resolve(raw, false);
    expect("noradar.top_is_calendar", s.top == TOP_BAND_CALENDAR, true);

    // none-mode radar stop carries the health status row; without data both fall back.
    raw = view_spec_from_state(LAYOUT_TIER_NONE, false, 0, 2, false, true);
    s = view_spec_resolve(raw, true);
    expect("noneradar.body", s.body == BODY_RADAR, true);
    expect("noneradar.status", s.status == STATUS_ROW_HEALTH, true);
    s = view_spec_resolve(raw, false);
    expect("noneradar.fallback_body", s.body == BODY_FORECAST, true);
    expect("noneradar.fallback_status", s.status == STATUS_ROW_WEATHER, true);

    // A stray BODY_RADAR outside none normalizes to forecast even with data.
    raw = view_spec_from_state(LAYOUT_TIER_FULL, false, 0, 2, false, false);
    s = view_spec_resolve(raw, true);
    expect("strayradar.body", s.body == BODY_FORECAST, true);

    // Dual: both status rows; tier promotes to FULL under a compact top view only.
    s = spec_of(LAYOUT_TIER_COMPACT, true, 0, 0, false, true);
    v = layout_visibility(&s);
    expect("dual.weather_status", v.weather_status, true);
    expect("dual.health_status", v.health_status, true);
    expect("dual.tier_full", s.status_tier == LAYOUT_TIER_FULL, true);
    s = spec_of(LAYOUT_TIER_NONE, true, 0, 0, false, true);
    expect("dualnone.tier_none", s.status_tier == LAYOUT_TIER_NONE, true);

    // Geometry equivalence: spec-driven == legacy for every mode x dual.
    static const uint8_t tiers[3] = { LAYOUT_TIER_FULL, LAYOUT_TIER_COMPACT, LAYOUT_TIER_NONE };
    for (int t = 0; t < 3; t++) {
        for (int d = 0; d < 2; d++) {
            bool dual = (d == 1) && tiers[t] != LAYOUT_TIER_FULL;  // dual never in full
            ViewSpec sp = view_spec_from_state(tiers[t], dual, 0, 0, false, dual);
            MainLayout a = layout_compute_spec(BOUNDS, &sp, FC_BAND_H);
            MainLayout b = layout_compute(BOUNDS, tiers[t], dual, FC_BAND_H);
            if (memcmp(&a, &b, sizeof(MainLayout)) != 0) {
                printf("FAIL equivalence tier=%d dual=%d\n", tiers[t], dual);
                s_failures++;
            }
        }
    }
}

int main(int argc, char **argv) {
    s_dump = (argc > 1 && strcmp(argv[1], "dump") == 0);
    golden_rects();
    if (!s_dump) viewspec_tests();
    if (s_dump) return 0;
    if (s_failures) { printf("%d golden-rect failure(s)\n", s_failures); return 1; }
    printf("layout golden rects OK%s\n",
#ifdef PBL_PLATFORM_EMERY
           " (emery)"
#else
           ""
#endif
    );
    return 0;
}
