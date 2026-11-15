#pragma once

#include <pebble.h>

// Exists only on health-capable hardware; aplite (no sensors) compiles the whole
// module and its call sites out, mirroring health.c / health_cache.c.
#if defined(PBL_HEALTH)

// The readings a status slot can show, one bit each: what a row reports for its slots
// (status_row_live_health) and what health_summary_refresh reads.
#define HEALTH_SUMMARY_STEPS    0x01
#define HEALTH_SUMMARY_DISTANCE 0x02
#define HEALTH_SUMMARY_SLEEP    0x04
#define HEALTH_SUMMARY_HR       0x08

// Sleep is re-read at most this often. The firmware recomputes its sleep sessions only
// every 15 minutes, so a read each minute mostly repeats the last number; 5 minutes adds
// at most 5 minutes of lag to the total a slot shows.
#define HEALTH_SUMMARY_SLEEP_PERIOD_S 300

/**
 * Re-read the health readings in `kinds` (steps / distance / sleep / HR): the ones the
 * rows on screen show. The others keep the values they were last read at: each reading
 * is a HealthService read (services/health.c), so one no row shows is not read. Sleep is
 * read at most once per HEALTH_SUMMARY_SLEEP_PERIOD_S. Returns true iff a reading read
 * changed at DISPLAYED resolution — distance at 100 m, sleep at a minute, matching the
 * status-row formatting.
 *
 * Reads via the health.h accessors today; the sleep source can later become
 * nap-inclusive (summing sleep activities across the day) with no change to any
 * caller. A reading's value is valid only after it has been read once.
 *
 * @param kinds HEALTH_SUMMARY_* bits.
 * @param now   The current time (time(NULL)); paces the sleep read.
 * @return true if a reading read differs from its held value at display resolution.
 */
bool health_summary_refresh(uint8_t kinds, time_t now);

/** Steps recorded today. */
int health_summary_steps(void);

/** Walked distance today in meters, or -1 if unavailable or not yet refreshed. */
int health_summary_distance_m(void);

/** Sleep today, in seconds. */
int health_summary_sleep_seconds(void);

/** Most recent live heart rate in BPM (0 if none). */
int health_summary_hr_bpm(void);

#endif  // PBL_HEALTH
