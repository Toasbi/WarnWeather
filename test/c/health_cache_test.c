// Host tests for src/c/services/health_cache.c — the timer-sliced build/refresh
// state machine. Build & run via scripts/test-c.sh (PBL_HEALTH + WW_HOST_FAKE_TIME;
// the HealthService/persist/app_timer surfaces are faked below).
//
// The load-bearing invariant here is SLICE DISCIPLINE: no call that runs inside
// an event-loop turn (tick handler, tap handler, or one app_timer fire) may read
// more than one bucket's worth of minute history, and the whole-window sleep
// iterate always gets a turn of its own. Multi-second freezes (frozen flicks)
// came from exactly this: the hourly rollover ran 3 minute-history reads plus a
// 24 h activities-iterate synchronously inside the minute tick.
#include <stdio.h>
#include <string.h>

#include "c/services/health_cache.h"
#include "c/services/health.h"
#include "c/appendix/persist.h"
#include "c/appendix/bottom_view.h"   // MAX_BOTTOM_VIEW_ENTRIES

#define N    MAX_BOTTOM_VIEW_ENTRIES
#define STEP BOTTOM_VIEW_STEP_SECONDS

static int s_failures = 0;
static void expect_int(const char *name, long got, long want) {
    if (got != want) { printf("FAIL %s: got %ld want %ld\n", name, got, want); s_failures++; }
}

// --- Fake clock (stub pebble.h #defines time(x) to test_time(x)) ------------
static time_t s_now;
time_t test_time(time_t *tloc) { if (tloc) { *tloc = s_now; } return s_now; }

// --- Fake app_timer (the module uses a single one-shot timer) ----------------
static AppTimerCallback s_timer_cb;
static void            *s_timer_ctx;
static uint32_t         s_timer_ms;

AppTimer *app_timer_register(uint32_t timeout_ms, AppTimerCallback callback, void *callback_data) {
    s_timer_cb  = callback;
    s_timer_ctx = callback_data;
    s_timer_ms  = timeout_ms;
    return (AppTimer *)&s_timer_cb;
}
void app_timer_cancel(AppTimer *timer_handle) { (void)timer_handle; s_timer_cb = NULL; }

static int timer_pending(void) { return s_timer_cb != NULL; }
static void timer_fire(void) {
    AppTimerCallback cb = s_timer_cb;
    void *ctx = s_timer_ctx;
    s_timer_cb = NULL;               // one-shot; the callback may re-register
    if (cb) { cb(ctx); }
}

// --- Fake HealthService fills (health.c is not linked) -----------------------
// Deterministic per-hour values so slid vs. refilled buckets are tellable apart:
// steps land in 100..199, HR in 200..254, sleep is LIGHT everywhere.
static int s_reads;        // bucket-reads (each == one minute-history call)
static int s_sleep_iters;  // whole-window activity iterates
static int s_peeks;        // live-BPM peeks
static int s_live_bpm = 72;

void health_fill_hourly_steps(int16_t *out, int count, time_t end_hour) {
    s_reads += count;
    for (int i = 0; i < count; i++) {
        time_t h1 = end_hour - (time_t)(count - 1 - i) * STEP;
        out[i] = (int16_t)(100 + (h1 / STEP) % 100);
    }
}
void health_fill_hourly_hr(int16_t *out, int count, time_t end_hour) {
    s_reads += count;
    for (int i = 0; i < count; i++) {
        time_t h1 = end_hour - (time_t)(count - 1 - i) * STEP;
        out[i] = (int16_t)(200 + (h1 / STEP) % 55);
    }
}
void health_fill_hourly_sleep(uint8_t *state_out, int count, time_t end_hour) {
    (void)end_hour;
    s_sleep_iters++;
    for (int i = 0; i < count; i++) { state_out[i] = HEALTH_SLEEP_LIGHT; }
}
int health_hr_current(void) { s_peeks++; return s_live_bpm; }

