#include <pebble.h>
#include "health_status_layer.h"

#if defined(PBL_HEALTH)

#include "status_row.h"
#include "../appendix/config.h"
#include "../appendix/status_line.h"

#define HEALTH_TALL_BAND_MIN 16
#define HEALTH_SECTION_DROP 2

static Layer *s_health_status_layer;
static StatusRow *s_row;
static uint8_t s_render_tier = TOP_VIEW_COMPACT;
static bool s_full_mode = false;

static void health_status_update_proc(Layer *layer, GContext *ctx) {
    (void)layer;
    status_row_draw(s_row, ctx);
}

static void apply_row(void) {
    if (!s_row || !s_health_status_layer) { return; }
    GRect bounds = layer_get_bounds(s_health_status_layer);
    // The dual-row compact view delegates TOP_VIEW_FULL to both rows. Preserve its
    // legacy nudge away from the calendar; the true full view must remain unshifted.
    if (s_render_tier == TOP_VIEW_FULL
            && bounds.size.h > HEALTH_TALL_BAND_MIN
            && !s_full_mode) {
        bounds.origin.y += HEALTH_SECTION_DROP;
        bounds.size.h -= HEALTH_SECTION_DROP;
    }
    status_row_apply(s_row, bounds, s_render_tier, STATUS_LINE_HEALTH);
}

void health_status_layer_create(Layer *parent_layer, GRect frame) {
    s_health_status_layer = layer_create(frame);
    layer_set_update_proc(s_health_status_layer, health_status_update_proc);
    layer_add_child(parent_layer, s_health_status_layer);
    s_row = status_row_create(STATUS_LINE_HEALTH);
    apply_row();
    health_status_layer_refresh();
}

void health_status_layer_set_render_tier(uint8_t tier) {
    s_render_tier = tier;
}

void health_status_layer_set_full_mode(bool full) {
    s_full_mode = full;
}

Layer *health_status_layer_get_root(void) {
    return s_health_status_layer;
}

void health_status_layer_refresh(void) {
    if (!s_row) { return; }
    apply_row();
    if (status_row_refresh(s_row)) {
        layer_mark_dirty(s_health_status_layer);
    }
}

void health_status_layer_destroy(void) {
    status_row_destroy(s_row);
    s_row = NULL;
    layer_destroy(s_health_status_layer);
    s_health_status_layer = NULL;
}

#endif  // PBL_HEALTH
