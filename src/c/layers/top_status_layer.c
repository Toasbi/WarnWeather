#include <string.h>
#include "top_status_layer.h"
#include "battery_layer.h"
#include "c/appendix/config.h"
#include "c/appendix/memory_log.h"
#include "c/appendix/palette.h"
#include "c/appendix/rain_countdown.h"
#include "c/appendix/rain_tier.h"
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
static char s_calendar_month_text[16];  // "22. Sep 2026" (12+NUL) in none mode; "Jul 2026" otherwise
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
static char s_rain_alert_text[20];   // "Downpour for +99'" = 17 chars + NUL
static bool s_rain_alert_active;
static int s_rain_alert_tier;   // radar tier (1..5) of the active alert's peak; drives glyph colour + density

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

// rain-intensity glyph (family D: rain-lines density), drawn procedurally.
// bucket 1 = drizzle (sparse), 2 = rain, 3 = downpour (dense). 10x10, '#' = lit.
// Each bucket is a diagonal rain-line hatch that fills the full 10x10 box; the
// three step up in density (every 5th / 4th / 3rd cell) so intensity reads at a
// glance while occupying the same area as the battery it sits beside.
static const char *const RAIN_GLYPH[3][10] = {
    {   // 1 drizzle — light hatch (every 5th cell, on alternate rows)
        "#....#....", "..........", "...#....#.", "..........", ".#....#...",
        "..........", "....#....#", "..........", "..#....#..", ".........."
    },
    {   // 2 rain — medium hatch (every 4th cell)
        "#...#...#.", "...#...#..", "..#...#...", ".#...#...#", "#...#...#.",
        "...#...#..", "..#...#...", ".#...#...#", "#...#...#.", "...#...#.."
    },
    {   // 3 downpour — dense hatch (every 3rd cell)
        "#..#..#..#", "..#..#..#.", ".#..#..#..", "#..#..#..#", "..#..#..#.",
        ".#..#..#..", "#..#..#..#", "..#..#..#.", ".#..#..#..", "#..#..#..#"
    }
};

static void draw_rain_glyph(GContext *ctx, GRect rect, int bucket, GColor color) {
    if (bucket < 1 || bucket > 3 || rect.size.w <= 0 || rect.size.h <= 0) { return; }
    const char *const *rows = RAIN_GLYPH[bucket - 1];
    graphics_context_set_stroke_color(ctx, color);
    // Nearest-neighbour scale the 10x10 source pattern to fill rect, so the glyph
    // can be sized up to the strip height without editing the source pattern.
    for (int y = 0; y < rect.size.h; y++) {
        const char *row = rows[(y * 10) / rect.size.h];
        for (int x = 0; x < rect.size.w; x++) {
            if (row[(x * 10) / rect.size.w] == '#') {
                graphics_draw_pixel(ctx, GPoint(rect.origin.x + x, rect.origin.y + y));
            }
        }
    }
}

// Glyph colour tracks the radar bars per tier; on B&W the strip is black and the
// radar palette is black, so force white.
static GColor rain_glyph_color(int tier) {
#ifdef PBL_COLOR
    return palette_radar_color(tier);
#else
    (void) tier;
    return GColorWhite;
#endif
}

