#pragma once
#include <stdint.h>
#include <stddef.h>
#include <stdbool.h>

// Packed status-line contract, shared with the phone.
// LOCKSTEP: src/pkjs/status-line-catalog.js mirrors every enum value and cap
// below; test/status-line-contract.test.js greps this header to enforce it.
// Deliberately no <pebble.h> so the module host-compiles (scripts/test-c.sh).

#define STATUS_LINE_COUNT 4
#define STATUS_SLOT_COUNT 3
#define STATUS_LINE_MAX_BYTES 48
#define STATUS_TEXT_EDGE_MAX 8
#define STATUS_TEXT_MID_MAX 19

typedef enum {
    STATUS_LINE_FORECAST = 0,
    STATUS_LINE_RADAR = 1,
    STATUS_LINE_TOP = 2,
    STATUS_LINE_HEALTH = 3,
} StatusLineId;

typedef enum {
    SLOT_EMPTY = 0,
    SLOT_TEXT = 1,          // value bytes already formatted by the phone
    SLOT_LIVE_DATE = 2,     // watch formats the current date/month
    SLOT_LIVE_STEPS = 3,
    SLOT_LIVE_HR = 4,
    SLOT_LIVE_SLEEP = 5,
    SLOT_LIVE_DISTANCE = 6,     // walked distance in km (metric)
    SLOT_LIVE_WEEK = 7,     // watch formats the current ISO-8601 calendar week
    SLOT_LIVE_DISTANCE_MI = 8,  // walked distance in miles (imperial); unit chosen by the phone
    SLOT_LIVE_BATTERY = 9,      // watch draws the battery glyph; state read on-device
} StatusSlotKind;
#define STATUS_SLOT_KIND_MAX SLOT_LIVE_BATTERY

typedef enum {
    STATUS_ICON_NONE = 0,
    STATUS_ICON_DRAWN_SUN = 1,  // sentinel: watch-drawn sunrise/sunset arrow
    STATUS_ICON_TEMP = 2,
    STATUS_ICON_UV = 3,
    STATUS_ICON_WIND = 4,
    STATUS_ICON_GUST = 5,
    STATUS_ICON_STEPS = 7,
    STATUS_ICON_SLEEP = 8,
    STATUS_ICON_HR = 9,
    STATUS_ICON_DISTANCE = 10,
    STATUS_ICON_AQI = 11,       // air quality (leaf); weather metric, not health-gated
    STATUS_ICON_POLLEN = 12,
} StatusIconId;
#define STATUS_ICON_MAX STATUS_ICON_POLLEN

typedef struct {
    uint8_t kind;
    uint8_t icon;
    uint8_t value_len;
    const char *value;  // into the blob, NOT NUL-terminated; NULL unless SLOT_TEXT
} StatusSlotView;

bool status_line_validate(const uint8_t *blob, size_t len);
bool status_line_slot(const uint8_t *blob, size_t len, int slot_index,
                      StatusSlotView *out);

// ISO 8601 week number (1-53) for a local calendar date. Integer-only (no FP),
// host-compilable. year: full year (e.g. 2026); yday: 0-based day of year
// (struct tm.tm_yday); wday: 0=Sun..6=Sat (struct tm.tm_wday).
int iso_week(int year, int yday, int wday);
