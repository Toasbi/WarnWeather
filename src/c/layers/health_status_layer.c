#include <pebble.h>
#include "health_status_layer.h"

#if defined(PBL_HEALTH)

#include "status_row.h"
#include "../windows/layout.h"   // LayoutTier
#include "../appendix/status_line.h"

#define HEALTH_TALL_BAND_MIN 16
#define HEALTH_SECTION_DROP 2

static Layer *s_health_status_layer;
static StatusRow *s_row;
static uint8_t s_render_tier = LAYOUT_TIER_COMPACT;
static bool s_full_mode = false;
static bool s_full_date;
static GRect s_applied_bounds;
static bool s_has_applied_bounds;

static void health_status_update_proc(Layer *layer, GContext *ctx) {
    (void)layer;
    status_row_draw(s_row, ctx);
}

static bool bounds_equal(GRect a, GRect b) {
    return a.origin.x == b.origin.x && a.origin.y == b.origin.y
        && a.size.w == b.size.w && a.size.h == b.size.h;
}

static bool apply_row(void) {
    if (!s_row || !s_health_status_layer) { return false; }
    GRect bounds = layer_get_bounds(s_health_status_layer);
    // The dual-row compact view delegates LAYOUT_TIER_FULL to both rows. Preserve its
    // legacy nudge away from the calendar; the true full view must remain unshifted.
    if (s_render_tier == LAYOUT_TIER_FULL
            && bounds.size.h > HEALTH_TALL_BAND_MIN
            && !s_full_mode) {
        bounds.origin.y += HEALTH_SECTION_DROP;
        bounds.size.h -= HEALTH_SECTION_DROP;
    }
    bool geometry_changed = !s_has_applied_bounds
        || !bounds_equal(bounds, s_applied_bounds);
    status_row_apply(s_row, bounds, s_render_tier, STATUS_LINE_HEALTH);
    s_applied_bounds = bounds;
    s_has_applied_bounds = true;
    return geometry_changed;
}

static void refresh_row(void) {
    bool geometry_changed = apply_row();
    if (!s_row) { return; }
    if (status_row_refresh(s_row) || geometry_changed) {
        layer_mark_dirty(s_health_status_layer);
    }
}

void health_status_layer_create(Layer *parent_layer, GRect frame) {
    s_health_status_layer = layer_create(frame);
    layer_set_update_proc(s_health_status_layer, health_status_update_proc);
    layer_add_child(parent_layer, s_health_status_layer);
    s_row = status_row_create(STATUS_LINE_HEALTH);
    status_row_set_full_date(s_row, s_full_date);
    apply_row();
    health_status_layer_refresh();
}

void health_status_layer_set_render_tier(uint8_t tier) {
    if (tier == s_render_tier) { return; }
    s_render_tier = tier;
    refresh_row();
}

void health_status_layer_set_full_mode(bool full) {
    if (full == s_full_mode) { return; }
    s_full_mode = full;
    refresh_row();
}

void health_status_layer_set_full_date(bool full_date) {
    if (full_date == s_full_date) { return; }
    s_full_date = full_date;
    if (s_row) {
        status_row_set_full_date(s_row, s_full_date);
        refresh_row();
    }
}

Layer *health_status_layer_get_root(void) {
    return s_health_status_layer;
}

void health_status_layer_refresh(void) {
    refresh_row();
}

void health_status_layer_destroy(void) {
    status_row_destroy(s_row);
    s_row = NULL;
    s_has_applied_bounds = false;
    layer_destroy(s_health_status_layer);
    s_health_status_layer = NULL;
}

#endif  // PBL_HEALTH
