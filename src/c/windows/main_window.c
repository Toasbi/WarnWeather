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
#include "c/appendix/app_message.h"
#include "c/appendix/persist.h"
#include "c/appendix/config.h"
#include "c/appendix/memory_log.h"

// The layout module mirrors config.h's TopViewMode as its own LAYOUT_TIER_* (see layout.h);
// main_window passes top_view_mode straight into the tier param, so lock the values together.
_Static_assert((int)TOP_VIEW_FULL == (int)LAYOUT_TIER_FULL
            && (int)TOP_VIEW_COMPACT == (int)LAYOUT_TIER_COMPACT
            && (int)TOP_VIEW_NONE == (int)LAYOUT_TIER_NONE,
               "LAYOUT_TIER_* must stay in lockstep with enum TopViewMode");

typedef enum {
    TOP_VIEW_CALENDAR = 0,
    TOP_VIEW_RAIN_RADAR = 1
} TopView;

typedef enum {
    BOTTOM_FORECAST = 0,
    BOTTOM_HEALTH = 1,
    BOTTOM_RADAR = 2   // none-mode only: radar reframed into the bottom band
} BottomView;

static Window *s_main_window;

// Session-only cycle cursor: every launch boots to the DEFAULT view (index 0).
// A wrist-flick advances to the next enabled + available view and wraps back.
static uint8_t s_view_index;
// Minutes since the last flick, for the auto-return-to-default timer (0 = disabled).
static uint8_t s_minutes_since_flick;

#if defined(PBL_HEALTH)
// Tracks the last-seen health_mode so an off->on flip (settings, boot)
// triggers exactly one cache rebuild.
static uint8_t s_health_mode_prev;
#endif

static bool radar_has_data(void) {
    return persist_get_rain_radar_start() > 0;
}

// Dual status = show health AND weather status at once. Works with ANY health view
// (status bar OR graph): the phone gates dual_status so it's only ever set when a
// health view is on, so the watch just trusts the flag plus the two guards it alone
// owns — the layout invariant (never in full) and the local health capability (the
// phone can't know it). Hard false on no-health platforms so aplite never links the
// health service.
static bool dual_active(void) {
#if defined(PBL_HEALTH)
    return g_config->top_view_mode != TOP_VIEW_FULL
        && g_config->dual_status
        && health_available();
#else
    return false;
#endif
}

// The alternate health view is only reachable when the user enabled it AND the
// platform can serve health data. On no-health platforms (e.g. aplite, which
// has no sensors) the whole view is compiled out, so this is a hard false and
// never references the health service.
static bool health_view_active(void) {
#if defined(PBL_HEALTH)
    if (g_config->health_mode == HEALTH_OFF || !health_available()) { return false; }
    // Dual already pins both status bands on screen, so the flick's status-swap is
    // redundant there — but the ALL-mode health graph is still a distinct body worth
    // revealing on a flick, so keep it reachable. In Status-bar dual, there's no graph,
    // so the flick falls back to the legacy calendar<->radar toggle.
    if (dual_active()) { return g_config->health_mode == HEALTH_ALL; }
    return true;
#else
    return false;
#endif
}

// Map a configured ViewContent to the layout module's preset producer, then resolve
// data-availability downgrades. The SDK/persist queries happen HERE (the producer);
// layout.c stays pure. top_view/bottom_view mirror the old TopView/BottomView ints
// (top: 0=calendar,1=radar; bottom: 0=forecast,1=health,2=radar).
static ViewSpec spec_for_content(uint8_t content) {
    uint8_t mode = TOP_VIEW_COMPACT, top_view = TOP_VIEW_CALENDAR, bottom_view = BOTTOM_FORECAST;
    bool health_graph_on = false, health_active = false;
    switch (content) {
        case VC_FORECAST_FULL:    mode = TOP_VIEW_FULL;    break;
        case VC_FORECAST_COMPACT: mode = TOP_VIEW_COMPACT; break;
        case VC_FORECAST_NONE:    mode = TOP_VIEW_NONE;    break;
        case VC_RADAR:            mode = TOP_VIEW_NONE; bottom_view = BOTTOM_RADAR; break;
        case VC_HEALTH_STATUS:    mode = TOP_VIEW_COMPACT; bottom_view = BOTTOM_HEALTH;
                                  health_active = health_view_active(); break;
        case VC_HEALTH_GRAPH:     mode = TOP_VIEW_NONE; bottom_view = BOTTOM_HEALTH;
                                  health_graph_on = true; health_active = health_view_active(); break;
        default:                  mode = TOP_VIEW_COMPACT; break;   // VC_OFF safety
    }
    ViewSpec spec = view_spec_from_state(mode, false, top_view, bottom_view,
                                         health_graph_on, health_active);
    return view_spec_resolve(spec, radar_has_data());
}

