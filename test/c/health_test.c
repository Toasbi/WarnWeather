// Host tests for the HealthService wrapper's walked-distance accessors.
#include <stdio.h>

#include "c/services/health.h"

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

int main(void) {
    accessible_distance_returns_today_sum();
    inaccessible_distance_returns_sentinel_without_sum();
    distance_units_delegate_to_sdk();
    if (s_failures) {
        printf("%d health failure(s)\n", s_failures);
        return 1;
    }
    printf("health OK\n");
    return 0;
}
