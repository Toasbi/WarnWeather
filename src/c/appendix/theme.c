// The theme accessors, out of line (theme.h says why). Every include stays above the
// guard: waf's dependency scanner does not evaluate -D macros (see night_light.c),
// and including a header emits no code, so aplite, which lacks WW_THEME_POLARITY and
// keeps the header's constant-folding inlines, compiles this file to an empty object.
#include <pebble.h>
#include "theme.h"

#if defined(WW_THEME_POLARITY)

bool theme_is_light(void) {
    return config_get()->theme == 1 || config_get()->theme == 3;
}

GColor theme_fg(void) {
    return theme_is_light() ? GColorBlack : GColorWhite;
}

GColor theme_bg(void) {
    return theme_is_light() ? GColorWhite : GColorBlack;
}

GColor theme_furniture(GColor gray) {
    return theme_is_light() ? GColorBlack : gray;
}

#ifdef PBL_COLOR
bool theme_is_bw(void) {
    return config_get()->theme == 2 || config_get()->theme == 3;
}

GColor theme_pick(GColor color_arm, GColor bw_arm) {
    return theme_is_bw() ? bw_arm : color_arm;
}
#endif

#endif
