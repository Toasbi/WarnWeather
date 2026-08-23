// Host-run golden-rect tests for src/c/windows/layout.c.
// Build & run via scripts/test-c.sh (compiled twice: bare and -DPBL_PLATFORM_EMERY).
// "dump" arg prints actuals in table form for updating goldens deliberately.
#include <stdio.h>
#include <string.h>
#include "c/layers/status_metrics.h"
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
    // top_status 17 = status_min_band_h(Gothic 18), the shortest clamp-free strip band; the
    // calendar follows it at y=15 and keeps its 45px / 3 rows, so the 2px come out of the
    // calendar->clock gap. Clock, status band and forecast are unchanged: they anchor to
    // CALENDAR_STATUS_HEIGHT, not to the strip's band.
    // 15, not the band's 17: calendar_y is the strip's INK height (status_strip_ink_h ==
    // 17 - STATUS_TOP_STRIP_LIFT), so the calendar's first painted row sits on the strip's
    // first unpainted one. Those 2 rows move from the calendar's top gap to its bottom one,
    // where the upper status row's line was 1px away — see calendar_status_clearance.
    check("full.top_status",   L.top_status,   0, 0, 144, 17);
    check("full.top",          L.top,          0, 15, 144, 45);
    check("full.status",       L.status,       0, 97, 144, 20);
    check("full.status_lower", L.status_lower, 0, 97, 144, 20);
    check("full.time",         L.time,         0, 58, 144, 45);
    check("full.bottom",       L.bottom,       0, 117, 144, 51);
    check("full.loading",      L.loading,      0, 97, 144, 71);
    check("full.radar",        L.radar,        0, 15, 144, 45);

    L = layout_compute(BOUNDS, LAYOUT_TIER_COMPACT, false, FC_BAND_H);
    if (s_dump) printf("  COMPACT !dual\n");
    check("compact.top",          L.top,          0, 15, 144, 30);
    // Lone status: 17 = status_min_band_h(Gothic 18) instead of the calendar_h/3 slot's 15,
    // bottom-anchored 3px into the clock band (time_y 58 + 3 - 17). Its bottom row stays 60 as
    // before, so the seated line does not move; the 2 extra px grow up into the calendar band.
    check("compact.status",       L.status,       0, 44, 144, 17);
    check("compact.status_lower", L.status_lower, 0, 44, 144, 17);
    check("compact.time",         L.time,         0, 58, 144, 45);
    check("compact.bottom",       L.bottom,       0, 103, 144, 65);
    check("compact.loading",      L.loading,      0, 103, 144, 65);
    check("compact.radar",        L.radar,        0, 15, 144, 30);

    L = layout_compute(BOUNDS, LAYOUT_TIER_NONE, false, FC_BAND_H);
    if (s_dump) printf("  NONE !dual\n");
    check("none.top",     L.top,     0, 15, 144, 0);   // calendar hidden; band top tracks the strip ink
    check("none.time",    L.time,    0, 16, 144, 45);   // 14 + NONE_TIME_DROP 2
    check("none.status",  L.status,  0, 59, 144, 22);
    check("none.bottom",  L.bottom,  0, 81, 144, 87);
    check("none.loading", L.loading, 0, 81, 144, 87);
    check("none.radar",   L.radar,   0, 81, 144, 87);

    L = layout_compute(BOUNDS, LAYOUT_TIER_COMPACT, true, FC_BAND_H);
    if (s_dump) printf("  COMPACT dual\n");
    // Dense upper band: HEIGHT unchanged at 15 — two stacked rows squeeze to the smaller
    // full-tier font (Gothic 14), for which the calendar_h/3 slot is already clamp-free.
    // POSITION 43 -> 44: every compact preset now seats its band's TOP on the same row
    // (time_y 58 - COMPACT_STATUS_TOP_ABOVE_CLOCK 14 == compactCal's 44) instead of hanging its
    // BOTTOM off the clock, which made the gap under the preset-independent calendar depend on
    // the band's own height and font. MEASURED before the change (basalt, compactDense via
    // layoutPreset=compactDense + radarMode=status): the calendar's last digit row ended on 42
    // and this row's text cap started on 46, one row closer than compactCal's 47 — and its
    // highlight box, which starts at the band top, sat on row 43 with the calendar's ink ending
    // on 42, i.e. touching. Both now match compactCal exactly. The 1px comes out of the row's
    // own air BELOW its ink (its tails ended 6 blank rows above the clock's ink, now 5); the
    // clock, the lower band and the forecast are untouched, as the goldens below pin.
    // 45 = shared anchor 44 + dense ink lift -1 (COMPACT_DENSE_ROW_INK_LIFT): the dense
    // row's Gothic-14 ink sat high in its slot (ink gaps 3 above / 6 below, emulator
    // audit 2026-08-15); dropping the band 1px centres it at 4 / 5.
    check("dualc.status",       L.status,       0, 45, 144, 15);
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
    // top_status 21 = status_min_band_h(Gothic 24), the shortest clamp-free strip band; the
    // calendar follows its INK at y=21 (2 + 21 - STATUS_TOP_STRIP_LIFT) and keeps its 60px /
    // 3 rows, so the px come out of the calendar->clock gap, which has room to spare on emery.
    // Everything below the strip (clock, status band, forecast) is anchored to
    // CALENDAR_STATUS_HEIGHT and unchanged. emery never showed the compact calendar->status
    // crowding basalt did (its ink gap was already 7px, see calendar_status_clearance); the
    // same derived anchor simply widens it, and nothing below the calendar moves.
    check("full.top_status",   L.top_status,   2, 2, 196, 21);
    check("full.top",          L.top,          2, 23, 196, 60);   // strip ink 21 + STATUS_STRIP_CAL_GAP 2
    check("full.status",       L.status,       2, 132, 196, 24);
    check("full.status_lower", L.status_lower, 2, 132, 196, 24);
    // 80 = time_y 82 - FULL_TIME_INK_LIFT 2: the audit measured the clock 11 blank rows
    // from the calendar above vs 5 to the status row below; the lift plus the calendar's
    // STATUS_STRIP_CAL_GAP drop centre it at 7 / 7 while forecast_y and the status bands
    // keep deriving from the unlifted time_y.
    check("full.time",         L.time,         2, 80, 196, 60);
    check("full.bottom",       L.bottom,       2, 156, 198, 68);
    check("full.loading",      L.loading,      2, 132, 196, 92);  // was (2,142,196,82): unified rule = status top → bottom pad
    check("full.radar",        L.radar,        2, 23, 196, 60);

    L = layout_compute(BOUNDS, LAYOUT_TIER_COMPACT, false, FC_BAND_H);
    if (s_dump) printf("  COMPACT !dual (emery)\n");
    check("compact.top",     L.top,     2, 23, 196, 40);   // strip ink 21 + STATUS_STRIP_CAL_GAP 2
    // Lone status: 21 = status_min_band_h(Gothic 24) instead of the calendar_h/3 slot's 20,
    // bottom-anchored 3px into the clock band (time_y 82 + 3 - 21). Its bottom row stays 84 as
    // before, so the seated line does not move; the 1 extra px grows up into the calendar band.
    // 64 = the shared anchor, lone ink lift 0: the audit's 9 above / 7 below is centred
    // at 7 / 7 by the calendar's STATUS_STRIP_CAL_GAP drop alone.
    check("compact.status",  L.status,  2, 64, 196, 21);
    check("compact.time",    L.time,    2, 82, 196, 60);
    check("compact.bottom",  L.bottom,  2, 142, 198, 82);
    check("compact.loading", L.loading, 2, 142, 196, 82);
    check("compact.radar",   L.radar,   2, 23, 196, 40);

    L = layout_compute(BOUNDS, LAYOUT_TIER_NONE, false, FC_BAND_H);
    if (s_dump) printf("  NONE !dual (emery)\n");
    check("none.top",     L.top,     2, 23, 196, 0);
    check("none.time",    L.time,    2, 24, 196, 60);   // 23 + NONE_TIME_DROP 1
    check("none.status",  L.status,  2, 83, 196, 30);
    check("none.bottom",  L.bottom,  2, 113, 198, 111);
    check("none.loading", L.loading, 2, 113, 198, 111);
    check("none.radar",   L.radar,   2, 113, 198, 111);

    L = layout_compute(BOUNDS, LAYOUT_TIER_COMPACT, true, FC_BAND_H);
    if (s_dump) printf("  COMPACT dual (emery)\n");
    // Dense upper band: HEIGHT unchanged at 20 (the calendar_h/3 slot is already clamp-free at
    // the full-tier Gothic 18 both rows squeeze to). POSITION 63 = the shared anchor 64
    // (time_y 82 - COMPACT_STATUS_TOP_ABOVE_CLOCK 18) + dense ink lift 2
    // (COMPACT_DENSE_ROW_INK_LIFT 1): the dense row's Gothic-18 ink floated low in its
    // slot — gaps 11 above / 7 below (emulator audit 2026-08-15) — and the lift plus the
    // calendar's STATUS_STRIP_CAL_GAP drop centre it at 8 / 8.
    // The band top numerically returns to the pre-shared-anchor 62, but the defect that
    // position had — its full-band highlight box starting AT the band top, over the
    // calendar's clearance — is gone: the box is now font-sized and seated on the cap
    // (status_highlight_extent), so its top sits below the band top and still clears the
    // calendar by at least the compactCal reference (calendar_status_clearance pins both).
    check("dualc.status",       L.status,       2, 63, 196, 20);
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

