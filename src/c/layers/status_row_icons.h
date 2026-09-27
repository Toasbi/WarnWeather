#pragma once
#include <pebble.h>

// Icon id → recolored, size-normalized PDC image, or NULL when the id has no
// bundled glyph (NONE, DRAWN_* sentinels, unknown id, load failure, aplite).
// A NULL degrades the slot to text-only — never suppress the value for it.
// `top_strip` gates the small-tier size substitutions: the strip's icon tier is
// deliberately smaller (calendar clearance), so tall small-size variants are
// rows-only.
GDrawCommandImage *status_row_icons_load(uint8_t icon_id, int target_h, bool top_strip);

// The keep-fill flavour, for fill-authored art addressed by RESOURCE id (the
// RAIN_DRIZZLE / RAIN_RAIN / RAIN_DOWNPOUR drops — no StatusIconId exists for them):
// the fill takes `tint`, the stroke stays clear, or becomes 1-px black when
// `outline` (the light theme's rule, so a pale tint still reads on white). The
// size rule is status_row_icons_load's — ink bbox height -> target_h px, snapped
// to the pixel grid — so a drop sits at the same height as the icons beside it.
// NULL for resource 0, a non-positive target_h, a load failure, and on aplite.
GDrawCommandImage *status_row_icons_load_filled(uint32_t resource_id, int target_h,
                                                GColor tint, bool outline);
void status_row_icons_destroy(GDrawCommandImage *image);
