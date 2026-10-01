#include "rain_countdown.h"
#include "c/appendix/persist.h"
#include "c/appendix/rain_tier.h"

// Screenshot/showcase twin of appendix/rain_countdown.c. Selected by the wscript ONLY
// for a fixture that declares a top-level "countdown" block (which injects
// WW_FIXTURE_COUNTDOWN_MINS / _RAINING / _TIER), and never on aplite (which gc-sections
// the rain alert out of its 24 KB image). Where the real module derives the alert from
// the persisted radar trend vs the wall clock — fragile to reproduce in a static,
// compile-time fixture (the upcoming-rain "in X" branch is gated on the look-ahead
// horizon and the radar/now anchor) — this returns the fixture's numbers, so a captured
// frame shows a deterministic Rain item (status_on_demand.c): the tier picks the drops,
// their colour and the noun, and the minutes and raining flag the rest of what each
// rain look prints — "Rain in 15'" / "15'" upcoming, "Rain for 20'" / "+20'" while it
// rains. Feature-frozen mirror of rain_countdown.h; hand-port interface changes.
//
// The real module's on/off gate IS reproduced (rain_off): no alert while the horizon is
// 0 (clay-payload sends 0 for radar mode off, and passes through a stored window of 0,
// which some showcase scenes set) or the radar is snoozed, so a fixture's frame never
// contradicts its own settings. Whether Rain is placed at all is its On demand cell,
// which status_on_demand.c reads, not this gate. The minutes are canned, though: a
// window shorter than the fixture's minutes does not hide the alert.

void rain_countdown_refresh(time_t now) {
    (void) now;   // the numbers are fixed at compile time — nothing to rescan
}

bool rain_countdown_get(RainCountdown *rc, time_t now) {
    (void) now;
#ifdef WW_FIXTURE_COUNTDOWN_MINS
    // The real module's gate: `horizon <= 0 || s_rc_snooze`, with the snooze latch
    // read live (the twin has no refresh cache to hold it).
    const int horizon = config_get() ? config_get()->rain_countdown_horizon_min : 0;
    if (horizon <= 0 || persist_get_radar_snooze()) { return false; }
    // The real module's bucket, clamped as there: a tier-0 fixture draws drizzle.
    const int bucket = rain_tier_to_bucket3(WW_FIXTURE_COUNTDOWN_TIER);
    rc->mins = WW_FIXTURE_COUNTDOWN_MINS;
    rc->raining = WW_FIXTURE_COUNTDOWN_RAINING;
    rc->tier = WW_FIXTURE_COUNTDOWN_TIER;
    rc->bucket = (uint8_t) (bucket < 1 ? 1 : bucket);
    return true;
#else
    (void) rc;
    return false;
#endif
}
