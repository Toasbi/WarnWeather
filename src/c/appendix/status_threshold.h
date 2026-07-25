#pragma once
#include <stdint.h>
#include <stddef.h>
#include <stdbool.h>
#include "status_line.h"

// Status-slot threshold-highlight contract, shared with the phone.
// LOCKSTEP: src/pkjs/status-thresholds.js mirrors the kind order, level values,
// and blob layout below; test/status-thresholds-contract.test.js greps this
// header to enforce it. Deliberately no <pebble.h> so the module host-compiles
// (scripts/test-c.sh).
//
// Wire formats:
//  - STATUS_LEVELS_UINT8 (weather message, 1 byte): packed per-kind levels for
//    the 4 weather kinds, 2 bits each — kind k occupies bits 2k..2k+1. Computed
//    phone-side (the watch has no raw ints for AQI/pollen/wind/gust).
//  - CLAY_THRESHOLDS_UINT8 (Clay message, THRESH_SETTINGS_BYTES):
//      [0]              enabled bitmask (bit k = kind k enabled)
//      [1 + 2k]         warn color,   GColor8 byte, k = 0..6
//      [2 + 2k]         danger color, GColor8 byte, k = 0..6
//      [15 + 4h + 0..1] warn threshold,   LE uint16, h = kind - THRESH_STEPS
//      [15 + 4h + 2..3] danger threshold, LE uint16
//    Health threshold wire units: steps = steps, sleep = MINUTES,
//    distance = 100 m units (the status row's own display resolution).

#define THRESH_KIND_COUNT 7
#define THRESH_SETTINGS_BYTES 27
#define THRESH_COLORS_OFFSET 1
#define THRESH_HEALTH_OFFSET 15

typedef enum {
    THRESH_AQI = 0,
    THRESH_POLLEN = 1,
    THRESH_WIND = 2,
    THRESH_GUST = 3,
    THRESH_STEPS = 4,
    THRESH_SLEEP = 5,
    THRESH_DISTANCE = 6,
} ThreshKind;
#define THRESH_WEATHER_KIND_MAX THRESH_GUST

typedef enum {
    THRESH_LEVEL_NORMAL = 0,
    THRESH_LEVEL_WARN = 1,     // rounded-rect outline
    THRESH_LEVEL_DANGER = 2,   // outline + filled background, legible ink
} ThreshLevel;

// ThreshKind for a packed slot (kind + icon pair), or -1 when the slot has no
// threshold-capable content (temperature/UV/HR/battery/date/city/week/sun are
// out of scope by design).
int status_threshold_kind_for_slot(uint8_t slot_kind, uint8_t icon);

// Fixed severity direction: the goal-style health kinds are below-is-worse.
bool status_threshold_below_is_worse(int kind);

// Level for a value against an ordered threshold pair. Crossing is inclusive:
// value == warn is already Warn; value == danger is already Danger.
int status_threshold_level(int value, int warn, int danger, bool below_is_worse);

// 2-bit level for a weather kind (0..THRESH_WEATHER_KIND_MAX) from the packed
// levels byte; the reserved wire value 3 clamps to danger.
int status_threshold_weather_level(uint8_t packed, int kind);

// Convert raw health readings to the blob's wire units for comparison: steps
// as-is, sleep seconds -> minutes, distance metres -> 100 m units. Returns -1
// when the reading is unavailable (never highlight; the display's own "0"/"--"
// clamp for an absent reading is a separate, independent concern in
// status_row.c) or kind is not a health kind.
int status_threshold_health_value(int kind, int steps, int sleep_seconds,
                                  int distance_m);

// Settings blob (CLAY_THRESHOLDS_UINT8 wire / THRESHOLD_SETTINGS persist).
// Accessors take (blob, len) and degrade to disabled/0 on any invalid input.
bool status_threshold_settings_validate(const uint8_t *blob, size_t len);
bool status_threshold_enabled(const uint8_t *blob, size_t len, int kind);
uint8_t status_threshold_color8(const uint8_t *blob, size_t len, int kind, int level);
uint16_t status_threshold_health_warn(const uint8_t *blob, size_t len, int kind);
uint16_t status_threshold_health_danger(const uint8_t *blob, size_t len, int kind);
