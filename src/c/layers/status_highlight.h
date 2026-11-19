#pragma once
#include <pebble.h>
#include "../appendix/status_threshold.h"
#include "status_row_icons.h"

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

// Paint `look`'s box over `frame`: a rounded-rect outline in the look's accent, filled
// first for THRESH_BOX_FILL; nothing for THRESH_BOX_NONE. Returns the paint the cell's
// glyph (status_row_icons_draw) and text draw in: the ink legible over a fill, the theme
// foreground otherwise; and the paper, the fill, or the theme background inside an
// outline or without a box.
StatusPaint status_highlight_paint(GContext *ctx, GRect frame, ThreshLook look);
