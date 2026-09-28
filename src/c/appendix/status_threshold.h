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
//                       Alerts row's rain look (0 text — the legacy "Rain in
//                       12'" countdown, 1 icon, 2 icon + minutes; 3 reserved,
//                       reads as text). Bits 2-7 reserved (DWD official-warning
//                       flags later) — written 0. Which METRIC alerts are on
//                       never rides here: the phone bakes only the enabled,
//                       active ones into their own weather tuple
//                       (ALERT_ENTRIES_UINT8, encoding in alert_set.h).
//      [35]             the Alerts row's placement per status bar
//                       (THRESH_BAR_ALERTS_OFFSET), 2 bits per bar: top strip
//                       bits 0-1, forecast 2-3, radar 4-5, health 6-7 (ThreshBar
//                       order); 0 off / 1 left / 2 middle / 3 right
//                       (ThreshAlertsPlace). While an alert is active the row
//                       replaces that slot of the bar (and the neighbouring one
//                       when it needs the room).
//      [36 + (k >> 2)]  warn look (ThreshWarnLook) per PAIRED kind, 2 bits at
//                       bits 2 * (k & 3) — kinds 0..7 = bytes 36..37
//                       (THRESH_WARN_LOOK_OFFSET): the box drawn at the WARN
//                       level (a goal kind's "close"), for the status slot and
//                       the alert icon alike — 0 none, 1 outline, 2 fill (3
//                       reserved, reads as outline). A blob without these bytes
//                       (34 B and shorter) derives the look from the warn color
//                       byte: 0x00 -> none, any colour -> outline — exactly what
//                       the watch drew before the bytes existed.
//    One widening per release that shipped a new length, each on top of the
//    29-byte pre-bold layout:
//      - 1.11.0: 33 B, the bold area for kinds 0..15 (bytes 29..32).
//      - 1.12.0: 34 B, battery % (kind 16) opened byte 33; dew point (17) and the
//        two phone-battery kinds (18, 19) later took its other three cells for
//        free, which EXHAUSTED the bold area.
//      - 1.24.0: 38 B, the two alert bytes (the rain look, the per-bar
//        placement) and the two warn-look bytes, which cover the 8 PAIRED kinds
//        only (a ninth paired kind would need a third byte — asserted below).
//    The alert bytes sit right behind the full bold area, so kind 20 is no plain
//    append — it needs a sixth bold byte AND must relocate BOTH alert bytes (and
//    the warn-look bytes behind them), a LAYOUT change (a new accepted length and
//    a reader that knows every position). The _Static_asserts below the offsets
//    turn that into a compile error instead of kind 20's bold cell silently
//    aliasing the rain look.
//    Exactly four lengths are accepted: the current 38, the pre-alerts 34, the
//    16-kind 33, and the pre-bold 29. The interim 31-byte (8-kind bold), 35-byte
//    (the rain look without the placement) and 36-byte (no warn look) formats
//    never shipped — they existed only on feature branches — so they validate as
//    garbage, not as legacy. The UV step (27 -> 29) SHIFTED the health offsets,
//    so a 27-byte blob would be misread and is rejected; every step since only
//    APPENDS, so a shorter accepted blob still describes every field before it
//    and is read with the default for what it lacks (a 33-byte blob reads kind
//    16 as the default bold mode; a 34-byte one reads the rain look as text, the
//    placement as top strip left — the rain takeover the strip always had — and
//    the warn look from the warn color byte). That matters on upgrade: the
//    phone only force-resends its settings when the watch reports NO config at
//    all, so rejecting an old length would blank an existing user's
//    highlighting until they happened to open the settings page.
//    Health threshold wire units: steps = steps, sleep = MINUTES,
//    distance = 100 m units (the status row's own display resolution).

