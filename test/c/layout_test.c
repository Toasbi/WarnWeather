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

// Golden-test shim for the retired layout_compute() production wrapper: geometry
// for a plain calendar+forecast view at the given tier, built from the packed
// wire byte (tier<<6 | top<<4 | body<<2 | status) so the default weights and
// has_status=true come from view_spec_unpack, exactly as the wrapper did.
static MainLayout layout_compute(GRect bounds, uint8_t tier, bool dual, int fc_band_h) {
    uint8_t wire_tier = (tier == LAYOUT_TIER_FULL) ? 3
                      : (tier == LAYOUT_TIER_COMPACT) ? 2 : 1;
    uint8_t status = dual ? 2 : 0;   // wire STATUS_ROW_DUAL / STATUS_ROW_WEATHER
    ViewSpec spec = view_spec_unpack((uint8_t)((wire_tier << 6) | (1 << 4) | status));
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

static void viewspec_tests(void) {
    // Packed-byte decode. Byte format: tier<<6 | top<<4 | body<<2 | status. The wire
    // `top` field uses EMPTY=0, CALENDAR=1, RADAR=2 (see src/pkjs/view-cycle.js);
    // view_spec_unpack translates it to the C TopBand enum.
    ViewSpec u = view_spec_unpack(0x90);   // CAL2·FC·W (wire tier=2,top=1(CAL),body=0,status=0)
    expect("unpack.cal2.rows", u.calendar_rows == 2, true);
    expect("unpack.cal2.top", u.top == TOP_BAND_CALENDAR, true);
    expect("unpack.cal2.body", u.body == BODY_FORECAST, true);
    expect("unpack.cal2.status", u.status == STATUS_ROW_WEATHER, true);

    u = view_spec_unpack(0xE3);            // RDR·FC·— : FULL, top=2(RADAR), body=0(FC), status=3(NONE)
    expect("unpack.rdrtop.rows", u.calendar_rows == 3, true);
    expect("unpack.rdrtop.top", u.top == TOP_BAND_RADAR, true);
    expect("unpack.rdrtop.body", u.body == BODY_FORECAST, true);
    expect("unpack.rdrtop.status", u.status == STATUS_ROW_NONE, true);
    LayerVisibility vn = layout_visibility(&u);
    expect("rdrtop.radar_visible", vn.radar, true);
    expect("rdrtop.calendar_hidden", vn.calendar, false);
    expect("rdrtop.forecast_visible", vn.forecast, true);
    expect("rdrtop.no_status", vn.weather_status || vn.health_status, false);

    u = view_spec_unpack(0x92);            // CAL2·FC·D — dual promotes status tier to FULL
    expect("unpack.dual.status", u.status == STATUS_ROW_DUAL, true);
    expect("unpack.dual.tier_full", u.status_tier == LAYOUT_TIER_FULL, true);

    expect("unpack.off_tier", view_spec_unpack(0x00).calendar_rows == 0, true);

    // Availability resolve. has_health=false must make aplite/health-off safe.
    ViewSpec r = view_spec_resolve(view_spec_unpack(0x92), true, false);  // CAL2·FC·D
    expect("resolve.nohealth.dual_to_weather", r.status == STATUS_ROW_WEATHER, true);
    // The dual->weather downgrade must also recompute status_tier: the original 0x92
    // unpack promotes to FULL (dual-in-compact), but once status is no longer dual the
    // band geometry (layout_compute_spec) treats it as a plain compact single-status
    // band, so status_tier must follow it back down to COMPACT or the status text
    // renders with FULL-tier fonts inside a COMPACT-sized band.
    ViewSpec r2 = view_spec_resolve(view_spec_unpack(0x92), true, false);  // CAL2·FC·D, no health
    expect("resolve.nohealth.tier_downgraded", r2.status_tier == LAYOUT_TIER_COMPACT, true);
    r = view_spec_resolve(view_spec_unpack(0x45), true, false);            // NONE·GRAPH·H
    expect("resolve.nohealth.graph_to_forecast", r.body == BODY_FORECAST, true);
    expect("resolve.nohealth.health_to_weather", r.status == STATUS_ROW_WEATHER, true);

    // Radar-in-body under a calendar stays radar WHEN data present (new behaviour).
    r = view_spec_resolve(view_spec_unpack(0x98), true, true);             // CAL2·RDR·W
    expect("resolve.radar_body_with_cal_ok", r.body == BODY_RADAR, true);
    r = view_spec_resolve(view_spec_unpack(0x98), false, true);            // no radar data
    expect("resolve.radar_body_fallback", r.body == BODY_FORECAST, true);

    // Radar-in-top without data falls back to a calendar top band.
    r = view_spec_resolve(view_spec_unpack(0xE0), false, true);            // RDR·FC·W
    expect("resolve.radar_top_fallback", r.top == TOP_BAND_CALENDAR, true);

    // BODY_RADAR_STATUS (wire body 3): radar status line + forecast body, no chart.
    ViewSpec rs = view_spec_unpack(0x9C);   // CAL2·RDR_STATUS·W
    expect("rdrstat.body_is_radar_status", rs.body == BODY_RADAR_STATUS, true);
    LayerVisibility vrs = layout_visibility(&rs);
    expect("rdrstat.radar_hidden",   vrs.radar,    false);
    expect("rdrstat.forecast_shown", vrs.forecast, true);
    ViewSpec rsk = view_spec_resolve(rs, true, false);
    expect("rdrstat.keep_with_data",   rsk.body == BODY_RADAR_STATUS, true);
    ViewSpec rsn = view_spec_resolve(rs, false, false);
    expect("rdrstat.fallback_no_data", rsn.body == BODY_FORECAST, true);
    expect("rdrstat.slot_needs_radar", view_slot_available(0x9C, false, false), false);
    expect("rdrstat.slot_ok_with_data", view_slot_available(0x9C, true, false), true);
}

static void peek_tests(void) {
    // layout_compute_peek: the active view minus its calendar, fit into the clear area above
    // a Timeline Quick View overlay. Date strip stays at top, then clock, status, body.
    // Start from a full-cal forecast+weather view; peek ignores top/calendar. Visibility:
    // calendar hidden (top emptied), forecast + weather status still on.
    ViewSpec s = view_spec_unpack(0xD0);   // CAL3·FC·W
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
    ViewSpec sn = view_spec_unpack(0xD0);
    sn.top = TOP_BAND_EMPTY; sn.calendar_rows = 0; sn.status = STATUS_ROW_NONE;
    MainLayout Ln = layout_compute_peek(clear, &sn, FC_BAND_H);
    expect("peekNone.status_zero_h", Ln.status.size.h == 0, true);
    expect("peekNone.body_fills",    Ln.bottom.size.h > L.bottom.size.h, true);

    // DUAL status stacks two bands between the clock and the body — health on L.status
    // (upper) above weather on L.status_lower (lower), the order render_active_view maps.
    ViewSpec sd = view_spec_unpack(0x92);   // dual status
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
    ViewSpec s = view_spec_unpack(0x98);   // CAL2·RDR·W — radar in body under 2-row cal
    MainLayout L = layout_compute_spec(BOUNDS, &s, FC_BAND_H);
    check("cal2radar.radar", L.radar, 0, 103, 144, 65);   // == compact L.bottom
    check("cal2radar.top",   L.top,   0, 13, 144, 30);    // 2-row calendar band intact

    s = view_spec_unpack(0xD8);            // CAL3·RDR·W — radar in body under 3-row cal
    L = layout_compute_spec(BOUNDS, &s, FC_BAND_H);
    check("cal3radar.radar", L.radar, 0, 117, 144, 51);   // == full L.bottom

    s = view_spec_unpack(0xE0);            // RDR·FC·W — radar in top, forecast in body
    L = layout_compute_spec(BOUNDS, &s, FC_BAND_H);
    check("rdrtop.radar", L.radar, 0, 13, 144, 45);       // == full L.top
    check("rdrtop.bottom", L.bottom, 0, 117, 144, 51);    // status band present → squeezed forecast

    s = view_spec_unpack(0xE3);            // RDR·FC·NONE — statusless radar-top forecast flick
    L = layout_compute_spec(BOUNDS, &s, FC_BAND_H);
    check("rdrtopNone.radar",  L.radar,  0, 13, 144, 45);   // radar keeps the full top band
    check("rdrtopNone.bottom", L.bottom, 0, 103, 144, 65);  // no status row → forecast == compact tier
    check("rdrtopNone.loading", L.loading, 0, 103, 144, 65);// loading covers the reclaimed forecast
#endif
}

// Packed cycle bytes (tier<<6 | top<<4 | body<<2 | status; wire top: EMPTY0/CAL1/RADAR2).
#define B_CAL3_FC_W   0xD0   // full, calendar, forecast, weather
#define B_CAL3_RDR_W  0xD8   // full, calendar, radar-body, weather
#define B_CAL2_FC_W   0x90   // compact, calendar, forecast, weather
#define B_CAL2_FC_H   0x91   // compact, calendar, forecast, health
#define B_CAL2_RDR_W  0x98   // compact, calendar, radar-body, weather
#define B_RDR_FC_NONE 0xE3   // full, radar-top, forecast, no status
#define B_NONE_FC_W   0x40   // none, forecast, weather
#define B_NONE_GRAPH_H 0x45  // none, health graph, health status
#define B_NONE_RDR_W  0x48   // none, radar-body, weather

static void view_cursor_tests(void) {
    // ── The reported bug: live settings change after a flick ──────────────────
    // User flicked to slot 1 under compactCal+status+radar, then switched preset to
    // fullCal+off+radar (a different cycle). The cursor must return to the default view;
    // leaving it on slot 1 is exactly "stuck at flick 1, default never shows".
    uint8_t compactStatusRadar[3] = { B_CAL2_FC_W, B_CAL2_FC_H, B_RDR_FC_NONE };
    uint8_t fullCalRadar[3]       = { B_CAL3_FC_W, B_CAL3_RDR_W, 0x00 };
    expect("cursor.preset_switch_resets_to_default",
           view_cursor_after_config(1, compactStatusRadar, fullCalRadar) == 0, true);

    // noCal+all+radar reached with a carried-over non-default cursor → back to default.
    uint8_t noCalAllRadar[3] = { B_NONE_FC_W, B_NONE_GRAPH_H, B_NONE_RDR_W };
    expect("cursor.noCal_carryover_resets",
           view_cursor_after_config(2, compactStatusRadar, noCalAllRadar) == 0, true);

    // An unchanged cycle (radar/health availability re-apply, not a settings edit) must
    // keep the user on their chosen view.
    expect("cursor.unchanged_keeps",
           view_cursor_after_config(2, noCalAllRadar, noCalAllRadar) == 2, true);
    expect("cursor.unchanged_keeps_default",
           view_cursor_after_config(0, fullCalRadar, fullCalRadar) == 0, true);

    // Even a single-slot change redefines the cycle → reset (cursor could point anywhere).
    uint8_t fullCalRadar2[3] = { B_CAL3_FC_W, B_CAL3_RDR_W, B_NONE_FC_W };
    expect("cursor.single_slot_change_resets",
           view_cursor_after_config(1, fullCalRadar, fullCalRadar2) == 0, true);

    // Reported facet: parked on a health/radar flick slot, then health/radar toggled in
    // settings. The forecast (default, slot 0) must become reachable again. This is where
    // the OLD rule failed: it only reset when the current slot went disabled (byte 0), so
    // disabling BOTH health+radar returned to the forecast, but toggling to another
    // populated cycle left the cursor stranded off the forecast.
    uint8_t compactAllRadar[3]  = { B_CAL3_FC_W, B_NONE_GRAPH_H, B_NONE_RDR_W }; // health all + radar
    uint8_t compactOffNoRadar[3] = { B_CAL2_FC_W, 0x00, 0x00 };                  // both off (1 slot)
    uint8_t compactOffRadar[3]   = { B_CAL2_FC_W, B_CAL2_RDR_W, 0x00 };          // health off, radar on
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
    uint8_t oneSlot[3] = { B_CAL3_FC_W, 0x00, 0x00 };
    expect("next.1slot.stays0", view_cursor_next(0, oneSlot, true, true) == 0, true);
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
    if (!s_dump) viewspec_tests();
    if (!s_dump) peek_tests();
    if (!s_dump) view_cursor_tests();
    if (!s_dump) view_timer_tests();
    if (!s_dump) radar_placement_tests();
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
