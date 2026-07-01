#include "main_window.h"
#include "c/layers/time_layer.h"
#include "c/layers/forecast_layer.h"
#include "c/layers/weather_status_layer.h"
#include "c/layers/calendar_layer.h"
#include "c/layers/rain_radar_layer.h"
#include "c/layers/top_status_layer.h"
#include "c/layers/loading_layer.h"
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
    BOTTOM_HEALTH = 1
} BottomView;

// Session-only view state: every launch boots to DEFAULT (calendar + forecast +
// weather-status). A wrist-flick (accel tap) toggles the whole screen.
static TopView s_top_view;
static BottomView s_bottom_view;

#if defined(PBL_HEALTH)
// Tracks the last-seen health_enabled so a false->true flip (settings, boot)
// triggers exactly one cache rebuild.
static bool s_health_enabled_prev;
#endif

static bool radar_has_data(void) {
    return persist_get_rain_radar_start() > 0;
}

// The alternate health view is only reachable when the user enabled it AND the
// platform can serve health data. On no-health platforms (e.g. aplite, which
// has no sensors) the whole view is compiled out, so this is a hard false and
// never references the health service.
static bool health_view_active(void) {
#if defined(PBL_HEALTH)
    return g_config->health_enabled && health_available();
#else
    return false;
#endif
}

