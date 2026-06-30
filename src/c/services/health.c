#include "health.h"

// This HealthService wrapper exists only on health-capable hardware. On
// platforms without PBL_HEALTH (e.g. aplite) there are no sensors and no
// callers — the health view that used these accessors is itself compiled out
// (see health_graph_layer.c / health_status_layer.c / main_window.c) — so the
// whole module drops out rather than shipping unreachable stubs.
#if defined(PBL_HEALTH)

#define HOUR_SECS 3600

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

/**
 * Sum the steps actually recorded in [h0, h1) from the minute-by-minute history.
 *
 * health_service_sum(HealthMetricStepCount, ...) can NOT be used for a sub-day
 * window: it returns the DAILY total weighted by the window length, so every
 * equal-length hour comes back identical (≈ today's steps / 24). Verified on
 * device — sum() reported 211 for all six trailing hours while the real counts
 * were 78/12/42/1562/721/12. The minute history holds the true per-minute
 * counts, so we sum the (up to 60) records that fall in the hour; an hour is
 * exactly 60 minutes, hence the 60-record buffer. Records flagged invalid are
 * skipped. Each minute's `steps` is a uint8, so a full hour maxes at 60*255 =
 * 15300, well within int16_t.
 *
 * @param h0 UTC start of the hour (inclusive).
 * @param h1 UTC end of the hour (exclusive).
 * @return Total steps recorded in the window.
 */
static int s_minute_steps(time_t h0, time_t h1) {
    /* Module scratch, not stack: 60 * sizeof(HealthMinuteData) is too large for
       the app stack (mirrors the layer modules' static-scratch convention). */
    static HealthMinuteData md[60];
    time_t   ts = h0, te = h1;
    uint32_t n   = health_service_get_minute_history(md, 60, &ts, &te);
    int      sum = 0;
    for (uint32_t k = 0; k < n; k++) {
        if (!md[k].is_invalid) {
            sum += md[k].steps;
        }
    }
    return sum;
}

void health_fill_hourly_steps(int16_t *out, int count, time_t end_hour) {
#if defined(PBL_HEALTH)
    for (int i = 0; i < count; i++) {
        time_t h1 = end_hour - (time_t)(count - 1 - i) * HOUR_SECS;
        time_t h0 = h1 - HOUR_SECS;
        out[i] = (int16_t)s_minute_steps(h0, h1);
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

/* Context for the sleep-activity iterator: the slot array to fill and the hour
   grid (end_hour = top of the most recent hour; slot i covers the hour ending
   at end_hour - (count-1-i) hours). */
typedef struct {
    uint8_t *state_out;
    int      count;
    time_t   end_hour;
} SleepFill;

/* Mark every visible hour that a sleep activity overlaps. RestfulSleep (deep)
   wins over Sleep (light) regardless of the order activities are delivered, so
   a deep stretch is never downgraded by a surrounding light-sleep interval. */
static bool s_sleep_activity_cb(HealthActivity activity,
                                time_t a_start, time_t a_end, void *context) {
    SleepFill    *f    = (SleepFill *)context;
    const uint8_t mark = (activity == HealthActivityRestfulSleep)
                             ? HEALTH_SLEEP_DEEP : HEALTH_SLEEP_LIGHT;
    for (int i = 0; i < f->count; i++) {
        time_t h1 = f->end_hour - (time_t)(f->count - 1 - i) * HOUR_SECS;
        time_t h0 = h1 - HOUR_SECS;
        if (a_start < h1 && a_end > h0) {   /* activity interval overlaps this hour */
            if (mark == HEALTH_SLEEP_DEEP || f->state_out[i] == HEALTH_SLEEP_AWAKE) {
                f->state_out[i] = mark;
            }
        }
    }
    return true;   /* keep iterating over the remaining activities */
}

void health_fill_hourly_sleep(uint8_t *state_out, int count, time_t end_hour) {
#if defined(PBL_HEALTH)
    /* Like steps, per-hour sleep can't come from health_service_sum (daily-
       weighted → identical every hour). Sleep has no per-minute field in the
       history API, so we read sleep ACTIVITIES — each is a [start,end] interval
       — and paint the hours they cover. */
    for (int i = 0; i < count; i++) { state_out[i] = HEALTH_SLEEP_AWAKE; }
    SleepFill f = { .state_out = state_out, .count = count, .end_hour = end_hour };
    health_service_activities_iterate(
        HealthActivitySleep | HealthActivityRestfulSleep,
        end_hour - (time_t)count * HOUR_SECS, end_hour,
        HealthIterationDirectionPast, s_sleep_activity_cb, &f);
#else
    for (int i = 0; i < count; i++) { state_out[i] = HEALTH_SLEEP_AWAKE; }
#endif
}

#endif  // PBL_HEALTH
