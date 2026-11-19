#pragma once
#include <pebble.h>
#include "../appendix/status_line.h"
#include "status_icon_size.h"

// Not built on aplite: its lean status row (status_row_aplite.c) draws bit masks.

// Icon id → its drawing for the box a bar's icon height `target_h` paints (status_icon_size.h),
// painted in the theme's foreground on its background, or NULL when the id has no drawing (NONE,
// the DRAWN_* sentinels, the text-only ids, a load failure). A NULL degrades the slot to text only;
// never suppress the value for it. The drawing carries its own size and seat.
GDrawCommandImage *status_row_icons_load(uint8_t icon_id, int target_h);

// Paint a drawing loaded here `ink` on `paper`, the colour behind it: its own pixels in the ink,
// its faded pixels shaded between the two on the colour watches (faded_pixel.h).
void status_row_icons_paint(GDrawCommandImage *image, GColor ink, GColor paper);

void status_row_icons_destroy(GDrawCommandImage *image);
