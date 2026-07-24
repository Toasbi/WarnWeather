#pragma once
#include <pebble.h>

// Icon id → recolored, size-normalized PDC image, or NULL when the id has no
// bundled glyph (NONE, DRAWN_* sentinels, unknown id, load failure, aplite).
// A NULL degrades the slot to text-only — never suppress the value for it.
GDrawCommandImage *status_row_icons_load(uint8_t icon_id, int target_h);
void status_row_icons_destroy(GDrawCommandImage *image);