// Expected stub value for window bucket idx of a cache anchored at end_hour
// (bucket N-1 is the in-progress hour starting at end_hour).
static long exp_steps(time_t end_hour, int idx) {
    time_t h1 = end_hour + STEP - (time_t)(N - 1 - idx) * STEP;
    return 100 + (h1 / STEP) % 100;
}
static long exp_hr(time_t end_hour, int idx) {
    time_t h1 = end_hour + STEP - (time_t)(N - 1 - idx) * STEP;
    return 200 + (h1 / STEP) % 55;
}

// --- Fake persist -------------------------------------------------------------
static int16_t p_steps[N];
static int16_t p_hr[N];
static uint8_t p_sleep[N];
static time_t  p_end_hour;
static int     p_present;

bool persist_health_cache_present(void) { return p_present != 0; }
bool persist_set_health_cache_steps(int16_t *data, size_t count) {
    memcpy(p_steps, data, count * sizeof(int16_t)); return true;
}
int persist_get_health_cache_steps(int16_t *buffer, size_t count) {
    memcpy(buffer, p_steps, count * sizeof(int16_t)); return (int)(count * sizeof(int16_t));
}
bool persist_set_health_cache_hr(int16_t *data, size_t count) {
    memcpy(p_hr, data, count * sizeof(int16_t)); return true;
}
int persist_get_health_cache_hr(int16_t *buffer, size_t count) {
    memcpy(buffer, p_hr, count * sizeof(int16_t)); return (int)(count * sizeof(int16_t));
}
bool persist_set_health_cache_sleep(uint8_t *data, size_t count) {
    memcpy(p_sleep, data, count); return true;
}
int persist_get_health_cache_sleep(uint8_t *buffer, size_t count) {
    memcpy(buffer, p_sleep, count); return (int)count;
}
bool persist_set_health_cache_end_hour(time_t val) { p_end_hour = val; p_present = 1; return true; }
time_t persist_get_health_cache_end_hour(void) { return p_end_hour; }

// --- Repaint hook -------------------------------------------------------------
static int s_repaints;
static void count_repaint(void) { s_repaints++; }

// --- Helpers -------------------------------------------------------------------
#define MAX_FIRES 100

// Drain the timer chain to completion, asserting slice discipline on every fire.
static int drain(const char *name) {
    int fires = 0;
    while (timer_pending() && fires < MAX_FIRES) {
        int reads0 = s_reads, sleeps0 = s_sleep_iters;
        timer_fire();
        fires++;
        int dr = s_reads - reads0, ds = s_sleep_iters - sleeps0;
        if (dr > 2) {
            printf("FAIL %s: fire %d did %d bucket-reads (max 2)\n", name, fires, dr);
            s_failures++;
        }
        if (ds > 0 && dr > 0) {
            printf("FAIL %s: fire %d mixed the sleep iterate with %d bucket-reads\n", name, fires, dr);
            s_failures++;
        }
    }
    if (timer_pending()) {
        printf("FAIL %s: build did not finish within %d fires\n", name, MAX_FIRES);
        s_failures++;
    }
    return fires;
}

static void reset_counters(void) { s_reads = 0; s_sleep_iters = 0; s_peeks = 0; s_repaints = 0; }

// Build a ready cache anchored at hour-aligned `anchor` and clear all counters.
static void fresh_cache(time_t anchor) {
    s_now = anchor + 30;
    health_cache_reset();
    drain("fresh_cache");
    reset_counters();
}

// Hour-aligned anchors, far apart so per-test stub values don't collide.
#define ANCHOR(k) ((time_t)(((1700000000L + (k) * 1000000L) / STEP) * STEP))

// --- Tests ---------------------------------------------------------------------

