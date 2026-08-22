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
// NOT LINKED ON APLITE: aplite paints its status rows from the lean
// layers/status_row_aplite.c twin, which carries no highlighting, so the whole
// feature is compiled out there (WW_THRESHOLD_HIGHLIGHT in wscript) and
// --gc-sections reaps this module. Keep every caller behind that macro.
//
// Wire formats:
//  - STATUS_LEVELS_UINT8 (weather message, 2 bytes LE): packed per-kind levels
//    for the weather kinds, 2 bits each — kinds 0..3 at bits 2k..2k+1, UV
//    (appended as kind 7) at bits 8..9. Computed phone-side (the watch has no
//    raw ints for AQI/pollen/wind/gust/UV).
//  - CLAY_THRESHOLDS_UINT8 (Clay message, THRESH_SETTINGS_BYTES):
//      [0]              enabled bitmask (bit k = kind k enabled) — exactly the
//                       8 PAIRED kinds; bold-only kinds (8..15) have no bit
//      [1 + 2k]         warn color,   GColor8 byte, k = 0..7 — 0x00 (alpha 00,
//                       impossible for an opaque GColor8) = NO OUTLINE: warn
//                       renders as bold text only, the weather-kind default
//      [2 + 2k]         danger color, GColor8 byte, k = 0..7
//      [17 + 4h + 0..1] warn threshold,   LE uint16, h = kind - THRESH_STEPS,
//                       health trio only (UV levels are phone-computed)
//      [17 + 4h + 2..3] danger threshold, LE uint16
//      [29 + (k >> 2)]  bold mode (ThreshBold), 2 bits per kind at bits
//                       2 * (k & 3) — 20 kinds x 2 bits = bytes 29..33 (byte 33
//                       carries kinds 16..19, ALL FOUR now assigned: the bold
//                       area is full, and kind 20 is the first that would need a
//                       sixth bold byte).
//                       INDEPENDENT of the enabled bitmask: THRESH_BOLD_ALWAYS
//                       bolds a slot whose kind has no thresholds configured.
//    Widened 27 -> 29 bytes when UV became kind 7, 29 -> 33 when the bold-only
//    kinds (8..15) grew the bold area to 16 kinds, 33 -> 34 when battery %
//    (kind 16) opened byte 33. (An interim 31-byte 8-kind bold format never
//    shipped, so it validates as garbage, not as legacy.) Dew point (kind 17)
//    appended into byte 33's second cell and cost NOTHING: the byte was already
//    paid for, so THRESH_SETTINGS_BYTES and the accepted-length set below are
//    unchanged. The two phone-battery kinds (18, 19) took byte 33's third and
//    fourth cells on the same terms — still 34 bytes, still the same three
//    accepted lengths. That EXHAUSTS the bold area: kind 20 is the first that
//    widens the blob 34 -> 35 — and with it every Clay send — and it would add a
//    fourth accepted length here for upgrading watches.
//    Exactly three lengths are accepted: the current 34, the 16-kind 33, and
//    the pre-bold 29. The UV step SHIFTED the health offsets, so a 27-byte blob
//    would be misread and is rejected; the bold steps only APPEND, so a shorter
//    accepted blob still describes every field before it and is read with the
//    default bold mode for the kinds it lacks (a 33-byte blob reads kind 16 as
//    the default). That matters on upgrade: the phone only force-resends its
//    settings when the watch reports NO config at all, so rejecting an old
//    length would blank an existing user's highlighting until they happened to
//    open the settings page.
//    Health threshold wire units: steps = steps, sleep = MINUTES,
//    distance = 100 m units (the status row's own display resolution).

