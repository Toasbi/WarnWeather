#pragma once
#include <pebble.h>

// Icon id → recolored, size-normalized PDC image, or NULL when the id has no
// bundled glyph (NONE, DRAWN_* sentinels, unknown id, load failure, aplite).
// A NULL degrades the slot to text-only — never suppress the value for it.
// `top_strip` gates the small-tier size substitutions: the strip's icon tier is
// deliberately smaller (calendar clearance), so tall small-size variants are
// rows-only.
GDrawCommandImage *status_row_icons_load(uint8_t icon_id, int target_h, bool top_strip);

// Glyph ids for the On demand system items (layers/status_on_demand.c). In memory
// only, never on the wire: above every StatusIconId (STATUS_ICON_MAX) and below the
// alert glyph cache's rain flag (0x80). Outline art like the slot glyphs, so
// status_row_icons_load() draws them at any tier.
#define STATUS_ROW_ICON_QUIET 0x40    // Quiet time: the muted speaker
#define STATUS_ROW_ICON_BT 0x41       // Bluetooth connected: the rune
#define STATUS_ROW_ICON_BT_OFF 0x42   // Bluetooth disconnected: the rune crossed out

// The keep-fill flavour, for fill-authored art addressed by RESOURCE id (the
// RAIN_DRIZZLE / RAIN_RAIN / RAIN_DOWNPOUR drops — no StatusIconId exists for them):
// the fill takes `tint`, the stroke stays clear, or becomes 1-px black when
// `outline` (the light theme's rule, so a pale tint still reads on white). The
// size rule differs from status_row_icons_load's: the authored VIEWBOX (not the
// ink) scales into a square 120 % of target_h, snapped to the pixel grid, so every
// bucket keeps the retired strip's drop size and only the drop count changes.
// NULL for resource 0, a non-positive target_h, a load failure, and on aplite.
GDrawCommandImage *status_row_icons_load_filled(uint32_t resource_id, int target_h,
                                                GColor tint, bool outline);
void status_row_icons_destroy(GDrawCommandImage *image);