// THE freeze regression: the hourly rollover must do zero HealthService work
// inside the tick handler; the trailing buckets refill in background slices
// while the cache keeps painting (ready stays true, no loading flash).
static void tick_rollover_is_sliced(void) {
    const time_t H = ANCHOR(1);
    fresh_cache(H);

    s_now = H + STEP;   // the HH:00 minute tick
    health_cache_tick(false);
    expect_int("tick.roll.inline_reads", s_reads, 0);
    expect_int("tick.roll.inline_sleep", s_sleep_iters, 0);
    expect_int("tick.roll.inline_peeks", s_peeks, 0);
    expect_int("tick.roll.stays_ready", health_cache_ready(), 1);
    expect_int("tick.roll.bg_armed", timer_pending(), 1);

    drain("tick.roll");
    expect_int("tick.roll.total_reads", s_reads, 3);   // 2 steps + 1 completed-HR bucket
    expect_int("tick.roll.total_sleep", s_sleep_iters, 1);
    expect_int("tick.roll.total_peeks", s_peeks, 1);

    int16_t st[N], hr[N];
    uint8_t sl[N];
    expect_int("tick.roll.anchor", (long)health_cache_read(st, hr, sl, N), (long)(H + STEP));
    expect_int("tick.roll.step22", st[22], exp_steps(H + STEP, 22));  // finalized hour
    expect_int("tick.roll.step23", st[23], exp_steps(H + STEP, 23));  // in-progress hour
    expect_int("tick.roll.hr22", hr[22], exp_hr(H + STEP, 22));
    expect_int("tick.roll.hr23_live", hr[23], s_live_bpm);
    expect_int("tick.roll.sleep0", sl[0], HEALTH_SLEEP_LIGHT);        // whole-window re-iterate
}

// Full rebuild: loading state, one bucket per slice, sleep in its own slice,
// finalize (live BPM + repaint) last.
static void full_build_slices(void) {
    const time_t H = ANCHOR(2);
    s_now = H + 30;
    reset_counters();
    health_cache_reset();
    expect_int("build.loading", health_cache_ready(), 0);
    expect_int("build.defer_ms", (long)s_timer_ms, 1500);
    expect_int("build.loading_repaint", s_repaints, 1);

    int fires = drain("build");
    expect_int("build.fires", fires, N + 2);       // N fill slices + sleep + finalize
    expect_int("build.reads", s_reads, N + N - 1); // N steps + N-1 completed-HR
    expect_int("build.sleep", s_sleep_iters, 1);
    expect_int("build.peeks", s_peeks, 1);
    expect_int("build.ready", health_cache_ready(), 1);
    expect_int("build.done_repaint", s_repaints, 2);
}

// The flick-path warm read stays inline and cheap, and is skipped while a
// background refresh is in flight.
static void refresh_current_hour_inline_and_guarded(void) {
    const time_t H = ANCHOR(3);
    fresh_cache(H);

    health_cache_refresh_current_hour();
    expect_int("warm.reads", s_reads, 1);          // in-progress steps only
    expect_int("warm.peeks", s_peeks, 1);
    expect_int("warm.no_timer", timer_pending(), 0);

    s_now = H + STEP;
    health_cache_tick(false);                      // arms the bg rollover refresh
    reset_counters();
    health_cache_refresh_current_hour();           // must not read mid-refresh
    expect_int("warm.guarded_reads", s_reads, 0);
    drain("warm.guard");
}

// A tick landing while a build/refresh is in flight waits — no rollover
// re-entry, no inline 15-min re-read.
static void tick_waits_while_pending(void) {
    const time_t H = ANCHOR(4);
    fresh_cache(H);

    s_now = H + STEP;                              // :00 → also (now % 900) == 0
    health_cache_tick(false);
    expect_int("wait.bg_armed", timer_pending(), 1);
    reset_counters();
    health_cache_tick(true);                       // second tick, refresh still pending
    expect_int("wait.no_reads", s_reads, 0);
    expect_int("wait.still_pending", timer_pending(), 1);
    drain("wait");
}

// Never persist a mid-refresh snapshot.
static void persist_guarded_while_pending(void) {
    const time_t H = ANCHOR(5);
    fresh_cache(H);

    s_now = H + STEP;
    health_cache_tick(false);
    p_present = 0;
    health_cache_persist_save();
    expect_int("persist.skipped_mid_refresh", p_present, 0);
    drain("persist");
    health_cache_persist_save();
    expect_int("persist.saved_after", p_present, 1);
    expect_int("persist.end_hour", (long)p_end_hour, (long)(H + STEP));
}

