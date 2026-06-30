#include "c/appendix/bottom_view.h"

#ifdef PBL_PLATFORM_EMERY
#define BV_TICK_SMALL_COLOR GColorDarkGray
#else
#define BV_TICK_SMALL_COLOR GColorLightGray
#endif

const TickSide BOTTOM_VIEW_TICK_STYLE = {
    .length = 4, .color = BV_TICK_SMALL_COLOR,
    .big_length = 6, .big_color = GColorLightGray,
};

// Latest reported content width per source; 0 = "this source has not reported".
static int s_reported_w[2] = { 0, 0 };

void bottom_view_report_label_w(BottomViewSrc src, int content_w) {
    if (content_w < 0) { content_w = 0; }
    s_reported_w[src] = content_w;
}

int bottom_view_label_strip_w(void) {
    int w = BOTTOM_VIEW_LABEL_STRIP_MIN_W;
    if (s_reported_w[BOTTOM_VIEW_SRC_FORECAST] > w) w = s_reported_w[BOTTOM_VIEW_SRC_FORECAST];
    if (s_reported_w[BOTTOM_VIEW_SRC_HEALTH]   > w) w = s_reported_w[BOTTOM_VIEW_SRC_HEALTH];
    return w;
}

int bottom_view_graph_inset(void) {
    return bottom_view_label_strip_w() + BOTTOM_VIEW_LABEL_GAP;
}
