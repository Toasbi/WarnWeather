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

// Pack a 10-bit wire value, mirroring view-cycle.js packSpec():
// tier<<8 | top<<6 | body<<4 | statusUpper<<2 | statusLower.
static uint16_t pack(int tier, int top, int body, int su, int sl) {
    return (uint16_t)(((tier & 3) << 8) | ((top & 3) << 6) | ((body & 3) << 4)
                    | ((su & 3) << 2) | (sl & 3));
}

// Golden-test shim for the retired layout_compute() production wrapper: geometry for a
// plain calendar+forecast view at the given tier. `two_rows` picks a single upper forecast
// row (default views) or the dual health-upper + forecast-lower stack, matching the named
// view constants in src/pkjs/view-cycle.js.
static MainLayout layout_compute(GRect bounds, uint8_t tier, bool two_rows, int fc_band_h) {
    uint8_t wire_tier = (tier == LAYOUT_TIER_FULL) ? 3
                      : (tier == LAYOUT_TIER_COMPACT) ? 2 : 1;
    int su = two_rows ? STATUS_SRC_HEALTH : STATUS_SRC_FORECAST;
    int sl = two_rows ? STATUS_SRC_FORECAST : STATUS_SRC_NONE;
    ViewSpec spec = view_spec_unpack(pack(wire_tier, 1, 0, su, sl));
    return layout_compute_spec(bounds, &spec, fc_band_h);
}

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

// Brief Task 3: positional unpack + visibility.
static void test_unpack_positional(void) {
    ViewSpec s = view_spec_unpack(pack(2 /*compact*/, 1 /*cal*/, 0 /*fc*/,
                                       STATUS_SRC_RADAR, STATUS_SRC_FORECAST));
    expect("unpack_positional.rows", s.calendar_rows == 2, true);
    expect("unpack_positional.su", s.status_upper == STATUS_SRC_RADAR, true);
    expect("unpack_positional.sl", s.status_lower == STATUS_SRC_FORECAST, true);
    LayerVisibility v = layout_visibility(&s);
    expect("unpack_positional.vis", v.radar_status && v.weather_status && !v.health_status, true);
    printf("unpack_positional OK\n");
}

// Brief Task 3: per-band availability downgrades.
static void test_resolve_no_health_no_radar(void) {
    // health+forecast dense, but neither capability -> both fall back sanely.
    ViewSpec s = view_spec_unpack(pack(2, 1, 0, STATUS_SRC_HEALTH, STATUS_SRC_FORECAST));
    ViewSpec r = view_spec_resolve(s, /*has_radar*/false, /*has_health*/false);
    expect("resolve_nhnr.health_dropped", r.status_upper == STATUS_SRC_NONE, true);
    expect("resolve_nhnr.forecast_kept", r.status_lower == STATUS_SRC_FORECAST, true);
    // radar row without radar data collapses to none.
    ViewSpec s2 = view_spec_unpack(pack(2, 1, 0, STATUS_SRC_RADAR, STATUS_SRC_FORECAST));
    ViewSpec r2 = view_spec_resolve(s2, false, true);
    expect("resolve_nhnr.radar_dropped", r2.status_upper == STATUS_SRC_NONE, true);
    expect("resolve_nhnr.radar_forecast_kept", r2.status_lower == STATUS_SRC_FORECAST, true);
    printf("resolve_no_health_no_radar OK\n");
}

