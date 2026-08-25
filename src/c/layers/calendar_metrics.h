#pragma once

#include "status_metrics.h"   // status_ink_top / status_cap_h — the same Gothic model

// Where a calendar date's glyph lands inside its cell — the SDK-free half of calendar_layer.c,
// in the same spirit as status_metrics.h next door.
//
// It exists because TWO modules must agree on it. calendar_layer.c applies it to draw, and
// windows/layout.c reads the calendar's last inked row as the ink the clock is centred against
// (see the clock seating at the end of compute_with_weights). layout.c may not call the SDK at
// all — the host tests stub pebble.h — so the two constants that decide the seating live here
// rather than in the layer, and there is one definition instead of a copy that can drift.

// 144px: the text rect is pulled UP out of its cell by this much and the glyph then seats at the
// top of it. Not a centring — the cell is taller than the line, and this is the offset the
// calendar has always drawn at.
#define CALENDAR_FONT_OFFSET 5
// emery: the measured line box is centred in the cell, then lifted by this much.
#define CALENDAR_TEXT_SHIFT_Y 5

// Frame top of the date text inside a cell of height `cell_h` starting at row `cell_y`, for a
// font whose measured content height is `content_h`. Mirrors calendar_layer.c's text rect.
static inline int calendar_text_top(int cell_y, int cell_h, int content_h) {
#ifdef PBL_PLATFORM_EMERY
    return cell_y + (cell_h - content_h) / 2 - CALENDAR_TEXT_SHIFT_Y;
#else
    (void) cell_h;
    (void) content_h;
    return cell_y - CALENDAR_FONT_OFFSET;
#endif
}

// Last inked row of the calendar's FINAL row of digits, for a band of `cal_h` at `cal_y` split
// into `rows`. Dates are digits, so there are no descenders below the cap and no ascenders above
// it — the cap box IS the row's ink, which is what makes this a usable centring edge. (The
// today-highlight fill can only ever land in row 0 or 1, never the last row of a 3-row calendar,
// so it cannot extend this.)
//
// status_ink_top(h) + status_cap_h(h) == h identically, so the cap's last row is simply the text
// frame top plus the content height, less one. Spelled out rather than folded so the derivation
// stays visible; the compiler folds it either way.
static inline int calendar_last_row_ink_bottom(int cal_y, int cal_h, int rows, int content_h) {
    int cell_y = cal_y + (rows - 1) * cal_h / rows;
    int cell_h = cal_h / rows;
    return calendar_text_top(cell_y, cell_h, content_h)
           + status_ink_top(content_h) + status_cap_h(content_h) - 1;
}
