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

/* The firmware's HealthServiceCache is 2 KB of THIS app's heap. Every
   health_service_sum* / peek / activities_iterate call that finds none allocates it
   (PebbleOS applib/health_service.c, prv_get_state(true)), and nothing but an
   events unsubscribe or the app's exit frees it. On a 64 KB watch that is the room
   the paints' transient allocations need. The face subscribes to no health events,
   so health_service_events_unsubscribe() only frees the cache (the event service
   returns early for a handler it never subscribed). Each read below that allocates
   it calls this before returning, so the cache lives for that one read: the ONE
   place the face lets go of it.
   The values do not change. activities_iterate, the one call that needs the cache,
   has it for its whole run. Otherwise the firmware keeps only a copy of the 30-day
   step history there, and two calls here used that copy: the steps sum and
   health_available()'s StepCount accessibility check. Without it, each reads the
   history from the activity settings file (open, look the record up, close), as
   the distance and sleep sums always do. health_available() latches its first yes,
   so it stops reading after that; the steps sum reads the file once per summary
   refresh, the fourth such read there next to the distance check and the distance
   and sleep sums. When the heap cannot spare 2 KB at that moment the firmware goes
   without: the sums and the peek still answer, and the sleep iterate reports
   nothing (health_fill_hourly_sleep). */
static void health_release_service_cache(void) {
    health_service_events_unsubscribe();
}

/** health_service_sum_today(metric), with the firmware's cache freed again. Out of
    line: the three sums share one copy (16 B less on basalt than inlined). */
__attribute__((noinline)) static int sum_today(HealthMetric metric) {
    const int v = (int)health_service_sum_today(metric);
    health_release_service_cache();
    return v;
}

/* The firmware answers from activity_is_initialized(), set once at its own boot and
   never cleared, and today's entry of the 30-day step history, which costs an
   activity settings file read whenever its cache holds no copy of that history
   (health_release_service_cache). While the firmware held its cache, every call
   after the first was answered from that copy, so the answer stayed yes (bar a no
   at exactly 00:00:00, when the range from midnight to now is empty). The latch
   keeps that yes for the app's life without the read: while health is on,
   main_window.c asks through health_renderable() twice per minute tick (on emery once
   more while the Heart rate item is placed), about four times per flick and about
   five times per settings apply. A no is asked again on the next call. */
bool health_available(void) {
    static bool s_available;
    if (!s_available) {
        s_available = (health_service_metric_accessible(HealthMetricStepCount,
            s_start_of_today(), time(NULL)) & HealthServiceAccessibilityMaskAvailable) != 0;
    }
    return s_available;
}

int health_steps_today(void) {
    return sum_today(HealthMetricStepCount);
}

int health_distance_today_m(void) {
    const time_t start = s_start_of_today();
    const time_t end = time(NULL);
    HealthServiceAccessibilityMask access = health_service_metric_accessible(
        HealthMetricWalkedDistanceMeters, start, end);
    if (!(access & HealthServiceAccessibilityMaskAvailable)) {
        return -1;
    }
    return sum_today(HealthMetricWalkedDistanceMeters);
}

int health_sleep_today_seconds(void) {
    /* Use health_service_sum_today, NOT health_service_sum over a trailing 24 h
       window: that window straddles midnight, and health_service_sum daily-
       weights each day it overlaps, blending YESTERDAY's sleep into the total.
       Verified on device — the trailing-24h sum read 11h00 while last night was
       6h53; sum_today (like the phone Health app) reports 6h53. This mirrors the
       same daily-weighting trap that drove the per-hour graph onto
       activities_iterate (see health_fill_hourly_sleep). */
    return sum_today(HealthMetricSleepSeconds);
}

