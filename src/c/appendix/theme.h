#pragma once

// Theme accessors — dark=0 (default) / light=1 / bw=2 / bw-light=3 (Config.theme;
// see docs/superpowers/specs/2026-07-07-theme-inversion-design.md). Static-inline,
// header-only: no new .c file, no heap. Every accessor reads g_config->theme
// directly, so it's safe to call anywhere after config_load() has run.
//
// Two independent axes used throughout the C render sweep:
//  - Polarity: dark/bw are white-on-black; light/bw-light are black-on-white.
//    theme_fg()/theme_bg() give the polarity's foreground/background.
//  - Effective color: a watch renders "as color" only when the display IS color
//    AND theme isn't bw or bw-light. theme_pick()/theme_is_bw() encode that split
//    so a color build's bw/bw-light theme reuses the EXACT drawing path a real
//    B&W watch takes (in dark or light polarity respectively), and a B&W build
//    (aplite/diorite/flint) never pays for the color arm.
//
// bw-light is the light-polarity twin of bw: a stored bw-light reaching real B&W
// hardware renders as that hardware's Light theme (theme_is_light() alone decides
// polarity there — B&W hardware IS the bw drawing path already, see theme_is_bw()
// below), while on a color build it takes the bw draw path (theme_is_bw() true)
// with light-polarity fg/bg (theme_is_light() true).

#include <pebble.h>
#include "config.h"

/** True in the light theme (black-on-white polarity): light or bw-light. */
static inline bool theme_is_light(void) {
    return g_config->theme == 1 || g_config->theme == 3;
}

/** dark/bw polarity: white. light polarity: black. Default foreground. */
static inline GColor theme_fg(void) {
    return theme_is_light() ? GColorBlack : GColorWhite;
}

/** dark/bw polarity: black. light polarity: white. Window/panel background. */
static inline GColor theme_bg(void) {
    return theme_is_light() ? GColorWhite : GColorBlack;
}

/**
 * Chart-furniture gray (axis/tick/grid-line constants): light theme flattens
 * them to black (a midtone gray reads too close to a white background);
 * dark/bw keep the given gray unchanged.
 */
static inline GColor theme_furniture(GColor gray) {
    return theme_is_light() ? GColorBlack : gray;
}

#ifdef PBL_COLOR
/** True when this color build is rendering the Black & White theme (bw or bw-light). */
static inline bool theme_is_bw(void) {
    return g_config->theme == 2 || g_config->theme == 3;
}
/**
 * Effective-color pick: on a color build, a bw theme takes bw_arm (the exact
 * value a real B&W watch would use for this constant) at runtime; otherwise
 * color_arm renders. See theme_is_bw().
 */
static inline GColor theme_pick(GColor color_arm, GColor bw_arm) {
    return theme_is_bw() ? bw_arm : color_arm;
}
#else
// B&W hardware (aplite/diorite/flint) IS the bw drawing path already: theme_is_bw()
// is always true and theme_pick() always resolves to bw_arm. Macros (not inline
// functions) so color_arm is never even referenced on these builds — no color
// GColor8 constant, no branch, in the aplite image.
#define theme_is_bw() true
#define theme_pick(color_arm, bw_arm) (bw_arm)
#endif
