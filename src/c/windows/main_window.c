#include "main_window.h"
#include "layout.h"
#include "c/layers/time_layer.h"
#include "c/layers/forecast_layer.h"
#include "c/layers/weather_status_layer.h"
#include "c/layers/calendar_layer.h"
#include "c/layers/rain_radar_layer.h"
#include "c/layers/top_status_layer.h"
#include "c/layers/loading_layer.h"
#include "c/layers/layer_util.h"
#include "c/layers/health_graph_layer.h"
#include "c/layers/health_status_layer.h"
#include "c/services/health.h"
#include "c/services/health_cache.h"
#include "c/services/health_summary.h"
#include "c/appendix/app_message.h"
#include "c/appendix/persist.h"
#include "c/appendix/config.h"
#include "c/appendix/memory_log.h"
#include "c/appendix/theme.h"

// The layout module mirrors config.h's TopViewMode as its own LAYOUT_TIER_* (see layout.h);
// main_window passes top_view_mode straight into the tier param, so lock the values together.
_Static_assert((int)TOP_VIEW_FULL == (int)LAYOUT_TIER_FULL
            && (int)TOP_VIEW_COMPACT == (int)LAYOUT_TIER_COMPACT
            && (int)TOP_VIEW_NONE == (int)LAYOUT_TIER_NONE,
               "LAYOUT_TIER_* must stay in lockstep with enum TopViewMode");

static Window *s_main_window;

// Cycle cursor. A wrist-flick advances to the next enabled + available view and
// wraps back. Survives a relaunch (e.g. Pebble's Quiet Time forces a full app
// process relaunch on real hardware) within g_config->view_reset_min minutes, or
// MAX_STALE_TIME_SEC when auto-return is disabled — see persist_get_view_cursor()
// in main_window_load() and docs/superpowers/specs/2026-07-06-persist-across-
// relaunch-design.md. Beyond that window it boots to the DEFAULT view (index 0).
static uint8_t s_view_index;
// The cycle definition (view_spec bytes) the cursor was last validated against, so
// main_window_apply_top_view can tell a real settings change (cycle redefined → return
// to default) from a same-cycle re-apply (radar/health availability → keep the cursor).
static uint8_t s_applied_view_spec[3];
// Epoch of the last flick (or relaunch-restore to a non-default view), seeding the
// auto-return-to-default timer. 0 = on the default view / no timer running.
static time_t s_flick_epoch;

#if defined(PBL_HEALTH)
// Tracks the last-seen health_mode so an off->on flip (settings, boot)
// triggers exactly one cache rebuild.
static uint8_t s_health_mode_prev;
#endif

static bool radar_has_data(void) {
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
    return g_config->health_mode != HEALTH_OFF && health_available();
#else
    return false;
#endif
}

// Decode a configured slot byte to a ViewSpec, then apply runtime availability
// downgrades (radar data present? health renderable?). The SDK queries happen HERE;
// layout.c stays pure.
static ViewSpec unpack_slot_spec(uint8_t byte) {
    ViewSpec spec = view_spec_unpack(byte);
    return view_spec_resolve(spec, radar_has_data(), health_renderable());
}

// The ViewSpec for the view currently on screen.
static ViewSpec current_view_spec(void) {
    return unpack_slot_spec(g_config->view_spec[s_view_index]);
}

// Next flick target after `from`. Resolves availability from the SDK here (radar data
// present? health renderable?) and defers the pure wrap logic to layout.c.
static uint8_t next_view_index(uint8_t from) {
    return view_cursor_next(from, g_config->view_spec, radar_has_data(), health_renderable());
}

