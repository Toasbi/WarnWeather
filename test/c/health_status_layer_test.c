#include <stdio.h>
#include <stdlib.h>
#include "c/windows/layout.h"
#include "c/appendix/status_line.h"
#include "c/layers/health_status_layer.h"
#include "c/layers/status_row.h"

struct GContext { int unused; };
struct Layer {
    GRect frame;
    LayerUpdateProc update_proc;
};
struct StatusRow { uint8_t line_id; };

static int s_failures;
static int s_sequence;
static int s_layer_create_sequence;
static int s_add_sequence;
static int s_row_create_sequence;
static int s_apply_sequence;
static int s_row_refresh_sequence;
static int s_row_destroy_sequence;
static int s_layer_destroy_sequence;
static int s_apply_count;
static int s_row_refresh_count;
static int s_dirty_count;
static int s_draw_count;
static bool s_refresh_changed;
static GRect s_last_bounds;
static uint8_t s_last_tier;
static uint8_t s_last_line;

static void expect_int(const char *name, int got, int want) {
    if (got != want) {
        printf("FAIL %s: got %d want %d\n", name, got, want);
        s_failures++;
    }
}

Layer *layer_create(GRect frame) {
    Layer *layer = malloc(sizeof(*layer));
    layer->frame = frame;
    layer->update_proc = NULL;
    s_layer_create_sequence = ++s_sequence;
    return layer;
}

void layer_set_update_proc(Layer *layer, LayerUpdateProc update_proc) {
    layer->update_proc = update_proc;
}

void layer_add_child(Layer *parent, Layer *child) {
    (void)parent;
    (void)child;
    s_add_sequence = ++s_sequence;
}

GRect layer_get_bounds(const Layer *layer) {
    return GRect(0, 0, layer->frame.size.w, layer->frame.size.h);
}

void layer_mark_dirty(Layer *layer) {
    (void)layer;
    s_dirty_count++;
}

void layer_destroy(Layer *layer) {
    s_layer_destroy_sequence = ++s_sequence;
    free(layer);
}

void layer_set_frame(Layer *layer, GRect frame) { layer->frame = frame; }

StatusRow *status_row_create(uint8_t line_id) {
    StatusRow *row = malloc(sizeof(*row));
    row->line_id = line_id;
    s_row_create_sequence = ++s_sequence;
    return row;
}

void status_row_destroy(StatusRow *row) {
    s_row_destroy_sequence = ++s_sequence;
    free(row);
}

void status_row_apply(StatusRow *row, GRect bounds, uint8_t tier, uint8_t line_id) {
    row->line_id = line_id;
    s_last_bounds = bounds;
    s_last_tier = tier;
    s_last_line = line_id;
    s_apply_count++;
    s_apply_sequence = ++s_sequence;
}

bool status_row_refresh(StatusRow *row) {
    (void)row;
    s_row_refresh_count++;
    s_row_refresh_sequence = ++s_sequence;
    return s_refresh_changed;
}

void status_row_draw(StatusRow *row, GContext *ctx) {
    if (row && ctx) { s_draw_count++; }
}

void status_row_set_full_date(StatusRow *row, bool full_date) {
    (void)row;
    (void)full_date;
}

