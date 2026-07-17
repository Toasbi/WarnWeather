#pragma once

#include <pebble.h>

// Reusable battery glyph, shared by the top-strip status row (the top-right
// slot's SLOT_LIVE_BATTERY) — extracted from the retired battery_layer. Draws
// the charging bolt + outline + level fill + nub into `rect`, reading the live
// battery state itself. `fg` is the outline colour; the fill is level-coded
// (green/yellow/red) on colour displays and `fg` on B&W. The charging bitmap is
// lazy-loaded and retinted to `fg`; call battery_draw_deinit() at teardown.
#define BATTERY_GLYPH_W 29
#define BATTERY_GLYPH_H 10

void battery_draw(GContext *ctx, GRect rect, GColor fg);
void battery_draw_deinit(void);