static void apply_view(TopView top, BottomView bottom) {
    if (top == TOP_VIEW_RAIN_RADAR && !radar_has_data()) {
        top = TOP_VIEW_CALENDAR;
    }
    s_top_view = top;
    s_bottom_view = bottom;
    layer_set_hidden(calendar_layer_get_root(), top != TOP_VIEW_CALENDAR);
    layer_set_hidden(rain_radar_layer_get_root(), top != TOP_VIEW_RAIN_RADAR);
    layer_set_hidden(forecast_layer_get_root(), bottom != BOTTOM_FORECAST);
#if defined(PBL_HEALTH)
    layer_set_hidden(health_graph_layer_get_root(), bottom != BOTTOM_HEALTH);
#endif
    layer_set_hidden(weather_status_layer_get_root(), bottom != BOTTOM_FORECAST);
#if defined(PBL_HEALTH)
    layer_set_hidden(health_status_layer_get_root(), bottom != BOTTOM_HEALTH);
#endif
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

#if defined(PBL_HEALTH)
    if (health_view_active()) {
        // Toggle the whole screen between DEFAULT (calendar/forecast/weather-status)
        // and ALTERNATE (radar-if-data-else-calendar / health-graph / health-status).
        if (s_bottom_view == BOTTOM_FORECAST) {
            // Cheap in-progress-hour re-read (no-op if a build is pending), then
            // render from the cache. apply_view downgrades the radar top to the
            // calendar when there is no data.
            health_cache_refresh_current_hour();
            health_graph_layer_refresh();
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

#define FORECAST_HEIGHT 51
#define WEATHER_STATUS_HEIGHT 14
#define TIME_HEIGHT 45
#define CALENDAR_HEIGHT 45
#define EMERY_WINDOW_PAD_X 2
#define EMERY_WINDOW_PAD_TOP 2
#define EMERY_WINDOW_PAD_BOTTOM 4
// emery: increase top calendar status row height to fit larger month and icon alignment.
#ifdef PBL_PLATFORM_EMERY
#define CALENDAR_STATUS_HEIGHT 20
#else
#define CALENDAR_STATUS_HEIGHT 13
#endif

static Window *s_main_window;

#ifdef PBL_PLATFORM_EMERY
// emery: scale the main content bands proportionally to fill the taller screen
// while preserving the legacy calendar/time/forecast balance.
static void compute_content_layout(int content_h, int *calendar_h, int *time_h, int *forecast_h) {
    const int weight_sum = CALENDAR_HEIGHT + TIME_HEIGHT + FORECAST_HEIGHT;

    *calendar_h = (content_h * CALENDAR_HEIGHT) / weight_sum;
    *time_h = (content_h * TIME_HEIGHT) / weight_sum;
    *forecast_h = content_h - *calendar_h - *time_h;
}
#endif

typedef struct {
    GRect top_status;
    GRect top;       // TopView band: calendar_layer / rain_radar_layer (same frame)
    GRect status;    // weather_status / health_status band
    GRect time;
    GRect bottom;    // BottomView band: forecast_layer / health_graph_layer (same frame)
    GRect loading;
} MainLayout;

// Single source of truth for the vertical band geometry, for both the window
// load path and main_window_relayout(). Compact top view shrinks the calendar to
// 2 rows, moves the status band into the freed 3rd-row slot (larger font handled
// in the status layers), grows the bottom band up to the fixed time band, and the
// radar (which shares the calendar frame) shrinks with it. The time and top-status
// bands are identical in both modes, so relayout leaves them untouched.
static MainLayout compute_layout(GRect bounds, bool compact) {
    int w = bounds.size.w;
    int h = bounds.size.h;
    MainLayout L;
#ifdef PBL_PLATFORM_EMERY
    // emery: bands are proportional; keep calendar_y/time_y/time_h fixed and
    // repartition the calendar band (2/3 dates + 1/3 status) while the forecast
    // absorbs the weather-status gap between time and forecast.
    int content_x = EMERY_WINDOW_PAD_X;
    int content_y = EMERY_WINDOW_PAD_TOP;
    int content_w = w - EMERY_WINDOW_PAD_X * 2;
    int forecast_w = w - content_x;
    int content_h = h - EMERY_WINDOW_PAD_TOP - EMERY_WINDOW_PAD_BOTTOM - CALENDAR_STATUS_HEIGHT - WEATHER_STATUS_HEIGHT;
    int calendar_h, time_h, forecast_h;
    compute_content_layout(content_h, &calendar_h, &time_h, &forecast_h);

    int calendar_y = content_y + CALENDAR_STATUS_HEIGHT;
    int time_y = calendar_y + calendar_h;

    int cal_h      = compact ? (calendar_h - calendar_h / 3) : calendar_h;
    int status_h   = compact ? (calendar_h - cal_h)          : WEATHER_STATUS_HEIGHT;
    int status_y   = compact ? (calendar_y + cal_h)          : (time_y + time_h);
    int forecast_y = compact ? (time_y + time_h)             : (time_y + time_h + WEATHER_STATUS_HEIGHT);
    int fc_h       = compact ? (forecast_h + WEATHER_STATUS_HEIGHT) : forecast_h;

    L.top_status = GRect(content_x, content_y, content_w, CALENDAR_STATUS_HEIGHT + 1);
    L.top        = GRect(content_x, calendar_y, content_w, cal_h);
    L.status     = GRect(content_x, status_y, content_w, status_h);
    L.time       = GRect(content_x, time_y, content_w, time_h);
    L.bottom     = GRect(content_x, forecast_y, forecast_w, fc_h);
    L.loading    = compact
        ? GRect(content_x, forecast_y, content_w, fc_h)
        : GRect(content_x, time_y + time_h, content_w, h - EMERY_WINDOW_PAD_BOTTOM - (time_y + time_h));
#else
    int cal_full = CALENDAR_HEIGHT;                     // 45
    int cal_row  = CALENDAR_HEIGHT / 3;                 // 15 (one calendar row)
    int cal_y    = CALENDAR_STATUS_HEIGHT;              // 13
    int time_y   = cal_y + cal_full;                    // 58 (fixed anchor; == 13+30+15 compact)

    int cal_h      = compact ? (2 * cal_row)            : CALENDAR_HEIGHT;                       // 30 vs 45
    int status_h   = compact ? cal_row                  : WEATHER_STATUS_HEIGHT;                 // 15 vs 14
    int status_y   = compact ? (cal_y + cal_h)          : (h - FORECAST_HEIGHT - WEATHER_STATUS_HEIGHT); // 43 vs 103
    int forecast_y = compact ? (time_y + TIME_HEIGHT)   : (h - FORECAST_HEIGHT);                 // 103 vs 117
    int fc_h       = h - forecast_y;                                                             // 65 vs 51

    L.top_status = GRect(0, 0, w, CALENDAR_STATUS_HEIGHT + 1);
    L.top        = GRect(0, cal_y, w, cal_h);
    L.status     = GRect(0, status_y, w, status_h);
    L.time       = GRect(0, time_y, w, TIME_HEIGHT);
    L.bottom     = GRect(0, forecast_y, w, fc_h);
    L.loading    = compact
        ? GRect(0, forecast_y, w, fc_h)
        : GRect(0, h - FORECAST_HEIGHT - WEATHER_STATUS_HEIGHT, w, FORECAST_HEIGHT + WEATHER_STATUS_HEIGHT);
#endif
    return L;
}

static void main_window_load(Window *window) {
    // Get information about the Window
    Layer *window_layer = window_get_root_layer(window);
    GRect bounds = layer_get_bounds(window_layer);
    window_set_background_color(window, GColorBlack);

    MainLayout L = compute_layout(bounds, g_config->compact_top_view);

    forecast_layer_create(window_layer, L.bottom);
#if defined(PBL_HEALTH)
    health_graph_layer_create(window_layer, L.bottom);
#endif
    weather_status_layer_create(window_layer, L.status);
#if defined(PBL_HEALTH)
    health_status_layer_create(window_layer, L.status);
#endif
    time_layer_create(window_layer, L.time);
    calendar_layer_create(window_layer, L.top);
    rain_radar_layer_create(window_layer, L.top);
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
    s_health_enabled_prev = g_config->health_enabled;
    if (g_config->health_enabled) {
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
    // 15-min current-hour re-read only while the view is visible). The render
    // path stays HealthService-free.
    if (g_config->health_enabled) {
        health_cache_tick(s_bottom_view == BOTTOM_HEALTH);
    }
    // Repaint the on-screen health view from the (now-warm) cache.
    if (s_bottom_view == BOTTOM_HEALTH) {
        health_graph_layer_refresh();
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
    if (g_config->health_enabled && !s_health_enabled_prev) {
        health_cache_reset();
    }
    s_health_enabled_prev = g_config->health_enabled;
#endif
    // Re-apply the current view after radar availability or health config changed.
    // apply_view downgrades the radar top to the calendar when the radar data was
    // cleared. The bottom is clamped to BOTTOM_FORECAST when health is no longer
    // active so a settings message that disables health immediately falls back to
    // the forecast view — apply_view also updates s_bottom_view in that case.
    apply_view(s_top_view, health_view_active() ? s_bottom_view : BOTTOM_FORECAST);
}

void main_window_relayout(void) {
    GRect bounds = layer_get_bounds(window_get_root_layer(s_main_window));
    MainLayout L = compute_layout(bounds, g_config->compact_top_view);
    // top-status and time bands are identical in both modes — only reframe what moves.
    layer_set_frame(calendar_layer_get_root(), L.top);
    layer_set_frame(rain_radar_layer_get_root(), L.top);
    layer_set_frame(weather_status_layer_get_root(), L.status);
#if defined(PBL_HEALTH)
    layer_set_frame(health_status_layer_get_root(), L.status);
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
    forecast_layer_refresh();
    calendar_layer_refresh();
    top_status_layer_refresh();
}

void main_window_destroy() {
    // Interface for destroying the main window (implicitly unloads contents)
    window_destroy(s_main_window);
}
