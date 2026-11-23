// Host pin of snooze_draw (appendix/snooze.c), the Sleep item's two Z's. Its one caller
// (status_on_demand.c) passes the item's icon square, at most 16 px on every watch, so the
// pin covers every area up to 40 x 25: each line is recorded with the stroke colour and
// width in force when it is drawn, and so is the context's state after the call. What the
// screen shows is in that record, and nothing else is.
#include <stdio.h>
#include <string.h>

#include "c/appendix/snooze.h"
#include "c/appendix/snooze.c"

// FNV-1a of every area's record below, taken from the three-Z code this pin was written
// against (5f0bd0fa), so the two-Z code has to draw exactly what it drew.
#define SNOOZE_PIN 1594335671u

static int s_failures;
static uint8_t s_color, s_width;
static uint32_t s_hash;
static char s_log[512];

static void mix(int v) {
    // FNV-1a over the recorded values, byte by byte.
    for (int i = 0; i < 4; i++) {
        s_hash ^= (uint8_t) ((unsigned) v >> (8 * i));
        s_hash *= 16777619u;
    }
}

void graphics_context_set_stroke_color(GContext *ctx, GColor color) {
    (void) ctx;
    s_color = color.argb;
}

void graphics_context_set_stroke_width(GContext *ctx, uint8_t stroke_width) {
    (void) ctx;
    s_width = stroke_width;
}

void graphics_draw_line(GContext *ctx, GPoint p0, GPoint p1) {
    (void) ctx;
    mix(p0.x); mix(p0.y); mix(p1.x); mix(p1.y); mix(s_color); mix(s_width);
    size_t n = strlen(s_log);
    snprintf(s_log + n, sizeof(s_log) - n, "%d,%d-%d,%d ", p0.x, p0.y, p1.x, p1.y);
}

// One call from a known state; returns its lines, and folds them and the end state into
// s_hash.
static const char *draw(GRect area) {
    s_color = 0; s_width = 7; s_log[0] = '\0';
    snooze_draw(NULL, area, GColorWhite);
    mix(s_color); mix(s_width);
    return s_log;
}

static void expect_str(const char *name, const char *got, const char *want) {
    if (strcmp(got, want) != 0) {
        printf("FAIL %s:\n  got  %s\n  want %s\n", name, got, want);
        s_failures++;
    }
}

int main(void) {
    // The icon squares the status bars draw it in: Gothic 14 rows (9 px), Gothic 18 (12 px)
    // and Gothic 24 (16 px). The small Z sits on the bottom, the big one at the top.
    expect_str("9px", draw(GRect(10, 20, 9, 9)),
               "10,25-13,25 13,25-10,28 10,28-13,28 15,20-18,20 18,20-15,23 15,23-18,23 ");
    expect_str("12px", draw(GRect(0, 0, 12, 12)),
               "0,8-3,8 3,8-0,11 0,11-3,11 5,0-10,0 10,0-5,5 5,5-10,5 ");
    expect_str("16px", draw(GRect(0, 0, 16, 16)),
               "1,11-5,11 5,11-1,15 1,15-5,15 7,0-14,0 14,0-7,7 7,7-14,7 ");
    expect_str("too short", draw(GRect(0, 0, 20, 3)), "");
    expect_str("no width", draw(GRect(0, 0, 0, 12)), "");

    // Every area up to 40 x 25, at an offset origin: the lines, their colour and width,
    // and the context's colour and width afterwards.
    s_hash = 2166136261u;
    for (int w = -1; w <= 40; w++) {
        for (int h = 0; h <= 25; h++) {
            draw(GRect(3, 5, w, h));
        }
    }
    if (s_hash != SNOOZE_PIN) {
        printf("FAIL every area: hash %u, pinned %u\n", (unsigned) s_hash, (unsigned) SNOOZE_PIN);
        s_failures++;
    }

    if (s_failures) {
        printf("%d snooze failure(s)\n", s_failures);
        return 1;
    }
    printf("snooze OK\n");
    return 0;
}
