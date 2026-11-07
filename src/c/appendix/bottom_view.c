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
    return fonts_get_system_font(config_large_graph_font() ? FONT_KEY_GOTHIC_24
                                                           : FONT_KEY_GOTHIC_18);
}

// Latest reported content width per source; 0 = "this source has not reported".
static int s_reported_w[2] = { 0, 0 };

#if defined(PBL_HEALTH)
// The registered strip-width consumers (see bottom_view.h): at most the two
// bottom-region graph roots, so a fixed two-slot registry suffices. Compiled out
// with the health graph — see the header for why aplite needs none of this.
#define BOTTOM_VIEW_MAX_CONSUMERS 2
static Layer *s_consumers[BOTTOM_VIEW_MAX_CONSUMERS];

void bottom_view_register_consumer(Layer *layer) {
    for (int i = 0; i < BOTTOM_VIEW_MAX_CONSUMERS; i++) {
        if (s_consumers[i] == layer) { return; }
    }
    for (int i = 0; i < BOTTOM_VIEW_MAX_CONSUMERS; i++) {
        if (!s_consumers[i]) { s_consumers[i] = layer; return; }
    }
}

void bottom_view_unregister_consumer(Layer *layer) {
    for (int i = 0; i < BOTTOM_VIEW_MAX_CONSUMERS; i++) {
        if (s_consumers[i] == layer) { s_consumers[i] = NULL; }
    }
}
#endif

// Bracket the store with the max: only the EFFECTIVE width matters (see
// bottom_view.h for why this source's own delta is the wrong signal). Never
// called from an update proc — both reporters measure on their refresh paths —
// so the mark_dirty cannot recurse into a draw.
void bottom_view_report_label_w(BottomViewSrc src, int content_w) {
    if (content_w < 0) { content_w = 0; }
    const int before = bottom_view_label_strip_w();
    s_reported_w[src] = content_w;
    if (bottom_view_label_strip_w() != before) {
#if defined(PBL_HEALTH)
        for (int i = 0; i < BOTTOM_VIEW_MAX_CONSUMERS; i++) {
            if (s_consumers[i]) { layer_mark_dirty(s_consumers[i]); }
        }
#endif
    }
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