int health_hr_current(void) {
    /* Peek the RAW metric (the most recent sample) rather than
       HealthMetricHeartRateBPM: the latter is a *filtered* value "at most 15 min
       old", so in idle — when the firmware samples the HRM infrequently — the
       status row and the graph's in-progress bar showed a stale aggregate that
       only changed roughly hourly. Raw reflects what the watch last actually
       measured. We deliberately do NOT request a shorter sample period
       (health_service_set_heart_rate_sample_period), so freshness still tracks
       the firmware's own idle cadence and there is no extra HRM battery cost.

       Gate the peek with health_service_metric_aggregate_averaged_accessible at
       the instant `now`, NOT health_service_metric_accessible: the latter only
       reports whether health_service_sum() works over a time *span*, and the raw
       HR metric can't be summed over a span, so it answered "not available" and
       the row stayed stuck at "--" on real HRM hardware. peek_current_value() is
       documented as equivalent to health_service_aggregate_averaged(metric, now,
       now, Avg, Once), so this is its matching accessibility probe (the exact
       pattern the SDK header shows). Non-HRM hardware still returns 0 cleanly. */
    time_t now = time(NULL);
    const int bpm = (health_service_metric_aggregate_averaged_accessible(
        HealthMetricHeartRateRawBPM, now, now, HealthAggregationAvg, HealthServiceTimeScopeOnce)
        & HealthServiceAccessibilityMaskAvailable)
        ? (int)health_service_peek_current_value(HealthMetricHeartRateRawBPM)
        : 0;
    health_release_service_cache();
    return bpm;
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
 * CRITICAL: health_service_get_minute_history REWRITES *time_start to the first
 * second of the first record it actually returns, and for a window that predates
 * the available minute history it clamps to the OLDEST available records rather
 * than returning none (verified on device — every hour before the watch was put
 * on came back with the same oldest 60-minute window, ~12 phantom steps each).
 * The records are consecutive minutes from the returned `ts`, so record k covers
 * [ts + k*60, +60); we count only those whose minute actually falls in [h0, h1).
 * A clamped / non-overlapping window then correctly contributes 0.
 *
 * @param h0 UTC start of the hour (inclusive).
 * @param h1 UTC end of the hour (exclusive).
 * @return Total steps recorded in the window.
 */
/* Shared minute-history scratch. Module .bss, not stack: 60 *
   sizeof(HealthMinuteData) is too large for the app stack (mirrors the layer
   modules' static-scratch convention). One buffer serves both readers below —
   they run serialized on the single event loop and consume the records within
   their own call. */
static HealthMinuteData s_minute_data[60];

static int s_minute_steps(time_t h0, time_t h1) {
    HealthMinuteData *md = s_minute_data;
    time_t   ts = h0, te = h1;
    uint32_t n   = health_service_get_minute_history(md, 60, &ts, &te);
    int      sum = 0;
    for (uint32_t k = 0; k < n; k++) {
        const time_t rec = ts + (time_t)k * 60;   // start of record k's minute
        if (rec >= h0 && rec < h1 && !md[k].is_invalid) {
            sum += md[k].steps;
        }
    }
    return sum;
}

/**
 * Average the per-minute heart-rate samples recorded in [h0, h1) from the
 * minute history — the same source health_fill_hourly_steps uses, and for the
 * same reason: health_service_aggregate_averaged(HealthMetricHeartRateBPM, ...)
 * only answers a short recent window, so trailing hours came back empty. Each
 * HealthMinuteData carries a uint8 heart_rate_bpm (0 when no sample that
 * minute); we average the non-zero readings in the hour.
 *
 * Same window-clamp guard as s_minute_steps: only records whose minute falls in
 * [h0, h1) count, so an empty (pre-history) hour that the API clamped to the
 * oldest available window averages to 0 rather than borrowing that window's HR.
 *
 * @param h0 UTC start of the hour (inclusive).
 * @param h1 UTC end of the hour (exclusive).
 * @return Average recorded BPM in the window, or 0 if no reading.
 */
static int s_minute_hr_avg(time_t h0, time_t h1) {
    HealthMinuteData *md = s_minute_data;
    time_t   ts = h0, te = h1;
    uint32_t n   = health_service_get_minute_history(md, 60, &ts, &te);
    int      sum = 0, cnt = 0;
    for (uint32_t k = 0; k < n; k++) {
        const time_t rec = ts + (time_t)k * 60;   // start of record k's minute
        if (rec >= h0 && rec < h1 && !md[k].is_invalid && md[k].heart_rate_bpm > 0) {
            sum += md[k].heart_rate_bpm;
            cnt++;
        }
    }
    return cnt ? (sum / cnt) : 0;
}

void health_fill_hourly_steps(int16_t *out, int count, time_t end_hour) {
    for (int i = 0; i < count; i++) {
        time_t h1 = end_hour - (time_t)(count - 1 - i) * HOUR_SECS;
        time_t h0 = h1 - HOUR_SECS;
        out[i] = (int16_t)s_minute_steps(h0, h1);
    }
}

void health_fill_hourly_hr(int16_t *out, int count, time_t end_hour) {
    for (int i = 0; i < count; i++) {
        time_t h1 = end_hour - (time_t)(count - 1 - i) * HOUR_SECS;
        time_t h0 = h1 - HOUR_SECS;
        out[i] = (int16_t)s_minute_hr_avg(h0, h1);
    }
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
    /* Like steps, per-hour sleep can't come from health_service_sum (daily-
       weighted → identical every hour). Sleep has no per-minute field in the
       history API, so we read sleep ACTIVITIES — each is a [start,end] interval
       — and paint the hours they cover.
       The iterate allocates the firmware's 2 KB cache for its run (see
       health_release_service_cache). When the heap cannot spare that block, it
       reports nothing and the window reads awake until the next build reads it
       again (the next hourly rollover). */
    for (int i = 0; i < count; i++) { state_out[i] = HEALTH_SLEEP_AWAKE; }
    SleepFill f = { .state_out = state_out, .count = count, .end_hour = end_hour };
    health_service_activities_iterate(
        HealthActivitySleep | HealthActivityRestfulSleep,
        end_hour - (time_t)count * HOUR_SECS, end_hour,
        HealthIterationDirectionPast, s_sleep_activity_cb, &f);
    health_release_service_cache();
}

#endif  // PBL_HEALTH
