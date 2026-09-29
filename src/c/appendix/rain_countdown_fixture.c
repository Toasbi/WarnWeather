#include <string.h>

#include "rain_countdown.h"
#include "c/appendix/persist.h"

// Screenshot/showcase twin of appendix/rain_countdown.c. Selected by the wscript ONLY
// for a fixture that declares a top-level "countdown" block (which injects
// WW_FIXTURE_COUNTDOWN_TEXT / _TIER), and never on aplite (which gc-sections the rain
// alert out of its 24 KB image). Where the real module derives the alert string from the
// persisted radar trend vs the wall clock — fragile to reproduce in a static, compile-
// time fixture (the upcoming-rain "in X" branch is gated on the look-ahead horizon and
// the radar/now anchor) — this returns the fixture's exact, pre-formatted string so a
// captured frame shows a deterministic rain entry in every alert row (status_row.c):
// the tier picks the drops and their colour, and the text is what the 'text' rain look
// prints — "Rain in 15'" / "Drizzle in 15'" / "Rain for 20'" — and what the 'minutes'
// look takes its minute token from. Feature-frozen mirror of rain_countdown.h;
// hand-port interface changes.
//
// The real module's on/off gate IS reproduced (rain_off): no entry while the horizon is
// 0 (the rain alert switched off, or radar off — clay-payload sends 0 for both) or the
// radar is snoozed, so a fixture's frame never contradicts its own settings. The
// minutes are canned, though: a window shorter than the fixture's minutes does not
// hide the entry.

// The real module's gate: rain_countdown_format()'s `horizon <= 0 || s_rc_snooze`,
// with the snooze latch read live (the twin has no refresh cache to hold it).
#if defined(WW_FIXTURE_COUNTDOWN_TEXT) || defined(WW_FIXTURE_COUNTDOWN_TIER)
static bool rain_off(void) {
    const int horizon = config_get() ? config_get()->rain_countdown_horizon_min : 0;
    return horizon <= 0 || persist_get_radar_snooze();
}
#endif

void rain_countdown_refresh(time_t now) {
    (void) now;   // the string is fixed at compile time — nothing to rescan
}

bool rain_countdown_format(char *out, size_t out_size, time_t now) {
    (void) now;
#ifdef WW_FIXTURE_COUNTDOWN_TEXT
    if (rain_off()) { return false; }
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
    if (rain_off()) { return 0; }
    return WW_FIXTURE_COUNTDOWN_TIER;
#else
    return 0;
#endif
}
