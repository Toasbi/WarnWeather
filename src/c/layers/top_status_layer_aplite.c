// Lean aplite (Pebble Classic/Steel) twin of top_status_layer.c.
//
// Frozen fork of top_status_layer.c as of fc8cf4d. FEATURE-FROZEN, NOT CODE-FROZEN:
// never add features here (aplite deliberately lacks the rain-intensity glyph /
// colour / drop-BT-then-ellipsize ladder AND the rain-countdown "Rain in X min"
// alert — dropped from the strip to fit the 24 KB budget, so rain_countdown.c is
// --gc-sections'd out of the aplite image); hand-port bugfixes from
// top_status_layer.c (see `git log fc8cf4d.. -- src/c/layers/top_status_layer.c`);
// interface changes are forced by the aplite link error. As of fc8cf4d the strip
// also embeds status_row (Task 12/15) for the configurable left/right slots around
// the fixed date; status_row_icons_load() returns NULL on aplite, so the slots
// render as plain text (no icon glyphs) here.
// See docs/adr/0001-aplite-frozen-lean-fork.md.

#include "top_status_layer.h"
#include "battery_layer.h"
#include "status_row.h"
#include "c/appendix/config.h"
#include "c/appendix/memory_log.h"
#include "c/appendix/status_line.h"
#include "c/appendix/theme.h"

#define BATTERY_W 29
#define BATTERY_H 10
#define PADDING 4
#define ICON_SLOT_1 GRect(PADDING, 0, 10, 10)
#define ICON_SLOT_2 GRect(PADDING * 2 + 10, 0, 10, 10)
// emery: center icons in the taller status row.
#ifdef PBL_PLATFORM_EMERY
#define STATUS_ICON_Y(bounds_h, icon_h) (((bounds_h) - (icon_h)) / 2)
#define BATTERY_Y(bounds_h) (((bounds_h) - BATTERY_H) / 2)
#else
#define STATUS_ICON_Y(bounds_h, icon_h) ((void)(bounds_h), (void)(icon_h), 0)
#define BATTERY_Y(bounds_h) ((void)(bounds_h), 1)
#endif

static bool show_qt_icon(void);
static void bluetooth_callback(bool connected);

static Layer *s_top_status_layer;
static StatusRow *s_row;
static bool s_full_date;
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

static void draw_bitmap(GContext *ctx, GBitmap *bitmap, GRect frame) {
    graphics_context_set_compositing_mode(ctx, GCompOpSet);
    graphics_draw_bitmap_in_rect(ctx, bitmap, frame);
    graphics_context_set_compositing_mode(ctx, GCompOpAssign);
}

static GColor s_mute_bitmap_fg;
static GColor s_bt_bitmap_fg;
static GColor s_bt_disconnect_bitmap_fg;

// Lazy-load an icon bitmap and (re)tint its 2-color palette to fg. cached_fg
// remembers the tint the palette was last built with, so a live theme change
// re-applies the palette (cheap: no image reload) instead of leaving a stale tint.
static void ensure_icon_loaded(GBitmap **bmp, GColor *palette, GColor *cached_fg,
                               uint32_t resource_id, GColor fg) {
    if (*bmp && gcolor_equal(*cached_fg, fg)) {
        return;
    }
    if (!*bmp) {
        *bmp = gbitmap_create_with_resource(resource_id);
    }
    palette[0] = fg;
    palette[1] = GColorClear;
    gbitmap_set_palette(*bmp, palette, false);
    *cached_fg = fg;
}

