// src/c/layers/battery_draw_aplite.c
//
// Lean aplite (Pebble Classic/Steel) twin of battery_draw.c.
//
// Frozen fork of battery_draw.c as of ea66aa8. FEATURE-FROZEN, NOT CODE-FROZEN:
// aplite renders the battery as plain text ("NN%") in the status row instead of a
// glyph (a size-recovery measure), so no battery is drawn here. This twin exists only
// to shadow battery_draw.c on aplite so the base's gbitmap/charging-PNG path never
// compiles into the aplite image; both functions are unreferenced on aplite and are
// reaped by --gc-sections.
#include "battery_draw.h"

void battery_draw(GContext *ctx, GRect rect, GColor fg) {
    (void)ctx; (void)rect; (void)fg;
}

void battery_draw_deinit(void) { }