#define THRESH_KIND_COUNT 20
// Kinds that OWN a blob pair — an enable bit in byte 0, a color pair, and (for
// the health trio) a u16 threshold pair. Byte 0 has exactly 8 enable bits and
// the color/health offsets collide with later fields past kind 7, so bounding
// the paired accessors by this is correctness, not tidiness; only the bold
// cells run to THRESH_KIND_COUNT.
#define THRESH_PAIRED_KIND_COUNT 8
#define THRESH_SETTINGS_BYTES 38
#define THRESH_COLORS_OFFSET 1
#define THRESH_HEALTH_OFFSET 17
#define THRESH_BOLD_OFFSET 29
#define THRESH_ALERTS_OFFSET 34
#define THRESH_BAR_ALERTS_OFFSET 35
#define THRESH_WARN_LOOK_OFFSET 36
// The blob length before the bold bytes were appended — still accepted, and by
// construction equal to the offset the bold bytes start at.
#define THRESH_SETTINGS_BYTES_PRE_BOLD THRESH_BOLD_OFFSET
// The 16-kind length before byte 33 (kinds 16..19) was appended — still
// accepted; kinds 16+ read the default bold mode.
#define THRESH_SETTINGS_BYTES_PRE_KIND16 33
// The length before the alert and warn-look bytes were appended — still
// accepted (every install at upgrade time): the rain look reads as text, the
// placement as top strip left with every other bar off, and the warn look
// derives from the warn color byte (0x00 none, else outline).
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

// The alert bytes follow the bold area and end the blob (see the layout above): a
// kind appended past the last bold cell would write its bold mode into the rain
// look, so it must relocate both alert bytes.
_Static_assert(THRESH_BOLD_OFFSET + ((THRESH_KIND_COUNT + 3) / 4) <= THRESH_ALERTS_OFFSET,
               "a bold kind past byte 33 must relocate the alert bytes (layout change)");
_Static_assert(THRESH_BAR_ALERTS_OFFSET == THRESH_ALERTS_OFFSET + 1
               && THRESH_WARN_LOOK_OFFSET == THRESH_BAR_ALERTS_OFFSET + 1,
               "the two alert bytes sit side by side, the warn look right behind them");
// The warn look covers the PAIRED kinds, 4 per byte, and ends the blob.
_Static_assert(THRESH_SETTINGS_BYTES
               == THRESH_WARN_LOOK_OFFSET + (THRESH_PAIRED_KIND_COUNT + 3) / 4,
               "a paired kind past 7 needs a third warn-look byte (layout change)");

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

// The Alerts row's rain look — bits 0-1 of the alerts byte.
typedef enum {
    THRESH_RAIN_DISPLAY_TEXT = 0,      // the full countdown, "Rain in 12'" (legacy)
    THRESH_RAIN_DISPLAY_ICON = 1,      // the drop alone
    THRESH_RAIN_DISPLAY_MINUTES = 2,   // the drop + "12'"
} ThreshRainDisplay;

// The rain look from the alerts byte. THRESH_RAIN_DISPLAY_TEXT for an invalid
// blob, a pre-alerts blob (34/33/29 B — an upgrading watch keeps today's look
// until the phone resends its settings) and the reserved wire value 3.
int status_threshold_rain_display(const uint8_t *blob, size_t len);

// The box a paired kind draws at the WARN level (a goal kind's "close"), for its
// status slot and its alert icon. The danger level is always filled.
typedef enum {
    THRESH_WARN_LOOK_NONE = 0,      // no box — the level shows only as bold text
    THRESH_WARN_LOOK_OUTLINE = 1,   // rounded-rect outline in the warn colour
    THRESH_WARN_LOOK_FILL = 2,      // filled in the warn colour, legible ink over it
} ThreshWarnLook;

// The kind's warn look. A blob without the look bytes (34 B and shorter) derives
// it from the warn color byte — 0x00 (the old no-outline sentinel) -> NONE, any
// colour -> OUTLINE — which is what those watches drew. The reserved wire value 3
// reads as OUTLINE. NONE for an invalid blob and for a kind without a pair (the
// bold-only kinds, out of range).
int status_threshold_warn_look(const uint8_t *blob, size_t len, int kind);

// How a status slot or an alert icon is boxed at its level (ThreshLook.box).
typedef enum {
    THRESH_BOX_NONE = 0,      // no box
    THRESH_BOX_OUTLINE = 1,   // rounded-rect outline in the level's colour
    THRESH_BOX_FILL = 2,      // filled in the level's colour + the outline; the
                              // glyph restroked and the text drawn
                              // gcolor_legible_over() the fill
} ThreshBox;

