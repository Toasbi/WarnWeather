#pragma once
#include <stdint.h>
#include <stddef.h>
#include <stdbool.h>
#include "status_line.h"
#include "on_demand.h"   // OdItem / OdSide: the On demand cells' order and values

// Status-slot threshold-highlight contract, shared with the phone.
// LOCKSTEP: src/pkjs/status-thresholds.js mirrors the kind order and level
// values below, src/pkjs/status-wire.js the blob layout;
// test/status-thresholds-contract.test.js greps this header to enforce both.
// Deliberately no <pebble.h> so the module host-compiles (scripts/test-c.sh).
//
// NOT LINKED ON APLITE: aplite paints its status rows from the lean
// layers/status_row_aplite.c twin, which carries no highlighting, so the whole
// feature is compiled out there (WW_THRESHOLD_HIGHLIGHT in wscript) and
// --gc-sections reaps this module. Keep every caller behind that macro, or in a
// file aplite never compiles (status_row.c: wscript builds its twin instead).
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
//                       impossible for an opaque GColor8) = NO BOX: the phone
//                       packs it exactly for the warn look 'none' (below), so a
//                       blob without the look bytes still reads right
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
//      [34]             alerts options (THRESH_ALERTS_OFFSET). Bits 0-1: the
//                       Rain item's look (0 text — the legacy "Rain in 12'"
//                       countdown, 1 icon, 2 icon + minutes; 3 reserved, reads
//                       as text). Bits 2-7 reserved (DWD official-warning flags
//                       later) — written 0. Which METRIC alerts are active never
//                       rides here: the phone bakes the placed, active ones into
//                       their own weather tuple (ALERT_ENTRIES_UINT8, encoding in
//                       alert_set.h).
//      [35]             the Battery item (THRESH_BATTERY_OFFSET): bits 0-5 the
//                       warn level in % (valid 5..30; 0 or out of range reads
//                       as 10), bit 6 its Look (0 icon, 1 icon + value), bit 7
//                       reserved 0. The phone writes the level already on the
//                       platform's step (5s on emery, 10/20/30 elsewhere), so the
//                       watch uses it verbatim and never rounds.
//      [36 + (k >> 2)]  warn look (ThreshWarnLook) per PAIRED kind, 2 bits at
//                       bits 2 * (k & 3) — kinds 0..7 = bytes 36..37
//                       (THRESH_WARN_LOOK_OFFSET): the box drawn at the WARN
//                       level (a goal kind's "close"), for the status slot and
//                       the alert icon alike — 0 none, 1 outline, 2 fill (3
//                       reserved, reads as outline).
//      [38 + item]      the On demand cells (THRESH_ON_DEMAND_OFFSET): one byte
//                       per OdItem below OD_BLOB_ITEM_COUNT (on_demand.h, the
//                       priority order), 2 bits per bar at bits 2 * bar
//                       (ThreshBar): 0 none, 1 left, 2 right (OdSide), 3 reserved
//                       (reads as none). The phone writes effective values only —
//                       a ticked item on a bar that exists — so a bar the modes
//                       remove is simply zeros. Emery's Heart rate item (OD_HR) has
//                       no byte here: its cell rides CLAY_HR_ALERT_UINT8 (hr_alert.h).
//    One widening per release that shipped a new length, each on top of the
//    29-byte pre-bold layout:
//      - 1.11.0: 33 B, the bold area for kinds 0..15 (bytes 29..32).
//      - 1.12.0: 34 B, battery % (kind 16) opened byte 33; dew point (17) and the
//        two phone-battery kinds (18, 19) later took its other three cells for
//        free, which EXHAUSTED the bold area.
//      - 1.24.0: 48 B, the rain look, the Battery item byte, the two warn-look
//        bytes, which cover the 8 PAIRED kinds only (a ninth paired kind would
//        need a third byte — asserted below), and the ten On demand cells.
//    The alert bytes sit right behind the full bold area, so kind 20 is no plain
//    append — it needs a sixth bold byte AND must relocate everything behind it
//    (the rain look, the Battery byte, the warn looks, the cells), a LAYOUT change
//    (a new accepted length and a reader that knows every position). The
//    _Static_asserts below the offsets turn that into a compile error instead of
//    kind 20's bold cell silently aliasing the rain look.
//    Exactly four lengths are accepted: the current 48, the pre-alerts 34, the
//    16-kind 33 and the pre-bold 29. The interim 31-byte (8-kind bold), 35-, 36-
//    and 38-byte formats never shipped, so they validate as garbage, not as
//    legacy. The UV step (27 -> 29) SHIFTED the health offsets, so a 27-byte blob
//    would be misread and is rejected; every step since only APPENDS, so a
//    shorter accepted blob still describes every field before it, and
//    status_threshold_normalize() fills in what it lacks.
//    Health threshold wire units: steps = steps, sleep = MINUTES,
//    distance = 100 m units (the status row's own display resolution).