static void viewspec_tests(void) {
    // Packed 10-bit decode: tier<<8 | top<<6 | body<<4 | statusUpper<<2 | statusLower.
    // The wire `top` field uses EMPTY=0, CALENDAR=1, RADAR=2 (see src/pkjs/view-cycle.js);
    // view_spec_unpack translates it to the C TopBand enum. su/sl are StatusSource values.
    ViewSpec u = view_spec_unpack(pack(2, 1, 0, STATUS_SRC_FORECAST, STATUS_SRC_NONE)); // CAL2 forecast-upper
    expect("unpack.cal2.rows", u.calendar_rows == 2, true);
    expect("unpack.cal2.top", u.top == TOP_BAND_CALENDAR, true);
    expect("unpack.cal2.body", u.body == BODY_FORECAST, true);
    expect("unpack.cal2.su", u.status_upper == STATUS_SRC_FORECAST, true);
    expect("unpack.cal2.sl", u.status_lower == STATUS_SRC_NONE, true);

    u = view_spec_unpack(pack(3, 2, 0, STATUS_SRC_NONE, STATUS_SRC_NONE));  // radar-top, statusless
    expect("unpack.rdrtop.rows", u.calendar_rows == 3, true);
    expect("unpack.rdrtop.top", u.top == TOP_BAND_RADAR, true);
    expect("unpack.rdrtop.body", u.body == BODY_FORECAST, true);
    LayerVisibility vn = layout_visibility(&u);
    expect("rdrtop.radar_visible", vn.radar, true);
    expect("rdrtop.calendar_hidden", vn.calendar, false);
    expect("rdrtop.forecast_visible", vn.forecast, true);
    expect("rdrtop.no_status", vn.weather_status || vn.radar_status || vn.health_status, false);

    // Dual (health upper + forecast lower) under a compact top view promotes the tier to FULL.
    u = view_spec_unpack(pack(2, 1, 0, STATUS_SRC_HEALTH, STATUS_SRC_FORECAST));
    expect("unpack.dual.su", u.status_upper == STATUS_SRC_HEALTH, true);
    expect("unpack.dual.sl", u.status_lower == STATUS_SRC_FORECAST, true);
    expect("unpack.dual.tier_full", u.status_tier == LAYOUT_TIER_FULL, true);

    expect("unpack.off_tier", view_spec_unpack(0).calendar_rows == 0, true);

    // Availability resolve. A dropped upper leaves the lower where it is. The lone survivor is a
    // single status row, so it drops to the COMPACT (larger) status font under a compact calendar
    // — only a DUAL squeezes to the full-tier (smaller) font.
    ViewSpec r = view_spec_resolve(view_spec_unpack(pack(2, 1, 0, STATUS_SRC_HEALTH, STATUS_SRC_FORECAST)),
                                   true, false);
    expect("resolve.nohealth.upper_dropped", r.status_upper == STATUS_SRC_NONE, true);
    expect("resolve.nohealth.lower_kept", r.status_lower == STATUS_SRC_FORECAST, true);
    expect("resolve.nohealth.lone_lower_compact", r.status_tier == LAYOUT_TIER_COMPACT, true);
    r = view_spec_resolve(view_spec_unpack(pack(1, 0, 1, STATUS_SRC_HEALTH, STATUS_SRC_NONE)),
                          true, false);   // NONE tier, health graph body + health upper
    expect("resolve.nohealth.graph_to_forecast", r.body == BODY_FORECAST, true);
    expect("resolve.nohealth.health_status_dropped", r.status_upper == STATUS_SRC_NONE, true);

    // Radar-in-body under a calendar stays radar WHEN data present.
    r = view_spec_resolve(view_spec_unpack(pack(2, 1, 2, STATUS_SRC_RADAR, STATUS_SRC_NONE)), true, true);
    expect("resolve.radar_body_with_cal_ok", r.body == BODY_RADAR, true);
    r = view_spec_resolve(view_spec_unpack(pack(2, 1, 2, STATUS_SRC_RADAR, STATUS_SRC_NONE)), false, true);
    expect("resolve.radar_body_fallback", r.body == BODY_FORECAST, true);
    expect("resolve.radar_body_status_dropped", r.status_upper == STATUS_SRC_NONE, true);

    // Radar-in-top without data falls back to a calendar top band.
    r = view_spec_resolve(view_spec_unpack(pack(3, 2, 0, STATUS_SRC_FORECAST, STATUS_SRC_NONE)), false, true);
    expect("resolve.radar_top_fallback", r.top == TOP_BAND_CALENDAR, true);

    // Radar status row on a forecast body (the retired BODY_RADAR_STATUS, now positional):
    // radar row upper + forecast row lower, forecast graph in the body.
    ViewSpec rs = view_spec_unpack(pack(2, 1, 0, STATUS_SRC_RADAR, STATUS_SRC_FORECAST));
    LayerVisibility vrs = layout_visibility(&rs);
    expect("rdrstat.radar_body_hidden", vrs.radar, false);   // no radar top/body band
    expect("rdrstat.forecast_shown", vrs.forecast, true);
    expect("rdrstat.radar_status_on", vrs.radar_status, true);
    expect("rdrstat.weather_status_on", vrs.weather_status, true);
    ViewSpec rsn = view_spec_resolve(rs, false, false);      // no radar data
    expect("rdrstat.no_radar_upper_none", rsn.status_upper == STATUS_SRC_NONE, true);
    expect("rdrstat.no_radar_lower_fc", rsn.status_lower == STATUS_SRC_FORECAST, true);
}

