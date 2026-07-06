#include <string.h>

#include "health_cache.h"
#include "c/services/health.h"
#include "c/services/health_build.h"
#include "c/appendix/bottom_view.h"   // MAX_BOTTOM_VIEW_ENTRIES, BOTTOM_VIEW_STEP_SECONDS
#include "c/appendix/chart.h"         // CHART_ABSENT
#include "c/appendix/persist.h"       // persist_*_health_cache_*

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

static int  s_build_next;       // next window-bucket index to fill (ascending)
static int  s_build_start;      // first bucket index this build owns
static bool s_build_sleep_done; // one-shot sleep iterate has run this build

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

// Fill window buckets [start, start+len) for steps, and the COMPLETED subset for HR
// (HR excludes the in-progress bucket N-1, which is set from live BPM at completion).
static void health_cache_fill_range(int start, int len) {
    if (len < 1) { return; }
    const time_t fa = s_end_hour + STEP;                 // exclusive end of bucket N-1
    health_fill_hourly_steps(&s_steps[start],
                             len,
                             health_build_range_end(fa, N, STEP, start, len));
    // HR: only completed buckets in [start, min(start+len, N-1)). Window of the
    // completed buckets is (fa - STEP, N-1).
    int hstart = start;
    int hend   = (start + len < N - 1) ? (start + len) : (N - 1);
    int hlen   = hend - hstart;
    if (hlen > 0) {
        health_fill_hourly_hr(&s_hr[hstart], hlen,
                              health_build_range_end(fa - STEP, N - 1, STEP, hstart, hlen));
        for (int k = hstart; k < hend; ++k) {
            if (s_hr[k] == 0) { s_hr[k] = CHART_ABSENT; }
        }
    }
}

// One deferred build chunk: fill up to CHUNK step/HR buckets, then re-arm; once all
// buckets are filled, run the single sleep iterate, set the in-progress HR, mark ready.
static void health_cache_build_step(void *ctx) {
    s_timer = NULL;
    const int len = health_build_chunk_len(s_build_next, N, HEALTH_CACHE_BUILD_CHUNK);
    if (len > 0) {
        health_cache_fill_range(s_build_next, len);
        s_build_next += len;
    }
    if (s_build_next < N) {
        s_timer = app_timer_register(0, health_cache_build_step, NULL);  // yield, continue
        return;
    }
    if (!s_build_sleep_done) {
        health_fill_hourly_sleep(s_sleep, N, s_end_hour + STEP);  // one iterate over the window
        s_build_sleep_done = true;
    }
    const int bpm = health_hr_current();                          // in-progress hour = live BPM
    s_hr[N - 1] = (bpm > 0) ? (int16_t)bpm : CHART_ABSENT;
    s_build_pending = false;
    s_ready = true;
    if (s_repaint) { s_repaint(); }
}

void health_cache_recalc(time_t end_hour, int count) {
    if (count < 1) { return; }
    if (count > N) { count = N; }
    s_end_hour = end_hour;

    if (count > HEALTH_CACHE_LOADING_THRESHOLD) {
        // Deferred, chunked build: paint loading now, fill a few buckets per timer tick.
        if (s_timer) { app_timer_cancel(s_timer); s_timer = NULL; }
        s_ready = false;
        s_build_pending = true;
        s_build_start = N - count;
        s_build_next = s_build_start;
        s_build_sleep_done = false;
        s_pending_count = count;                    // kept for introspection/parity
        s_timer = app_timer_register(HEALTH_CACHE_DEFER_MS, health_cache_build_step, NULL);
        if (s_repaint) { s_repaint(); }             // loading frame first
    } else {
        // Cheap inline path (current-hour refresh / single rollover): fill now.
        const int start = N - count;
        health_cache_fill_range(start, count);
        if (count >= 2) { health_fill_hourly_sleep(s_sleep, N, s_end_hour + STEP); }
        const int bpm = health_hr_current();
        s_hr[N - 1] = (bpm > 0) ? (int16_t)bpm : CHART_ABSENT;
        s_ready = true;
    }
}

// Slide the kept buckets to the front and recompute the trailing gap via the
// existing rollover contract in health_build_rollover. Shared by
// health_cache_tick (same-session hour rollover) and health_cache_restore
// (catch-up after a relaunch). Returns false when health_build_rollover
// itself calls for a full rebuild (backward jump, or gap >= N) — the caller
// falls back to health_cache_recalc(now_hour, N) / health_cache_reset().
static bool health_cache_rollover_to(time_t now_hour) {
    int keep = 0, recalc = 0;
    if (health_build_rollover(s_end_hour, now_hour, STEP, N, &keep, &recalc)) {
        return false;
    }
    const int gap = N - keep;
    memmove(&s_steps[0], &s_steps[gap], (size_t)keep * sizeof(int16_t));
    memmove(&s_hr[0],    &s_hr[gap],    (size_t)keep * sizeof(int16_t));
    memmove(&s_sleep[0], &s_sleep[gap], (size_t)keep * sizeof(uint8_t));
    health_cache_recalc(now_hour, recalc);
    return true;
}

void health_cache_reset(void) {
    if (s_timer) { app_timer_cancel(s_timer); s_timer = NULL; }
    s_ready = false;
    s_build_pending = false;
    s_build_sleep_done = false;
    health_cache_recalc(current_hour_top(), N);   // full build => chunked + loading
}

void health_cache_persist_save(void) {
    if (!s_ready) { return; }   // never persist a mid-build snapshot
    persist_set_health_cache_steps(s_steps, N);
    persist_set_health_cache_hr(s_hr, N);
    persist_set_health_cache_sleep(s_sleep, N);
    persist_set_health_cache_end_hour(s_end_hour);   // written last: presence == complete snapshot
}

bool health_cache_restore(void) {
    if (!persist_health_cache_present()) { return false; }
    if (persist_get_health_cache_steps(s_steps, N) != (int)(N * sizeof(int16_t))) { return false; }
    if (persist_get_health_cache_hr(s_hr, N) != (int)(N * sizeof(int16_t))) { return false; }
    if (persist_get_health_cache_sleep(s_sleep, N) != (int)(N * sizeof(uint8_t))) { return false; }
    s_end_hour = persist_get_health_cache_end_hour();
    return health_cache_rollover_to(current_hour_top());
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
        if (!health_cache_rollover_to(now_hour)) {
            health_cache_recalc(now_hour, N);   // full rebuild
        }
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