static void maybe_unload_top_status_bitmaps(bool show_qt, bool connected) {
    bool show_bt = connected && config_get()->show_bt;
    bool show_bt_disconnect = !connected && config_get()->show_bt_disconnect;

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

// Configurable slots (status_row's left slot / fixed date mid slot / right slot)
// live between the left icon slot(s) and the battery. Left inset clears whichever
// icons are currently on screen (QT and/or BT), reusing the same booleans
// top_status_update_proc computes; right inset clears the battery.
static GRect content_rect(void) {
    GRect bounds = layer_get_bounds(s_top_status_layer);
    bool show_qt = show_qt_icon();
    bool connected = connection_service_peek_pebble_app_connection();
    bool show_bt = connected && config_get()->show_bt;
    bool show_bt_disconnect = !connected && config_get()->show_bt_disconnect;

    int16_t left = ICON_SLOT_1.origin.x;   // no icons showing: clear just the padding
    if (show_qt) {
        // QT holds slot 1; BT (if any) holds slot 2 alongside it.
        left = (int16_t)(ICON_SLOT_2.origin.x + ICON_SLOT_2.size.w + PADDING);
    } else if (show_bt || show_bt_disconnect) {
        left = (int16_t)(ICON_SLOT_1.origin.x + ICON_SLOT_1.size.w + PADDING);
    }
    int16_t right = (int16_t)(BATTERY_W + 2 * PADDING);
    int16_t w = (int16_t)(bounds.size.w - left - right);
    if (w < 0) { w = 0; }
    return GRect((int16_t)(bounds.origin.x + left), bounds.origin.y, w, bounds.size.h);
}

static void top_status_update_proc(Layer *layer, GContext *ctx) {
    GRect bounds = layer_get_bounds(layer);
    bool show_qt = show_qt_icon();
    bool connected = connection_service_peek_pebble_app_connection();
    int icon_x = show_qt ? ICON_SLOT_2.origin.x : ICON_SLOT_1.origin.x;
    bool show_bt = connected && config_get()->show_bt;
    bool show_bt_disconnect = !connected && config_get()->show_bt_disconnect;

    maybe_unload_top_status_bitmaps(show_qt, connected);

    if (show_qt) {
        ensure_icon_loaded(&s_mute_bitmap, s_mute_palette, &s_mute_bitmap_fg,
                           RESOURCE_ID_IMAGE_MUTE, theme_fg());
        draw_bitmap(ctx, s_mute_bitmap, GRect(ICON_SLOT_1.origin.x, STATUS_ICON_Y(bounds.size.h, ICON_SLOT_1.size.h),
                                              ICON_SLOT_1.size.w, ICON_SLOT_1.size.h));
    }

    if (show_bt) {
        ensure_icon_loaded(&s_bt_bitmap, s_bt_palette, &s_bt_bitmap_fg,
                           RESOURCE_ID_IMAGE_BT_CONNECT, theme_pick(GColorPictonBlue, theme_fg()));
        draw_bitmap(ctx, s_bt_bitmap, GRect(icon_x, STATUS_ICON_Y(bounds.size.h, 10), 10, 10));
    } else if (show_bt_disconnect) {
        ensure_icon_loaded(&s_bt_disconnect_bitmap, s_bt_disconnect_palette,
                           &s_bt_disconnect_bitmap_fg,
                           RESOURCE_ID_IMAGE_BT_DISCONNECT, theme_pick(GColorRed, theme_fg()));
        draw_bitmap(ctx, s_bt_disconnect_bitmap, GRect(icon_x, STATUS_ICON_Y(bounds.size.h, 10), 10, 10));
    }

    status_row_apply(s_row, content_rect(), TOP_VIEW_FULL, STATUS_LINE_TOP);
    status_row_draw(s_row, ctx);
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

    s_row = status_row_create(STATUS_LINE_TOP);
    status_row_set_full_date(s_row, s_full_date);
    status_row_apply(s_row, content_rect(), TOP_VIEW_FULL, STATUS_LINE_TOP);

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

void top_status_layer_set_full_date(bool full_date) {
    if (full_date == s_full_date) { return; }
    s_full_date = full_date;
    if (s_row) {
        status_row_set_full_date(s_row, s_full_date);
        top_status_layer_refresh();
    }
}

static void bluetooth_callback(bool connected) {
    layer_mark_dirty(s_top_status_layer);
    if (!connected && config_get()->vibe)
        vibes_double_pulse();
}

static bool show_qt_icon(void) {
    return config_get()->show_qt && quiet_time_is_active();
}

void status_icons_refresh() {
    // A full strip repaint resyncs the per-minute QT baseline so the next
    // top_status_layer_tick() only fires on a genuine QT transition.
    s_last_qt_active = show_qt_icon();
    layer_mark_dirty(s_top_status_layer);
}

void top_status_layer_tick() {
    // Per-minute hook. Repaint when the Quiet-Time icon toggles (its only event
    // source; aplite lacks the rain-countdown alert) or when a LIVE health slot
    // value changes.
    bool dirty = false;
    bool qt_active = show_qt_icon();
    if (qt_active != s_last_qt_active) {
        s_last_qt_active = qt_active;
        dirty = true;
    }
    if (status_row_refresh(s_row)) {
        dirty = true;
    }
    if (dirty) {
        layer_mark_dirty(s_top_status_layer);
    }
}

void top_status_layer_refresh() {
    // Date formatting lives in status_row.c's format_status_date (SLOT_LIVE_DATE);
    // this owner only keeps the icon state in sync.
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
    status_row_destroy(s_row);
    s_row = NULL;
    layer_destroy(s_top_status_layer);
    MEMORY_LOG_HEAP("top_status_layer_destroy:after");
}
