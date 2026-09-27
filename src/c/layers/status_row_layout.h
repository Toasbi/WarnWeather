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

// The width a slot asks for before any squeeze: icon | gap | text | gap | suffix,
// each gap collapsing when a side of it is empty (the suffix abuts the icon when
// there is no text). 0 for an absent slot, or one with neither icon nor text — a
// suffix never renders alone. This is the rule status_row_layout claims the edges
// by; the Alerts row's slot choice (alert_set_choose_slots) reuses it to size the
// slots it shares a row with, so the two can never drift.
int16_t status_slot_desired_w(const StatusSlotMeasure *m);

// Vertical extent (top edge + height) of a slot's threshold-highlight box.
typedef struct {
    int16_t y;
    int16_t h;
} StatusHighlightExtent;

StatusHighlightExtent status_highlight_extent(int16_t band_top, int16_t band_h,
                                              int16_t cap_cy, int16_t content_h,
                                              bool top_strip, bool has_tail);

// `e` (a status_highlight_extent result for the same band) grown by up to `pad` rows
// on each side, each side stopping at the band's top / its bottom limit (the strip's
// calendar floor on the top strip). The Alerts row's entry boxes use it for their
// 1-px vertical padding.
StatusHighlightExtent status_highlight_extent_pad(StatusHighlightExtent e,
                                                  int16_t band_top, int16_t band_h,
                                                  bool top_strip, int16_t pad);

// True when the rendered slot text contains a descender glyph (g j p q y) — drives
// the box's conditional descender reserve.
bool status_text_has_descender(const char *text);