#define THRESH_KIND_COUNT 20
// Kinds that OWN a blob pair — an enable bit in byte 0, a color pair, and (for
// the health trio) a u16 threshold pair. Byte 0 has exactly 8 enable bits and
// the color/health offsets collide with later fields past kind 7, so bounding
// the paired accessors by this is correctness, not tidiness; only the bold
// cells run to THRESH_KIND_COUNT.
#define THRESH_PAIRED_KIND_COUNT 8
#define THRESH_SETTINGS_BYTES 48
#define THRESH_COLORS_OFFSET 1
#define THRESH_HEALTH_OFFSET 17
#define THRESH_BOLD_OFFSET 29
#define THRESH_ALERTS_OFFSET 34
#define THRESH_BATTERY_OFFSET 35
#define THRESH_WARN_LOOK_OFFSET 36
#define THRESH_ON_DEMAND_OFFSET 38
// The Battery item's warn level: what byte 35 may carry, and what 0, an
// out-of-range value and a blob without the byte read as.
#define THRESH_BATTERY_LEVEL_MIN 5
#define THRESH_BATTERY_LEVEL_MAX 30
#define THRESH_BATTERY_LEVEL_DEFAULT 10
#define THRESH_BATTERY_LEVEL_MASK 0x3F
#define THRESH_BATTERY_VALUE_BIT 0x40
// The blob length before the bold bytes were appended — still accepted, and by
// construction equal to the offset the bold bytes start at.
#define THRESH_SETTINGS_BYTES_PRE_BOLD THRESH_BOLD_OFFSET
// The 16-kind length before byte 33 (kinds 16..19) was appended — still accepted.
#define THRESH_SETTINGS_BYTES_PRE_KIND16 33
// The length before the alert, Battery, warn-look and On demand bytes were
// appended — still accepted (every install at upgrade time).
#define THRESH_SETTINGS_BYTES_PRE_ALERTS 34

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

// The alert bytes follow the bold area (see the layout above): a kind appended
// past the last bold cell would write its bold mode into the rain look, so it must
// relocate everything behind it.
_Static_assert(THRESH_BOLD_OFFSET + ((THRESH_KIND_COUNT + 3) / 4) <= THRESH_ALERTS_OFFSET,
               "a bold kind past byte 33 must relocate the alert bytes (layout change)");
_Static_assert(THRESH_BATTERY_OFFSET == THRESH_ALERTS_OFFSET + 1
               && THRESH_WARN_LOOK_OFFSET == THRESH_BATTERY_OFFSET + 1,
               "the rain look and the Battery byte sit side by side, the warn look right behind");
// The warn look covers the PAIRED kinds, 4 per byte, and the cells follow it.
_Static_assert(THRESH_ON_DEMAND_OFFSET
               == THRESH_WARN_LOOK_OFFSET + (THRESH_PAIRED_KIND_COUNT + 3) / 4,
               "a paired kind past 7 needs a third warn-look byte (layout change)");
// One cell byte per blob On demand item ends the blob, and a byte holds every bar.
_Static_assert(THRESH_SETTINGS_BYTES == THRESH_ON_DEMAND_OFFSET + OD_BLOB_ITEM_COUNT,
               "an On demand item past the tenth needs a new cell byte (layout change)");
