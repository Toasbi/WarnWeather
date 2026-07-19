// src/c/appendix/status_row_alloc.h
#pragma once

// Lean, pure width allocator for the aplite status row (3 slots: left/middle/right).
// Deliberately NOT status_row_layout / StatusSlotMeasure: the aplite twin must stay
// independent of the shared layout module (see docs/adr/0001). Plain ints only so it
// host-compiles with no Pebble SDK.
#define STATUS_ROW_ALLOC_GROUP_GAP 4

// Distributes content_w across the three slots in strict PRIORITY ORDER: right first,
// then left, then middle. The right slot is right-anchored at content_w, the left slot
// left-anchored at 0, and the middle centred in the span between the visible edges
// (each edge separated from the middle by STATUS_ROW_ALLOC_GROUP_GAP). Every slot is
// clamped so its box never overruns content_w and never overlaps a neighbour.
//
// group_w[i]: slot i's desired width (icon + optional gap + text), 0 when empty.
// min_w[i]:   slot i's minimum renderable width (e.g. icon + ellipsis). A slot whose
//             available span is smaller than min_w[i] is DROPPED (draw_w[i] = 0, so the
//             caller draws nothing for it) and its space yields to lower-priority slots.
// Writes gx[i] (x from the content origin) and draw_w[i] (drawable width; a fitted-but-
// tight slot is clamped to its span so its text ellipsizes downstream; a dropped slot
// gets draw_w[i] = 0). Guarantees gx[i] >= 0 and gx[i] + draw_w[i] <= content_w for
// every slot.
void status_row_alloc(int content_w, const int group_w[3], const int min_w[3],
                      int gx[3], int draw_w[3]);
