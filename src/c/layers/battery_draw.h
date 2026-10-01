#pragma once

#include <pebble.h>
#include "battery_glyph.h"

// Reusable battery glyph, shared by the top-strip status row (the top-right
// slot's SLOT_LIVE_BATTERY) — extracted from the retired battery_layer. Draws
// the charging bolt + outline + level fill + nub into `rect`, reading the live
// battery state itself. `fg` is the outline colour; the fill is level-coded
// (green/yellow/red) on colour displays and `fg` on B&W. The charging bitmap is
// lazy-loaded and retinted to `fg`; call battery_draw_deinit() at teardown.
void battery_draw(GContext *ctx, GRect rect, GColor fg);
void battery_draw_deinit(void);

// The glyph's body at any size, for a charge of `level` percent (0..100): a bw x h
// outline in `fg` with its top-left at `origin`, the level fill inside it and 1 px of
// air (coded as above; it keeps a sliver at 0 %), and a BATTERY_NUB_W px nub past its
// right edge, (h * 6) / 10 high and centred. Needs bw > 4 and h >= 4.
// battery_draw() draws it beside its bolt lane; the On demand Battery item
// (battery_item.c) draws it at the row's icon tier.
// NOT ON APLITE: the aplite twin draws no glyph and defines no body.
void battery_body_draw(GContext *ctx, GPoint origin, int bw, int h, int level, GColor fg);
