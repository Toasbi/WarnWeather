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
    SLOT_LIVE_BATTERY_PCT = 10, // watch formats the charge as "NN%" text; icon NONE
} StatusSlotKind;
#define STATUS_SLOT_KIND_MAX SLOT_LIVE_BATTERY_PCT

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
    STATUS_ICON_COUNTDOWN = 13,
    STATUS_ICON_PRESSURE = 14,  // TEXT-ONLY: no PDC/bit-mask glyph exists and none
                                // may load — the id only discriminates pressure
                                // from city (both SLOT_TEXT) on the wire, for the
                                // per-kind bold mode (status_threshold.h)
    STATUS_ICON_DEWPOINT = 15,  // droplets; dew point is a temperature, so the
                                // glyph is what separates it from the temp slot.
                                // An id of its own is required even where the
                                // glyph is absent (aplite): a SLOT_TEXT slot with
                                // STATUS_ICON_NONE inherits THRESH_CITY's bold mode
    STATUS_ICON_PHONE_BATTERY = 16,      // phone glyph; the PHONE's charge, baked
                                         // as "NN%" text by the phone (SLOT_TEXT)
    STATUS_ICON_PHONE_BATTERY_CHG = 17,  // phone-charging glyph; the phone picks
                                         // it over id 16 at bake time, so charging
                                         // costs no wire field and no watch logic
    STATUS_ICON_PHONE_BATTERY_PLAIN = 18,
                                // TEXT-ONLY: the no-icon phone-battery item, for
                                // which no PDC/bit-mask glyph exists and none may
                                // load — exactly like STATUS_ICON_PRESSURE above.
                                // The id is what stops the no-icon variant from
                                // arriving as SLOT_TEXT + STATUS_ICON_NONE, falling
                                // through to THRESH_CITY and silently driving
                                // City's Bold row (status_threshold.h)
} StatusIconId;
// Id 6 (STATUS_ICON_PRECIP, removed in 3dae9f4) is a retired hole: never reuse it —
// a pre-3dae9f4 install can still hold a persisted blob referencing it.
#define STATUS_ICON_MAX STATUS_ICON_PHONE_BATTERY_PLAIN

typedef struct {
    uint8_t kind;
    uint8_t icon;
    uint8_t value_len;
    const char *value;  // into the blob, NOT NUL-terminated; NULL unless SLOT_TEXT
} StatusSlotView;

// Parse a packed line in ONE walk: validates the whole blob and fills all three
// slot views. Returns STATUS_SLOT_COUNT on success, 0 on any malformation.
//
// TWO CONTRACTS the callers depend on:
//  - On a 0 return `out` is PARTIALLY FILLED and its contents are indeterminate.
//    Check the return; never read `out` without it.
//  - Every filled view's `value` points INTO `blob` and is NOT NUL-terminated
//    (see StatusSlotView above). No StatusSlotView may outlive the function that
//    walked it, and no function may re-load the buffer `blob` points at while
//    views into it are still live. That matters on the watch: every status row
//    shares one file-scope blob scratch (status_row.c), so a second load while
//    views are live would silently reinterpret one row's views against another
//    row's bytes.
//
// This replaced a per-index accessor that re-validated the whole blob on every
// call — the draw path walked a three-slot line seven times per row per frame.
int status_line_slots(const uint8_t *blob, size_t len,
                      StatusSlotView out[STATUS_SLOT_COUNT]);

// Wire-check only: true when the blob is a well-formed line. For a caller that
// judges bytes it is not going to read (app_message.c, before persisting).
bool status_line_validate(const uint8_t *blob, size_t len);

// ISO 8601 week number (1-53) for a local calendar date. Integer-only (no FP),
// host-compilable. year: full year (e.g. 2026); yday: 0-based day of year
// (struct tm.tm_yday); wday: 0=Sun..6=Sat (struct tm.tm_wday).
int iso_week(int year, int yday, int wday);
