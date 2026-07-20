#include <pebble.h>
#include "weather_status_layer.h"
#include "status_row.h"
#include "../windows/layout.h"   // LayoutTier
#include "../appendix/status_line.h"

static Layer *s_weather_status_layer;
static StatusRow *s_row;
static uint8_t s_render_tier = LAYOUT_TIER_COMPACT;
static bool s_full_date;
static uint8_t s_line_id = STATUS_LINE_FORECAST;

static void weather_status_update_proc(Layer *layer, GContext *ctx) {
    (void)layer;
    status_row_draw(s_row, ctx);
}

static void apply_row(void) {
    if (!s_row || !s_weather_status_layer) { return; }
    GRect bounds = layer_get_bounds(s_weather_status_layer);
    status_row_apply(s_row, bounds, s_render_tier, s_line_id);
}

static void refresh_row(void) {
    apply_row();
    if (s_row && status_row_refresh(s_row)) {
        layer_mark_dirty(s_weather_status_layer);
    }
}

void weather_status_layer_create(Layer *parent_layer, GRect frame) {
    s_weather_status_layer = layer_create(frame);
    layer_set_update_proc(s_weather_status_layer, weather_status_update_proc);
    layer_add_child(parent_layer, s_weather_status_layer);
    s_row = status_row_create(s_line_id);
    status_row_set_full_date(s_row, s_full_date);
    apply_row();
    weather_status_layer_refresh();
}

void weather_status_layer_refresh() {
    if (!s_row) { return; }
    refresh_row();
}

void weather_status_layer_set_render_tier(uint8_t tier) {
    if (tier == s_render_tier) { return; }
    s_render_tier = tier;
    refresh_row();
}

void weather_status_layer_set_full_date(bool full_date) {
    if (full_date == s_full_date) { return; }
    s_full_date = full_date;
    if (s_row) {
        status_row_set_full_date(s_row, s_full_date);
        refresh_row();
    }
}

void weather_status_layer_set_line(uint8_t line_id) {
    if (line_id == s_line_id) { return; }
    s_line_id = line_id;
    refresh_row();
}

bool weather_status_layer_uses_live_health(void) {
    return s_row && status_row_uses_live_health(s_row);
}

Layer *weather_status_layer_get_root(void) {
    return s_weather_status_layer;
}

void weather_status_layer_destroy() {
    status_row_destroy(s_row);
    s_row = NULL;
    layer_destroy(s_weather_status_layer);
    s_weather_status_layer = NULL;
}
