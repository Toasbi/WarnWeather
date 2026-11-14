#pragma once
#include <stdbool.h>
#include <stdint.h>
#include "../appendix/status_line.h"

// The status icons' sizes: which pixel drawing (scripts/pixel-icons/README.md) the watch draws
// for an icon at a row's icon height. Every icon is drawn pixel by pixel, once for every height
// a bar asks for, and shown 1:1: nothing is scaled. Deliberately no <pebble.h>, so
// scripts/test-c.sh host-compiles this with the generated tables
// (status_pixel_icons.generated.h) and checks that every height a bar can ask for has its
// drawing (test/c/status_icon_drawings_test.c).
//
// NOT BUILT ON APLITE: its lean status row (status_row_aplite.c) draws bit masks.

// Glyph ids for the On demand system items (layers/status_on_demand.c). In memory only, never
// on the wire: right after every StatusIconId (STATUS_ICON_MAX), and below the alert glyph
// cache's rain flag (0x80).
#define STATUS_ROW_ICON_QUIET (STATUS_ICON_MAX + 1)    // Quiet time: the muted speaker
#define STATUS_ROW_ICON_BT (STATUS_ICON_MAX + 2)       // Bluetooth connected: the rune
#define STATUS_ROW_ICON_BT_OFF (STATUS_ICON_MAX + 3)   // Bluetooth disconnected: crossed out
_Static_assert(STATUS_ROW_ICON_BT_OFF < 0x80, "the system glyph ids stay below the rain flag");

// One drawing in the generated tables: 4 bytes, since a Pebble app's image, the tables
// included, is loaded into its RAM.
typedef struct {
    uint8_t key;        // an icon id (status_line.h, above), or a rain alert bucket
    uint8_t rows;       // the painted height it is drawn at
    uint16_t resource;  // its RESOURCE_ID_* (an id past 65535 fails the build: -Woverflow)
} StatusPixelIcon;

// Per-glyph size trim, as a percent of the row's icon height. Most glyphs fill the slot, but a
// few read large at the shared height and get nudged down: the route (distance) sprawls to its
// corners and the steps footprint is wide. The vertical companion is the per-icon optical-centre
// weight in status_icon_weight.h: this one decides how BIG a glyph reads, that one how HIGH it
// sits. The phone-battery pair opts out: status_icon_phone_h() sizes it in whole pixels.
static inline int status_icon_scale_pct(uint8_t icon_id) {
    switch (icon_id) {
        case STATUS_ICON_DISTANCE: return 95;
        case STATUS_ICON_WIND:     return 95;
        case STATUS_ICON_GUST:     return 95;
        case STATUS_ICON_UV:       return 95;
        case STATUS_ICON_AQI:      return 85;
        case STATUS_ICON_TEMP:     return 93;
        case STATUS_ICON_DEWPOINT: return 88;   // the two drops span nearly the whole box, so
                                                // they read taller than the thermometer
        case STATUS_ICON_STEPS:    return 80;   // the footprint glyph is wide
        default:                   return 100;
    }
}

// ── The phone-battery pair's size: a rung, not a percent ────────────────────
//
// STATUS_ICON_PHONE_BATTERY (a phone with the bolt drawn inside it) and _CHG (a mains plug)
// swap in place inside ONE slot the moment the phone is plugged in, so they are sized as a
// PAIR at every tier but one. A height h paints h + 1 rows when even and h + 2 when odd, so the
// size grain is two pixels: the branches below subtract 2, never 1, and an odd h is trimmed
// down rather than left to buy a rung nobody asked for. The measured ladder and its history:
// docs/adr/0002-status-glyph-sizing-and-seating.md §3.

// Smallest h the pair survives: below 9 the plug's prongs merge into its outline. No shipping
// tier asks for less than 10, so this floor only ever holds h.
#define PHONE_ICON_MIN_H 9

// The pair's height in whole pixels: `h` is the row's icon height (100 % for both ids), and
// `top_strip` the row's tier flag. Every branch can only lower or pass h through.
static inline int status_icon_phone_h(uint8_t icon_id, int h, bool top_strip) {
#ifdef PBL_PLATFORM_EMERY
    // emery: COMPACT/NONE rows (height 16): both ids spend two pixels, 16 -> 14, to paint 15
    // instead of 17. FULL rows (height 12): the NORMAL glyph alone spends two, 12 -> 10, to
    // paint 11 instead of 13, the one tier where the two paint different heights. The top
    // strip (13) parity-trims to 12 and paints 13 for both.
    if (h >= 16) {
        h -= 2;
    } else if (!top_strip && h <= 12 && icon_id == STATUS_ICON_PHONE_BATTERY) {
        h -= 2;
    }
#else
    // basalt/diorite/flint: one answer for both ids at every tier; the parity trim is the
    // whole policy.
    (void) icon_id;
    (void) top_strip;
#endif
    if (h & 1) { h--; }
    return (h < PHONE_ICON_MIN_H) ? PHONE_ICON_MIN_H : h;
}

// The rows a glyph sized to h paints: h + 1 for an even h, h + 2 for an odd one (ADR-0002 §3).
// The drawings are made at these heights, so the seat and the text gap stay as they were.
static inline int status_icon_painted_rows(int h) { return (h & 1) ? h + 2 : h + 1; }

// The painted height of `icon_id` in a row whose icon height is `target_h`: the icon's trim,
// the small thermometer's fixed 9 under 10 px off the top strip (its tube and mercury would
// merge into a stick there; the top strip's smaller tier keeps the calendar seam clear), and
// the phone pair's rungs.
static inline int status_icon_rows(uint8_t icon_id, int target_h, bool top_strip) {
    int h = (target_h * status_icon_scale_pct(icon_id)) / 100;
    if (h < 1) { h = 1; }
    if (icon_id == STATUS_ICON_TEMP && h < 10 && !top_strip) { h = 9; }
    if (icon_id == STATUS_ICON_PHONE_BATTERY || icon_id == STATUS_ICON_PHONE_BATTERY_CHG) {
        h = status_icon_phone_h(icon_id, h, top_strip);
    }
    return status_icon_painted_rows(h);
}

// The drawing `table` holds for `key` at `rows`; where it has none, its tallest drawing
// shorter than that, so a row squeezed below every tier still draws the icon crisp, a size
// smaller; 0 when `key` has no drawing at all (a text-only id: NONE, PRESSURE, the plain phone
// battery, the condition's Text look).
static inline uint16_t status_icon_drawing(const StatusPixelIcon *table, int count, uint8_t key,
                                           int rows) {
    uint16_t smaller = 0;
    int smaller_rows = 0;
    for (int i = 0; i < count; i++) {
        if (table[i].key != key) { continue; }
        if (table[i].rows == rows) { return table[i].resource; }
        if (table[i].rows < rows && table[i].rows > smaller_rows) {
            smaller = table[i].resource;
            smaller_rows = table[i].rows;
        }
    }
    return smaller;
}
