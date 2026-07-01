#include <string.h>

#include "health_cache.h"
#include "c/services/health.h"
#include "c/appendix/bottom_view.h"   // MAX_BOTTOM_VIEW_ENTRIES, BOTTOM_VIEW_STEP_SECONDS
#include "c/appendix/chart.h"         // CHART_ABSENT

#if defined(PBL_HEALTH)

#define N    MAX_BOTTOM_VIEW_ENTRIES
#define STEP BOTTOM_VIEW_STEP_SECONDS

// Delay before the deferred (re)build runs, so the loading frame paints first.
// Imperceptible; tune on device if a build ever feels laggy behind it.
#define HEALTH_CACHE_DEFER_MS 1500

// --- Cache storage (module .bss, no heap) ---------------------------------
static int16_t s_steps[N];
static int16_t s_hr[N];
static uint8_t s_sleep[N];
static time_t  s_end_hour;        // top of the current hour = start of bucket N-1

static bool       s_ready;        // valid + current?
static bool       s_build_pending;// a deferred recalc timer is scheduled
static int        s_pending_count;// trailing bucket count the deferred build recomputes
static AppTimer  *s_timer;
static HealthCacheRepaintCb s_repaint;

static time_t current_hour_top(void) {
    const time_t now = time(NULL);
    return now - (now % STEP);
}

void health_cache_set_repaint(HealthCacheRepaintCb cb) {
    s_repaint = cb;
}

bool health_cache_ready(void) {
    return s_ready;
}

// The actual reads. Recomputes the trailing `count` buckets [N-count .. N-1] of
// the window anchored so bucket N-1 (in-progress) starts at s_end_hour. Steps and
// HR per bucket; sleep over the whole window when count >= 2 (rollover/build).
static void health_cache_fill_trailing(int count) {
    if (count < 1) { return; }
    if (count > N) { count = N; }
    const int    start = N - count;
    const time_t fa    = s_end_hour + STEP;   // exclusive end of the in-progress bucket

    // Steps for all trailing buckets (the last is partial: get_minute_history caps at now).
    health_fill_hourly_steps(&s_steps[start], count, fa);

    // HR for the COMPLETED trailing buckets (exclude the in-progress last one).
    const int hr_count = count - 1;
    if (hr_count > 0) {
        // fa - STEP == s_end_hour == exclusive end of the last completed bucket.
        health_fill_hourly_hr(&s_hr[start], hr_count, fa - STEP);
        for (int k = start; k < N - 1; ++k) {
            if (s_hr[k] == 0) { s_hr[k] = CHART_ABSENT; }   // 0 from the helper == no reading
        }
    }
    // In-progress hour HR = live BPM (or absent if there is no current reading).
    const int bpm = health_hr_current();
    s_hr[N - 1] = (bpm > 0) ? (int16_t)bpm : CHART_ABSENT;

    // Sleep is a single activities_iterate over the whole window; only re-run it
    // on a rollover/build (count >= 2), never on the count==1 current-hour refresh.
    if (count >= 2) {
        health_fill_hourly_sleep(s_sleep, N, fa);
    }
}

static void health_cache_deferred_cb(void *ctx) {
    s_timer = NULL;
    health_cache_fill_trailing(s_pending_count);
    s_build_pending = false;
    s_ready = true;
    if (s_repaint) { s_repaint(); }   // paint the chart from the now-ready cache
}

void health_cache_recalc(time_t end_hour, int count) {
    if (count < 1) { return; }
    if (count > N) { count = N; }
    s_end_hour = end_hour;

    if (count > HEALTH_CACHE_LOADING_THRESHOLD) {
        s_ready = false;
        s_build_pending = true;
        s_pending_count = count;
        if (s_timer) { app_timer_cancel(s_timer); }
        s_timer = app_timer_register(HEALTH_CACHE_DEFER_MS, health_cache_deferred_cb, NULL);
        if (s_repaint) { s_repaint(); }   // paint loading now (cache is !ready)
    } else {
        health_cache_fill_trailing(count);
        s_ready = true;
    }
}

void health_cache_reset(void) {
    if (s_timer) { app_timer_cancel(s_timer); s_timer = NULL; }
    s_ready = false;
    s_build_pending = false;
    health_cache_recalc(current_hour_top(), N);   // full build => deferred + loading
}

void health_cache_refresh_current_hour(void) {
    if (!s_ready) { return; }                       // build pending / never built
    if (current_hour_top() != s_end_hour) { return; } // rollover pending => leave it to the tick
    health_cache_recalc(s_end_hour, 1);             // inline, cheap (steps + live BPM)
}

void health_cache_tick(bool view_visible) {
    if (!s_ready) {
        if (!s_build_pending) { health_cache_reset(); }  // defensive: shouldn't happen
        return;                                          // build in flight: wait
    }

    const time_t now      = time(NULL);
    const time_t now_hour = now - (now % STEP);

    if (now_hour != s_end_hour) {
        const long gap = (long)((now_hour - s_end_hour) / STEP);
        // Backward jump (DST fall-back / manual set back) or a gap too large to
        // slide => full rebuild. This subsumes the spec's separate "clock jump =>
        // reset" without extra detection plumbing.
        if (gap < 1 || gap >= N) {
            health_cache_recalc(now_hour, N);
            return;
        }
        const int keep = N - (int)gap;
        memmove(&s_steps[0], &s_steps[gap], (size_t)keep * sizeof(int16_t));
        memmove(&s_hr[0],    &s_hr[gap],    (size_t)keep * sizeof(int16_t));
        memmove(&s_sleep[0], &s_sleep[gap], (size_t)keep * sizeof(uint8_t));
        // Recompute the newly-entered hour(s) + the previously-in-progress hour
        // (now completed). gap==1 => 2 buckets (inline); gap>=2 => deferred+loading.
        health_cache_recalc(now_hour, (int)gap + 1);
        return;
    }

    // Same hour: re-read the in-progress bucket every 15 min while visible. The
    // 900 s cadence rides minute ticks (which fire on the :00 second).
    if (view_visible && (now % 900) == 0) {
        health_cache_recalc(now_hour, 1);
    }
}

time_t health_cache_read(int16_t *steps_out, int16_t *hr_out,
                         uint8_t *sleep_out, int count) {
    if (count < 0) { count = 0; }
    if (count > N) { count = N; }
    const int off = N - count;
    memcpy(steps_out, &s_steps[off], (size_t)count * sizeof(int16_t));
    memcpy(hr_out,    &s_hr[off],    (size_t)count * sizeof(int16_t));
    memcpy(sleep_out, &s_sleep[off], (size_t)count * sizeof(uint8_t));
    return s_end_hour;
}

#endif  // PBL_HEALTH
