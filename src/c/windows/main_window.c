#include "main_window.h"
#include "layout.h"
#include "c/layers/time_layer.h"
#include "c/layers/forecast_layer.h"
#include "c/layers/status_bar.h"
#include "c/layers/calendar_layer.h"
#include "c/layers/rain_radar_layer.h"
#include "c/layers/top_status_layer.h"
#include "c/layers/loading_layer.h"
#include "c/layers/layer_util.h"
#include "c/layers/health_graph_layer.h"
#include "c/services/health.h"
#include "c/services/health_cache.h"
#include "c/services/health_summary.h"
#include "c/services/quick_view.h"
#include "c/appendix/app_message.h"
#include "c/appendix/persist.h"
#include "c/appendix/config.h"
#include "c/layers/clock_ink.h"
#include "c/appendix/memory_log.h"
#include "c/appendix/status_line.h"
#include "c/appendix/theme.h"
#include "c/appendix/bottom_view.h"

static Window *s_main_window;

// Cycle cursor. A wrist-flick advances to the next enabled + available view and
// wraps back. Survives a relaunch (e.g. Pebble's Quiet Time forces a full app
// process relaunch on real hardware) within config_get()->view_reset_min minutes, or
// MAX_STALE_TIME_SEC when auto-return is disabled — see persist_get_view_cursor()
// in main_window_load(). Beyond that window it boots to the DEFAULT view (index 0).
static uint8_t s_view_index;
#if defined(WW_VIEW_CYCLE)
// The cycle definition (10-bit view_spec2 values) the cursor was last validated against, so
// main_window_apply_top_view can tell a real settings change (cycle redefined → return
// to default) from a same-cycle re-apply (radar/health availability → keep the cursor).
// uint16_t (not uint8_t) so a change confined to the tier/top bits (8-9) is still detected.
static uint16_t s_applied_view_spec[3];
// Epoch of the last flick (or relaunch-restore to a non-default view), seeding the
// auto-return-to-default timer. 0 = on the default view / no timer running.
static time_t s_flick_epoch;
#endif

#if defined(PBL_HEALTH)
// Tracks the last-seen health_mode so an off->on flip (settings, boot)
// triggers exactly one cache rebuild.
static uint8_t s_health_mode_prev;
// Whether the health GRAPH was reachable when the config was last applied — see
// health_graph_renderable(). Drives the strip-width retirement in
// main_window_apply_top_view().
static bool s_health_graph_reachable;
#endif

// Radar data present? — the ONE availability predicate the ViewSpec resolves
// against. Non-static (declared in main_window.h) so app_message.c's
// availability-flip bracket calls this very definition and can never drift from
// it. Constant-false on aplite (radar is compiled out).
bool main_window_radar_has_data(void) {
#if defined(WW_RAIN_RADAR)
    return persist_get_rain_radar_start() > 0;
#else
    // aplite: radar is compiled out, so it never has data — the view cycle
    // resolves every radar slot away (view_spec_resolve/view_slot_available).
    return false;
#endif
}

// Can this platform + config render health right now? Hard false on no-health platforms
// (aplite compiles the health service out entirely).
static bool health_renderable(void) {
#if defined(PBL_HEALTH)
    return config_get()->health_mode != HEALTH_OFF && health_available();
#else
    return false;
#endif
}

#if defined(PBL_HEALTH)
// Can the health GRAPH itself render — is a view carrying the graph body in the
// configured cycle at all, on top of health being renderable? Mode != OFF is NOT
// the graph's own gate: HEALTH_STATUS and HEALTH_SLOT keep health_renderable()
// true (rows still resolve live health slots) while the phone compiles them to
// cycles with no BODY_HEALTH_GRAPH view (view-cycle.js). Every
// health_graph_layer_refresh() call site gates on THIS, so an unreachable graph
// never reports a left-axis label width into the shared strip (bottom_view.h) —
// a claim the visible forecast would keep a phantom gutter for.
static bool health_graph_renderable(void) {
    if (!health_renderable()) { return false; }
    for (int i = 0; i < 3; i++) {
        if (view_spec_unpack(config_get()->view_spec2[i]).body == BODY_HEALTH_GRAPH) {
            return true;
        }
    }
    return false;
}
#endif