#define THRESH_KIND_COUNT 20
// Kinds that OWN a blob pair — an enable bit in byte 0, a color pair, and (for
// the health trio) a u16 threshold pair. Byte 0 has exactly 8 enable bits and
// the color/health offsets collide with later fields past kind 7, so bounding
// the paired accessors by this is correctness, not tidiness; only the bold
// cells run to THRESH_KIND_COUNT.
#define THRESH_PAIRED_KIND_COUNT 8
#define THRESH_SETTINGS_BYTES 34
#define THRESH_COLORS_OFFSET 1
#define THRESH_HEALTH_OFFSET 17
#define THRESH_BOLD_OFFSET 29
// The blob length before the bold bytes were appended — still accepted, and by
// construction equal to the offset the bold bytes start at.
#define THRESH_SETTINGS_BYTES_PRE_BOLD THRESH_BOLD_OFFSET
// The 16-kind length before byte 33 (kinds 16..19) was appended — still
// accepted; kinds 16+ read the default bold mode.
#define THRESH_SETTINGS_BYTES_PRE_KIND16 33

typedef enum {
    THRESH_AQI = 0,
    THRESH_POLLEN = 1,
    THRESH_WIND = 2,
    THRESH_GUST = 3,
    THRESH_STEPS = 4,
    THRESH_SLEEP = 5,
    THRESH_DISTANCE = 6,
    THRESH_UV = 7,   // weather kind, appended after the health trio (ids are append-only)
    // Bold-only kinds: every remaining selectable slot option except battery
    // (a drawn glyph with no text run, so bold would be a no-op). They own only
    // their 2-bit bold cell — no enable bit, colors, or health pair — and being
    // level-less they only ever resolve THRESH_LEVEL_NORMAL, so THRESH_BOLD_WARN
    // (the unset default) renders non-bold and THRESH_BOLD_ALWAYS renders bold.
    THRESH_TEMP = 8,
    THRESH_PRESSURE = 9,
    THRESH_SUN = 10,
    THRESH_DATE = 11,
    THRESH_WEEK = 12,
    THRESH_CITY = 13,
    THRESH_COUNTDOWN = 14,
    THRESH_HR = 15,
    // Battery % (SLOT_LIVE_BATTERY_PCT) renders text, so unlike the glyph
    // battery slot (which stays kind-less) it owns a bold cell — in byte 33.
    THRESH_BATTERY_PCT = 16,
    // Dew point (kind 17, appended): bold-only, like every kind since 8. It
    // lands in byte 33's SECOND 2-bit cell, so THRESH_SETTINGS_BYTES stays 34.
    // Without a kind of its own the dew slot would arrive as SLOT_TEXT +
    // STATUS_ICON_DEWPOINT, miss every case in status_threshold_kind_for_slot()
    // and fall through to -1 — never boldable at all.
    THRESH_DEW = 17,
    // Phone battery (kinds 18/19, appended): byte 33's THIRD and FOURTH cells,
    // so THRESH_SETTINGS_BYTES still stays 34. Both are phone-baked SLOT_TEXT.
    // TWO kinds, ONE settings key: the phone's KINDS table gives both entries
    // key 'PhoneBattery' (src/pkjs/status-thresholds.js), so they share one Bold
    // sheet and the packer writes the same mode into both cells. Kind 18 covers
    // the icon variants (STATUS_ICON_PHONE_BATTERY and _CHG — one item, two
    // glyphs); kind 19 covers the no-icon variant, which without its own kind
    // would arrive as SLOT_TEXT + STATUS_ICON_NONE and drive THRESH_CITY.
    THRESH_PHONE_BATTERY = 18,
    THRESH_PHONE_BATTERY_PLAIN = 19,
} ThreshKind;
#define THRESH_WEATHER_KIND_MAX THRESH_GUST

// The health trio computes its levels ON the watch from live health values; every
// other kind (0..3 and UV) is phone-computed via the packed levels wire value.
static inline bool status_threshold_is_health_kind(int kind) {
    return kind >= THRESH_STEPS && kind <= THRESH_DISTANCE;
}

typedef enum {
    THRESH_LEVEL_NORMAL = 0,
    THRESH_LEVEL_WARN = 1,     // rounded-rect outline
    THRESH_LEVEL_DANGER = 2,   // outline + filled background, legible ink
} ThreshLevel;

