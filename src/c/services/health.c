#include "health.h"

// This HealthService wrapper exists only on health-capable hardware. On
// platforms without PBL_HEALTH (e.g. aplite) there are no sensors and no
// callers — the health view that used these accessors is itself compiled out
// (see health_graph_layer.c / health_status_layer.c / main_window.c) — so the
// whole module drops out rather than shipping unreachable stubs.
#if defined(PBL_HEALTH)

#define HOUR_SECS 3600

/* An hour with fewer than 5 minutes of sleep data is classified AWAKE. */
#define SLEEP_HOUR_THRESHOLD 300

/**
 * Returns local midnight (start of today) as a time_t.
 * Uses struct tm + mktime — no floating point.
 */
static time_t s_start_of_today(void) {
    time_t now = time(NULL);
    struct tm *t = localtime(&now);
    t->tm_hour = 0;
    t->tm_min  = 0;
    t->tm_sec  = 0;
    return mktime(t);
}

bool health_available(void) {
    return PBL_IF_HEALTH_ELSE(
        (health_service_metric_accessible(HealthMetricStepCount,
            s_start_of_today(), time(NULL)) & HealthServiceAccessibilityMaskAvailable) != 0,
        false);
}

bool health_hr_available(void) {
    return PBL_IF_HEALTH_ELSE(
        (health_service_metric_accessible(HealthMetricHeartRateBPM,
            time(NULL) - HOUR_SECS, time(NULL)) & HealthServiceAccessibilityMaskAvailable) != 0,
        false);
}

int health_steps_today(void) {
    return PBL_IF_HEALTH_ELSE((int)health_service_sum_today(HealthMetricStepCount), 0);
}

int health_sleep_recent_seconds(void) {
    return PBL_IF_HEALTH_ELSE(
        (int)health_service_sum(HealthMetricSleepSeconds,
            time(NULL) - 24 * HOUR_SECS, time(NULL)),
        0);
}

int health_hr_current(void) {
    /* Guard on accessibility so non-HRM hardware (e.g. aplite) returns 0 cleanly. */
    return PBL_IF_HEALTH_ELSE(
        (health_service_metric_accessible(HealthMetricHeartRateBPM,
            time(NULL) - HOUR_SECS, time(NULL)) & HealthServiceAccessibilityMaskAvailable)
            ? (int)health_service_peek_current_value(HealthMetricHeartRateBPM)
            : 0,
        0);
}

void health_fill_hourly_steps(int16_t *out, int count, time_t end_hour) {
#if defined(PBL_HEALTH)
    for (int i = 0; i < count; i++) {
        time_t h1 = end_hour - (time_t)(count - 1 - i) * HOUR_SECS;
        time_t h0 = h1 - HOUR_SECS;
        out[i] = (int16_t)health_service_sum(HealthMetricStepCount, h0, h1);
    }
#else
    for (int i = 0; i < count; i++) { out[i] = 0; }
#endif
}

void health_fill_hourly_hr(int16_t *out, int count, time_t end_hour) {
#if defined(PBL_HEALTH)
    for (int i = 0; i < count; i++) {
        time_t h1 = end_hour - (time_t)(count - 1 - i) * HOUR_SECS;
        time_t h0 = h1 - HOUR_SECS;
        /* Check accessibility per slot — non-HRM platforms or sparse data yield 0. */
        if (health_service_metric_accessible(HealthMetricHeartRateBPM, h0, h1)
                & HealthServiceAccessibilityMaskAvailable) {
            out[i] = (int16_t)health_service_aggregate_averaged(
                HealthMetricHeartRateBPM, h0, h1,
                HealthAggregationAvg, HealthServiceTimeScopeOnce);
        } else {
            out[i] = 0;
        }
    }
#else
    for (int i = 0; i < count; i++) { out[i] = 0; }
#endif
}

void health_fill_hourly_sleep(uint8_t *state_out, int count, time_t end_hour) {
#if defined(PBL_HEALTH)
    for (int i = 0; i < count; i++) {
        time_t h1 = end_hour - (time_t)(count - 1 - i) * HOUR_SECS;
        time_t h0 = h1 - HOUR_SECS;
        int total   = (int)health_service_sum(HealthMetricSleepSeconds, h0, h1);
        int restful = (int)health_service_sum(HealthMetricSleepRestfulSeconds, h0, h1);
        if (total < SLEEP_HOUR_THRESHOLD) {
            state_out[i] = HEALTH_SLEEP_AWAKE;
        } else if (restful * 2 >= total) {
            /* restful >= half of total → deep sleep */
            state_out[i] = HEALTH_SLEEP_DEEP;
        } else {
            state_out[i] = HEALTH_SLEEP_LIGHT;
        }
    }
#else
    for (int i = 0; i < count; i++) { state_out[i] = HEALTH_SLEEP_AWAKE; }
#endif
}

#endif  // PBL_HEALTH
