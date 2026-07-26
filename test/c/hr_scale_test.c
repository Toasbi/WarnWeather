// Host-compiled test for src/c/appendix/hr_scale.c (no Pebble SDK needed — the
// module depends only on <stdint.h>). Build & run via scripts/test-c.sh.
#include <assert.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>

#include "c/appendix/hr_scale.h"

#define ABSENT INT16_MIN

static void test_resolve_unpacks_a_valid_pair(void) {
    int lo = 0, hi = 0;
    hr_scale_resolve((uint16_t)(55 | (95 << 8)), 40, 180, &lo, &hi);
    assert(lo == 55);
    assert(hi == 95);
}

static void test_resolve_falls_back(void) {
    int lo = 0, hi = 0;
    hr_scale_resolve(0, 40, 180, &lo, &hi);            // unset (old phone build)
    assert(lo == 40 && hi == 180);

    hr_scale_resolve((uint16_t)(95 | (55 << 8)), 40, 180, &lo, &hi);   // inverted
    assert(lo == 40 && hi == 180);

    hr_scale_resolve((uint16_t)(60 | (60 << 8)), 40, 180, &lo, &hi);   // zero span
    assert(lo == 40 && hi == 180);

    hr_scale_resolve((uint16_t)(0 | (95 << 8)), 40, 180, &lo, &hi);    // lo == 0
    assert(lo == 40 && hi == 180);
}

static void test_apply_leaves_in_range_values_alone(void) {
    int16_t v[3]    = { 55, 70, 95 };
    uint8_t c[3]    = { 9, 9, 9 };
    hr_scale_apply(v, c, 3, 55, 95, ABSENT);
    assert(v[0] == 55 && v[1] == 70 && v[2] == 95);
    assert(c[0] == HR_CLAMP_NONE && c[1] == HR_CLAMP_NONE && c[2] == HR_CLAMP_NONE);
}

static void test_apply_blanks_and_flags_out_of_range(void) {
    int16_t v[4] = { 140, 30, 96, 54 };
    uint8_t c[4] = { 9, 9, 9, 9 };
    hr_scale_apply(v, c, 4, 55, 95, ABSENT);
    assert(v[0] == ABSENT && c[0] == HR_CLAMP_HIGH);
    assert(v[1] == ABSENT && c[1] == HR_CLAMP_LOW);
    assert(v[2] == ABSENT && c[2] == HR_CLAMP_HIGH);   // one above hi
    assert(v[3] == ABSENT && c[3] == HR_CLAMP_LOW);    // one below lo
}

static void test_apply_leaves_absent_slots_undotted(void) {
    int16_t v[2] = { ABSENT, 70 };
    uint8_t c[2] = { 9, 9 };
    hr_scale_apply(v, c, 2, 55, 95, ABSENT);
    // An hour with no reading is a plain gap, NOT an off-scale dot.
    assert(v[0] == ABSENT && c[0] == HR_CLAMP_NONE);
    assert(v[1] == 70 && c[1] == HR_CLAMP_NONE);
}

static void test_apply_tolerates_a_zero_count_and_null_arrays(void) {
    int16_t v[1] = { 140 };
    uint8_t c[1] = { 9 };
    hr_scale_apply(v, c, 0, 55, 95, ABSENT);
    assert(v[0] == 140 && c[0] == 9);   // untouched
    hr_scale_apply(NULL, c, 1, 55, 95, ABSENT);   // must not crash
    hr_scale_apply(v, NULL, 1, 55, 95, ABSENT);
}

int main(void) {
    test_resolve_unpacks_a_valid_pair();
    test_resolve_falls_back();
    test_apply_leaves_in_range_values_alone();
    test_apply_blanks_and_flags_out_of_range();
    test_apply_leaves_absent_slots_undotted();
    test_apply_tolerates_a_zero_count_and_null_arrays();
    printf("hr_scale_test: OK\n");
    return 0;
}
