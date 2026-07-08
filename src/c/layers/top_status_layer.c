#include <string.h>
#include "top_status_layer.h"
#include "battery_layer.h"
#include "c/appendix/config.h"
#include "c/appendix/memory_log.h"
#include "c/appendix/palette.h"
#include "c/appendix/rain_countdown.h"
#include "c/appendix/rain_tier.h"
#include "c/appendix/theme.h"
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
static char s_calendar_month_text[20];   // "22. Sep 2026" in none mode ("Jul 2026" otherwise)
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

// Rain-intensity glyph: PDC vector raindrops (drop count = intensity bucket),
// lazy-loaded during an active alert to match the health-strip glyph pipeline.
// Authored filled/white in a 25px viewbox (scripts/gen-rain-pdc.py); recolored
// per radar tier and scaled to the square glyph slot at load. aplite excludes
// both the resources and this file (its twin has no rain glyph).
static GDrawCommandImage *s_rain_glyph;   // NULL unless an alert is showing
static int    s_rain_glyph_bucket;        // bucket (1..3) the cached glyph was built for; 0 = none
static int    s_rain_glyph_side;          // px slot side the cached glyph was scaled to
static GColor s_rain_glyph_tint;          // fill tint the cached glyph was recolored to
static bool   s_rain_glyph_outlined;      // whether the cached glyph got the light-theme stroke

// Per-tier recolor + uniform scale of the PDC, mirroring health_status_layer's
// pipeline (points are 1/8-px precise-path units). We scale the fixed authored
// VIEWBOX (25 px square) into the slot, NOT the tight content bbox: the three
// buckets are drawn in one shared viewbox at deliberately different drop sizes
// (drizzle big, downpour small), so one viewbox→slot scale preserves those relative
// sizes. Fitting the content bbox instead blew a lone drizzle drop up to fill the
// whole slot while shrinking the multi-drop glyphs.
typedef struct {
    int16_t num, den;   // scale each point: p * num / den
    GColor  tint;
    bool    outline;    // light theme: force a 1px black stroke (light tier tints
                         // like drizzle's gray otherwise vanish on a white strip)
} RainNorm;

static bool rain_norm_cb(GDrawCommand *command, uint32_t index, void *context) {
    (void)index;
    RainNorm *b = (RainNorm *)context;
    gdraw_command_set_fill_color(command, b->tint);
    if (b->outline) {
        // Stroke width is baked 0 (clear) by the generator — a nonzero width must be
        // set at runtime too, not just the color, or the stroke stays invisible.
        gdraw_command_set_stroke_color(command, GColorBlack);
        gdraw_command_set_stroke_width(command, 1);
    }
    uint16_t n = gdraw_command_get_num_points(command);
    for (uint16_t i = 0; i < n; i++) {
        GPoint p = gdraw_command_get_point(command, i);
        p.x = (int16_t)((p.x * b->num) / b->den);
        p.y = (int16_t)((p.y * b->num) / b->den);
        gdraw_command_set_point(command, i, p);
    }
    return true;
}

static uint32_t rain_glyph_resource(int bucket) {
    switch (bucket) {
        case 1:  return RESOURCE_ID_RAIN_DRIZZLE;
        case 2:  return RESOURCE_ID_RAIN_RAIN;
        default: return RESOURCE_ID_RAIN_DOWNPOUR;   // bucket 3 (emery-only)
    }
}

static void rain_glyph_unload(void) {
    if (s_rain_glyph) {
        gdraw_command_image_destroy(s_rain_glyph);
        s_rain_glyph = NULL;
    }
    s_rain_glyph_bucket = 0;
}

