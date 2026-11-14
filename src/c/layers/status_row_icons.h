#pragma once
#include <pebble.h>
#include "../appendix/status_line.h"
#include "status_icon_size.h"

// Not built on aplite: its lean status row (status_row_aplite.c) draws bit masks.

// Icon id → its pixel drawing (status_icon_size.h) in the theme's foreground, or NULL when the
// id has no drawing (NONE, the DRAWN_* sentinels, the text-only ids, a load failure). A NULL
// degrades the slot to text only; never suppress the value for it. `top_strip` is the row's
// tier flag: the top strip's smaller icon height keeps the calendar seam clear, and the small
// thermometer and the phone pair's rungs depend on it.
GDrawCommandImage *status_row_icons_load(uint8_t icon_id, int target_h, bool top_strip);

// The rain alert's icon for `bucket` (1 light, 2 rain, 3 heavy): the Drizzle, Rain or Heavy rain
// pixel drawing at the weather icons' size, in the foreground like every other icon (a thin
// outline in the radar's colour reads too faintly; a colour would need filled drops). NULL for
// a non-positive target_h and a load failure.
GDrawCommandImage *status_row_icons_load_rain(uint8_t bucket, int target_h);

void status_row_icons_destroy(GDrawCommandImage *image);