// At 48 B the blob exactly fills persist's no-op-write compare buffer
// (write_sized_data_if_changed): one byte more and every save would skip the compare
// and write flash.
_Static_assert(THRESH_SETTINGS_BYTES <= STATUS_LINE_MAX_BYTES,
               "the blob must fit persist's compare buffer");

// The health trio computes its levels ON the watch from live health values; every
// other kind (0..3 and UV) is phone-computed via the packed levels wire value.
static inline bool status_threshold_is_health_kind(int kind) {
    return kind >= THRESH_STEPS && kind <= THRESH_DISTANCE;
}

typedef enum {
    THRESH_LEVEL_NORMAL = 0,
    THRESH_LEVEL_WARN = 1,     // boxed per the kind's warn look (status_threshold_look)
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

// Convert raw health readings to the blob's wire units for comparison: steps
// as-is, sleep seconds -> minutes, distance metres -> 100 m units. Returns -1
// when the reading is unavailable (never highlight; the display's own "0"/"--"
// clamp for an absent reading is a separate, independent concern in
// status_row.c) or kind is not a health kind.
int status_threshold_health_value(int kind, int steps, int sleep_seconds,
                                  int distance_m);

// Settings blob (CLAY_THRESHOLDS_UINT8 wire / THRESHOLD_SETTINGS persist).
// Whether `len` is an accepted length (see the layout above). The wire's and the
// store's judge; a reader judges through status_threshold_normalize().
bool status_threshold_settings_validate(const uint8_t *blob, size_t len);

// Turn a stored blob into the full 48-byte layout, in place, ONCE per load: every
// accessor below reads that layout and nothing else. `stored_len` is what persist
// read into `blob` (0 or negative: nothing stored). An accepted shorter blob keeps
// its bytes and gets what it lacks as the watch drew before those bytes existed —
// the default bold mode for a kind without a cell (16..19 at 33 B, all at 29 B), the
// rain look Text, the warn look from the warn color byte (0x00 none, any colour
// an outline), the Battery item at 10 %, Icon, and the On demand cells as the
// compiled defaults (the phone's defaults for the Watch Status Bar, nothing on any
// other bar). An invalid length, or nothing stored, reads those defaults with
// nothing enabled, no warn box and opaque-white colours. Upgrading watches hold
// 34, 33 or 29 B until the phone resends its settings — and the phone only
// force-resends when the watch reports NO config at all, so rejecting an old length
// would blank an existing user's highlighting until they opened the settings page.
void status_threshold_normalize(uint8_t blob[THRESH_SETTINGS_BYTES], int stored_len);

// The rain look (a ThreshRainDisplay, on_demand.h) from bits 0-1 of the alerts byte;
// the reserved wire value 3 reads as THRESH_RAIN_DISPLAY_TEXT.
int status_threshold_rain_display(const uint8_t blob[THRESH_SETTINGS_BYTES]);

// The box a paired kind draws at the WARN level (a goal kind's "close"), for its
// status slot and its alert icon. The danger level is always filled.
typedef enum {
    THRESH_WARN_LOOK_NONE = 0,      // no box — the level shows only as bold text
    THRESH_WARN_LOOK_OUTLINE = 1,   // rounded-rect outline in the warn colour
    THRESH_WARN_LOOK_FILL = 2,      // filled in the warn colour, legible ink over it
} ThreshWarnLook;

// How a status slot or an alert icon is boxed at its level (ThreshLook.box).
typedef enum {
    THRESH_BOX_NONE = 0,      // no box
    THRESH_BOX_OUTLINE = 1,   // rounded-rect outline in the level's colour
    THRESH_BOX_FILL = 2,      // filled in the level's colour + the outline; the
                              // glyph restroked and the text drawn
                              // gcolor_legible_over() the fill
} ThreshBox;

// The status bars, in the order of their 2-bit cells in each On demand cell byte.
typedef enum {
    THRESH_BAR_TOP = 0,        // the strip beside the clock (the Watch Status Bar)
    THRESH_BAR_FORECAST = 1,
    THRESH_BAR_RADAR = 2,
    THRESH_BAR_HEALTH = 3,
} ThreshBar;
#define THRESH_BAR_COUNT 4
_Static_assert(THRESH_BAR_COUNT * 2 <= 8, "one cell byte holds a 2-bit cell per bar");

// The bar a status line belongs to: its cell in the On demand bytes. A map, not a
// cast, because neither order can move to make it an identity: ThreshBar is the
// bytes' wire cell order, StatusLineId the lines' persist slots. A bar's line does
// not change with the band the view gives it, so the radar bar keeps its items in
// the upper and the lower band alike. Any other id is -1, which
// status_threshold_on_demand_side() answers with no side.
static inline int status_threshold_bar_of_line(int line_id) {
    switch (line_id) {
        case STATUS_LINE_TOP:      return THRESH_BAR_TOP;
        case STATUS_LINE_FORECAST: return THRESH_BAR_FORECAST;
        case STATUS_LINE_RADAR:    return THRESH_BAR_RADAR;
        case STATUS_LINE_HEALTH:   return THRESH_BAR_HEALTH;
        default:                   return -1;
    }
}

// The side of `bar` (a ThreshBar) On demand item `item` (an OdItem) sits on. The
// reserved cell value 3, an out-of-range bar and an out-of-range item answer
// OD_SIDE_NONE.
OdSide status_threshold_on_demand_side(const uint8_t blob[THRESH_SETTINGS_BYTES], int bar,
                                       int item);

// The Battery item's warn level in %: it is active at or below it. Byte 35 as the
// phone sent it (5..30, already on the platform's step — the watch never rounds);
// 0 and anything out of range answer THRESH_BATTERY_LEVEL_DEFAULT.
uint8_t status_threshold_battery_level(const uint8_t blob[THRESH_SETTINGS_BYTES]);

// Whether the Battery item is active: the charge at or below its warn level
// (status_threshold_battery_level), charging or not.
static inline bool status_threshold_battery_low(int charge, int level) {
    return charge <= level;
}

// The Battery item's Look: true for Icon + value ("8%" beside the icon), false for
// the icon alone.
bool status_threshold_battery_value(const uint8_t blob[THRESH_SETTINGS_BYTES]);

// What a highlighted cell of `kind` draws at `level` — ONE decision for both draw
// paths, so a status slot and the alert icon of its kind cannot disagree at the same
// level. The slot hands in the level status_threshold_slot_level() resolved (NORMAL
// while its kind's Highlight switch is off); an alert entry hands in its real level,
// which the switch does not touch.
typedef struct {
    uint8_t box;      // ThreshBox: NORMAL none, DANGER fill, WARN the kind's warn look
                      // (none for a kind without a pair; the reserved 3 an outline)
    uint8_t bold;     // 1 = the bold companion font, per the kind's ThreshBold ladder
                      // (an out-of-range kind, and the reserved 3, take the default
                      // WARN); never for kind -1 (no threshold-capable content)
    uint8_t color8;   // the RAW GColor8 byte behind the box: the kind's warn or danger
                      // colour, opaque white at NORMAL and for a kind without a pair
                      // (the drawable colour is the SDK side's theme pick)
} ThreshLook;

ThreshLook status_threshold_look(const uint8_t blob[THRESH_SETTINGS_BYTES], int kind, int level);

// The level (ThreshLevel) a status slot of `kind` is highlighted at; kind -1 (no
// threshold-capable content) and every kind whose Highlight switch (its enable bit)
// is off are NORMAL. A weather kind reads the phone-computed `levels_word`
// (STATUS_LEVELS_UINT8); a health kind compares `health_value` — the caller's
// status_threshold_health_value() reading, or -1 — against the blob's pair, and -1
// (unavailable, or no HealthService) is never highlighted. The caller reads health
// only for a health kind (status_threshold_is_health_kind) and passes -1 otherwise,
// which keeps the HealthService reads on the SDK side.
int status_threshold_slot_level(const uint8_t blob[THRESH_SETTINGS_BYTES], int levels_word,
                                int kind, int health_value);
