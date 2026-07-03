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
#define COMPACT_CITY_FONT_KEY FONT_KEY_GOTHIC_24
#define COMPACT_SUN_EVENT_FONT_KEY FONT_KEY_GOTHIC_24
#define COMPACT_TEMP_FONT_KEY FONT_KEY_GOTHIC_24_BOLD
// emery: 24px labels align to the 24px temp; use the 18-offset scaled up.
#define COMPACT_LABEL_OFFSET 6
#define COMPACT_TEMP_Y_OFFSET 6
#define ARROW_H 10
#define ARROW_HEAD_H 4
#define ARROW_HEAD_W 3
#define ARROW_W 8
// emery: none — all three labels share the sun's size (Gothic 24) so the row is uniform
// and the health status row can match it 1:1; one offset baseline-aligns them.
#define NONE_CITY_FONT_KEY FONT_KEY_GOTHIC_24
#define NONE_SUN_EVENT_FONT_KEY FONT_KEY_GOTHIC_24
#define NONE_TEMP_FONT_KEY FONT_KEY_GOTHIC_24
#define NONE_LABEL_OFFSET 5
#define NONE_TEMP_Y_OFFSET 5
#define NONE_SUN_OFFSET 5
#else
#define CITY_FONT_KEY FONT_KEY_GOTHIC_14
#define SUN_EVENT_FONT_KEY FONT_KEY_GOTHIC_14
// The 18px temp glyphs are 2px taller than the 14px city/sun labels, so a pure
// baseline alignment makes the temp read as sitting too high. Nudge it down 1px
// so it is vertically centered against the labels (verified: bottom stays within
// the row's clip, well above the forecast below).
#define TEMP_Y_OFFSET (FONT_18_OFFSET - 1)
#define COMPACT_CITY_FONT_KEY FONT_KEY_GOTHIC_18
#define COMPACT_SUN_EVENT_FONT_KEY FONT_KEY_GOTHIC_18
#define COMPACT_TEMP_FONT_KEY FONT_KEY_GOTHIC_18_BOLD
// Non-Emery compact: all three labels are 28px (the Gothic ceiling), matching the
// 28px city name. The band abuts the calendar/radar; offset 6 seats the text just
// below it (raise the offset to tighten the gap, lower it to widen).
#define COMPACT_LABEL_OFFSET 4
#define COMPACT_TEMP_Y_OFFSET 4
#define ARROW_H 8
#define ARROW_HEAD_H 3
#define ARROW_HEAD_W 2
#define ARROW_W 6
// none — all three labels share the sun's size (Gothic 18) so the row is uniform and the
// health status row can match it 1:1; one offset baseline-aligns them.
#define NONE_CITY_FONT_KEY FONT_KEY_GOTHIC_18
#define NONE_SUN_EVENT_FONT_KEY FONT_KEY_GOTHIC_18
#define NONE_TEMP_FONT_KEY FONT_KEY_GOTHIC_18
#define NONE_LABEL_OFFSET 1
#define NONE_TEMP_Y_OFFSET 1
#define NONE_SUN_OFFSET 1
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

// The render tier (a TopViewMode value) whose fonts and offsets fit this layer's
// band. The window sets it via weather_status_layer_set_render_tier(); the layer
// never derives it from g_config, so the tier can't desync from the band the
// window carved (e.g. the full-height dual-status band under a compact top view).
// Defaults to the config default; always overwritten before the first paint.
static uint8_t s_render_tier = TOP_VIEW_COMPACT;

void weather_status_layer_set_render_tier(uint8_t tier) {
    s_render_tier = tier;
}

#ifdef PBL_PLATFORM_APLITE
// aplite: draw the sun-event arrow (shaft + filled triangular head) with graphics
// primitives instead of a GPath. That removes the last gpath_* caller on aplite so
// the SDK's GPath rasteriser is --gc-sections'd out of the 24 KB image, and no
// transient GPath buffer is allocated at draw time. `up` = arrow points up.
static void draw_sun_arrow(GContext *ctx, int cx, int cy, bool up) {
    const int h2 = ARROW_H / 2;
    const int apex_y = up ? (cy - h2) : (cy + h2);
    const int dir    = up ? 1 : -1;   // head widens away from the apex
    graphics_context_set_stroke_color(ctx, GColorWhite);
    // Shaft: from the tail to the head base.
    graphics_draw_line(ctx, GPoint(cx, up ? cy + h2 : cy - h2),
                            GPoint(cx, apex_y + dir * ARROW_HEAD_H));
    // Head: filled triangle, one white row per head line (0 wide at the apex).
    for (int i = 0; i <= ARROW_HEAD_H; ++i) {
        const int hw = (ARROW_HEAD_W * i) / ARROW_HEAD_H;
        graphics_draw_line(ctx, GPoint(cx - hw, apex_y + dir * i),
                                GPoint(cx + hw, apex_y + dir * i));
    }
}
#else
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
#endif

