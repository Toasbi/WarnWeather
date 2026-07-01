// Lean aplite (Pebble Classic/Steel) twin of top_status_layer.c.
//
// Frozen fork of top_status_layer.c as of 3c5b2bc. FEATURE-FROZEN, NOT CODE-FROZEN:
// never add features here (aplite deliberately lacks the rain-intensity glyph /
// naming / ladder); hand-port bugfixes from top_status_layer.c
// (see `git log 3c5b2bc.. -- src/c/layers/top_status_layer.c`); interface changes are
// forced by the aplite link error. See docs/adr/0001-aplite-frozen-lean-fork.md.

#include <string.h>
#include "top_status_layer.h"
#include "battery_layer.h"
#include "c/appendix/config.h"
#include "c/appendix/memory_log.h"
#include "c/appendix/rain_countdown.h"
#include "c/services/watch_services.h"

#define BATTERY_W 29
#define BATTERY_H 10
#define PADDING 4
#define MONTH_FONT_OFFSET 7
#define ICON_SLOT_1 GRect(PADDING, 0, 10, 10)
#define ICON_SLOT_2 GRect(PADDING * 2 + 10, 0, 10, 10)
// emery: center icons in the taller status row.
#ifdef PBL_PLATFORM_EMERY
#define STATUS_ICON_Y(bounds_h, icon_h) (((bounds_h) - (icon_h)) / 2)
#define BATTERY_Y(bounds_h) (((bounds_h) - BATTERY_H) / 2)
#define MONTH_FONT_KEY FONT_KEY_GOTHIC_24
#else
#define STATUS_ICON_Y(bounds_h, icon_h) ((void)(bounds_h), (void)(icon_h), 0)
#define BATTERY_Y(bounds_h) ((void)(bounds_h), 1)
#define MONTH_FONT_KEY FONT_KEY_GOTHIC_18
#endif

static Layer *s_top_status_layer;
static char s_calendar_month_text[10];
static GBitmap *s_mute_bitmap;
static GBitmap *s_bt_bitmap;
static GBitmap *s_bt_disconnect_bitmap;
static GColor s_bt_palette[2];
static GColor s_bt_disconnect_palette[2];
static GColor s_mute_palette[2];
// Cached Quiet-Time icon state for the per-minute tick: the mute icon is the
// only status-strip element without an event source, so the minute handler
// repaints the strip only when this flips. Kept in sync by status_icons_refresh.
static bool s_last_qt_active;
// Cached rain-countdown alert string + active flag. recompute_rain_alert keeps
// these in sync from the flash-free Phase B derivation; when active, the alert
// replaces the month in the strip.
static char s_rain_alert_text[20];   // "Rain for 120min" = 15 chars + NUL
static bool s_rain_alert_active;

static GRect month_text_rect(GRect bounds, GFont font, const char *text) {
#ifdef PBL_PLATFORM_EMERY
    // emery: vertically center status text using measured height to match taller status bar.
    const GRect measure_box = GRect(0, 0, bounds.size.w, bounds.size.h);
    const GSize text_size = graphics_text_layout_get_content_size(
        text, font, measure_box, GTextOverflowModeFill, GTextAlignmentCenter);
    const int text_y = ((bounds.size.h - text_size.h) / 2) - 5;
    return GRect(0, text_y, bounds.size.w, text_size.h + 3);
#else
    (void)font;
    (void)text;
    return GRect(0, -MONTH_FONT_OFFSET, bounds.size.w, 25);
#endif
}

static void draw_status_text(GContext *ctx, GRect bounds, const char *text) {
    const GFont font = fonts_get_system_font(MONTH_FONT_KEY);
    graphics_context_set_text_color(ctx, GColorWhite);
    graphics_draw_text(
        ctx,
        text,
        font,
        month_text_rect(bounds, font, text),
        GTextOverflowModeFill,
        GTextAlignmentCenter,
        NULL);
}

static void draw_bitmap(GContext *ctx, GBitmap *bitmap, GRect frame) {
    graphics_context_set_compositing_mode(ctx, GCompOpSet);
    graphics_draw_bitmap_in_rect(ctx, bitmap, frame);
    graphics_context_set_compositing_mode(ctx, GCompOpAssign);
}

