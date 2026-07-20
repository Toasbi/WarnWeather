// Lean aplite (Pebble Classic/Steel) twin of top_status_layer.c.
//
// Frozen fork of top_status_layer.c as of fc8cf4d. FEATURE-FROZEN, NOT CODE-FROZEN:
// never add features here (aplite deliberately lacks the rain-intensity glyph /
// colour / drop-BT-then-ellipsize ladder AND the rain-countdown "Rain in X min"
// alert — dropped from the strip to fit the 24 KB budget, so rain_countdown.c is
// --gc-sections'd out of the aplite image); hand-port bugfixes from
// top_status_layer.c (see `git log fc8cf4d.. -- src/c/layers/top_status_layer.c`);
// interface changes are forced by the aplite link error. The shared display-state
// snooze fix is hand-ported here: aplite keeps the same two slots but renders the
// snooze indicator as cheap "zZ" text rather than the procedural vector glyph,
// so --gc-sections reaps snooze.c from the frozen-lean image; it gains no
// bitmap/PDC feature. As of fc8cf4d the strip
// also embeds status_row (Task 12/15) for the configurable left/right slots around
// the fixed date; status_row_icons_load() returns NULL on aplite, so the slots
// render as plain text (no icon glyphs) here.
// See docs/adr/0001-aplite-frozen-lean-fork.md.

#include "top_status_layer.h"
#include "battery_draw.h"
#include "status_row.h"
#include "top_status_indicators.h"
#include "c/appendix/config.h"
#include "c/appendix/memory_log.h"
#include "c/appendix/persist.h"
#include "c/appendix/status_line.h"
#include "c/appendix/theme.h"
#include "c/services/watch_services.h"
#include "c/windows/layout.h"   // LayoutTier (status_row tier param)

#define PADDING 4
#define ICON_SLOT_1 GRect(PADDING, 0, 10, 10)
#define ICON_SLOT_2 GRect(PADDING * 2 + 10, 0, 10, 10)
// emery: center icons in the taller status row.
#ifdef PBL_PLATFORM_EMERY
#define STATUS_ICON_Y(bounds_h, icon_h) (((bounds_h) - (icon_h)) / 2)
#else
#define STATUS_ICON_Y(bounds_h, icon_h) ((void)(bounds_h), (void)(icon_h), 0)
#endif

static bool show_qt_icon(void);
static void bluetooth_callback(bool connected);
static void update_battery_override(void);
static void battery_state_callback(BatteryChargeState charge);

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

static TopStatusIndicators current_indicators(bool connected) {
    const Config *config = config_get();
    bool wants_bt = connected ? config->show_bt : config->show_bt_disconnect;
    return top_status_indicators_resolve(
        show_qt_icon(), wants_bt, persist_get_is_sleeping());
}

static GRect indicator_frame(GRect bounds, uint8_t slot) {
    GRect frame = slot == 0 ? ICON_SLOT_1 : ICON_SLOT_2;
    frame.origin.y = STATUS_ICON_Y(bounds.size.h, frame.size.h);
    return frame;
}

static void maybe_unload_top_status_bitmaps(
        bool draw_qt, bool draw_bt, bool draw_bt_disconnect) {
    if (!draw_qt && s_mute_bitmap) {
        gbitmap_destroy(s_mute_bitmap);
        s_mute_bitmap = NULL;
    }

    if (!draw_bt && s_bt_bitmap) {
        gbitmap_destroy(s_bt_bitmap);
        s_bt_bitmap = NULL;
    }

    if (!draw_bt_disconnect && s_bt_disconnect_bitmap) {
        gbitmap_destroy(s_bt_disconnect_bitmap);
        s_bt_disconnect_bitmap = NULL;
    }
}

// Configurable slots (status_row's left slot / fixed date mid slot / right slot)
// span from the left icon slot(s) to the right edge. Left inset clears whichever
// resolved Quiet Time/Bluetooth/snooze group is currently on screen; the right
// keeps a PADDING pad so the right-slot
// glyph isn't clipped flush at content_w (aplite is a small screen — never emery, so
// it takes the base file's non-emery branch; see top_status_layer.c's content_rect).
static GRect content_rect(void) {
    GRect bounds = layer_get_bounds(s_top_status_layer);
    bool connected = connection_service_peek_pebble_app_connection();
    TopStatusIndicators indicators = current_indicators(connected);

    int16_t left = ICON_SLOT_1.origin.x;
    if (indicators.count == 1) {
        left = (int16_t)(ICON_SLOT_1.origin.x + ICON_SLOT_1.size.w + PADDING);
    } else if (indicators.count == 2) {
        left = (int16_t)(ICON_SLOT_2.origin.x + ICON_SLOT_2.size.w + PADDING);
    }
    int16_t right = PADDING;   // small screen: pad so the right slot isn't clipped flush
    int16_t w = (int16_t)(bounds.size.w - left - right);
    if (w < 0) { w = 0; }
    return GRect((int16_t)(bounds.origin.x + left), bounds.origin.y, w, bounds.size.h);
}

