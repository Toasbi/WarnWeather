#include "clock_ink.h"
#include "clock_glyphs.h"

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
#if defined(PBL_COLOR)
    // The anti-aliased faces (clock_glyphs.h) draw from strips whose ink height is known
    // exactly rather than measured — the digits' union ink rows, which is what ink_h means.
    // centre_off keeps its measured value: time_layer.c seats the strip's first row with
    // clock_ink_top_in_band() from this same pair, so the digits land where the 1-bit face's
    // ink did and every band the solver computed for it still centres them. The two agree to
    // the row everywhere but 144px Roboto, whose strip inks 34 rows against the system font's
    // 35 — the solver sees the 34, so that clock is centred on its own ink too.
    if (clock_glyphs_face(time_font)) {
        ClockInk ink = k[time_font];
        ink.ink_h = clock_glyphs_ink_h(time_font);
        return ink;
    }
#endif
    return k[time_font];
}
#endif   /* WW_CLOCK_INK — aplite links none of this; see wscript */
