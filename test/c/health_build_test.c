// Host golden tests for src/c/services/health_build.c (pure scheduling math).
// Build & run via scripts/test-c.sh (PBL_HEALTH defined; no SDK calls exercised).
#include <stdio.h>
#include <string.h>
#include "c/services/health_build.h"

static int s_failures = 0;
static void expect_int(const char *name, long got, long want) {
    if (got != want) { printf("FAIL %s: got %ld want %ld\n", name, got, want); s_failures++; }
}

#define STEP 3600
#define N    24

static void chunk_len_tests(void) {
    expect_int("chunk.full", health_build_chunk_len(0, N, 4), 4);
    expect_int("chunk.tail", health_build_chunk_len(22, N, 4), 2);   // only 2 left
    expect_int("chunk.done", health_build_chunk_len(N, N, 4), 0);
    expect_int("chunk.zero_left", health_build_chunk_len(24, 24, 4), 0);
}

static void range_end_tests(void) {
    const time_t fa = 1000000;                 // exclusive end of in-progress bucket N-1
    // Filling the full window [0,N): last bucket N-1 ends at fa.
    expect_int("rangeend.full", health_build_range_end(fa, N, STEP, 0, N), fa);
    // Filling the trailing 6 [18,24): last bucket 23 ends at fa.
    expect_int("rangeend.trailing6", health_build_range_end(fa, N, STEP, 18, 6), fa);
    // Filling the first 4 [0,4): last bucket 3 ends at fa - (24-0-4)*STEP.
    expect_int("rangeend.first4", health_build_range_end(fa, N, STEP, 0, 4), fa - (N - 4) * STEP);
    // HR window reuse: (fa-STEP, N-1) filling first 4 completed buckets.
    expect_int("rangeend.hr_first4",
               health_build_range_end(fa - STEP, N - 1, STEP, 0, 4),
               (fa - STEP) - ((N - 1) - 4) * STEP);
}

static void rollover_tests(void) {
    int keep = -1, recalc = -1;
    const time_t base = 1000000 - (1000000 % STEP);
    // gap 1: slide keep N-1, recalc 2.
    expect_int("roll.gap1.full", health_build_rollover(base, base + STEP, STEP, N, &keep, &recalc), 0);
    expect_int("roll.gap1.keep", keep, N - 1);
    expect_int("roll.gap1.recalc", recalc, 2);
    // gap 3: slide keep N-3, recalc 4.
    health_build_rollover(base, base + 3 * STEP, STEP, N, &keep, &recalc);
    expect_int("roll.gap3.keep", keep, N - 3);
    expect_int("roll.gap3.recalc", recalc, 4);
    // backward jump: full rebuild.
    expect_int("roll.back.full", health_build_rollover(base, base - STEP, STEP, N, &keep, &recalc), 1);
    // gap >= N: full rebuild.
    expect_int("roll.huge.full", health_build_rollover(base, base + N * STEP, STEP, N, &keep, &recalc), 1);
}

int main(void) {
    chunk_len_tests();
    range_end_tests();
    rollover_tests();
    if (s_failures) { printf("%d health_build failure(s)\n", s_failures); return 1; }
    printf("health_build OK\n");
    return 0;
}