// The ViewSpec for the view currently on screen.
static ViewSpec current_view_spec(void) {
    return spec_for_content(g_config->view_content[s_view_index]);
}

// Is a view slot renderable right now? OFF never; radar needs data; health needs a live
// view. health_view_active() is a hard false on no-health platforms.
static bool view_available(uint8_t content) {
    if (content == VC_OFF) { return false; }
    if (content == VC_RADAR) { return radar_has_data(); }
    if (content == VC_HEALTH_STATUS || content == VC_HEALTH_GRAPH) { return health_view_active(); }
    return true;
}

// Next enabled + available slot after `from`, wrapping. Index 0 (the default view) is
// always a valid stop, so the cycle can never get stuck.
static uint8_t next_view_index(uint8_t from) {
    for (int step = 1; step <= 3; step++) {
        uint8_t i = (uint8_t)((from + step) % 3);
        if (i == 0 || view_available(g_config->view_content[i])) { return i; }
    }
    return 0;
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
    layer_set_frame(rain_radar_layer_get_root(), L.radar);
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
    layer_set_hidden(rain_radar_layer_get_root(), !v.radar);
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
    s_minutes_since_flick = 0;               // restart the auto-return timer
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
    // Get information about the Window
    Layer *window_layer = window_get_root_layer(window);
    GRect bounds = layer_get_bounds(window_layer);
    window_set_background_color(window, GColorBlack);

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
    rain_radar_layer_create(window_layer, L.radar);
    top_status_layer_create(window_layer, L.top_status); // +1 height already in L.top_status
    loading_layer_create(window_layer, L.loading);
    loading_layer_refresh();
    app_message_send_startup_state(loading_layer_data_is_fresh());
    // The cycle cursor is session-only: every launch starts on the DEFAULT view
    // (index 0). Set the initial layer visibility for it (geometry already applied above).
    render_active_view();
#if defined(PBL_HEALTH)
    // Repaint the health view when a deferred build finishes.
    health_cache_set_repaint(health_graph_layer_refresh);
    // Warm the cache at boot when health is enabled so the first flick is ready.
    s_health_mode_prev = g_config->health_mode;
    if (g_config->health_mode != HEALTH_OFF) {
        health_cache_reset();
    }
#endif
    accel_tap_service_subscribe(tap_handler);
    MEMORY_LOG_HEAP("after_window_load");
}

static void main_window_unload(Window *window) {
    accel_tap_service_unsubscribe();
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
    rain_radar_layer_destroy();
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
    // Repaint the on-screen health view from the (now-warm) cache.
    if (health_on_screen) {
        if (av.health_graph) {
            health_graph_layer_refresh();
        }
        health_status_layer_refresh();
    }
#endif
    // Auto-return to the default view after view_reset_min minutes without a flick.
    if (s_view_index != 0 && g_config->view_reset_min > 0) {
        if (++s_minutes_since_flick >= g_config->view_reset_min) {
            s_minutes_since_flick = 0;
            s_view_index = 0;
            render_active_view();
            main_window_refresh();
        }
    }
#ifndef WW_FIXTURE_NOW_YEAR
    // Live builds only: advance the radar window when a fetch boundary passes.
    // Fixtures are frozen snapshots anchored to the fixture clock — their window
    // must never self-advance. time(NULL) is the real wall clock even in fixture
    // builds (watch_services_now() freezes it for display but mktime/TZ/DST make
    // it unsafe to compare against the JS-derived radar start), so the advance
    // logic would roll the whole window to empty and re-anchor to real time.
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
    // Create main Window element and assign to pointer
    s_main_window = window_create();

    // Set handlers to manage the elements inside the Window
    window_set_window_handlers(s_main_window, (WindowHandlers) {
        .load = main_window_load,
        .unload = main_window_unload
    });

    // Register with TickTimerService
    tick_timer_service_subscribe(MINUTE_UNIT | DAY_UNIT, minute_handler);

    // Show the window on the watch with animated=true
    window_stack_push(s_main_window, true);
    time_layer_refresh();
}

void main_window_apply_top_view() {
#if defined(PBL_HEALTH)
    // A settings flip enabling health (false->true) warms the cache immediately.
    if (g_config->health_mode != HEALTH_OFF && s_health_mode_prev == HEALTH_OFF) {
        health_cache_reset();
    }
    s_health_mode_prev = g_config->health_mode;
#endif
    // Re-apply the current view after radar availability or config changed. A radar/health
    // view whose data or capability vanished degrades in place via view_spec_resolve; only
    // fall back to the default view if a config change turned the current slot OFF entirely.
    if (s_view_index != 0 && g_config->view_content[s_view_index] == VC_OFF) {
        s_view_index = 0;
    }
    render_active_view();
    main_window_refresh();
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
