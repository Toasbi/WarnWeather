#include <stdio.h>
#include <stdlib.h>
#include "c/appendix/config.h"
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

static void owner_forwards_health_row_and_preserves_nudge(void) {
    Layer parent = {0};
    GContext ctx = {0};
    s_refresh_changed = true;
    health_status_layer_set_render_tier(TOP_VIEW_FULL);
    health_status_layer_set_full_mode(false);
    health_status_layer_create(&parent, GRect(3, 4, 144, 20));

    expect_int("create.before_add", s_layer_create_sequence < s_add_sequence, true);
    expect_int("add.before_row", s_add_sequence < s_row_create_sequence, true);
    expect_int("row.before_apply", s_row_create_sequence < s_apply_sequence, true);
    expect_int("apply.before_refresh", s_apply_sequence < s_row_refresh_sequence, true);
    expect_int("create.apply_count", s_apply_count, 2);
    expect_int("create.refresh_count", s_row_refresh_count, 1);
    expect_int("create.dirty", s_dirty_count, 1);
    expect_int("create.bounds.y", s_last_bounds.origin.y, 2);
    expect_int("create.bounds.h", s_last_bounds.size.h, 18);
    expect_int("create.tier", s_last_tier, TOP_VIEW_FULL);
    expect_int("create.line", s_last_line, STATUS_LINE_HEALTH);
    expect_int("get_root", health_status_layer_get_root() != NULL, true);

    Layer *root = health_status_layer_get_root();
    root->update_proc(root, &ctx);
    expect_int("draw.delegated", s_draw_count, 1);

    int apply_before = s_apply_count;
    health_status_layer_set_full_mode(true);
    health_status_layer_set_render_tier(TOP_VIEW_COMPACT);
    expect_int("setters.defer_apply", s_apply_count, apply_before);
    s_refresh_changed = false;
    health_status_layer_refresh();
    expect_int("compact.bounds.y", s_last_bounds.origin.y, 0);
    expect_int("compact.bounds.h", s_last_bounds.size.h, 20);
    expect_int("compact.tier", s_last_tier, TOP_VIEW_COMPACT);
    expect_int("unchanged.no_dirty", s_dirty_count, 1);

    health_status_layer_set_render_tier(TOP_VIEW_FULL);
    layer_set_frame(root, GRect(0, 0, 144, 16));
    health_status_layer_set_full_mode(false);
    health_status_layer_refresh();
    expect_int("short_full.bounds.y", s_last_bounds.origin.y, 0);
    expect_int("short_full.bounds.h", s_last_bounds.size.h, 16);

    layer_set_frame(root, GRect(0, 0, 144, 17));
    health_status_layer_refresh();
    expect_int("dual_compact.bounds.y", s_last_bounds.origin.y, 2);
    expect_int("dual_compact.bounds.h", s_last_bounds.size.h, 15);

    health_status_layer_set_full_mode(true);
    health_status_layer_refresh();
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
