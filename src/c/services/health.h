#pragma once

#include <pebble.h>

/* Sleep state constants for health_fill_hourly_sleep() */
#define HEALTH_SLEEP_AWAKE 0
#define HEALTH_SLEEP_LIGHT 1
#define HEALTH_SLEEP_DEEP  2

// These accessors exist only on health-capable platforms. Builds without
// PBL_HEALTH (e.g. aplite) have no sensors and compile the whole health
// feature out, so there is nothing to declare there.
#if defined(PBL_HEALTH)

/** Returns true if step-count health data is accessible right now. */
bool health_available(void);

/** Returns today's total step count, or 0 if unavailable. */
int health_steps_today(void);

/** Returns today's walked distance in meters, or -1 if unavailable. */
int health_distance_today_m(void);

/** Returns today's total sleep in seconds (last night, matching the phone
 *  Health app), or 0 if unavailable. */
int health_sleep_today_seconds(void);

/** Returns the most recent raw heart-rate sample in BPM, or 0 if unavailable. */
int health_hr_current(void);

/**
 * Fills `count` hourly step-count buckets.
 * out[0] = oldest hour, out[count-1] = the hour ending at end_hour.
 * Zeroes a bucket when no data is available for that hour.
 */
void health_fill_hourly_steps(int16_t *out, int count, time_t end_hour);

/**
 * Fills `count` hourly average-BPM buckets (0 if no data for that hour).
 * out[0] = oldest hour, out[count-1] = the hour ending at end_hour.
 */
void health_fill_hourly_hr(int16_t *out, int count, time_t end_hour);

/**
 * Fills `count` hourly sleep-state buckets with HEALTH_SLEEP_* values.
 * out[0] = oldest hour, out[count-1] = the hour ending at end_hour.
 */
void health_fill_hourly_sleep(uint8_t *state_out, int count, time_t end_hour);

#endif  // PBL_HEALTH
