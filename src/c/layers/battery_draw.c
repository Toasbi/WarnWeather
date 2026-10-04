#include "battery_draw.h"
#include "c/appendix/theme.h"
#include "c/services/watch_services.h"

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

// Shaped for the paint path's stack. The origin is one GPoint word, so the On demand
// item's call (its last statement) compiles to a tail call: the body's frame replaces
// the item's instead of stacking on it. One rect is reused for each part: a compound
// literal per call would keep its own stack slot for the whole function.
void battery_body_draw(GContext *ctx, GPoint origin, int bw, int h, int level, GColor fg) {
    const int x = origin.x, y = origin.y;
    // Inside the 1 px outline and 1 px of air; +10/110 guarantees a visible sliver at
    // 0 % by mapping [0,100] -> [~9 %,100 %].
    GRect r = GRect(x + 2, y + 2, (bw - 4) * (level + 10) / 110, h - 4);
    graphics_context_set_fill_color(ctx, battery_fill_color(level, fg));
    graphics_fill_rect(ctx, r, 0, GCornerNone);
    graphics_context_set_stroke_color(ctx, fg);
    graphics_context_set_stroke_width(ctx, 1);
    r = GRect(x, y, bw, h);
    graphics_draw_rect(ctx, r);
    const int nub_h = (h * 6) / 10;
    r = GRect(x + bw - 1, y + (h - nub_h) / 2, BATTERY_NUB_W + 1, nub_h);
    graphics_draw_rect(ctx, r);
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

    // The bitmap fills only the bolt lane, left of the body: drawing it first
    // overlaps nothing the body draws.
    if (charging) {
        ensure_charging_bitmap(fg);
        GRect ib = gbitmap_get_bounds(s_charging_bitmap);
        graphics_context_set_compositing_mode(ctx, GCompOpSet);
        graphics_draw_bitmap_in_rect(ctx, s_charging_bitmap,
            GRect(ox, oy + (h - ib.size.h) / 2, ib.size.w, ib.size.h));
        graphics_context_set_compositing_mode(ctx, GCompOpAssign);
    }

    battery_body_draw(ctx, GPoint(ox + BATTERY_BOLT_LANE_W, oy),
                      w - BATTERY_BOLT_LANE_W - BATTERY_NUB_W, h, level, fg);
}

void battery_draw_deinit(void) {
    if (s_charging_bitmap) {
        gbitmap_destroy(s_charging_bitmap);
        s_charging_bitmap = NULL;
    }
}