// Decode a configured 10-bit slot value to a ViewSpec, then apply runtime availability
// downgrades (radar data present? health renderable?). The SDK queries happen HERE;
// layout.c stays pure.
static ViewSpec unpack_slot_spec(uint16_t value) {
    ViewSpec spec = view_spec_unpack(value);
    return view_spec_resolve(spec, main_window_radar_has_data(), health_renderable());
}

// The ViewSpec for the view currently on screen.
static ViewSpec current_view_spec(void) {
    return unpack_slot_spec(config_get()->view_spec2[s_view_index]);
}

#if defined(WW_VIEW_CYCLE)
// Next flick target after `from`. Resolves availability from the SDK here (radar data
// present? health renderable?) and defers the pure wrap logic to layout.c.
static uint8_t next_view_index(uint8_t from) {
    return view_cursor_next(from, config_get()->view_spec2, main_window_radar_has_data(),
                            health_renderable());
}
#endif

// Reframe every band and set layer visibility + status tiers for the active view.
// Geometry can change on a flick (a view may be a different tier), so this recomputes
// the layout each time rather than only toggling visibility. Layers are reframed, never
// destroyed/recreated. Text re-measurement is the caller's main_window_refresh().
static void render_active_view(void) {
    Layer *root_layer = window_get_root_layer(s_main_window);
    GRect bounds = layer_get_bounds(root_layer);
    ViewSpec spec = current_view_spec();
    // The two font-derived numbers the pure layout cannot measure for itself. The clock ink is
    // resolved on every render, so a font change in settings re-seats the clock with no extra
    // invalidation path (render_active_view runs before main_window_refresh re-measures text).
    LayoutMetrics metrics = LAYOUT_METRICS_NOW();
    int fc_band = metrics.fc_band_h;
    MainLayout L;
#if defined(WW_QUICK_VIEW)
    // Peek is derived LIVE from the unobstructed bounds every render (never a cached flag),
    // so it stays correct across settings/timeline/relaunch — any path that lands here
    // re-checks reality. While a Timeline Quick View overlay covers the lower screen, render
    // the active view minus its calendar (date strip, clock, status row and a small body,
    // fit into the clear area) via layout_compute_peek. Reuses the ViewSpec->visibility
    // pipeline: dropping the top/calendar makes layout_visibility hide the calendar while
    // the body + status stay on.
    GRect unobstructed = quick_view_unobstructed_bounds(root_layer);
    bool peek = unobstructed.size.h < bounds.size.h;
    if (peek) {
        spec.top = TOP_BAND_EMPTY;
        spec.calendar_rows = 0;
        spec.status_tier = LAYOUT_TIER_FULL;   // status band is full-tier-sized (fc_band)
        L = layout_compute_peek(unobstructed, &spec, metrics);
    } else
#endif
    {
        L = layout_compute_spec(bounds, &spec, metrics);
    }
    // Tier push: per-view layout facts flow one way, view spec -> window -> owner ->
    // layer/row state. Layers never read tier facts from config (see CONTEXT.md
    // "Tier push"). Sits after the peek fork above, so the pushed facts track
    // quick-view peek too.
    calendar_layer_set_rows(spec.calendar_rows);
    top_status_layer_set_full_date(spec.calendar_rows == 0);
#if defined(PBL_HEALTH)
    health_graph_layer_set_full_mode(spec.calendar_rows == 3);
#endif
    layer_set_frame(time_layer_get_root(), L.time);
    layer_set_frame(calendar_layer_get_root(), L.top);
#if defined(WW_RAIN_RADAR)
    layer_set_frame(rain_radar_layer_get_root(), L.radar);
#endif
    // Tier, full-date, full-mode, band frame and visibility for every band row, in
    // one call — the bars own the fan-out now (see layers/status_bar.h).
    status_bar_apply_view(&spec, &L);
    layer_set_frame(forecast_layer_get_root(), L.bottom);
#if defined(PBL_HEALTH)
    layer_set_frame(health_graph_layer_get_root(), L.bottom);
#endif
    layer_set_frame(loading_layer_get_root(), L.loading);

    LayerVisibility v = layout_visibility(&spec);
    layer_set_hidden(calendar_layer_get_root(), !v.calendar);
#if defined(WW_RAIN_RADAR)
    layer_set_hidden(rain_radar_layer_get_root(), !v.radar);
#endif
    layer_set_hidden(forecast_layer_get_root(), !v.forecast);
#if defined(PBL_HEALTH)
    layer_set_hidden(health_graph_layer_get_root(), !v.health_graph);
#endif
}

