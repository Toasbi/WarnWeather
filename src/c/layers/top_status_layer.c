#include <string.h>
#include "top_status_layer.h"
#include "battery_draw.h"
#include "status_row.h"
#include "c/appendix/config.h"
#include "c/appendix/memory_log.h"
#include "c/appendix/palette.h"
#include "c/appendix/persist.h"
#include "c/appendix/rain_countdown.h"
#include "c/appendix/rain_tier.h"
#include "c/appendix/status_line.h"
#include "c/appendix/theme.h"
#include "c/services/watch_services.h"
#include "c/windows/layout.h"   // LayoutTier (status_row tier param)

#define PADDING 4
#define MONTH_FONT_OFFSET 7
#define ICON_SLOT_1 GRect(PADDING, 0, 10, 10)
#define ICON_SLOT_2 GRect(PADDING * 2 + 10, 0, 10, 10)
// emery: center icons in the taller status row.
#ifdef PBL_PLATFORM_EMERY
#define STATUS_ICON_Y(bounds_h, icon_h) (((bounds_h) - (icon_h)) / 2)
#define MONTH_FONT_KEY FONT_KEY_GOTHIC_24
#else
#define STATUS_ICON_Y(bounds_h, icon_h) ((void)(bounds_h), (void)(icon_h), 0)
#define MONTH_FONT_KEY FONT_KEY_GOTHIC_18
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
// Authored as filled drops (white fill / clear stroke) in a 25px viewbox
// (scripts/gen-rain-pdc.py); the fill is recolored per radar tier and the glyph
// is scaled to the square glyph slot at load. aplite excludes both the resources
// and this file (its twin has no rain glyph).
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
    bool    outline;    // light theme: force a 1px black stroke so pale tier fills
                         // remain legible on the white strip
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
        // Round-half (not floor) so downscaling doesn't bias every point toward
        // the origin; points are non-negative and num,den > 0 (matches status_row_icons).
        p.x = (int16_t)((p.x * b->num + b->den / 2) / b->den);
        p.y = (int16_t)((p.y * b->num + b->den / 2) / b->den);
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
    // with an unchanged tint must still re-style the stroke.
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
    RainNorm b = {
        .num = (int16_t)side,
        .den = (int16_t)vspan,
        .tint = tint,
        .outline = outline
    };
    gdraw_command_list_iterate(list, rain_norm_cb, &b);
    gdraw_command_image_set_bounds_size(img, GSize((int16_t)((vb.w * side) / vspan),
                                                   (int16_t)((vb.h * side) / vspan)));
    s_rain_glyph = img;
    s_rain_glyph_bucket = bucket;
    s_rain_glyph_side = side;
    s_rain_glyph_tint = tint;
    s_rain_glyph_outlined = outline;
}

// Glyph colour tracks the radar bars per tier. On B&W (or the color-build Black &
// White theme) the strip background is theme_bg() and palette_radar_color() now
// returns that SAME theme_bg() stop (it's a bar-fill color — see palette.c), so
// using it here would paint the glyph invisibly onto its own background. Force
// the default foreground instead. Light-theme fills retain the tier colour and
// get a 1px black outline in rain_norm_cb for contrast.
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

