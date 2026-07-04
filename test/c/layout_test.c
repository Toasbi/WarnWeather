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

static void viewspec_tests(void) {
    // Packed-byte decode. Byte format: tier<<6 | top<<4 | body<<2 | status.
    ViewSpec u = view_spec_unpack(0x80);   // CAL2·FC·W (tier=2,top=CAL,body=FC,status=W)
    expect("unpack.cal2.rows", u.calendar_rows == 2, true);
    expect("unpack.cal2.top", u.top == TOP_BAND_CALENDAR, true);
    expect("unpack.cal2.body", u.body == BODY_FORECAST, true);
    expect("unpack.cal2.status", u.status == STATUS_ROW_WEATHER, true);

    u = view_spec_unpack(0xD3);            // FULL·RDR·FC·— (radar in top, no status)
    expect("unpack.rdrtop.rows", u.calendar_rows == 3, true);
    expect("unpack.rdrtop.top", u.top == TOP_BAND_RADAR, true);
    expect("unpack.rdrtop.body", u.body == BODY_FORECAST, true);
    expect("unpack.rdrtop.status", u.status == STATUS_ROW_NONE, true);
    LayerVisibility vn = layout_visibility(&u);
    expect("rdrtop.radar_visible", vn.radar, true);
    expect("rdrtop.calendar_hidden", vn.calendar, false);
    expect("rdrtop.forecast_visible", vn.forecast, true);
    expect("rdrtop.no_status", vn.weather_status || vn.health_status, false);

    u = view_spec_unpack(0x82);            // CAL2·FC·D — dual promotes status tier to FULL
    expect("unpack.dual.status", u.status == STATUS_ROW_DUAL, true);
    expect("unpack.dual.tier_full", u.status_tier == LAYOUT_TIER_FULL, true);

    expect("unpack.off_tier", view_spec_unpack(0x00).calendar_rows == 0, true);
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
