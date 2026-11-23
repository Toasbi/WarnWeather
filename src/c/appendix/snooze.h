// src/c/appendix/snooze.h
#pragma once

#include <pebble.h>

// Draw the Sleep item's comic-style snooze glyph into its icon square: two Z's rising
// diagonally, the smaller at the lower left and the larger at the upper right, scaled to
// fit `area`, in 1 px strokes. Integer math only.
void snooze_draw(GContext *ctx, GRect area, GColor color);