static void peek_tests(void) {
    // layout_compute_peek: the active view minus its calendar, fit into the clear area above
    // a Timeline Quick View overlay. Date strip stays at top, then clock, status, body.
    // Start from a full-cal forecast+weather view; peek ignores top/calendar. Visibility:
    // calendar hidden (top emptied), forecast + weather status still on.
    ViewSpec s = view_spec_unpack(pack(3, 1, 0, STATUS_SRC_FORECAST, STATUS_SRC_NONE));   // CAL3 forecast
    s.top = TOP_BAND_EMPTY; s.calendar_rows = 0; s.status_tier = LAYOUT_TIER_FULL;
    LayerVisibility v = layout_visibility(&s);
    expect("peek.calendar_hidden",        v.calendar, false);
    expect("peek.forecast_visible",       v.forecast, true);
    expect("peek.weather_status_visible", v.weather_status, true);

    GRect clear = GRect(0, 0, 144, 117);   // 168 - 51 overlay
    MainLayout L = layout_compute_peek(clear, &s, FC_BAND_H);
#ifndef PBL_PLATFORM_EMERY
    // strip 14; available 117-14-20=83; clock 83*45/96=38; status@52 h20; forecast@72 h45.
    check("peek.top_status", L.top_status, 0, 0,  144, 14);
    check("peek.top",        L.top,        0, 14, 144, 0);
    check("peek.time",       L.time,       0, 14, 144, 38);
    check("peek.status",     L.status,     0, 52, 144, 20);
    check("peek.bottom",     L.bottom,     0, 72, 144, 45);
#else
    // strip 21; available 117-21-24=72; clock 72*45/96=33; status@54 h24; forecast@78 h39.
    check("peek.top_status", L.top_status, 0, 0,  144, 21);
    check("peek.top",        L.top,        0, 21, 144, 0);
    check("peek.time",       L.time,       0, 21, 144, 33);
    check("peek.status",     L.status,     0, 54, 144, 24);
    check("peek.bottom",     L.bottom,     0, 78, 144, 39);
#endif

    // A statusless view: clock + body only, status band collapses to zero height.
    ViewSpec sn = view_spec_unpack(pack(3, 1, 0, STATUS_SRC_FORECAST, STATUS_SRC_NONE));
    sn.top = TOP_BAND_EMPTY; sn.calendar_rows = 0;
    sn.status_upper = STATUS_SRC_NONE; sn.status_lower = STATUS_SRC_NONE;
    MainLayout Ln = layout_compute_peek(clear, &sn, FC_BAND_H);
    expect("peekNone.status_zero_h", Ln.status.size.h == 0, true);
    expect("peekNone.body_fills",    Ln.bottom.size.h > L.bottom.size.h, true);

    // DUAL status stacks two bands between the clock and the body — health on L.status
    // (upper) above weather on L.status_lower (lower), the order render_active_view maps.
    ViewSpec sd = view_spec_unpack(pack(2, 1, 0, STATUS_SRC_HEALTH, STATUS_SRC_FORECAST));   // dual
    sd.top = TOP_BAND_EMPTY; sd.calendar_rows = 0; sd.status_tier = LAYOUT_TIER_FULL;
    LayerVisibility vd = layout_visibility(&sd);
    expect("peekDual.both_status", vd.weather_status && vd.health_status, true);
    MainLayout Ld = layout_compute_peek(clear, &sd, FC_BAND_H);
#ifndef PBL_PLATFORM_EMERY
    // strip 14; available 117-14-40=63; clock 63*45/96=29; health@43 weather@63 (h20); fc@83 h34.
    check("peekDual.time",         Ld.time,         0, 14, 144, 29);
    check("peekDual.status",       Ld.status,       0, 43, 144, 20);
    check("peekDual.status_lower", Ld.status_lower, 0, 63, 144, 20);
    check("peekDual.bottom",       Ld.bottom,       0, 83, 144, 34);
#else
    // strip 21; available 117-21-48=48; clock 48*45/96=22; health@43 weather@67 (h24); fc@91 h26.
    check("peekDual.time",         Ld.time,         0, 21, 144, 22);
    check("peekDual.status",       Ld.status,       0, 43, 144, 24);
    check("peekDual.status_lower", Ld.status_lower, 0, 67, 144, 24);
    check("peekDual.bottom",       Ld.bottom,       0, 91, 144, 26);
#endif
}

