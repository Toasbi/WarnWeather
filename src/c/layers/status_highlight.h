#pragma once
#include <pebble.h>
#include "../appendix/status_threshold.h"

// How a highlighted cell is painted, shared by the two paths that draw one: a status
// slot (status_row.c) and a weather alert item (status_on_demand.c). WHAT a cell
// draws is status_threshold_look()'s call; this is HOW, so a slot and the alert icon
// of its kind cannot look different at the same level. The frames stay the callers':
// a slot's box hugs its measured icon + text, an item's box is its whole footprint.
//
// NOT LINKED ON APLITE: aplite paints its rows from the lean status_row_aplite.c twin,
// which carries no highlighting, and has no On demand. The .c body sits behind
// WW_THRESHOLD_HIGHLIGHT (wscript) and compiles to an empty object there; these
// declarations emit nothing.

// What a cell's glyph and text draw in, and what is behind them: the paper a status
// icon's faded pixels shade towards (faded_pixel.h).
typedef struct {
    GColor ink;
    GColor paper;
} StatusPaint;

// Paint `look`'s box over `frame`: a rounded-rect outline in the look's accent, filled
// first for THRESH_BOX_FILL; nothing for THRESH_BOX_NONE. Returns the ink the cell's
// glyph and text draw in, legible over a fill, the theme foreground otherwise; and its
// paper, the fill, or the theme background inside an outline or without a box.
StatusPaint status_highlight_paint(GContext *ctx, GRect frame, ThreshLook look);

// Draw a cached status glyph `paint`ed, its left edge at `x`, its box centred on the digits'
// cap centre `cap_cy`: the drawing carries its seat (status_icon_size.h). The glyph caches hold
// every glyph painted in the theme foreground on its background (status_row_icons_load), so
// any other ink or paper is painted for the draw and restored after; the theme's draw the
// glyph as cached.
void status_highlight_draw_glyph(GContext *ctx, GDrawCommandImage *image, int16_t x,
                                 int16_t cap_cy, StatusPaint paint);
