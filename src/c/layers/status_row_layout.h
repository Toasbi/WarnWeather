#pragma once

#include <stdbool.h>
#include <stdint.h>

#define STATUS_ROW_ICON_TEXT_GAP 3
#define STATUS_ROW_GROUP_GAP 4

typedef struct {
    bool present;
    int16_t icon_w;
    int16_t text_w;
} StatusSlotMeasure;

typedef struct {
    bool visible;
    bool text_visible;
    int16_t icon_x;
    int16_t text_x;
    int16_t text_w;
} StatusSlotPlace;

void status_row_layout(int16_t content_w, const StatusSlotMeasure m[3],
                       StatusSlotPlace out[3]);

// Vertical extent (top edge + height) of a slot's threshold-highlight box.
typedef struct {
    int16_t y;
    int16_t h;
} StatusHighlightExtent;

StatusHighlightExtent status_highlight_extent(int16_t band_top, int16_t band_h,
                                              int16_t cap_cy);