static const char *tier_key(const char *full, const char *compact, const char *none) {
    switch (s_render_tier) {
        case TOP_VIEW_NONE:    return none;
        case TOP_VIEW_COMPACT: return compact;
        default:               return full;
    }
}

static GFont temp_font(void) {
    return fonts_get_system_font(tier_key(FONT_KEY_GOTHIC_18_BOLD, COMPACT_TEMP_FONT_KEY, NONE_TEMP_FONT_KEY));
}
static GFont city_font(void) {
    return fonts_get_system_font(tier_key(CITY_FONT_KEY, COMPACT_CITY_FONT_KEY, NONE_CITY_FONT_KEY));
}
static GFont sun_font(void) {
    return fonts_get_system_font(tier_key(SUN_EVENT_FONT_KEY, COMPACT_SUN_EVENT_FONT_KEY, NONE_SUN_EVENT_FONT_KEY));
}

static void current_temp_layer_refresh() {
    int temp_y = status_text_y(layer_get_bounds(s_weather_status_layer).size.h, temp_font());
    if (persist_get_is_sleeping()) {
        // Snooze glyphs are drawn in the update proc; blank the text and reserve
        // a fixed box so the city label keeps its position. Only origin.x and
        // size.w of frame_curr_temp are ever read (by city_layer_refresh).
        s_temp_buffer[0] = '\0';
        frame_temp_draw = GRect(MARGIN, temp_y, 0, 0);
        frame_curr_temp = GRect(0, temp_y, SNOOZE_BOX_W + MARGIN, 24);
        return;
    }
    snprintf(s_temp_buffer, sizeof(s_temp_buffer), "•%d",
             config_localize_temp(persist_get_current_temp()));
    GSize size = graphics_text_layout_get_content_size(
        s_temp_buffer, temp_font(), GRect(0, 0, 100, 100),
        STATUS_TEXT_OVERFLOW, GTextAlignmentLeft);
    frame_temp_draw = GRect(MARGIN, temp_y, size.w, size.h);
    frame_curr_temp = GRect(0, temp_y, size.w + MARGIN, size.h);
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
    int y = status_text_y(bounds.size.h, sun_font());
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
    int y = status_text_y(bounds.size.h, city_font());
    frame_city = GRect(x, y, w, size.h);
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

    // Centre the arrow on the sun-time digits' visual centre (status_glyph_center_y — the same
    // helper the health metric icons use), so it tracks the digits wherever status_text_y seats the
    // line without a fixed per-band drop.
    int arrow_y = status_glyph_center_y(frame_sun_draw.origin.y, frame_sun_draw.size.h);
    // start_type 0 → next event is a sunrise (arrow points up); else a sunset (down).
    const bool arrow_up = (persist_get_sun_event_start_type() == 0);
#ifdef PBL_PLATFORM_APLITE
    draw_sun_arrow(ctx, w - 4, arrow_y, arrow_up);
#else
    if (!s_arrow_path) {
        MEMORY_LOG_HEAP("weather_status_update:missing_arrow_path");
        return;
    }
    gpath_rotate_to(s_arrow_path, arrow_up ? TRIG_MAX_ANGLE / 2 : 0);
    gpath_move_to(s_arrow_path, GPoint(w - 4, arrow_y));
    graphics_context_set_stroke_color(ctx, GColorWhite);
    gpath_draw_outline_open(ctx, s_arrow_path);
    graphics_context_set_fill_color(ctx, GColorWhite);
    gpath_draw_filled(ctx, s_arrow_path);
#endif
    MEMORY_LOG_HEAP("weather_status_update:exit");
}

void weather_status_layer_create(Layer* parent_layer, GRect frame) {
    s_weather_status_layer = layer_create(frame);

#ifndef PBL_PLATFORM_APLITE
    s_arrow_path = gpath_create(&ARROW_PATH_INFO);
    if (!s_arrow_path) {
        APP_LOG(APP_LOG_LEVEL_ERROR, "weather_status_layer_create: failed to allocate arrow path");
    }
#endif

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
#ifndef PBL_PLATFORM_APLITE
    if (s_arrow_path) {
        gpath_destroy(s_arrow_path);
        s_arrow_path = NULL;
    }
#endif
    layer_destroy(s_weather_status_layer);
    MEMORY_LOG_HEAP("weather_status_layer_destroy:after");
}

Layer *weather_status_layer_get_root(void) {
    return s_weather_status_layer;
}
