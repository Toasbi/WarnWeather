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

typedef enum {
    TOP_VIEW_CALENDAR = 0,
    TOP_VIEW_RAIN_RADAR = 1
} TopView;

typedef enum {
    BOTTOM_FORECAST = 0,
    BOTTOM_HEALTH = 1,
    BOTTOM_RADAR = 2   // none-mode only: radar reframed into the bottom band
} BottomView;

// Session-only view state: every launch boots to DEFAULT (calendar + forecast +
// weather-status). A wrist-flick (accel tap) toggles the whole screen.
static TopView s_top_view;
static BottomView s_bottom_view;

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

#if defined(PBL_HEALTH)
// Whether the health status line (rather than the weather one) shows for a given bottom
// view. Dual shows both, so true there; otherwise the health line rides any non-forecast
// body (the health graph, and in none mode the radar stop) while weather rides the
// forecast — so a none-mode radar flick pairs with the health status line.
static bool health_status_shown_for(BottomView bottom) {
    if (dual_active()) { return true; }
    return bottom != BOTTOM_FORECAST && health_view_active();
}
#endif

// The render tier (a TopViewMode value) for the status bands. Normally the top-view
// mode, but in dual-status + compact top view compute_layout() carves the weather band
// from the forecast at the full-height band — never the shorter compact band — so both
// the weather row and the health row render as full (the smaller font), matching each
// other. None keeps its own (taller) band and is unchanged. dual_active() is a hard
// false on no-health platforms, so this is just top_view_mode there.
static uint8_t status_render_tier(void) {
    if (dual_active() && g_config->top_view_mode == TOP_VIEW_COMPACT) {
        return TOP_VIEW_FULL;
    }
    return g_config->top_view_mode;
}

static void apply_view(TopView top, BottomView bottom) {
    bool none = (g_config->top_view_mode == TOP_VIEW_NONE);

    // Downgrade a radar request when there is no data: top band (full/compact) or
    // bottom band (none).
    if (!none && top == TOP_VIEW_RAIN_RADAR && !radar_has_data()) {
        top = TOP_VIEW_CALENDAR;
    }
    // BOTTOM_RADAR is a none-only view: normalize it to the forecast whenever we're
    // not in none (e.g. a live switch away from none left it selected), or when none
    // but the radar has no data to show.
    if (bottom == BOTTOM_RADAR && (!none || !radar_has_data())) {
        bottom = BOTTOM_FORECAST;
    }
    s_top_view = top;
    s_bottom_view = bottom;

    // Calendar: only in full/compact when the top band is on the calendar.
    layer_set_hidden(calendar_layer_get_root(), none || top != TOP_VIEW_CALENDAR);
    // Radar: top band in full/compact, bottom band in none.
    bool radar_visible = none ? (bottom == BOTTOM_RADAR) : (top == TOP_VIEW_RAIN_RADAR);
    layer_set_hidden(rain_radar_layer_get_root(), !radar_visible);

    // The bottom graph swaps to the health graph only in HEALTH_ALL; HEALTH_STATUS
    // keeps the forecast graph and swaps just the status line (below).
#if defined(PBL_HEALTH)
    bool show_health_graph = (bottom == BOTTOM_HEALTH) && g_config->health_mode == HEALTH_ALL;
#else
    bool show_health_graph = false;
#endif
    // Forecast graph shows for the forecast bottom, and for a HEALTH bottom in status
    // mode (graph unchanged). Stays hidden for the none-mode radar and the health graph.
    bool show_forecast = (bottom == BOTTOM_FORECAST) || (bottom == BOTTOM_HEALTH && !show_health_graph);
    layer_set_hidden(forecast_layer_get_root(), !show_forecast);
#if defined(PBL_HEALTH)
    layer_set_hidden(health_graph_layer_get_root(), !show_health_graph);
#endif
    // Status bands. Dual mode shows both; otherwise the health status line rides any
    // non-forecast body (the health graph, and in none mode the radar stop) while the
    // weather line rides the forecast — so a none-mode radar flick pairs with health.
#if defined(PBL_HEALTH)
    if (dual_active()) {
        layer_set_hidden(weather_status_layer_get_root(), false);
        layer_set_hidden(health_status_layer_get_root(), false);
    } else {
        bool health_bar = health_status_shown_for(bottom);
        layer_set_hidden(weather_status_layer_get_root(), health_bar);
        layer_set_hidden(health_status_layer_get_root(), !health_bar);
    }
#else
    layer_set_hidden(weather_status_layer_get_root(), bottom == BOTTOM_HEALTH);
#endif
}

