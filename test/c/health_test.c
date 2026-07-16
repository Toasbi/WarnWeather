// Host tests for the HealthService wrapper's walked-distance accessors.
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
static MeasurementSystem s_units;
static HealthMetric s_access_metric;
static HealthMetric s_sum_metric;
static HealthMetric s_units_metric;
static int s_sum_calls;

static void expect_int(const char *name, int got, int want) {
    if (got != want) {
        printf("FAIL %s: got %d want %d\n", name, got, want);
        s_failures++;
    }
}

HealthValue health_service_sum_today(HealthMetric metric) {
    s_sum_metric = metric;
    s_sum_calls++;
    return s_sum;
}

HealthServiceAccessibilityMask health_service_metric_accessible(
        HealthMetric metric, time_t time_start, time_t time_end) {
    (void)time_start;
    (void)time_end;
    s_access_metric = metric;
    return s_access;
}

MeasurementSystem health_service_get_measurement_system_for_display(HealthMetric metric) {
    s_units_metric = metric;
    return s_units;
}

HealthValue health_service_peek_current_value(HealthMetric metric) {
    (void)metric;
    return 0;
}

HealthServiceAccessibilityMask health_service_metric_aggregate_averaged_accessible(
        HealthMetric metric, time_t time_start, time_t time_end,
        HealthAggregation aggregation, HealthServiceTimeScope scope) {
    (void)metric;
    (void)time_start;
    (void)time_end;
    (void)aggregation;
    (void)scope;
    return HealthServiceAccessibilityMaskNotAvailable;
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
    (void)callback;
    (void)context;
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

static void distance_units_delegate_to_sdk(void) {
    s_units = MeasurementSystemUnknown;
    expect_int("distance.units.unknown", health_distance_units(), MeasurementSystemUnknown);

    s_units = MeasurementSystemMetric;
    expect_int("distance.units.metric", health_distance_units(), MeasurementSystemMetric);

    s_units = MeasurementSystemImperial;
    expect_int("distance.units.imperial", health_distance_units(), MeasurementSystemImperial);
    expect_int("distance.units.sdk_metric", s_units_metric, HealthMetricWalkedDistanceMeters);
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
    accessible_distance_returns_today_sum();
    inaccessible_distance_returns_sentinel_without_sum();
    distance_units_delegate_to_sdk();
    health_minute_schema_fields_are_usable();
    if (s_failures) {
        printf("%d health failure(s)\n", s_failures);
        return 1;
    }
    printf("health OK\n");
    return 0;
}