#if defined(WW_QUICK_VIEW)
// A Timeline Quick View overlay appeared or retracted: re-render for the new obstruction
// state, then refresh so the clock/status/forecast text re-measures for its (peek vs
// normal) frame — the same render+refresh pairing a flick uses. quick_view on_change cb.
static void quick_view_on_change(void) {
    render_active_view();
    main_window_refresh();
}
#endif

#if defined(PBL_HEALTH)
// health_cache repaint hook. Fires for the loading frame, a rollover's
// paint-first, and a sliced build's completion. The graph repaints whenever it is
// reachable; once the cache is ready, also recompute the summary and repaint any
// VISIBLE status row carrying LIVE health slots — otherwise a finished build
// (fresh install, stale restore) leaves the rows holding boot-primed values until
// the next minute tick. Same read set as the minute handler's inline refresh, so
// it is safe on the timer callback path.
static void health_cache_repaint(void) {
    // THE unbounded width case: a health OFF->ON flip resets the cache, so the
    // settings save's own refresh reported no width (loading path) — the width
    // only arrives here, when the sliced build finishes, off any user action,
    // with the FORECAST typically the visible body. bottom_view owns that repaint
    // now: a report that moves the shared strip marks both bottom-graph consumers
    // dirty itself. The health_graph_renderable() gate keeps an unreachable graph
    // (HEALTH_STATUS/SLOT — cache still warm for the rows) from reporting at all.
    if (health_graph_renderable()) { health_graph_layer_refresh(); }
    if (!health_cache_ready()) { return; }   // loading frame: no new data for the rows
    if (health_summary_refresh()) {
        ViewSpec spec = current_view_spec();
        status_bar_refresh_live_health(&spec);
        if (top_status_layer_uses_live_health()) { top_status_layer_refresh(); }
    }
}
#endif

#if defined(PBL_HEALTH) && defined(WW_VIEW_CYCLE)
// A view transition (flick, auto-return, a config/availability re-apply) can
// bring live-health content on screen while the minute handler's visible-only
// gate had been skipping summary work —
// the held steps/sleep/HR would then be rollover-old (up to ~an hour) on the
// incoming view's first paint, healing only on the next tick with a visible
// jump. So warm BOTH halves for the incoming view before the render+refresh
// pair resolves its rows: the cache (the graph's data) and the summary (the
// rows'). Same read set as the minute handler's gated arm, paid once per
// transition instead of every tick — which is the whole point of the gate.
static void health_warm_for_incoming_view(void) {
    if (!health_renderable()) { return; }
    ViewSpec ns = current_view_spec();
    LayerVisibility nv = layout_visibility(&ns);
    if (nv.health_status || nv.health_graph
            || status_bar_any_visible_uses_live_health(&ns)) {
        health_cache_refresh_current_hour();
        health_summary_refresh();
        if (nv.health_graph) { health_graph_layer_refresh(); }
    }
}
#endif

