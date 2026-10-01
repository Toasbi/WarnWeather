#include "top_status_layer.h"
#include "battery_draw.h"
#include "status_row.h"
#include "c/appendix/config.h"
#include "c/appendix/memory_log.h"
#include "c/appendix/rain_countdown.h"
#include "c/appendix/status_line.h"
#include "c/services/watch_services.h"
#include "c/windows/layout.h"   // LayoutTier (status_row tier param)

#define PADDING 4

static void bluetooth_callback(bool connected);
static void battery_state_callback(BatteryChargeState charge);

static Layer *s_top_status_layer;
static StatusRow *s_row;
static bool s_full_date;
// The window's hook for a Bluetooth or battery change (main_window.c): it reaches
// every bar's On demand items, this strip's included.
static TopStatusSystemChange s_on_system_change;

// The configurable slots (status_row's left slot / date mid slot / right slot) span
// the strip. Bluetooth, Quiet time, Sleep and the low battery are On demand items the
// row draws itself (status_on_demand.c), so the rect never carves room for them: it
// is the quiet strip's rect at all times, and a strip with nothing to show draws
// exactly as it always did. The first left item still lands where the old indicator
// icons drew (screen x 4): the row lets its left run reach STATUS_ROW_MARGIN into the
// margin. The right inset is flush (0) on emery so the top-right slot lines up exactly
// with the weather/health rows' right slots (those rows pass their full bounds to
// status_row_apply — see status_bar.c); on the smaller-screen platforms a flush right
// slot clips the right-slot glyph at content_w (the battery nub reaches its slot
// edge), so they keep a PADDING right pad.
static GRect content_rect(void) {
    GRect bounds = layer_get_bounds(s_top_status_layer);
    int16_t left = PADDING;
    // emery: the wider band clears the right-slot glyph at content_w, so the top-right
    // slot sits flush (aligned with the weather/health rows). The smaller-screen bands
    // clip a flush right slot, so they keep the small right pad.
#ifdef PBL_PLATFORM_EMERY
    int16_t right = 0;
#else
    int16_t right = PADDING;
#endif
    int16_t w = (int16_t)(bounds.size.w - left - right);
    if (w < 0) { w = 0; }
    return GRect((int16_t)(bounds.origin.x + left), bounds.origin.y, w, bounds.size.h);
}

// One paint path: the row, On demand items included.
static void top_status_update_proc(Layer *layer, GContext *ctx) {
    (void)layer;
    status_row_apply(s_row, content_rect(), LAYOUT_TIER_FULL, STATUS_LINE_TOP);
    status_row_draw(s_row, ctx);
}

void top_status_layer_create(Layer* parent_layer, GRect frame) {
    MemoryHeapProbe probe = MEMORY_HEAP_PROBE_START("top_status_layer_create");

    s_top_status_layer = layer_create(frame);
    MEMORY_HEAP_PROBE_SAMPLE("after_layer_create", &probe);

    // The app-wide connection handler: the disconnect vibe, and the Bluetooth item.
    connection_service_subscribe((ConnectionHandlers) {
        .pebble_app_connection_handler = bluetooth_callback
    });
    MEMORY_HEAP_PROBE_SAMPLE("after_connection_subscribe", &probe);

    s_row = status_row_create(STATUS_LINE_TOP);
    status_row_set_full_date(s_row, s_full_date);
    // The battery lives in the top-right status slot and the Battery item; own its
    // event source here as the retired battery corner layer used to.
    if (!watch_services_battery_is_fixture()) {
        battery_state_service_subscribe(battery_state_callback);
    }
    status_row_apply(s_row, content_rect(), LAYOUT_TIER_FULL, STATUS_LINE_TOP);

    // Prime the rain countdown's segment cache from the persisted radar before the
    // strip's first refresh: every bar's Rain item derives from that cache, and after
    // boot only a radar payload rescans it. Only the strip's first refresh finds it
    // primed: main_window_load creates the band rows earlier, and their first refresh
    // (status_bar_create_all) finds the cache empty, so a band bar's Rain item appears
    // at its next refresh — the minute tick (main_window_tick_on_demand) at the latest.
    rain_countdown_refresh(watch_services_now());
    top_status_layer_refresh();

    layer_set_update_proc(s_top_status_layer, top_status_update_proc);
    MEMORY_HEAP_PROBE_SAMPLE("after_update_proc_set", &probe);

    layer_add_child(parent_layer, s_top_status_layer);
    MEMORY_HEAP_PROBE_SAMPLE("after_parent_child_added", &probe);

    MEMORY_LOG_HEAP("after_top_status_layer_create");
    MEMORY_HEAP_PROBE_LOG_MIN(&probe);
}

void top_status_layer_set_full_date(bool full_date) {
    if (full_date == s_full_date) { return; }
    s_full_date = full_date;
    if (s_row) {
        status_row_set_full_date(s_row, s_full_date);
        top_status_layer_refresh();
    }
}

#if defined(WW_VIEW_CYCLE)
Layer *top_status_layer_get_root(void) {
    return s_top_status_layer;
}
#endif

void top_status_layer_set_on_system_change(TopStatusSystemChange cb) {
    s_on_system_change = cb;
}

// A Bluetooth or battery change: every bar's items re-resolve through the window's
// hook; before it is registered, the strip refreshes itself.
static void system_changed(void) {
    if (s_on_system_change) {
        s_on_system_change();
    } else {
        top_status_layer_refresh();
    }
}

static void bluetooth_callback(bool connected) {
    system_changed();
    if (!connected && config_get()->vibe)
        vibes_double_pulse();
}

static void battery_state_callback(BatteryChargeState charge) {
    (void)charge;
    system_changed();
}

void status_icons_refresh() {
    layer_mark_dirty(s_top_status_layer);
}

void top_status_layer_tick() {
    // Per-minute hook. The row refresh IS the per-minute On demand pass: it re-reads
    // Quiet time (no SDK event exists for it), the charge against the Battery item's
    // warn level and the rain alert from the cached countdown (flash-free; the radar
    // scan itself runs only on data change), and folds them into the row signature,
    // so "Rain in 12'" -> "11'" and a Quiet Time window's start repaint here.
    if (status_row_refresh(s_row)) {
        layer_mark_dirty(s_top_status_layer);
    }
}

void top_status_layer_refresh() {
    // Date formatting lives in status_row.c's format_status_date (SLOT_LIVE_DATE); the
    // On demand items are read by the row itself. A refresh always repaints the strip
    // (a theme change reaches it through here), and the row refresh keeps its
    // signature current.
    status_icons_refresh();
    if (status_row_refresh(s_row)) {
        layer_mark_dirty(s_top_status_layer);
    }
}

bool top_status_layer_uses_live_health(void) {
    return s_row && status_row_uses_live_health(s_row);
}

void top_status_layer_destroy() {
    MEMORY_LOG_HEAP("top_status_layer_destroy:before");
    connection_service_unsubscribe();
    if (!watch_services_battery_is_fixture()) {
        battery_state_service_unsubscribe();
    }
    s_on_system_change = NULL;
    battery_draw_deinit();
    status_row_destroy(s_row);
    s_row = NULL;
    layer_destroy(s_top_status_layer);
    MEMORY_LOG_HEAP("top_status_layer_destroy:after");
}