// Restore with a small gap: paint the persisted (slid) buckets immediately,
// refill the trailing ones in background slices.
static void restore_fresh_paints_first(void) {
    const time_t H = ANCHOR(6);
    fresh_cache(H);   // leaves the module ready; restore below overwrites it

    for (int i = 0; i < N; i++) { p_steps[i] = (int16_t)(1000 + i); p_hr[i] = (int16_t)(50 + i); p_sleep[i] = HEALTH_SLEEP_DEEP; }
    p_end_hour = H;
    p_present = 1;

    s_now = H + STEP + 30;   // relaunch in the next hour (gap 1)
    reset_counters();
    expect_int("restore.ret", health_cache_restore(), 1);
    expect_int("restore.inline_reads", s_reads, 0);
    expect_int("restore.ready_now", health_cache_ready(), 1);
    expect_int("restore.paint_first", s_repaints, 1);
    expect_int("restore.bg_armed", timer_pending(), 1);

    int16_t st[N], hr[N];
    uint8_t sl[N];
    health_cache_read(st, hr, sl, N);
    expect_int("restore.slid_step0", st[0], 1001);    // persisted bucket 1 slid to 0
    expect_int("restore.slid_step22", st[22], 1023);

    drain("restore");
    health_cache_read(st, hr, sl, N);
    expect_int("restore.refilled_step22", st[22], exp_steps(H + STEP, 22));
    expect_int("restore.refilled_step23", st[23], exp_steps(H + STEP, 23));
    expect_int("restore.sleep_reread", sl[0], HEALTH_SLEEP_LIGHT);
    expect_int("restore.total_sleep", s_sleep_iters, 1);
}

// Restore with a multi-hour gap: slid data is hours stale — loading rebuild of
// the trailing gap. A gap past the window: nothing restorable.
static void restore_stale_and_too_old(void) {
    const time_t H = ANCHOR(7);
    fresh_cache(H);

    p_end_hour = H;
    p_present = 1;
    s_now = H + 3 * STEP + 30;   // gap 3 => recalc 4 buckets
    reset_counters();
    expect_int("restore.stale.ret", health_cache_restore(), 1);
    expect_int("restore.stale.loading", health_cache_ready(), 0);
    expect_int("restore.stale.defer_ms", (long)s_timer_ms, 1500);
    int fires = drain("restore.stale");
    expect_int("restore.stale.fires", fires, 4 + 2);   // 4 fill slices + sleep + finalize
    expect_int("restore.stale.ready", health_cache_ready(), 1);

    s_now = H + (time_t)N * STEP + 30;   // gap N: past the window
    expect_int("restore.too_old.ret", health_cache_restore(), 0);
    // Caller falls back to health_cache_reset(); do it to leave a sane state.
    health_cache_reset();
    drain("restore.too_old.reset");
}

// The 15-minute in-progress re-read: inline single read, only on the cadence,
// only while a health view is visible.
static void visible_quarter_hour_reread(void) {
    const time_t H = ANCHOR(8);
    fresh_cache(H);

    s_now = H + 900;
    health_cache_tick(true);
    expect_int("q15.reads", s_reads, 1);
    expect_int("q15.peeks", s_peeks, 1);

    reset_counters();
    s_now = H + 960;             // not on the cadence
    health_cache_tick(true);
    expect_int("q15.off_cadence", s_reads, 0);

    s_now = H + 1800;            // on the cadence but not visible
    health_cache_tick(false);
    expect_int("q15.not_visible", s_reads, 0);
}

int main(void) {
    health_cache_set_repaint(count_repaint);
    tick_rollover_is_sliced();
    full_build_slices();
    refresh_current_hour_inline_and_guarded();
    tick_waits_while_pending();
    persist_guarded_while_pending();
    restore_fresh_paints_first();
    restore_stale_and_too_old();
    visible_quarter_hour_reread();
    if (s_failures) { printf("%d health_cache failure(s)\n", s_failures); return 1; }
    printf("health_cache OK\n");
    return 0;
}