static void ensure_mute_bitmap_loaded(void) {
    if (!s_mute_bitmap) {
        s_mute_bitmap = gbitmap_create_with_resource(RESOURCE_ID_IMAGE_MUTE);
        s_mute_palette[0] = GColorWhite;
        s_mute_palette[1] = GColorClear;
        gbitmap_set_palette(s_mute_bitmap, s_mute_palette, false);
    }
}

static void ensure_bt_bitmap_loaded(void) {
    if (!s_bt_bitmap) {
        s_bt_bitmap = gbitmap_create_with_resource(RESOURCE_ID_IMAGE_BT_CONNECT);
        s_bt_palette[0] = PBL_IF_COLOR_ELSE(GColorPictonBlue, GColorWhite);
        s_bt_palette[1] = GColorClear;
        gbitmap_set_palette(s_bt_bitmap, s_bt_palette, false);
    }
}

static void ensure_bt_disconnect_bitmap_loaded(void) {
    if (!s_bt_disconnect_bitmap) {
        s_bt_disconnect_bitmap = gbitmap_create_with_resource(RESOURCE_ID_IMAGE_BT_DISCONNECT);
        s_bt_disconnect_palette[0] = PBL_IF_COLOR_ELSE(GColorRed, GColorWhite);
        s_bt_disconnect_palette[1] = GColorClear;
        gbitmap_set_palette(s_bt_disconnect_bitmap, s_bt_disconnect_palette, false);
    }
}

static void maybe_unload_top_status_bitmaps(bool show_qt, bool connected) {
    bool show_bt = connected && g_config->show_bt;
    bool show_bt_disconnect = !connected && g_config->show_bt_disconnect;

    if (!show_qt && s_mute_bitmap) {
        gbitmap_destroy(s_mute_bitmap);
        s_mute_bitmap = NULL;
    }

    if (!show_bt && s_bt_bitmap) {
        gbitmap_destroy(s_bt_bitmap);
        s_bt_bitmap = NULL;
    }

    if (!show_bt_disconnect && s_bt_disconnect_bitmap) {
        gbitmap_destroy(s_bt_disconnect_bitmap);
        s_bt_disconnect_bitmap = NULL;
    }
}

static void top_status_update_proc(Layer *layer, GContext *ctx) {
    GRect bounds = layer_get_bounds(layer);
    bool show_qt = show_qt_icon();
    bool connected = connection_service_peek_pebble_app_connection();
    int icon_x = show_qt ? ICON_SLOT_2.origin.x : ICON_SLOT_1.origin.x;
    bool show_bt = connected && g_config->show_bt;
    bool show_bt_disconnect = !connected && g_config->show_bt_disconnect;

    maybe_unload_top_status_bitmaps(show_qt, connected);

    if (show_qt) {
        ensure_mute_bitmap_loaded();
        draw_bitmap(ctx, s_mute_bitmap, GRect(ICON_SLOT_1.origin.x, STATUS_ICON_Y(bounds.size.h, ICON_SLOT_1.size.h),
                                              ICON_SLOT_1.size.w, ICON_SLOT_1.size.h));
    }

    if (show_bt) {
        ensure_bt_bitmap_loaded();
        draw_bitmap(ctx, s_bt_bitmap, GRect(icon_x, STATUS_ICON_Y(bounds.size.h, 10), 10, 10));
    } else if (show_bt_disconnect) {
        ensure_bt_disconnect_bitmap_loaded();
        draw_bitmap(ctx, s_bt_disconnect_bitmap, GRect(icon_x, STATUS_ICON_Y(bounds.size.h, 10), 10, 10));
    }

    draw_status_text(ctx, bounds, s_rain_alert_active ? s_rain_alert_text : s_calendar_month_text);
}

