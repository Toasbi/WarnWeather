#pragma once
#include <pebble.h>   // time_t, bool

// Pure scheduling math for the incremental health-cache build. No HealthService
// calls — host-testable (see test/c/health_build_test.c). Health-only.
#if defined(PBL_HEALTH)

// Buckets to fill this chunk: clamp(build_end - next, 0, chunk).
int health_build_chunk_len(int next, int build_end, int chunk);

// The end_hour to pass health_fill_hourly_* so window buckets [start, start+len)
// land on their correct hours. `fa` is the exclusive end of the in-progress bucket
// n-1 (== cache end_hour + step). Returns fa - (n - start - len) * step.
time_t health_build_range_end(time_t fa, int n, int step, int start, int len);

// Rollover plan from a STEP-aligned old anchor to a STEP-aligned now_hour over an
// n-bucket window. Returns true for a full rebuild (backward jump or gap >= n).
// Otherwise returns false and sets *keep = n - gap (buckets that survive the slide)
// and *recalc_count = gap + 1 (trailing buckets to recompute, incl. the newly
// completed previously-in-progress hour). gap = (now_hour - old_end_hour)/step.
bool health_build_rollover(time_t old_end_hour, time_t now_hour, int step, int n,
                           int *keep, int *recalc_count);

#endif  // PBL_HEALTH