static void radar_placement_tests(void) {
#ifndef PBL_PLATFORM_EMERY
    // radar in body under a 2-row calendar, radar status row (upper).
    ViewSpec s = view_spec_unpack(pack(2, 1, 2, STATUS_SRC_RADAR, STATUS_SRC_NONE));
    MainLayout L = layout_compute_spec(BOUNDS, &s, FC_BAND_H);
    check("cal2radar.radar", L.radar, 0, 103, 144, 65);   // == compact L.bottom
    check("cal2radar.top",   L.top,   0, 13, 144, 30);    // 2-row calendar band intact

    // radar in body under a 3-row calendar.
    s = view_spec_unpack(pack(3, 1, 2, STATUS_SRC_RADAR, STATUS_SRC_NONE));
    L = layout_compute_spec(BOUNDS, &s, FC_BAND_H);
    check("cal3radar.radar", L.radar, 0, 117, 144, 51);   // == full L.bottom

    // radar in top, forecast in body, forecast status row (upper).
    s = view_spec_unpack(pack(3, 2, 0, STATUS_SRC_FORECAST, STATUS_SRC_NONE));
    L = layout_compute_spec(BOUNDS, &s, FC_BAND_H);
    check("rdrtop.radar", L.radar, 0, 13, 144, 45);       // == full L.top
    check("rdrtop.bottom", L.bottom, 0, 117, 144, 51);    // status band present → squeezed forecast

    // statusless radar-top forecast flick.
    s = view_spec_unpack(pack(3, 2, 0, STATUS_SRC_NONE, STATUS_SRC_NONE));
    L = layout_compute_spec(BOUNDS, &s, FC_BAND_H);
    check("rdrtopNone.radar",  L.radar,  0, 13, 144, 45);   // radar keeps the full top band
    check("rdrtopNone.bottom", L.bottom, 0, 103, 144, 65);  // no status row → forecast == compact tier
    check("rdrtopNone.loading", L.loading, 0, 103, 144, 65);// loading covers the reclaimed forecast
#endif
}

// Brief Task 4: per-field band geometry. Relationship (not magic-pixel) assertions on a
// fixed 144x168 reference with fc_band_h 14 (== WEATHER_STATUS_HEIGHT, so a carved lower
// band exactly fills its reserved slot) — the relationships hold on both platform compiles.
static void test_geometry_lower_only(void) {
    // compactCal + swap: forecast in the lower band, upper empty.
    ViewSpec s = view_spec_unpack(pack(2, 1, 0, STATUS_SRC_NONE, STATUS_SRC_FORECAST));
    MainLayout L = layout_compute_spec(GRect(0, 0, 144, 168), &s, 14 /*fc_band_h*/);
    // lower band sits below the clock and abuts the forecast body top.
    expect("geometry_lower_only.below_clock",
           L.status_lower.origin.y >= L.time.origin.y + L.time.size.h, true);
    expect("geometry_lower_only.abuts_forecast",
           L.status_lower.origin.y + L.status_lower.size.h <= L.bottom.origin.y + 1, true);
    expect("geometry_lower_only.has_height", L.status_lower.size.h > 0, true);
    expect("geometry_lower_only.upper_collapsed", L.status.size.h == 0, true);
    // With no upper status the clock reclaims the freed 3rd-calendar-row: its top abuts the
    // 2-row calendar's bottom (no empty gap where the upper slot used to be).
    expect("geometry_lower_only.clock_reclaims_freed_row",
           L.time.origin.y == L.top.origin.y + L.top.size.h, true);
    // Size-preserving swap: the lone lower status uses the SAME band height and COMPACT tier as a
    // lone upper status — swapping changes position, not size (a 100% top/bottom size swap).
    ViewSpec up = view_spec_unpack(pack(2, 1, 0, STATUS_SRC_FORECAST, STATUS_SRC_NONE));  // normal upper
    MainLayout Lu = layout_compute_spec(GRect(0, 0, 144, 168), &up, 14);
    expect("geometry_lower_only.same_band_height_as_upper",
           L.status_lower.size.h == Lu.status.size.h, true);
    expect("geometry_lower_only.tier_compact", s.status_tier == LAYOUT_TIER_COMPACT, true);
    expect("geometry_lower_only.upper_tier_compact", up.status_tier == LAYOUT_TIER_COMPACT, true);
    printf("geometry_lower_only OK\n");
}

