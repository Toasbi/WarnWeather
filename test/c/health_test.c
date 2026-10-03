// Host tests for the HealthService wrapper (services/health.c).
#include <stdio.h>

#include "c/services/health.h"

// SDK 4.17 schema guards that do not assume a host compiler's bitfield ABI.
_Static_assert(sizeof(((HealthMinuteData *)0)->reserved) == 6,
               "SDK 4.17 HealthMinuteData reserved width drift");
_Static_assert(HealthMetricStepCount == 0
                   && HealthMetricActiveSeconds == 1
                   && HealthMetricWalkedDistanceMeters == 2
                   && HealthMetricSleepSeconds == 3
                   && HealthMetricSleepRestfulSeconds == 4
                   && HealthMetricRestingKCalories == 5
                   && HealthMetricActiveKCalories == 6
                   && HealthMetricHeartRateBPM == 7
                   && HealthMetricHeartRateRawBPM == 8,
               "SDK 4.17 HealthMetric values drift");
_Static_assert(HealthServiceAccessibilityMaskAvailable == 1
                   && HealthServiceAccessibilityMaskNoPermission == 2
                   && HealthServiceAccessibilityMaskNotSupported == 4
                   && HealthServiceAccessibilityMaskNotAvailable == 8,
               "SDK 4.17 HealthServiceAccessibilityMask values drift");
_Static_assert(HealthAggregationSum == 0
                   && HealthAggregationAvg == 1
                   && HealthAggregationMin == 2
                   && HealthAggregationMax == 3,
               "SDK 4.17 HealthAggregation values drift");
_Static_assert(HealthServiceTimeScopeOnce == 0
                   && HealthServiceTimeScopeWeekly == 1
                   && HealthServiceTimeScopeDailyWeekdayOrWeekend == 2
                   && HealthServiceTimeScopeDaily == 3,
               "SDK 4.17 HealthServiceTimeScope values drift");
_Static_assert(HealthActivityNone == 0
                   && HealthActivitySleep == 1
                   && HealthActivityRestfulSleep == 2
                   && HealthActivityWalk == 4
                   && HealthActivityRun == 8
                   && HealthActivityOpenWorkout == 16
                   && HealthActivityMaskAll == 31,
               "SDK 4.17 HealthActivity values drift");
_Static_assert(HealthIterationDirectionPast == 0 && HealthIterationDirectionFuture == 1,
               "SDK 4.17 HealthIterationDirection values drift");
_Static_assert(MeasurementSystemUnknown == 0
                   && MeasurementSystemMetric == 1
                   && MeasurementSystemImperial == 2,
               "SDK 4.17 MeasurementSystem values drift");
_Static_assert(AmbientLightLevelUnknown == 0
                   && AmbientLightLevelVeryDark == 1
                   && AmbientLightLevelDark == 2
                   && AmbientLightLevelLight == 3
                   && AmbientLightLevelVeryLight == 4,
               "SDK 4.17 AmbientLightLevel values drift");

static int s_failures;
static HealthServiceAccessibilityMask s_access;
static HealthValue s_sum;
static HealthMetric s_access_metric;
static HealthMetric s_sum_metric;
static int s_sum_calls;
static int s_step_access_calls;
static HealthServiceAccessibilityMask s_hr_access = HealthServiceAccessibilityMaskNotAvailable;
static HealthValue s_peek;
static int s_peek_calls;
static int s_iterate_calls;
static time_t s_sleep_start;
static time_t s_sleep_end;

// The firmware's HealthServiceCache as PebbleOS applib/health_service.c keeps it: the
// sum, peek and iterate calls allocate it when there is none, and only an events
// unsubscribe frees it.
static bool s_cache_held;
static int s_unsubscribe_calls;

static void expect_int(const char *name, int got, int want) {
    if (got != want) {
        printf("FAIL %s: got %d want %d\n", name, got, want);
        s_failures++;
    }
}

bool health_service_events_unsubscribe(void) {
    s_unsubscribe_calls++;
    s_cache_held = false;
    return true;
}