static void top_status_update_proc(Layer *layer, GContext *ctx) {
    GRect bounds = layer_get_bounds(layer);
    bool connected = connection_service_peek_pebble_app_connection();
    TopStatusIndicators indicators = current_indicators(connected);
    bool has_qt = top_status_indicators_contains(
        indicators, TOP_STATUS_INDICATOR_QUIET_TIME);
    bool has_bt = top_status_indicators_contains(
        indicators, TOP_STATUS_INDICATOR_BLUETOOTH);

    maybe_unload_top_status_bitmaps(
        has_qt, has_bt && connected, has_bt && !connected);

    for (uint8_t i = 0; i < indicators.count; i++) {
        GRect frame = indicator_frame(bounds, i);
        switch (indicators.slots[i]) {
            case TOP_STATUS_INDICATOR_QUIET_TIME:
                ensure_icon_loaded(&s_mute_bitmap, s_mute_palette,
                    &s_mute_bitmap_fg, RESOURCE_ID_IMAGE_MUTE, theme_fg());
                draw_bitmap(ctx, s_mute_bitmap, frame);
                break;
            case TOP_STATUS_INDICATOR_BLUETOOTH:
                if (connected) {
                    ensure_icon_loaded(&s_bt_bitmap, s_bt_palette,
                        &s_bt_bitmap_fg, RESOURCE_ID_IMAGE_BT_CONNECT,
                        theme_pick(GColorPictonBlue, theme_fg()));
                    draw_bitmap(ctx, s_bt_bitmap, frame);
                } else {
                    ensure_icon_loaded(&s_bt_disconnect_bitmap,
                        s_bt_disconnect_palette, &s_bt_disconnect_bitmap_fg,
                        RESOURCE_ID_IMAGE_BT_DISCONNECT,
                        theme_pick(GColorRed, theme_fg()));
                    draw_bitmap(ctx, s_bt_disconnect_bitmap, frame);
                }
                break;
            case TOP_STATUS_INDICATOR_SNOOZE: {
                // aplite: draw a cheap "zZ" text stand-in for the vector snooze
                // glyph. The icon slot is only 10px wide, so span it plus the
                // PADDING gap up to (but not into) the status text, and use the
                // full band height so the smallest stock font sits centered.
                graphics_context_set_text_color(ctx, theme_fg());
                GRect text_frame = GRect(frame.origin.x, bounds.origin.y,
                                         ICON_SLOT_1.size.w + PADDING, bounds.size.h);
                graphics_draw_text(ctx, "zZ",
                    fonts_get_system_font(FONT_KEY_GOTHIC_14), text_frame,
                    GTextOverflowModeTrailingEllipsis, GTextAlignmentLeft, NULL);
                break;
            }
            case TOP_STATUS_INDICATOR_NONE:
                break;
        }
    }

    status_row_apply(s_row, content_rect(), LAYOUT_TIER_FULL, STATUS_LINE_TOP);
    status_row_draw(s_row, ctx);
}

void top_status_layer_create(Layer* parent_layer, GRect frame) {
    MemoryHeapProbe probe = MEMORY_HEAP_PROBE_START("top_status_layer_create");

    s_top_status_layer = layer_create(frame);
    MEMORY_HEAP_PROBE_SAMPLE("after_layer_create", &probe);

    // Set up bluetooth handler
    connection_service_subscribe((ConnectionHandlers) {
        .pebble_app_connection_handler = bluetooth_callback
    });
    MEMORY_HEAP_PROBE_SAMPLE("after_connection_subscribe", &probe);

    s_row = status_row_create(STATUS_LINE_TOP);
    status_row_set_full_date(s_row, s_full_date);
    // The battery now lives in the top-right status slot (status_row draws it);
    // own its event source here as the retired battery corner layer used to.
    update_battery_override();
    if (!watch_services_battery_is_fixture()) {
        battery_state_service_subscribe(battery_state_callback);
    }
    status_row_apply(s_row, content_rect(), LAYOUT_TIER_FULL, STATUS_LINE_TOP);

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

static void bluetooth_callback(bool connected) {
    layer_mark_dirty(s_top_status_layer);
    if (!connected && config_get()->vibe)
        vibes_double_pulse();
}

// Low-battery takeover: when "show battery below 10%" is on and the charge is
// under 10%, force the right slot to the battery glyph regardless of its packed
// kind. Off/above threshold clears the override (the slot renders its own kind).
static void update_battery_override(void) {
    bool active = config_get()->battery_low_only
        && watch_services_battery_state().charge_percent < 10;
    status_row_set_battery_override(s_row, active);
}

static void battery_state_callback(BatteryChargeState charge) {
    update_battery_override();
    layer_mark_dirty(s_top_status_layer);
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
    // value changes. update_battery_override here catches crossing the 10%
    // threshold between the discrete battery_state events.
    update_battery_override();
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
    update_battery_override();   // config may have flipped battery_low_only
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
    battery_draw_deinit();
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