#if defined(WW_VIEW_CYCLE)
static void tap_handler(AccelAxisType axis, int32_t direction) {
    // accel_tap_service fires per-axis, so one physical tap commonly delivers
    // 2+ callbacks in quick succession (e.g. X then Z) — without debounce the
    // cursor advances an even number of times and looks like it did nothing.
    static uint64_t s_last_tap_ms = 0;
    time_t now_s;
    uint16_t now_ms_part;
    time_ms(&now_s, &now_ms_part);
    uint64_t now_ms = (uint64_t)now_s * 1000 + now_ms_part;
    if (now_ms - s_last_tap_ms < 500) return;
    s_last_tap_ms = now_ms;

    uint8_t next = next_view_index(s_view_index);
    if (next == s_view_index) { return; }   // nothing else enabled/available
    s_view_index = next;
    s_flick_epoch = time(NULL);              // restart the auto-return timer
#if defined(PBL_HEALTH)
    health_warm_for_incoming_view();
#endif
    render_active_view();
    main_window_refresh();
}
#endif

static void main_window_load(Window *window) {
    Layer *window_layer = window_get_root_layer(window);
    GRect bounds = layer_get_bounds(window_layer);
    main_window_apply_theme();

#if defined(WW_VIEW_CYCLE)
    // Restore the view cursor across a relaunch, gated on the same window the
    // user's own auto-return setting already allows a non-default view to live
    // (or MAX_STALE_TIME_SEC when auto-return is off). Must run before
    // current_view_spec() below, which reads s_view_index indirectly.
    time_t unload_epoch = persist_get_watchface_unload_epoch();
    time_t restore_window = (config_get()->view_reset_min > 0)
                                 ? (time_t) config_get()->view_reset_min * 60
                                 : (time_t) MAX_STALE_TIME_SEC;
    if (unload_epoch > 0 && time(NULL) - unload_epoch <= restore_window) {
        uint8_t restored = (uint8_t) persist_get_view_cursor();
        if (restored < 3
                && view_slot_available(config_get()->view_spec2[restored],
                                       main_window_radar_has_data(), health_renderable())) {
            s_view_index = restored;
            s_flick_epoch = time(NULL);   // restored a non-default view → run its full window
        }
        // else: corrupt flash, or the slot no longer resolves to anything (e.g. a
        // future config migration redefined/disabled it) — stay on the default view.
    }
#endif

    ViewSpec spec = current_view_spec();
    MainLayout L = layout_compute_spec(bounds, &spec, LAYOUT_METRICS_NOW());

    forecast_layer_create(window_layer, L.bottom);
#if defined(PBL_HEALTH)
    health_graph_layer_create(window_layer, L.bottom);
#endif
    // Every band status row, each already seeded with the boot view's tier and date
    // density and framed to the band its source occupies. POSITION IS LOAD-BEARING:
    // the bands overlap (on the 144px watches at compact tier the calendar spans
    // [15,45) and the upper status band [29,46)) and both sides paint opaque fills,
    // so the bars must be added AFTER the body graphs and BEFORE the calendar, clock,
    // radar and strip. See layers/status_bar.h.
    status_bar_create_all(window_layer, &spec, &L);
    time_layer_create(window_layer, L.time);
    calendar_layer_create(window_layer, L.top);
#if defined(WW_RAIN_RADAR)
    rain_radar_layer_create(window_layer, L.radar);
#endif
    // Boot tier push: the strip resolves its slots inside create(), and the date
    // slot needs the BOOT view's density — not the Clay hint. Also fixes the stale
    // date after a relaunch-restore onto a none-tier view.
    top_status_layer_set_full_date(spec.calendar_rows == 0);
    top_status_layer_create(window_layer, L.top_status); // +1 height already in L.top_status
    loading_layer_create(window_layer, L.loading);
    loading_layer_refresh();
    app_message_send_startup_state(loading_layer_data_is_fresh());
#if defined(WW_VIEW_CYCLE)
    // Seed the applied-cycle snapshot with the boot config so the first same-cycle
    // re-apply (e.g. an incoming radar update) doesn't read it as a settings change
    // and reset a cursor the user has since flicked (or we just restored above).
    memcpy(s_applied_view_spec, config_get()->view_spec2, sizeof(s_applied_view_spec));
#endif
    render_active_view();
#if defined(PBL_HEALTH)
    // Repaint the health view — graph AND any live-health status rows — when a
    // deferred build finishes (see health_cache_repaint above).
    health_cache_set_repaint(health_cache_repaint);
    // Warm the cache at boot when health is enabled — restoring a fresh-enough
    // snapshot if we have one, so the graph doesn't reshow "Loading health data"
    // for a relaunch that changed little; otherwise a full build, as before.
    s_health_mode_prev = config_get()->health_mode;
    s_health_graph_reachable = health_graph_renderable();
    if (config_get()->health_mode != HEALTH_OFF) {
        if (!health_cache_restore()) {
            health_cache_reset();
        }
        // Prime the summary (steps/sleep/HR) immediately: it otherwise only refreshes
        // from minute_handler's tick, so the first paint (before the first minute
        // boundary) would show the INT_MIN-derived "0"/"--" sentinel values instead of
        // real data.
        health_summary_refresh();
    }
#endif
#if defined(WW_VIEW_CYCLE)
    accel_tap_service_subscribe(tap_handler);
#endif
#if defined(WW_QUICK_VIEW)
    // Switch to the peek view (and back) whenever a Timeline Quick View overlay appears or
    // retracts. See quick_view_on_change / render_active_view.
    quick_view_subscribe(quick_view_on_change);
#endif
    MEMORY_LOG_HEAP("after_window_load");
}

