#pragma once
#include <pebble.h>   // time_t

// Pure axis-schedule math for the rain radar's top axis. No SDK calls —
// host-testable (see test/c/radar_axis_test.c).

// Radar slot cadence: one bar per 5-minute frame. Shared with
// rain_radar_layer.c (window maths) and mirrored by PKJS
// (RADAR_SLOT_SECONDS in index.js).
#define RADAR_SLOT_SECONDS (5 * 60)

typedef enum {
    RADAR_AXIS_HOUR_LABEL,  // slot starts a whole hour: digit replaces the tick
    RADAR_AXIS_TICK_BIG,
    RADAR_AXIS_TICK_SMALL,
} RadarAxisMark;

// Mark for slot `slot` of a radar window whose slot 0 starts at `radar_start`
// (a 5-min-aligned epoch; <= 0 = no data yet). With a known start, tick weight
// is anchored to the wall clock — big on quarter-hours — so the marks stay put
// as the window slides; whole-hour slots (past slot 0) carry the hour digit
// instead of a tick. Without a start there is no wall-clock anchor: plain
// index cadence, big every 3rd slot, no labels.
RadarAxisMark radar_axis_slot_mark(time_t radar_start, int slot);
