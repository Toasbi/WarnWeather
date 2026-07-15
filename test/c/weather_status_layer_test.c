#include <stdio.h>
#include <stdlib.h>

#include "c/appendix/config.h"
#include "c/appendix/status_line.h"
#include "c/layers/status_row.h"
#include "c/layers/weather_status_layer.h"

struct Layer {
    GRect frame;
    LayerUpdateProc update_proc;
};

struct StatusRow {
    uint8_t line_id;
};

static int s_failures;
static int s_sequence;
static int s_create_sequence;
static int s_add_sequence;
static int s_apply_sequence;
static int s_refresh_sequence;
static int s_destroy_row_sequence;
static int s_destroy_layer_sequence;
static int s_apply_count;
static int s_refresh_count;
static int s_dirty_count;
static bool s_refresh_changed;
static bool s_sleeping;
static bool s_live_health;
static bool s_last_sleeping;
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
    s_create_sequence = ++s_sequence;
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
    s_destroy_layer_sequence = ++s_sequence;
    free(layer);
}

StatusRow *status_row_create(uint8_t line_id) {
    StatusRow *row = malloc(sizeof(*row));
    row->line_id = line_id;
    return row;
}

void status_row_destroy(StatusRow *row) {
    s_destroy_row_sequence = ++s_sequence;
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
    s_refresh_count++;
    s_refresh_sequence = ++s_sequence;
    return s_refresh_changed;
}

void status_row_set_sleeping(StatusRow *row, bool sleeping) {
    (void)row;
    s_last_sleeping = sleeping;
}

bool status_row_uses_live_health(const StatusRow *row) {
    return row && s_live_health;
}

void status_row_draw(StatusRow *row, GContext *ctx) {
    (void)row;
    (void)ctx;
}

bool persist_get_is_sleeping(void) {
    return s_sleeping;
}

static void owner_forwards_lifecycle_and_state(void) {
    Layer parent = {0};
    s_refresh_changed = true;
    weather_status_layer_set_render_tier(TOP_VIEW_NONE);
    weather_status_layer_create(&parent, GRect(3, 4, 144, 28));

    expect_int("create.before_add", s_create_sequence < s_add_sequence, true);
    expect_int("add.before_apply", s_add_sequence < s_apply_sequence, true);
    expect_int("apply.before_refresh", s_apply_sequence < s_refresh_sequence, true);
    expect_int("create.apply_count", s_apply_count, 2);
    expect_int("create.refresh_count", s_refresh_count, 1);
    expect_int("create.dirty", s_dirty_count, 1);
    expect_int("create.bounds.w", s_last_bounds.size.w, 144);
    expect_int("create.bounds.h", s_last_bounds.size.h, 28);
    expect_int("create.tier", s_last_tier, TOP_VIEW_NONE);
    expect_int("create.line", s_last_line, STATUS_LINE_FORECAST);

    s_sleeping = true;
    s_refresh_changed = false;
    weather_status_layer_refresh();
    expect_int("refresh.sleeping", s_last_sleeping, true);
    expect_int("refresh.no_dirty", s_dirty_count, 1);

    int apply_before = s_apply_count;
    int refresh_before = s_refresh_count;
    weather_status_layer_set_line(STATUS_LINE_FORECAST);
    expect_int("same_line.no_apply", s_apply_count, apply_before);
    expect_int("same_line.no_refresh", s_refresh_count, refresh_before);

    s_refresh_changed = true;
    weather_status_layer_set_line(STATUS_LINE_RADAR);
    expect_int("new_line.applied", s_last_line, STATUS_LINE_RADAR);
    expect_int("new_line.dirty", s_dirty_count, 2);

    s_live_health = true;
    expect_int("live_health", weather_status_layer_uses_live_health(), true);

    weather_status_layer_destroy();
    expect_int("destroy.row_before_layer",
               s_destroy_row_sequence < s_destroy_layer_sequence, true);
    expect_int("destroy.live_health_false",
               weather_status_layer_uses_live_health(), false);
}

int main(void) {
    owner_forwards_lifecycle_and_state();
    if (s_failures) {
        printf("%d weather_status_layer failure(s)\n", s_failures);
        return 1;
    }
    printf("weather_status_layer OK\n");
    return 0;
}