// Ensure s_rain_glyph holds the bucket's drops scaled to a `side`-px square and
// tinted `tint`. Reloads only when one of those changes (bucket tracks tier, side
// is fixed per platform), so the steady-state redraw is a cache hit.
static void ensure_rain_glyph_loaded(int bucket, int side, GColor tint) {
    const bool outline = theme_is_light();
    // Cache key includes `outline`, not just tint: a live theme flip (light<->dark)
    // with an unchanged tint must still re-recolor, since the stroke depends on theme.
    if (s_rain_glyph && s_rain_glyph_bucket == bucket &&
        s_rain_glyph_side == side && gcolor_equal(s_rain_glyph_tint, tint) &&
        s_rain_glyph_outlined == outline) {
        return;
    }
    rain_glyph_unload();
    if (side <= 0) { return; }
    GDrawCommandImage *img = gdraw_command_image_create_with_resource(rain_glyph_resource(bucket));
    if (!img) { return; }
    // Scale the authored square viewbox uniformly into the `side`-px slot (see RainNorm).
    const GSize vb    = gdraw_command_image_get_bounds_size(img);   // authored viewbox (px)
    const int   vspan = vb.h > vb.w ? vb.h : vb.w;
    if (vspan <= 0) { gdraw_command_image_destroy(img); return; }
    GDrawCommandList *list = gdraw_command_image_get_command_list(img);
    RainNorm b = { .num = (int16_t)side, .den = (int16_t)vspan, .tint = tint, .outline = outline };
    gdraw_command_list_iterate(list, rain_norm_cb, &b);
    gdraw_command_image_set_bounds_size(img, GSize((int16_t)((vb.w * side) / vspan),
                                                   (int16_t)((vb.h * side) / vspan)));
    s_rain_glyph = img;
    s_rain_glyph_bucket = bucket;
    s_rain_glyph_side = side;
    s_rain_glyph_tint = tint;
    s_rain_glyph_outlined = outline;
}

// Glyph colour tracks the radar bars per tier; on B&W (or the color-build Black &
// White theme) the strip is theme_bg() and the radar palette is black, so force
// the default foreground.
static GColor rain_glyph_color(int tier) {
#ifdef PBL_COLOR
    if (!theme_is_bw()) { return palette_radar_color(tier); }
#endif
    (void) tier;
    return theme_fg();
}

static void draw_status_text_in(GContext *ctx, GRect rect, const char *text,
                                GTextAlignment align, GFont font) {
    graphics_context_set_text_color(ctx, theme_fg());
    graphics_draw_text(ctx, text, font, rect, GTextOverflowModeFill, align, NULL);
}

static void draw_bitmap(GContext *ctx, GBitmap *bitmap, GRect frame) {
    graphics_context_set_compositing_mode(ctx, GCompOpSet);
    graphics_draw_bitmap_in_rect(ctx, bitmap, frame);
    graphics_context_set_compositing_mode(ctx, GCompOpAssign);
}

// Tracks the foreground the cached bitmap's palette was tinted with, so a live
// theme change re-applies the palette (cheap: no image reload) instead of leaving
// a stale tint from before the flip.
static GColor s_mute_bitmap_fg;

static void ensure_mute_bitmap_loaded(void) {
    GColor fg = theme_fg();
    if (s_mute_bitmap && gcolor_equal(s_mute_bitmap_fg, fg)) {
        return;
    }
    if (!s_mute_bitmap) {
        s_mute_bitmap = gbitmap_create_with_resource(RESOURCE_ID_IMAGE_MUTE);
    }
    s_mute_palette[0] = fg;
    s_mute_palette[1] = GColorClear;
    gbitmap_set_palette(s_mute_bitmap, s_mute_palette, false);
    s_mute_bitmap_fg = fg;
}

static GColor s_bt_bitmap_fg;

static void ensure_bt_bitmap_loaded(void) {
    GColor fg = theme_pick(GColorPictonBlue, theme_fg());
    if (s_bt_bitmap && gcolor_equal(s_bt_bitmap_fg, fg)) {
        return;
    }
    if (!s_bt_bitmap) {
        s_bt_bitmap = gbitmap_create_with_resource(RESOURCE_ID_IMAGE_BT_CONNECT);
    }
    s_bt_palette[0] = fg;
    s_bt_palette[1] = GColorClear;
    gbitmap_set_palette(s_bt_bitmap, s_bt_palette, false);
    s_bt_bitmap_fg = fg;
}