// The lone-status tier rule: only a DUAL (two stacked rows) squeezes to the smaller full-tier
// status font so both fit. A LONE status row keeps the larger compact font whether it lands in
// the upper (freed 3rd-cal-row) slot or the lower (swap) slot — so a lone lower row stays
// COMPACT, making the clock/status swap a size-preserving position change (see the FULL<COMPACT
// status-font sizes in layer_util.h / status_row.c).
static void test_resolve_tier_lower_only(void) {
    // Upper (health) resolves away, lone forecast lower survives, compact calendar → COMPACT.
    ViewSpec r = view_spec_resolve(view_spec_unpack(pack(2, 1, 0, STATUS_SRC_HEALTH, STATUS_SRC_FORECAST)),
                                   true, false);
    expect("resolve_tier_lower_only.upper_gone", r.status_upper == STATUS_SRC_NONE, true);
    expect("resolve_tier_lower_only.lower_survives", r.status_lower == STATUS_SRC_FORECAST, true);
    expect("resolve_tier_lower_only.lone_lower_compact", r.status_tier == LAYOUT_TIER_COMPACT, true);

    // Configured lone lower (the swap layout) stays compact too.
    ViewSpec c = view_spec_resolve(view_spec_unpack(pack(2, 1, 0, STATUS_SRC_NONE, STATUS_SRC_FORECAST)),
                                   true, true);
    expect("resolve_tier_lower_only.swap_compact", c.status_tier == LAYOUT_TIER_COMPACT, true);

    // A lone UPPER row under a compact calendar is compact as well.
    ViewSpec u = view_spec_resolve(view_spec_unpack(pack(2, 1, 0, STATUS_SRC_FORECAST, STATUS_SRC_NONE)),
                                   true, true);
    expect("resolve_tier_lower_only.upper_only_compact", u.status_tier == LAYOUT_TIER_COMPACT, true);

    // Only a DUAL (two rows) promotes to the squeezed full tier.
    ViewSpec d = view_spec_resolve(view_spec_unpack(pack(2, 1, 0, STATUS_SRC_HEALTH, STATUS_SRC_FORECAST)),
                                   true, true);
    expect("resolve_tier_lower_only.dual_full", d.status_tier == LAYOUT_TIER_FULL, true);

    // Unpack alone (before resolve): lone lower stays compact.
    ViewSpec un = view_spec_unpack(pack(2, 1, 0, STATUS_SRC_NONE, STATUS_SRC_FORECAST));
    expect("resolve_tier_lower_only.unpack_lone_lower_compact", un.status_tier == LAYOUT_TIER_COMPACT, true);
    printf("resolve_tier_lower_only OK\n");
}

static void test_geometry_two_rows(void) {
    // radar upper + forecast lower.
    ViewSpec s = view_spec_unpack(pack(2, 1, 0, STATUS_SRC_RADAR, STATUS_SRC_FORECAST));
    MainLayout L = layout_compute_spec(GRect(0, 0, 144, 168), &s, 14);
    expect("geometry_two_rows.both_heights", L.status.size.h > 0 && L.status_lower.size.h > 0, true);
    expect("geometry_two_rows.upper_above_clock", L.status.origin.y < L.time.origin.y, true);
    expect("geometry_two_rows.lower_below_clock", L.status_lower.origin.y > L.time.origin.y, true);
    printf("geometry_two_rows OK\n");
}

