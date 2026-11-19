#pragma once
#include <pebble.h>
#include "../appendix/status_line.h"
#include "../appendix/theme.h"
#include "status_icon_size.h"

// Not built on aplite: its lean status row (status_row_aplite.c) draws bit masks.

// What a status cell's glyph and text draw in, and what is behind them: the paper a status
// icon's faded pixels shade towards (faded_pixel.h). A highlight box hands back its own
// (status_highlight_paint).
typedef struct {
    GColor ink;
    GColor paper;
} StatusPaint;

// The theme's foreground on its background: a cell without a box, and every drawing as loaded.
static inline StatusPaint status_paint_theme(void) {
    return (StatusPaint){ theme_fg(), theme_bg() };
}

// Icon id → its drawing for the box a bar's icon height `target_h` paints (status_icon_size.h),
// painted in the theme's paint, or NULL when the id has no drawing (NONE, the DRAWN_* sentinels,
// the text-only ids, a load failure). A NULL degrades the slot to text only; never suppress the
// value for it. The drawing carries its own size and seat.
GDrawCommandImage *status_row_icons_load(uint8_t icon_id, int target_h);

// Draw a loaded drawing `paint`ed, its left edge at `x`, its box centred on the digits' cap
// centre `cap_cy` as its seat says (status_icon_size.h): its own pixels in the ink, its faded
// pixels shaded between the paper and the ink on the colour watches (faded_pixel.h). Any other
// paint than the theme's is painted in for the draw and the theme's put back after, so the
// glyph caches keep every drawing as loaded.
void status_row_icons_draw(GContext *ctx, GDrawCommandImage *image, int16_t x, int16_t cap_cy,
                           StatusPaint paint);

void status_row_icons_destroy(GDrawCommandImage *image);
