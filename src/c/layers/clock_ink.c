#include "clock_ink.h"

#if defined(WW_CLOCK_INK)

// Out of line on purpose: main_window.c asks for this at two points (window_load and every
// render), and as a header inline the table plus its clamp were emitted at both. Not linked on
// aplite at all (WW_CLOCK_INK, see wscript).
ClockInk clock_ink_for(int16_t time_font) {
    // Same clamp config_time_font() applies, so a corrupt persisted value seats the font that
    // will actually be rendered rather than reading past the table.
    if (time_font < 0 || time_font > TIME_FONT_BITHAM) { time_font = TIME_FONT_ROBOTO; }
    static const ClockInk k[] = {
#ifdef PBL_PLATFORM_EMERY
        [TIME_FONT_ROBOTO] = {  2, 46 },
        [TIME_FONT_LECO]   = {  2, 42 },
        [TIME_FONT_BITHAM] = {  2, 45 },
#else
        [TIME_FONT_ROBOTO] = {  0, 35 },
        [TIME_FONT_LECO]   = { -1, 29 },
        [TIME_FONT_BITHAM] = { -2, 31 },
#endif
    };
    return k[time_font];
}
#endif   /* WW_CLOCK_INK — aplite links none of this; see wscript */
