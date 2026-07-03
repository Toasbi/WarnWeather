#include <string.h>

#include "rain_countdown.h"

// Screenshot/showcase twin of appendix/rain_countdown.c. Selected by the wscript ONLY
// for a fixture that declares a top-level "countdown" block (which injects
// WW_FIXTURE_COUNTDOWN_TEXT / _TIER), and never on aplite (which gc-sections the rain
// alert out of its 24 KB image). Where the real module derives the alert string from the
// persisted radar trend vs the wall clock — fragile to reproduce in a static, compile-
// time fixture (the upcoming-rain "in X" branch is gated on the look-ahead horizon and
// the radar/now anchor) — this returns the fixture's exact, pre-formatted string so a
// captured frame shows a deterministic "Rain in 15'" / "Drizzle in 15'" / "Rain for 20'"
// strip. Feature-frozen mirror of rain_countdown.h; hand-port interface changes.

void rain_countdown_refresh(time_t now) {
    (void) now;   // the string is fixed at compile time — nothing to rescan
}

bool rain_countdown_format(char *out, size_t out_size, time_t now) {
    (void) now;
#ifdef WW_FIXTURE_COUNTDOWN_TEXT
    strncpy(out, WW_FIXTURE_COUNTDOWN_TEXT, out_size);
    out[out_size - 1] = '\0';
    return true;
#else
    (void) out;
    (void) out_size;
    return false;
#endif
}

int rain_countdown_peak_tier(void) {
#ifdef WW_FIXTURE_COUNTDOWN_TIER
    return WW_FIXTURE_COUNTDOWN_TIER;
#else
    return 0;
#endif
}