// Reframe every band and set layer visibility + status tiers for the active view.
// Geometry can change on a flick (a view may be a different tier), so this recomputes
// the layout each time rather than only toggling visibility. Layers are reframed, never
// destroyed/recreated. Text re-measurement is the caller's main_window_refresh().
static void render_active_view(void) {
    GRect bounds = layer_get_bounds(window_get_root_layer(s_main_window));
    ViewSpec spec = current_view_spec();
    // Bridge the legacy top_view_mode consumers (config_calendar_rows / config_n_today
    // for the calendar row count + prev-week offset, and the aplite date strip) to the
    // ACTIVE view's tier, so a flick to a different-density view draws the right calendar.
    g_config->top_view_mode = (spec.calendar_rows == 3) ? TOP_VIEW_FULL
                            : (spec.calendar_rows == 2) ? TOP_VIEW_COMPACT
                            : TOP_VIEW_NONE;
    MainLayout L = layout_compute_spec(bounds, &spec,
                                       status_forecast_band_h(status_full_tier_font()));
    layer_set_frame(time_layer_get_root(), L.time);
    layer_set_frame(calendar_layer_get_root(), L.top);
#if defined(WW_RAIN_RADAR)
    layer_set_frame(rain_radar_layer_get_root(), L.radar);
#endif
    weather_status_layer_set_render_tier(spec.status_tier);
#if defined(PBL_HEALTH)
    layer_set_frame(weather_status_layer_get_root(),
                    (spec.status == STATUS_ROW_DUAL) ? L.status_lower : L.status);
    health_status_layer_set_render_tier(spec.status_tier);
    health_status_layer_set_full_mode(spec.calendar_rows == 3);
    layer_set_frame(health_status_layer_get_root(), L.status);
#else
    layer_set_frame(weather_status_layer_get_root(), L.status);
#endif
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
    layer_set_hidden(weather_status_layer_get_root(), !v.weather_status);
#if defined(PBL_HEALTH)
    layer_set_hidden(health_graph_layer_get_root(), !v.health_graph);
    layer_set_hidden(health_status_layer_get_root(), !v.health_status);
#endif
}

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
    // Warm health for the incoming view before it renders (cheap current-hour re-read).
    {
        ViewSpec ns = current_view_spec();
        LayerVisibility nv = layout_visibility(&ns);
        if (nv.health_status || nv.health_graph) {
            health_cache_refresh_current_hour();
            if (nv.health_graph) { health_graph_layer_refresh(); }
        }
    }
#endif
    render_active_view();
    main_window_refresh();
}

static void main_window_load(Window *window) {
    Layer *window_layer = window_get_root_layer(window);
    GRect bounds = layer_get_bounds(window_layer);
    main_window_apply_theme();

    // Restore the view cursor across a relaunch, gated on the same window the
    // user's own auto-return setting already allows a non-default view to live
    // (or MAX_STALE_TIME_SEC when auto-return is off). Must run before
    // current_view_spec() below, which reads s_view_index indirectly.
    time_t unload_epoch = persist_get_watchface_unload_epoch();
    time_t restore_window = (g_config->view_reset_min > 0)
                                 ? (time_t) g_config->view_reset_min * 60
                                 : (time_t) MAX_STALE_TIME_SEC;
    if (unload_epoch > 0 && time(NULL) - unload_epoch <= restore_window) {
        uint8_t restored = (uint8_t) persist_get_view_cursor();
        if (restored < 3
                && view_slot_available(g_config->view_spec[restored], radar_has_data(), health_renderable())) {
            s_view_index = restored;
            s_flick_epoch = time(NULL);   // restored a non-default view → run its full window
        }
        // else: corrupt flash, or the slot no longer resolves to anything (e.g. a
        // future config migration redefined/disabled it) — stay on the default view.
    }

    ViewSpec spec = current_view_spec();
    MainLayout L = layout_compute_spec(bounds, &spec,
                                       status_forecast_band_h(status_full_tier_font()));

    forecast_layer_create(window_layer, L.bottom);
#if defined(PBL_HEALTH)
    health_graph_layer_create(window_layer, L.bottom);
#endif
    // Tell the status layers which tier to render at before they lay out their text.
    weather_status_layer_set_render_tier(spec.status_tier);
#if defined(PBL_HEALTH)
    weather_status_layer_create(window_layer, (spec.status == STATUS_ROW_DUAL) ? L.status_lower : L.status);
    health_status_layer_set_render_tier(spec.status_tier);
    health_status_layer_set_full_mode(spec.calendar_rows == 3);
    health_status_layer_create(window_layer, L.status);
#else
    weather_status_layer_create(window_layer, L.status);
#endif
    time_layer_create(window_layer, L.time);
    calendar_layer_create(window_layer, L.top);
#if defined(WW_RAIN_RADAR)
    rain_radar_layer_create(window_layer, L.radar);
#endif
    top_status_layer_create(window_layer, L.top_status); // +1 height already in L.top_status
    loading_layer_create(window_layer, L.loading);
    loading_layer_refresh();
    app_message_send_startup_state(loading_layer_data_is_fresh());
    // Seed the applied-cycle snapshot with the boot config so the first same-cycle
    // re-apply (e.g. an incoming radar update) doesn't read it as a settings change
    // and reset a cursor the user has since flicked (or we just restored above).
    memcpy(s_applied_view_spec, g_config->view_spec, sizeof(s_applied_view_spec));
    render_active_view();
#if defined(PBL_HEALTH)
    // Repaint the health view when a deferred build finishes.
    health_cache_set_repaint(health_graph_layer_refresh);
    // Warm the cache at boot when health is enabled — restoring a fresh-enough
    // snapshot if we have one, so the graph doesn't reshow "Loading health data"
    // for a relaunch that changed little; otherwise a full build, as before.
    s_health_mode_prev = g_config->health_mode;
    if (g_config->health_mode != HEALTH_OFF && !health_cache_restore()) {
        health_cache_reset();
    }
#endif
    accel_tap_service_subscribe(tap_handler);
    MEMORY_LOG_HEAP("after_window_load");
}