// Brief Task 3: per-band availability downgrades. A stripped UPPER promotes the surviving
// lower row into the upper slot (see test_resolve_strip_promotes_upper) — the forecast row
// lands where a lone row normally sits, not in the swap layout's lower band.
static void test_resolve_no_health_no_radar(void) {
    // health+forecast dense, but neither capability -> both fall back sanely.
    ViewSpec s = view_spec_unpack(pack(2, 1, 0, STATUS_SRC_HEALTH, STATUS_SRC_FORECAST));
    ViewSpec r = view_spec_resolve(s, /*has_radar*/false, /*has_health*/false);
    expect("resolve_nhnr.health_dropped_fc_promoted", r.status_upper == STATUS_SRC_FORECAST, true);
    expect("resolve_nhnr.lower_vacated", r.status_lower == STATUS_SRC_NONE, true);
    // radar row without radar data collapses; the forecast row takes the upper slot.
    ViewSpec s2 = view_spec_unpack(pack(2, 1, 0, STATUS_SRC_RADAR, STATUS_SRC_FORECAST));
    ViewSpec r2 = view_spec_resolve(s2, false, true);
    expect("resolve_nhnr.radar_dropped_fc_promoted", r2.status_upper == STATUS_SRC_FORECAST, true);
    expect("resolve_nhnr.radar_lower_vacated", r2.status_lower == STATUS_SRC_NONE, true);
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

    // Availability resolve. A dropped upper PROMOTES the surviving lower into the upper slot
    // (a stripped dense view renders as the plain compact layout, not the swap layout). The
    // lone survivor is a single status row, so it keeps the COMPACT (larger) status font
    // under a compact calendar — only a DUAL squeezes to the full-tier (smaller) font.
    ViewSpec r = view_spec_resolve(view_spec_unpack(pack(2, 1, 0, STATUS_SRC_HEALTH, STATUS_SRC_FORECAST)),
                                   true, false);
    expect("resolve.nohealth.survivor_promoted", r.status_upper == STATUS_SRC_FORECAST, true);
    expect("resolve.nohealth.lower_vacated", r.status_lower == STATUS_SRC_NONE, true);
    expect("resolve.nohealth.lone_upper_compact", r.status_tier == LAYOUT_TIER_COMPACT, true);
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
    expect("rdrstat.no_radar_fc_promoted", rsn.status_upper == STATUS_SRC_FORECAST, true);
    expect("rdrstat.no_radar_lower_vacated", rsn.status_lower == STATUS_SRC_NONE, true);
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
    // The strip band is the same clamp-free height peek creates on the main window (17 / 23),
    // so growing it shifts the peek's clock/status/body down by the same amount — peek has no
    // calendar to absorb it, and it is a transient overlay layout with no pinned clock.
#ifndef PBL_PLATFORM_EMERY
    // strip 17; available 117-17-20=80; clock 80*45/96=37; status@54 h20; forecast@74 h43.
    check("peek.top_status", L.top_status, 0, 0,  144, 17);
    check("peek.top",        L.top,        0, 17, 144, 0);
    check("peek.time",       L.time,       0, 17, 144, 37);
    check("peek.status",     L.status,     0, 54, 144, 20);
    check("peek.bottom",     L.bottom,     0, 74, 144, 43);
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
    // strip 17; available 117-17-40=60; clock 60*45/96=28; health@45 weather@65 (h20); fc@85 h32.
    check("peekDual.time",         Ld.time,         0, 17, 144, 28);
    check("peekDual.status",       Ld.status,       0, 45, 144, 20);
    check("peekDual.status_lower", Ld.status_lower, 0, 65, 144, 20);
    check("peekDual.bottom",       Ld.bottom,       0, 85, 144, 32);
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
    check("cal2radar.top",   L.top,   0, 15, 144, 30);    // 2-row calendar band intact

    // radar in body under a 3-row calendar.
    s = view_spec_unpack(pack(3, 1, 2, STATUS_SRC_RADAR, STATUS_SRC_NONE));
    L = layout_compute_spec(BOUNDS, &s, FC_BAND_H);
    check("cal3radar.radar", L.radar, 0, 117, 144, 51);   // == full L.bottom

    // radar in top, forecast in body, forecast status row (upper).
    s = view_spec_unpack(pack(3, 2, 0, STATUS_SRC_FORECAST, STATUS_SRC_NONE));
    L = layout_compute_spec(BOUNDS, &s, FC_BAND_H);
    // Radar shares L.top with the calendar, so it slides down with it under the taller strip.
    check("rdrtop.radar", L.radar, 0, 15, 144, 45);       // == full L.top
    check("rdrtop.bottom", L.bottom, 0, 117, 144, 51);    // status band present → squeezed forecast

    // statusless radar-top forecast flick.
    s = view_spec_unpack(pack(3, 2, 0, STATUS_SRC_NONE, STATUS_SRC_NONE));
    L = layout_compute_spec(BOUNDS, &s, FC_BAND_H);
    check("rdrtopNone.radar",  L.radar,  0, 15, 144, 45);   // radar keeps the full top band
    check("rdrtopNone.bottom", L.bottom, 0, 103, 144, 65);  // no status row → forecast == compact tier
    check("rdrtopNone.loading", L.loading, 0, 103, 144, 65);// loading covers the reclaimed forecast
#endif
}

