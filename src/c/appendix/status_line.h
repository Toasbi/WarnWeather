#pragma once
#include <stdint.h>
#include <stddef.h>
#include <stdbool.h>

// Packed status-line contract, shared with the phone.
// LOCKSTEP: src/pkjs/status-bars/domain/status-line-catalog.js mirrors every enum value and cap
// below; test/status-line-contract.test.js greps this header to enforce it.
// Deliberately no <pebble.h> so the module host-compiles (scripts/test-c.sh).

#if defined(PBL_PLATFORM_EMERY)
// emery: the Pebble Time 2 has three more status bars (bars 4 to 6, 3.0.0's New bar), so
// up to six of "your bars" beside the Watch bar: every screen can have two of its own.
#define STATUS_LINE_COUNT 7
#else
#define STATUS_LINE_COUNT 4
#endif
#define STATUS_SLOT_COUNT 3
#define STATUS_LINE_MAX_BYTES 48
#define STATUS_TEXT_EDGE_MAX 8
#define STATUS_TEXT_MID_MAX 19
// An edge slot's weather condition may take the middle slot's room, its name with the short
// form after it, while the whole line still fits STATUS_LINE_MAX_BYTES (the phone checks:
// status-lines.js widenEdgeConditions), so a side slot shows the whole name beside an empty
// or a short middle (status_row.c swap_in_short_forms).
#define STATUS_TEXT_EDGE_COND_MAX 19

typedef enum {
    STATUS_LINE_FORECAST = 0,
    STATUS_LINE_RADAR = 1,
    STATUS_LINE_TOP = 2,
    STATUS_LINE_HEALTH = 3,
#if defined(PBL_PLATFORM_EMERY)
    // emery: bars 4 to 6 (STATUS_LINE_5..7_UINT8), the bars the settings page's New bar
    // makes. Their persist slots are appended after every other key (persist.c), so these
    // ids are not the slot offsets the first four are.
    STATUS_LINE_BAR4 = 4,
    STATUS_LINE_BAR5 = 5,
    STATUS_LINE_BAR6 = 6,
#endif
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
    // The weather condition slot (src/pkjs/weather/domain/condition.js): phone-baked SLOT_TEXT
    // whose icon is the condition's glyph, picked per bake like the phone-battery pair.
    // COND_TEXT is its text-only look: no glyph may load, and like PRESSURE above the id
    // keeps it from arriving as TEXT + NONE. Its text may carry a short form after
    // STATUS_TEXT_ALT_SEP ("Partly cloudy" SEP "PCLDY").
    STATUS_ICON_COND_TEXT = 19,
    STATUS_ICON_COND_SUN = 20,
    STATUS_ICON_COND_MOON = 21,
    STATUS_ICON_COND_SUN_CLOUD = 22,
    STATUS_ICON_COND_MOON_CLOUD = 23,
    STATUS_ICON_COND_CLOUD = 24,
    STATUS_ICON_COND_FOG = 25,
    STATUS_ICON_COND_HAZE = 26,
    STATUS_ICON_COND_DRIZZLE = 27,
    STATUS_ICON_COND_RAIN = 28,
    STATUS_ICON_COND_SLEET = 29,
    STATUS_ICON_COND_SNOW = 30,
    STATUS_ICON_COND_HAIL = 31,
    STATUS_ICON_COND_THUNDER = 32,
    STATUS_ICON_COND_WIND = 33,     // the wind glyph, under an id of its own: STATUS_ICON_WIND
                                    // is the wind speed slot's (its bold mode, its pair)
} StatusIconId;
// Id 6 (STATUS_ICON_PRECIP, removed in 3dae9f4) is a retired hole: never reuse it —
// a pre-3dae9f4 install can still hold a persisted blob referencing it.
#define STATUS_ICON_MAX STATUS_ICON_COND_WIND

// The city slot can draw the current weather's glyph before its name: the glyph's id
// (STATUS_ICON_COND_SUN..STATUS_ICON_COND_WIND) with this bit set, so the slot stays the
// city's (SLOT_TEXT + STATUS_ICON_NONE's bold row and word ladder) and loads that glyph.
// The phone sends it to every watch but aplite, whose lean row draws no such glyph.
#define STATUS_ICON_CITY_GLYPH 0x80u
_Static_assert(STATUS_ICON_MAX < STATUS_ICON_CITY_GLYPH, "the city's glyph bit sits above every id");

// Whether a SLOT_TEXT slot's icon byte is the city's: no glyph, or a weather glyph marked
// with STATUS_ICON_CITY_GLYPH.
static inline bool status_icon_is_city(uint8_t icon) {
    return icon == STATUS_ICON_NONE || (icon & STATUS_ICON_CITY_GLYPH) != 0;
}

// Whether a SLOT_TEXT slot's icon byte is the weather condition slot's: its text look or one
// of its glyphs (never the city's, whose bit sits above every id).
static inline bool status_icon_is_condition(uint8_t icon) {
    return icon >= STATUS_ICON_COND_TEXT && icon <= STATUS_ICON_COND_WIND;
}

// The glyph an icon byte draws: the id without the city's bit.
static inline uint8_t status_icon_glyph(uint8_t icon) {
    return (uint8_t)(icon & ~STATUS_ICON_CITY_GLYPH);
}

// A SLOT_TEXT value may carry a short form after this byte: "full" SEP "short". The watch
// draws the full form and swaps in the short one where the row would cut the full one
// short, and offers it as the slot's short member where On demand needs the room
// (status_short_text.h). The middle slot has the bytes for both, and an edge slot's weather
// condition too where the line has the room (STATUS_TEXT_EDGE_COND_MAX); any other edge
// slot carries one form. Never in a slot with a wind-direction sentinel
// (status_row_direction.h).
#define STATUS_TEXT_ALT_SEP 0x1F
// Room for the longest short form, five capitals (condition.js: PCLDY, MCLDY): a longer
// one is cut to this many bytes.
#define STATUS_TEXT_ALT_MAX 5

// The full form's length in a SLOT_TEXT value of `len` bytes: the bytes before the
// first STATUS_TEXT_ALT_SEP, or all of them. The short form, if any, is what follows
// the separator.
static inline size_t status_text_full_len(const char *value, size_t len) {
    for (size_t i = 0; i < len; i++) {
        if (value[i] == STATUS_TEXT_ALT_SEP) { return i; }
    }
    return len;
}

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
