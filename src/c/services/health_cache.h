#pragma once

#include <pebble.h>

// The health cache exists only on health-capable hardware. aplite (no sensors)
// compiles the whole module + every call site out (see main_window.c).
#if defined(PBL_HEALTH)

// Rollover/restore gaps up to this many trailing buckets keep the cache ready
// (the slid buckets stay on screen) and refill in background slices; larger
// catch-ups drop to the loading state first — slid data hours stale is worse
// than the loading frame.
#define HEALTH_CACHE_PAINT_FIRST_MAX 2

// Buckets filled per deferred build slice. 1 => at most two minute-history
// reads (steps + HR) per event-loop turn; the whole-window sleep iterate gets
// a slice of its own. Bigger slices block taps/ticks for the whole burst — the
// 2-6 s frozen-flick bug was 4-bucket slices (8 reads back-to-back) plus the
// hourly rollover reading inline in the tick handler.
#define HEALTH_CACHE_BUILD_CHUNK 1

// Repaint hook: invoked after a deferred (re)build finishes so the health view
// can redraw from the now-ready cache. main_window registers
// health_graph_layer_refresh.
typedef void (*HealthCacheRepaintCb)(void);
void health_cache_set_repaint(HealthCacheRepaintCb cb);

/**
 * THE single recompute entry point. Recomputes the trailing `count` buckets of
 * the MAX_BOTTOM_VIEW_ENTRIES window whose in-progress (last) bucket starts at
 * `end_hour`. count == 1 (the current-hour refresh) runs inline — one
 * minute-history read plus the live-BPM peek; any multi-bucket recompute
 * clears ready, paints the loading state, and runs sliced from one-shot
 * app_timers (see HEALTH_CACHE_BUILD_CHUNK) so no handler ever blocks on a
 * read burst. Assumes buckets outside the trailing `count` are already valid
 * for `end_hour` (the tick slides them before calling for a rollover).
 */
void health_cache_recalc(time_t end_hour, int count);

/**
 * Per-minute upkeep, called from minute_handler while health is enabled. At an
 * hour rollover it slides the window and refills the trailing bucket(s) in
 * background slices — the cache stays ready and the slid data stays on screen;
 * no HealthService call runs inside the tick itself. When `view_visible`, it
 * also re-reads the in-progress hour (inline, single read) on a 15-min
 * cadence. While a build/refresh is in flight it waits; self-heals (reset) if
 * it ever finds the cache neither ready nor building.
 */
void health_cache_tick(bool view_visible);

/**
 * Drop cached state and immediately start a full rebuild (deferred + loading).
 * Call on enable, on boot while enabled, and on a clock jump.
 */
void health_cache_reset(void);

/**
 * Cheap in-progress-hour re-read for the flick path. No-op unless the cache is
 * ready, no build/refresh is in flight, and it is still aligned to the current
 * hour (a pending rollover is left to the tick).
 */
void health_cache_refresh_current_hour(void);

/** True when the cache holds valid, current data; false while a (re)build is pending. */
bool health_cache_ready(void);

/**
 * Copy the most-recent `count` buckets into caller buffers (clamped to the
 * window). Returns the grid anchor: the top of the current hour, i.e. the start
 * of the in-progress last bucket.
 */
time_t health_cache_read(int16_t *steps_out, int16_t *hr_out,
                         uint8_t *sleep_out, int count);

/**
 * Snapshot the current cache (steps/HR/sleep/anchor hour) to persist storage.
 * No-op unless the cache is ready (never persists a mid-build snapshot).
 * Call from main_window_unload() — must not depend on g_config, which may
 * already be freed by the time unload runs (see AGENTS.md / the design doc).
 */
void health_cache_persist_save(void);

/**
 * Restore the cache from a persisted snapshot and catch it up to the current
 * hour via the same rollover contract health_cache_tick() uses for a
 * same-session hour rollover. Returns false (nothing restored) when no
 * snapshot exists, it's incomplete/corrupt, or the gap since it was taken is
 * too large or backward — callers fall back to health_cache_reset().
 */
bool health_cache_restore(void);

#endif  // PBL_HEALTH
