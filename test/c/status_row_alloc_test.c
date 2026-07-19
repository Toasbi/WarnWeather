// test/c/status_row_alloc_test.c
#include <stdio.h>
#include "c/appendix/status_row_alloc.h"

static int s_failures = 0;
static void expect(const char *name, int got, int want) {
    if (got != want) { printf("FAIL %s: got %d want %d\n", name, got, want); s_failures++; }
}
// Every slot's box must stay within [0, content_w] (no overrun, no negative origin).
static void expect_within(const char *name, int content_w, const int gx[3], const int draw_w[3]) {
    for (int i = 0; i < 3; i++) {
        if (gx[i] < 0 || gx[i] + draw_w[i] > content_w) {
            printf("FAIL %s slot %d: [%d,%d) exceeds [0,%d]\n",
                   name, i, gx[i], gx[i] + draw_w[i], content_w);
            s_failures++;
        }
    }
}

// content_w = 100 throughout.
static void empty_left_gives_middle_its_space(void) {
    // left empty(0), middle date(60), right battery(29). Middle takes the whole span
    // left of the right group, not a fixed third.
    int gw[3] = {0, 60, 29}, mn[3] = {0, 10, 10}, gx[3], dw[3];
    status_row_alloc(100, gw, mn, gx, dw);
    expect("el.left.x", gx[0], 0);
    expect("el.right.x", gx[2], 71);              // right-anchored: 100-29
    expect("el.right.w", dw[2], 29);
    expect("el.mid.w", dw[1], 60);                // fits: full desired width
    expect("el.mid.x", gx[1], (67 - 60) / 2);     // centred in [0..67]
    expect_within("el", 100, gx, dw);
}

static void both_edges_present(void) {
    int gw[3] = {40, 30, 40}, mn[3] = {10, 10, 10}, gx[3], dw[3];
    status_row_alloc(100, gw, mn, gx, dw);
    expect("be.left.x", gx[0], 0);
    expect("be.left.w", dw[0], 40);
    expect("be.right.x", gx[2], 60);              // 100-40
    expect("be.right.w", dw[2], 40);
    expect("be.mid.w", dw[1], 12);                // span [44..56] -> clamp 30 to 12
    expect("be.mid.x", gx[1], 44);
    expect_within("be", 100, gx, dw);
}

static void middle_only(void) {
    int gw[3] = {0, 50, 0}, mn[3] = {10, 10, 10}, gx[3], dw[3];
    status_row_alloc(100, gw, mn, gx, dw);
    expect("mo.mid.x", gx[1], (100 - 50) / 2);    // centred across the whole row
    expect("mo.mid.w", dw[1], 50);
    expect_within("mo", 100, gx, dw);
}

// Right wins priority: with both edges wider than the row, the RIGHT slot keeps its
// full width anchored at content_w (no overrun), the LEFT is clamped to what remains,
// and the MIDDLE collapses. Regression guard for the old right-edge overrun bug.
static void right_wins_over_left_on_overflow(void) {
    int gw[3] = {70, 40, 70}, mn[3] = {10, 10, 10}, gx[3], dw[3];
    status_row_alloc(100, gw, mn, gx, dw);
    expect("ov.right.x", gx[2], 30);              // 100-70, anchored
    expect("ov.right.w", dw[2], 70);              // full desired width, NOT overrunning
    expect("ov.left.x", gx[0], 0);
    expect("ov.left.w", dw[0], 26);              // clamped to [0 .. 30-GAP]
    expect("ov.mid.w", dw[1], 0);                // no room -> dropped
    expect_within("ov", 100, gx, dw);            // the invariant the old code broke
}

// A slot whose available span is below its minimum renderable width is dropped
// entirely (draw_w = 0) rather than drawn as an unreadable sliver.
static void slot_dropped_below_min(void) {
    int gw[3] = {40, 0, 90}, mn[3] = {20, 0, 10}, gx[3], dw[3];
    status_row_alloc(100, gw, mn, gx, dw);
    expect("dr.right.w", dw[2], 90);
    expect("dr.right.x", gx[2], 10);
    expect("dr.left.w", dw[0], 0);               // only 6px available (< min 20) -> dropped
    expect_within("dr", 100, gx, dw);
}

int main(void) {
    empty_left_gives_middle_its_space();
    both_edges_present();
    middle_only();
    right_wins_over_left_on_overflow();
    slot_dropped_below_min();
    if (s_failures) { printf("%d FAILURES\n", s_failures); return 1; }
    printf("status_row_alloc: all passed\n");
    return 0;
}
