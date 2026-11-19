// Every include stays ABOVE the WW_THRESHOLD_HIGHLIGHT guard, on purpose: waf's
// dependency scanner does not evaluate -D macros, so an include inside the guard
// would be invisible to it (night_light.c records the failure). Including a header
// emits no code, so aplite still compiles this file to an empty object.
#include <pebble.h>
#include "status_highlight.h"
#include "../appendix/theme.h"

#if defined(WW_THRESHOLD_HIGHLIGHT)

// The drawable colour for a look's RAW accent byte. On effective B&W (real hardware
// or the bw/bw-light theme) the escalation is polarity, not hue: outline fg, fill fg
// (danger, or a warn look of fill — drawn solid, as picked). The user hues only apply
// on the colour path.
static GColor accent(uint8_t color8) {
#ifdef PBL_COLOR
    return theme_pick((GColor){ .argb = color8 }, theme_fg());
#else
    (void)color8;
    return theme_fg();
#endif
}

StatusPaint status_highlight_paint(GContext *ctx, GRect frame, ThreshLook look) {
    const StatusPaint plain = status_paint_theme();
    if (look.box == THRESH_BOX_NONE) { return plain; }
    GColor c = accent(look.color8);
    if (look.box == THRESH_BOX_FILL) {
        graphics_context_set_fill_color(ctx, c);
        graphics_fill_rect(ctx, frame, 2, GCornersAll);
    }
    graphics_context_set_stroke_color(ctx, c);
    graphics_draw_round_rect(ctx, frame, 2);
    // A filled cell flips its ink legible over the fill (the calendar's today
    // pattern); an outlined one keeps the foreground on the background inside it.
    if (look.box == THRESH_BOX_FILL) { return (StatusPaint){ gcolor_legible_over(c), c }; }
    return plain;
}

#endif
