#include "c/appendix/bottom_view.h"
#include "c/appendix/config.h"

#ifdef PBL_PLATFORM_EMERY
#define BV_TICK_SMALL_COLOR GColorDarkGray
#else
#define BV_TICK_SMALL_COLOR GColorLightGray
#endif

// theme_furniture() flattens the gray to black in the (non-bw) light theme;
// theme_pick() swaps to theme_fg() outright in bw/bw-light. See bottom_view.h
// for why this must be a function, not a const.
TickSide bottom_view_tick_style(void) {
    return (TickSide){
        .length     = 4, .color     = theme_pick(theme_furniture(BV_TICK_SMALL_COLOR), theme_fg()),
        .big_length = 6, .big_color = theme_pick(theme_furniture(GColorLightGray),      theme_fg()),
    };
}

// See bottom_view.h. config_large_graph_font() is constant false off-emery (the only
// platform whose settings UI offers the toggle), so this folds to GOTHIC_18 there.
GFont bottom_view_label_font(void) {
    return fonts_get_system_font(config_large_graph_font() ? BOTTOM_VIEW_LABEL_FONT_KEY_LARGE
                                                           : BOTTOM_VIEW_LABEL_FONT_KEY);
}

// Latest reported content width per graph; 0 = "this graph has not reported".
static int s_reported_w[2] = { 0, 0 };

// Never called from an update proc: both reporters measure on their refresh paths and
// repaint themselves after (bottom_view.h).
void bottom_view_report_label_w(BottomViewSrc src, int content_w) {
    s_reported_w[src] = content_w < 0 ? 0 : content_w;
}

int bottom_view_label_strip_w(BottomViewSrc src) {
    const int w = s_reported_w[src];
    return w > BOTTOM_VIEW_LABEL_STRIP_MIN_W ? w : BOTTOM_VIEW_LABEL_STRIP_MIN_W;
}

int bottom_view_graph_inset(BottomViewSrc src) {
    return bottom_view_label_strip_w(src) + BOTTOM_VIEW_LABEL_GAP;
}
