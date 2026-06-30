#include "main_window.h"
#include "c/layers/time_layer.h"
#include "c/layers/forecast_layer.h"
#include "c/layers/weather_status_layer.h"
#include "c/layers/calendar_layer.h"
#include "c/layers/rain_radar_layer.h"
#include "c/layers/calendar_status_layer.h"
#include "c/layers/loading_layer.h"
#include "c/layers/health_graph_layer.h"
#include "c/layers/health_status_layer.h"
#include "c/services/health.h"
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
            // Pull fresh health data before the alternate view becomes visible.
            health_graph_layer_refresh();
            health_status_layer_refresh();
            // apply_view downgrades the radar top to the calendar when there is no data.
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

static void main_window_load(Window *window) {
    // Get information about the Window
    Layer *window_layer = window_get_root_layer(window);
    GRect bounds = layer_get_bounds(window_layer);
    int w = bounds.size.w;
    int h = bounds.size.h;
    window_set_background_color(window, GColorBlack);

#ifdef PBL_PLATFORM_EMERY
    // emery: pad to avoid content getting obscured by screen edge
    int content_x = EMERY_WINDOW_PAD_X;
    int content_y = EMERY_WINDOW_PAD_TOP;
    int content_w = w - EMERY_WINDOW_PAD_X * 2;
    int forecast_w = w - content_x;
    int content_h = h - EMERY_WINDOW_PAD_TOP - EMERY_WINDOW_PAD_BOTTOM - CALENDAR_STATUS_HEIGHT - WEATHER_STATUS_HEIGHT;
    int calendar_h;
    int time_h;
    int forecast_h;
    compute_content_layout(content_h, &calendar_h, &time_h, &forecast_h);

    int calendar_y = content_y + CALENDAR_STATUS_HEIGHT;
    int time_y = calendar_y + calendar_h;
    int weather_status_y = time_y + time_h;
    int forecast_y = weather_status_y + WEATHER_STATUS_HEIGHT;

    forecast_layer_create(window_layer, GRect(content_x, forecast_y, forecast_w, forecast_h));
#if defined(PBL_HEALTH)
    health_graph_layer_create(window_layer, GRect(content_x, forecast_y, forecast_w, forecast_h));
#endif
    weather_status_layer_create(window_layer, GRect(content_x, weather_status_y, content_w, WEATHER_STATUS_HEIGHT));
#if defined(PBL_HEALTH)
    health_status_layer_create(window_layer, GRect(content_x, weather_status_y, content_w, WEATHER_STATUS_HEIGHT));
#endif
    time_layer_create(window_layer, GRect(content_x, time_y, content_w, time_h));
    calendar_layer_create(window_layer, GRect(content_x, calendar_y, content_w, calendar_h));
    rain_radar_layer_create(window_layer, GRect(content_x, calendar_y, content_w, calendar_h));
    calendar_status_layer_create(window_layer, GRect(content_x, content_y, content_w, CALENDAR_STATUS_HEIGHT + 1)); // +1 to stop text clipping
    loading_layer_create(window_layer, GRect(content_x, weather_status_y, content_w, h - EMERY_WINDOW_PAD_BOTTOM - weather_status_y));
#else
    forecast_layer_create(window_layer,
            GRect(0, h - FORECAST_HEIGHT, w, FORECAST_HEIGHT));
#if defined(PBL_HEALTH)
    health_graph_layer_create(window_layer,
            GRect(0, h - FORECAST_HEIGHT, w, FORECAST_HEIGHT));
#endif
    weather_status_layer_create(window_layer,
            GRect(0, h - FORECAST_HEIGHT - WEATHER_STATUS_HEIGHT, w, WEATHER_STATUS_HEIGHT));
#if defined(PBL_HEALTH)
    health_status_layer_create(window_layer,
            GRect(0, h - FORECAST_HEIGHT - WEATHER_STATUS_HEIGHT, w, WEATHER_STATUS_HEIGHT));
#endif
    time_layer_create(window_layer,
            GRect(0, h - FORECAST_HEIGHT - WEATHER_STATUS_HEIGHT - TIME_HEIGHT,
            bounds.size.w, TIME_HEIGHT));
    calendar_layer_create(window_layer,
            GRect(0, CALENDAR_STATUS_HEIGHT, bounds.size.w, CALENDAR_HEIGHT));
    rain_radar_layer_create(window_layer,
            GRect(0, CALENDAR_STATUS_HEIGHT, bounds.size.w, CALENDAR_HEIGHT));
    calendar_status_layer_create(window_layer,
            GRect(0, 0, bounds.size.w, CALENDAR_STATUS_HEIGHT + 1));  // +1 to stop text clipping
    loading_layer_create(window_layer,
            GRect(0, h - FORECAST_HEIGHT - WEATHER_STATUS_HEIGHT, w, FORECAST_HEIGHT + WEATHER_STATUS_HEIGHT));
#endif
    loading_layer_refresh();
    app_message_send_startup_state(loading_layer_data_is_fresh());
    // The view is session-only state: every launch starts on the DEFAULT view
    // (calendar + forecast + weather-status) and a wrist-flick toggles it.
    apply_view(TOP_VIEW_CALENDAR, BOTTOM_FORECAST);
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
    calendar_status_layer_destroy();
    loading_layer_destroy();
    MEMORY_LOG_HEAP("after_window_unload");
}

static void minute_handler(struct tm *tick_time, TimeUnits units_changed) {
    time_layer_tick();
    /* tm_hour==0 missed day changes from emulator time jumps (same clock, new date). */
    if (units_changed & DAY_UNIT) {
        calendar_layer_refresh();
        calendar_status_layer_refresh();
    }
    calendar_status_layer_tick();
    loading_layer_refresh();
#if defined(PBL_HEALTH)
    // Keep the health view current only while it is the one on screen.
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
    // Re-apply the current view after radar availability or health config changed.
    // apply_view downgrades the radar top to the calendar when the radar data was
    // cleared. The bottom is clamped to BOTTOM_FORECAST when health is no longer
    // active so a settings message that disables health immediately falls back to
    // the forecast view — apply_view also updates s_bottom_view in that case.
    apply_view(s_top_view, health_view_active() ? s_bottom_view : BOTTOM_FORECAST);
}

void main_window_refresh() {
    time_layer_refresh();
    weather_status_layer_refresh();
    forecast_layer_refresh();
    calendar_layer_refresh();
    calendar_status_layer_refresh();
}

void main_window_destroy() {
    // Interface for destroying the main window (implicitly unloads contents)
    window_destroy(s_main_window);
}