// none-mode flick: cycle the big bottom band. FORECAST -> RADAR (if data) -> HEALTH
// (if a dedicated health stop applies) -> FORECAST. The radar stop carries the health
// status line (see health_status_shown_for), so in Status mode with radar present it's
// a clean two-view cycle with no separate HEALTH stop. A dedicated HEALTH stop appears
// only when the health graph is enabled (ALL), or in Status mode with no radar to carry
// the health bar (so health stays reachable). health_view_active() is a hard false on
// no-health platforms, so BOTTOM_HEALTH is never returned there.
static BottomView none_next_bottom(BottomView cur) {
    bool has_radar = radar_has_data();
    bool has_health_stop = health_view_active()
        && (g_config->health_mode == HEALTH_ALL || !has_radar);
    switch (cur) {
        case BOTTOM_FORECAST:
            if (has_radar)       { return BOTTOM_RADAR; }
            if (has_health_stop) { return BOTTOM_HEALTH; }
            return BOTTOM_FORECAST;
        case BOTTOM_RADAR:
            if (has_health_stop) { return BOTTOM_HEALTH; }
            return BOTTOM_FORECAST;
        default: /* BOTTOM_HEALTH */
            return BOTTOM_FORECAST;
    }
}

static void tap_handler(AccelAxisType axis, int32_t direction) {
    // accel_tap_service fires per-axis, so one physical tap commonly delivers
    // 2+ callbacks in quick succession (e.g. X then Z) — without debounce the
    // toggle flips an even number of times and looks like it did nothing.
    static uint64_t s_last_tap_ms = 0;
    time_t now_s;
    uint16_t now_ms_part;
    time_ms(&now_s, &now_ms_part);
    uint64_t now_ms = (uint64_t)now_s * 1000 + now_ms_part;
    if (now_ms - s_last_tap_ms < 500) return;
    s_last_tap_ms = now_ms;

    if (g_config->top_view_mode == TOP_VIEW_NONE) {
        BottomView next = none_next_bottom(s_bottom_view);
#if defined(PBL_HEALTH)
        // The health status line rides the health stop AND (Status mode) the radar stop,
        // so refresh health whenever the next stop shows it. Cheap in-progress-hour
        // re-read (no-op if a build is pending), then render from the cache.
        if (health_status_shown_for(next)) {
            health_cache_refresh_current_hour();
            if (next == BOTTOM_HEALTH && g_config->health_mode == HEALTH_ALL) {
                health_graph_layer_refresh();
            }
            health_status_layer_refresh();
        }
#endif
        apply_view(s_top_view, next);   // top is ignored in none
        return;
    }

#if defined(PBL_HEALTH)
    if (health_view_active()) {
        // Toggle the whole screen between DEFAULT (calendar/forecast/weather-status)
        // and ALTERNATE (radar-if-data-else-calendar / health-graph / health-status).
        if (s_bottom_view == BOTTOM_FORECAST) {
            // Cheap in-progress-hour re-read (no-op if a build is pending), then
            // render from the cache. apply_view downgrades the radar top to the
            // calendar when there is no data.
            health_cache_refresh_current_hour();
            if (g_config->health_mode == HEALTH_ALL) { health_graph_layer_refresh(); }
            health_status_layer_refresh();
            apply_view(TOP_VIEW_RAIN_RADAR, BOTTOM_HEALTH);
        } else {
            apply_view(TOP_VIEW_CALENDAR, BOTTOM_FORECAST);
        }
        return;
    }
#endif

    // Legacy behaviour: top-only calendar<->radar with the forecast fixed; inert
    // when there is no radar data to show.
    if (s_top_view == TOP_VIEW_CALENDAR && !radar_has_data()) { return; }
    apply_view(s_top_view == TOP_VIEW_CALENDAR ? TOP_VIEW_RAIN_RADAR : TOP_VIEW_CALENDAR,
               BOTTOM_FORECAST);
}