// Brief Task 4: per-field band geometry. Relationship (not magic-pixel) assertions on a
// fixed 144x168 reference with fc_band_h 14 (== WEATHER_STATUS_HEIGHT, so a carved lower
// band exactly fills its reserved slot) — the relationships hold on both platform compiles.
// Ink-centring lifts — mirrors the *_INK_LIFT constants in src/c/windows/layout.c (same
// mirroring convention as the font table in the seating section below). Each compact preset
// lifts its upper band off the shared anchor by its own correction; the swapped view's
// clock rect lifts too.
#ifdef PBL_PLATFORM_EMERY
#define LONE_ROW_LIFT 0     // COMPACT_LONE_ROW_INK_LIFT
#define DENSE_ROW_LIFT 1    // COMPACT_DENSE_ROW_INK_LIFT
#define SWAP_TIME_LIFT 0    // SWAP_TIME_INK_LIFT
#else
#define LONE_ROW_LIFT 0
#define DENSE_ROW_LIFT (-1)
#define SWAP_TIME_LIFT 0
#endif

static void test_geometry_lower_only(void) {
    // compactCal + swap: forecast in the lower band, upper empty.
    ViewSpec s = view_spec_unpack(pack(2, 1, 0, STATUS_SRC_NONE, STATUS_SRC_FORECAST));
    MainLayout L = layout_compute_spec(GRect(0, 0, 144, 168), &s, 14 /*fc_band_h*/);
    ViewSpec up = view_spec_unpack(pack(2, 1, 0, STATUS_SRC_FORECAST, STATUS_SRC_NONE));  // normal upper
    MainLayout Lu = layout_compute_spec(GRect(0, 0, 144, 168), &up, 14);
    int freed_row = Lu.top.size.h / 2;   // 2-row compact calendar -> one row is cal_h/2
    // The lower band starts inside the clock band and abuts the forecast body top: it is carved
    // from the freed_row-sized slot at the top of the bottom band, but the clamp-free band is
    // TALLER than that slot, so its surplus grows UPWARD into the clock band's blank bottom
    // margin (the seated line and the forecast both keep exactly the pixels they had).
    expect("geometry_lower_only.below_clock_top",
           L.status_lower.origin.y > L.time.origin.y, true);
    // The swapped clock's rect carries SWAP_TIME_INK_LIFT (emery), so the overhang into
    // its band is measured from the lifted rect.
    expect("geometry_lower_only.overhangs_clock_slack",
           (L.time.origin.y + L.time.size.h) - L.status_lower.origin.y
               == L.status_lower.size.h - freed_row - SWAP_TIME_LIFT, true);
    expect("geometry_lower_only.abuts_forecast",
           L.status_lower.origin.y + L.status_lower.size.h <= L.bottom.origin.y + 1, true);
    expect("geometry_lower_only.has_height", L.status_lower.size.h > 0, true);
    expect("geometry_lower_only.upper_collapsed", L.status.size.h == 0, true);
    // With no upper status the clock reclaims the freed 3rd-calendar-row: it sits exactly one
    // calendar row higher than in the un-swapped view (it can no longer be stated as "abuts
    // L.top's bottom" — the calendar band now slides down under the font-sized strip while the
    // clock stays anchored to the strip's reserve, so L.top overhangs the clock band's top).
    expect("geometry_lower_only.clock_reclaims_freed_row",
           L.time.origin.y == Lu.time.origin.y - freed_row - SWAP_TIME_LIFT, true);
    // Size-preserving swap: the lone lower status uses the SAME band height and COMPACT tier as a
    // lone upper status — swapping changes position, not size (a 100% top/bottom size swap).
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
    // Upper (health) resolves away → the lone forecast survivor is PROMOTED to the upper
    // slot (see test_resolve_strip_promotes_upper); as a lone row it stays COMPACT.
    ViewSpec r = view_spec_resolve(view_spec_unpack(pack(2, 1, 0, STATUS_SRC_HEALTH, STATUS_SRC_FORECAST)),
                                   true, false);
    expect("resolve_tier_lower_only.survivor_promoted", r.status_upper == STATUS_SRC_FORECAST, true);
    expect("resolve_tier_lower_only.lower_vacated", r.status_lower == STATUS_SRC_NONE, true);
    expect("resolve_tier_lower_only.lone_upper_compact", r.status_tier == LAYOUT_TIER_COMPACT, true);

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

// A capability-stripped UPPER must not leave a lone LOWER row behind: the survivor is
// promoted to the upper slot, so a degraded dense view renders as the plain compact
// layout — not as the (unrequested) swap-clock/status layout. Concretely: compactDense's
// slot-0 default [CAL2_RF_D] with no cached radar frame yet must look like compactCal,
// and must not jump the clock when radar data lands. A CONFIGURED lone lower (the swap
// toggle) has nothing stripped and stays below. Mirrors the aplite twin's unpack
// collapse ("a clean single view, not an unrequested swap", layout_aplite.c).
static void test_resolve_strip_promotes_upper(void) {
    // compactDense default (radar upper + forecast lower), radar data missing.
    ViewSpec r = view_spec_resolve(view_spec_unpack(pack(2, 1, 0, STATUS_SRC_RADAR, STATUS_SRC_FORECAST)),
                                   false, true);
    expect("strip_promote.upper_forecast", r.status_upper == STATUS_SRC_FORECAST, true);
    expect("strip_promote.lower_vacated", r.status_lower == STATUS_SRC_NONE, true);
    expect("strip_promote.tier_compact", r.status_tier == LAYOUT_TIER_COMPACT, true);

    // The promoted spec renders EXACTLY like the plain lone-upper view — the clock keeps
    // its seat, so nothing moves when radar data arrives and the dense pair comes back.
    ViewSpec plain = view_spec_resolve(view_spec_unpack(pack(2, 1, 0, STATUS_SRC_FORECAST, STATUS_SRC_NONE)),
                                       true, true);
    MainLayout Lp = layout_compute_spec(BOUNDS, &r, FC_BAND_H);
    MainLayout Lu = layout_compute_spec(BOUNDS, &plain, FC_BAND_H);
    expect("strip_promote.same_clock", Lp.time.origin.y == Lu.time.origin.y, true);
    expect("strip_promote.same_status_band",
           Lp.status.origin.y == Lu.status.origin.y && Lp.status.size.h == Lu.status.size.h, true);
    expect("strip_promote.same_body", Lp.bottom.origin.y == Lu.bottom.origin.y
                                   && Lp.bottom.size.h == Lu.bottom.size.h, true);

    // A configured lone lower (the swap layout) has nothing stripped — stays below.
    ViewSpec c = view_spec_resolve(view_spec_unpack(pack(2, 1, 0, STATUS_SRC_NONE, STATUS_SRC_FORECAST)),
                                   true, true);
    expect("strip_promote.swap_untouched",
           c.status_upper == STATUS_SRC_NONE && c.status_lower == STATUS_SRC_FORECAST, true);

    // A stripped LOWER with a surviving upper needs no promotion (dense health+radar view,
    // radar data missing): the health row keeps its seat, the chart body demotes.
    ViewSpec hu = view_spec_resolve(view_spec_unpack(pack(2, 1, 2, STATUS_SRC_HEALTH, STATUS_SRC_RADAR)),
                                    false, true);
    expect("strip_promote.upper_kept", hu.status_upper == STATUS_SRC_HEALTH, true);
    expect("strip_promote.lower_dropped", hu.status_lower == STATUS_SRC_NONE, true);
    expect("strip_promote.body_fc", hu.body == BODY_FORECAST, true);
    printf("resolve_strip_promotes_upper OK\n");
}

// A lone status row in the NONE tier occupies the SAME band whether the wire names it upper
// or lower. There is no calendar row to swap it out of there — the row already sits directly
// under the clock — so a swapped (lower-only) NONE view must not leave the vacated upper slot
// as dead space above it (reported bug: compactCal + swap compiles its health/radar flick views
// as lower-only NONE views, which rendered clock / gap / status / short graph).
static void test_geometry_none_lone_row(void) {
    ViewSpec up = view_spec_unpack(pack(1, 0, 1, STATUS_SRC_HEALTH, STATUS_SRC_NONE));
    ViewSpec lo = view_spec_unpack(pack(1, 0, 1, STATUS_SRC_NONE, STATUS_SRC_HEALTH));
    MainLayout Lu = layout_compute_spec(BOUNDS, &up, FC_BAND_H);
    MainLayout Ll = layout_compute_spec(BOUNDS, &lo, FC_BAND_H);
    expect("geometry_none_lone_row.same_band_y", Ll.status_lower.origin.y == Lu.status.origin.y, true);
    expect("geometry_none_lone_row.same_band_h", Ll.status_lower.size.h == Lu.status.size.h, true);
    // The body (health graph / radar) keeps its full height — the swap moved nothing.
    expect("geometry_none_lone_row.body_full_height", Ll.bottom.size.h == Lu.bottom.size.h, true);
    expect("geometry_none_lone_row.body_y", Ll.bottom.origin.y == Lu.bottom.origin.y, true);
    // The row sits under the clock, with the body directly below it. (Compared against the
    // clock band's TOP: the NONE tier drops the clock by NONE_TIME_DROP into its own band, so
    // its nominal bottom overhangs the status band's top by those few px — true of the upper
    // row today as well.)
    expect("geometry_none_lone_row.below_clock",
           Ll.status_lower.origin.y > Ll.time.origin.y, true);
    expect("geometry_none_lone_row.abuts_body",
           Ll.status_lower.origin.y + Ll.status_lower.size.h == Ll.bottom.origin.y, true);
    expect("geometry_none_lone_row.upper_collapsed", Ll.status.size.h == 0, true);
    expect("geometry_none_lone_row.loading_covers_body",
           Ll.loading.origin.y == Ll.bottom.origin.y && Ll.loading.size.h == Ll.bottom.size.h, true);
    // A statusless NONE view reclaims the band too: the body starts right under the clock.
    ViewSpec no = view_spec_unpack(pack(1, 0, 0, STATUS_SRC_NONE, STATUS_SRC_NONE));
    MainLayout Ln = layout_compute_spec(BOUNDS, &no, FC_BAND_H);
    expect("geometry_none_lone_row.statusless_reclaims",
           Ln.bottom.origin.y == Lu.status.origin.y, true);
    printf("geometry_none_lone_row OK\n");
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

// The shared tier/status helpers in layout.h — the rules layout.c, the aplite twin and
// main_window all read from one place instead of restating a ternary each.
static void tier_helper_tests(void) {
    // The composition identity: wire tier -> calendar_rows -> LayoutTier. Wire 0 (a disabled
    // cycle slot) and wire 1 (a deliberate no-calendar view) both land on NONE.
    struct { uint8_t wire; uint8_t rows; LayoutTier tier; } t[] = {
        { 0, 0, LAYOUT_TIER_NONE }, { 1, 0, LAYOUT_TIER_NONE },
        { 2, 2, LAYOUT_TIER_COMPACT }, { 3, 3, LAYOUT_TIER_FULL },
    };
    for (unsigned i = 0; i < sizeof(t) / sizeof(t[0]); i++) {
        expect("tier_helpers.rows_for_wire", layout_rows_for_wire_tier(t[i].wire) == t[i].rows, true);
        expect("tier_helpers.tier_for_rows",
               layout_tier_for_rows(layout_rows_for_wire_tier(t[i].wire)) == t[i].tier, true);
        // …and that is exactly what unpack puts in the spec (lone row: no promotion).
        ViewSpec s = view_spec_unpack(pack(t[i].wire, 1, 0, STATUS_SRC_FORECAST, STATUS_SRC_NONE));
        expect("tier_helpers.unpack_agrees_rows", s.calendar_rows == t[i].rows, true);
        expect("tier_helpers.unpack_agrees_tier", s.status_tier == t[i].tier, true);
    }
    // calendar_rows == 1 is a value no producer emits (the field contract is 0/2/3). Pinning
    // the fallback so the choice is explicit: a corrupt value drops the calendar band rather
    // than being handed a 3-row one. layout_compute_spec used to answer FULL here while
    // view_spec_resolve answered NONE — they now agree on NONE.
    expect("tier_helpers.stray_rows_1_is_none",
           layout_tier_for_rows(1) == LAYOUT_TIER_NONE, true);

    // The promotion rule: only a DUAL squeezes a COMPACT status to the full-tier font.
    expect("tier_helpers.promote_compact_dual",
           layout_status_tier(LAYOUT_TIER_COMPACT, true) == LAYOUT_TIER_FULL, true);
    expect("tier_helpers.lone_compact_stays",
           layout_status_tier(LAYOUT_TIER_COMPACT, false) == LAYOUT_TIER_COMPACT, true);
    expect("tier_helpers.full_unchanged",
           layout_status_tier(LAYOUT_TIER_FULL, true) == LAYOUT_TIER_FULL, true);
    expect("tier_helpers.none_never_promotes",
           layout_status_tier(LAYOUT_TIER_NONE, true) == LAYOUT_TIER_NONE, true);

    // layout_status_visible / layout_status_band are positional: a source is visible from
    // either slot, and the band it renders in is the lower one only when the LOWER slot
    // carries it. Upper-only (the plain compact view) and lower-only (the swap layout).
    ViewSpec up = view_spec_unpack(pack(2, 1, 0, STATUS_SRC_FORECAST, STATUS_SRC_NONE));
    ViewSpec lo = view_spec_unpack(pack(2, 1, 0, STATUS_SRC_NONE, STATUS_SRC_FORECAST));
    expect("tier_helpers.visible_upper_only", layout_status_visible(&up, STATUS_SRC_FORECAST), true);
    expect("tier_helpers.visible_lower_only", layout_status_visible(&lo, STATUS_SRC_FORECAST), true);
    expect("tier_helpers.invisible_other_source",
           layout_status_visible(&up, STATUS_SRC_HEALTH), false);
    MainLayout Lu = layout_compute_spec(BOUNDS, &up, FC_BAND_H);
    MainLayout Ll = layout_compute_spec(BOUNDS, &lo, FC_BAND_H);
    expect("tier_helpers.band_upper",
           layout_status_band(&up, &Lu, STATUS_SRC_FORECAST).origin.y == Lu.status.origin.y, true);
    expect("tier_helpers.band_lower",
           layout_status_band(&lo, &Ll, STATUS_SRC_FORECAST).origin.y == Ll.status_lower.origin.y, true);
    printf("tier_helpers OK\n");
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

// ── Seating invariant: no band the layout produces may clamp ─────────────────
// Content height of the font each band's row renders in — mirrors row_font() in
// src/c/layers/status_row.c. A Gothic font's measured content height is exactly its nominal
// size (verified on device at 14 / 18 / 24), so the size doubles as the metric here.
#ifdef PBL_PLATFORM_EMERY
#define TOP_ROW_H 24        // STATUS_TOP_TIER_FONT_KEY
#define NONE_ROW_H 24       // NONE_ROW_FONT_KEY
#define COMPACT_ROW_H 24    // COMPACT_ROW_FONT_KEY
#define FULL_ROW_H 18       // STATUS_FULL_TIER_FONT_KEY (a DUAL squeezes both rows to this)
#define FC_CLEARANCE 1      // STATUS_FORECAST_CLEARANCE
#else
#define TOP_ROW_H 18
#define NONE_ROW_H 18
#define COMPACT_ROW_H 18
#define FULL_ROW_H 14
#define FC_CLEARANCE 3
#endif
// The SHIPPING forecast-abutting band: status_forecast_band_h() == content_h + 2*clearance.
// (FC_BAND_H above is a 24px stand-in on emery; the seating sweep uses the real value.)
#define FC_BAND_H_SHIPPING (FULL_ROW_H + 2 * FC_CLEARANCE)

static int status_row_content_h(uint8_t tier) {
    return (tier == LAYOUT_TIER_NONE) ? NONE_ROW_H
         : (tier == LAYOUT_TIER_COMPACT) ? COMPACT_ROW_H : FULL_ROW_H;
}

// The invariant the band resize exists to hold: status_seat_y() must not CLAMP on any band the
// layout produces. A clamped line is lifted off the band centre, so the row reads high and its
// gaps to the neighbours above/below go asymmetric — and every mark that co-centres on the
// glyph (slot icons, the sun arrow, the threshold-highlight box) follows the lifted cap while
// the band itself does not. "No lift" == the seated cap centre lands exactly on band_h/2.
static void expect_no_lift(const char *view, const char *band, int band_h, int content_h) {
    if (band_h <= 0) { return; }   // collapsed band (row absent) — nothing is seated in it
    int cap_cy = status_glyph_center_y(status_seat_y(band_h, content_h), content_h);
    if (cap_cy != band_h / 2) {
        printf("FAIL seating %s.%s: band_h %d, font %d -> cap centre %d, band centre %d"
               " (shortest clamp-free band for this font is %d)\n",
               view, band, band_h, content_h, cap_cy, band_h / 2,
               status_min_band_h(content_h));
        s_failures++;
    }
}

// The top strip is the ONE line deliberately NOT cap-centred, so expect_no_lift() above is the
// wrong predicate for it: its band stays clamp-free (which is what keeps every band below it
// from moving, and what makes the strip's ink end exactly STATUS_TOP_STRIP_LIFT rows above its
// band bottom — see status_strip_ink_h, the calendar's anchor) but its CONTENT seats
// STATUS_TOP_STRIP_LIFT rows higher inside that band. Exempt because the strip's top edge IS the
// screen's top edge — the air a centred cap leaves above it is invisible, while the gap below,
// down to the calendar's first row, is what the eye reads.
//
// Stronger than merely tolerating a lift: pinned in both directions.
//   1. the band is still exactly the shortest clamp-free one (so no band below it moves),
//   2. the cap sits exactly STATUS_TOP_STRIP_LIFT rows above the band centre — no less (the
//      lift must actually move the line) and no more (the cap must stay clear of row 0), and
//   3. the descender tails still fit inside the band, so nothing is shaved at the bottom.
// Topmost row the cap-centred Gothic-18 strip line inks in its 17px band. MEASURED on a basalt
// emulator capture at abe81ac (rows 3..13); the seating model's own cap fraction cannot be
// inverted to a cap height, so the clipping bound is pinned against the measurement.
#define STRIP_CAP_TOP_ROW_CENTRED 3

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
        printf("FAIL seating %s.top_status: cap centre %d, expected %d"
               " (band centre %d lifted by %d)\n",
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
    // status_min_band_h's own values, so a change to the font-metric fractions surfaces here
    // rather than as a silent 1px drift in every band.
    expect("seating.min_band.gothic14", status_min_band_h(14) == 13, true);
    expect("seating.min_band.gothic18", status_min_band_h(18) == 17, true);
    // 21, not 23: status_glyph_below(24) models the MEASURED Gothic-24 cap (14 px, centre on
    // the content-box bottom minus 7) instead of the retired 5/9 fraction, which put the cap
    // centre 1 px high and so over-stated the reserve emery's bands need by 1 px each side.
    expect("seating.min_band.gothic24", status_min_band_h(24) == 21, true);
    // Teeth check: the pre-resize heights really did clamp (top strip 14, lone compact 15 /
    // 20). If these ever stop clamping the sweep below has become vacuous. emery's pre-resize
    // STRIP band (21) is deliberately absent: under the measured cap metric it is exactly
    // status_min_band_h(Gothic 24), i.e. it never actually clamped and abe81ac grew it on the
    // strength of the old metric's error alone.
    expect("seating.old_strip_clamped",
           status_glyph_center_y(status_seat_y(14, 18), 18) != 14 / 2, true);
    expect("seating.old_lone_compact_clamped",
           status_glyph_center_y(status_seat_y(15, 18), 18) != 15 / 2, true);
    expect("seating.old_emery_lone_compact_clamped",
           status_glyph_center_y(status_seat_y(20, 24), 24) != 20 / 2, true);
    // …and the general form of that teeth check, independent of any historical band:
    // status_min_band_h() is TIGHT, not merely sufficient — one pixel less clamps at every
    // status font, so no band the layout derives from it carries a spare row it could lose.
    const int fonts[] = { 14, 18, 24 };
    for (unsigned f = 0; f < sizeof(fonts) / sizeof(fonts[0]); f++) {
        int c = fonts[f], short_band = status_min_band_h(c) - 1;
        expect("seating.min_band_is_tight",
               status_glyph_center_y(status_seat_y(short_band, c), c) != short_band / 2, true);
    }
    // Teeth for the strip's lift itself (expect_strip_lift would pass vacuously at 0): it has to
    // be a real move, and it has to keep the cap clear of the screen's top edge. MEASURED on
    // basalt at abe81ac: the cap-centred Gothic-18 line inks rows 3..13 in its 17px band, so the
    // lift puts its topmost row on 3 - lift and a lift of 3 would sit it flush on row 0.
    expect("seating.strip_lift_moves_the_line", STATUS_TOP_STRIP_LIFT > 0, true);
    expect("seating.strip_lift_clears_row_0",
           STRIP_CAP_TOP_ROW_CENTRED - STATUS_TOP_STRIP_LIFT >= 1, true);

    struct { const char *name; int tier; int su; int sl; } views[] = {
        { "fullCal",      3, STATUS_SRC_FORECAST, STATUS_SRC_NONE     },
        { "fullCalNone",  3, STATUS_SRC_NONE,     STATUS_SRC_NONE     },
        { "compactCal",   2, STATUS_SRC_FORECAST, STATUS_SRC_NONE     },
        { "compactSwap",  2, STATUS_SRC_NONE,     STATUS_SRC_FORECAST },
        { "compactDense", 2, STATUS_SRC_HEALTH,   STATUS_SRC_FORECAST },
        { "noCal",        1, STATUS_SRC_FORECAST, STATUS_SRC_NONE     },
        { "noCalDense",   1, STATUS_SRC_HEALTH,   STATUS_SRC_FORECAST },
    };
    for (unsigned i = 0; i < sizeof(views) / sizeof(views[0]); i++) {
        ViewSpec spec = view_spec_unpack(pack(views[i].tier, 1, 0, views[i].su, views[i].sl));
        MainLayout L = layout_compute_spec(BOUNDS, &spec, FC_BAND_H_SHIPPING);
        int row_h = status_row_content_h(spec.status_tier);
        expect_strip_lift(views[i].name, L.top_status.size.h, TOP_ROW_H);
        if (spec.status_upper != STATUS_SRC_NONE) {
            expect_no_lift(views[i].name, "status", L.status.size.h, row_h);
        }
        if (spec.status_lower != STATUS_SRC_NONE) {
            expect_no_lift(views[i].name, "status_lower", L.status_lower.size.h, row_h);
        }
        // The two bands this resize introduced, tied to the rule that sized them.
        expect("seating.strip_is_shortest_clamp_free",
               L.top_status.size.h == status_min_band_h(TOP_ROW_H), true);
        if (views[i].tier == 2 && spec.status_upper != STATUS_SRC_NONE
                && spec.status_lower == STATUS_SRC_NONE) {
            expect("seating.lone_compact_is_shortest_clamp_free",
                   L.status.size.h == status_min_band_h(COMPACT_ROW_H), true);
        }
    }

    // Quick-view peek: its status band(s) are the full-tier band, its strip the same as above.
    ViewSpec pk = view_spec_unpack(pack(3, 1, 0, STATUS_SRC_FORECAST, STATUS_SRC_NONE));
    pk.top = TOP_BAND_EMPTY; pk.calendar_rows = 0; pk.status_tier = LAYOUT_TIER_FULL;
    MainLayout Lp = layout_compute_peek(GRect(0, 0, 144, 117), &pk, FC_BAND_H_SHIPPING);
    expect_strip_lift("peek", Lp.top_status.size.h, TOP_ROW_H);
    expect_no_lift("peek", "status", Lp.status.size.h, FULL_ROW_H);
    printf("seating_no_lift OK\n");
}

// ── Calendar → upper-status ink clearance ────────────────────────────────────
// The defect this pins: on the compact tier the calendar band stacks straight onto the upper
// status row's band, and both were placed from BAND edges — the calendar from the strip's band
// bottom, the status row bottom-anchored to the clock. Nothing related the two INK edges, so
// once the strip's band became font-derived the calendar's last digit row slid to within 1px of
// the status row's ink, and the threshold-highlight box (which spans its whole band) overlapped
// that digit row outright. MEASURED on a basalt emulator capture at 49ae377, compactCal: the
// calendar's last row inked rows 34..44, the status row's leftmost slot icon row 46, its text
// cap rows 47..57, its band (and so its highlight box) row 44.
//
// The rule now: the calendar band starts on the strip's first UNPAINTED row
// (status_strip_ink_h), which moves the strip's lifted-line surplus from the dead air above the
// calendar into the gap below it. What that buys is an ink clearance, so an ink clearance is
// what is asserted — in the same unit as STATUS_FORECAST_CLEARANCE, the clearance this same row
// already keeps above the forecast graph.

// Cap height of a status line: content_h/2 + 2, the metric status_glyph_below() encodes
// (MEASURED 9 / 11 / 14 px at Gothic 14 / 18 / 24 — see status_metrics.h).
#define STATUS_CAP_H(content_h) ((content_h) / STATUS_DIGIT_CAP_SLOPE_DEN + STATUS_DIGIT_CAP_ADD)

// Topmost row a seated status line inks (its cap box's first row).
static int status_cap_top(int band_y, int band_h, int content_h) {
    return band_y + status_seat_y(band_h, content_h) + content_h - STATUS_CAP_H(content_h);
}

// The calendar's own text seating — MIRRORS calendar_text_rect()/calendar_cell_rect() in
// src/c/layers/calendar_layer.c (the same mirroring layout_test.c already does for
// status_row.c's font keys above). Non-emery lifts the cell's text rect by FONT_OFFSET; emery
// centres the measured line in the cell and then lifts it by EMERY_CALENDAR_TEXT_SHIFT_Y.
#ifdef PBL_PLATFORM_EMERY
#define CAL_FONT_H 24            // CALENDAR_FONT_KEY = FONT_KEY_GOTHIC_24
#define CAL_TEXT_LIFT 5          // EMERY_CALENDAR_TEXT_SHIFT_Y
#define CAL_TEXT_CENTRED 1
#else
#define CAL_FONT_H 18            // CALENDAR_FONT_KEY = FONT_KEY_GOTHIC_18
#define CAL_TEXT_LIFT 5          // FONT_OFFSET
#define CAL_TEXT_CENTRED 0
#endif

// Rows the calendar band PAINTS, counted from its top edge. Row 0 is painted: the
// today-highlight box fills a whole cell and config_n_today() only ever lands today in the
// FIRST row of a 2-row calendar (wday 0..6) or the first two rows of a 3-row one (wday+7 with
// prev_week), never the last — so the band's LAST ink is always the bottom row's digits, whose
// cap box ends on the content box's bottom edge (digits have no descender tails).
static int calendar_ink_h(int band_h, int rows) {
    int cell_h = band_h / rows;
    int cell_y = (rows - 1) * band_h / rows;    // last row's cell origin (calendar_cell_rect)
    int text_y = CAL_TEXT_CENTRED ? (cell_y + (cell_h - CAL_FONT_H) / 2 - CAL_TEXT_LIFT)
                                 : (cell_y - CAL_TEXT_LIFT);
    return text_y + CAL_FONT_H;
}

static void expect_at_least(const char *name, int got, int least) {
    if (got < least) {
        printf("FAIL %s: %d, expected at least %d\n", name, got, least);
        s_failures++;
    }
}

// Per-preset clearance figures, so the reference (compactCal) can be compared against.
typedef struct { int cal_ink_end; int box_top; int cap_top; bool has_cal_and_row; } Clearance;

// Topmost row of the row's threshold-highlight box: the cap centre minus the box's font
// reach (glyph_below + descender_h), clamped to the band top — MIRRORS the `above` side
// of status_highlight_extent() in src/c/layers/status_row_layout.c, the same way
// status_cap_top above mirrors the seat.
static int status_box_top(int band_y, int band_h, int content_h) {
    int cap_cy = band_y + status_glyph_center_y(status_seat_y(band_h, content_h), content_h);
    int above = status_glyph_below(content_h) + status_descender_h(content_h);
    if (above > cap_cy - band_y) { above = cap_cy - band_y; }
    return cap_cy - above;
}

static void calendar_status_clearance(void) {
    int content_y = BOUNDS.origin.y + (BOUNDS.size.w == 200 ? 2 : 0);   // LAYOUT_PAD_TOP
    // Every preset the layout produces, not just the lone-row one. `rows` 0 = no calendar.
    // compactSwap collapses the upper band (the row moves below the clock), so it has no
    // calendar clearance to pin — but its band ORIGIN still has to obey the shared compact
    // anchor, which assertion 2 below checks for it too.
    struct { const char *name; int tier; int su; int sl; int rows; } views[] = {
        { "fullCal",      3, STATUS_SRC_FORECAST, STATUS_SRC_NONE,     3 },
        { "compactCal",   2, STATUS_SRC_FORECAST, STATUS_SRC_NONE,     2 },
        { "compactDense", 2, STATUS_SRC_HEALTH,   STATUS_SRC_FORECAST, 2 },
        { "compactSwap",  2, STATUS_SRC_NONE,     STATUS_SRC_FORECAST, 2 },
        { "noCal",        1, STATUS_SRC_FORECAST, STATUS_SRC_NONE,     0 },
    };
    const unsigned nviews = sizeof(views) / sizeof(views[0]);
    Clearance got[sizeof(views) / sizeof(views[0])];
    int ref = -1;                       // index of compactCal, the user-approved reference
    int compact_drop = -1;              // L.time.origin.y - L.status.origin.y, shared

    for (unsigned i = 0; i < nviews; i++) {
        ViewSpec spec = view_spec_unpack(pack(views[i].tier, 1, 0, views[i].su, views[i].sl));
        MainLayout L = layout_compute_spec(BOUNDS, &spec, FC_BAND_H_SHIPPING);
        bool compact = (views[i].tier == 2);

        // 1. The anchor itself: the calendar's first painted row IS the strip's first
        //    unpainted one — no gap paid for, none stolen.
        int strip_ink_end = content_y + status_strip_ink_h(L.top_status.size.h, TOP_ROW_H);
        if (L.top.origin.y != strip_ink_end + STATUS_STRIP_CAL_GAP) {
            printf("FAIL clearance %s.anchor: calendar_y %d, strip ink + gap ends at %d\n",
                   views[i].name, L.top.origin.y, strip_ink_end + STATUS_STRIP_CAL_GAP);
            s_failures++;
        }

        // 2. The compact anchor, which is what makes the clearance preset-independent: EVERY
        //    compact preset seats its upper band's TOP on ONE shared anchor row above the
        //    clock band, plus its own documented ink-centring lift (the LIFT mirrors above) —
        //    the anchor equalizes where the bands start, the lift centres where each font's
        //    ink lands. Subtracting the lift back out must recover the same shared anchor for
        //    every preset; anything else is an undocumented drift. (The swapped view's clock
        //    rect lifts too, so its drop carries -SWAP_TIME_LIFT.)
        if (compact) {
            int lift = (strcmp(views[i].name, "compactDense") == 0) ? DENSE_ROW_LIFT
                                                                    : LONE_ROW_LIFT;
            if (strcmp(views[i].name, "compactSwap") == 0) { lift -= SWAP_TIME_LIFT; }
            int drop = (L.time.origin.y - L.status.origin.y) - lift;
            if (compact_drop < 0) {
                compact_drop = drop;
            } else if (drop != compact_drop) {
                printf("FAIL clearance %s.compact_anchor: band top sits %d rows above the clock"
                       " band net of its ink lift, the other compact presets use %d\n",
                       views[i].name, drop, compact_drop);
                s_failures++;
            }
        }

        // 3. The clearance the anchor buys: the calendar's last digit row to the upper status
        //    row's cap. STATUS_FORECAST_CLEARANCE is the floor — the same ink clearance this
        //    row keeps above the forecast graph, mirrored here as FC_CLEARANCE — so both of its
        //    neighbours are pinned in the same unit. (The full tier's calendar has the CLOCK
        //    band below it, not a status row; its upper row rides the forecast, far below, so it
        //    clears trivially.)
        bool has_cal_and_row = (views[i].rows > 0) && (L.status.size.h > 0);
        int cal_ink_end = has_cal_and_row
            ? L.top.origin.y + calendar_ink_h(L.top.size.h, views[i].rows) : 0;
        int cap_top = status_cap_top(L.status.origin.y, L.status.size.h,
                                     status_row_content_h(spec.status_tier));
        got[i].cal_ink_end = cal_ink_end;
        got[i].box_top = status_box_top(L.status.origin.y, L.status.size.h,
                                        status_row_content_h(spec.status_tier));
        got[i].cap_top = cap_top;
        got[i].has_cal_and_row = has_cal_and_row;
        if (strcmp(views[i].name, "compactCal") == 0) { ref = (int)i; }
        if (!has_cal_and_row) {
            printf("  clearance %-13s no calendar/upper-row pair — nothing to clear\n",
                   views[i].name);
            continue;
        }
        expect_at_least(views[i].name, cap_top - cal_ink_end, FC_CLEARANCE);

        // 4. …and the threshold-highlight box (font-sized, seated on the cap — its top is
        //    status_box_top above, no longer the band top) must not reach the calendar's ink
        //    at all. This is the edge that actually overlapped before.
        expect_at_least("box", got[i].box_top - cal_ink_end, 0);

        printf("  clearance %-13s cal ink ends %3d | box top %3d cap %3d"
               " -> gap %d (box %d)\n",
               views[i].name, cal_ink_end, got[i].box_top, cap_top,
               cap_top - cal_ink_end, got[i].box_top - cal_ink_end);
    }

    // 5. No preset may come CLOSER to the calendar than compactCal, the one the user signed off
    //    on. Stated as ">=" rather than "==" on purpose: the box edge matches exactly on both
    //    platforms, but the CAP cannot on emery, where the dual's Gothic 18 seats its cap 5 rows
    //    into its band and the lone Gothic 24 seats its 3 — so the dual's text lands 2px lower
    //    than the reference's. More air than the reference is fine; less is the defect.
    if (ref < 0) {
        printf("FAIL clearance: no compactCal reference in the view table\n");
        s_failures++;
        return;
    }
    int ref_cap = got[ref].cap_top - got[ref].cal_ink_end;
    int ref_box = got[ref].box_top - got[ref].cal_ink_end;
    for (unsigned i = 0; i < nviews; i++) {
        if (!got[i].has_cal_and_row) { continue; }
        expect_at_least("vs_reference.cap", got[i].cap_top - got[i].cal_ink_end, ref_cap);
        expect_at_least("vs_reference.box", got[i].box_top - got[i].cal_ink_end, ref_box);
    }
    printf("  clearance reference (compactCal): cap %d, box %d\n", ref_cap, ref_box);

    // Teeth for assertions 4 and 5: the OLD compact rule hung the band's BOTTOM off the clock
    // band's top AND gave the box the whole band, i.e. box top = band top =
    // L.time.origin.y - band_h. Reconstruct that for the dual and check it really was closer
    // to the calendar than today's font-sized box on the ink-lifted band — so the ">="
    // comparisons are not vacuous. (The ink lifts put the emery dense BAND top back on the
    // old row; that is fine now precisely because the box no longer spans the band — the box
    // is what overlapped, and the box is what moved down.)
    {
        ViewSpec dn = view_spec_unpack(pack(2, 1, 0, STATUS_SRC_HEALTH, STATUS_SRC_FORECAST));
        MainLayout Ld = layout_compute_spec(BOUNDS, &dn, FC_BAND_H_SHIPPING);
        int old_top = Ld.time.origin.y - Ld.status.size.h;
        int dense_cal_ink_end = Ld.top.origin.y + calendar_ink_h(Ld.top.size.h, 2);
        int content_h = status_row_content_h(dn.status_tier);
        int new_box_top = status_box_top(Ld.status.origin.y, Ld.status.size.h, content_h);
        expect("clearance.old_box_was_higher_than_new", old_top < new_box_top, true);
        expect("clearance.old_dual_box_was_closer_than_reference",
               old_top - dense_cal_ink_end < ref_box, true);
#ifndef PBL_PLATFORM_EMERY
        // The CAP was closer only on the 144px watches (3 vs the reference's 4 — MEASURED).
        // On emery the old dual cap already sat on the reference row (its Gothic 18 seats 5
        // rows into the band where Gothic 24 seats 3, cancelling the anchor error), and the
        // ink lifts have since re-tuned both caps — so only the box teeth above apply there.
        int old_cap = status_cap_top(old_top, Ld.status.size.h, content_h);
        expect("clearance.old_dual_cap_was_closer_than_reference",
               old_cap - dense_cal_ink_end < ref_cap, true);
#endif
    }

    // Teeth: the OLD anchor (the strip's BAND bottom, i.e. STATUS_TOP_STRIP_LIFT rows lower)
    // violated both — so neither assertion above is vacuous. Non-emery only: emery's compact
    // calendar was never crowded (its digits cleared the Gothic-24 cap by 7px even then), which
    // is why only basalt was reported; the same derived anchor just widens emery's gap.
#ifndef PBL_PLATFORM_EMERY
    ViewSpec cc = view_spec_unpack(pack(2, 1, 0, STATUS_SRC_FORECAST, STATUS_SRC_NONE));
    MainLayout Lc = layout_compute_spec(BOUNDS, &cc, FC_BAND_H_SHIPPING);
    int old_ink_end = Lc.top.origin.y + STATUS_TOP_STRIP_LIFT
                    + calendar_ink_h(Lc.top.size.h, 2);
    int cc_cap = status_cap_top(Lc.status.origin.y, Lc.status.size.h, COMPACT_ROW_H);
    expect("clearance.old_anchor_was_short",
           cc_cap - old_ink_end < FC_CLEARANCE, true);
    expect("clearance.old_anchor_overlapped_box",
           Lc.status.origin.y - old_ink_end < 0, true);
    // And the model itself, against the capture named above: at the old anchor (calendar_y 17,
    // band 30) the last row's digits ended on row 44.
    expect("clearance.model_matches_capture", 17 + calendar_ink_h(30, 2) == 45, true);
#endif
    printf("calendar_status_clearance OK\n");
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
    if (!s_dump) test_resolve_strip_promotes_upper();
    if (!s_dump) test_geometry_none_lone_row();
    if (!s_dump) test_geometry_two_rows();
    if (!s_dump) tier_helper_tests();
    if (!s_dump) seating_no_lift();
    if (!s_dump) calendar_status_clearance();
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
