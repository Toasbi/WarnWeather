// Every include stays ABOVE the WW_ON_DEMAND guard, on purpose: waf's dependency
// scanner does not evaluate -D macros (see night_light.c). Aplite, which lacks the
// flag, compiles this file to an empty object.
#include <pebble.h>
#include "battery_item.h"
#include "battery_draw.h"

#if defined(WW_ON_DEMAND)

// The body is about 1.7 times as wide as it is high — the Watch battery slot's body
// (17 x 10) at every tier.
static int body_w(int h) {
    return (h * 17) / 10;
}

int16_t battery_item_width(int h, bool charging) {
    if (h <= 0) { return 0; }
    return (int16_t)(body_w(h) + BATTERY_NUB_W
        + (charging ? BATTERY_ITEM_BOLT_W + BATTERY_ITEM_BOLT_GAP : 0));
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
    if (charging) {
        graphics_context_set_stroke_color(ctx, fg);
        graphics_context_set_stroke_width(ctx, 1);
        draw_bolt(ctx, x, origin.y, h);
        x += BATTERY_ITEM_BOLT_W + BATTERY_ITEM_BOLT_GAP;
    }
    battery_body_draw(ctx, GPoint(x, origin.y), body_w(h), h, level, fg);
}

#endif