static void draw_status_text_in(GContext *ctx, GRect rect, const char *text,
                                GTextAlignment align, GFont font) {
    graphics_context_set_text_color(ctx, GColorWhite);
    graphics_draw_text(ctx, text, font, rect, GTextOverflowModeFill, align, NULL);
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

static void maybe_unload_top_status_bitmaps(bool show_qt, bool draw_bt, bool draw_bt_disconnect) {
    if (!show_qt && s_mute_bitmap) {
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

static void top_status_update_proc(Layer *layer, GContext *ctx) {
    GRect bounds = layer_get_bounds(layer);
    bool show_qt = show_qt_icon();
    bool connected = connection_service_peek_pebble_app_connection();
    bool alert = s_rain_alert_active;
    int icon_x = show_qt ? ICON_SLOT_2.origin.x : ICON_SLOT_1.origin.x;
    const GFont font = fonts_get_system_font(MONTH_FONT_KEY);

    bool wants_bt = connected && g_config->show_bt;
    bool wants_bt_disc = !connected && g_config->show_bt_disconnect;

    // What text, where, and whether/where Bluetooth draws. Defaults = month mode.
    char shown[sizeof(s_rain_alert_text)];
    strncpy(shown, alert ? s_rain_alert_text : s_calendar_month_text, sizeof(shown));
    shown[sizeof(shown) - 1] = '\0';

    // Month mode uses the full-width centered rect. Alert mode centers the glyph +
    // text as one unit (computed below), so the two read as a single grouped label.
    GRect text_rect = month_text_rect(bounds, font, shown);
    GTextAlignment text_align = GTextAlignmentCenter;
    bool draw_qt = show_qt;
    bool draw_bt = !alert && wants_bt;
    bool draw_bt_disc = !alert && wants_bt_disc;
    int bt_x = icon_x;  // month-mode BT position

    // Square glyph inset from the strip height (side = bounds.h - 6, vertically
    // centered) so it reads a touch smaller than the battery beside it. Square
    // keeps the diagonal hatch at 45°; a non-square scale skews the lines and
    // makes them chunky. glyph_x is set only in alert mode.
    const int glyph_side = bounds.size.h - 6;
    const int glyph_gap = 2;
    const int glyph_y = (bounds.size.h - glyph_side) / 2;
    int glyph_x = icon_x;

    if (alert) {
        // Center glyph+gap+text as one block: measure the text, seat the glyph just
        // left of it, then left-align the text immediately after the glyph.
        GSize text_size = graphics_text_layout_get_content_size(
            shown, font, GRect(0, 0, bounds.size.w, bounds.size.h),
            GTextOverflowModeFill, GTextAlignmentLeft);
        int unit_w = glyph_side + glyph_gap + text_size.w;
        int start_x = (bounds.size.w - unit_w) / 2;
        if (start_x < 0) { start_x = 0; }
        glyph_x = start_x;
        text_rect.origin.x = start_x + glyph_side + glyph_gap;
        text_rect.size.w = bounds.size.w - text_rect.origin.x;
        text_align = GTextAlignmentLeft;

        // Keep the left status icons (Quiet-Time, Bluetooth) only while the centered
        // unit clears them; once the alert grows wide enough to reach their slots,
        // hide the whole icon group so the glyph + text get the space instead.
        int icons_right = 0;
        if (show_qt) {
            icons_right = ICON_SLOT_1.origin.x + ICON_SLOT_1.size.w;
        }
        if (wants_bt || wants_bt_disc) {
            const int bt_right = icon_x + 10;   // BT sits in slot 2 when QT holds slot 1
            if (bt_right > icons_right) { icons_right = bt_right; }
        }
        const bool icons_fit = (icons_right == 0) || (start_x >= icons_right + PADDING);
        draw_qt = show_qt && icons_fit;
        draw_bt = wants_bt && icons_fit;
        draw_bt_disc = wants_bt_disc && icons_fit;
    }

    maybe_unload_top_status_bitmaps(show_qt, draw_bt, draw_bt_disc);

    if (draw_qt) {
        ensure_mute_bitmap_loaded();
        draw_bitmap(ctx, s_mute_bitmap,
            GRect(ICON_SLOT_1.origin.x, STATUS_ICON_Y(bounds.size.h, ICON_SLOT_1.size.h),
                  ICON_SLOT_1.size.w, ICON_SLOT_1.size.h));
    }

    if (alert) {
        int bucket = rain_tier_to_bucket3(s_rain_alert_tier);
        draw_rain_glyph(ctx, GRect(glyph_x, glyph_y, glyph_side, glyph_side),
                        bucket, rain_glyph_color(s_rain_alert_tier));
    }

    if (draw_bt) {
        ensure_bt_bitmap_loaded();
        draw_bitmap(ctx, s_bt_bitmap, GRect(bt_x, STATUS_ICON_Y(bounds.size.h, 10), 10, 10));
    } else if (draw_bt_disc) {
        ensure_bt_disconnect_bitmap_loaded();
        draw_bitmap(ctx, s_bt_disconnect_bitmap, GRect(bt_x, STATUS_ICON_Y(bounds.size.h, 10), 10, 10));
    }

    draw_status_text_in(ctx, text_rect, shown, text_align, font);
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
    int tier = active ? rain_countdown_peak_tier() : 0;
    if (active == s_rain_alert_active && tier == s_rain_alert_tier &&
        (!active || strcmp(buf, s_rain_alert_text) == 0)) {
        return false;
    }
    s_rain_alert_active = active;
    s_rain_alert_tier = tier;
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
    if (g_config->top_view_mode == TOP_VIEW_NONE) {
        // No calendar carries the day-of-month, so the strip shows the full date.
        // Keep the abbreviated month; build with snprintf from the int day/year to
        // avoid %e space-padding and match the app's no-leading-zero day. Order
        // follows the watch locale (US English = month-first).
        char mon[8];
        strftime(mon, sizeof(mon), "%b", &tm_now);          // "Jul"
        int mday = tm_now.tm_mday;
        int year = tm_now.tm_year + 1900;
        const char *loc = i18n_get_system_locale();
        if (loc && strncmp(loc, "en_US", 5) == 0) {
            snprintf(s_calendar_month_text, sizeof(s_calendar_month_text), "%s %d. %d", mon, mday, year); // Jul 4. 2026
        } else {
            snprintf(s_calendar_month_text, sizeof(s_calendar_month_text), "%d. %s %d", mday, mon, year); // 2. Jul 2026
        }
    } else {
        strftime(s_calendar_month_text, sizeof(s_calendar_month_text), "%b %Y", &tm_now);
    }
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