static void main_window_unload(Window *window) {
#if defined(WW_VIEW_CYCLE)
    accel_tap_service_unsubscribe();
#endif
#if defined(WW_QUICK_VIEW)
    quick_view_unsubscribe();
#endif
    // Snapshot session state for a possible relaunch (see main_window_load's
    // restore logic above). config is already unloaded by this point
    // (config_get() returns NULL) — watchface.c's deinit() calls config_unload()
    // before main_window_destroy() — so nothing below may call it.
#if defined(WW_VIEW_CYCLE)
    persist_set_view_cursor(s_view_index);
    persist_set_watchface_unload_epoch(time(NULL));
#endif
#if defined(PBL_HEALTH)
    health_cache_persist_save();
#endif
    MEMORY_LOG_HEAP("before_window_unload");
    time_layer_destroy();
    status_bar_destroy_all();
    forecast_layer_destroy();
#if defined(PBL_HEALTH)
    health_graph_layer_destroy();
#endif
    calendar_layer_destroy();
#if defined(WW_RAIN_RADAR)
    rain_radar_layer_destroy();
#endif
    top_status_layer_destroy();
    loading_layer_destroy();
    MEMORY_LOG_HEAP("after_window_unload");
}

static void minute_handler(struct tm *tick_time, TimeUnits units_changed) {
    time_layer_tick();
    /* tm_hour==0 missed day changes from emulator time jumps (same clock, new date). */
    if (units_changed & DAY_UNIT) {
        calendar_layer_refresh();
        top_status_layer_refresh();
    }
    top_status_layer_tick();
    loading_layer_refresh();
#if defined(PBL_HEALTH)
    // Keep the cache warm whenever health is enabled (rollover-warm always; the
    // 15-min current-hour re-read only while the health line is on screen). The
    // render path stays HealthService-free.
    ViewSpec aspec = current_view_spec();
    LayerVisibility av = layout_visibility(&aspec);
    bool health_on_screen = av.health_status || av.health_graph;
    // Status rows may carry LIVE health slots on any line — but only VISIBLE rows
    // (plus the always-on top strip) gate the minute work. The hidden health bar's
    // default line is all live-health slots, so an any-bar scan would be ~always
    // true and spend 4-5 HealthService reads on every tick with no health content
    // on screen; a bar that unhides is re-resolved by that path's refresh_all.
    bool bars_need_health = status_bar_any_visible_uses_live_health(&aspec);
    bool top_needs_health = top_status_layer_uses_live_health();
    bool status_needs_health = bars_need_health || top_needs_health;
    if (config_get()->health_mode != HEALTH_OFF) {
        health_cache_tick(health_on_screen);
    }
    // Repaint the on-screen health view from the (now-warm) cache. The summary
    // (steps/sleep/HR) recomputes here, on the minute cadence, rather than in
    // status_bar_refresh_live_health() — so an unrelated main_window_refresh() (e.g. a
    // settings save) repaints from held values with zero HealthService reads.
    if (health_renderable() && (health_on_screen || status_needs_health)) {
        if (av.health_graph) { health_graph_layer_refresh(); }
        if (health_summary_refresh()) {
            status_bar_refresh_live_health(&aspec);
            if (top_needs_health) { top_status_layer_refresh(); }
        }
    }
#endif
#if defined(WW_VIEW_CYCLE)
    // Auto-return to the default view once view_reset_min minutes of real time have
    // elapsed since the flick — elapsed seconds, not minute-tick edges, so a flick late
    // in a wall-clock minute still gets its full window before snapping back.
    if (s_view_index != 0
            && view_auto_return_due(time(NULL), s_flick_epoch, config_get()->view_reset_min)) {
        s_flick_epoch = 0;
        s_view_index = 0;
#if defined(PBL_HEALTH)
        // The default view can carry live-health rows the outgoing view hid —
        // same transition heal as the flick.
        health_warm_for_incoming_view();
#endif
        render_active_view();
        main_window_refresh();
    }
#endif
#if !defined(WW_FIXTURE_NOW_YEAR) && defined(WW_RAIN_RADAR)
    // Live builds only: advance the radar window when a fetch boundary passes.
    // Fixtures are frozen snapshots anchored to the fixture clock — their window
    // must never self-advance. time(NULL) is the real wall clock even in fixture
    // builds (watch_services_now() freezes it for display but mktime/TZ/DST make
    // it unsafe to compare against the JS-derived radar start), so the advance
    // logic would roll the whole window to empty and re-anchor to real time.
    // (aplite has no radar — WW_RAIN_RADAR undefined — so this drops out.)
    if (rain_radar_layer_tick(time(NULL))) {
        // Window advanced — re-evaluate the top view, mirroring the arrival path.
        main_window_apply_top_view();
    }
#endif
}

