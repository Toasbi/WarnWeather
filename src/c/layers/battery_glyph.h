#pragma once

// The Watch battery slot glyph's geometry (battery_draw.c). SDK-free, so the slots'
// short forms (appendix/status_short_text.h, host-compiled too) read the numbers the
// drawer uses. Left to right: the charging bolt's lane (its bitmap and the space after
// it; empty while the watch is not charging), the body, and the nub.
#define BATTERY_GLYPH_W 29
#define BATTERY_GLYPH_H 10
#define BATTERY_POWER_ICON_W 7
#define BATTERY_ICON_SPACING 3
// The nub stands this far past the body's right edge, at any body size.
#define BATTERY_NUB_W 2
