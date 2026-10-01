#pragma once

#include <stdbool.h>
#include <stdint.h>

#define STATUS_ROW_ICON_TEXT_GAP 3
#define STATUS_ROW_GROUP_GAP 4

typedef struct {
    bool present;
    int16_t icon_w;
    int16_t text_w;
    // Trailing glyph drawn AFTER the text (the wind-direction arrow); 0 = none. It
    // gets its own lane — icon | gap | text | gap | suffix — reserved off the budget
    // BEFORE the text is shrunk, so a squeezed slot ellipsizes its number and keeps
    // the glyph (an ellipsized reading still reads; a dropped arrow loses the point).
    int16_t suffix_w;
} StatusSlotMeasure;

typedef struct {
    bool visible;
    bool text_visible;
    int16_t icon_x;
    int16_t text_x;
    int16_t text_w;
    // Left edge of the suffix glyph. 0 when the slot has no suffix (never "the spot an
    // arrow would take"), so a caller can tell absent from placed without a second
    // lookup — a highlight box that reaches to the suffix must not widen plain slots.
    int16_t suffix_x;
} StatusSlotPlace;

void status_row_layout(int16_t content_w, const StatusSlotMeasure m[3],
                       StatusSlotPlace out[3]);

// Place ONE slot's group with its left edge at content x `x`, inside a budget of
// `max_w` px: the same fit (the text shrinks first, the suffix and the icon stay)
// and the same placement status_row_layout() gives each of its three slots, so a
// slot placed here is byte-compatible with one the row layout placed. Handing it a
// slot's width from status_row_layout() reproduces that slot's place exactly, at any
// x. The measure is non-negative (the row layout clamps its own; the On demand
// layout's are). Returns the group's width;
// 0 when the slot does not show, and `out` is then all zero. The On demand layout
// (appendix/on_demand.c) places its slots through this.
int16_t status_slot_place_at(const StatusSlotMeasure *m, int16_t x, int16_t max_w,
                             StatusSlotPlace *out);

// A placed slot's group width, the width its fit gave it: the icon, the gap + text
// while the text shows, then the suffix lane (whose gap goes with the text). 0 for a
// hidden slot. `m` is the non-negative measure the slot was laid out with. The same
// sum the row layout sizes its slots by, so status_slot_place_at()
// handed this width reproduces the slot. The On demand layout reads each slot's full
// width back through it.
int16_t status_slot_placed_w(const StatusSlotPlace *place, const StatusSlotMeasure *m);

// A placed slot's ink extent [lo, hi), content-relative like the place itself: from
// the group's left edge to its last ink — the suffix while the text shows (the arrow
// draws only with its reading), else the text's end, else the icon's. `m` is the
// measure the slot was laid out with. Meaningful for a visible slot only. The extent
// the threshold-highlight box is cut from.
void status_slot_ink(const StatusSlotPlace *place, const StatusSlotMeasure *m,
                     int16_t *lo, int16_t *hi);

// Vertical extent (top edge + height) of a slot's threshold-highlight box.
typedef struct {
    int16_t y;
    int16_t h;
} StatusHighlightExtent;

StatusHighlightExtent status_highlight_extent(int16_t band_top, int16_t band_h,
                                              int16_t cap_cy, int16_t content_h,
                                              bool top_strip, bool has_tail);

// True when the rendered slot text contains a descender glyph (g j p q y) — drives
// the box's conditional descender reserve.
bool status_text_has_descender(const char *text);