static Window *s_main_window;

static void main_window_load(Window *window) {
    // Get information about the Window
    Layer *window_layer = window_get_root_layer(window);
    GRect bounds = layer_get_bounds(window_layer);
    window_set_background_color(window, GColorBlack);

    MainLayout L = layout_compute(bounds, g_config->top_view_mode, dual_active(),
                                  status_forecast_band_h(status_full_tier_font()));

    forecast_layer_create(window_layer, L.bottom);
#if defined(PBL_HEALTH)
    health_graph_layer_create(window_layer, L.bottom);
#endif
    // Tell the status layers which tier to render at before they lay out their text.
    weather_status_layer_set_render_tier(status_render_tier());
#if defined(PBL_HEALTH)
    weather_status_layer_create(window_layer, dual_active() ? L.status_lower : L.status);
    health_status_layer_set_render_tier(status_render_tier());
    health_status_layer_set_full_mode(g_config->top_view_mode == TOP_VIEW_FULL);
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
    // The view is session-only state: every launch starts on the DEFAULT view
    // (calendar + forecast + weather-status) and a wrist-flick toggles it.
    apply_view(TOP_VIEW_CALENDAR, BOTTOM_FORECAST);
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
    // 15-min current-hour re-read only while the health line is on screen — which now
    // includes the none-mode radar stop). The render path stays HealthService-free.
    bool health_on_screen = health_status_shown_for(s_bottom_view);
    if (g_config->health_mode != HEALTH_OFF) {
        health_cache_tick(health_on_screen);
    }
    // Repaint the on-screen health view from the (now-warm) cache.
    if (health_on_screen) {
        if (s_bottom_view == BOTTOM_HEALTH && g_config->health_mode == HEALTH_ALL) {
            health_graph_layer_refresh();
        }
        health_status_layer_refresh();
    }
#endif
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
    // Re-apply the current view after radar availability or health config changed.
    // apply_view downgrades the radar (top in full/compact, bottom in none) when its
    // data was cleared.
    // Fall back from the health view when health is no longer active, but leave
    // FORECAST/RADAR alone; apply_view separately downgrades RADAR when its data
    // was cleared.
    BottomView bottom = s_bottom_view;
    if (bottom == BOTTOM_HEALTH && !health_view_active()) {
        bottom = BOTTOM_FORECAST;
    }
    apply_view(s_top_view, bottom);
}

void main_window_relayout(void) {
    GRect bounds = layer_get_bounds(window_get_root_layer(s_main_window));
    MainLayout L = layout_compute(bounds, g_config->top_view_mode, dual_active(),
                                  status_forecast_band_h(status_full_tier_font()));
    // The top-status band is identical in every mode, so it's never reframed here.
    // The time band moves in none (up under the strip), so reframe it too — a live
    // settings switch into/out of none then reflows the clock without a relaunch.
    // main_window_refresh()'s time_layer_refresh() recomputes the inner digit
    // position from the container bounds, so the clock re-centers after this.
    layer_set_frame(time_layer_get_root(), L.time);
    layer_set_frame(calendar_layer_get_root(), L.top);
    layer_set_frame(rain_radar_layer_get_root(), L.radar);
    // Keep the tier in sync with the reframed band; the refresh that follows this
    // relayout (main_window_refresh) re-measures the text at the new tier.
    weather_status_layer_set_render_tier(status_render_tier());
#if defined(PBL_HEALTH)
    layer_set_frame(weather_status_layer_get_root(), dual_active() ? L.status_lower : L.status);
    health_status_layer_set_render_tier(status_render_tier());
    health_status_layer_set_full_mode(g_config->top_view_mode == TOP_VIEW_FULL);
    layer_set_frame(health_status_layer_get_root(), L.status);
#else
    layer_set_frame(weather_status_layer_get_root(), L.status);
#endif
    layer_set_frame(forecast_layer_get_root(), L.bottom);
#if defined(PBL_HEALTH)
    layer_set_frame(health_graph_layer_get_root(), L.bottom);
#endif
    layer_set_frame(loading_layer_get_root(), L.loading);
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
