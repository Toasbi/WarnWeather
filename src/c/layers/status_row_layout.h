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
