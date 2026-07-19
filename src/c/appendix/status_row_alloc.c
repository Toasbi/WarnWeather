// src/c/appendix/status_row_alloc.c
#include "status_row_alloc.h"

void status_row_alloc(int content_w, const int group_w[3], int gx[3], int draw_w[3]) {
    int lw = group_w[0], mw = group_w[1], rw = group_w[2];
    if (lw > content_w) { lw = content_w; }
    if (rw > content_w) { rw = content_w; }

    gx[0] = 0;
    draw_w[0] = lw;

    draw_w[2] = rw;
    gx[2] = content_w - rw;
    if (gx[2] < lw) { gx[2] = lw; }                  // never overlap the left edge

    int mid_lo = lw ? lw + STATUS_ROW_ALLOC_GROUP_GAP : 0;
    int mid_hi = rw ? gx[2] - STATUS_ROW_ALLOC_GROUP_GAP : content_w;
    int mid_avail = mid_hi - mid_lo;
    if (mid_avail < 0) { mid_avail = 0; }

    draw_w[1] = mw <= mid_avail ? mw : mid_avail;    // clamp -> ellipsis downstream
    gx[1] = mid_lo + (mid_avail - draw_w[1]) / 2;    // centre in the available span
}