// Cursor cycle slots, full 10-bit pack() encodings — the same value the phone packs and
// persist/wire now carries end-to-end (config.view_spec2 is uint16_t; the cursor API takes
// uint16_t slots). Encoding: statusLower(0-1) | statusUpper(2-3) | body(4-5) | top(6-7) |
// tier(8-9). tier 3=full, 2=compact, 1=none; wire top EMPTY0/CAL1/RADAR2. The tier bits (8-9)
// now ride along, so B_CAL2_* and B_CAL3_* differ (they shared a low byte before widening).
#define B_CAL3_FC_W    pack(3, 1, 0, STATUS_SRC_FORECAST, STATUS_SRC_NONE)  // full cal, forecast-upper
#define B_CAL3_RDR_W   pack(3, 1, 2, STATUS_SRC_RADAR, STATUS_SRC_NONE)     // full cal, radar body+upper
#define B_CAL2_FC_W    pack(2, 1, 0, STATUS_SRC_FORECAST, STATUS_SRC_NONE)  // compact cal, forecast-upper
#define B_CAL2_FC_H    pack(2, 1, 0, STATUS_SRC_HEALTH, STATUS_SRC_NONE)    // compact cal, health-upper
#define B_CAL2_RDR_W   pack(2, 1, 2, STATUS_SRC_RADAR, STATUS_SRC_NONE)     // compact cal, radar body+upper
#define B_RDR_FC_NONE  pack(3, 2, 0, STATUS_SRC_NONE, STATUS_SRC_NONE)      // radar-top forecast, no status
#define B_NONE_FC_W    pack(1, 0, 0, STATUS_SRC_FORECAST, STATUS_SRC_NONE)  // no cal, forecast-upper
#define B_NONE_GRAPH_H pack(1, 0, 1, STATUS_SRC_HEALTH, STATUS_SRC_NONE)    // no cal, health graph+upper
#define B_NONE_RDR_W   pack(1, 0, 2, STATUS_SRC_RADAR, STATUS_SRC_NONE)     // no cal, radar body+upper

static void view_cursor_tests(void) {
    // ── The reported bug: live settings change after a flick ──────────────────
    // User flicked to slot 1 under compactCal+status+radar, then switched preset to
    // fullCal+off+radar (a different cycle). The cursor must return to the default view;
    // leaving it on slot 1 is exactly "stuck at flick 1, default never shows".
    uint16_t compactStatusRadar[3] = { B_CAL2_FC_W, B_CAL2_FC_H, B_RDR_FC_NONE };
    uint16_t fullCalRadar[3]       = { B_CAL3_FC_W, B_CAL3_RDR_W, 0x000 };
    expect("cursor.preset_switch_resets_to_default",
           view_cursor_after_config(1, compactStatusRadar, fullCalRadar) == 0, true);

    // Truncation guard (the reviewer's named risk): two cycles that differ ONLY in the tier
    // bits (8-9) — identical low bytes — must still read as a redefined cycle. A uint8 cursor
    // copy would collapse them to equal and wrongly KEEP the cursor; the full 10-bit
    // comparison detects the change and resets to the default view.
    uint16_t cycleCompact[3] = { B_CAL2_FC_W, 0x000, 0x000 };   // 0x244
    uint16_t cycleFull[3]    = { B_CAL3_FC_W, 0x000, 0x000 };   // 0x344 — low byte identical
    expect("cursor.tier_only_change_resets",
           view_cursor_after_config(1, cycleCompact, cycleFull) == 0, true);

    // noCal+all+radar reached with a carried-over non-default cursor → back to default.
    uint16_t noCalAllRadar[3] = { B_NONE_FC_W, B_NONE_GRAPH_H, B_NONE_RDR_W };
    expect("cursor.noCal_carryover_resets",
           view_cursor_after_config(2, compactStatusRadar, noCalAllRadar) == 0, true);

    // An unchanged cycle (radar/health availability re-apply, not a settings edit) must
    // keep the user on their chosen view.
    expect("cursor.unchanged_keeps",
           view_cursor_after_config(2, noCalAllRadar, noCalAllRadar) == 2, true);
    expect("cursor.unchanged_keeps_default",
           view_cursor_after_config(0, fullCalRadar, fullCalRadar) == 0, true);

    // Even a single-slot change redefines the cycle → reset (cursor could point anywhere).
    uint16_t fullCalRadar2[3] = { B_CAL3_FC_W, B_CAL3_RDR_W, B_NONE_FC_W };
    expect("cursor.single_slot_change_resets",
           view_cursor_after_config(1, fullCalRadar, fullCalRadar2) == 0, true);

    // Reported facet: parked on a health/radar flick slot, then health/radar toggled in
    // settings. The forecast (default, slot 0) must become reachable again. This is where
    // the OLD rule failed: it only reset when the current slot went disabled (byte 0), so
    // disabling BOTH health+radar returned to the forecast, but toggling to another
    // populated cycle left the cursor stranded off the forecast.
    uint16_t compactAllRadar[3]   = { B_CAL3_FC_W, B_NONE_GRAPH_H, B_NONE_RDR_W }; // health all + radar
    uint16_t compactOffNoRadar[3] = { B_CAL2_FC_W, 0x000, 0x000 };                 // both off (1 slot)
    uint16_t compactOffRadar[3]   = { B_CAL2_FC_W, B_CAL2_RDR_W, 0x000 };          // health off, radar on
    expect("cursor.disable_all_returns_to_forecast",
           view_cursor_after_config(2, compactAllRadar, compactOffNoRadar) == 0, true);
    expect("cursor.health_off_radar_on_returns_to_forecast",
           view_cursor_after_config(1, compactAllRadar, compactOffRadar) == 0, true);

    // ── Navigation (wrap + availability) ──────────────────────────────────────
    expect("next.3slot.0to1", view_cursor_next(0, noCalAllRadar, true, true) == 1, true);
    expect("next.3slot.1to2", view_cursor_next(1, noCalAllRadar, true, true) == 2, true);
    expect("next.3slot.2to0", view_cursor_next(2, noCalAllRadar, true, true) == 0, true);
    // Health off → the graph/health slot is skipped.
    expect("next.3slot.nohealth.0to2", view_cursor_next(0, noCalAllRadar, true, false) == 2, true);
    // No radar + no health → only the default is a valid stop.
    expect("next.3slot.nodata.stays0", view_cursor_next(0, noCalAllRadar, false, false) == 0, true);
    // 2-slot cycle toggles 0<->1; 1-slot cycle never leaves 0.
    expect("next.2slot.0to1", view_cursor_next(0, fullCalRadar, true, true) == 1, true);
    expect("next.2slot.1to0", view_cursor_next(1, fullCalRadar, true, true) == 0, true);
    uint16_t oneSlot[3] = { B_CAL3_FC_W, 0x000, 0x000 };
    expect("next.1slot.stays0", view_cursor_next(0, oneSlot, true, true) == 0, true);

    // A radar-status slot (radar row on a forecast body) needs radar data to be a stop.
    // compact cal | forecast body | radar-upper | forecast-lower.
    uint16_t radarStatusSlot = pack(2, 1, 0, STATUS_SRC_RADAR, STATUS_SRC_FORECAST);
    expect("slot.radar_status_needs_radar", view_slot_available(radarStatusSlot, false, true), false);
    expect("slot.radar_status_ok_with_data", view_slot_available(radarStatusSlot, true, true), true);
}

