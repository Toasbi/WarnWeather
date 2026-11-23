#include "snooze.h"

// Minimum glyph side so the diagonal stays readable at status-row scale.
#define SNOOZE_MIN_SIDE 4

// One Z = three strokes: top bar, diagonal, bottom bar.
static void draw_z(GContext *ctx, GRect box) {
    const int16_t x0 = box.origin.x;
    const int16_t x1 = box.origin.x + box.size.w - 1;
    const int16_t y0 = box.origin.y;
    const int16_t y1 = box.origin.y + box.size.h - 1;
    graphics_draw_line(ctx, GPoint(x0, y0), GPoint(x1, y0));
    graphics_draw_line(ctx, GPoint(x1, y0), GPoint(x0, y1));
    graphics_draw_line(ctx, GPoint(x0, y1), GPoint(x1, y1));
}

static int16_t side_of(int16_t basis, int twelfths) {
    const int16_t side = (int16_t)(basis * twelfths / 12);
    return side < SNOOZE_MIN_SIDE ? SNOOZE_MIN_SIDE : side;
}

void snooze_draw(GContext *ctx, GRect area, GColor color) {
    if (area.size.w <= 0 || area.size.h < SNOOZE_MIN_SIDE) {
        return;
    }
    const int16_t h = area.size.h;

    // Sizing basis: the area height, capped so the two glyphs (6 and 9 twelfths of the
    // basis) and the gap between them fit the area's width.
    int16_t basis = (int16_t)(((area.size.w - 1) * 12) / 16);
    if (h < basis) {
        basis = h;
    }
    const int16_t gap = basis / 12 + 1;
    const int16_t small = side_of(basis, 6);
    const int16_t big = side_of(basis, 9);

    graphics_context_set_stroke_color(ctx, color);
    graphics_context_set_stroke_width(ctx, 1);

    // The small Z's bottom touches the area's bottom and the big Z's top its top; the
    // pair is centred horizontally.
    const int16_t x = area.origin.x + (area.size.w - (small + gap + big)) / 2;
    draw_z(ctx, GRect(x, area.origin.y + h - small, small, small));
    draw_z(ctx, GRect(x + small + gap, area.origin.y, big, big));
}
