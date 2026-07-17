#include "battery_draw.h"
#include "c/appendix/theme.h"
#include "c/services/watch_services.h"

#define BATTERY_NUB_W 2
#define BATTERY_NUB_H 6
#define BATTERY_STROKE 1
#define FILL_PADDING 1
#define ICON_SPACING 3
#define BATTERY_POWER_ICON_W 7

static GBitmap *s_charging_bitmap;
static GColor s_charging_palette[2];
static GColor s_charging_fg;

static GColor battery_fill_color(int level, GColor fg) {
#ifdef PBL_COLOR
    if (theme_is_bw()) { return fg; }
    if (level >= 50) { return GColorGreen; }
    if (level >= 30) { return GColorYellow; }
    return GColorRed;
#else
    (void) level;
    return fg;
#endif
}

static void ensure_charging_bitmap(GColor fg) {
    if (s_charging_bitmap && gcolor_equal(s_charging_fg, fg)) { return; }
    if (!s_charging_bitmap) {
        s_charging_bitmap = gbitmap_create_with_resource(RESOURCE_ID_IMAGE_BATTERY_CHARGING);
    }
    s_charging_palette[0] = fg;
    s_charging_palette[1] = GColorClear;
    gbitmap_set_palette(s_charging_bitmap, s_charging_palette, false);
    s_charging_fg = fg;
}

void battery_draw(GContext *ctx, GRect rect, GColor fg) {
    const int ox = rect.origin.x, oy = rect.origin.y;
    const int w = rect.size.w, h = rect.size.h;
    BatteryChargeState st = watch_services_battery_state();
    int level = st.charge_percent;
    bool charging = st.is_charging || st.is_plugged;

    if (!charging && s_charging_bitmap) {
        gbitmap_destroy(s_charging_bitmap);
        s_charging_bitmap = NULL;
    }

    int battery_x = BATTERY_POWER_ICON_W + ICON_SPACING;
    int battery_w = (w - battery_x) - BATTERY_NUB_W;

    GRect color_bounds = GRect(
        ox + battery_x + BATTERY_STROKE + FILL_PADDING, oy + BATTERY_STROKE + FILL_PADDING,
        battery_w - (BATTERY_STROKE + FILL_PADDING) * 2, h - (BATTERY_STROKE + FILL_PADDING) * 2);
    // +10/110: guarantees a visible sliver at 0% by mapping [0,100]→[~9%,100%].
    GRect color_area = GRect(color_bounds.origin.x, color_bounds.origin.y,
        color_bounds.size.w * (level + 10) / 110, color_bounds.size.h);
    graphics_context_set_fill_color(ctx, battery_fill_color(level, fg));
    graphics_fill_rect(ctx, color_area, 0, GCornerNone);

    if (charging) {
        ensure_charging_bitmap(fg);
        GRect ib = gbitmap_get_bounds(s_charging_bitmap);
        graphics_context_set_compositing_mode(ctx, GCompOpSet);
        graphics_draw_bitmap_in_rect(ctx, s_charging_bitmap,
            GRect(ox, oy + (h - ib.size.h) / 2, ib.size.w, ib.size.h));
        graphics_context_set_compositing_mode(ctx, GCompOpAssign);
    }

    graphics_context_set_stroke_color(ctx, fg);
    graphics_context_set_stroke_width(ctx, BATTERY_STROKE);
    graphics_draw_rect(ctx, GRect(ox + battery_x, oy, battery_w, h));
    graphics_draw_rect(ctx, GRect(ox + battery_x + battery_w - 1,
        oy + h / 2 - BATTERY_NUB_H / 2, BATTERY_NUB_W + 1, BATTERY_NUB_H));
}

void battery_draw_deinit(void) {
    if (s_charging_bitmap) {
        gbitmap_destroy(s_charging_bitmap);
        s_charging_bitmap = NULL;
    }
}