static void view_timer_tests(void) {
    // Auto-return measures ELAPSED SECONDS since the flick, not minute-tick edges. The
    // old counter (s_minutes_since_flick, ++ per MINUTE_UNIT tick) counted the first
    // partial minute as a whole one: a flick at :59 hit the next :00 tick ~1s later and,
    // with view_reset_min = 1, snapped straight back. These pin the "full window must
    // actually pass" contract.
    const int32_t t0 = 1000000;   // arbitrary flick epoch (seconds)

    // reset_min = 0 disables auto-return entirely, regardless of elapsed time.
    expect("timer.disabled_never_returns", view_auto_return_due(t0 + 99999, t0, 0), false);

    // 1-minute window: one second after the flick must NOT return (the reported bug).
    expect("timer.1min.after_1s_stays", view_auto_return_due(t0 + 1, t0, 1), false);
    expect("timer.1min.after_59s_stays", view_auto_return_due(t0 + 59, t0, 1), false);
    // Exactly a full minute (and beyond) returns.
    expect("timer.1min.after_60s_returns", view_auto_return_due(t0 + 60, t0, 1), true);
    expect("timer.1min.after_2min_returns", view_auto_return_due(t0 + 120, t0, 1), true);

    // Larger window scales by 60s/min.
    expect("timer.5min.after_299s_stays", view_auto_return_due(t0 + 299, t0, 5), false);
    expect("timer.5min.after_300s_returns", view_auto_return_due(t0 + 300, t0, 5), true);
}

int main(int argc, char **argv) {
    s_dump = (argc > 1 && strcmp(argv[1], "dump") == 0);
    golden_rects();
    if (!s_dump) test_unpack_positional();
    if (!s_dump) test_resolve_no_health_no_radar();
    if (!s_dump) viewspec_tests();
    if (!s_dump) peek_tests();
    if (!s_dump) view_cursor_tests();
    if (!s_dump) view_timer_tests();
    if (!s_dump) radar_placement_tests();
    if (!s_dump) test_geometry_lower_only();
    if (!s_dump) test_resolve_tier_lower_only();
    if (!s_dump) test_geometry_two_rows();
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
