#include "clock_ink.h"

#if defined(WW_CLOCK_INK)

#if defined(PBL_COLOR)
#include "clock_glyphs_ink.h"   // GENERATED: the anti-aliased strips' ink heights
#endif

// Out of line on purpose: main_window.c asks for this at two points (window_load and every
// render), and as a header inline the table was emitted at both. Not linked on aplite at all
// (WW_CLOCK_INK, see wscript). time_font is always in range (config.c normalises it at load).
//
// Two kinds of row, see clock_ink.h: MEASURED pairs for the 1-bit system fonts (LECO
// everywhere, and all three faces on the B/W 144px watches), and GENERATED ink heights for the
// anti-aliased strips (Roboto and Bitham on the colour screens), whose centre_off only places
// the band.
ClockInk clock_ink_for(int16_t time_font) {
    static const ClockInk k[] = {
#ifdef PBL_PLATFORM_EMERY
        // emery: Roboto and Bitham are strips.
        [TIME_FONT_ROBOTO] = {  2, CLOCK_GLYPHS_ROBOTO_INK_H },
        [TIME_FONT_LECO]   = {  2, 42 },
        [TIME_FONT_BITHAM] = {  2, CLOCK_GLYPHS_BITHAM_INK_H },
#else
        // 144px: basalt draws Roboto and Bitham from strips, diorite/flint from 1-bit fonts.
        [TIME_FONT_ROBOTO] = {  0, PBL_IF_COLOR_ELSE(CLOCK_GLYPHS_ROBOTO_INK_H, 35) },
        [TIME_FONT_LECO]   = { -1, 29 },
        [TIME_FONT_BITHAM] = { -2, PBL_IF_COLOR_ELSE(CLOCK_GLYPHS_BITHAM_INK_H, 31) },
#endif
    };
    return k[time_font];
}
#endif   /* WW_CLOCK_INK — aplite links none of this; see wscript */