/*----------------------------
-------- EXTERNAL ------------
----------------------------*/

void main_window_create() {
    s_main_window = window_create();

    window_set_window_handlers(s_main_window, (WindowHandlers) {
        .load = main_window_load,
        .unload = main_window_unload
    });

    tick_timer_service_subscribe(MINUTE_UNIT | DAY_UNIT, minute_handler);

    window_stack_push(s_main_window, true);
    time_layer_refresh();
}

void main_window_apply_top_view() {
#if defined(PBL_HEALTH)
    // A settings flip enabling health (false->true) warms the cache immediately; the
    // status summary is recomputed on the minute tick (the row shows values held from
    // the boot prime / last tick until then).
    if (config_get()->health_mode != HEALTH_OFF && s_health_mode_prev == HEALTH_OFF) {
        health_cache_reset();
    }
    // When the GRAPH leaves the cycle, retire its claim on the SHARED left-axis
    // strip. Keyed on graph REACHABILITY, not on a flip to HEALTH_OFF: switching
    // "Status + graph" to "Status only" or "Status slots only" also removes the
    // graph for good (the phone compiles those modes to cycles with no graph view)
    // while health itself stays on — the flip this block once missed, leaving the
    // forecast indented for a label that could never render again. Nothing else
    // can retire it: health_graph_compute() is the only reporter and every path to
    // it now gates on health_graph_renderable(), so once the graph is unreachable
    // the last width it reported stays latched in the max for good — and the
    // now-VISIBLE forecast keeps a gutter sized for a view that can no longer be
    // shown (a 12.5k-step day leaves the forecast indented for a "12.5" label
    // beside its own two digits). Report 0 to drop the claim; the strip is a max,
    // so this only narrows it when health was the wider source, and bottom_view
    // repaints the strip consumers itself when the width moves.
    const bool graph_reachable = health_graph_renderable();
    if (!graph_reachable && s_health_graph_reachable) {
        bottom_view_report_label_w(BOTTOM_VIEW_SRC_HEALTH, 0);
    }
    s_health_graph_reachable = graph_reachable;
    s_health_mode_prev = config_get()->health_mode;
#endif
    // Re-apply the current view after radar availability or config changed. A radar/health
    // view whose data or capability vanished degrades in place via view_spec_resolve. But a
    // settings change that redefines the cycle makes the cursor's old slot mean a different
    // view — return to the default then, so the cursor never strands on a stale slot (the
    // "default view never shows after changing settings" bug). A same-cycle re-apply (radar
    // availability flip) leaves the cursor where the user put it.
#if defined(WW_VIEW_CYCLE)
    s_view_index = view_cursor_after_config(s_view_index, s_applied_view_spec, config_get()->view_spec2);
    memcpy(s_applied_view_spec, config_get()->view_spec2, sizeof(s_applied_view_spec));
#endif
#if defined(PBL_HEALTH) && defined(WW_VIEW_CYCLE)
    // Same transition heal as the flick: a save can add a live-health slot to a
    // visible row, and an availability flip can unhide one, while the minute
    // gate had been skipping summary work. After the cursor re-resolution above,
    // before the render below, so the repaint resolves fresh values instead of
    // healing on the next tick — which lands exactly when the user is looking.
    health_warm_for_incoming_view();
#endif
    render_active_view();
    main_window_refresh();
}

