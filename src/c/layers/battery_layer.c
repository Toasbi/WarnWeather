#include "battery_layer.h"
#include "battery_draw.h"
#include "c/appendix/memory_log.h"
#include "c/appendix/theme.h"
#include "c/services/watch_services.h"

static Layer *s_battery_layer;
static bool s_battery_subscribed;

static void battery_state_handler(BatteryChargeState charge) {
    battery_layer_refresh();
}

static void battery_update_proc(Layer *layer, GContext *ctx) {
    battery_draw(ctx, layer_get_bounds(layer), theme_fg());
}

void battery_layer_create(Layer* parent_layer, GRect frame) {
    s_battery_layer = layer_create(frame);
    layer_set_update_proc(s_battery_layer, battery_update_proc);
    if (!watch_services_battery_is_fixture()) {
        battery_state_service_subscribe(battery_state_handler);
        s_battery_subscribed = true;
    } else {
        s_battery_subscribed = false;
    }
    layer_add_child(parent_layer, s_battery_layer);
    MEMORY_LOG_HEAP("after_battery_layer_create");
}

void battery_layer_refresh() {
    layer_mark_dirty(s_battery_layer);
}

void battery_layer_destroy() {
    if (s_battery_subscribed) {
        battery_state_service_unsubscribe();
        s_battery_subscribed = false;
    }
    battery_draw_deinit();
    layer_destroy(s_battery_layer);
}