static void owner_forwards_health_row_and_preserves_nudge(void) {
    Layer parent = {0};
    GContext ctx = {0};
    s_refresh_changed = true;
    health_status_layer_set_render_tier(LAYOUT_TIER_FULL);
    health_status_layer_set_full_mode(true);
    expect_int("precreate.no_apply", s_apply_count, 0);
    expect_int("precreate.no_refresh", s_row_refresh_count, 0);
    expect_int("precreate.no_dirty", s_dirty_count, 0);
    health_status_layer_create(&parent, GRect(3, 4, 144, 20));

    expect_int("create.before_add", s_layer_create_sequence < s_add_sequence, true);
    expect_int("add.before_row", s_add_sequence < s_row_create_sequence, true);
    expect_int("row.before_apply", s_row_create_sequence < s_apply_sequence, true);
    expect_int("apply.before_refresh", s_apply_sequence < s_row_refresh_sequence, true);
    expect_int("create.apply_count", s_apply_count, 2);
    expect_int("create.refresh_count", s_row_refresh_count, 1);
    expect_int("create.dirty", s_dirty_count, 1);
    expect_int("create.bounds.y", s_last_bounds.origin.y, 0);
    expect_int("create.bounds.h", s_last_bounds.size.h, 20);
    expect_int("create.tier", s_last_tier, LAYOUT_TIER_FULL);
    expect_int("create.line", s_last_line, STATUS_LINE_HEALTH);
    expect_int("get_root", health_status_layer_get_root() != NULL, true);

    Layer *root = health_status_layer_get_root();
    root->update_proc(root, &ctx);
    expect_int("draw.delegated", s_draw_count, 1);

    int apply_before = s_apply_count;
    int refresh_before = s_row_refresh_count;
    int dirty_before = s_dirty_count;
    health_status_layer_set_render_tier(LAYOUT_TIER_FULL);
    health_status_layer_set_full_mode(true);
    expect_int("same_setters.no_apply", s_apply_count, apply_before);
    expect_int("same_setters.no_refresh", s_row_refresh_count, refresh_before);
    expect_int("same_setters.no_dirty", s_dirty_count, dirty_before);

    s_refresh_changed = false;
    health_status_layer_set_full_mode(false);
    expect_int("nudge.applied_immediately", s_apply_count, apply_before + 1);
    expect_int("nudge.refreshed_immediately", s_row_refresh_count, refresh_before + 1);
    expect_int("nudge.dirties_geometry", s_dirty_count, dirty_before + 1);
    expect_int("nudge.bounds.y", s_last_bounds.origin.y, 2);
    expect_int("nudge.bounds.h", s_last_bounds.size.h, 18);

    apply_before = s_apply_count;
    refresh_before = s_row_refresh_count;
    dirty_before = s_dirty_count;
    health_status_layer_set_full_mode(false);
    expect_int("same_full.no_apply", s_apply_count, apply_before);
    expect_int("same_full.no_refresh", s_row_refresh_count, refresh_before);
    expect_int("same_full.no_dirty", s_dirty_count, dirty_before);

    health_status_layer_set_full_mode(true);
    expect_int("unnudge.applied_immediately", s_apply_count, apply_before + 1);
    expect_int("unnudge.refreshed_immediately", s_row_refresh_count, refresh_before + 1);
    expect_int("unnudge.dirties_geometry", s_dirty_count, dirty_before + 1);
    expect_int("unnudge.bounds.y", s_last_bounds.origin.y, 0);
    expect_int("unnudge.bounds.h", s_last_bounds.size.h, 20);

    apply_before = s_apply_count;
    refresh_before = s_row_refresh_count;
    dirty_before = s_dirty_count;
    s_refresh_changed = true;
    health_status_layer_set_render_tier(LAYOUT_TIER_COMPACT);
    expect_int("compact.applied_immediately", s_apply_count, apply_before + 1);
    expect_int("compact.refreshed_immediately", s_row_refresh_count, refresh_before + 1);
    expect_int("compact.dirty", s_dirty_count, dirty_before + 1);
    expect_int("compact.bounds.y", s_last_bounds.origin.y, 0);
    expect_int("compact.bounds.h", s_last_bounds.size.h, 20);
    expect_int("compact.tier", s_last_tier, LAYOUT_TIER_COMPACT);

    apply_before = s_apply_count;
    refresh_before = s_row_refresh_count;
    dirty_before = s_dirty_count;
    health_status_layer_set_render_tier(LAYOUT_TIER_COMPACT);
    expect_int("same_tier.no_apply", s_apply_count, apply_before);
    expect_int("same_tier.no_refresh", s_row_refresh_count, refresh_before);
    expect_int("same_tier.no_dirty", s_dirty_count, dirty_before);

    s_refresh_changed = false;
    health_status_layer_set_full_mode(false);
    expect_int("compact_full_change.applied", s_apply_count, apply_before + 1);
    expect_int("compact_full_change.refreshed", s_row_refresh_count, refresh_before + 1);
    expect_int("compact_full_change.no_geometry_dirty", s_dirty_count, dirty_before);

    s_refresh_changed = true;
    health_status_layer_set_render_tier(LAYOUT_TIER_FULL);
    expect_int("full_tier.applied_immediately", s_last_tier, LAYOUT_TIER_FULL);
    expect_int("full_tier.nudged_immediately", s_last_bounds.origin.y, 2);

    s_refresh_changed = false;
    layer_set_frame(root, GRect(0, 0, 144, 16));
    health_status_layer_refresh();
    expect_int("short_full.bounds.y", s_last_bounds.origin.y, 0);
    expect_int("short_full.bounds.h", s_last_bounds.size.h, 16);

    apply_before = s_apply_count;
    refresh_before = s_row_refresh_count;
    dirty_before = s_dirty_count;
    health_status_layer_set_full_mode(true);
    expect_int("short_full_change.applied", s_apply_count, apply_before + 1);
    expect_int("short_full_change.refreshed", s_row_refresh_count, refresh_before + 1);
    expect_int("short_full_change.no_geometry_dirty", s_dirty_count, dirty_before);

    health_status_layer_set_full_mode(false);
    expect_int("short_false.bounds.y", s_last_bounds.origin.y, 0);
    expect_int("short_false.bounds.h", s_last_bounds.size.h, 16);

    layer_set_frame(root, GRect(0, 0, 144, 17));
    health_status_layer_refresh();
    expect_int("dual_compact.bounds.y", s_last_bounds.origin.y, 2);
    expect_int("dual_compact.bounds.h", s_last_bounds.size.h, 15);

    apply_before = s_apply_count;
    refresh_before = s_row_refresh_count;
    dirty_before = s_dirty_count;
    health_status_layer_set_full_mode(true);
    expect_int("full_mode.applied_immediately", s_apply_count, apply_before + 1);
    expect_int("full_mode.refreshed_immediately", s_row_refresh_count, refresh_before + 1);
    expect_int("full_mode.dirties_geometry", s_dirty_count, dirty_before + 1);
    expect_int("full_mode.bounds.y", s_last_bounds.origin.y, 0);
    expect_int("full_mode.bounds.h", s_last_bounds.size.h, 17);

    health_status_layer_destroy();
    expect_int("destroy.row_before_layer",
               s_row_destroy_sequence < s_layer_destroy_sequence, true);
    expect_int("destroy.root_null", health_status_layer_get_root() == NULL, true);
}

int main(void) {
    owner_forwards_health_row_and_preserves_nudge();
    if (s_failures) {
        printf("%d health_status_layer failure(s)\n", s_failures);
        return 1;
    }
    printf("health_status_layer OK\n");
    return 0;
}
