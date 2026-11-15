#pragma once

#include <stdbool.h>
#include <stdint.h>

#define STATUS_ROW_ICON_TEXT_GAP 3
// The least air between two slots of a row: between the middle and each edge slot, and
// between the two edge slots where they share the row. Twice the icon-to-text gap, so
// every slot reads as its own group (at 4 px, one more than that gap, a crowded row ran
// its slots together). The settings page's copy is preview-watch.js GROUP_GAP. Only the
// On demand host suites set it, to the 4 px their fixtures were laid out at
// (scripts/test-c.sh); the watch build never does.
#ifndef STATUS_ROW_GROUP_GAP
#define STATUS_ROW_GROUP_GAP 6
#endif

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

// A slot that brought its own short form (the weather condition: "Partly cloudy" with
// "PCLDY") draws that form wherever the plain row would cut or hide a text. An edge slot's
// whole name claims its width before the middle's (status_row_layout), so it gives way
// whenever any text is cut: it shows beside an empty or a short middle and never squeezes
// the middle's. The edges swap first, the wider name first, then the middle where its own
// text is cut, each swap laid out again. `alt_w[i]` is the text width of slot i's short
// form, negative when it brought none; a slot that swaps takes it as its text width in `m`.
// `plain` holds the last layout, and is left as it was when no slot brought a form. Returns
// the slots that swapped, bit i for slot i. status_row.c draws with it, and the settings
// page's copy (preview-watch.js swapShortForms) is held to it by
// scripts/check-row-swap-lockstep.js.
uint8_t status_row_swap_short_forms(int16_t content_w, StatusSlotMeasure m[3],
                                    const int16_t alt_w[3], StatusSlotPlace plain[3]);

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

// A group's width for a normalized (non-negative) icon, text and suffix: the icon,
// the gap + text while there is text (no gap without an icon), then the suffix lane
// (the suffix plus its gap while there is text).
int16_t status_group_w(int16_t icon_w, int16_t text_w, int16_t suffix_w);

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
