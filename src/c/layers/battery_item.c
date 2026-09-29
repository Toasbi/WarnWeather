// Every include stays ABOVE the WW_ON_DEMAND guard, on purpose: waf's dependency
// scanner does not evaluate -D macros (see night_light.c). Aplite, which lacks the
// flag, compiles this file to an empty object.
#include <pebble.h>
#include "battery_item.h"
#include "c/appendix/theme.h"

#if defined(WW_ON_DEMAND)

// The body is about 1.7 times as wide as it is high — the Watch battery slot's body
// (17 x 10) at every tier.
static int body_w(int h) {
    return (h * 17) / 10;
}

int16_t battery_item_width(int h, bool charging) {
    if (h <= 0) { return 0; }
    return (int16_t)(body_w(h) + BATTERY_ITEM_NUB_W
        + (charging ? BATTERY_ITEM_BOLT_W + BATTERY_ITEM_BOLT_GAP : 0));
}

// The slot glyph's colour code: the item shows at a low charge, so on colour it is
// red or yellow unless the user set a warn level above 30.
// LOCKSTEP: a copy of battery_draw.c's battery_fill_color, which stays untouched
// here (it has an aplite twin); change both or neither.
// test/battery-item-lockstep.test.js compares the two bodies and the 0 % sliver.
static GColor fill_color(int level, GColor fg) {
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

// A zigzag bolt in its 7 px lane, the full glyph height.
static void draw_bolt(GContext *ctx, int x, int y, int h) {
    int mid = y + h / 2;
    graphics_draw_line(ctx, GPoint(x + 5, y), GPoint(x + 1, mid));
    graphics_draw_line(ctx, GPoint(x + 1, mid), GPoint(x + 5, mid));
    graphics_draw_line(ctx, GPoint(x + 5, mid), GPoint(x + 1, y + h - 1));
}

void battery_item_draw(GContext *ctx, GPoint origin, int h, int level, bool charging,
                       GColor fg) {
    if (h < 4) { return; }
    if (level < 0) { level = 0; }
    if (level > 100) { level = 100; }
    int x = origin.x;
    graphics_context_set_stroke_color(ctx, fg);
    graphics_context_set_stroke_width(ctx, 1);
    if (charging) {
        draw_bolt(ctx, x, origin.y, h);
        x += BATTERY_ITEM_BOLT_W + BATTERY_ITEM_BOLT_GAP;
    }
    int bw = body_w(h);
    // Inside the 1 px outline and 1 px of air; +10/110 keeps a sliver at 0 %, as the
    // slot glyph does.
    int inner_w = bw - 4;
    if (inner_w > 0) {
        graphics_context_set_fill_color(ctx, fill_color(level, fg));
        graphics_fill_rect(ctx, GRect(x + 2, origin.y + 2, inner_w * (level + 10) / 110, h - 4),
                           0, GCornerNone);
    }
    graphics_draw_rect(ctx, GRect(x, origin.y, bw, h));
    int nub_h = (h * 6) / 10;
    if (nub_h < 2) { nub_h = 2; }
    graphics_draw_rect(ctx, GRect(x + bw - 1, origin.y + (h - nub_h) / 2,
                                  BATTERY_ITEM_NUB_W + 1, nub_h));
}

#endif
