#pragma once

#include <pebble.h>

// Exists only on health-capable hardware; aplite (no sensors) compiles the whole
// module and its call sites out, mirroring health.c / health_cache.c.
#if defined(PBL_HEALTH)

/**
 * Re-read the current health summary (steps / sleep / HR) shown in the status
 * row. Returns true iff a DISPLAYED value changed since the previous call —
 * sleep is compared at minute resolution because the row shows "%dh%02d", so
 * second-level jitter while asleep does not count as a change.
 *
 * Reads via the health.h accessors today; the sleep source can later become
 * nap-inclusive (summing sleep activities across the day) with no change to any
 * caller. Valid values are available only after this has been called once.
 *
 * @return true if steps, sleep-minutes, or HR differs from the last refresh.
 */
bool health_summary_refresh(void);

/** Steps recorded today. */
int health_summary_steps(void);

/** Sleep today, in seconds. */
int health_summary_sleep_seconds(void);

/** Most recent live heart rate in BPM (0 if none). */
int health_summary_hr_bpm(void);

#endif  // PBL_HEALTH
