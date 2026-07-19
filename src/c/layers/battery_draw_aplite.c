// src/c/layers/battery_draw_aplite.c
//
// Lean aplite (Pebble Classic/Steel) twin of battery_draw.c.
//
// Frozen fork of battery_draw.c as of ea66aa8. FEATURE-FROZEN, NOT CODE-FROZEN:
// preserves the battery_draw.h contract but draws the charging mark with
// primitives instead of the retinted PNG, so aplite links no gbitmap path and the
// charging resource is dropped from its image. Bugfixes to the shared geometry are
// hand-ported.
#include "battery_draw.h"
#include "c/appendix/theme.h"
#include "c/services/watch_services.h"

#define BATTERY_NUB_W 2
#define BATTERY_NUB_H 6
#define BATTERY_STROKE 1
#define FILL_PADDING 1
#define ICON_SPACING 3
#define BATTERY_POWER_ICON_W 7

// A small lightning bolt in the 7px power-icon column, vertically centred in `h`.
static void draw_bolt(GContext *ctx, int ox, int oy, int h, GColor fg) {
    int y = oy + (h - 7) / 2;
    graphics_context_set_fill_color(ctx, fg);
    graphics_fill_rect(ctx, GRect(ox + 3, y + 0, 2, 1), 0, GCornerNone);
    graphics_fill_rect(ctx, GRect(ox + 2, y + 1, 2, 1), 0, GCornerNone);
    graphics_fill_rect(ctx, GRect(ox + 0, y + 2, 5, 2), 0, GCornerNone);  // crossbar
    graphics_fill_rect(ctx, GRect(ox + 2, y + 4, 2, 1), 0, GCornerNone);
    graphics_fill_rect(ctx, GRect(ox + 1, y + 5, 2, 1), 0, GCornerNone);
}

void battery_draw(GContext *ctx, GRect rect, GColor fg) {
    const int ox = rect.origin.x, oy = rect.origin.y;
    const int w = rect.size.w, h = rect.size.h;
    BatteryChargeState st = watch_services_battery_state();
    int level = st.charge_percent;
    bool charging = st.is_charging || st.is_plugged;

    int battery_x = BATTERY_POWER_ICON_W + ICON_SPACING;
    int battery_w = (w - battery_x) - BATTERY_NUB_W;

    GRect color_bounds = GRect(
        ox + battery_x + BATTERY_STROKE + FILL_PADDING, oy + BATTERY_STROKE + FILL_PADDING,
        battery_w - (BATTERY_STROKE + FILL_PADDING) * 2, h - (BATTERY_STROKE + FILL_PADDING) * 2);
    // +10/110: guarantees a visible sliver at 0% by mapping [0,100]→[~9%,100%].
    GRect color_area = GRect(color_bounds.origin.x, color_bounds.origin.y,
        color_bounds.size.w * (level + 10) / 110, color_bounds.size.h);
    graphics_context_set_fill_color(ctx, fg);   // aplite is B/W: fill is always fg
    graphics_fill_rect(ctx, color_area, 0, GCornerNone);

    if (charging) { draw_bolt(ctx, ox, oy, h, fg); }

    graphics_context_set_stroke_color(ctx, fg);
    graphics_context_set_stroke_width(ctx, BATTERY_STROKE);
    graphics_draw_rect(ctx, GRect(ox + battery_x, oy, battery_w, h));
    graphics_draw_rect(ctx, GRect(ox + battery_x + battery_w - 1,
        oy + h / 2 - BATTERY_NUB_H / 2, BATTERY_NUB_W + 1, BATTERY_NUB_H));
}

void battery_draw_deinit(void) { /* no lazy bitmap on aplite */ }
