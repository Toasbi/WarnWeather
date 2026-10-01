#pragma once

// The Watch battery slot glyph's geometry (battery_draw.c), SDK-free. The row places
// the glyph by it (status_row.c), and On demand measures the glyph's short form, the
// glyph without its bolt lane, by it (status_on_demand.c). Left to right: the
// charging bolt's lane (its bitmap and the space after it; empty while the watch is
// not charging), the body, and the nub.
#define BATTERY_GLYPH_W 29
#define BATTERY_GLYPH_H 10
#define BATTERY_POWER_ICON_W 7
#define BATTERY_ICON_SPACING 3
// The bolt lane's width: the body starts this far right of the glyph's left edge.
#define BATTERY_BOLT_LANE_W (BATTERY_POWER_ICON_W + BATTERY_ICON_SPACING)
// The nub stands this far past the body's right edge, at any body size.
#define BATTERY_NUB_W 2
