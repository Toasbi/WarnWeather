#include "weather_status_layer.h"
#include "c/appendix/persist.h"
#include "c/appendix/config.h"
#include "c/appendix/memory_log.h"
#include "c/appendix/snooze.h"
#include "c/layers/layer_util.h"

#define FONT_18_OFFSET 7
#define FONT_14_OFFSET 3
#define MARGIN 2
// Width reserved for the snooze glyphs in place of the current-temp text.
#define SNOOZE_BOX_W 24

// emery: use larger text and arrow geometry
#ifdef PBL_PLATFORM_EMERY
#define CITY_FONT_KEY FONT_KEY_GOTHIC_18
#define SUN_EVENT_FONT_KEY FONT_KEY_GOTHIC_18
// emery: city/sun are 18px too, so the 18px temp already matches — baseline-align.
#define TEMP_Y_OFFSET FONT_18_OFFSET
#define ARROW_H 10
#define ARROW_HEAD_H 4
#define ARROW_HEAD_W 3
#define ARROW_W 8
#else
#define CITY_FONT_KEY FONT_KEY_GOTHIC_14
#define SUN_EVENT_FONT_KEY FONT_KEY_GOTHIC_14
// The 18px temp glyphs are 2px taller than the 14px city/sun labels, so a pure
// baseline alignment makes the temp read as sitting too high. Nudge it down 1px
// so it is vertically centered against the labels (verified: bottom stays within
// the row's clip, well above the forecast below).
#define TEMP_Y_OFFSET (FONT_18_OFFSET - 1)
#define ARROW_H 8
#define ARROW_HEAD_H 3
#define ARROW_HEAD_W 2
#define ARROW_W 6
#endif

// Overflow mode matching the previous TextLayer default. Centralized so it is
// used identically for measurement and drawing; flip here if the long-city
// parity check (see plan) shows the old layers wrapped instead of ellipsizing.
#define STATUS_TEXT_OVERFLOW GTextOverflowModeTrailingEllipsis

// Reference rects for inter-element layout (city sits between temp and sun).
static GRect frame_curr_temp;
static GRect frame_sun_event;
// Draw rects: where each string is painted, in this layer's coordinate space
// (formerly each child TextLayer's frame within the parent).
static GRect frame_temp_draw;
static GRect frame_city;
static GRect frame_sun_draw;

// Text buffers, file-scope so the update proc can paint them (formerly the
// function-static buffers behind each TextLayer's text pointer).
static char s_city_buffer[20];
static char s_temp_buffer[8];
static char s_sun_buffer[8];

static Layer *s_weather_status_layer;

static GPath *s_arrow_path = NULL;
static const GPathInfo ARROW_PATH_INFO = {
    // Downward facing arrow, centered at the origin
    .num_points = 6,
    .points = (GPoint[]){
        {0, -ARROW_H/2},
        {0, ARROW_H/2 - ARROW_HEAD_H},
        {-ARROW_HEAD_W, ARROW_H/2 - ARROW_HEAD_H},
        {0, ARROW_H/2},
        {ARROW_HEAD_W, ARROW_H/2 - ARROW_HEAD_H},
        {0, ARROW_H/2 - ARROW_HEAD_H}
    }
};

static GFont temp_font(void) { return fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD); }
static GFont city_font(void) { return fonts_get_system_font(CITY_FONT_KEY); }
static GFont sun_font(void)  { return fonts_get_system_font(SUN_EVENT_FONT_KEY); }

static void current_temp_layer_refresh() {
    if (persist_get_is_sleeping()) {
        // Snooze glyphs are drawn in the update proc; blank the text and reserve
        // a fixed box so the city label keeps its position. Only origin.x and
        // size.w of frame_curr_temp are ever read (by city_layer_refresh).
        s_temp_buffer[0] = '\0';
        frame_temp_draw = GRect(MARGIN, -TEMP_Y_OFFSET, 0, 0);
        frame_curr_temp = GRect(0, -TEMP_Y_OFFSET, SNOOZE_BOX_W + MARGIN, 24);
        return;
    }
    snprintf(s_temp_buffer, sizeof(s_temp_buffer), "• %d",
             config_localize_temp(persist_get_current_temp()));
    GSize size = graphics_text_layout_get_content_size(
        s_temp_buffer, temp_font(), GRect(0, 0, 100, 100),
        STATUS_TEXT_OVERFLOW, GTextAlignmentLeft);
    frame_temp_draw = GRect(MARGIN, -TEMP_Y_OFFSET, size.w, size.h);
    frame_curr_temp = GRect(0, -TEMP_Y_OFFSET, size.w + MARGIN, size.h);
}

static void sun_event_layer_refresh() {
    GRect bounds = layer_get_bounds(s_weather_status_layer);
    // Time of the first sun event; zero when nothing is persisted yet.
    time_t first_sun_event_time = 0;
    persist_get_sun_event_times(&first_sun_event_time, 1);
    struct tm *sun_time = localtime(&first_sun_event_time);
    config_format_time(s_sun_buffer, sizeof(s_sun_buffer), sun_time);

    GSize size = graphics_text_layout_get_content_size(
        s_sun_buffer, sun_font(), GRect(0, 0, 100, 100),
        STATUS_TEXT_OVERFLOW, GTextAlignmentLeft);
    int y;
    // emery: align sun-event baseline with 18px font metrics instead of 14px.
#ifdef PBL_PLATFORM_EMERY
    y = -FONT_18_OFFSET;
#else
    y = -FONT_14_OFFSET;
#endif
    frame_sun_draw  = GRect(bounds.size.w - MARGIN - ARROW_W - size.w, y,
                            size.w + ARROW_W, size.h);
    frame_sun_event = GRect(bounds.size.w - MARGIN - ARROW_W - size.w, y,
                            size.w + ARROW_W + MARGIN, size.h);
}