HealthValue health_service_sum_today(HealthMetric metric) {
    s_cache_held = true;
    s_sum_metric = metric;
    s_sum_calls++;
    return s_sum;
}

HealthServiceAccessibilityMask health_service_metric_accessible(
        HealthMetric metric, time_t time_start, time_t time_end) {
    (void)time_start;
    (void)time_end;
    s_access_metric = metric;
    if (metric == HealthMetricStepCount) { s_step_access_calls++; }
    return s_access;
}

HealthValue health_service_peek_current_value(HealthMetric metric) {
    (void)metric;
    s_cache_held = true;
    s_peek_calls++;
    return s_peek;
}

HealthServiceAccessibilityMask health_service_metric_aggregate_averaged_accessible(
        HealthMetric metric, time_t time_start, time_t time_end,
        HealthAggregation aggregation, HealthServiceTimeScope scope) {
    (void)metric;
    (void)time_start;
    (void)time_end;
    (void)aggregation;
    (void)scope;
    return s_hr_access;
}

uint32_t health_service_get_minute_history(HealthMinuteData *minute_data,
                                            uint32_t max_records,
                                            time_t *time_start,
                                            time_t *time_end) {
    (void)minute_data;
    (void)max_records;
    (void)time_start;
    (void)time_end;
    return 0;
}

void health_service_activities_iterate(HealthActivityMask activity_mask,
                                       time_t time_start,
                                       time_t time_end,
                                       HealthIterationDirection direction,
                                       HealthActivityIteratorCB callback,
                                       void *context) {
    (void)activity_mask;
    (void)time_start;
    (void)time_end;
    (void)direction;
    s_cache_held = true;
    s_iterate_calls++;
    // One restful-sleep session; the callback runs while the cache is held.
    callback(HealthActivityRestfulSleep, s_sleep_start, s_sleep_end, context);
    expect_int("iterate.cache_held_during_callback", s_cache_held, true);
}

// health_available() asks the firmware until its first yes and keeps that yes
// without asking again: with the cache freed after every read, each ask reads the
// step history from the activity settings file, and main_window.c asks on every
// minute tick, flick and settings apply.
static void availability_is_latched_at_the_first_yes(void) {
    s_step_access_calls = 0;
    s_access = HealthServiceAccessibilityMaskNotAvailable;
    expect_int("available.no.value", health_available(), false);
    expect_int("available.no.again", health_available(), false);
    expect_int("available.no.asks", s_step_access_calls, 2);

    s_access = HealthServiceAccessibilityMaskAvailable;
    expect_int("available.yes.value", health_available(), true);
    expect_int("available.yes.again", health_available(), true);
    expect_int("available.yes.asks", s_step_access_calls, 3);

    s_access = HealthServiceAccessibilityMaskNotAvailable;
    expect_int("available.latched.value", health_available(), true);
    expect_int("available.latched.asks", s_step_access_calls, 3);
    expect_int("available.latched.held", s_cache_held, false);
}

// Each read that makes the firmware allocate its cache frees it again before it
// returns, and still returns what the service answered.
static void each_read_frees_the_firmware_cache(void) {
    s_access = HealthServiceAccessibilityMaskAvailable;
    s_hr_access = HealthServiceAccessibilityMaskAvailable;
    s_sum = 1234;
    s_peek = 72;
    s_sum_calls = 0;
    s_peek_calls = 0;
    s_unsubscribe_calls = 0;

    expect_int("release.steps.value", health_steps_today(), 1234);
    expect_int("release.steps.held", s_cache_held, false);
    expect_int("release.distance.value", health_distance_today_m(), 1234);
    expect_int("release.distance.held", s_cache_held, false);
    expect_int("release.sleep.value", health_sleep_today_seconds(), 1234);
    expect_int("release.sleep.held", s_cache_held, false);
    expect_int("release.hr.value", health_hr_current(), 72);
    expect_int("release.hr.held", s_cache_held, false);
    expect_int("release.sum_calls", s_sum_calls, 3);
    expect_int("release.peek_calls", s_peek_calls, 1);
    expect_int("release.unsubscribe_calls", s_unsubscribe_calls, 4);
    s_hr_access = HealthServiceAccessibilityMaskNotAvailable;
}

