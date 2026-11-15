#include "health_summary.h"

#include "c/services/health.h"

#if defined(PBL_HEALTH)

#include <limits.h>

// Held values (module .bss, no heap). INT_MIN sentinel guarantees the first
// read reports "changed" so the first paint always renders.
static int s_steps      = INT_MIN;
static int s_distance_m = INT_MIN;
static int s_sleep_sec  = INT_MIN;
static int s_hr         = INT_MIN;
// When sleep was last read (meaningless while s_sleep_sec is still INT_MIN).
static time_t s_sleep_read_at;
// The minute (now / 60) the readings in s_synced were read in.
static time_t s_synced_minute = -1;
static uint8_t s_synced;

// Re-read the readings in `kinds`; true iff one changed at display resolution.
static bool refresh(uint8_t kinds, time_t now) {
    bool changed = false;
    if (kinds & HEALTH_SUMMARY_STEPS) {
        const int steps = health_steps_today();
        if (steps != s_steps) { changed = true; }
        s_steps = steps;
    }
    if (kinds & HEALTH_SUMMARY_DISTANCE) {
        const int distance_m = health_distance_today_m();
        if ((distance_m < 0) != (s_distance_m < 0)
                || (distance_m >= 0 && distance_m / 100 != s_distance_m / 100)) {
            changed = true;
        }
        s_distance_m = distance_m;
    }
    // Sleep at minute resolution: the row shows "%dh%02d", so a change of a few
    // seconds within the same displayed minute must not force a relayout/redraw. A
    // clock set back reads at once rather than waiting for the old time to come round.
    if ((kinds & HEALTH_SUMMARY_SLEEP)
            && (s_sleep_sec == INT_MIN || now < s_sleep_read_at
                || now - s_sleep_read_at >= HEALTH_SUMMARY_SLEEP_PERIOD_S)) {
        const int sleep = health_sleep_today_seconds();
        if (sleep / 60 != s_sleep_sec / 60) { changed = true; }
        s_sleep_sec = sleep;
        s_sleep_read_at = now;
    }
    if (kinds & HEALTH_SUMMARY_HR) {
        const int hr = health_hr_current();
        if (hr != s_hr) { changed = true; }
        s_hr = hr;
    }
    return changed;
}

bool health_summary_sync(uint8_t shown, time_t now) {
    if (now / 60 != s_synced_minute) {
        s_synced_minute = now / 60;
        s_synced = 0;
    }
    const uint8_t fresh = shown & (uint8_t) ~s_synced;
    s_synced |= fresh;
    return fresh && refresh(fresh, now);
}

int health_summary_steps(void)         { return s_steps; }
int health_summary_distance_m(void) {
    return (s_distance_m == INT_MIN) ? -1 : s_distance_m;
}
int health_summary_sleep_seconds(void) { return s_sleep_sec; }
int health_summary_hr_bpm(void)        { return s_hr; }

#endif  // PBL_HEALTH