static GColor s_bt_disconnect_bitmap_fg;

static void ensure_bt_disconnect_bitmap_loaded(void) {
    GColor fg = theme_pick(GColorRed, theme_fg());
    if (s_bt_disconnect_bitmap && gcolor_equal(s_bt_disconnect_bitmap_fg, fg)) {
        return;
    }
    if (!s_bt_disconnect_bitmap) {
        s_bt_disconnect_bitmap = gbitmap_create_with_resource(RESOURCE_ID_IMAGE_BT_DISCONNECT);
    }
    s_bt_disconnect_palette[0] = fg;
    s_bt_disconnect_palette[1] = GColorClear;
    gbitmap_set_palette(s_bt_disconnect_bitmap, s_bt_disconnect_palette, false);
    s_bt_disconnect_bitmap_fg = fg;
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

    // Square glyph slot that the PDC viewbox scales into (see ensure_rain_glyph_loaded).
    // The band is short on 144-px screens (~14 px), so it can spare only a small inset
    // before the drops read as tiny; emery's taller band (~21 px) takes a larger inset so
    // the single drizzle drop isn't oversized. glyph_x is set only in alert mode.
    // (Tune visually.)
#ifdef PBL_PLATFORM_EMERY
    const int glyph_side = bounds.size.h - 6;   // emery: ~21 - 6 = 15
    // emery: center in the taller band (matches month_text_rect's centered text).
    const int glyph_y = (bounds.size.h - glyph_side) / 2;
#else
    const int glyph_side = bounds.size.h - 2;   // ~14 - 2 = 12
    // Bottom-align to the "Rain in X" baseline rather than centering in the band: the drop
    // should sit on the text line, not float above it. The 3px inset ≈ the GOTHIC-18
    // baseline that month_text_rect's -MONTH_FONT_OFFSET produces; a slightly negative
    // glyph_y only trims the drop's empty top margin, never the drop itself. (Tune visually.)
    const int glyph_y = bounds.size.h - glyph_side - 3;
#endif
    const int glyph_gap = 2;
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
    if (!alert) { rain_glyph_unload(); }

    if (draw_qt) {
        ensure_mute_bitmap_loaded();
        draw_bitmap(ctx, s_mute_bitmap,
            GRect(ICON_SLOT_1.origin.x, STATUS_ICON_Y(bounds.size.h, ICON_SLOT_1.size.h),
                  ICON_SLOT_1.size.w, ICON_SLOT_1.size.h));
    }

    if (alert) {
        int bucket = rain_tier_to_bucket3(s_rain_alert_tier);
        ensure_rain_glyph_loaded(bucket, glyph_side, rain_glyph_color(s_rain_alert_tier));
        if (s_rain_glyph) {
            GSize gsz = gdraw_command_image_get_bounds_size(s_rain_glyph);
            gdraw_command_image_draw(ctx, s_rain_glyph,
                GPoint(glyph_x + (glyph_side - gsz.w) / 2, glyph_y + (glyph_side - gsz.h) / 2));
        }
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
        // Clamp to real calendar ranges so the compiler's format-truncation
        // analysis knows these are 2- and 4-digit values (same discipline as
        // health_status_layer.c) — otherwise it assumes full int width.
        int mday = tm_now.tm_mday;
        if (mday < 1) { mday = 1; } else if (mday > 31) { mday = 31; }
        int year = tm_now.tm_year + 1900;
        if (year < 0) { year = 0; } else if (year > 9999) { year = 9999; }
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
    rain_glyph_unload();
    layer_destroy(s_top_status_layer);
    MEMORY_LOG_HEAP("top_status_layer_destroy:after");
}
