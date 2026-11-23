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

/** Returns true once step-count health data is accessible; the first true is
 *  latched for the app's life (health.c). */
bool health_available(void);

/** Returns today's total step count, or 0 if unavailable. */
int health_steps_today(void);

/** Returns today's walked distance in meters, or -1 while unavailable (the first yes
 *  is latched for the app's life, like health_available's: health.c). */
int health_distance_today_m(void);

/** Returns today's total sleep in seconds (last night, matching the phone
 *  Health app), or 0 if unavailable. */
int health_sleep_today_seconds(void);

/** Returns the most recent raw heart-rate sample in BPM, or 0 if unavailable. */
int health_hr_current(void);

/** One hour of minute records: what an hourly step or heart-rate read asks the firmware for. */
#define HEALTH_MINUTE_RECORDS 60

/**
 * Hands the hourly step and heart-rate reads their record buffer, HEALTH_MINUTE_RECORDS
 * long (720 B: too large for the app stack). Each read fills it and consumes it within its
 * own call, so the caller may lend a block that other passes use between reads
 * (layers/paint_scratch.h). Call it before the first hourly read.
 */
void health_set_minute_scratch(HealthMinuteData *records);

/**
 * Fills `count` hourly buckets from one minute-history read per hour: steps[i] the
 * hour's step count, and for the first `hr_count` hours (hr_count <= count) hr[i] its
 * average BPM. [0] = oldest hour, [count-1] = the hour ending at end_hour. A bucket
 * with no data for its hour reads 0.
 */
void health_fill_hourly(int16_t *steps, int16_t *hr, int count, int hr_count,
                        time_t end_hour);

/**
 * Fills `count` hourly sleep-state buckets with HEALTH_SLEEP_* values.
 * out[0] = oldest hour, out[count-1] = the hour ending at end_hour.
 * All awake when the heap cannot spare the firmware's 2 KB health cache for
 * the read (health.c).
 */
void health_fill_hourly_sleep(uint8_t *state_out, int count, time_t end_hour);

#endif  // PBL_HEALTH
