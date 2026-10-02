#pragma once

#include <pebble.h>

// Anti-aliased clock digits for the colour screens.
//
// The firmware's fonts are 1-bit, so on a colour screen the big clock digits step at every
// curve. Here the Roboto and Bitham faces draw from pre-rendered glyph images instead
// (scripts/gen-clock-glyphs.py): each glyph pixel carries one of the four GColor8 alpha levels
// in a 2-bit palette, the palette is recoloured to the clock colour at draw time, and
// GCompOpSet blends it at that alpha, so the firmware's own transparency path smooths the edges
// against whatever theme is underneath. LECO stays on the system font — a segment face has no
// curves to smooth.
//
// PBL_COLOR only (the capability macro: a 1-bit screen has no alpha to blend with), so on the
// B/W platforms this header declares nothing, clock_glyphs.c compiles to an empty unit, and
// every call site is guarded the same way.
#if defined(PBL_COLOR)

// Whether `time_font` draws through the glyph images: Roboto and Bitham, not LECO. Their ink
// heights, which the layout solver seats the band with, are in clock_glyphs_ink.h.
bool clock_glyphs_face(int16_t time_font);

// Pen advance of `text` in pixels: the digits' width for centring and for the AM/PM label.
int16_t clock_glyphs_width(int16_t time_font, const char *text);

// Draw `text` ('0'-'9' and ':' — anything else is skipped) with the pen starting at
// origin.x and the digits' first inked row at origin.y, in `color` — anti-aliased, except in
// a B&W theme (theme_is_bw()), where the edges snap to 1-bit like a B&W watch's. Loads each
// glyph's image only while it draws that glyph, so the heap holds one glyph at a time (0.3 KB
// at most on basalt, where the whole face's set would not fit resident beside everything
// else). A glyph that fails to load is left out of this frame rather than crashing.
void clock_glyphs_draw(GContext *ctx, int16_t time_font, const char *text, GPoint origin,
                       GColor color);

#endif