static void city_layer_refresh() {
    if (persist_get_city(s_city_buffer, sizeof(s_city_buffer)) <= 0) {
        s_city_buffer[0] = '\0';  // No city persisted yet (fresh install)
    }
    GRect bounds = layer_get_bounds(s_weather_status_layer);
    int x = frame_curr_temp.origin.x + frame_curr_temp.size.w + MARGIN * 2;
    int w = bounds.size.w - frame_curr_temp.size.w - frame_sun_event.size.w - MARGIN * 4;
    GSize size = graphics_text_layout_get_content_size(
        s_city_buffer, city_font(), GRect(0, 0, w, 100),
        STATUS_TEXT_OVERFLOW, GTextAlignmentCenter);
    int y;
    int h;
    // emery: align city baseline with 18px font metrics instead of 14px.
#ifdef PBL_PLATFORM_EMERY
    y = -FONT_18_OFFSET;
    h = size.h + FONT_18_OFFSET;
#else
    y = -FONT_14_OFFSET;
    h = size.h + FONT_14_OFFSET;
#endif
    frame_city = GRect(x, y, w, h);
}

static void weather_status_layer_init() {
    // Order matters: temp sets frame_curr_temp, sun sets frame_sun_event, and
    // city reads both to center itself in the remaining space.
    current_temp_layer_refresh();
    sun_event_layer_refresh();
    city_layer_refresh();
}

static void weather_status_update_proc(Layer *layer, GContext *ctx) {
    MEMORY_LOG_HEAP("weather_status_update:enter");
    GRect bounds = layer_get_bounds(layer);
    int w = bounds.size.w;

    graphics_context_set_text_color(ctx, GColorWhite);
    if (persist_get_is_sleeping()) {
        // Compact snooze glyphs in the slot the temperature text vacated.
        snooze_draw(ctx, GRect(MARGIN, 2, SNOOZE_BOX_W, bounds.size.h - 4), GColorWhite);
    } else {
        graphics_draw_text(ctx, s_temp_buffer, temp_font(), frame_temp_draw,
                           STATUS_TEXT_OVERFLOW, GTextAlignmentLeft, NULL);
    }
    graphics_draw_text(ctx, s_city_buffer, city_font(), frame_city,
                       STATUS_TEXT_OVERFLOW, GTextAlignmentCenter, NULL);
    graphics_draw_text(ctx, s_sun_buffer, sun_font(), frame_sun_draw,
                       STATUS_TEXT_OVERFLOW, GTextAlignmentLeft, NULL);

    if (!s_arrow_path) {
        MEMORY_LOG_HEAP("weather_status_update:missing_arrow_path");
        return;
    }
    // Translate to correct location in layer
    if (persist_get_sun_event_start_type() == 0) {
        gpath_rotate_to(s_arrow_path, TRIG_MAX_ANGLE / 2);
    } else {
        gpath_rotate_to(s_arrow_path, 0);
    }
    // emery: place arrow lower so it is vertically centered in the taller row.
#ifdef PBL_PLATFORM_EMERY
    gpath_move_to(s_arrow_path, GPoint(w - 4, bounds.size.h - (ARROW_H / 2) - 4));
#else
    gpath_move_to(s_arrow_path, GPoint(w - 4, 6));
#endif
    graphics_context_set_stroke_color(ctx, GColorWhite);
    gpath_draw_outline_open(ctx, s_arrow_path);
    graphics_context_set_fill_color(ctx, GColorWhite);
    gpath_draw_filled(ctx, s_arrow_path);
    MEMORY_LOG_HEAP("weather_status_update:exit");
}

void weather_status_layer_create(Layer* parent_layer, GRect frame) {
    s_weather_status_layer = layer_create(frame);

    s_arrow_path = gpath_create(&ARROW_PATH_INFO);
    if (!s_arrow_path) {
        APP_LOG(APP_LOG_LEVEL_ERROR, "weather_status_layer_create: failed to allocate arrow path");
    }

    weather_status_layer_init();
    layer_set_update_proc(s_weather_status_layer, weather_status_update_proc);
    layer_add_child(parent_layer, s_weather_status_layer);
    MEMORY_LOG_HEAP("after_weather_status_layer_create");
}

void weather_status_layer_refresh() {
    current_temp_layer_refresh();
    sun_event_layer_refresh();
    city_layer_refresh();
    layer_mark_dirty(s_weather_status_layer);
    MEMORY_LOG_HEAP("after_weather_refresh");
}

void weather_status_layer_destroy() {
    MEMORY_LOG_HEAP("weather_status_layer_destroy:before");
    if (s_arrow_path) {
        gpath_destroy(s_arrow_path);
        s_arrow_path = NULL;
    }
    layer_destroy(s_weather_status_layer);
    MEMORY_LOG_HEAP("weather_status_layer_destroy:after");
}

Layer *weather_status_layer_get_root(void) {
    return s_weather_status_layer;
}
