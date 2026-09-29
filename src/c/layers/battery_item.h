#pragma once
#include <pebble.h>

// The On demand Battery item's glyph: a battery drawn procedurally at the row's icon
// tier, so it matches the other items on every bar (the strip's 10/13 px, the rows'
// 12/16 px) — the Watch battery slot's fixed 29 x 10 glyph (battery_draw.c) cannot
// follow the tiers. The body is `h` high and about 1.7 h wide, with a 2 px nub and a
// level fill coded like the slot's (green / yellow / red on colour, the foreground
// on B&W); while charging, a 7 px bolt lane stands in front of it.
//
// NOT LINKED ON APLITE: On demand is aplite-absent (WW_ON_DEMAND in wscript), so the
// .c body sits behind the macro and compiles to an empty object there.

#define BATTERY_ITEM_NUB_W 2
#define BATTERY_ITEM_BOLT_W 7
#define BATTERY_ITEM_BOLT_GAP 2

// The glyph's width at icon height `h`: body, nub, and the bolt lane while charging.
int16_t battery_item_width(int h, bool charging);

// Draw the glyph with its top-left at `origin`, `h` px high, for a charge of `level`
// percent. `fg` strokes the outline, the nub and the bolt.
void battery_item_draw(GContext *ctx, GPoint origin, int h, int level, bool charging,
                       GColor fg);