// Light theme tints the BT icons the default foreground (black) instead of the
// hue — a saturated blue reads poorly on a white strip. Dark keeps the hue;
// bw/bw-light already collapse to theme_fg() via theme_pick(), same as light, so
// this only changes the color-build dark-vs-light split. On B&W hardware builds
// theme_pick() is a macro that always resolves to theme_fg(), so both arms of
// the ternary agree and this collapses to theme_fg() regardless of theme_is_light().
static GColor bt_icon_fg(GColor hue) {
    return theme_is_light() ? theme_fg() : theme_pick(hue, theme_fg());
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

// Configurable slots (status_row's left slot / fixed date mid slot / right slot)
// span from the left icon slot(s) to the right edge. Left inset clears whichever
// icons are currently on screen (QT and/or BT), reusing the same booleans
// top_status_update_proc computes. The right inset is flush (0) on emery so the
// top-right slot lines up exactly with the weather/health rows' right slots (those
// rows pass their full bounds to status_row_apply — see weather_status_layer.c); on
// the smaller-screen platforms a flush right slot clips the right-slot glyph at
// content_w (the battery nub reaches its slot edge), so they keep a PADDING right pad.
// This is only ever consulted in non-alert mode (the alert branch draws its own
// centered glyph+text unit instead), so it need not account for the alert's
// icon-suppression gate.
static GRect content_rect(void) {
    GRect bounds = layer_get_bounds(s_top_status_layer);
    bool show_qt = show_qt_icon();
    bool connected = connection_service_peek_pebble_app_connection();
    bool wants_bt = connected && config_get()->show_bt;
    bool wants_bt_disc = !connected && config_get()->show_bt_disconnect;

    int16_t left = ICON_SLOT_1.origin.x;   // no icons showing: clear just the padding
    if (show_qt) {
        // QT holds slot 1; BT (if any) holds slot 2 alongside it.
        left = (int16_t)(ICON_SLOT_2.origin.x + ICON_SLOT_2.size.w + PADDING);
    } else if (wants_bt || wants_bt_disc) {
        left = (int16_t)(ICON_SLOT_1.origin.x + ICON_SLOT_1.size.w + PADDING);
    }
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

static void top_status_update_proc(Layer *layer, GContext *ctx) {
    GRect bounds = layer_get_bounds(layer);
    bool show_qt = show_qt_icon();
    bool connected = connection_service_peek_pebble_app_connection();
    bool alert = s_rain_alert_active;
    int icon_x = show_qt ? ICON_SLOT_2.origin.x : ICON_SLOT_1.origin.x;
    const GFont font = fonts_get_system_font(MONTH_FONT_KEY);

    bool wants_bt = connected && config_get()->show_bt;
    bool wants_bt_disc = !connected && config_get()->show_bt_disconnect;

    // Alert mode centers a glyph+text unit in place of the configurable slots;
    // non-alert mode defers the row to status_row after the icon draws.
    char shown[sizeof(s_rain_alert_text)];
    GRect text_rect = bounds;   // unused unless alert (overwritten below)
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
        // Keep the right slot (battery) visible during the alert: suppress the
        // left+mid slots and reserve exactly the right slot's measured width so
        // the alert unit never overlaps it (a text/live metric there can be wider
        // than the battery glyph). Empty right slot -> right_w 0 -> full width.
        status_row_set_suppress_edges(s_row, true);
        status_row_apply(s_row, content_rect(), LAYOUT_TIER_FULL, STATUS_LINE_TOP);
        int16_t right_w = status_row_right_slot_width(s_row);
        int16_t alert_w = (int16_t)(bounds.size.w - (right_w > 0 ? right_w + PADDING : 0));
        if (alert_w < 0) { alert_w = 0; }

        strncpy(shown, s_rain_alert_text, sizeof(shown));
        shown[sizeof(shown) - 1] = '\0';
        text_rect = month_text_rect(bounds, font, shown);

        // Center glyph+gap+text as one block: measure the text, seat the glyph just
        // left of it, then left-align the text immediately after the glyph.
        GSize text_size = graphics_text_layout_get_content_size(
            shown, font, GRect(0, 0, bounds.size.w, bounds.size.h),
            GTextOverflowModeFill, GTextAlignmentLeft);
        int unit_w = glyph_side + glyph_gap + text_size.w;
        int start_x = (alert_w - unit_w) / 2;
        if (start_x < 0) { start_x = 0; }
        glyph_x = start_x;
        text_rect.origin.x = start_x + glyph_side + glyph_gap;
        text_rect.size.w = alert_w - text_rect.origin.x;
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
        ensure_icon_loaded(&s_mute_bitmap, s_mute_palette, &s_mute_bitmap_fg,
                           RESOURCE_ID_IMAGE_MUTE, theme_fg());
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
        ensure_icon_loaded(&s_bt_bitmap, s_bt_palette, &s_bt_bitmap_fg,
                           RESOURCE_ID_IMAGE_BT_CONNECT, bt_icon_fg(GColorPictonBlue));
        draw_bitmap(ctx, s_bt_bitmap, GRect(bt_x, STATUS_ICON_Y(bounds.size.h, 10), 10, 10));
    } else if (draw_bt_disc) {
        ensure_icon_loaded(&s_bt_disconnect_bitmap, s_bt_disconnect_palette,
                           &s_bt_disconnect_bitmap_fg,
                           RESOURCE_ID_IMAGE_BT_DISCONNECT, bt_icon_fg(GColorRed));
        draw_bitmap(ctx, s_bt_disconnect_bitmap, GRect(bt_x, STATUS_ICON_Y(bounds.size.h, 10), 10, 10));
    }

    if (alert) {
        draw_status_text_in(ctx, text_rect, shown, text_align, font);
        status_row_draw(s_row, ctx);   // suppress_edges already set above -> right slot only
    } else {
        status_row_set_suppress_edges(s_row, false);
        status_row_apply(s_row, content_rect(), LAYOUT_TIER_FULL, STATUS_LINE_TOP);
        status_row_draw(s_row, ctx);
    }
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
    // update_battery_override here catches crossing the 10% threshold between the
    // discrete battery_state events.
    update_battery_override();
    bool dirty = false;
    bool qt_active = show_qt_icon();
    if (qt_active != s_last_qt_active) {
        s_last_qt_active = qt_active;
        dirty = true;
    }
    if (recompute_rain_alert()) {
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
    // this owner only keeps the alert derivation and icon state in sync.
    update_battery_override();   // config may have flipped battery_low_only
    recompute_rain_alert();
    status_icons_refresh();
    status_row_set_sleeping(s_row, persist_get_is_sleeping());
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
    rain_glyph_unload();
    status_row_destroy(s_row);
    s_row = NULL;
    layer_destroy(s_top_status_layer);
    MEMORY_LOG_HEAP("top_status_layer_destroy:after");
}
