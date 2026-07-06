#include "health_build.h"

#if defined(PBL_HEALTH)

int health_build_chunk_len(int next, int build_end, int chunk) {
    int left = build_end - next;
    if (left <= 0) { return 0; }
    return (left < chunk) ? left : chunk;
}

time_t health_build_range_end(time_t fa, int n, int step, int start, int len) {
    return fa - (time_t)(n - start - len) * step;
}

bool health_build_rollover(time_t old_end_hour, time_t now_hour, int step, int n,
                           int *keep, int *recalc_count) {
    long gap = (long)((now_hour - old_end_hour) / step);
    if (now_hour < old_end_hour || gap >= n) { return true; }  // backward / too large => full rebuild
    *keep = n - (int)gap;
    *recalc_count = (int)gap + 1;
    return false;
}

#endif  // PBL_HEALTH