// The sleep fill marks the hours its session covers and frees the cache after the
// iterate; with no HRM the peek is skipped and the HR reads 0.
static void sleep_fill_frees_the_firmware_cache(void) {
    const time_t end_hour = 100 * 3600;      // slot 3 = the hour ending here
    uint8_t state[4] = { 9, 9, 9, 9 };
    s_sleep_start = end_hour - 3 * 3600 + 600;   // inside slot 1 ...
    s_sleep_end   = end_hour - 2 * 3600 + 60;    // ... to just into slot 2
    s_iterate_calls = 0;

    health_fill_hourly_sleep(state, 4, end_hour);
    expect_int("sleep_fill.iterate_calls", s_iterate_calls, 1);
    expect_int("sleep_fill.held", s_cache_held, false);
    expect_int("sleep_fill.slot0", state[0], HEALTH_SLEEP_AWAKE);
    expect_int("sleep_fill.slot1", state[1], HEALTH_SLEEP_DEEP);
    expect_int("sleep_fill.slot2", state[2], HEALTH_SLEEP_DEEP);
    expect_int("sleep_fill.slot3", state[3], HEALTH_SLEEP_AWAKE);

    s_peek_calls = 0;
    expect_int("hr_absent.value", health_hr_current(), 0);
    expect_int("hr_absent.peek_calls", s_peek_calls, 0);
    expect_int("hr_absent.held", s_cache_held, false);
}

static void accessible_distance_returns_today_sum(void) {
    s_access = HealthServiceAccessibilityMaskAvailable;
    s_sum = 4321;
    s_sum_calls = 0;

    expect_int("distance.available.value", health_distance_today_m(), 4321);
    expect_int("distance.available.access_metric", s_access_metric,
               HealthMetricWalkedDistanceMeters);
    expect_int("distance.available.sum_metric", s_sum_metric,
               HealthMetricWalkedDistanceMeters);
    expect_int("distance.available.sum_calls", s_sum_calls, 1);
}

static void inaccessible_distance_returns_sentinel_without_sum(void) {
    s_access = HealthServiceAccessibilityMaskNoPermission;
    s_sum_calls = 0;

    expect_int("distance.inaccessible.value", health_distance_today_m(), -1);
    expect_int("distance.inaccessible.metric", s_access_metric,
               HealthMetricWalkedDistanceMeters);
    expect_int("distance.inaccessible.sum_calls", s_sum_calls, 0);
}

static void health_minute_schema_fields_are_usable(void) {
    HealthMinuteData minute = {0};
    minute.steps = 1;
    minute.orientation = 2;
    minute.vmc = 3;
    minute.is_invalid = true;
    minute.light = AmbientLightLevelLight;
    minute.padding = 15;
    minute.heart_rate_bpm = 80;
    minute.reserved[5] = 6;

    expect_int("minute.steps", minute.steps, 1);
    expect_int("minute.orientation", minute.orientation, 2);
    expect_int("minute.vmc", minute.vmc, 3);
    expect_int("minute.invalid", minute.is_invalid, true);
    expect_int("minute.light", minute.light, AmbientLightLevelLight);
    expect_int("minute.padding", minute.padding, 15);
    expect_int("minute.heart_rate", minute.heart_rate_bpm, 80);
    expect_int("minute.reserved", minute.reserved[5], 6);
}

int main(void) {
    availability_is_latched_at_the_first_yes();
    accessible_distance_returns_today_sum();
    inaccessible_distance_returns_sentinel_without_sum();
    health_minute_schema_fields_are_usable();
    each_read_frees_the_firmware_cache();
    sleep_fill_frees_the_firmware_cache();
    if (s_failures) {
        printf("%d health failure(s)\n", s_failures);
        return 1;
    }
    printf("health OK\n");
    return 0;
}
