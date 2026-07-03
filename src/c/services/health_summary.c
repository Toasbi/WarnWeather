#include "health_summary.h"

#include "c/services/health.h"

#if defined(PBL_HEALTH)

#include <limits.h>

// Held values (module .bss, no heap). INT_MIN sentinel guarantees the first
// refresh reports "changed" so the first paint always renders.
static int s_steps     = INT_MIN;
static int s_sleep_sec = INT_MIN;
static int s_hr        = INT_MIN;

bool health_summary_refresh(void) {
    int steps = health_steps_today();
    int sleep = health_sleep_today_seconds();
    int hr    = health_hr_current();

    // Sleep at minute resolution: the row shows "%dh%02d", so a change of a few
    // seconds within the same displayed minute must not force a relayout/redraw.
    bool changed = (steps != s_steps)
                || (sleep / 60 != s_sleep_sec / 60)
                || (hr != s_hr);

    s_steps     = steps;
    s_sleep_sec = sleep;
    s_hr        = hr;
    return changed;
}

int health_summary_steps(void)         { return s_steps; }
int health_summary_sleep_seconds(void) { return s_sleep_sec; }
int health_summary_hr_bpm(void)        { return s_hr; }

#endif  // PBL_HEALTH
