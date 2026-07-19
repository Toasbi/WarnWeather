// src/c/appendix/status_row_alloc.c
#include "status_row_alloc.h"

void status_row_alloc(int content_w, const int group_w[3], const int min_w[3],
                      int gx[3], int draw_w[3]) {
    // Priority order: right slot first, then left, then middle. A slot whose available
    // span is smaller than its minimum renderable width is dropped (draw_w = 0),
    // yielding its space to the lower-priority slots. No box overruns content_w.

    // Right: right-anchored at content_w (top priority).
    if (group_w[2] > 0 && content_w >= min_w[2]) {
        draw_w[2] = group_w[2] < content_w ? group_w[2] : content_w;
        gx[2] = content_w - draw_w[2];
    } else {
        draw_w[2] = 0;
        gx[2] = content_w;
    }

    // Left: left-anchored at 0, within the space to the left of the right slot.
    int left_avail = draw_w[2] ? gx[2] - STATUS_ROW_ALLOC_GROUP_GAP : content_w;
    if (left_avail < 0) { left_avail = 0; }
    gx[0] = 0;
    if (group_w[0] > 0 && left_avail >= min_w[0]) {
        draw_w[0] = group_w[0] < left_avail ? group_w[0] : left_avail;
    } else {
        draw_w[0] = 0;
    }

    // Middle: centred in the span between the visible left and right edges.
    int mid_lo = draw_w[0] ? draw_w[0] + STATUS_ROW_ALLOC_GROUP_GAP : 0;
    int mid_hi = draw_w[2] ? gx[2] - STATUS_ROW_ALLOC_GROUP_GAP : content_w;
    int mid_avail = mid_hi - mid_lo;
    if (mid_avail < 0) { mid_avail = 0; }
    if (group_w[1] > 0 && mid_avail >= min_w[1]) {
        draw_w[1] = group_w[1] < mid_avail ? group_w[1] : mid_avail;
        gx[1] = mid_lo + (mid_avail - draw_w[1]) / 2;
    } else {
        draw_w[1] = 0;
        gx[1] = mid_lo;
    }
}
