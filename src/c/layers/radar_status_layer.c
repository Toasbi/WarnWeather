#include <pebble.h>
#include "radar_status_layer.h"
#if defined(WW_RAIN_RADAR)
#include "status_row.h"
#include "../windows/layout.h"   // LayoutTier
#include "../appendix/status_line.h"

// Radar sibling of weather_status_layer, fixed to STATUS_LINE_RADAR. Feature-frozen twin of
// weather_status_layer.c's body — the only intended differences are the fixed line id and the
// WW_RAIN_RADAR guard (aplite has no radar, so --gc-sections reaps this whole leaf there).

static Layer *s_radar_status_layer;
static StatusRow *s_row;
static uint8_t s_render_tier = LAYOUT_TIER_COMPACT;
static bool s_full_date;

static void radar_status_update_proc(Layer *layer, GContext *ctx) {
    (void)layer;
    status_row_draw(s_row, ctx);
}

static void apply_row(void) {
    if (!s_row || !s_radar_status_layer) { return; }
    GRect bounds = layer_get_bounds(s_radar_status_layer);
    status_row_apply(s_row, bounds, s_render_tier, STATUS_LINE_RADAR);
}

static void refresh_row(void) {
    apply_row();
    if (s_row && status_row_refresh(s_row)) {
        layer_mark_dirty(s_radar_status_layer);
    }
}

void radar_status_layer_create(Layer *parent_layer, GRect frame) {
    s_radar_status_layer = layer_create(frame);
    layer_set_update_proc(s_radar_status_layer, radar_status_update_proc);
    layer_add_child(parent_layer, s_radar_status_layer);
    s_row = status_row_create(STATUS_LINE_RADAR);
    status_row_set_full_date(s_row, s_full_date);
    apply_row();
    radar_status_layer_refresh();
}

void radar_status_layer_refresh(void) {
    if (!s_row) { return; }
    refresh_row();
}

void radar_status_layer_set_render_tier(uint8_t tier) {
    if (tier == s_render_tier) { return; }
    s_render_tier = tier;
    refresh_row();
}

void radar_status_layer_set_full_date(bool full_date) {
    if (full_date == s_full_date) { return; }
    s_full_date = full_date;
    if (s_row) {
        status_row_set_full_date(s_row, s_full_date);
        refresh_row();
    }
}

Layer *radar_status_layer_get_root(void) {
    return s_radar_status_layer;
}

void radar_status_layer_destroy(void) {
    status_row_destroy(s_row);
    s_row = NULL;
    layer_destroy(s_radar_status_layer);
    s_radar_status_layer = NULL;
}
#endif