void top_status_layer_create(Layer* parent_layer, GRect frame) {
    MemoryHeapProbe probe = MEMORY_HEAP_PROBE_START("top_status_layer_create");

    s_top_status_layer = layer_create(frame);
    MEMORY_HEAP_PROBE_SAMPLE("after_layer_create", &probe);

    GRect bounds = layer_get_bounds(s_top_status_layer);
    int w = bounds.size.w;

    // Set up bluetooth handler
    connection_service_subscribe((ConnectionHandlers) {
        .pebble_app_connection_handler = bluetooth_callback
    });
    MEMORY_HEAP_PROBE_SAMPLE("after_connection_subscribe", &probe);

    rain_countdown_refresh(watch_services_now());
    top_status_layer_refresh();

    layer_set_update_proc(s_top_status_layer, top_status_update_proc);
    MEMORY_HEAP_PROBE_SAMPLE("after_update_proc_set", &probe);

    battery_layer_create(s_top_status_layer,
                         GRect(w - BATTERY_W - PADDING, BATTERY_Y(bounds.size.h), BATTERY_W, BATTERY_H));
    MEMORY_HEAP_PROBE_SAMPLE("after_battery_layer_create", &probe);

    layer_add_child(parent_layer, s_top_status_layer);
    MEMORY_HEAP_PROBE_SAMPLE("after_parent_child_added", &probe);

    MEMORY_LOG_HEAP("after_top_status_layer_create");
    MEMORY_HEAP_PROBE_LOG_MIN(&probe);
}

void bluetooth_icons_refresh(bool connected) {
    (void)connected;
    layer_mark_dirty(s_top_status_layer);
}

void bluetooth_callback(bool connected) {
    bluetooth_icons_refresh(connected);
    if (!connected && g_config->vibe)
        vibes_double_pulse();
}

bool show_qt_icon() {
    return g_config->show_qt && quiet_time_is_active();
}

void status_icons_refresh() {
    // A full strip repaint resyncs the per-minute QT baseline so the next
    // top_status_layer_tick() only fires on a genuine QT transition.
    s_last_qt_active = show_qt_icon();
    layer_mark_dirty(s_top_status_layer);

    // Ensure bt icons are correct at start
    bluetooth_icons_refresh(connection_service_peek_pebble_app_connection());
}

// Recompute the rain-alert string from the cached countdown. Returns true if
// the active flag or the text changed (the caller should mark the layer dirty).
static bool recompute_rain_alert(void) {
    char buf[sizeof(s_rain_alert_text)];
    bool active = rain_countdown_format(buf, sizeof(buf), watch_services_now());
    if (active == s_rain_alert_active &&
        (!active || strcmp(buf, s_rain_alert_text) == 0)) {
        return false;
    }
    s_rain_alert_active = active;
    if (active) {
        strncpy(s_rain_alert_text, buf, sizeof(s_rain_alert_text));
        s_rain_alert_text[sizeof(s_rain_alert_text) - 1] = '\0';
    }
    return true;
}

void top_status_layer_tick() {
    // Per-minute hook. Repaint when the Quiet-Time icon toggles (its only event
    // source) or when the rain-alert string changes (a flash-free derivation
    // from the cached countdown; the radar scan itself runs only on data change).
    bool dirty = false;
    bool qt_active = show_qt_icon();
    if (qt_active != s_last_qt_active) {
        s_last_qt_active = qt_active;
        dirty = true;
    }
    if (recompute_rain_alert()) {
        dirty = true;
    }
    if (dirty) {
        layer_mark_dirty(s_top_status_layer);
    }
}

void top_status_layer_refresh() {
    struct tm tm_now = watch_services_localtime();
    strftime(s_calendar_month_text, sizeof(s_calendar_month_text), "%b %Y", &tm_now);
    recompute_rain_alert();
    status_icons_refresh();
}

void top_status_layer_destroy() {
    MEMORY_LOG_HEAP("top_status_layer_destroy:before");
    battery_layer_destroy();
    if (s_mute_bitmap) {
        gbitmap_destroy(s_mute_bitmap);
        s_mute_bitmap = NULL;
    }
    if (s_bt_bitmap) {
        gbitmap_destroy(s_bt_bitmap);
        s_bt_bitmap = NULL;
    }
    if (s_bt_disconnect_bitmap) {
        gbitmap_destroy(s_bt_disconnect_bitmap);
        s_bt_disconnect_bitmap = NULL;
    }
    layer_destroy(s_top_status_layer);
    MEMORY_LOG_HEAP("top_status_layer_destroy:after");
}
