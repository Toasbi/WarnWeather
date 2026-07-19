// src/c/appendix/status_row_alloc.h
#pragma once

// Lean, pure width allocator for the aplite status row (3 slots: left/middle/right).
// Deliberately NOT status_row_layout / StatusSlotMeasure: the aplite twin must stay
// independent of the shared layout module (see docs/adr/0001). Plain ints only so it
// host-compiles with no Pebble SDK.
#define STATUS_ROW_ALLOC_GROUP_GAP 4

// group_w[i]: slot i's desired width (icon + optional gap + text), 0 when empty.
// Writes gx[i] (x from content origin) and draw_w[i] (drawable width; the middle is
// clamped to its available span so its text ellipsizes instead of overrunning).
void status_row_alloc(int content_w, const int group_w[3], int gx[3], int draw_w[3]);