static void main_window_unload(Window *window) {
    accel_tap_service_unsubscribe();
    // Snapshot session state for a possible relaunch (see main_window_load's
    // restore logic above). g_config is already freed by this point —
    // watchface.c's deinit() calls config_unload() before main_window_destroy()
    // — so nothing below may dereference it.
    persist_set_view_cursor(s_view_index);
    persist_set_watchface_unload_epoch(time(NULL));
#if defined(PBL_HEALTH)
    health_cache_persist_save();
#endif
    MEMORY_LOG_HEAP("before_window_unload");
    time_layer_destroy();
    weather_status_layer_destroy();
#if defined(PBL_HEALTH)
    health_status_layer_destroy();
#endif
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
    if (g_config->health_mode != HEALTH_OFF) {
        health_cache_tick(health_on_screen);
    }
    // Repaint the on-screen health view from the (now-warm) cache. The summary
    // (steps/sleep/HR) recomputes here, on the minute cadence, rather than in
    // health_status_layer_refresh() — so an unrelated main_window_refresh() (e.g. a
    // settings save) repaints from held values with zero HealthService reads.
    if (health_on_screen) {
        if (av.health_graph) { health_graph_layer_refresh(); }
        if (av.health_status && health_summary_refresh()) {
            health_status_layer_refresh();
        }
    }
#endif
    // Auto-return to the default view once view_reset_min minutes of real time have
    // elapsed since the flick — elapsed seconds, not minute-tick edges, so a flick late
    // in a wall-clock minute still gets its full window before snapping back.
    if (s_view_index != 0
            && view_auto_return_due(time(NULL), s_flick_epoch, g_config->view_reset_min)) {
        s_flick_epoch = 0;
        s_view_index = 0;
        render_active_view();
        main_window_refresh();
    }
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
    if (g_config->health_mode != HEALTH_OFF && s_health_mode_prev == HEALTH_OFF) {
        health_cache_reset();
    }
    s_health_mode_prev = g_config->health_mode;
#endif
    // Re-apply the current view after radar availability or config changed. A radar/health
    // view whose data or capability vanished degrades in place via view_spec_resolve. But a
    // settings change that redefines the cycle makes the cursor's old slot mean a different
    // view — return to the default then, so the cursor never strands on a stale slot (the
    // "default view never shows after changing settings" bug). A same-cycle re-apply (radar
    // availability flip) leaves the cursor where the user put it.
    s_view_index = view_cursor_after_config(s_view_index, s_applied_view_spec, g_config->view_spec);
    memcpy(s_applied_view_spec, g_config->view_spec, sizeof(s_applied_view_spec));
    render_active_view();
    main_window_refresh();
}

void main_window_apply_theme(void) {
    window_set_background_color(s_main_window, theme_bg());
}

void main_window_relayout(void) {
    // Recompute geometry, visibility and status tiers for the active view; the top-status
    // band is identical across MVP presets so render_active_view leaves it framed as created.
    // main_window_refresh() (called by the caller) re-measures the text at the new tier.
    render_active_view();
}

void main_window_refresh() {
    time_layer_refresh();
    weather_status_layer_refresh();
#if defined(PBL_HEALTH)
    // Compact-top-view toggles change the status band's font/slot geometry;
    // health_status_layer_refresh() recomputes its module-static slot frames
    // the same way weather_status_layer_refresh() does above, so a settings
    // change while the health view is active doesn't clip/misalign until the
    // next minute tick.
    health_status_layer_refresh();
#endif
    forecast_layer_refresh();
    calendar_layer_refresh();
    top_status_layer_refresh();
}

void main_window_destroy() {
    // Interface for destroying the main window (implicitly unloads contents)
    tick_timer_service_unsubscribe();
    window_destroy(s_main_window);
}
