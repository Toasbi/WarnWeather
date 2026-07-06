// Host golden tests for src/c/appendix/radar_axis.c (pure axis-schedule math).
// Build & run via scripts/test-c.sh. All checks are epoch-mod arithmetic, so
// they are timezone-independent (digit formatting stays in the layer).
#include <stdio.h>
#include "c/appendix/radar_axis.h"

static int s_failures = 0;
static const char *mark_name(RadarAxisMark m) {
    switch (m) {
        case RADAR_AXIS_HOUR_LABEL: return "HOUR_LABEL";
        case RADAR_AXIS_TICK_BIG:   return "BIG";
        case RADAR_AXIS_TICK_SMALL: return "SMALL";
    }
    return "?";
}
static void expect_mark(const char *name, RadarAxisMark got, RadarAxisMark want) {
    if (got != want) {
        printf("FAIL %s: got %s want %s\n", name, mark_name(got), mark_name(want));
        s_failures++;
    }
}

#define HOUR 3600
// A whole-hour epoch (also a quarter-hour multiple), standing in for e.g. 10:00.
#define H ((time_t)(1000 * HOUR))

// Window starts on a quarter-hour (e.g. 10:00): big ticks every 3rd slot,
// hour digit 12 slots in. This is the case the old index cadence got right.
static void aligned_start_tests(void) {
    expect_mark("aligned.slot0_big",    radar_axis_slot_mark(H, 0),  RADAR_AXIS_TICK_BIG);
    expect_mark("aligned.slot1_small",  radar_axis_slot_mark(H, 1),  RADAR_AXIS_TICK_SMALL);
    expect_mark("aligned.slot3_big",    radar_axis_slot_mark(H, 3),  RADAR_AXIS_TICK_BIG);
    expect_mark("aligned.slot11_small", radar_axis_slot_mark(H, 11), RADAR_AXIS_TICK_SMALL);
    expect_mark("aligned.slot12_hour",  radar_axis_slot_mark(H, 12), RADAR_AXIS_HOUR_LABEL);
    expect_mark("aligned.slot15_big",   radar_axis_slot_mark(H, 15), RADAR_AXIS_TICK_BIG);
}

// Window starts at :05 past a quarter-hour (e.g. 10:05 — a 5-min fetch grid).
// Quarter-hours now land on slots 2, 5, 8, …; the hour lands on slot 11.
// The old index cadence put big ticks on 0, 3, …, 12 — one slot AFTER the
// digit, which is the reported "hour sits before the bigger tick".
static void start_plus_5min_tests(void) {
    const time_t start = H + 5 * 60;
    expect_mark("plus5.slot0_small",  radar_axis_slot_mark(start, 0),  RADAR_AXIS_TICK_SMALL);
    expect_mark("plus5.slot2_big",    radar_axis_slot_mark(start, 2),  RADAR_AXIS_TICK_BIG);
    expect_mark("plus5.slot5_big",    radar_axis_slot_mark(start, 5),  RADAR_AXIS_TICK_BIG);
    expect_mark("plus5.slot11_hour",  radar_axis_slot_mark(start, 11), RADAR_AXIS_HOUR_LABEL);
    expect_mark("plus5.slot12_small", radar_axis_slot_mark(start, 12), RADAR_AXIS_TICK_SMALL);
    expect_mark("plus5.slot14_big",   radar_axis_slot_mark(start, 14), RADAR_AXIS_TICK_BIG);
    expect_mark("plus5.slot23_hour",  radar_axis_slot_mark(start, 23), RADAR_AXIS_HOUR_LABEL);
}

// Window starts at :10 past a quarter-hour (e.g. 10:10): the mirror case —
// the old cadence put a big tick one slot BEFORE the digit.
static void start_plus_10min_tests(void) {
    const time_t start = H + 10 * 60;
    expect_mark("plus10.slot0_small", radar_axis_slot_mark(start, 0),  RADAR_AXIS_TICK_SMALL);
    expect_mark("plus10.slot1_big",   radar_axis_slot_mark(start, 1),  RADAR_AXIS_TICK_BIG);
    expect_mark("plus10.slot9_small", radar_axis_slot_mark(start, 9),  RADAR_AXIS_TICK_SMALL);
    expect_mark("plus10.slot10_hour", radar_axis_slot_mark(start, 10), RADAR_AXIS_HOUR_LABEL);
}

// Slot 0 on a whole hour keeps its tick — a digit at the window's left edge
// would half-clip, so the layer never labels slot 0.
static void hour_at_slot0_tests(void) {
    expect_mark("slot0hour.big", radar_axis_slot_mark(H, 0), RADAR_AXIS_TICK_BIG);
}

// No data yet (start <= 0): no wall-clock anchor — index cadence, no labels.
static void no_data_tests(void) {
    expect_mark("nodata.slot0_big",    radar_axis_slot_mark(0, 0),  RADAR_AXIS_TICK_BIG);
    expect_mark("nodata.slot1_small",  radar_axis_slot_mark(0, 1),  RADAR_AXIS_TICK_SMALL);
    expect_mark("nodata.slot3_big",    radar_axis_slot_mark(0, 3),  RADAR_AXIS_TICK_BIG);
    expect_mark("nodata.slot12_big",   radar_axis_slot_mark(0, 12), RADAR_AXIS_TICK_BIG);
    expect_mark("nodata.slot23_small", radar_axis_slot_mark(0, 23), RADAR_AXIS_TICK_SMALL);
}

int main(void) {
    aligned_start_tests();
    start_plus_5min_tests();
    start_plus_10min_tests();
    hour_at_slot0_tests();
    no_data_tests();
    if (s_failures == 0) {
        printf("radar_axis_test: all passed\n");
    }
    return s_failures == 0 ? 0 : 1;
}
