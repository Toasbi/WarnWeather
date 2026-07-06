#pragma once

#include <pebble.h>

// The health cache exists only on health-capable hardware. aplite (no sensors)
// compiles the whole module + every call site out (see main_window.c).
#if defined(PBL_HEALTH)

// Bucket count above which a recalc DEFERS (one-shot app_timer) and shows the
// loading state instead of reading inline. 2 => only multi-hour catch-ups and
// the full build defer; the current-hour (1) and single-rollover (2) refreshes
// run inline.
#define HEALTH_CACHE_LOADING_THRESHOLD 2

// Buckets filled per deferred build tick. The build re-arms an app_timer between
// chunks so the UI thread yields, preventing the freeze a single 24-bucket read
// caused. Tune on device: smaller = smoother but longer total build.
#define HEALTH_CACHE_BUILD_CHUNK 4

// Repaint hook: invoked after a deferred (re)build finishes so the health view
// can redraw from the now-ready cache. main_window registers
// health_graph_layer_refresh.
typedef void (*HealthCacheRepaintCb)(void);
void health_cache_set_repaint(HealthCacheRepaintCb cb);

/**
 * THE single recompute entry point. Recomputes the trailing `count` buckets of
 * the MAX_BOTTOM_VIEW_ENTRIES window whose in-progress (last) bucket starts at
 * `end_hour`. count > HEALTH_CACHE_LOADING_THRESHOLD clears ready, paints the
 * loading state, and runs the reads from a one-shot app_timer; otherwise the
 * reads run inline. Assumes buckets outside the trailing `count` are already
 * valid for `end_hour` (the tick slides them before calling for a rollover).
 */
void health_cache_recalc(time_t end_hour, int count);

/**
 * Per-minute upkeep, called from minute_handler while health is enabled. At an
 * hour rollover it slides the window and finalizes the completed hour(s)
 * (always); when `view_visible`, it also re-reads the in-progress hour on a
 * 15-min cadence. Self-heals (reset) if it ever finds the cache neither ready
 * nor building.
 */
void health_cache_tick(bool view_visible);

/**
 * Drop cached state and immediately start a full rebuild (deferred + loading).
 * Call on enable, on boot while enabled, and on a clock jump.
 */
void health_cache_reset(void);

/**
 * Cheap in-progress-hour re-read for the flick path. No-op unless the cache is
 * ready and still aligned to the current hour (a pending rollover is left to
 * the tick).
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

#endif  // PBL_HEALTH