// When a slot prints in the bold font — a monotone ladder over ThreshLevel.
// DANGER is bold under every mode (the filled box's ink carries the emphasis),
// WARN adds the warn level, ALWAYS adds the normal zone as well. WARN is 0 so a
// never-configured kind reproduces the shipped behaviour, and the reserved wire
// value 3 clamps back to it for the same reason.
typedef enum {
    THRESH_BOLD_WARN = 0,     // bold from THRESH_LEVEL_WARN up (the default)
    THRESH_BOLD_OFF = 1,      // bold at THRESH_LEVEL_DANGER only
    THRESH_BOLD_ALWAYS = 2,   // always bold, thresholds configured or not
} ThreshBold;

// ThreshKind for a packed slot (kind + icon pair), or -1 when the slot has no
// threshold-capable content (the glyph battery — drawn, no text — and empty).
// SLOT_TEXT + STATUS_ICON_NONE maps to THRESH_CITY: city is the only remaining
// TEXT+NONE catalog option (pressure got its own text-only STATUS_ICON_PRESSURE
// to discriminate it, and the no-icon phone-battery item got
// STATUS_ICON_PHONE_BATTERY_PLAIN for the same reason). A pressure slot
// persisted BEFORE that icon existed still
// arrives as TEXT+NONE and reads as THRESH_CITY until the phone re-sends its
// slots — visually identical while no bold is configured for either kind.
int status_threshold_kind_for_slot(uint8_t slot_kind, uint8_t icon);

// Fixed severity direction. No shipped kind warns downward since the goal
// rework (the goal kinds use the same rises-toward-the-pair machinery with
// celebratory semantics), so the implementation returns false unconditionally;
// the hook stays for a future genuinely downward-warning kind. The JS contract
// (status-thresholds.js) retired its side of the axis entirely — pairOrdered/
// computeLevel are above-only there.
bool status_threshold_below_is_worse(int kind);

// Level for a value against an ordered threshold pair. Crossing is inclusive:
// value == warn is already Warn; value == danger is already Danger.
int status_threshold_level(int value, int warn, int danger, bool below_is_worse);

// 2-bit level for a weather kind (0..THRESH_WEATHER_KIND_MAX) from the packed
// levels byte; the reserved wire value 3 clamps to danger.
int status_threshold_weather_level(int packed, int kind);

// Convert raw health readings to the blob's wire units for comparison: steps
// as-is, sleep seconds -> minutes, distance metres -> 100 m units. Returns -1
// when the reading is unavailable (never highlight; the display's own "0"/"--"
// clamp for an absent reading is a separate, independent concern in
// status_row.c) or kind is not a health kind.
int status_threshold_health_value(int kind, int steps, int sleep_seconds,
                                  int distance_m);

// Settings blob (CLAY_THRESHOLDS_UINT8 wire / THRESHOLD_SETTINGS persist).
// Accessors take (blob, len) and degrade to disabled/0 on any invalid input.
// enabled/color8 (and the health u16s, via the health-kind check) answer only
// the paired kinds (< THRESH_PAIRED_KIND_COUNT); bold_mode alone spans all
// THRESH_KIND_COUNT kinds.
bool status_threshold_settings_validate(const uint8_t *blob, size_t len);
bool status_threshold_enabled(const uint8_t *blob, size_t len, int kind);
uint8_t status_threshold_color8(const uint8_t *blob, size_t len, int kind, int level);
uint16_t status_threshold_health_warn(const uint8_t *blob, size_t len, int kind);
uint16_t status_threshold_health_danger(const uint8_t *blob, size_t len, int kind);

// The kind's bold mode. Falls back to THRESH_BOLD_WARN (the shipped behaviour)
// for an invalid blob, an out-of-range kind, or the reserved wire value 3.
int status_threshold_bold_mode(const uint8_t *blob, size_t len, int kind);

// Whether a slot of `kind` drawn at `level` prints bold. Kind -1 (a slot with no
// threshold-capable content) is never bold.
bool status_threshold_is_bold(const uint8_t *blob, size_t len, int kind, int level);