// The box for a ThreshLevel under a ThreshWarnLook: NORMAL none, DANGER fill
// (whatever the look), WARN exactly the look — an out-of-range look reads as
// OUTLINE, the accessor's rule for the reserved wire value.
int status_threshold_box_for(int level, int look);

// The status bars, in the order of their 2-bit cells in the placement byte.
typedef enum {
    THRESH_BAR_TOP = 0,        // the strip beside the clock
    THRESH_BAR_FORECAST = 1,
    THRESH_BAR_RADAR = 2,
    THRESH_BAR_HEALTH = 3,
} ThreshBar;
#define THRESH_BAR_COUNT 4

// The bar a status line belongs to: its cell in the placement byte. A map, not a
// cast, because neither order can move to make it an identity: ThreshBar is the
// byte's wire cell order, StatusLineId the lines' persist slots. A bar's line does
// not change with the band the view gives it, so the radar bar keeps its placement
// in the upper and the lower band alike. Any other id is -1, which
// status_threshold_bar_alerts() answers Off.
static inline int status_threshold_bar_of_line(int line_id) {
    switch (line_id) {
        case STATUS_LINE_TOP:      return THRESH_BAR_TOP;
        case STATUS_LINE_FORECAST: return THRESH_BAR_FORECAST;
        case STATUS_LINE_RADAR:    return THRESH_BAR_RADAR;
        case STATUS_LINE_HEALTH:   return THRESH_BAR_HEALTH;
        default:                   return -1;
    }
}

// Where a bar's Alerts row sits while an alert is active — the slot it replaces.
typedef enum {
    THRESH_ALERTS_OFF = 0,
    THRESH_ALERTS_LEFT = 1,
    THRESH_ALERTS_MIDDLE = 2,
    THRESH_ALERTS_RIGHT = 3,
} ThreshAlertsPlace;

// The Alerts row's placement for `bar` (a ThreshBar) — a ThreshAlertsPlace.
// A blob without the placement byte (34/33/29 B, or invalid) answers what the
// watch drew before the byte existed: THRESH_ALERTS_LEFT for the top strip (the
// rain countdown's takeover of its left slot), THRESH_ALERTS_OFF for every other
// bar. An out-of-range bar is OFF.
int status_threshold_bar_alerts(const uint8_t *blob, size_t len, int bar);

// Whether a slot of `kind` drawn at `level` prints bold. Kind -1 (a slot with no
// threshold-capable content) is never bold.
bool status_threshold_is_bold(const uint8_t *blob, size_t len, int kind, int level);

// What a highlighted cell of `kind` draws at `level` — ONE decision for both draw
// paths, so a status slot and the alert icon of its kind cannot disagree at the same
// level. The slot hands in the level status_threshold_slot_level() resolved (NORMAL
// while its kind's Highlight switch is off); an alert entry hands in its real level,
// which the switch does not touch.
typedef struct {
    uint8_t box;      // ThreshBox: status_threshold_box_for() under the kind's warn look
    uint8_t bold;     // status_threshold_is_bold(): 1 = the bold companion font
    uint8_t color8;   // status_threshold_color8(): the RAW GColor8 byte behind the box
                      // (the drawable colour is the SDK side's theme pick)
} ThreshLook;
// Three bytes, no padding: the status row folds a look into its content signature
// byte for byte.
_Static_assert(sizeof(ThreshLook) == 3, "ThreshLook must stay three padding-free bytes");

ThreshLook status_threshold_look(const uint8_t *blob, size_t len, int kind, int level);

// The level (ThreshLevel) a status slot of `kind` is highlighted at; kind -1 (no
// threshold-capable content) and every kind whose Highlight switch (its enable bit)
// is off are NORMAL. A weather kind reads the phone-computed `levels_word`
// (STATUS_LEVELS_UINT8); a health kind compares `health_value` — the caller's
// status_threshold_health_value() reading, or -1 — against the blob's pair, and -1
// (unavailable, or no HealthService) is never highlighted. The caller reads health
// only for a health kind (status_threshold_is_health_kind) and passes -1 otherwise,
// which keeps the HealthService reads on the SDK side.
int status_threshold_slot_level(const uint8_t *blob, size_t len, int levels_word,
                                int kind, int health_value);