void main_window_apply_theme(void) {
    window_set_background_color(s_main_window, theme_bg());
}

void main_window_refresh() {
    time_layer_refresh();
    // Every band row, on the same weather-data / settings / flick checkpoint. A
    // compact-top-view toggle changes the band's font and slot geometry, so each row
    // re-measures here rather than waiting for the next minute tick.
    status_bar_refresh_all();
    forecast_layer_refresh();
    calendar_layer_refresh();
    top_status_layer_refresh();
    // The loading/notice overlay too: it is a whole-window surface like the rest,
    // and keeping it out of this set is what made each new repaint path forget it
    // (a config-only theme flip left it on the old polarity, most recently). Cheap
    // and idempotent — a recolor plus one or two persist reads — so the flick/peek
    // paths can afford it; on aplite (no flick — WW_VIEW_CYCLE is compiled out)
    // this runs on the settings/fetch checkpoints only.
    loading_layer_refresh();
}

#if defined(PBL_HEALTH)
// See main_window.h. Called once from app_message.c's config_dirty block, and kept OUT
// of main_window_refresh() on purpose: that refresh is also the flick, quick-view-peek
// and auto-return path. The flick warms and repaints the graph itself, and only when the
// incoming view actually shows it (tap_handler gates on nv.health_graph); peek and
// auto-return do not touch the graph at all. Folding this in would put an unconditional
// 24-bucket health compute plus its label measurements on all three — most visibly on
// every wrist flick. No visibility gate on purpose: beyond the repaint, the compute
// re-reports the left-axis label width that feeds the SHARED strip (bottom_view.h,
// "wider of both"), and a settings apply that changed the label font must refresh that
// even while the health view is hidden — bottom_view repaints the visible forecast
// itself if the width moves. health_graph_renderable() gates it: an unreachable graph
// (health off, no sensors, or no graph view in the configured cycle) must not report a
// phantom width, and current_view_spec() resolves the graph away in exactly those
// cases, so this can never skip a visible graph's repaint.
void main_window_refresh_health_graph(void) {
    if (health_graph_renderable()) { health_graph_layer_refresh(); }
}
#endif

void main_window_destroy() {
    tick_timer_service_unsubscribe();
    window_destroy(s_main_window);
}
