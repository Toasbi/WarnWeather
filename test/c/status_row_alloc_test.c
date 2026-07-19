// test/c/status_row_alloc_test.c
#include <stdio.h>
#include "c/appendix/status_row_alloc.h"

static int s_failures = 0;
static void expect(const char *name, int got, int want) {
    if (got != want) { printf("FAIL %s: got %d want %d\n", name, got, want); s_failures++; }
}

// content_w = 100 throughout.
static void empty_left_gives_middle_its_space(void) {
    // left empty(0), middle date(60), right battery(29). Middle must get the whole
    // span left of the right group, not a fixed third.
    int gw[3] = {0, 60, 29}, gx[3], dw[3];
    status_row_alloc(100, gw, gx, dw);
    expect("el.left.x", gx[0], 0);
    expect("el.right.x", gx[2], 100 - 29);          // right-anchored
    expect("el.mid.w", dw[1], 60);                   // fits: full desired width
    // middle centred in [0 .. 71-GAP] = [0..67]; (67-60)/2 = 3
    expect("el.mid.x", gx[1], (71 - STATUS_ROW_ALLOC_GROUP_GAP - 60) / 2);
}

static void both_edges_present(void) {
    int gw[3] = {40, 30, 40}, gx[3], dw[3];
    status_row_alloc(100, gw, gx, dw);
    expect("be.left.x", gx[0], 0);
    expect("be.right.x", gx[2], 60);                 // 100-40
    // mid span = [40+GAP .. 60-GAP] = [44..56], width 12 < desired 30 -> clamp
    expect("be.mid.w", dw[1], 12);
    expect("be.mid.x", gx[1], 44);
}

static void middle_only(void) {
    int gw[3] = {0, 50, 0}, gx[3], dw[3];
    status_row_alloc(100, gw, gx, dw);
    expect("mo.mid.x", gx[1], (100 - 50) / 2);        // centred across the whole row
    expect("mo.mid.w", dw[1], 50);
}

static void overflow_clamps_nonnegative(void) {
    int gw[3] = {70, 40, 70}, gx[3], dw[3];
    status_row_alloc(100, gw, gx, dw);
    // edges can't both fit; right is pinned no further left than the left edge,
    // and the middle collapses to >= 0 (never negative).
    if (dw[1] < 0) { printf("FAIL of.mid.w negative: %d\n", dw[1]); s_failures++; }
}

int main(void) {
    empty_left_gives_middle_its_space();
    both_edges_present();
    middle_only();
    overflow_clamps_nonnegative();
    if (s_failures) { printf("%d FAILURES\n", s_failures); return 1; }
    printf("status_row_alloc: all passed\n");
    return 0;
}
